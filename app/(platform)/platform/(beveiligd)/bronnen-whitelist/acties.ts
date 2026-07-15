"use server";

// ============================================================================
//  Server-actions — Bronnen-whitelist (Scenario A live web-retrieval, 0072).
// ----------------------------------------------------------------------------
//  Beheert de PLATFORMBREDE whitelist van gezaghebbende domeinen (fonds_id-loos)
//  die de live web-retrieval begrenst. Alle handelingen achter withPlatform
//  (capability platform.config.manage + twee-fasen-audit in platform_event_log).
//  platform.config.manage is bewust NIET-zwaar (geen afgedwongen vier-ogen —
//  besluit Merlin/0072); compenserende controls: harde domeinvalidatie, look-
//  alike-waarschuwing, append-only bron_whitelist_log én een geregistreerde
//  notificatie aan de overige beheerders (in-app wijzigingslog).
//
//  Lees- én schrijfkant lopen via de service-role: de whitelist-tabel geeft de
//  anon+RLS-client alleen ACTIEVE entries; het beheerscherm heeft ook de
//  inactieve/in_review-entries nodig. Elke lees-/schrijfhandeling wordt daarom
//  geaudit (audit-on-audit; consistent met de platform-doctrine).
// ============================================================================

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";
import {
  isGeldigDomein,
  detecteerLookAlike,
  normaliseerDomein,
  type WhitelistEntry,
} from "@/core/lib/web-whitelist";
import { isGeldigNormgewicht } from "@/core/lib/bronsoort";

const CAP = "platform.config.manage" as const;
const LIJST_PAD = "/platform/bronnen-whitelist";

const MATCHTYPES = ["domein", "domein_subdomeinen", "padprefix"] as const;
const STATUSSEN = ["actief", "inactief", "in_review"] as const;
const MAX_TOELICHTING = 1000;

export interface WhitelistLogRegel {
  id: string;
  whitelist_id: string | null;
  domein_snapshot: string | null;
  handeling: string;
  gewijzigd_door: string | null;
  reden: string | null;
  tijdstip: string;
}

export type WhitelistData = {
  entries: WhitelistEntry[];
  log: WhitelistLogRegel[];
};

export type WhitelistResultaat =
  | { ok: true; id?: string; bericht: string; genotificeerd?: number }
  | {
      ok: false;
      foutcode: string;
      melding: string;
      veldfouten?: Record<string, string>;
      /** Bij een look-alike-waarschuwing: bevestig en verstuur opnieuw met bevestigLookAlike=true. */
      waarschuwing?: { lijktOp: string };
    };

// ── Hulp ─────────────────────────────────────────────────────────────────────
function platformMelding(foutcode: string): string {
  switch (foutcode) {
    case "no_session_or_inactive":
      return "Geen geldige platform-sessie. Log opnieuw in.";
    case "mfa_required":
      return "Sterke authenticatie (MFA) vereist voor deze handeling.";
    case "capability_denied":
      return "Je mist de rechten om de bronnen-whitelist te beheren (platform.config.manage).";
    case "audit_unavailable":
      return "Auditlog tijdelijk niet beschikbaar — handeling geblokkeerd (fail-closed).";
    default:
      return "Handeling geweigerd.";
  }
}

function naarFout(e: unknown, waar: string): WhitelistResultaat {
  if (e instanceof PlatformError) {
    return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
  }
  console.error(`[0072] onverwachte fout bij ${waar}:`, e);
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
}

/** Append-only domeinlog-regel schrijven (naast platform_event_log). */
async function logWhitelist(
  svc: SupabaseClient,
  identiteitId: string,
  regel: {
    whitelist_id: string | null;
    domein_snapshot: string | null;
    handeling: string;
    oud?: unknown;
    nieuw?: unknown;
    reden?: string | null;
  }
): Promise<void> {
  await svc.from("bron_whitelist_log").insert({
    whitelist_id: regel.whitelist_id,
    domein_snapshot: regel.domein_snapshot,
    handeling: regel.handeling,
    gewijzigd_door: identiteitId,
    oud: regel.oud ?? null,
    nieuw: regel.nieuw ?? null,
    reden: regel.reden ?? null,
  });
}

/** Aantal ANDERE actieve beheerders met platform.config.manage (compenserende
 *  control: notificatie aan de overige beheerders bij een (de)activatie). */
async function overigeBeheerders(svc: SupabaseClient, identiteitId: string): Promise<number> {
  const { data } = await svc
    .from("platform_identity_capabilities")
    .select("identity_id")
    .eq("capability", CAP)
    .is("ingetrokken_op", null)
    .neq("identity_id", identiteitId);
  const uniek = new Set((data ?? []).map((r) => String(r.identity_id)));
  return uniek.size;
}

// ── 0. LEZEN (alle entries + recent wijzigingslog) ──────────────────────────
export async function whitelistData(): Promise<WhitelistData> {
  try {
    return await withPlatform<WhitelistData>(
      { capability: CAP, handeling: "platform.config.whitelist.read" },
      async (svc: SupabaseClient) => {
        const [{ data: entries }, { data: log }] = await Promise.all([
          svc
            .from("bron_whitelist")
            .select("id, domein, matchtype, pad, normgewicht, categorie, tier, status, toelichting, review_datum, toegevoegd_op, gewijzigd_op")
            .order("tier", { ascending: true })
            .order("domein", { ascending: true }),
          svc
            .from("bron_whitelist_log")
            .select("id, whitelist_id, domein_snapshot, handeling, gewijzigd_door, reden, tijdstip")
            .order("tijdstip", { ascending: false })
            .limit(15),
        ]);
        return {
          resultaat: {
            entries: (entries ?? []) as unknown as WhitelistEntry[],
            log: (log ?? []) as WhitelistLogRegel[],
          },
          effect: { aantal_entries: (entries ?? []).length },
        };
      }
    );
  } catch {
    // Fail-safe voor de pagina: bij geweigerd/fout een lege set (de pagina toont
    // dan de "geen toegang"-melding op basis van de capability).
    return { entries: [], log: [] };
  }
}

// ── Validatie (gedeeld door aanmaken/bijwerken) ─────────────────────────────
interface WhitelistInput {
  domein?: string | null;
  matchtype?: string | null;
  pad?: string | null;
  normgewicht?: string | null;
  categorie?: string | null;
  tier?: string | null;
  toelichting?: string | null;
  review_datum?: string | null;
}

function valideer(
  input: WhitelistInput,
  vertrouwdeDomeinen: string[],
  bevestigLookAlike: boolean
):
  | { ok: true; waarde: Record<string, unknown>; waarschuwing?: { lijktOp: string } }
  | { ok: false; veldfouten: Record<string, string>; waarschuwing?: { lijktOp: string } } {
  const veldfouten: Record<string, string> = {};

  const domein = normaliseerDomein((input.domein ?? "").trim());
  if (!domein) veldfouten.domein = "Domein is verplicht.";
  else if (!isGeldigDomein(domein)) veldfouten.domein = "Ongeldig domeinformaat (alleen bv. dnb.nl of toezicht.dnb.nl).";

  const matchtype = (input.matchtype ?? "domein").trim();
  if (!(MATCHTYPES as readonly string[]).includes(matchtype)) veldfouten.matchtype = "Ongeldig matchtype.";

  let pad: string | null = null;
  if (matchtype === "padprefix") {
    pad = (input.pad ?? "").trim();
    if (!pad) veldfouten.pad = "Een padprefix-entry vereist een pad (bv. /pensioen).";
    else if (!pad.startsWith("/")) pad = "/" + pad;
  }

  const normgewicht = (input.normgewicht ?? "").trim();
  if (!normgewicht) veldfouten.normgewicht = "Normgewicht is verplicht.";
  else if (!isGeldigNormgewicht(normgewicht)) veldfouten.normgewicht = "Ongeldig normgewicht.";

  const toelichting = (input.toelichting ?? "").trim();
  if (!toelichting) veldfouten.toelichting = "Toelichting (reden gezaghebbend) is verplicht.";
  else if (toelichting.length > MAX_TOELICHTING) veldfouten.toelichting = `Maximaal ${MAX_TOELICHTING} tekens.`;

  if (Object.keys(veldfouten).length > 0) return { ok: false, veldfouten };

  // Look-alike-waarschuwing (compenserende control): harde validatie is al
  // geslaagd; deze waarschuwing blokkeert alleen tot de beheerder bevestigt.
  const look = detecteerLookAlike(domein, vertrouwdeDomeinen);
  if (look.verdacht && look.lijktOp && !bevestigLookAlike) {
    return { ok: false, veldfouten: {}, waarschuwing: { lijktOp: look.lijktOp } };
  }

  return {
    ok: true,
    waarde: {
      domein,
      matchtype,
      pad,
      normgewicht,
      categorie: (input.categorie ?? "").trim() || null,
      tier: (input.tier ?? "").trim() || null,
      toelichting,
      review_datum: (input.review_datum ?? "").trim() || null,
    },
    waarschuwing: look.verdacht && look.lijktOp ? { lijktOp: look.lijktOp } : undefined,
  };
}

async function vertrouwdeActieveDomeinen(svc: SupabaseClient, exclId?: string): Promise<string[]> {
  const q = svc.from("bron_whitelist").select("id, domein").eq("status", "actief");
  const { data } = await q;
  return (data ?? [])
    .filter((r) => !exclId || String(r.id) !== exclId)
    .map((r) => String(r.domein));
}

// ── 1. AANMAKEN ─────────────────────────────────────────────────────────────
export async function whitelistAanmaken(
  input: WhitelistInput & { bevestigLookAlike?: boolean }
): Promise<WhitelistResultaat> {
  try {
    return await withPlatform<WhitelistResultaat>(
      { capability: CAP, handeling: "platform.config.whitelist.create", doelObject: normaliseerDomein(input.domein ?? "") },
      async (svc, { identiteit }) => {
        const vertrouwd = await vertrouwdeActieveDomeinen(svc);
        const v = valideer(input, vertrouwd, input.bevestigLookAlike === true);
        if (!v.ok) {
          if (v.waarschuwing) {
            return {
              resultaat: { ok: false, foutcode: "lookalike", melding: `Let op: dit domein lijkt op ${v.waarschuwing.lijktOp}. Controleer en bevestig om toch toe te voegen.`, waarschuwing: v.waarschuwing },
              effect: { afgewezen: "lookalike", lijkt_op: v.waarschuwing.lijktOp },
            };
          }
          return {
            resultaat: { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten: v.veldfouten },
            effect: { afgewezen: "validatie" },
          };
        }

        // Nieuwe entries starten in 'in_review' (human-in-the-loop op activatie);
        // de beheerder activeert bewust via de status-actie.
        const rij = { ...v.waarde, status: "in_review", toegevoegd_door: identiteit.id, gewijzigd_door: identiteit.id };
        const { data, error } = await svc.from("bron_whitelist").insert(rij).select("id").single();
        if (error || !data) {
          if (error?.code === "23505") {
            return {
              resultaat: { ok: false, foutcode: "duplicaat", melding: "Deze combinatie van domein/matchtype/pad bestaat al.", veldfouten: { domein: "Bestaat al." } },
              effect: { afgewezen: "duplicaat", domein: v.waarde.domein },
            };
          }
          return {
            resultaat: { ok: false, foutcode: "insert_mislukt", melding: "Toevoegen geweigerd door de database." },
            effect: { afgewezen: "insert_mislukt", fout: error?.message },
          };
        }

        await logWhitelist(svc, identiteit.id, {
          whitelist_id: data.id as string,
          domein_snapshot: v.waarde.domein as string,
          handeling: "aanmaken",
          nieuw: v.waarde,
        });
        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, id: data.id as string, bericht: "Bron toegevoegd (status: in review). Activeer om live te zetten." },
          effect: { id: data.id, domein: v.waarde.domein, normgewicht: v.waarde.normgewicht },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "aanmaken");
  }
}

// ── 2. BIJWERKEN ────────────────────────────────────────────────────────────
export async function whitelistBijwerken(
  input: WhitelistInput & { id: string; reden?: string | null; bevestigLookAlike?: boolean }
): Promise<WhitelistResultaat> {
  try {
    return await withPlatform<WhitelistResultaat>(
      { capability: CAP, handeling: "platform.config.whitelist.update", doelObject: input.id, reden: input.reden?.trim() || null },
      async (svc, { identiteit }) => {
        const { data: huidig } = await svc.from("bron_whitelist").select("*").eq("id", input.id).maybeSingle();
        if (!huidig) {
          return { resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Bron niet gevonden." }, effect: { afgewezen: "niet_gevonden" } };
        }
        const vertrouwd = await vertrouwdeActieveDomeinen(svc, input.id);
        const v = valideer(input, vertrouwd, input.bevestigLookAlike === true);
        if (!v.ok) {
          if (v.waarschuwing) {
            return {
              resultaat: { ok: false, foutcode: "lookalike", melding: `Let op: dit domein lijkt op ${v.waarschuwing.lijktOp}. Controleer en bevestig om op te slaan.`, waarschuwing: v.waarschuwing },
              effect: { afgewezen: "lookalike", lijkt_op: v.waarschuwing.lijktOp },
            };
          }
          return { resultaat: { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten: v.veldfouten }, effect: { afgewezen: "validatie" } };
        }

        const update = { ...v.waarde, gewijzigd_door: identiteit.id, gewijzigd_op: new Date().toISOString() };
        const { error } = await svc.from("bron_whitelist").update(update).eq("id", input.id);
        if (error) {
          if (error.code === "23505") {
            return { resultaat: { ok: false, foutcode: "duplicaat", melding: "Deze combinatie bestaat al.", veldfouten: { domein: "Bestaat al." } }, effect: { afgewezen: "duplicaat" } };
          }
          return { resultaat: { ok: false, foutcode: "update_mislukt", melding: "Bijwerken geweigerd door de database." }, effect: { afgewezen: "update_mislukt", fout: error.message } };
        }

        await logWhitelist(svc, identiteit.id, {
          whitelist_id: input.id,
          domein_snapshot: v.waarde.domein as string,
          handeling: "bijwerken",
          oud: huidig,
          nieuw: v.waarde,
          reden: input.reden?.trim() || null,
        });
        revalidatePath(LIJST_PAD);
        return { resultaat: { ok: true, id: input.id, bericht: "Bron bijgewerkt." }, effect: { id: input.id, domein: v.waarde.domein } };
      }
    );
  } catch (e) {
    return naarFout(e, "bijwerken");
  }
}

// ── 3. STATUS (activeren / deactiveren / terug naar in_review) ──────────────
export async function whitelistStatus(
  input: { id: string; status: string; reden?: string | null }
): Promise<WhitelistResultaat> {
  if (!(STATUSSEN as readonly string[]).includes(input.status)) {
    return { ok: false, foutcode: "ongeldige_status", melding: "Onbekende status." };
  }
  try {
    return await withPlatform<WhitelistResultaat>(
      { capability: CAP, handeling: "platform.config.whitelist.set_status", doelObject: input.id, reden: input.reden?.trim() || null, verwachteScope: { status: input.status } },
      async (svc, { identiteit }) => {
        const { data: huidig } = await svc.from("bron_whitelist").select("id, domein, status").eq("id", input.id).maybeSingle();
        const rij = huidig as { id: string; domein: string; status: string } | null;
        if (!rij) {
          return { resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Bron niet gevonden." }, effect: { afgewezen: "niet_gevonden" } };
        }
        if (rij.status === input.status) {
          return { resultaat: { ok: true, id: input.id, bericht: `Status was al '${input.status}'.` }, effect: { reeds: true } };
        }

        const { error } = await svc
          .from("bron_whitelist")
          .update({ status: input.status, gewijzigd_door: identiteit.id, gewijzigd_op: new Date().toISOString() })
          .eq("id", input.id);
        if (error) {
          return { resultaat: { ok: false, foutcode: "update_mislukt", melding: "Statuswijziging geweigerd door de database." }, effect: { afgewezen: "update_mislukt", fout: error.message } };
        }

        const handeling = input.status === "actief" ? "activeren" : input.status === "inactief" ? "deactiveren" : "in_review";
        await logWhitelist(svc, identiteit.id, {
          whitelist_id: input.id,
          domein_snapshot: rij.domein,
          handeling,
          oud: { status: rij.status },
          nieuw: { status: input.status },
          reden: input.reden?.trim() || null,
        });

        // Compenserende control (AC-B3): notificeer de overige beheerders. In-app
        // kanaal = het wijzigingslog op dit scherm; hier registreren we het aantal.
        const genotificeerd = await overigeBeheerders(svc, identiteit.id);

        revalidatePath(LIJST_PAD);
        return {
          resultaat: {
            ok: true,
            id: input.id,
            bericht: input.status === "actief" ? "Bron geactiveerd (direct live in retrieval)." : input.status === "inactief" ? "Bron gedeactiveerd (uit retrieval; historie blijft)." : "Bron teruggezet naar in review.",
            genotificeerd,
          },
          effect: { id: input.id, domein: rij.domein, status: { oud: rij.status, nieuw: input.status }, genotificeerd },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "status");
  }
}
