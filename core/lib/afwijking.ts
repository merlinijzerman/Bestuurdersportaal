// Gedeelde constanten voor afronden-met-afwijking (P3/PR-C, #168).
//
// I2 (v0.19, invariantentabel): "Een afwijking zonder motivering bestaat niet —
// minimumlengte afgedwongen, niet leeg-met-spaties." Afgedwongen op DRIE lagen die
// dit getal delen: de UI (blijvende hulptekst + submit-gate), de route (400) en de
// DB (fn_stap_afronden_met_afwijking → PC002, plus een CHECK-constraint op de kolom).
// Waarde 10, conform de audit-grade-motivering elders in het portaal (ai-begrenzing).
export const MIN_MOTIVERING_LENGTE = 10;
