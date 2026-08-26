// Server-side koppelen/ontkoppelen van een gebonden feit aan een vereiste (P2/
// PR-B, #167). Eén schrijfpad "vanuit de vereiste": de client stuurt de vereiste
// als triple, de sleutel wordt hier afgeleid en tegen de procedure geverifieerd,
// en het feit in de juiste brontabel (REQUIREMENT_BRON) krijgt die sleutel.
//
// Dit generaliseert resolveRequirementBinding (dat alleen de document-typen doet)
// naar álle typen. De harde invarianten (type-consistentie, I5, versie, exact-één-
// vereiste) worden door de DB-triggers afgedwongen (fn_assert_gebonden_feit); deze
// laag levert de nette foutmeldingen, de I1-poort (doors a/c: ontkoppelen/herbinden
// onder een besloten besluit) en de dissent-tegenstrijdigheidscheck.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requirementSleutel } from "./requirement-sleutel";
import { REQUIREMENT_BRON } from "./requirement-bron";
import type { RequirementType } from "./decision-view";
import type { VereisteVerwijzing } from "./bewijs-binding";

/** Besluitstatussen waarbij een gebonden vervulling "op slot" staat (0189 §I1).
 *  Spiegelt fn_assert_feit_ontgrendeld in 2026_08_25_p2b_01_i1_ontkoppelslot.sql. */
export const BESLUIT_OP_SLOT: readonly string[] = [
  "besloten",
  "voorwaardelijk_besloten",
  "in_uitvoering",
  "in_evaluatie",
  "afgesloten",
];

export type SleutelResultaat =
  | { ok: true; sleutel: string; type: RequirementType; label: string }
  | { ok: false; fout: string; serverfout?: boolean };

/**
 * Leidt de bindingssleutel af voor ÁLLE requirement-typen en verifieert dat de
 * vereiste werkelijk bestaat voor deze procedure (template-arm ∪ actieve
 * instantie-arm), fail-closed bij een dubbele sleutel. `field` kan niet gebonden
 * worden (de gemotiveerde uitzondering).
 */
export async function resolveVereisteSleutel(
  supabase: SupabaseClient,
  procedureId: string,
  vereiste: VereisteVerwijzing
): Promise<SleutelResultaat> {
  const type = vereiste.requirement_type as RequirementType;
  if (!(type in REQUIREMENT_BRON)) {
    return { ok: false, fout: "Onbekend vereiste-type" };
  }
  if (REQUIREMENT_BRON[type] === null) {
    return {
      ok: false,
      fout: "Dit vereiste-type kent geen gebonden feit en kan niet worden gekoppeld (veld/classificatie).",
    };
  }

  const doelSleutel = requirementSleutel(
    vereiste.stap_volgorde,
    vereiste.requirement_type,
    vereiste.documenttype,
    vereiste.label
  );

  const { data: proc, error: procFout } = await supabase
    .from("procedures")
    .select("template_code, template_versie")
    .eq("id", procedureId)
    .single();
  if (procFout && procFout.code !== "PGRST116") {
    console.error("Sleutellookup (procedures) mislukt:", procFout);
    return { ok: false, fout: "Serverfout", serverfout: true };
  }
  if (!proc) return { ok: false, fout: "Procedure niet gevonden" };

  // Template-arm — versie-gefilterd op de gepinde versie (P1b/I7).
  let tplQuery = supabase
    .from("procedure_requirements")
    .select("stap_volgorde, requirement_type, documenttype, label")
    .eq("template_code", proc.template_code)
    .eq("stap_volgorde", vereiste.stap_volgorde)
    .eq("requirement_type", vereiste.requirement_type);
  if (proc.template_versie) {
    tplQuery = tplQuery.eq("template_versie", proc.template_versie);
  }
  const { data: templateRijen, error: tplFout } = await tplQuery;
  if (tplFout) {
    console.error("Sleutellookup (procedure_requirements) mislukt:", tplFout);
    return { ok: false, fout: "Serverfout", serverfout: true };
  }
  const treffers: VereisteVerwijzing[] = (templateRijen ?? []).filter(
    (r: VereisteVerwijzing) =>
      requirementSleutel(r.stap_volgorde, r.requirement_type, r.documenttype, r.label) ===
      doelSleutel
  );

  // Instantie-arm (D7) — vereisten toegevoegd aan het Decision Object.
  const { data: decisions, error: decFout } = await supabase
    .from("decision_objects")
    .select("id")
    .eq("procedure_id", procedureId);
  if (decFout) {
    console.error("Sleutellookup (decision_objects) mislukt:", decFout);
    return { ok: false, fout: "Serverfout", serverfout: true };
  }
  const decisionIds = (decisions ?? []).map((d: { id: string }) => d.id);
  if (decisionIds.length > 0) {
    const { data: instRijen, error: instFout } = await supabase
      .from("procedure_requirement_instance")
      .select("stap_volgorde, requirement_type, documenttype, label")
      .in("decision_id", decisionIds)
      .eq("actief", true)
      .eq("stap_volgorde", vereiste.stap_volgorde)
      .eq("requirement_type", vereiste.requirement_type);
    if (instFout) {
      console.error("Sleutellookup (requirement_instance) mislukt:", instFout);
      return { ok: false, fout: "Serverfout", serverfout: true };
    }
    for (const r of (instRijen ?? []) as VereisteVerwijzing[]) {
      if (
        requirementSleutel(r.stap_volgorde, r.requirement_type, r.documenttype, r.label) ===
        doelSleutel
      ) {
        treffers.push(r);
      }
    }
  }

  if (treffers.length > 1) {
    return {
      ok: false,
      fout: "Dit vereiste is dubbel gedefinieerd voor deze procedure; los de configuratie op voordat er gekoppeld wordt.",
    };
  }
  if (treffers.length === 1) {
    return { ok: true, sleutel: doelSleutel, type, label: treffers[0].label };
  }
  return { ok: false, fout: "Onbekende vereiste voor deze procedure" };
}

/**
 * I1-poort (route-kant, doors a/c): staat het besluit dat bij dit feit hoort op
 * slot? Voor besluitgebonden feiten is dat old.decision_id; voor procesgebonden
 * feiten het primaire Decision Object van de procedure. Fail-closed: een lookup-
 * fout leest als "op slot" (weiger liever te veel dan een vervulling te laten
 * verdampen). De DELETE-deur (b) wordt bovendien door de DB-trigger bewaakt.
 */
export async function besluitOpSlot(
  supabase: SupabaseClient,
  decisionId: string | null
): Promise<boolean> {
  if (!decisionId) return false;
  const { data, error } = await supabase
    .from("decision_objects")
    .select("status")
    .eq("id", decisionId)
    .maybeSingle();
  if (error) {
    console.error("I1-statuslookup mislukt:", error);
    return true; // fail-closed
  }
  if (!data) return false;
  return BESLUIT_OP_SLOT.includes((data as { status: string }).status);
}

/** Resolvet het primaire Decision Object van een procedure (voor procesgebonden
 *  feiten en de I1-poort). Null als er nog geen besluit is. */
export async function primairBesluitId(
  supabase: SupabaseClient,
  procedureId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("decision_objects")
    .select("id")
    .eq("procedure_id", procedureId)
    .eq("is_primary_decision", true)
    .maybeSingle();
  return data ? (data as { id: string }).id : null;
}
