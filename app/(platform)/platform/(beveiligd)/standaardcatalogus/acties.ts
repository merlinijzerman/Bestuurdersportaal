"use server";

// ============================================================================
//  Server-actions — Generieke beheerconfiguratie / standaardcatalogus
//  (Increment P2/B14, FO §9 Platform-beheermodule).
// ----------------------------------------------------------------------------
//  Beheert de PLATFORMBREDE standaardcatalogus (templates, fonds_id = NULL) voor
//  de drie organen-catalogi die de profielkeuzelijsten voeden:
//    • gremia (incl. commissies — type 'adviserend')
//    • expertises
//    • kritische_focusgebieden
//
//  Drie handelingen, ALLE achter withPlatform (capability platform.config.manage
//  + twee-fasen-audit in platform_event_log):
//    • catalogusTemplateAanmaken   — nieuw template (fonds_id NULL).
//    • catalogusTemplateBijwerken  — naam/type/omschrijving wijzigen (diff-geaudit).
//    • catalogusTemplateActief     — (de)activeren; inactieve templates komen niet
//                                    meer mee bij NIEUWE fonds-imports.
//
//  Bewust GEEN schrijfpad via de anon-RLS-client: de "schrijf"-policies op deze
//  tabellen staan alleen eigen-fonds toe (fonds_id NULL = template is voor de
//  anon-key deny-by-default). Templatebeheer loopt daarom uitsluitend via de
//  service-role ACHTER deze capability+audit-wrapper (FO §4.1, §5.2).
//
//  Change control (FO §9.2): elke wijziging draagt een VERPLICHTE reden en is via
//  het append-only platform_event_log herleidbaar (oud → nieuw → bereik → reden →
//  identiteit) en daarmee terugdraaibaar. "Geen stille overschrijving" van fonds-
//  specifieke kopieën is structureel geborgd: deze acties raken UITSLUITEND
//  templaterijen (fonds_id NULL); fonds-kopieën (gekopieerd_van_id) blijven
//  ongemoeid en worden alleen via de bestaande, idempotente import (O1) bijgewerkt.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";

const CAP = "platform.config.manage" as const;
const LIJST_PAD = "/platform/standaardcatalogus";

// De drie organen-catalogi die de profielkeuzelijsten voeden. Procesmodellen
// vallen hier bewust BUITEN (geen profielveld; eigen seed-pad in code).
export type CatalogusTabel = "gremia" | "expertises" | "kritische_focusgebieden";

const TOEGESTANE_TABELLEN: ReadonlySet<string> = new Set<CatalogusTabel>([
  "gremia",
  "expertises",
  "kritische_focusgebieden",
]);

// Alleen 'gremia' kent een type (incl. de commissie-categorie 'adviserend').
const GREMIA_TYPES = ["besluitvormend", "adviserend", "toezichthoudend", "uitvoerend"] as const;
type GremiumType = (typeof GREMIA_TYPES)[number];

// Categorie-indeling (A/B/C) — orthogonaal aan het functionele type.
const GREMIA_CATEGORIEEN = ["fondsorgaan", "bestuurscommissie", "extern_ketenpartner"] as const;
type GremiumCategorie = (typeof GREMIA_CATEGORIEEN)[number];

const TABEL_LABEL: Record<CatalogusTabel, string> = {
  gremia: "gremia/commissies",
  expertises: "expertises",
  kritische_focusgebieden: "kritische focusgebieden",
};

const MAX_NAAM = 160;
const MAX_OMSCHRIJVING = 1000;

export type CatalogusResultaat =
  | { ok: true; templateId: string; bericht: string }
  | { ok: false; foutcode: string; melding: string; veldfouten?: Record<string, string> };

// ── Hulp ─────────────────────────────────────────────────────────────────────
function platformMelding(foutcode: string): string {
  switch (foutcode) {
    case "no_session_or_inactive":
      return "Geen geldige platform-sessie. Log opnieuw in.";
    case "mfa_required":
      return "Sterke authenticatie (MFA) vereist voor deze handeling.";
    case "capability_denied":
      return "Je mist de rechten om de generieke beheerconfiguratie te beheren (platform.config.manage).";
    case "audit_unavailable":
      return "Auditlog tijdelijk niet beschikbaar — handeling geblokkeerd (fail-closed).";
    default:
      return "Handeling geweigerd.";
  }
}

function naarFout(e: unknown, waar: string): CatalogusResultaat {
  if (e instanceof PlatformError) {
    return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
  }
  console.error(`[P2] onverwachte fout bij ${waar}:`, e);
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
}

function valideerTabel(tabel: string): tabel is CatalogusTabel {
  return TOEGESTANE_TABELLEN.has(tabel);
}

/** Normaliseert/valideert de gedeelde velden. type alleen relevant voor gremia. */
function valideerVelden(
  tabel: CatalogusTabel,
  input: { naam?: string | null; type?: string | null; categorie?: string | null; omschrijving?: string | null },
  naamVerplicht: boolean
): { ok: true; waarde: { naam?: string; type?: GremiumType | null; categorie?: GremiumCategorie | null; omschrijving?: string | null } } | { ok: false; veldfouten: Record<string, string> } {
  const veldfouten: Record<string, string> = {};
  const waarde: { naam?: string; type?: GremiumType | null; categorie?: GremiumCategorie | null; omschrijving?: string | null } = {};

  // naam
  if (input.naam !== undefined) {
    const naam = (input.naam ?? "").trim();
    if (!naam) {
      if (naamVerplicht) veldfouten.naam = "Naam is verplicht.";
    } else if (naam.length > MAX_NAAM) {
      veldfouten.naam = `Naam mag maximaal ${MAX_NAAM} tekens zijn.`;
    } else {
      waarde.naam = naam;
    }
  } else if (naamVerplicht) {
    veldfouten.naam = "Naam is verplicht.";
  }

  // type (alleen gremia)
  if (tabel === "gremia") {
    if (input.type !== undefined && input.type !== null) {
      const t = String(input.type);
      if (!(GREMIA_TYPES as readonly string[]).includes(t)) {
        veldfouten.type = "Ongeldig type.";
      } else {
        waarde.type = t as GremiumType;
      }
    } else if (naamVerplicht) {
      // Bij aanmaken: type verplicht voor gremia.
      veldfouten.type = "Kies een type (commissies vallen onder 'adviserend').";
    }

    // categorie (A/B/C) — alleen gremia.
    if (input.categorie !== undefined && input.categorie !== null) {
      const c = String(input.categorie);
      if (!(GREMIA_CATEGORIEEN as readonly string[]).includes(c)) {
        veldfouten.categorie = "Ongeldige categorie.";
      } else {
        waarde.categorie = c as GremiumCategorie;
      }
    } else if (naamVerplicht) {
      // Bij aanmaken: categorie verplicht voor gremia.
      veldfouten.categorie = "Kies een categorie (fondsorgaan / bestuurscommissie / externe ketenpartner).";
    }
  }

  // omschrijving (optioneel)
  if (input.omschrijving !== undefined) {
    const o = (input.omschrijving ?? "").trim();
    if (o.length > MAX_OMSCHRIJVING) {
      veldfouten.omschrijving = `Omschrijving mag maximaal ${MAX_OMSCHRIJVING} tekens zijn.`;
    } else {
      waarde.omschrijving = o || null;
    }
  }

  if (Object.keys(veldfouten).length > 0) return { ok: false, veldfouten };
  return { ok: true, waarde };
}

// ── 1. AANMAKEN ───────────────────────────────────────────────────────────────
export async function catalogusTemplateAanmaken(input: {
  tabel: string;
  naam: string;
  type?: string | null;
  categorie?: string | null;
  omschrijving?: string | null;
}): Promise<CatalogusResultaat> {
  if (!valideerTabel(input.tabel)) {
    return { ok: false, foutcode: "ongeldige_catalogus", melding: "Onbekende catalogus." };
  }
  const tabel = input.tabel;
  try {
    return await withPlatform<CatalogusResultaat>(
      {
        capability: CAP,
        handeling: "platform.config.catalog.template.create",
        doelObject: `${tabel}:template`,
      },
      async (svc: SupabaseClient) => {
        const v = valideerVelden(tabel, input, true);
        if (!v.ok) {
          return {
            resultaat: { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten: v.veldfouten },
            effect: { afgewezen: "validatie", catalogus: tabel },
          };
        }

        const rij: Record<string, unknown> = {
          fonds_id: null,
          naam: v.waarde.naam,
          omschrijving: v.waarde.omschrijving ?? null,
        };
        if (tabel === "gremia") {
          rij.type = v.waarde.type;
          rij.categorie = v.waarde.categorie;
        }

        const { data, error } = await svc.from(tabel).insert(rij).select("id").single();
        if (error || !data) {
          // Partiële unique-index op templatenaam (waar fonds_id is null).
          if (error?.code === "23505") {
            return {
              resultaat: { ok: false, foutcode: "duplicaat", melding: "Er bestaat al een standaarditem met deze naam.", veldfouten: { naam: "Naam bestaat al." } },
              effect: { afgewezen: "duplicaat", catalogus: tabel, naam: v.waarde.naam },
            };
          }
          console.error(`[P2] ${tabel} insert mislukt:`, error?.message);
          return {
            resultaat: { ok: false, foutcode: "insert_mislukt", melding: "Standaarditem kon niet worden aangemaakt." },
            effect: { afgewezen: "insert_mislukt", catalogus: tabel, fout: error?.message },
          };
        }

        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, templateId: data.id as string, bericht: `Standaarditem toegevoegd aan ${TABEL_LABEL[tabel]}.` },
          effect: { catalogus: tabel, template_id: data.id, naam: v.waarde.naam, type: v.waarde.type ?? null, categorie: v.waarde.categorie ?? null },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "aanmaken");
  }
}

// ── 2. BIJWERKEN (hernoemen / type / omschrijving) ──────────────────────────────
export async function catalogusTemplateBijwerken(input: {
  tabel: string;
  id: string;
  naam?: string | null;
  type?: string | null;
  categorie?: string | null;
  omschrijving?: string | null;
  reden?: string | null;
}): Promise<CatalogusResultaat> {
  if (!valideerTabel(input.tabel)) {
    return { ok: false, foutcode: "ongeldige_catalogus", melding: "Onbekende catalogus." };
  }
  const tabel = input.tabel;
  try {
    return await withPlatform<CatalogusResultaat>(
      {
        capability: CAP,
        handeling: "platform.config.catalog.template.update",
        doelObject: `${tabel}:${input.id}`,
        reden: input.reden?.trim() || null,
      },
      async (svc: SupabaseClient) => {
        const kolommen = tabel === "gremia" ? "id, naam, type, categorie, omschrijving, fonds_id" : "id, naam, omschrijving, fonds_id";
        const { data: huidig } = await svc.from(tabel).select(kolommen).eq("id", input.id).maybeSingle();
        const rij = huidig as { id: string; naam: string; type?: string | null; categorie?: string | null; omschrijving: string | null; fonds_id: string | null } | null;

        // Alleen templates (fonds_id NULL) zijn hier beheerbaar; fonds-kopieën nooit.
        if (!rij || rij.fonds_id !== null) {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Standaarditem niet gevonden." },
            effect: { afgewezen: "niet_gevonden", catalogus: tabel },
          };
        }

        const v = valideerVelden(tabel, input, false);
        if (!v.ok) {
          return {
            resultaat: { ok: false, foutcode: "validatie", melding: "Controleer de gemarkeerde velden.", veldfouten: v.veldfouten },
            effect: { afgewezen: "validatie", catalogus: tabel },
          };
        }

        // Diff opbouwen (alleen daadwerkelijk gewijzigde velden) t.b.v. een
        // herleidbaar oud→nieuw effect en een minimale update.
        const update: Record<string, unknown> = {};
        const diff: Record<string, { oud: unknown; nieuw: unknown }> = {};
        if (v.waarde.naam !== undefined && v.waarde.naam !== rij.naam) {
          update.naam = v.waarde.naam;
          diff.naam = { oud: rij.naam, nieuw: v.waarde.naam };
        }
        if (tabel === "gremia" && v.waarde.type !== undefined && v.waarde.type !== rij.type) {
          update.type = v.waarde.type;
          diff.type = { oud: rij.type ?? null, nieuw: v.waarde.type };
        }
        if (tabel === "gremia" && v.waarde.categorie !== undefined && v.waarde.categorie !== rij.categorie) {
          update.categorie = v.waarde.categorie;
          diff.categorie = { oud: rij.categorie ?? null, nieuw: v.waarde.categorie };
        }
        if (v.waarde.omschrijving !== undefined && (v.waarde.omschrijving ?? null) !== (rij.omschrijving ?? null)) {
          update.omschrijving = v.waarde.omschrijving ?? null;
          diff.omschrijving = { oud: rij.omschrijving ?? null, nieuw: v.waarde.omschrijving ?? null };
        }

        if (Object.keys(update).length === 0) {
          return {
            resultaat: { ok: true, templateId: input.id, bericht: "Geen wijzigingen." },
            effect: { catalogus: tabel, template_id: input.id, gewijzigde_velden: 0 },
          };
        }

        update.bijgewerkt = new Date().toISOString();
        const { error } = await svc.from(tabel).update(update).eq("id", input.id).is("fonds_id", null);
        if (error) {
          if (error.code === "23505") {
            return {
              resultaat: { ok: false, foutcode: "duplicaat", melding: "Er bestaat al een standaarditem met deze naam.", veldfouten: { naam: "Naam bestaat al." } },
              effect: { afgewezen: "duplicaat", catalogus: tabel },
            };
          }
          console.error(`[P2] ${tabel} update mislukt:`, error.message);
          return {
            resultaat: { ok: false, foutcode: "update_mislukt", melding: "Bijwerken geweigerd door de database." },
            effect: { afgewezen: "update_mislukt", catalogus: tabel, fout: error.message },
          };
        }

        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, templateId: input.id, bericht: `${Object.keys(diff).length} veld(en) bijgewerkt.` },
          effect: { catalogus: tabel, template_id: input.id, diff },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "bijwerken");
  }
}

// ── 3. (DE)ACTIVEREN ────────────────────────────────────────────────────────────
export async function catalogusTemplateActief(input: {
  tabel: string;
  id: string;
  actief: boolean;
  reden?: string | null;
}): Promise<CatalogusResultaat> {
  if (!valideerTabel(input.tabel)) {
    return { ok: false, foutcode: "ongeldige_catalogus", melding: "Onbekende catalogus." };
  }
  const tabel = input.tabel;
  try {
    return await withPlatform<CatalogusResultaat>(
      {
        capability: CAP,
        handeling: "platform.config.catalog.template.toggle_active",
        doelObject: `${tabel}:${input.id}`,
        reden: input.reden?.trim() || null,
      },
      async (svc: SupabaseClient) => {
        const { data: huidig } = await svc.from(tabel).select("id, naam, actief, fonds_id").eq("id", input.id).maybeSingle();
        const rij = huidig as { id: string; naam: string; actief: boolean; fonds_id: string | null } | null;
        if (!rij || rij.fonds_id !== null) {
          return {
            resultaat: { ok: false, foutcode: "niet_gevonden", melding: "Standaarditem niet gevonden." },
            effect: { afgewezen: "niet_gevonden", catalogus: tabel },
          };
        }
        if (rij.actief === input.actief) {
          return {
            resultaat: { ok: true, templateId: input.id, bericht: input.actief ? "Was al actief." : "Was al inactief." },
            effect: { catalogus: tabel, template_id: input.id, reeds: true },
          };
        }

        const { error } = await svc
          .from(tabel)
          .update({ actief: input.actief, bijgewerkt: new Date().toISOString() })
          .eq("id", input.id)
          .is("fonds_id", null);
        if (error) {
          console.error(`[P2] ${tabel} (de)activeren mislukt:`, error.message);
          return {
            resultaat: { ok: false, foutcode: "update_mislukt", melding: "Wijziging geweigerd door de database." },
            effect: { afgewezen: "update_mislukt", catalogus: tabel, fout: error.message },
          };
        }

        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, templateId: input.id, bericht: input.actief ? "Standaarditem geactiveerd." : "Standaarditem gedeactiveerd." },
          effect: { catalogus: tabel, template_id: input.id, naam: rij.naam, actief: { oud: rij.actief, nieuw: input.actief } },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "activeren");
  }
}
