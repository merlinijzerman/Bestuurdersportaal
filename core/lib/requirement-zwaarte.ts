// Zwaarte van een procedure-vereiste, als één afgeleide grootheid.
//
// De engine kent vandaag twee booleans op de vereiste (`procedure_requirements`
// / `procedure_requirement_instance`): `verplicht` en `blokkerend`. In #168 (P3)
// worden die vervangen door één kolom `zwaarte` op de vereiste. Deze module is
// het ENIGE punt waar die afleiding gebeurt, zodat #168 hier één regel wijzigt in
// plaats van elke consument.
//
// Let op de naamgeving: `zwaarte` hoort bij de VEREISTE (wat het portaal vraagt),
// niet bij het opgevoerde bewijsstuk (`procedure_bewijs`). Vandaar
// `zwaarteVanVereiste(req)` naar analogie van `requirementSleutel(...)` in
// `requirement-sleutel.ts` — beide beschrijven de vereiste-kant.
//
// Migratieregel (identiek aan PROCEDURE-ENGINE-V2-ONTWERP §5.1 en de mockup
// `MOCKUP-processen-v0.7-overzicht-en-detail.html`):
//     blokkerend = true                    -> kritiek
//     blokkerend = false, verplicht = true -> vereist
//     anders                               -> optioneel
//
// Puur en deterministisch: geen datalaag, geen neveneffect.

export type Zwaarte = "kritiek" | "vereist" | "optioneel";

/** De twee booleans die een vereiste vandaag draagt. In #168 vervangen door
 *  één kolom `zwaarte`; dan leest deze functie die kolom rechtstreeks. */
export interface VereisteZwaarteBron {
  verplicht: boolean;
  blokkerend: boolean;
}

/**
 * De zwaarte van een vereiste, afgeleid uit `verplicht`/`blokkerend`.
 * Enige plek waar deze afleiding staat (swap-punt voor #168).
 */
export function zwaarteVanVereiste(req: VereisteZwaarteBron): Zwaarte {
  if (req.blokkerend) return "kritiek";
  if (req.verplicht) return "vereist";
  return "optioneel";
}

export const ZWAARTE_LABEL: Record<Zwaarte, string> = {
  kritiek: "Kritiek",
  vereist: "Vereist",
  optioneel: "Optioneel",
};

/** Oplopende prioriteit voor sortering/telling: kritiek < vereist < optioneel.
 *  Zo hoeft een consument die "het zwaarste open punt" zoekt de volgorde niet
 *  zelf te herhalen. */
export const ZWAARTE_RANG: Record<Zwaarte, number> = {
  kritiek: 0,
  vereist: 1,
  optioneel: 2,
};
