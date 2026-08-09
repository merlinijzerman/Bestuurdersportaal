// ============================================================================
// T6 fase 2 — Guardrail op de AI-leeswijzer (G2). Een CONTROLE, geen afspraak.
// ----------------------------------------------------------------------------
// In de geest van 0098 en antwoord-docx: de bouwfunctie WEIGERT een leeswijzer
// die de controle niet doorstaat en valt terug op het deterministische sjabloon.
// De regel (werkopdracht §2.2): elke datum, elk getal en elke eigennaam in de
// gegenereerde §2–4-tekst moet voorkomen in de feitenkaart. Zo kan het model
// geen feit toevoegen dat niet in laag B staat — precies het reconstructierisico
// dat een LLM-samenvatting van een auditspoor zou introduceren.
//
// Deze functie is puur en zonder DB/AI, met eigen `.sanity.ts`, en wordt bewust
// vóór de modelcall gebouwd (bouwvolgorde 2.4.1): de toets bestaat voordat er
// tekst is om te toetsen.
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

// Hoofdletterwoorden die grammaticaal (zinsbegin) of als vaste NL-vocabulaire
// voorkomen en dus GEEN eigennaam/feit uit de feitenkaart hoeven te zijn.
const NL_VEILIGE_WOORDEN = new Set(
  [
    ...MAANDEN,
    "de", "het", "een", "deze", "dit", "die", "dat", "er", "en", "of", "maar",
    "bij", "van", "voor", "in", "op", "aan", "met", "tot", "uit", "over", "onder",
    "na", "per", "als", "om", "door", "tijdens", "zonder", "tussen", "sinds",
    "het proces", "besluit", "besluiten", "aanname", "aannames", "risico",
    "risico's", "voorwaarde", "voorwaarden", "actie", "acties", "dissent",
    "dissentnotitie", "dissentnotities", "bewijsstuk", "bewijsstukken",
    "doorlooptijd", "onderbouwingsfase", "auditdossier", "vastlegging",
    "generatiemoment", "besluitmoment", "proces", "dag", "dagen", "gevalideerd",
    "geaccepteerd", "open", "formeel", "vastgesteld", "waarvan",
  ].map((w) => w.toLowerCase())
);

/** Alle maximale cijferreeksen in een string. */
function getallenIn(tekst: string): string[] {
  return tekst.match(/\d+/g) ?? [];
}

/**
 * Toegestane corpus uit de feitenkaart: de geserialiseerde feitenkaart plus de
 * NL-genoteerde datums (het model schrijft "9 augustus 2026", de kaart draagt
 * "2026-08-09"). Levert de set toegestane getallen én een lowercase-tekstcorpus
 * voor eigennaam-/codecontrole.
 */
export function bouwToegestaneCorpus(fk: Feitenkaart): { getallen: Set<string>; tekst: string } {
  const isoDatums: (string | null)[] = [
    fk.aangemaaktOp,
    fk.onderbouwingsfase.start,
    fk.onderbouwingsfase.eind,
    ...fk.besluiten.flatMap((b) => [
      b.eersteVastlegging,
      b.laatsteVastlegging,
      b.vastgelegdeBesluiten.laatsteDatum,
    ]),
  ];
  const nlDatums = isoDatums.map(nlDatum).filter(Boolean);
  // Strip de TIJDcomponent uit ISO-tijdstippen (`T12:00:00.000Z`): die uren/
  // minuten/millis zijn geen inhoudelijke feiten en zouden anders willekeurige
  // getallen ("12", "00") toestaan waardoor een verzonnen getal ongemerkt zou
  // slippen. De datum (jaar-maand-dag) blijft staan.
  const genormaliseerd = JSON.stringify(fk).replace(/T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "");
  const basis = genormaliseerd + " " + nlDatums.join(" ");
  const getallen = new Set(getallenIn(basis));
  return { getallen, tekst: basis.toLowerCase() };
}

/**
 * Eigennaam-/code-kandidaten uit de tekst: hoofdletterwoorden die NIET aan een
 * zinsbegin staan (die zijn grammaticaal), plus alles wat op een code lijkt
 * (bevat een cijfer of koppelteken, bv. "B-2026-001") ongeacht positie. Vaste
 * NL-vocabulaire (maanden, functiewoorden) valt af.
 */
export function eigennamenIn(tekst: string): string[] {
  const uit = new Set<string>();
  // Codes: overal (ook aan zinsbegin) — bevat cijfer of koppelteken.
  for (const code of tekst.match(/\b[A-Za-z]+[-–][A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/g) ?? []) {
    uit.add(code);
  }
  // Hoofdletterwoorden, met zinsbegin-detectie.
  const re = /([.!?]\s+|^|\n)?([A-ZÀ-Ý][a-zà-ÿ'’]{2,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tekst)) !== null) {
    const zinsBegin = Boolean(m[1]);
    const woord = m[2];
    if (zinsBegin) continue; // grammaticale hoofdletter
    if (NL_VEILIGE_WOORDEN.has(woord.toLowerCase())) continue;
    uit.add(woord);
  }
  return [...uit];
}

/**
 * De guardrail. Retourneert `ok:false` met een lijst overtredingen zodra een
 * getal, datum-getal of eigennaam/code in de AI-tekst niet in de feitenkaart
 * voorkomt. De aanroeper (concept-route / bouwfunctie) weigert dan de tekst en
 * valt terug op het sjabloon.
 */
export function toetsLeeswijzerTegenFeitenkaart(
  tekst: string,
  feitenkaart: Feitenkaart
): GuardrailResultaat {
  const corpus = bouwToegestaneCorpus(feitenkaart);
  const overtredingen: string[] = [];

  for (const g of new Set(getallenIn(tekst))) {
    if (!corpus.getallen.has(g)) {
      overtredingen.push(`getal "${g}" komt niet in de feitenkaart voor`);
    }
  }
  for (const naam of eigennamenIn(tekst)) {
    if (!corpus.tekst.includes(naam.toLowerCase())) {
      overtredingen.push(`eigennaam/code "${naam}" komt niet in de feitenkaart voor`);
    }
  }

  return { ok: overtredingen.length === 0, overtredingen };
}
