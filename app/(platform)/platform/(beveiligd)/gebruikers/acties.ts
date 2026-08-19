"use server";

// ============================================================================
//  Server-actions — Tenant-gebruikersbeheer per fonds (Increment P3-B, FO §10).
// ----------------------------------------------------------------------------
//  Het onboarding-/interventiepad: een bevoegde platformbeheerder maakt, per
//  EXPLICIET gekozen fonds, tenant-gebruikers aan en beheert rol/toegang. Alle
//  handelingen achter withPlatform (sessie + live AAL2 + capability + twee-fasen-
//  audit in platform_event_log, fail-closed). Referentiepatroon: rechten/acties.ts.
//
//  BESLUIT 0083 (samenvatting van de bindende keuzes):
//   • B-2  capability = platform.tenants.manage (hergebruik, al zwaar).
//   • B-3  wachtwoord direct (interim, geen invite/SMTP). Het wachtwoord komt
//          NERGENS in het auditlog/effect/melding — alleen `wachtwoord_gezet:true`.
//   • B-4  createUser met metadata {naam, fonds_id} (GEEN rol) → de bestaande
//          trigger maakt het profiel op 'bestuurder'; is de rol hoger, dan een
//          service-role-update ná createUser. De auth-trigger blijft ongemoeid.
//   • B-1  vier-ogen bij 'beheerder'/(de)blokkeren is UITGESTELD (single-actor +
//          verplichte reden + audit); eindige geaccepteerde schuld, zie 0083.
//   • B-5  (de)blokkeren via auth.admin.updateUserById({ ban_duration }); geen
//          hard delete, profiel + auditsporen blijven.
//
//  GEEN IMPLICIETE FONDSTOEWIJZING (R1-discipline, 0044): fonds is altijd een
//  expliciete, gevalideerde keuze; geen default, geen 'eerste fonds', geen
//  limit 1 — in geen enkele tak.
// ============================================================================

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";
import {
  isTenantRol,
  valideerAanmaakBasis,
  type TenantRol,
  type GebruikersResultaat,
} from "./gedeeld";

const LIJST_PAD = "/platform/gebruikers";
const CAP = "platform.tenants.manage" as const;

// ── Hulp ─────────────────────────────────────────────────────────────────────

/** Doelobject bij aanmaak: gehasht e-mailadres (geen PII in het auditlog). Bij
 *  aanmaak is de user-id nog onbekend; die landt in het result-effect. */
function emailHashDoel(email: string): string {
  return "email-hash:" + createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function platformMelding(foutcode: string): string {
  switch (foutcode) {
    case "no_session_or_inactive":
      return "Geen geldige platform-sessie. Log opnieuw in.";
    case "mfa_required":
      return "Sterke authenticatie (MFA) vereist voor deze handeling.";
    case "capability_denied":
      return "Je mist het recht om tenant-gebruikers te beheren (platform.tenants.manage).";
    case "audit_unavailable":
      return "Auditlog tijdelijk niet beschikbaar — handeling geblokkeerd (fail-closed).";
    default:
      return "Handeling geweigerd.";
  }
}

function naarFout(e: unknown, waar: string): GebruikersResultaat {
  if (e instanceof PlatformError) {
    return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
  }
  console.error(`[P3B] onverwachte fout bij ${waar}:`, e);
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
}

/** Herkent het "e-mail bestaat al"-signaal van de Auth Admin API robuust over
 *  versies heen (code én boodschap). Nooit stil koppelen aan een bestaand
 *  account (FR-5): expliciet weigeren. */
function isEmailBestaat(code: string | undefined, boodschap: string): boolean {
  if (code === "email_exists" || code === "user_already_exists") return true;
  const b = boodschap.toLowerCase();
  return b.includes("already been registered") || b.includes("already registered") || b.includes("already exists");
}

// ── 1. AANMAKEN ───────────────────────────────────────────────────────────────
export async function gebruikerAanmaken(input: {
  fondsId: string;
  email: string;
  naam: string;
  rol: string;
  wachtwoord: string;
  reden?: string | null;
}): Promise<GebruikersResultaat> {
  const reden = (input.reden ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const naam = (input.naam ?? "").trim();
  const wachtwoord = input.wachtwoord ?? "";

  // Vroege, PURE validatie (geen DB, geen wachtwoordwaarde — alleen de lengte).
  const basis = valideerAanmaakBasis({
    fondsId: input.fondsId,
    email,
    naam,
    rol: input.rol,
    reden,
    wachtwoordLengte: wachtwoord.length,
  });
  if (!basis.ok) return basis;
  const rol = input.rol as TenantRol; // door valideerAanmaakBasis afgedekt

  try {
    return await withPlatform<GebruikersResultaat>(
      {
        capability: CAP,
        handeling: "platform.tenant.user.create",
        doelFondsId: input.fondsId,
        doelObject: emailHashDoel(email),
        reden,
      },
      async (svc: SupabaseClient, _ctx) => {
        // Fonds MOET expliciet bestaan (R1-discipline, 0044). Geen limit 1/default.
        const { data: fonds } = await svc
          .from("fondsen")
          .select("id, naam, slug")
          .eq("id", input.fondsId)
          .maybeSingle();
        if (!fonds) {
          return {
            resultaat: { ok: false, foutcode: "fonds_onbekend", melding: "Gekozen fonds bestaat niet." },
            effect: { afgewezen: "fonds_onbekend", fonds_id: input.fondsId },
          };
        }

        // createUser: metadata ZONDER rol (B-4). email_confirm:true → geen SMTP.
        // Het wachtwoord gaat UITSLUITEND hierheen; nooit naar log/effect/melding.
        //
        // WP1 (17-08-2026): het fonds gaat naar `app_metadata`, niet naar
        // `user_metadata`. `maak_profiel()` leest sindsdien uitsluitend
        // `raw_app_meta_data->>'fonds_id'`. Dat is geen cosmetische verhuizing:
        // `user_metadata` is het veld dat een client zelf vult via
        // `supabase.auth.signUp({ options: { data } })` met de publieke anon-key,
        // en de trigger kon dat pad niet onderscheiden van dít pad. `app_metadata`
        // is alleen via de service-role te zetten — dus alleen hier, achter
        // capability `platform.tenants.manage` + live AAL2 + twee-fasen-audit.
        //
        // Supabase GoTrue kan app_metadata bij createUser() pas in de volgende
        // service-role-update vastleggen. De databaseprovisioningtrigger is
        // daarop ingericht; de expliciete update hieronder is daarom vereist.
        // `naam` blijft in user_metadata: presentatie, geen privilege.
        const { data: aangemaakt, error: maakFout } = await svc.auth.admin.createUser({
          email,
          password: wachtwoord,
          email_confirm: true,
          user_metadata: { naam },
          app_metadata: { fonds_id: input.fondsId },
        });

        if (maakFout) {
          const boodschap = maakFout.message ?? "";
          const code = (maakFout as { code?: string }).code;
          if (isEmailBestaat(code, boodschap)) {
            return {
              resultaat: {
                ok: false,
                foutcode: "email_bestaat",
                melding: "Dit e-mailadres heeft al een account. Er wordt bewust niet gekoppeld aan een bestaand account.",
              },
              effect: { afgewezen: "email_bestaat" },
            };
          }
          // Backstop: de fail-closed maak_profiel-trigger (ongeldig/onbekend
          // fonds) rolt de auth.users-mutatie terug → geen half account.
          console.error("[P3B] createUser mislukt:", boodschap);
          return {
            resultaat: { ok: false, foutcode: "aanmaak_mislukt", melding: "Aanmaken geweigerd. Controleer de invoer en het fonds." },
            effect: { afgewezen: "aanmaak_mislukt", db_fout: boodschap },
          };
        }

        const nieuweId = aangemaakt?.user?.id;
        if (!nieuweId) {
          return {
            resultaat: { ok: false, foutcode: "aanmaak_mislukt", melding: "Aanmaken mislukte onverwacht." },
            effect: { afgewezen: "geen_user_id" },
          };
        }

        // createUser() accepteert app_metadata in het HTTP-contract, maar
        // GoTrue maakt die waarde niet betrouwbaar zichtbaar aan de
        // auth.users-inserttrigger. updateUserById is het ondersteunde
        // service-rolepad waarop `bij_app_metadata` het profiel aanmaakt.
        const { error: metadataFout } = await svc.auth.admin.updateUserById(nieuweId, {
          app_metadata: {
            ...(aangemaakt?.user?.app_metadata ?? {}),
            fonds_id: input.fondsId,
          },
        });
        if (metadataFout) {
          await svc.auth.admin.deleteUser(nieuweId);
          console.error("[P3B] app-metadata bijwerken mislukt:", metadataFout.message);
          return {
            resultaat: { ok: false, foutcode: "aanmaak_mislukt", melding: "Aanmaken geweigerd. Controleer de invoer en het fonds." },
            effect: { afgewezen: "app_metadata_mislukt" },
          };
        }

        const { data: profiel, error: profielFout } = await svc
          .from("profielen")
          .select("id, fonds_id")
          .eq("id", nieuweId)
          .maybeSingle();
        if (profielFout || !profiel || profiel.fonds_id !== input.fondsId) {
          await svc.auth.admin.deleteUser(nieuweId);
          console.error(
            "[P3B] profielprovisioning na app-metadata-update mislukt:",
            profielFout?.message ?? "profiel ontbreekt of fonds wijkt af",
          );
          return {
            resultaat: { ok: false, foutcode: "aanmaak_mislukt", melding: "Aanmaken geweigerd. Controleer de invoer en het fonds." },
            effect: { afgewezen: "profielprovisioning_mislukt" },
          };
        }

        // Rol zetten alléén als hij afwijkt van de default 'bestuurder' (B-4).
        // Service-role → de bevriezing-trigger raakt dit niet. Scope op fonds =
        // defense in depth (nooit een profiel van een ander fonds raken).
        // NB sinds T1 is 'bestuursbureau' geen HOGERE rol maar een zijtak; het
        // loopt langs hetzelfde pad omdat het simpelweg ≠ de default is.
        let rolGezet = true;
        let rolFout: string | null = null;
        if (rol !== "bestuurder") {
          const { error: rolErr } = await svc
            .from("profielen")
            .update({ rol })
            .eq("id", nieuweId)
            .eq("fonds_id", input.fondsId);
          if (rolErr) {
            rolGezet = false;
            rolFout = rolErr.message;
            console.error("[P3B] rol zetten mislukt:", rolErr.message);
          }
        }

        revalidatePath(LIJST_PAD);
        const fondsRow = fonds as { naam: string };
        if (!rolGezet) {
          return {
            resultaat: {
              ok: true,
              bericht: `Gebruiker aangemaakt in ${fondsRow.naam} als 'bestuurder'. Rol '${rol}' kon niet worden gezet — pas de rol handmatig aan.`,
            },
            effect: { aangemaakt_id: nieuweId, fonds_id: input.fondsId, rol_gevraagd: rol, rol_gezet: false, rol_fout: rolFout, wachtwoord_gezet: true },
          };
        }
        return {
          resultaat: { ok: true, bericht: `Gebruiker aangemaakt in ${fondsRow.naam} met rol '${rol}'.` },
          effect: { aangemaakt_id: nieuweId, fonds_id: input.fondsId, rol, rol_gezet: true, wachtwoord_gezet: true },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "aanmaken");
  }
}

// ── 2. ROL WIJZIGEN ─────────────────────────────────────────────────────────
export async function rolWijzigen(input: {
  userId: string;
  fondsId: string;
  rol: string;
  reden?: string | null;
}): Promise<GebruikersResultaat> {
  const reden = (input.reden ?? "").trim();
  if (!reden) return { ok: false, foutcode: "reden_verplicht", melding: "Reden is verplicht bij het wijzigen van een rol." };
  if (!input.userId || !input.fondsId) return { ok: false, foutcode: "invoer_onvolledig", melding: "Gebruiker en fonds zijn verplicht." };
  if (!isTenantRol(input.rol)) return { ok: false, foutcode: "ongeldige_rol", melding: "Onbekende rol." };
  const rol = input.rol;

  try {
    return await withPlatform<GebruikersResultaat>(
      {
        capability: CAP,
        handeling: "platform.tenant.user.role",
        doelFondsId: input.fondsId,
        doelObject: `user:${input.userId}`,
        reden,
      },
      async (svc: SupabaseClient, _ctx) => {
        // Scope op (id, fonds_id): een gebruiker van een ANDER fonds raak je nooit.
        const { data: bijgewerkt, error } = await svc
          .from("profielen")
          .update({ rol })
          .eq("id", input.userId)
          .eq("fonds_id", input.fondsId)
          .select("id");
        if (error) {
          // Ongeldige rolwaarde faalt hier op de profielen.rol-CHECK (P3B-4).
          console.error("[P3B] rolwijziging mislukt:", error.message);
          return {
            resultaat: { ok: false, foutcode: "update_mislukt", melding: "Rol wijzigen geweigerd door de database." },
            effect: { afgewezen: "update_mislukt", fout: error.message },
          };
        }
        if (!bijgewerkt || bijgewerkt.length === 0) {
          return {
            resultaat: { ok: false, foutcode: "geen_gebruiker", melding: "Gebruiker niet gevonden in dit fonds." },
            effect: { afgewezen: "geen_gebruiker", user: input.userId, fonds_id: input.fondsId },
          };
        }
        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, bericht: `Rol gewijzigd naar '${rol}'.` },
          effect: { user: input.userId, fonds_id: input.fondsId, rol },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "rolWijzigen");
  }
}

// ── 3. (DE)BLOKKEREN ──────────────────────────────────────────────────────────
async function zetBlokkade(
  input: { userId: string; fondsId: string; reden?: string | null },
  blokkeren: boolean
): Promise<GebruikersResultaat> {
  const reden = (input.reden ?? "").trim();
  if (!reden) return { ok: false, foutcode: "reden_verplicht", melding: "Reden is verplicht bij het (de)blokkeren van een gebruiker." };
  if (!input.userId || !input.fondsId) return { ok: false, foutcode: "invoer_onvolledig", melding: "Gebruiker en fonds zijn verplicht." };

  try {
    return await withPlatform<GebruikersResultaat>(
      {
        capability: CAP,
        handeling: blokkeren ? "platform.tenant.user.block" : "platform.tenant.user.unblock",
        doelFondsId: input.fondsId,
        doelObject: `user:${input.userId}`,
        reden,
      },
      async (svc: SupabaseClient, _ctx) => {
        // Bevestig dat de gebruiker in DIT fonds zit vóór een auth-mutatie
        // (voorkomt cross-tenant-blokkade via een vreemde id).
        const { data: profiel } = await svc
          .from("profielen")
          .select("id")
          .eq("id", input.userId)
          .eq("fonds_id", input.fondsId)
          .maybeSingle();
        if (!profiel) {
          return {
            resultaat: { ok: false, foutcode: "geen_gebruiker", melding: "Gebruiker niet gevonden in dit fonds." },
            effect: { afgewezen: "geen_gebruiker", user: input.userId, fonds_id: input.fondsId },
          };
        }

        // B-5: ban_duration i.p.v. hard delete. "876000h" ≈ 100 jaar; "none" heft op.
        const { error } = await svc.auth.admin.updateUserById(input.userId, {
          ban_duration: blokkeren ? "876000h" : "none",
        });
        if (error) {
          console.error("[P3B] (de)blokkeren mislukt:", error.message);
          return {
            resultaat: { ok: false, foutcode: "ban_mislukt", melding: "(De)blokkeren geweigerd door de auth-provider." },
            effect: { afgewezen: "ban_mislukt", fout: error.message },
          };
        }
        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, bericht: blokkeren ? "Gebruiker geblokkeerd." : "Gebruiker gedeblokkeerd." },
          effect: { user: input.userId, fonds_id: input.fondsId, geblokkeerd: blokkeren },
        };
      }
    );
  } catch (e) {
    return naarFout(e, blokkeren ? "blokkeren" : "deblokkeren");
  }
}

export async function gebruikerBlokkeren(input: { userId: string; fondsId: string; reden?: string | null }): Promise<GebruikersResultaat> {
  return zetBlokkade(input, true);
}

export async function gebruikerDeblokkeren(input: { userId: string; fondsId: string; reden?: string | null }): Promise<GebruikersResultaat> {
  return zetBlokkade(input, false);
}
