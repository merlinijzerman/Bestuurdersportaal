// ============================================================================
//  W1 — Vaste configuratie voor het karakteriseringsharnas.
// ----------------------------------------------------------------------------
//  Alle UUID's die het harnas zelf plant zijn VAST (determinisme, leesbaarheid).
//  Auth-user-UUID's zijn de uitzondering: die genereert GoTrue per run en worden
//  door de normalisatielaag gemapt (BESLUIT #88). Domein-fixtures hieronder
//  krijgen herkenbare vaste UUID's.
// ============================================================================

export const ENV = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  appBaseUrl: process.env.APP_BASE_URL || "http://127.0.0.1:3000",
  cronSecret: process.env.CRON_SECRET || "",
};

export const FONDS_ID = "00000000-0000-4000-8000-000000000001";

// Vier rollen (profielen_rol_check): één sessie per rol.
export const ROLLEN = ["bestuurder", "voorzitter", "beheerder", "bestuursbureau"];

export const WACHTWOORD = "W1-karakterisering-Aa1!";

export function emailVoor(rol) {
  return `w1-${rol}@karakterisering.invalid`;
}

// Vaste domein-UUID's (per tier geseed). Herkenbare achtervoegsels.
export const FIX = {
  document1: "00000000-0000-4000-8000-0000000d0c01",
  documentIntrekken: "00000000-0000-4000-8000-0000000d0c02",
  documentOnbekend: "00000000-0000-4000-8000-0000000d0cff",
  procedure1: "00000000-0000-4000-8000-00000000cd01",
  risico1: "00000000-0000-4000-8000-0000000715c1",
  procesmodel1: "00000000-0000-4000-8000-0000000b0001",
  procesmodelOnbekend: "00000000-0000-4000-8000-0000000b00ff",
  gremium1: "00000000-0000-4000-8000-0000000c0001",
  expertise1: "00000000-0000-4000-8000-0000000e0001",
  risicoOnbekend: "00000000-0000-4000-8000-0000000715ff",
  decisionOnbekend: "00000000-0000-4000-8000-00000000dec0",
  decisionRiskOnbekend: "00000000-0000-4000-8000-0000dec0715f",
  gesprek1: "00000000-0000-4000-8000-00000000c501",
  gesprekOnbekend: "00000000-0000-4000-8000-00000000c5ff",
  agendapuntOnbekend: "00000000-0000-4000-8000-0000000a900f",
  procedureOnbekend: "00000000-0000-4000-8000-00000000cdff",
  afschrift1: "00000000-0000-4000-8000-00000a75c701",
  afschriftOnbekend: "00000000-0000-4000-8000-00000a75c7ff",
  aqlabExportOnbekend: "00000000-0000-4000-8000-00000a91b0ff",
  // W2-pilot: agendapunten/[id]/herstellen
  vergadering1: "00000000-0000-4000-8000-00000000e601",
  agendapunt1: "00000000-0000-4000-8000-0000000a9001",
  agendapuntVerwijderd: "00000000-0000-4000-8000-0000000a9002",

  // ── W4 — fixtures voor de muterende routes ────────────────────────────────
  //  Elk scenario dat een GESLAAGDE mutatie vastlegt krijgt een EIGEN UUID en
  //  een eigen preseed (W4 §4). Zo is de snapshot herhaalbaar zonder dat de
  //  volgorde van de scenariolijst dragend wordt.
  //
  //  notificaties — bewust op voorzitter/beheerder, NIET op bestuurder: de
  //  bestaande snapshot `w3.notificaties.get.bestuurder` legt een LEGE lijst
  //  vast, en die zou anders meebewegen met de volgorde van de lus.
  notificatieLezen: "00000000-0000-4000-8000-00000000f001",   // voorzitter
  notificatieAlles: "00000000-0000-4000-8000-00000000f002",   // beheerder
  notificatieOnbekend: "00000000-0000-4000-8000-00000000f0ff",

  //  risicos — eigen risico's per muterend scenario. `seed()` zet ÉÉN risico
  //  (risico1) en de bestaande snapshot `risicos-id.patch.bestuurder.200-noop`
  //  hangt daaraan; een sluit- of maatregelscenario op datzelfde risico zou die
  //  laten meebewegen met de volgorde van de lus.
  risicoSluiten: "00000000-0000-4000-8000-0000000715c2",
  risicoMaatregelen: "00000000-0000-4000-8000-0000000715c3",
  maatregel1: "00000000-0000-4000-8000-000000071dd1",
  maatregelOnbekend: "00000000-0000-4000-8000-000000071ddf",

  //  stemmingen — één agendapunt met categorie 'besluitvorming' (de W1-fixtures
  //  hebben die categorie niet) en per muterend scenario een eigen stemronde.
  //  Één gedeelde stemronde zou de volgorde dragend maken: sluiten, intrekken en
  //  stemmen wijzigen alle drie dezelfde rij.
  //  Eén agendapunt PER stemronde: `idx_stemming_een_open` staat maximaal één
  //  open stemronde per agendapunt toe, dus gedeelde agendapunten laten de
  //  preseeds op elkaar botsen.
  agendapuntBesluit: "00000000-0000-4000-8000-0000000a9010",
  agendapuntStemmen: "00000000-0000-4000-8000-0000000a9011",
  agendapuntSluiten: "00000000-0000-4000-8000-0000000a9012",
  agendapuntIntrekken: "00000000-0000-4000-8000-0000000a9013",
  agendapuntGesloten: "00000000-0000-4000-8000-0000000a9014",
  stemmingStemmen: "00000000-0000-4000-8000-00000057e001",
  stemmingSluiten: "00000000-0000-4000-8000-00000057e002",
  stemmingIntrekken: "00000000-0000-4000-8000-00000057e003",
  stemmingGesloten: "00000000-0000-4000-8000-00000057e004",
  stemmingOnbekend: "00000000-0000-4000-8000-00000057e0ff",

  //  agendapunten — eigen vergadering voor de POST (die zet `volgorde` op max+1,
  //  dus een gedeelde vergadering laat de teller per run oplopen) en een eigen
  //  agendapunt per muterend scenario.
  vergaderingAgendapunt: "00000000-0000-4000-8000-00000000e610",
  //  Aparte vergadering voor de POST. Die preseed maakt de agendapuntenlijst leeg
  //  om `volgorde` op 1 te houden, en `agendapunt_log` is append-only met CASCADE
  //  — dus zodra er op dezelfde vergadering een agendapunt is VERWIJDERD, is die
  //  lijst niet meer leeg te maken.
  vergaderingNieuwAgendapunt: "00000000-0000-4000-8000-00000000e611",
  agendapuntWijzigen: "00000000-0000-4000-8000-0000000a9020",
  agendapuntVerwijderen: "00000000-0000-4000-8000-0000000a9021",
  agendapuntNotities: "00000000-0000-4000-8000-0000000a9022",
};

export const AFSCHRIFT1_PAD = `${FONDS_ID}/w1-afschrift.pdf`;

// Vaste bytes voor de bestand-download (BESLUIT: body_sha256 i.p.v. ruwe bytes).
export const DOCUMENT1_BYTES = "%PDF-1.4 W1-KARAKTERISERING-FIXTURE\n";
export const DOCUMENT1_PAD = `${FONDS_ID}/w1-document.pdf`;
