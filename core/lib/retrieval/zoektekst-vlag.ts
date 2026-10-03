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
//    on                  ontbreekt                 AAN  — env on = default aan
//    on                  true                      AAN
//    on                  false                     UIT  — per fonds uitgezet
//
//  De env wint dus altijd van een fondsvlag in de UIT-richting; een fonds kan
//  het pad alleen uitzetten, nooit aanzetten zonder de env. Een aanroeper die
//  de vlag al geresolveerd meegeeft, wordt in `volledigeOpties` (rag.ts)
//  opnieuw door de hoofdstop gehaald: `zoekTekstV2: true` zonder env `on` is
//  nog steeds uit.
// ============================================================================

export const ZOEK_TEKST_V2_ENV = "ZOEK_TEKST_V2";
export const ZOEK_TEKST_V2_FONDSVLAG = "zoek_tekst_v2";

/** De waarheidstabel hierboven. `fondsvlag` = undefined wanneer het fonds geen rij heeft. */
export function zoekTekstV2Actief(env: string | undefined, fondsvlag: boolean | undefined): boolean {
  if (env !== "on") return false;
  return fondsvlag ?? true;
}
