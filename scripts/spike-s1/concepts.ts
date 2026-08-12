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

// ── percentage: "6,0%" → 0.06 ──────────────────────────────────────
export function normaliseerPercentage(raw: string): NormResultaat {
  const m = raw.match(/(-?\d+(?:[.,]\d+)?)\s*(?:%|procent|pct)/i);
  if (!m) return MISLUKT("geen percentage-token gevonden");
  const getal = parseFloat(m[1].replace(",", "."));
  if (Number.isNaN(getal)) return MISLUKT(`onparsebaar getal: ${m[1]}`);
  return { ok: true, value: getal / 100, currency: null };
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
export function normaliseerBedrag(raw: string): NormResultaat {
  const currency = /€|eur/i.test(raw) ? "EUR" : null;

  // Pak de eerste getal-cluster (cijfers met . en , als scheidingstekens).
  const m = raw.match(/-?\d[\d.,]*\d|\d/);
  if (!m) return MISLUKT("geen getal in bedrag gevonden");
  let cluster = m[0];

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
  return { ok: true, value: getal, currency };
}

// ── policy_choice: tekst → enum-waarde ──────────────────────────────
// Gebruikt zowel de door het model geleverde value_raw als de evidence-zin,
// omdat de enum-keuze vaak alleen uit de omliggende zin blijkt.
export function normaliseerPolicy(
  def: ConceptDef,
  raw: string,
  evidence: string
): NormResultaat {
  const hooiberg = `${raw} ${evidence}`.toLowerCase();
  const treffers = (def.enums ?? []).filter((e) =>
    e.trefwoorden.some((t) => hooiberg.includes(t))
  );
  if (treffers.length === 1)
    return { ok: true, value: treffers[0].waarde, currency: null };
  if (treffers.length > 1)
    return MISLUKT(
      `meerdere enum-waarden herkend (${treffers.map((t) => t.waarde).join(", ")}) — ambigu`
    );
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
