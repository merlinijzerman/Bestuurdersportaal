// ============================================================================
// T6 fase 2 — Guardrail op de AI-leeswijzer (G2). Een CONTROLE, geen afspraak.
// ----------------------------------------------------------------------------
// In de geest van 0098 en antwoord-docx: de bouwfunctie WEIGERT een leeswijzer
// die de controle niet doorstaat en valt terug op het deterministische sjabloon.
// De regel (werkopdracht §2.2): elke datum, elk getal en elke eigennaam in de
// gegenereerde §2–4-tekst moet voorkomen in de feitenkaart.
//
// WAT DEZE CONTROLE WEL EN NIET DOET (eerlijk, AI-governance-review M1):
//   • WEL — hij toetst dat elk getal (cijfers én voluit), elke volledige datum,
//     elke eigennaam/code en elke hoofdletterafkorting in de tekst ergens in de
//     feitenkaart VOORKOMT. Dat vangt verzonnen jaartallen, aantallen, datums,
//     regelgevers en namen.
//   • NIET — hij toetst geen BINDING: "de doorlooptijd bedroeg 5 dagen" (echt 47)
//     passeert omdat "5" elders in de feitenkaart staat. Dat is een inherente
//     grens van tokenpresentie; de échte anti-fabricagegarantie is de verplichte
//     menselijke vaststelling (0150). De guardrail is het grove net ervóór.
//
// Puur en zonder DB/AI, met eigen `.sanity.ts`, bewust vóór de modelcall gebouwd.
// ============================================================================

import type { Feitenkaart } from "./afschrift-types";

export interface GuardrailResultaat {
  ok: boolean;
  overtredingen: string[];
}

const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** ISO (of yyyy-mm-dd) → "9 augustus 2026"; leeg bij onbruikbare invoer. */
function nlDatum(iso: string | null): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return "";
  const maand = Number(d[1]);
  if (!maand || maand < 1 || maand > 12) return "";
  return `${Number(d[2])} ${MAANDEN[maand - 1]} ${Number(d[0])}`;
}

// Nederlandse telwoorden → cijfer. Bewust ZONDER "een"/"één" (lidwoord-ambiguïteit).
const TELWOORDEN: Record<string, string> = {
  twee: "2", drie: "3", vier: "4", vijf: "5", zes: "6", zeven: "7", acht: "8",
  negen: "9", tien: "10", elf: "11", twaalf: "12", dertien: "13", veertien: "14",
  vijftien: "15", zestien: "16", zeventien: "17", achttien: "18", negentien: "19",
  twintig: "20", dertig: "30", veertig: "40", vijftig: "50", zestig: "60",
  zeventig: "70", tachtig: "80", negentig: "90", honderd: "100", duizend: "1000",
};

// Hoofdletterwoorden die grammaticaal of als vaste NL-vocabulaire voorkomen en
// dus geen eigennaam/feit uit de feitenkaart hoeven te zijn.
const NL_VEILIGE_WOORDEN = new Set(
  [
    ...MAANDEN,
    // Lidwoorden, voegwoorden, voorzetsels en veelvoorkomende zinsopeners. Omdat
    // óók zinsbegin-hoofdletters worden gecontroleerd (H2), moet dit de gangbare
    // openers dekken; een gemiste opener valt (veilig) terug op het sjabloon.
    "de", "het", "een", "één", "deze", "dit", "die", "dat", "er", "en", "of", "maar",
    "bij", "van", "voor", "in", "op", "aan", "met", "tot", "uit", "over", "onder",
    "na", "per", "als", "om", "door", "tijdens", "zonder", "tussen", "sinds", "vervolgens",
    "zie", "ook", "verder", "tevens", "tenslotte", "ten", "alle", "gedurende", "hoewel",
    "omdat", "hierbij", "daarbij", "hierna", "daarna", "waar", "wanneer", "doordat",
    "zodat", "terwijl", "namelijk", "echter", "bovendien", "kortom", "samen", "circa",
    "ongeveer", "daarnaast", "tenminste", "vanwege", "volgens", "conform", "zowel",
    "beide", "geen", "alleen", "zoals", "hierdoor", "daardoor", "aangezien", "nadat",
    "voordat", "totdat", "binnen", "buiten", "boven", "beneden", "eveneens", "eerst",
    // Domeinvocabulaire (statussen, telbegrippen) — geen eigennamen.
    "besluit", "besluiten", "aanname", "aannames", "risico", "risico's", "voorwaarde",
    "voorwaarden", "actie", "acties", "dissent", "dissentnotitie", "dissentnotities",
    "bewijsstuk", "bewijsstukken", "doorlooptijd", "onderbouwingsfase", "onderbouwing",
    "auditdossier", "vastlegging", "generatiemoment", "besluitmoment", "proces", "dag",
    "dagen", "gevalideerd", "geaccepteerd", "gemitigeerd", "vervuld", "afgerond", "concept",
    "open", "formeel", "vastgesteld", "waarvan", "verplichte", "aanwezig", "bestuur",
  ].map((w) => w.toLowerCase())
);

/** Alle maximale cijferreeksen in een string. */
function getallenIn(tekst: string): string[] {
  return tekst.match(/\d+/g) ?? [];
}

/** Verzamelt uitsluitend de primitieve WAARDEN uit de feitenkaart (geen
    JSON-keys — die vervuilen het corpus, AI-governance-review M3). */
function verzamelWaarden(node: unknown, uit: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string" || typeof node === "number") {
    uit.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const el of node) verzamelWaarden(el, uit);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node)) verzamelWaarden(v, uit);
  }
}

/** Normaliseer een datumfrase tot "D maand YYYY" (geen voorloopnul op de dag). */
function normaliseerDatum(dag: string, maand: string, jaar: string): string {
  return `${Number(dag)} ${maand.toLowerCase()} ${jaar}`;
}

const DATE_RE = new RegExp(`\\b(\\d{1,2})\\s+(${MAANDEN.join("|")})\\s+(\\d{4})\\b`, "gi");

interface Corpus {
  getallen: Set<string>;
  woorden: Set<string>; // whole-word tokens (lowercase) uit de waarden + NL-datums
  tekst: string; // lowercase, voor code-substringcontrole
  datums: Set<string>; // genormaliseerde toegestane datums
}

/** Toegestane corpus uit de feitenkaart-WAARDEN (niet de keys) + NL-datums. */
export function bouwToegestaneCorpus(fk: Feitenkaart): Corpus {
  const waarden: string[] = [];
  verzamelWaarden(fk, waarden);

  const isoDatums: (string | null)[] = [
    fk.aangemaaktOp,
    fk.onderbouwingsfase.start,
    fk.onderbouwingsfase.eind,
    ...fk.besluiten.flatMap((b) => [b.eersteVastlegging, b.laatsteVastlegging, b.vastgelegdeBesluiten.laatsteDatum]),
  ];
  const nlDatums = isoDatums.map(nlDatum).filter(Boolean);

  // Getallen: strip de TIJDcomponent uit ISO-tijdstippen (uren/minuten zijn geen
  // feiten) en voeg de NL-datumcijfers toe (het model schrijft "9 augustus 2026").
  const genormaliseerd =
    waarden.join(" ").replace(/T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "") + " " + nlDatums.join(" ");
  const getallen = new Set(getallenIn(genormaliseerd));

  const tekst = genormaliseerd.toLowerCase();
  const woorden = new Set((tekst.match(/[a-zà-ÿ]{2,}/g) ?? []));

  const datums = new Set(
    nlDatums.map((d) => {
      const m = /(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(d);
      return m ? normaliseerDatum(m[1], m[2], m[3]) : d;
    })
  );

  return { getallen, woorden, tekst, datums };
}

/**
 * Eigennaam-/code-/afkortingskandidaten uit de tekst. In tegenstelling tot de
 * eerdere versie worden óók zinsbegin-hoofdletters gecontroleerd (alleen
 * onderdrukt als ze veilige NL-vocabulaire zijn), plus all-caps-afkortingen.
 */
export function eigennamenIn(tekst: string): { codes: string[]; namen: string[] } {
  const codes = new Set<string>();
  const namen = new Set<string>();

  // Codes: bevat cijfer of koppelteken (bv. "B-2026-001") — overal.
  for (const code of tekst.match(/\b[A-Za-z]+[-–][A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/g) ?? []) {
    codes.add(code);
  }
  // All-caps-afkortingen (DNB, APG, ABP): ≥2 hoofdletters (H1).
  for (const acr of tekst.match(/\b[A-ZÀ-Ý]{2,}\b/g) ?? []) {
    if (!NL_VEILIGE_WOORDEN.has(acr.toLowerCase())) namen.add(acr);
  }
  // Hoofdletterwoorden — óók aan het zinsbegin gecontroleerd (H2); onderdrukt
  // alleen als het veilige NL-vocabulaire is.
  for (const w of tekst.match(/\b[A-ZÀ-Ý][a-zà-ÿ'’]{2,}\b/g) ?? []) {
    if (!NL_VEILIGE_WOORDEN.has(w.toLowerCase())) namen.add(w);
  }
  return { codes: [...codes], namen: [...namen] };
}

/**
 * De guardrail. `ok:false` met overtredingen zodra een getal (cijfers of
 * voluit), een volledige datum, een eigennaam/code of een afkorting in de
 * AI-tekst niet in de feitenkaart voorkomt.
 */
export function toetsLeeswijzerTegenFeitenkaart(
  tekst: string,
  feitenkaart: Feitenkaart
): GuardrailResultaat {
  const corpus = bouwToegestaneCorpus(feitenkaart);
  const overtredingen: string[] = [];

  // 1. Cijfergetallen.
  for (const g of new Set(getallenIn(tekst))) {
    if (!corpus.getallen.has(g)) overtredingen.push(`getal "${g}" komt niet in de feitenkaart voor`);
  }

  // 2. Voluit geschreven telwoorden (C1).
  for (const w of new Set((tekst.toLowerCase().match(/[a-zà-ÿ]+/g) ?? []))) {
    const cijfer = TELWOORDEN[w];
    if (cijfer && !corpus.getallen.has(cijfer)) {
      overtredingen.push(`getal "${w}" (${cijfer}) komt niet in de feitenkaart voor`);
    }
  }

  // 3. Volledige datums (C2): dag + maand + jaar moet als geheel kloppen.
  let m: RegExpExecArray | null;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(tekst)) !== null) {
    const genormaliseerd = normaliseerDatum(m[1], m[2], m[3]);
    if (!corpus.datums.has(genormaliseerd)) {
      overtredingen.push(`datum "${m[0]}" komt niet in de feitenkaart voor`);
    }
  }

  // 4. Eigennamen/codes/afkortingen.
  const { codes, namen } = eigennamenIn(tekst);
  for (const code of codes) {
    if (!corpus.tekst.includes(code.toLowerCase())) {
      overtredingen.push(`code "${code}" komt niet in de feitenkaart voor`);
    }
  }
  for (const naam of namen) {
    if (!corpus.woorden.has(naam.toLowerCase())) {
      overtredingen.push(`eigennaam "${naam}" komt niet in de feitenkaart voor`);
    }
  }

  return { ok: overtredingen.length === 0, overtredingen };
}
