// Kandidaten voor de kiezer-UI (#192): bestaande artefacten die aan een vereiste
// gekoppeld kunnen worden. Leest het brontype uit de sleutel, haalt de rijen uit
// de bijbehorende brontabel op de dossier-lokale scope, en geeft per kandidaat
// terug of hij al aan een (andere) vereiste hangt — dat laatste voedt de
// "Al gekoppeld aan: …"-regel en voorkomt een raadselachtige 409 bij het koppelen.
//
// Scope-als-data, gespiegeld op core/lib/requirement-bron.ts: één plek waar per
// type de titel-/datum-/actorkolom staat, zodat er geen tweede waarheid ontstaat.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requirementSleutel } from "./requirement-sleutel";
import type { RequirementType } from "./decision-view";
import { primairBesluitId } from "./vereiste-koppeling";

export interface Kandidaat {
  id: string;
  titel: string | null;
  datum: string | null;
  actor: string | null;
  /** De vereiste-label waaraan deze kandidaat al hangt, of null. */
  gebonden_aan: string | null;
  /** Extra context (bv. AI-validatiestatus); mag null zijn. */
  meta: string | null;
}

export type KandidatenResultaat =
  | { ok: true; type: RequirementType; kandidaten: Kandidaat[] }
  | { ok: false; status: number; fout: string };

interface KandidaatBron {
  brontabel: string;
  scope: "decision" | "procedure";
  titelKolom: string;
  datumKolom: string;
  actorKolom: string;
  /** 'naam' = tekstkolom met een naam; 'id' = uuid, via profielen resolven. */
  actorSoort: "naam" | "id";
  metaKolom?: string;
}

// Alleen de typen met een BESTAAND artefact dat je kiest. document/external_
// submission/consultation lopen via de bewijs-uploadroute (Opvoeren); dissent_
// review/mandate_check via het vaststellingsformulier; field kent geen feit.
const KANDIDAAT_BRON: Partial<Record<RequirementType, KandidaatBron>> = {
  approval: {
    brontabel: "procedure_besluiten", scope: "procedure",
    titelKolom: "formulering", datumKolom: "datum",
    actorKolom: "vastgelegd_door_naam", actorSoort: "naam",
  },
  risk: {
    brontabel: "decision_risks", scope: "decision",
    titelKolom: "beschrijving", datumKolom: "aangemaakt_op",
    actorKolom: "eigenaar_naam", actorSoort: "naam",
  },
  assumption: {
    brontabel: "decision_assumptions", scope: "decision",
    titelKolom: "tekst", datumKolom: "aangemaakt_op",
    actorKolom: "gewijzigd_door", actorSoort: "id",
  },
  kpi: {
    brontabel: "decision_conditions", scope: "decision",
    titelKolom: "kpi", datumKolom: "aangemaakt_op",
    actorKolom: "eigenaar_naam", actorSoort: "naam",
  },
  evaluation: {
    brontabel: "decision_evaluations", scope: "decision",
    titelKolom: "geplande_datum", datumKolom: "aangemaakt_op",
    actorKolom: "uitgevoerd_door", actorSoort: "id",
  },
  ai_validation: {
    brontabel: "decision_ai_interactions", scope: "decision",
    titelKolom: "gebruik_context", datumKolom: "gevalideerd_op",
    actorKolom: "gevalideerd_door", actorSoort: "id", metaKolom: "validatiestatus",
  },
};

/** Bouwt een sleutel→label-kaart voor de procedure (template-arm versie-gefilterd
 *  ∪ actieve instantie-arm), zodat `gebonden_aan` een leesbare vereiste-label kan
 *  tonen i.p.v. de kale sleutel. */
async function bouwSleutelLabelKaart(
  supabase: SupabaseClient,
  procedureId: string
): Promise<Map<string, string>> {
  const kaart = new Map<string, string>();
  const { data: proc } = await supabase
    .from("procedures")
    .select("template_code, template_versie")
    .eq("id", procedureId)
    .maybeSingle();
  if (!proc) return kaart;
  const p = proc as { template_code: string; template_versie: string | null };

  let tpl = supabase
    .from("procedure_requirements")
    .select("stap_volgorde, requirement_type, documenttype, label")
    .eq("template_code", p.template_code);
  if (p.template_versie) tpl = tpl.eq("template_versie", p.template_versie);
  const { data: tplRijen } = await tpl;
  for (const r of (tplRijen ?? []) as Array<{
    stap_volgorde: number; requirement_type: string; documenttype: string | null; label: string;
  }>) {
    kaart.set(
      requirementSleutel(r.stap_volgorde, r.requirement_type, r.documenttype, r.label),
      r.label
    );
  }

  const { data: decisions } = await supabase
    .from("decision_objects").select("id").eq("procedure_id", procedureId);
  const decisionIds = ((decisions ?? []) as Array<{ id: string }>).map((d) => d.id);
  if (decisionIds.length > 0) {
    const { data: instRijen } = await supabase
      .from("procedure_requirement_instance")
      .select("stap_volgorde, requirement_type, documenttype, label")
      .in("decision_id", decisionIds)
      .eq("actief", true);
    for (const r of (instRijen ?? []) as Array<{
      stap_volgorde: number; requirement_type: string; documenttype: string | null; label: string;
    }>) {
      kaart.set(
        requirementSleutel(r.stap_volgorde, r.requirement_type, r.documenttype, r.label),
        r.label
      );
    }
  }
  return kaart;
}

/**
 * Haalt de kandidaten voor de vereiste met `sleutel` uit de brontabel binnen de
 * dossier-lokale scope. Levert per kandidaat id/titel/datum/actor + gebonden_aan.
 */
export async function haalKandidaten(
  supabase: SupabaseClient,
  procedureId: string,
  sleutel: string
): Promise<KandidatenResultaat> {
  const type = sleutel.split("|")[1] as RequirementType | undefined;
  if (!type) return { ok: false, status: 400, fout: "Ongeldige requirement_sleutel" };

  const bron = KANDIDAAT_BRON[type];
  if (!bron) {
    // Geen kandidaten-kiezer voor dit type — de client hoort de juiste affordance
    // te tonen (upload / vaststellingsformulier / veld). Expliciete melding.
    return {
      ok: false, status: 400,
      fout: `Type "${type}" kent geen kandidaten-kiezer (document→uploaden, vaststelling→formulier, field→veld).`,
    };
  }

  // Scope bepalen.
  let scopeKolom: "decision_id" | "procedure_id";
  let scopeWaarde: string | null;
  if (bron.scope === "decision") {
    scopeKolom = "decision_id";
    scopeWaarde = await primairBesluitId(supabase, procedureId);
    if (!scopeWaarde) {
      // Nog geen Decision Object → geen kandidaten (geen fout).
      return { ok: true, type, kandidaten: [] };
    }
  } else {
    scopeKolom = "procedure_id";
    scopeWaarde = procedureId;
  }

  const kolommen = [
    "id", "requirement_sleutel", bron.titelKolom, bron.datumKolom, bron.actorKolom,
    ...(bron.metaKolom ? [bron.metaKolom] : []),
  ].join(", ");
  const { data, error } = await supabase
    .from(bron.brontabel)
    .select(kolommen)
    .eq(scopeKolom, scopeWaarde)
    .order(bron.datumKolom, { ascending: false });
  if (error) {
    console.error("Kandidatenlookup mislukt:", error);
    return { ok: false, status: 500, fout: "Serverfout" };
  }
  const rijen = (data ?? []) as unknown as Array<Record<string, unknown>>;

  // Actor-namen resolven voor uuid-kolommen (batch via profielen).
  const naamPerId = new Map<string, string>();
  if (bron.actorSoort === "id") {
    const ids = Array.from(
      new Set(rijen.map((r) => r[bron.actorKolom]).filter((v): v is string => typeof v === "string"))
    );
    if (ids.length > 0) {
      const { data: profielen } = await supabase
        .from("profielen").select("id, naam").in("id", ids);
      for (const p of (profielen ?? []) as Array<{ id: string; naam: string | null }>) {
        if (p.naam) naamPerId.set(p.id, p.naam);
      }
    }
  }

  const sleutelLabel = await bouwSleutelLabelKaart(supabase, procedureId);

  const kandidaten: Kandidaat[] = rijen.map((r) => {
    const actorRuw = r[bron.actorKolom];
    const actor =
      bron.actorSoort === "naam"
        ? (typeof actorRuw === "string" ? actorRuw : null)
        : (typeof actorRuw === "string" ? naamPerId.get(actorRuw) ?? null : null);
    const eigenSleutel = r["requirement_sleutel"];
    const gebonden_aan =
      typeof eigenSleutel === "string" && eigenSleutel !== sleutel
        ? sleutelLabel.get(eigenSleutel) ?? eigenSleutel.split("|").slice(2).join("|")
        : null;
    const titelRuw = r[bron.titelKolom];
    const datumRuw = r[bron.datumKolom];
    const metaRuw = bron.metaKolom ? r[bron.metaKolom] : null;
    return {
      id: r["id"] as string,
      titel: titelRuw == null ? null : String(titelRuw),
      datum: datumRuw == null ? null : String(datumRuw),
      actor,
      gebonden_aan,
      meta: metaRuw == null ? null : String(metaRuw),
    };
  });

  return { ok: true, type, kandidaten };
}
