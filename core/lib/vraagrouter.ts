// ============================================================================
// Betrouwbare vraagrouter — pure, reproduceerbare besliskern (M1–M5)
// ----------------------------------------------------------------------------
// De router bepaalt WAT de gebruiker vraagt, OP WELKE scope, en HOEVEEL dekking
// daarvoor verantwoord is. Hij haalt geen data op en roept geen model aan. De
// route kan daardoor als gesloten contract worden getest, herhaald en gelogd.
//
// Veiligheidsregel: zonder een server-gevalideerde documentscope kan deze kern
// nooit een volledige-documentstrategie activeren. Een brede vraag zonder scope
// blijft targeted/indicatief en krijgt het signaal `scope_nodig_voor_volledig`.
// ============================================================================

export const VRAAGROUTER_VERSIE = "vraagrouter-v2.0" as const;

export type VraagTaak =
  | "feitopzoeking"
  | "uitleg"
  | "samenvatting"
  | "volledigheidstoets"
  | "aansluitingstoets"
  | "vergelijking"
  | "risicoanalyse"
  | "besluitrijpheid"
  | "onbekend";

export type VraagScope =
  | "geselecteerd_document"
  | "genoemd_document"
  | "agendapuntstukken"
  | "fondscollectie"
  | "fonds_plus_algemeen_kader";

export type VraagDekking = "targeted" | "volledig_document" | "samengesteld";
export type Bewijsniveau = "indicatief" | "onderbouwd" | "uitputtend";
export type RouterBron =
  | "deterministisch"
  | "model"
  | "veilige_terugval"
  | "expliciete_vervolgactie";

export interface Vraagroute {
  versie: typeof VRAAGROUTER_VERSIE;
  taak: VraagTaak;
  scope: VraagScope;
  dekking: VraagDekking;
  bewijsniveau: Bewijsniveau;
  vertrouwen: number;
  signalen: string[];
  bron: RouterBron;
}

export interface RouteerContext {
  scope?: VraagScope;
  /** Aantal reeds server-side gevalideerde documenten in de effectieve scope. */
  documentAantal?: number;
  /** Expliciete, server-gevalideerde vervolgactie "Volledige analyse". */
  forceerVolledig?: boolean;
}

type Patroon = { id: string; patroon: RegExp; gewicht: number };

const BREDE_SIGNALEN: Patroon[] = [
  { id: "integraal", patroon: /\bintegra(?:al|le)\b/, gewicht: 0.48 },
  { id: "volledig", patroon: /\bvolledig(?:e|heid)?\b/, gewicht: 0.42 },
  {
    id: "alle_onderdelen",
    patroon: /\balle\b[^.?!]{0,45}\b(?:onderdelen|hoofdstukken|paragrafen|aspecten|criteria)\b/,
    gewicht: 0.48,
  },
  {
    id: "hele_document",
    patroon: /\b(?:het\s+)?(?:hele|gehele)\b[^.?!]{0,25}\b(?:document|plan|stuk|rapport)\b/,
    gewicht: 0.45,
  },
  { id: "doorloop", patroon: /\bdoorloop\b|\bvan begin tot eind\b/, gewicht: 0.45 },
  {
    id: "toets_aan_kader",
    patroon: /\btoets\b[^.?!]{0,80}\b(?:aan|tegen)\b|\bper criterium\b/,
    gewicht: 0.48,
  },
  {
    id: "aansluiting",
    patroon: /\b(?:sluit|past)\b[^.?!]{0,70}\b(?:aan op|bij)\b|\baansluiting(?:stoets)?\b/,
    gewicht: 0.48,
  },
  {
    id: "ontbrekende_onderbouwing",
    patroon: /\b(?:ontbreekt|ontbreken|ontbrekende|gaten|lacunes?)\b|\bniet onderbouwd\b/,
    gewicht: 0.38,
  },
  {
    id: "consistentie",
    patroon: /\b(?:intern\s+)?consistent(?:ie)?\b|\bsamenhang(?:end)?\b/,
    gewicht: 0.32,
  },
  {
    id: "samenvatting",
    patroon:
      /\bvat\b[^.?!]{0,45}\bsamen\b|\bsamenvatt\w*\b|\bhoofdlijnen\b|\bhoofdpunten\b|\brode draad\b|\bstrekking\b/,
    gewicht: 0.46,
  },
  {
    id: "brede_beoordeling",
    patroon: /\bbeoordeel\b|\bbeoordeling\b|\bevalueer\b|\banalyseer\b/,
    gewicht: 0.34,
  },
  {
    id: "risico_inventaris",
    patroon: /\bwelke\b[^.?!]{0,30}\brisico\w*\b|\brisicoanalyse\b/,
    gewicht: 0.38,
  },
  {
    id: "besluiten_inventaris",
    patroon: /\bwelke\b[^.?!]{0,30}\bbesluit\w*\b|\bbesluitrijp(?:heid)?\b/,
    gewicht: 0.36,
  },
  {
    id: "alle_relevante_onderdelen",
    patroon: /\balle relevante (?:onderdelen|aspecten|thema'?s|punten)\b/,
    gewicht: 0.48,
  },
];

const GERICHTE_SIGNALEN: Patroon[] = [
  {
    id: "expliciet_beperkt",
    patroon: /\b(?:alleen|uitsluitend|specifiek|enkel)\b/,
    gewicht: 0.62,
  },
  {
    id: "vindplaats",
    patroon: /\b(?:pagina|pag\.?|paragraaf|artikel|hoofdstuk)\s*[a-z0-9.:-]+\b/,
    gewicht: 0.58,
  },
  {
    id: "feit_wie_wanneer",
    patroon: /^\s*(?:wie|wanneer|welke datum|hoeveel|welk percentage)\b/,
    gewicht: 0.55,
  },
  {
    id: "feit_staat_er",
    patroon: /^\s*(?:wat staat|staat er|noemt|vermeldt|welke termijn|wat is de datum)\b/,
    gewicht: 0.5,
  },
  {
    id: "citaat_of_bepaling",
    patroon: /\b(?:citeer|letterlijk|exacte tekst|genoemde rekenrente|de bepaling)\b/,
    gewicht: 0.5,
  },
];

function normaliseer(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(tekst: string, patronen: Patroon[]): { score: number; ids: string[] } {
  let score = 0;
  const ids: string[] = [];
  for (const p of patronen) {
    if (!p.patroon.test(tekst)) continue;
    score += p.gewicht;
    ids.push(p.id);
  }
  return { score: Math.min(1, score), ids };
}

function taakVoor(tekst: string): VraagTaak {
  if (/\bvergelijk\w*\b|\bverschil(?:len)?\b|\bten opzichte van\b/.test(tekst)) {
    return "vergelijking";
  }
  if (
    /\btoets\b[^.?!]{0,80}\b(?:aan|tegen)\b|\b(?:sluit|past)\b[^.?!]{0,70}\b(?:aan op|bij)\b|\baansluiting(?:stoets)?\b|\bper criterium\b/.test(
      tekst
    )
  ) {
    return "aansluitingstoets";
  }
  if (
    /\bvolledig(?:e|heid)?\b|\b(?:ontbreekt|ontbreken|ontbrekende|gaten|lacunes?)\b|\b(?:intern\s+)?consistent(?:ie)?\b/.test(
      tekst
    )
  ) {
    return "volledigheidstoets";
  }
  if (/\bvat\b[^.?!]{0,45}\bsamen\b|\bsamenvatt\w*\b|\bhoofdlijnen\b|\brode draad\b|\bstrekking\b/.test(tekst)) {
    return "samenvatting";
  }
  if (/\brisicoanalyse\b|\bwelke\b[^.?!]{0,30}\brisico\w*\b/.test(tekst)) {
    return "risicoanalyse";
  }
  if (/\bbesluitrijp(?:heid)?\b|\brijp voor besluitvorming\b/.test(tekst)) {
    return "besluitrijpheid";
  }
  if (GERICHTE_SIGNALEN.some((p) => p.patroon.test(tekst))) return "feitopzoeking";
  if (/\b(?:leg uit|waarom|hoe werkt|wat betekent)\b/.test(tekst)) return "uitleg";
  if (/\b(?:beoordeel|analyseer|evalueer)\b/.test(tekst)) return "uitleg";
  return "onbekend";
}

function scopeVoor(context: RouteerContext): VraagScope {
  if (context.scope) return context.scope;
  return "fondscollectie";
}

function rondVertrouwen(waarde: number): number {
  return Number(Math.max(0, Math.min(1, waarde)).toFixed(2));
}

/**
 * Deterministische eerste beslissing. Een optionele modelrouter mag alleen een
 * uitkomst in de ambiguïteitsband verfijnen; `valideerModelroute` hieronder zet
 * daarna opnieuw de servergrenzen op scope en bewijsniveau.
 */
export function routeerVraag(vraag: string, context: RouteerContext = {}): Vraagroute {
  const tekst = normaliseer(vraag);
  const breed = matches(tekst, BREDE_SIGNALEN);
  const gericht = matches(tekst, GERICHTE_SIGNALEN);
  const taak = taakVoor(tekst);
  const scope = scopeVoor(context);
  const documentAantal = Math.max(0, context.documentAantal ?? 0);

  if (context.forceerVolledig && documentAantal > 0) {
    return {
      versie: VRAAGROUTER_VERSIE,
      taak,
      scope,
      dekking: documentAantal === 1 ? "volledig_document" : "samengesteld",
      bewijsniveau: "indicatief",
      vertrouwen: 1,
      signalen: ["expliciete_volledige_analyse", ...breed.ids],
      bron: "expliciete_vervolgactie",
    };
  }

  // Een expliciete begrenzing wint van een algemeen beoordelingswerkwoord. Alleen
  // meerdere sterke documentbrede signalen kunnen die begrenzing overrulen.
  const explicietBeperkt = gericht.ids.includes("expliciet_beperkt");
  const documentBreed =
    breed.score >= 0.42 && !(explicietBeperkt && breed.score < 0.8) && breed.score > gericht.score * 0.75;

  let vertrouwen: number;
  if (documentBreed) {
    vertrouwen = 0.58 + breed.score * 0.4 - gericht.score * 0.16;
  } else if (gericht.score > 0) {
    vertrouwen = 0.7 + gericht.score * 0.28 - breed.score * 0.12;
  } else {
    // Geen dekkingssignaal: veilig targeted, maar bewust onzeker genoeg om de
    // optionele modelrouter te mogen raadplegen als die later wordt aangezet.
    vertrouwen = taak === "onbekend" ? 0.58 : 0.76;
  }

  const signalen = [...new Set([...breed.ids, ...gericht.ids])];
  if (documentBreed && documentAantal === 0) {
    signalen.push("scope_nodig_voor_volledig");
  }

  return {
    versie: VRAAGROUTER_VERSIE,
    taak,
    scope,
    dekking:
      documentBreed && documentAantal > 0
        ? documentAantal === 1
          ? "volledig_document"
          : "samengesteld"
        : "targeted",
    bewijsniveau: "indicatief",
    vertrouwen: rondVertrouwen(vertrouwen),
    signalen,
    bron: "deterministisch",
  };
}

export const MODEL_ROUTER_MIN = 0.55;
export const MODEL_ROUTER_MAX = 0.84;

export function isModelRouterKandidaat(route: Vraagroute): boolean {
  return route.vertrouwen >= MODEL_ROUTER_MIN && route.vertrouwen <= MODEL_ROUTER_MAX;
}

/** Fail-safe bij modeltimeout/-fout: nooit brede dekking of uitputtend bewijs. */
export function veiligeRouterTerugval(route: Vraagroute): Vraagroute {
  return {
    ...route,
    dekking: "targeted",
    bewijsniveau: "indicatief",
    bron: "veilige_terugval",
    signalen: [...new Set([...route.signalen, "modelrouter_mislukt"])],
  };
}

export interface ModelRouteVoorstel {
  taak: VraagTaak;
  dekking: VraagDekking;
  vertrouwen: number;
  signalen?: string[];
}

const TAKEN: readonly VraagTaak[] = [
  "feitopzoeking",
  "uitleg",
  "samenvatting",
  "volledigheidstoets",
  "aansluitingstoets",
  "vergelijking",
  "risicoanalyse",
  "besluitrijpheid",
  "onbekend",
];
const DEKKINGEN: readonly VraagDekking[] = ["targeted", "volledig_document", "samengesteld"];

/**
 * Servervalidatie van het gesloten modelantwoord. Het model kan nooit een scope
 * scheppen en nooit zelf `uitputtend` claimen.
 */
export function valideerModelroute(
  basis: Vraagroute,
  voorstel: unknown,
  documentAantal: number
): Vraagroute | null {
  if (!voorstel || typeof voorstel !== "object") return null;
  const v = voorstel as Partial<ModelRouteVoorstel>;
  if (!TAKEN.includes(v.taak as VraagTaak)) return null;
  if (!DEKKINGEN.includes(v.dekking as VraagDekking)) return null;
  if (typeof v.vertrouwen !== "number" || !Number.isFinite(v.vertrouwen)) return null;

  let dekking = v.dekking as VraagDekking;
  const signalen = Array.isArray(v.signalen)
    ? v.signalen
        .filter((s): s is string => typeof s === "string" && /^[a-z0-9_]{1,50}$/.test(s))
        .slice(0, 8)
    : [];
  if (documentAantal <= 0) dekking = "targeted";
  if (documentAantal === 1 && dekking === "samengesteld") dekking = "volledig_document";
  if (documentAantal > 1 && dekking === "volledig_document") dekking = "samengesteld";

  return {
    ...basis,
    taak: v.taak as VraagTaak,
    dekking,
    bewijsniveau: "indicatief",
    vertrouwen: rondVertrouwen(v.vertrouwen),
    signalen: [...new Set([...basis.signalen, ...signalen, "modelrouter_gebruikt"])],
    bron: "model",
  };
}

// ── Genoemde-documentresolutie (M3) ────────────────────────────────────────

export interface BenoembaarDocument {
  id: string;
  titel: string;
}

export type GenoemdDocumentResultaat =
  | { status: "geen" }
  | { status: "eenduidig"; document: BenoembaarDocument }
  | { status: "meerdere"; kandidaten: BenoembaarDocument[] };

const TITEL_STOP = new Set([
  "het",
  "de",
  "een",
  "van",
  "voor",
  "fonds",
  "document",
  "rapport",
  "plan",
  "versie",
  "definitief",
  "concept",
  "sph",
]);

function titelTokens(titel: string): string[] {
  return normaliseer(titel)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 4 && !/^20\d{2}$/.test(t) && !TITEL_STOP.has(t));
}

/**
 * Matcht alleen letterlijke titeldelen die in de vraag voorkomen. Uniek binnen
 * de reeds onder RLS opgehaalde set is verplicht; bij twee Transitieplannen
 * volgt dus een verduidelijking in plaats van een gok.
 */
export function resolveerGenoemdDocument(
  vraag: string,
  documenten: BenoembaarDocument[]
): GenoemdDocumentResultaat {
  const q = normaliseer(vraag).replace(/[^a-z0-9]+/g, " ");
  const kandidaten = documenten.filter((doc) => {
    const titel = normaliseer(doc.titel).replace(/[^a-z0-9]+/g, " ");
    if (titel.length >= 6 && q.includes(titel)) return true;
    const tokens = titelTokens(doc.titel);
    if (tokens.length === 0) return false;
    const geraakt = tokens.filter((t) => new RegExp(`\\b${t}\\b`).test(q));
    return geraakt.length === tokens.length || geraakt.some((t) => t.length >= 8);
  });

  const uniek = [...new Map(kandidaten.map((d) => [d.id, d])).values()];
  if (uniek.length === 0) return { status: "geen" };
  if (uniek.length === 1) return { status: "eenduidig", document: uniek[0] };
  return { status: "meerdere", kandidaten: uniek.slice(0, 5) };
}

// ── Decompositie voor volledigheids-/aansluitingstoetsen (M5) ───────────────

export interface AnalyseCriterium {
  id: string;
  label: string;
  herkomst: "standaard_analyseplan" | "gebruikersvraag";
}

const STANDAARD_CRITERIA: AnalyseCriterium[] = [
  { id: "effecten", label: "effecten en uitkomsten", herkomst: "standaard_analyseplan" },
  { id: "compensatie", label: "compensatie", herkomst: "standaard_analyseplan" },
  { id: "evenwichtigheid", label: "evenwichtigheid en belangenafweging", herkomst: "standaard_analyseplan" },
  { id: "opgebouwde_aanspraken", label: "opgebouwde aanspraken en rechten", herkomst: "standaard_analyseplan" },
  { id: "uitvoering_planning", label: "uitvoering, beheersing en planning", herkomst: "standaard_analyseplan" },
];

export function bouwAnalyseplan(route: Vraagroute, vraag: string): AnalyseCriterium[] {
  if (route.taak !== "volledigheidstoets" && route.taak !== "aansluitingstoets") return [];
  const q = normaliseer(vraag);
  const gekozen = STANDAARD_CRITERIA.filter((c) => {
    if (route.taak === "aansluitingstoets") return true;
    if (/\b(?:integraal|volledig|alle onderdelen|alle relevante)\b/.test(q)) return true;
    return new RegExp(c.id.replace(/_/g, ".*")).test(q);
  });
  const resultaat = gekozen.length > 0 ? gekozen : STANDAARD_CRITERIA;
  return resultaat.map((c) => ({ ...c }));
}

export function formatteerAnalyseplan(criteria: AnalyseCriterium[]): string {
  if (criteria.length === 0) return "";
  return [
    "ANALYSEPLAN (algemeen controleplan; geen claim van juridische volledigheid):",
    ...criteria.map((c, i) => `${i + 1}. ${c.label} [${c.id}]`),
    "Behandel ieder criterium afzonderlijk: aangetroffen bewijs met vindplaats, ontbrekende onderbouwing en resterende onzekerheid.",
  ].join("\n");
}
