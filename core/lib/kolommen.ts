// ============================================================================
// V0-A — Gedeelde kolomlijsten voor Supabase-projecties.
// ----------------------------------------------------------------------------
// WAAROM DIT BESTAAT
// De codebase kende geen enkele geëxporteerde kolomlijst: elke `.select()` gaf
// zijn kolommen inline mee. Dat is op zichzelf geen probleem — de meeste
// projecties zijn smal en doelgebonden (`select("opslag_pad")` in het ingestpad)
// en hebben niets aan een naam. Het wordt pas een probleem waar dezelfde set op
// meerdere plekken staat: dan moet een kolomwijziging op meerdere plekken landen
// en merkt niemand het als er één wordt vergeten.
//
// HET CRITERIUM
//   Een constante is winst zodra dezelfde kolomset op twee of meer plekken
//   voorkomt én de set een eigen betekenis heeft. Daarvóór is het indirectie.
//
// Dat criterium sluit bewust twee dingen uit:
//   • Eén gedeelde "documentkolommen"-lijst over alle 63 documentprojecties.
//     Die haalt méér kolommen op dan de meeste callsites nu vragen — een
//     gedragswijziging, geen opruiming.
//   • Een constante voor micro-selects als `id, titel` (5×) of `id, fonds_id`
//     (5×). Die callsites hebben toevallig dezelfde twee kolommen nodig, niet
//     dezelfde bedoeling; ze aan elkaar koppelen suggereert een samenhang die
//     er niet is, en `id, titel` is ter plekke leesbaarder dan een naam.
//
// De vier sets hieronder zijn de projecties die wél aan beide eisen voldoen.
// Ze zijn byte-identiek overgenomen van hun callsites: dit bestand verandert
// niets aan wat er wordt opgehaald.
//
// VOOR NIEUWE CODE
// Komt een kolomset op een tweede plek terecht, zet hem dan hier neer in plaats
// van hem te kopiëren. Zie het decision-record bij dit ticket.
//
// LET OP BIJ HET BEWERKEN — elke constante moet ÉÉN stringliteral blijven.
// supabase-js leidt het rijtype af uit het *literal type* van het select-
// argument. Breek je een lijst op in `"a, b" + "c, d"`, dan verdampt dat literal
// type tot `string` en valt het rijtype terug op `GenericStringError`: `data`
// heeft dan geen velden meer en elke `.map(r => r.id)` breekt met TS2339. Lange
// regels zijn hier dus geen slordigheid maar een vereiste. De afgeleide variant
// onderaan mag wél een template-literal zijn, mits met `as const` — dan blijft
// het literal type behouden.
// ============================================================================

// ── procedures ──────────────────────────────────────────────────────────────
/**
 * Dossierweergave van een procedure: kerngegevens plus de periode-/model-
 * metadata. Gebruikt door de dossierlijst en het dossierdetail, die dezelfde
 * vorm teruggeven aan de client.
 */
export const PROCEDURE_KOLOMMEN_DOSSIER =
  "id, template_code, titel, beschrijving, status, gestart_op, deadline, periode_type, periode_start, periode_eind, periode_jaar, procesmodel_id";

// ── risicos ─────────────────────────────────────────────────────────────────
/**
 * Volledige risicoweergave inclusief weging (kans/impact/niveau) en de
 * sluitvelden. De AI-context bouwt hiermee zowel het fondsbrede matrixblok als
 * de verdieping op één risico; beide moeten dezelfde velden zien, anders
 * verschilt de onderbouwing per pad.
 */
export const RISICO_KOLOMMEN_MATRIX =
  "id, categorie, titel, toelichting, kans, impact, niveau, type_risico, status, eigenaar_naam, volgende_beoordeling, gesloten_op, sluit_motivering";

// ── documenten ──────────────────────────────────────────────────────────────
/**
 * Levenscyclusvelden van een generiek bibliotheekdocument: de velden die de
 * statusovergangen in de generieke bibliotheek lezen en toetsen. `bibliotheek`
 * hoort er expliciet bij — de callsites weigeren op `bibliotheek !== "generiek"`.
 */
export const DOCUMENT_KOLOMMEN_LEVENSCYCLUS =
  "id, titel, status, bronstatus, geldig_tot, bibliotheek";

// ── vergaderingen ───────────────────────────────────────────────────────────
/**
 * Agendacontext van een vergadering: wat er nodig is om "de eerstvolgende
 * vergadering" te tonen. Gebruikt door de portaalcontext en het proceduredetail.
 */
export const VERGADERING_KOLOMMEN_AGENDA = "id, titel, datum, locatie";

// ── organisatie_profielen ───────────────────────────────────────────────────
// LET OP: dit gaat over `organisatie_profielen` (het organisatieprofiel van een
// fonds), niet over `profielen` (het persoonlijke gebruikersprofiel). De twee
// lokale constanten heetten allebei PROFIEL_KOLOMMEN; die naam is hier bewust
// gekwalificeerd, omdat een import zonder tabelnaam in een bestand dat óók
// `profielen` bevraagt makkelijk verkeerd gelezen wordt.
//
// De twee definities waren NIET identiek: de platformpagina las `fonds_id` mee,
// de API-route niet. Dat verschil is functioneel — de API geeft het profiel van
// het eigen fonds terug (RLS levert er hoogstens één) en heeft geen `fonds_id`
// nodig, terwijl de platformpagina cross-tenant leest en de rijen per fonds moet
// kunnen thuisbrengen. Daarom een basis plus een variant, en niet één samen-
// gevoegde lijst: die zou `fonds_id` toevoegen aan een API-response waar het nu
// niet in zit.
export const ORGANISATIEPROFIEL_KOLOMMEN =
  "organisatietype, uitvoerende_partijen, omvang, kernfeiten, missie, visie, strategische_speerpunten, risicohouding, peildatum, bijgewerkt_door, bijgewerkt_op";

/** Basis plus `fonds_id`, voor de cross-tenant platformweergave. */
export const ORGANISATIEPROFIEL_KOLOMMEN_MET_FONDS =
  `fonds_id, ${ORGANISATIEPROFIEL_KOLOMMEN}` as const;
