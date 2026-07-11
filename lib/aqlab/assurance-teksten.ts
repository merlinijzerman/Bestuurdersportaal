// lib/aqlab/assurance-teksten.ts
// -----------------------------------------------------------------------------
// AQLab — de VASTE bestuurlijke microcopy voor de assurance-laag (AQL-4). Puur,
// geen I/O: één bron van waarheid voor de disclaimer, het scope-label en de
// "wat betekent deze score wél/niet"-uitleg, gedeeld door het bevroren
// auditrapport (lib/aqlab/audit-html.ts) én de fonds-assurance-view (scherm 9).
//
// De teksten zijn LETTERLIJK overgenomen uit het functioneel ontwerp (§4.4
// disclaimer, §5.0 scope-banner, §5.2a "wat wel/niet"). Wijzig alleen samen met
// het functioneel ontwerp — het is bewust "geen schijnzekerheid"-taal.
// -----------------------------------------------------------------------------

/** Disclaimer §4.4 — onderdeel van elk rapport en elke export, prominent boven. */
export const DISCLAIMER_44 =
  "Scores ondersteunen kwaliteitsborging en releasebesluitvorming, maar vormen " +
  "geen juridische garantie en vervangen geen menselijke verantwoordelijkheid. " +
  "De indicatoren meten toetsbare vormen van brongebondenheid, volledigheid en " +
  "bestuurlijke bruikbaarheid; zij bewijzen niet dat elke feitelijke claim juist " +
  "is. De eindverantwoordelijkheid voor besluitvorming blijft menselijk " +
  "(human-in-the-loop).";

/** Vaste banner bovenaan bij assurance_scope = 'productbreed' (§5.0). */
export const SCOPE_BANNER_PRODUCTBREED =
  "Dit is een productbrede controle. De controle is uitgevoerd op representatieve " +
  "testgevallen en bewijst niet dat elk fondsdocument inhoudelijk is gevalideerd.";

/** Scope-labels (§5.0). MVP levert uitsluitend 'productbreed'. */
export const SCOPE_LABEL: Record<string, string> = {
  productbreed: "Productbrede controle",
  fonds_specifiek: "Fonds-specifieke controle",
};

/** "Wat betekent deze score wél/niet?" — twee vaste uitlegregels per tegel (§5.2a). */
export const WAT_WEL =
  "De AI-feature is getoetst op representatieve testgevallen en voldoet aan de " +
  "gestelde eisen voor brongebondenheid, volledigheid en bestuurlijke bruikbaarheid.";

export const WAT_NIET =
  "Geen garantie dat elke afzonderlijke zin of elk fondsdocument feitelijk juist " +
  "is; menselijke controle blijft nodig en besluitvorming blijft mensenwerk.";

/** "Wat betekent dit wél?" voor een feature die (nog) NIET is vrijgegeven — de
 *  positieve "voldoet aan de eisen"-formulering mag daar niet staan (geen
 *  schijnzekerheid richting bestuur). */
export const WAT_WEL_NIET_VRIJGEGEVEN =
  "Deze AI-feature is (nog) niet vrijgegeven voor gebruik. De onderstaande " +
  "indicatoren tonen de laatste meetresultaten; ze vormen geen vrijgave en geen " +
  "bevestiging dat de feature aan de gestelde eisen voldoet.";

/** Vaste footer-regel bij elke feature (§5.2). */
export const AI_ONDERSTEUNEND =
  "AI is alleen ondersteunend, besluitvorming blijft menselijk.";

/** Geldigheid/scope-waarde van de controle in de assurance-view (§5.2a). */
export const GELDIGHEID_PRODUCTBREED = "Representatieve testgevallen (synthetisch)";

/** Fonds-facing statustaal (§5.2/§5.6) — bewust "vrijgegeven voor gebruik",
 *  niet "goedgekeurd/gegarandeerd". Vertaallaag over de DB-release_status. */
export const FONDS_STATUS_LABEL: Record<string, string> = {
  vrijgegeven: "Vrijgegeven voor gebruik",
  review_vereist: "Review vereist",
  niet_vrijgegeven: "Niet vrijgegeven",
};
