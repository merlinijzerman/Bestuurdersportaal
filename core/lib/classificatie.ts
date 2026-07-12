// ============================================================================
// Procesclassificatie-engine — Increment E (FO v1.2 §10, TO v1.2 §2.6).
// ----------------------------------------------------------------------------
// Pure, transparante en testbare heuristiek (geen modelaanroep, geen
// ondoorzichtige getalsscore) die per document een koppeling aan een
// procesinstantie voorstelt met een confidence (hoog/middel/laag/geen_match).
// Past bij de governance-lijn ("geen schijnzekerheid") en spiegelt het patroon
// van lib/vraagtype.ts. De I/O (catalogus ophalen, voorstel wegschrijven,
// auto-koppelen) leeft in de API-routes; deze module beslist alleen.
//
// Vier signalen uit de fonds-procescatalogus (ticket §4a):
//   S1 titel-/synoniemmatch  — titel matcht naam of synoniem van een procesmodel
//   S2 periodematch          — herkende periode valt in precies één OPEN instantie
//   S3 typematch             — documenttype zit in verwachte_documenttypen
//   S4 inhoudsmatch          — chunk-tekst bevat proces-synoniemen (zwak signaal)
//
// Mapping → gedrag:
//   hoog       precies één kandidaat + ≥2 onafhankelijke signalen, incl. S1 of S2
//   middel     één kandidaat met één sterk signaal (S1/S2), of een leidende kandidaat
//   laag       alleen S4, zwak/ambigu, of meerdere gelijkwaardige kandidaten
//   geen_match geen signaal boven de vloer of geen passende OPEN procesinstantie
//
// Harde guards (overrulen de mapping):
//   • expliciet gekoppeld document → nooit voorstel, nooit omhangen (FO §10);
//   • periode herkend maar geen OPEN instantie → max "middel" (nooit auto);
//   • notulen koppelen uitsluitend via het agendapunt, niet rechtstreeks.
//
// Drempels staan in ÉÉN configconstante CLASSIFICATIE_DREMPELS zodat tunen geen
// logica-redeploy vraagt. Bewust conservatief: een verkeerde auto-koppeling raakt
// het vertrouwen van de bestuurssecretaris; de schade is begrensd (altijd
// terugdraaibaar + gelogd), dus asymmetrisch risico → streng beginnen.
// ============================================================================

export type Confidence = "hoog" | "middel" | "laag" | "geen_match";
export type Classificatiebron = "titel" | "inhoud" | "periode" | "synoniem";
export type Signaal = "S1" | "S2" | "S3" | "S4";

// ── Centrale, tunebare configuratie ────────────────────────────────────────
export const CLASSIFICATIE_DREMPELS = {
  // Een procesinstantie telt als "open" (kan nog een document ontvangen) bij deze
  // statussen. besloten/in_implementatie/afgerond/gearchiveerd zijn bewust
  // uitgesloten → een periodematch daarop kapt af op "middel" (mens bevestigt).
  openProcesinstantieStatussen: [
    "gepland",
    "lopend",
    "ter_besluitvorming",
    "heropend",
  ] as const,
  // S1: minimale lengte van een synoniem/naam-term om als titelmatch te tellen
  // (kort = te veel ruis). En de minimale Jaccard-deeloverlap voor een "sterke
  // deelmatch" als er geen exacte substringmatch is.
  s1MinTermLengte: 4,
  s1MinTokenOverlap: 0.6,
  // S4: hoeveel chunks minimaal een proces-synoniem moeten bevatten voordat de
  // (zwakke) inhoudsmatch meetelt.
  s4MinChunkHits: 2,
  // "hoog" vereist minimaal dit aantal onafhankelijke signalen.
  hoogMinSignalen: 2,
} as const;

export type Procesinstantiestatus = string;

/** Eén kandidaat-procesinstantie met de catalogusgegevens die de engine nodig heeft. */
export interface KandidaatInstantie {
  procesinstantie_id: string;
  procesmodel_id: string | null;
  /** Naam van het procesmodel (voor titel-/synoniemmatch). */
  procesmodel_naam: string | null;
  /** Synoniemen van het procesmodel (procesmodellen.synoniemen). */
  synoniemen: string[];
  /** Verwachte documenttypen van het procesmodel. */
  verwachte_documenttypen: string[];
  /** Status van de procesinstantie (procedures.status). */
  status: Procesinstantiestatus;
  /** Periodejaar van de procesinstantie (procedures.periode_jaar), indien gezet. */
  periode_jaar: number | null;
}

/** Het te classificeren document + zijn relevante chunk-tekst. */
export interface ClassificatieInvoer {
  titel: string;
  documenttype: string | null;
  documentdatum: string | null; // ISO-datum of null
  /** Is er al een primaire procesinstantie? Dan nooit voorstel/omhangen. */
  reedsGekoppeld: boolean;
  /** Notulen koppelen uitsluitend via het agendapunt (FO §10). */
  isNotulen: boolean;
  heeftAgendapunt: boolean;
  /** Een steekproef chunk-teksten voor de inhoudsmatch (S4). */
  chunkTeksten: string[];
}

export interface Classificatievoorstel {
  procesinstantie_id: string | null;
  procesmodel_id: string | null;
  documenttype: string | null;
  confidence: Confidence;
  bron: Classificatiebron;
  /** Welke signalen meewogen — voor een transparante, auditbare toelichting. */
  signalen: Signaal[];
  toelichting: string;
}

// ── Hulp: normalisatie (lowercase, diacritics weg) ─────────────────────────
function normaliseer(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function tokens(tekst: string): string[] {
  return normaliseer(tekst)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Jaccard-overlap tussen twee tokensets (0..1). */
function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersectie = 0;
  for (const t of sa) if (sb.has(t)) intersectie++;
  const unie = new Set([...sa, ...sb]).size;
  return unie === 0 ? 0 : intersectie / unie;
}

function isOpen(status: Procesinstantiestatus): boolean {
  return (CLASSIFICATIE_DREMPELS.openProcesinstantieStatussen as readonly string[]).includes(
    status
  );
}

/** Herken een jaartal (2000–2099) in een tekst. */
export function herkenJaar(tekst: string): number | null {
  const m = normaliseer(tekst).match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Signaaldetectie per kandidaat ──────────────────────────────────────────

/** S1: titel matcht (exact substring of sterke token-deelmatch) een naam/synoniem. */
function signaalS1(titel: string, kandidaat: KandidaatInstantie): boolean {
  const titelNorm = normaliseer(titel);
  const titelTokens = tokens(titel);
  const termen = [kandidaat.procesmodel_naam, ...kandidaat.synoniemen]
    .filter((t): t is string => !!t)
    .map((t) => t.trim())
    .filter((t) => t.length >= CLASSIFICATIE_DREMPELS.s1MinTermLengte);

  for (const term of termen) {
    const termNorm = normaliseer(term);
    if (termNorm.length === 0) continue;
    if (titelNorm.includes(termNorm)) return true;
    if (tokenOverlap(titelTokens, tokens(term)) >= CLASSIFICATIE_DREMPELS.s1MinTokenOverlap) {
      return true;
    }
  }
  return false;
}

/** S2: herkende periode valt binnen het periodejaar van deze OPEN instantie. */
function signaalS2(
  invoer: ClassificatieInvoer,
  kandidaat: KandidaatInstantie
): boolean {
  if (kandidaat.periode_jaar == null) return false;
  const jaarUitTitel = herkenJaar(invoer.titel);
  const jaarUitDatum = invoer.documentdatum
    ? herkenJaar(invoer.documentdatum) ?? new Date(invoer.documentdatum).getFullYear()
    : null;
  const jaar = jaarUitTitel ?? jaarUitDatum;
  if (jaar == null) return false;
  return jaar === kandidaat.periode_jaar;
}

/** S3: documenttype zit in de verwachte typen van het procesmodel. */
function signaalS3(invoer: ClassificatieInvoer, kandidaat: KandidaatInstantie): boolean {
  if (!invoer.documenttype) return false;
  return kandidaat.verwachte_documenttypen
    .map(normaliseer)
    .includes(normaliseer(invoer.documenttype));
}

/** S4: ≥ drempel chunks bevatten een proces-synoniem/naam (zwak signaal). */
function signaalS4(invoer: ClassificatieInvoer, kandidaat: KandidaatInstantie): boolean {
  const termen = [kandidaat.procesmodel_naam, ...kandidaat.synoniemen]
    .filter((t): t is string => !!t)
    .map(normaliseer)
    .filter((t) => t.length >= CLASSIFICATIE_DREMPELS.s1MinTermLengte);
  if (termen.length === 0) return false;
  let hits = 0;
  for (const tekst of invoer.chunkTeksten) {
    const norm = normaliseer(tekst);
    if (termen.some((term) => norm.includes(term))) hits++;
    if (hits >= CLASSIFICATIE_DREMPELS.s4MinChunkHits) return true;
  }
  return false;
}

function signalenVoorKandidaat(
  invoer: ClassificatieInvoer,
  kandidaat: KandidaatInstantie
): Signaal[] {
  const s: Signaal[] = [];
  if (signaalS1(invoer.titel, kandidaat)) s.push("S1");
  if (signaalS2(invoer, kandidaat)) s.push("S2");
  if (signaalS3(invoer, kandidaat)) s.push("S3");
  if (signaalS4(invoer, kandidaat)) s.push("S4");
  return s;
}

/** Het sterkste signaal bepaalt de getoonde bron. Prioriteit S1 > S2 > S4 > S3. */
function bronVanSignalen(signalen: Signaal[]): Classificatiebron {
  if (signalen.includes("S1")) return "titel";
  if (signalen.includes("S2")) return "periode";
  if (signalen.includes("S4")) return "inhoud";
  return "synoniem"; // alleen S3 (typematch) over — zwakste herkomst
}

const GEEN_MATCH: Classificatievoorstel = {
  procesinstantie_id: null,
  procesmodel_id: null,
  documenttype: null,
  confidence: "geen_match",
  bron: "synoniem",
  signalen: [],
  toelichting: "Geen passende open procesinstantie of onvoldoende signaal.",
};

/**
 * Classificeer één document tegen de kandidaat-procesinstanties van zijn fonds.
 * Pure functie: geen I/O. De aanroeper levert de cataloguskandidaten aan en
 * verwerkt het resultaat (voorstel wegschrijven; bij "hoog" auto-koppelen).
 */
export function classificeerDocument(
  invoer: ClassificatieInvoer,
  kandidaten: KandidaatInstantie[]
): Classificatievoorstel {
  // Guard 1: expliciet gekoppeld → nooit voorstel, nooit omhangen (FO §10).
  if (invoer.reedsGekoppeld) {
    return {
      ...GEEN_MATCH,
      toelichting: "Document is expliciet gekoppeld; classificatie hangt nooit om.",
    };
  }

  // Guard 3: notulen koppelen uitsluitend via het agendapunt, niet rechtstreeks.
  if (invoer.isNotulen && !invoer.heeftAgendapunt) {
    return {
      ...GEEN_MATCH,
      toelichting:
        "Notulen koppelen via het agendapunt; zonder agendapunt geen rechtstreeks voorstel.",
    };
  }

  if (kandidaten.length === 0) return GEEN_MATCH;

  // Scoor elke kandidaat op signalen.
  const gescoord = kandidaten
    .map((k) => ({ kandidaat: k, signalen: signalenVoorKandidaat(invoer, k) }))
    .filter((g) => g.signalen.length > 0);

  if (gescoord.length === 0) return GEEN_MATCH;

  // Sorteer: meeste signalen eerst; bij gelijkspel weegt een sterk signaal (S1/S2).
  const sterkte = (s: Signaal[]) =>
    s.length * 10 + (s.includes("S1") ? 3 : 0) + (s.includes("S2") ? 2 : 0);
  gescoord.sort((a, b) => sterkte(b.signalen) - sterkte(a.signalen));

  const beste = gescoord[0];
  const tweede = gescoord[1];
  const heeftSterk = beste.signalen.includes("S1") || beste.signalen.includes("S2");
  const uniekLeidend =
    !tweede || sterkte(beste.signalen) > sterkte(tweede.signalen);

  const voorstelBasis = {
    procesinstantie_id: beste.kandidaat.procesinstantie_id,
    procesmodel_id: beste.kandidaat.procesmodel_id,
    documenttype: invoer.documenttype,
    bron: bronVanSignalen(beste.signalen),
    signalen: beste.signalen,
  };

  // Meerdere gelijkwaardige kandidaten → ambigu, nooit auto → "laag".
  if (!uniekLeidend) {
    return {
      ...voorstelBasis,
      confidence: "laag",
      toelichting: "Meerdere gelijkwaardige kandidaten — handmatige beoordeling.",
    };
  }

  // Guard 2: periode herkend maar deze kandidaat is geen OPEN instantie → nooit
  // auto; kap af op "middel". (S2 vuurt alleen op periode_jaar-match; de
  // open-check bepaalt of dat tot auto mag leiden.)
  const periodeMaarGesloten =
    beste.signalen.includes("S2") && !isOpen(beste.kandidaat.status);

  // "hoog": uniek leidend + open instantie + ≥2 onafhankelijke signalen incl.
  // S1 of S2, niet afgekapt door de gesloten-periode-guard.
  if (
    isOpen(beste.kandidaat.status) &&
    !periodeMaarGesloten &&
    heeftSterk &&
    beste.signalen.length >= CLASSIFICATIE_DREMPELS.hoogMinSignalen
  ) {
    return {
      ...voorstelBasis,
      confidence: "hoog",
      toelichting: `Eenduidige match (${beste.signalen.join("+")}) op één open procesinstantie.`,
    };
  }

  // "middel": één duidelijk leidende kandidaat met een sterk signaal (S1/S2) of
  // ≥2 signalen — maar onvoldoende/geen open instantie voor auto.
  if (heeftSterk || beste.signalen.length >= 2) {
    return {
      ...voorstelBasis,
      confidence: "middel",
      toelichting: periodeMaarGesloten
        ? `Periodematch op een niet-open procesinstantie (${beste.kandidaat.status}) — bevestiging vereist.`
        : `Eén leidende kandidaat (${beste.signalen.join("+")}) — bevestiging vereist.`,
    };
  }

  // "laag": alleen een zwak inhouds-/typesignaal.
  return {
    ...voorstelBasis,
    confidence: "laag",
    toelichting: "Alleen een zwak inhouds-/typesignaal — handmatige beoordeling.",
  };
}
