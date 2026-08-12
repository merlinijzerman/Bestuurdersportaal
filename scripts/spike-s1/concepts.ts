// ============================================================================
//  concepts.ts — de GESLOTEN conceptset + deterministische normalisatieregels.
// ----------------------------------------------------------------------------
//  S1 test extractie + BINDING op deze vier concepten (geen open ontdekking).
//  De moeilijkheidsgradiënt is bewust: van schoon-numeriek naar semantisch.
//
//  Belangrijk methodologisch punt: de normalisatie doen WIJ hier deterministisch,
//  niet het model. Het model levert alleen `value_raw` + verbatim `evidence`;
//  de genormaliseerde waarde is objectief en reproduceerbaar te toetsen.
// ============================================================================

import type { ConceptType } from "./types";

export interface EnumWaarde {
  waarde: string; // canonieke enum-waarde (bv. "standaard")
  trefwoorden: string[]; // lowercase substrings die op deze waarde wijzen
}

export interface ConceptDef {
  concept: string; // canonieke sleutel
  type: ConceptType;
  // Omschrijving die als doel aan Haiku wordt meegegeven. Moet scherp genoeg zijn
  // om van naburige-maar-andere concepten te onderscheiden (bovengrens ≠ ondergrens).
  omschrijving: string;
  // Enum-mapping; alleen voor policy_choice.
  enums?: EnumWaarde[];
}

export const CONCEPTEN: ConceptDef[] = [
  {
    concept: "solidariteitsreserve.bovengrens",
    type: "percentage",
    omschrijving:
      "De BOVENGRENS (maximum) van de solidariteitsreserve, uitgedrukt als " +
      "percentage. LET OP: dit is uitdrukkelijk NIET de ondergrens/minimum, NIET " +
      "een premiepercentage en NIET een andere reserve of buffer. Alleen het " +
      "expliciete maximum/plafond van de solidariteitsreserve telt.",
  },
  {
    concept: "transitiedatum",
    type: "date",
    omschrijving:
      "De transitiedatum: de datum waarop wordt overgegaan (ingevaren) naar de " +
      "nieuwe pensioenregeling / het nieuwe pensioenstelsel. NIET de datum van " +
      "besluitvorming, ondertekening of een andere mijlpaal.",
  },
  {
    concept: "franchise",
    type: "amount",
    omschrijving:
      "De franchise: het deel van het salaris waarover GEEN pensioen wordt " +
      "opgebouwd, uitgedrukt als bedrag in euro's. NIET het maximum pensioengevend " +
      "salaris, NIET de premiegrondslag, NIET een ander bedrag in het document.",
  },
  {
    concept: "invaarmethodiek",
    type: "policy_choice",
    omschrijving:
      "De gekozen invaarmethodiek: de methode waarmee bestaande aanspraken worden " +
      "omgezet naar persoonlijke pensioenvermogens. Kies uit: 'standaard' (de " +
      "standaardmethode / value-based, collectief) of 'individueel' (de individuele " +
      "methode / individuele toerekening).",
    enums: [
      {
        waarde: "standaard",
        trefwoorden: [
          "standaardmethode",
          "standaard methode",
          "standaardmethodiek",
          "standaard invaarmethode",
          "value based",
          "value-based",
          "collectieve waardering",
          "standaard", // kaal (bv. value_raw "standaardmethode" of config "STD")
          "std",
        ],
      },
      {
        waarde: "individueel",
        trefwoorden: [
          "individuele methode",
          "individuele methodiek",
          "individueel invaren",
          "individuele toerekening",
          "individuele waardering",
          "individueel", // kaal (bv. config-token "INDIVIDUEEL")
        ],
      },
    ],
  },
];

export function conceptDef(concept: string): ConceptDef | undefined {
  return CONCEPTEN.find((c) => c.concept === concept);
}

// ── Resultaat van een normalisatie ─────────────────────────────────
export interface NormResultaat {
  ok: boolean;
  value: number | string | null;
  currency: string | null;
  note?: string; // bv. reden waarom het mislukte, of aanname die is gedaan
}

const MISLUKT = (note: string): NormResultaat => ({
  ok: false,
  value: null,
  currency: null,
  note,
});

// Uitgeschreven Nederlandse hoofdtelwoorden (0–100) — de oracle test o.a.
// "zes procent". Bewust beperkt tot enkelvoudige woorden; samengestelde
// getallen ("drieënzestig") vallen buiten scope en worden een gemeten faalpunt.
const WOORDGETAL: Record<string, number> = {
  nul: 0, een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6,
  zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13,
  veertien: 14, vijftien: 15, zestien: 16, zeventien: 17, achttien: 18,
  negentien: 19, twintig: 20, dertig: 30, veertig: 40, vijftig: 50,
  zestig: 60, zeventig: 70, tachtig: 80, negentig: 90, honderd: 100,
};

// ── percentage: "6,0%" → 0.06, ook "zes procent" → 0.06 ─────────────
export function normaliseerPercentage(raw: string): NormResultaat {
  const m = raw.match(/(-?\d+(?:[.,]\d+)?)\s*(?:%|procent|pct)/i);
  if (m) {
    const getal = parseFloat(m[1].replace(",", "."));
    if (Number.isNaN(getal)) return MISLUKT(`onparsebaar getal: ${m[1]}`);
    return { ok: true, value: getal / 100, currency: null };
  }
  // Uitgeschreven: "<woord> procent".
  const w = raw.toLowerCase().match(/([a-zà-ÿ]+)\s*(?:%|procent|pct)/);
  if (w && w[1] in WOORDGETAL)
    return { ok: true, value: WOORDGETAL[w[1]] / 100, currency: null };
  // Kaal getal zonder %-teken (de oracle noemt "0,06" en "0.06" als geldige
  // bovengrens-vormen). Een getal ≤ 1 is al een fractie (0,06 → 0.06); een getal
  // > 1 en ≤ 100 is een percentage (6 → 0.06).
  const b = raw.match(/-?\d+(?:[.,]\d+)?/);
  if (b) {
    const n = parseFloat(b[0].replace(",", "."));
    if (!Number.isNaN(n)) {
      if (n > 0 && n <= 1) return { ok: true, value: n, currency: null };
      if (n > 1 && n <= 100)
        return { ok: true, value: n / 100, currency: null, note: "kaal getal geïnterpreteerd als percentage" };
    }
  }
  return MISLUKT("geen percentage-token gevonden");
}

const MAANDEN: Record<string, number> = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
  jan: 1, feb: 2, mrt: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, okt: 10, nov: 11, dec: 12,
};

const iso = (j: number, m: number, d: number): string =>
  `${j.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;

// ── date: diverse NL-notaties → ISO (YYYY-MM-DD) ────────────────────
export function normaliseerDatum(raw: string): NormResultaat {
  const s = raw.trim();

  // Al ISO?
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { ok: true, value: iso(+m[1], +m[2], +m[3]), currency: null };

  // dd-mm-yyyy of dd/mm/yyyy of dd.mm.yyyy
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return { ok: true, value: iso(+m[3], +m[2], +m[1]), currency: null };

  // "1 januari 2028" (dag maand jaar)
  m = s.match(/(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/i);
  if (m) {
    const maand = MAANDEN[m[2].toLowerCase()];
    if (maand) return { ok: true, value: iso(+m[3], maand, +m[1]), currency: null };
  }

  // "januari 2028" (maand jaar, dag ontbreekt) → 1e van de maand + aanname-note
  m = s.match(/([a-zà-ÿ]+)\s+(\d{4})/i);
  if (m) {
    const maand = MAANDEN[m[1].toLowerCase()];
    if (maand)
      return {
        ok: true,
        value: iso(+m[2], maand, 1),
        currency: null,
        note: "dag ontbrak in bron; aangenomen 1e van de maand",
      };
  }

  return MISLUKT("geen herkenbare datumnotatie");
}

// ── amount: "€ 17.545" → 17545 (+ currency) ─────────────────────────
// Ondersteunt punt- én spatie-duizendtallen ("17.545", "17 545"), komma-
// decimalen ("1.234.567,89") en schaalwoorden ("501 miljoen"). De oracle test
// "17 545 euro" (spatie) expliciet — een naïeve parser leest daar "17".
export function normaliseerBedrag(raw: string): NormResultaat {
  const currency = /€|eur/i.test(raw) ? "EUR" : null;
  const schaal = /miljard/i.test(raw) ? 1e9 : /miljoen/i.test(raw) ? 1e6 : 1;

  // Pak de eerste getal-cluster; spatie/NBSP tellen als duizendtal-scheiding.
  const m = raw.match(/-?\d[\d.,  ]*\d|\d/);
  if (!m) return MISLUKT("geen getal in bedrag gevonden");
  let cluster = m[0].replace(/[  ]/g, ""); // spaties = duizendtal → weg

  const heeftPunt = cluster.includes(".");
  const heeftKomma = cluster.includes(",");
  if (heeftPunt && heeftKomma) {
    // Laatste scheidingsteken is de decimaal; het andere is duizendtal.
    if (cluster.lastIndexOf(",") > cluster.lastIndexOf(".")) {
      cluster = cluster.replace(/\./g, "").replace(",", "."); // NL: 1.234,56
    } else {
      cluster = cluster.replace(/,/g, ""); // EN: 1,234.56
    }
  } else if (heeftKomma) {
    // Alleen komma → decimaalteken (NL).
    cluster = cluster.replace(",", ".");
  } else if (heeftPunt) {
    // Alleen punt(en): duizendtal-scheiding (17.545) → punten weg.
    // (Een echt decimaal met punt komt in NL fondsteksten praktisch niet voor.)
    cluster = cluster.replace(/\./g, "");
  }

  const getal = parseFloat(cluster);
  if (Number.isNaN(getal)) return MISLUKT(`onparsebaar bedrag: ${m[0]}`);
  return { ok: true, value: getal * schaal, currency };
}

// ── policy_choice: tekst → enum-waarde ──────────────────────────────
// Eerst op de door het model geleverde value_raw (dat is de waarde die het
// model ALS de keuze aanwijst); pas als raw niets oplevert vallen we terug op de
// evidence-zin. Reden: de evidence bevat vaak óók het andere enum-woord in een
// ONTKENNING ("de individuele methode wordt niet toegepast") — dat mag geen
// valse ambiguïteit veroorzaken. De negatie-afhandeling zelf blijft een bekend
// faalpunt (zie meetrapport) en is doelbewust niet in deze normaliser gebouwd.
export function normaliseerPolicy(
  def: ConceptDef,
  raw: string,
  evidence: string
): NormResultaat {
  const matchIn = (tekst: string) => {
    const h = tekst.toLowerCase();
    return (def.enums ?? []).filter((e) => e.trefwoorden.some((t) => h.includes(t)));
  };
  for (const bron of [raw, evidence]) {
    const treffers = matchIn(bron);
    if (treffers.length === 1)
      return { ok: true, value: treffers[0].waarde, currency: null };
    if (treffers.length > 1)
      return MISLUKT(
        `meerdere enum-waarden herkend (${treffers.map((t) => t.waarde).join(", ")}) — ambigu`
      );
    // 0 treffers in raw → door naar evidence.
  }
  return MISLUKT("geen enum-trefwoord herkend");
}

// ── Dispatcher ─────────────────────────────────────────────────────
export function normaliseer(
  def: ConceptDef,
  valueRaw: string,
  evidence: string
): NormResultaat {
  switch (def.type) {
    case "percentage":
      return normaliseerPercentage(valueRaw);
    case "date":
      return normaliseerDatum(valueRaw);
    case "amount":
      return normaliseerBedrag(valueRaw);
    case "policy_choice":
      return normaliseerPolicy(def, valueRaw, evidence);
  }
}
