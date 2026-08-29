// Kandidaten voor de kiezer-UI (#192): bestaande artefacten die aan een vereiste
// gekoppeld kunnen worden. Leest het brontype uit de sleutel, haalt de rijen uit
// de bijbehorende brontabel op de dossier-lokale scope, en geeft per kandidaat
// terug of hij al aan een (andere) vereiste hangt — dat laatste voedt de
// "Al gekoppeld aan: …"-regel en voorkomt een raadselachtige 409 bij het koppelen.
//
// Scope-als-data: de brontabel en scope komen uit REQUIREMENT_BRON (core/lib/
// requirement-bron.ts) — één bron van waarheid. Hier staat alléén de weergave
// (welke kolom de titel/datum/actor draagt), zodat er geen tweede brontype→
// brontabel-afbeelding naast REQUIREMENT_BRON ontstaat die eruit kan lopen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requirementSleutel } from "./requirement-sleutel";
import type { RequirementType } from "./decision-view";
import { primairBesluitId } from "./vereiste-koppeling";
import { REQUIREMENT_BRON } from "./requirement-bron";

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

/** Alléén de WEERGAVE-kolommen per type: welke kolom de titel/datum/actor draagt.
 *  De brontabel en scope komen uit REQUIREMENT_BRON — één bron van waarheid; hier
 *  staat bewust géén tweede brontype→brontabel-afbeelding (dat is precies de
 *  divergentie die deze EPIC overal heeft weggehaald). De aanwezigheid van een
 *  entry bepaalt tevens welke typen een kandidaten-kiezer hebben. */
interface KandidaatWeergave {
  titelKolom: string;
  datumKolom: string;
  actorKolom: string;
  /** 'naam' = tekstkolom met een naam; 'id' = uuid, via vw_fondsleden resolven. */
  actorSoort: "naam" | "id";
  metaKolom?: string;
}

// Alleen de typen met een BESTAAND artefact dat je kiest: approval/risk/assumption/
// kpi. document/external_submission/consultation lopen via de bewijs-uploadroute
// (Opvoeren); dissent_review/mandate_check via het vaststellingsformulier; field
// kent geen feit; evaluation/ai_validation hebben geen vervullingspad (besluit
// 0195) → uitgeschakelde affordance mét reden, geen kiezer.
const KANDIDAAT_WEERGAVE: Partial<Record<RequirementType, KandidaatWeergave>> = {
  approval: {
    titelKolom: "formulering", datumKolom: "datum",
    actorKolom: "vastgelegd_door_naam", actorSoort: "naam",
  },
  risk: {
    titelKolom: "beschrijving", datumKolom: "aangemaakt_op",
    actorKolom: "eigenaar_naam", actorSoort: "naam",
  },
  // Let op (RLS/code-review #192): assumption heeft geen aanmaker-kolom, dus de
  // actor is de laatste WIJZIGER (`gewijzigd_door`) en is null bij een nooit-
  // gewijzigde aanname — geen bug, een datamodel-grens.
  assumption: {
    titelKolom: "tekst", datumKolom: "aangemaakt_op",
    actorKolom: "gewijzigd_door", actorSoort: "id",
  },
  kpi: {
    titelKolom: "kpi", datumKolom: "aangemaakt_op",
    actorKolom: "eigenaar_naam", actorSoort: "naam",
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

  const weergave = KANDIDAAT_WEERGAVE[type];
  const bronDef = REQUIREMENT_BRON[type];
  if (!weergave || !bronDef) {
    // Geen kandidaten-kiezer voor dit type — de client hoort de juiste affordance
    // te tonen (upload / vaststellingsformulier / veld) of, voor een type zonder
    // vervullingspad (evaluation/ai_validation, besluit 0195), de uitgeschakelde
    // affordance mét reden. Expliciete melding als de route toch wordt aangeroepen.
    return {
      ok: false, status: 400,
      fout: `Type "${type}" kent geen kandidaten-kiezer (document→uploaden, vaststelling→formulier, field→veld, evaluation/ai_validation→geen vervullingspad).`,
    };
  }

  // Scope bepalen — brontabel én scope komen uit REQUIREMENT_BRON (één bron van
  // waarheid); de kiezer-typen zijn decision- of procedure-scoped (nooit stap_id).
  let scopeKolom: "decision_id" | "procedure_id";
  let scopeWaarde: string | null;
  if (bronDef.scope === "decision") {
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
    "id", "requirement_sleutel", weergave.titelKolom, weergave.datumKolom, weergave.actorKolom,
    ...(weergave.metaKolom ? [weergave.metaKolom] : []),
  ].join(", ");
  const { data, error } = await supabase
    .from(bronDef.brontabel)
    .select(kolommen)
    .eq(scopeKolom, scopeWaarde)
    .order(weergave.datumKolom, { ascending: false });
  if (error) {
    console.error("Kandidatenlookup mislukt:", error);
    return { ok: false, status: 500, fout: "Serverfout" };
  }
  const rijen = (data ?? []) as unknown as Array<Record<string, unknown>>;

  // Actor-namen resolven voor uuid-kolommen (batch via profielen).
  const naamPerId = new Map<string, string>();
  if (weergave.actorSoort === "id") {
    const ids = Array.from(
      new Set(rijen.map((r) => r[weergave.actorKolom]).filter((v): v is string => typeof v === "string"))
    );
    if (ids.length > 0) {
      // vw_fondsleden i.p.v. profielen: profielen.select is own-row-only
      // (auth.uid()=id), dus een directe lookup resolvet alleen je eigen naam.
      // De definer-view geeft id/naam/rol van fondsgenoten, fonds-veilig.
      const { data: leden } = await supabase
        .from("vw_fondsleden").select("id, naam").in("id", ids);
      for (const p of (leden ?? []) as Array<{ id: string; naam: string | null }>) {
        if (p.naam) naamPerId.set(p.id, p.naam);
      }
    }
  }

  const sleutelLabel = await bouwSleutelLabelKaart(supabase, procedureId);

  const kandidaten: Kandidaat[] = rijen.map((r) => {
    const actorRuw = r[weergave.actorKolom];
    const actor =
      weergave.actorSoort === "naam"
        ? (typeof actorRuw === "string" ? actorRuw : null)
        : (typeof actorRuw === "string" ? naamPerId.get(actorRuw) ?? null : null);
    const eigenSleutel = r["requirement_sleutel"];
    const gebonden_aan =
      typeof eigenSleutel === "string" && eigenSleutel !== sleutel
        ? sleutelLabel.get(eigenSleutel) ?? eigenSleutel.split("|").slice(2).join("|")
        : null;
    const titelRuw = r[weergave.titelKolom];
    const datumRuw = r[weergave.datumKolom];
    const metaRuw = weergave.metaKolom ? r[weergave.metaKolom] : null;
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
