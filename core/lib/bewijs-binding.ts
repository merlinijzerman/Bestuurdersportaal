// Server-side vaststellen van de bewijs↔vereiste-binding.
//
// De client stuurt de vereiste als triple (stap_volgorde, requirement_type,
// documenttype, label) — niet als kant-en-klare sleutel. De sleutel wordt hier
// afgeleid en de vereiste wordt geverifieerd tegen de database, zodat een
// binding nooit naar een verzonnen of niet-bestaand vereiste kan wijzen.
// Zelfde patroon als /api/procedures/[id]/requirements/uitsluiten, dat de
// triple ook al ontvangt.
//
// Governance: de gate zit hiermee server-side, niet alleen in de UI
// (CLAUDE.md — "governance-logica hoort niet uitsluitend in de frontend").

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BINDBARE_REQUIREMENT_TYPES,
  requirementSleutel,
} from "./requirement-sleutel";

export { BINDBARE_REQUIREMENT_TYPES };

export interface VereisteVerwijzing {
  stap_volgorde: number;
  requirement_type: string;
  documenttype: string | null;
  label: string;
}

export type BindingResultaat =
  | { ok: true; sleutel: string; label: string }
  /** `serverfout: true` = de lookup zelf mislukte (transiënte DB-/RLS-fout).
   *  De aanroeper hoort dan 500 te geven, niet 400 — anders leest een storing
   *  als "onbekende vereiste" en verdwijnt de oorzaak uit beeld. */
  | { ok: false; fout: string; serverfout?: boolean };

/** Leest de verwijzing uit een request-body. `null` = expliciet ontbinden,
 *  `undefined` = veld niet meegestuurd (laat de binding ongemoeid). */
export function leesVereisteVerwijzing(
  raw: unknown
): VereisteVerwijzing | null | "ongeldig" {
  if (raw === null) return null;
  if (typeof raw !== "object") return "ongeldig";
  const v = raw as Record<string, unknown>;
  if (
    typeof v.stap_volgorde !== "number" ||
    !Number.isInteger(v.stap_volgorde) ||
    typeof v.requirement_type !== "string" ||
    typeof v.label !== "string" ||
    (v.documenttype !== null &&
      v.documenttype !== undefined &&
      typeof v.documenttype !== "string")
  ) {
    return "ongeldig";
  }
  return {
    stap_volgorde: v.stap_volgorde,
    requirement_type: v.requirement_type,
    documenttype: (v.documenttype as string | null | undefined) ?? null,
    label: v.label,
  };
}

/**
 * Leidt de bindingssleutel af en verifieert dat het vereiste werkelijk
 * bestaat voor deze procedure — als template-vereiste (op `template_code`)
 * of als instantie-vereiste (op het Decision Object van deze procedure).
 *
 * Uitsluitingen worden bewust niet meegewogen: binden aan een uitgesloten
 * vereiste is onschadelijk (het telt nergens mee) en een uitsluiting kan
 * later worden ingetrokken, waarna de binding weer klopt.
 */
export async function resolveRequirementBinding(
  supabase: SupabaseClient,
  procedureId: string,
  vereiste: VereisteVerwijzing,
  /** Volgorde van de stap waar het bewijsstuk op staat. De gate eist zowel
   *  `ps.volgorde = rij.stap_volgorde` als sleutelgelijkheid; een binding naar
   *  een vereiste op een ándere stap zou dus een dode binding zijn — hij telt
   *  nergens mee maar suggereert in de UI het tegendeel. */
  stapVolgorde?: number,
  /** Standaard alleen de drie bewijsstuktypen. Andere feitendragers (zoals
   * procedure_besluiten voor approval) geven hier hun eigen smalle allowlist. */
  toegestaneTypen: readonly string[] = BINDBARE_REQUIREMENT_TYPES
): Promise<BindingResultaat> {
  if (
    typeof stapVolgorde === "number" &&
    stapVolgorde !== vereiste.stap_volgorde
  ) {
    return {
      ok: false,
      fout: "Het vereiste hoort bij een andere stap dan dit bewijsstuk",
    };
  }
  if (
    !toegestaneTypen.includes(vereiste.requirement_type)
  ) {
    return {
      ok: false,
      fout: `Dit type vereiste kan niet door deze feitendrager worden vervuld (${toegestaneTypen.join(
        ", "
      )})`,
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
    console.error("Bindingslookup (procedures) mislukt:", procFout);
    return { ok: false, fout: "Serverfout", serverfout: true };
  }
  if (!proc) return { ok: false, fout: "Procedure niet gevonden" };

  // Template-arm. P1b (#166): versie-gefilterd op de gepinde versie van het
  // dossier; fallback naar code-only als die (kortstondig) null is.
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
    console.error("Bindingslookup (procedure_requirements) mislukt:", tplFout);
    return { ok: false, fout: "Serverfout", serverfout: true };
  }
  const templateTreffers = (templateRijen ?? []).filter(
    (r: VereisteVerwijzing) =>
      requirementSleutel(
        r.stap_volgorde,
        r.requirement_type,
        r.documenttype,
        r.label
      ) === doelSleutel
  );
  // Instantie-arm (D7): vereisten die aan dit Decision Object zijn toegevoegd.
  const { data: decisions, error: decFout } = await supabase
    .from("decision_objects")
    .select("id")
    .eq("procedure_id", procedureId);
  if (decFout) {
    console.error("Bindingslookup (decision_objects) mislukt:", decFout);
    return { ok: false, fout: "Serverfout", serverfout: true };
  }
  const decisionIds = (decisions ?? []).map((d: { id: string }) => d.id);
  let instantieTreffers: VereisteVerwijzing[] = [];
  if (decisionIds.length > 0) {
    const { data: instRijen, error: instFout } = await supabase
      .from("procedure_requirement_instance")
      .select("stap_volgorde, requirement_type, documenttype, label")
      .in("decision_id", decisionIds)
      .eq("actief", true)
      .eq("stap_volgorde", vereiste.stap_volgorde)
      .eq("requirement_type", vereiste.requirement_type);
    if (instFout) {
      console.error("Bindingslookup (requirement_instance) mislukt:", instFout);
      return { ok: false, fout: "Serverfout", serverfout: true };
    }
    instantieTreffers = (instRijen ?? []).filter(
      (r: VereisteVerwijzing) =>
        requirementSleutel(
          r.stap_volgorde,
          r.requirement_type,
          r.documenttype,
          r.label
        ) === doelSleutel
    );
  }

  // Fail closed bij een dubbele sleutel. De identiteit is bewust inhoudelijk
  // en kan daardoor zowel in de template-arm als in de instantie-arm bestaan.
  // In dat geval mag bewijs niet stilzwijgend aan de eerste rij worden
  // gekoppeld: dezelfde sleutel zou anders twee vereisten tegelijk afvinken.
  const treffers = [...templateTreffers, ...instantieTreffers];
  if (treffers.length > 1) {
    return {
      ok: false,
      fout:
        "Dit vereiste is dubbel gedefinieerd voor deze procedure; " +
        "los de configuratie op voordat bewijs wordt gekoppeld",
    };
  }
  if (treffers.length === 1) {
    return { ok: true, sleutel: doelSleutel, label: treffers[0].label };
  }

  return {
    ok: false,
    fout: "Onbekende vereiste voor deze procedure",
  };
}
