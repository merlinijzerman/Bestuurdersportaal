// Procedure-fasen — leeslogica voor de fasebeschrijving (D8).
//
// Een fase heeft één gedeelde, generieke beschrijving (procedure_template_fasen,
// global) en optioneel een fonds-override (procedure_fase_beschrijving_override,
// fonds-RLS). De weergave valt fail-safe terug op de generieke default wanneer
// een fonds géén override heeft — zelfde patroon als de fondsconfiguratie/theming.
//
// Dit bestand levert de pure merge-logica + een lichte DB-reader. De UI-
// consumptie (procesfasen-rail) zit in WO-2; hier borgen we alleen het model
// en de fallback.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface FaseDefault {
  fase_code: string;
  volgorde: number;
  titel: string;
  generieke_beschrijving: string | null;
}

export interface FaseOverride {
  fase_code: string;
  beschrijving: string;
}

export interface FaseWeergave {
  fase_code: string;
  volgorde: number;
  titel: string;
  /** coalesce(override, generieke default) — kan null zijn als beide leeg. */
  beschrijving: string | null;
  /** true als de tekst uit een fonds-override komt (niet de gedeelde default). */
  is_override: boolean;
}

/**
 * Pure merge: overlay de fonds-overrides op de gedeelde fase-defaults.
 * Fallback naar de generieke beschrijving bij ontbrekende override.
 * Sorteert op `volgorde`.
 */
export function mergeFasen(
  defaults: FaseDefault[],
  overrides: FaseOverride[]
): FaseWeergave[] {
  const overrideMap = new Map<string, string>();
  for (const o of overrides) {
    // Lege override telt niet als override (fail-safe naar default).
    if (typeof o.beschrijving === "string" && o.beschrijving.trim().length > 0) {
      overrideMap.set(o.fase_code, o.beschrijving);
    }
  }
  return defaults
    .slice()
    .sort((a, b) => a.volgorde - b.volgorde)
    .map((d) => {
      const ov = overrideMap.get(d.fase_code);
      return {
        fase_code: d.fase_code,
        volgorde: d.volgorde,
        titel: d.titel,
        beschrijving: ov ?? d.generieke_beschrijving ?? null,
        is_override: ov !== undefined,
      };
    });
}

/**
 * Leest de fasen voor een template en merget de override van het fonds van
 * de aanroeper. Fonds-scoping loopt via RLS op de override-tabel — het
 * `fonds_id` komt nooit uit de request.
 */
export async function laadFasen(
  supabase: SupabaseClient,
  templateCode: string
): Promise<FaseWeergave[]> {
  const [{ data: defaultsRows }, { data: overrideRows }] = await Promise.all([
    supabase
      .from("procedure_template_fasen")
      .select("fase_code, volgorde, titel, generieke_beschrijving")
      .eq("template_code", templateCode)
      .order("volgorde", { ascending: true }),
    // RLS beperkt dit al tot het eigen fonds; geen fonds_id-filter uit de request.
    supabase
      .from("procedure_fase_beschrijving_override")
      .select("fase_code, beschrijving")
      .eq("template_code", templateCode),
  ]);

  return mergeFasen(
    (defaultsRows ?? []) as FaseDefault[],
    (overrideRows ?? []) as FaseOverride[]
  );
}
