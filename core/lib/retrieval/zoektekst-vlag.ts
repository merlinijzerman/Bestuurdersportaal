// ============================================================================
//  R1 (besluit 0218) — de vlag voor het nieuwe tekstzoekpad
//  (`public.zoek_chunks_begrensd` i.p.v. `public.zoek_chunks`).
// ----------------------------------------------------------------------------
//  Twee schakelaars, één waarheidstabel, op één plek (gedeeld door de
//  fondsconfig en de retrievalkern zodat beide nooit anders kunnen resolven):
//
//    env ZOEK_TEKST_V2   fondsvlag zoek_tekst_v2   effect
//    ────────────────    ──────────────────────    ──────────────────────────
//    ontbreekt / ≠ on    (wat dan ook)             UIT  — env is de hoofdstop
//    on                  ontbreekt                 UIT  — geen stille omschakeling
//    on                  false                     UIT
//    on                  true                      AAN  — alleen dit pilotfonds
//
//  Beide schakelaars staan standaard uit; het pad is ALLEEN aan bij env `on`
//  ÉN een expliciete fondsvlag `true`. Env `on` alleen schakelt dus geen enkel
//  fonds om: fondsen zonder vlagrij blijven op `zoek_chunks`, zodat de uitrol
//  per gekozen pilotfonds verloopt. Env `off`/ontbrekend wint altijd (ook van
//  fondsvlag `true`). Een aanroeper die de vlag al geresolveerd meegeeft,
//  wordt in `volledigeOpties` (rag.ts) opnieuw door dezelfde tabel gehaald:
//  `zoekTekstV2: true` zonder env `on` is uit, en een aanroeper zonder
//  fondsresolutie (vlag ontbreekt) is ook met env `on` uit.
// ============================================================================

export const ZOEK_TEKST_V2_ENV = "ZOEK_TEKST_V2";
export const ZOEK_TEKST_V2_FONDSVLAG = "zoek_tekst_v2";

/** De waarheidstabel hierboven. `fondsvlag` = undefined wanneer het fonds geen rij heeft. */
export function zoekTekstV2Actief(env: string | undefined, fondsvlag: boolean | undefined): boolean {
  return env === "on" && fondsvlag === true;
}
