// ============================================================================
//  core/lib/semantische-concepten.ts — pure kern van de semantische extractie (T8).
// ----------------------------------------------------------------------------
//  De PRODUCTIE-versie van de S1-spike-logica (scripts/spike-s1/{concepts,tekst}.ts),
//  gepromoveerd naar een dependency-vrije, los toetsbare laag. Bevat GEEN DB, GEEN
//  Anthropic-SDK, GEEN server-only: alles hier is puur en draait onder tsx
//  (npm run sanity). De dure/onzuivere delen (modelcall, DB-schrijf) leven in
//  core/lib/semantische-extractie.ts resp. platform/lib/semantische-extractie-job.ts.
//
//  Methodologisch kernpunt (uit S1): het model levert ALLEEN value_raw + verbatim
//  evidence; de normalisatie doen WIJ hier deterministisch, en we verifiëren de
//  evidence letterlijk tegen de brontekst. Faalpatronen uit S1 die hier zijn
//  ingebouwd: negatie/polariteit (bindingNegated), ontdubbeling (ontdubbel),
//  bron-verankering (evidenceVerbatim). Datum-overbinding lossen we op door
//  'uitgesteld'-concepten (transitiedatum) niet te extraheren; de gezag-correlatie
//  door document_status op elke unit te denormaliseren (in het job-pad).
// ============================================================================

import { createHash } from "node:crypto";

// De vier concepttypen uit de T7-catalogus. Bepaalt de normalisatie- en
// value_*-kolomkeuze (composite-FK + CHECK in het schema).
export type ConceptType = "percentage" | "date" | "amount" | "policy_choice";

export interface EnumWaarde {
  waarde: string; // canonieke enum-waarde (bv. "standaard")
  trefwoorden: string[]; // lowercase substrings die op deze waarde wijzen
}

// Eén actief concept zoals de extractie het gebruikt: de DB-rij + de uit
// normalization.jsonb geparste hints (omschrijving voor de prompt, enums voor policy).
export interface ActiefConcept {
  id: string;
  key: string;
  label: string;
  type: ConceptType;
  status: string;
  omschrijving: string; // scherpe doel-omschrijving voor het model
  enums: EnumWaarde[]; // alleen voor policy_choice
}

// Ruwe concept-rij zoals uit public.concepts.
export interface ConceptRij {
  id: string;
  key: string;
  label: string;
  type: string;
  status: string;
  normalization: unknown;
}

// ── Catalogus-parsing ───────────────────────────────────────────────────────
function isConceptType(t: string): t is ConceptType {
  return t === "percentage" || t === "date" || t === "amount" || t === "policy_choice";
}

// Parse een DB-conceptrij naar een ActiefConcept. Valt terug op label als er geen
// omschrijving-hint is; enums alleen als ze correct in normalization staan.
export function parseConcept(rij: ConceptRij): ActiefConcept {
  const norm =
    rij.normalization && typeof rij.normalization === "object" && !Array.isArray(rij.normalization)
      ? (rij.normalization as Record<string, unknown>)
      : {};
  const omschrijving =
    typeof norm.omschrijving === "string" && norm.omschrijving.trim().length > 0
      ? norm.omschrijving.trim()
      : rij.label;
  const enums: EnumWaarde[] = Array.isArray(norm.enums)
    ? (norm.enums as unknown[]).flatMap((e) => {
        if (!e || typeof e !== "object") return [];
        const o = e as Record<string, unknown>;
        const waarde = typeof o.waarde === "string" ? o.waarde : null;
        const tw = Array.isArray(o.trefwoorden)
          ? (o.trefwoorden as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        return waarde ? [{ waarde, trefwoorden: tw }] : [];
      })
    : [];
  const type: ConceptType = isConceptType(rij.type) ? rij.type : "policy_choice";
  return { id: rij.id, key: rij.key, label: rij.label, type, status: rij.status, omschrijving, enums };
}

// Actieve concepten = alles wat NIET 'uitgesteld' is (T7-status stuurt de scope).
// transitiedatum ('uitgesteld') valt hier automatisch buiten — acceptatiecriterium.
export function actieveConcepten(rijen: ConceptRij[]): ActiefConcept[] {
  return rijen.filter((r) => r.status !== "uitgesteld").map(parseConcept);
}

// Deterministische catalogus-versie: sha256 over de gesorteerde, canonieke
// weergave van ALLE concepten (key/type/status/normalization). Elke catalogus-
// wijziging (statusflip, nieuwe hint) bumpt de versie → cache-invalidatie.
export function catalogusVersie(rijen: ConceptRij[]): string {
  const canon = [...rijen]
    .map((r) => ({
      key: r.key,
      type: r.type,
      status: r.status,
      normalization: r.normalization ?? null,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const h = createHash("sha256").update(JSON.stringify(canon)).digest("hex");
  return `cat-${h.slice(0, 16)}`;
}

// Versiestempels voor reproduceerbaarheid (extraction_run). Bump bij een prompt-
// of extractor-wijziging zodat runs traceerbaar blijven (net als PREFIX_PROMPT_VERSIE).
export const SEMANTISCHE_PROMPT_VERSIE = "t8-extract-v1";
export const SEMANTISCHE_EXTRACTOR_VERSIE = "t8-v1";

// ── Flag + kostenstrategie (terugdraaibaarheid) ─────────────────────────────
// Master-switch: default UIT = geen extractie, geen gedragswijziging. Env-idiom
// '=== "on"' zoals HYBRID_SEARCH/TENANT_ENFORCE (core/lib/rag.ts, tenant-context.ts).
export function semantischeExtractieAan(): boolean {
  return process.env.SEMANTISCHE_EXTRACTIE === "on";
}

export type SemantischeStrategie = "lui" | "type_scoped" | "beide";

// Default + onbekende waarde → 'lui' (fail-safe naar de goedkoopste, on-demand modus;
// besluit T8). 'type_scoped'/'beide' zijn gereserveerd maar in T8 niet gebouwd
// (er is bewust geen documenttype-scope gekozen) — ze vallen in de job terug op 'lui'.
export function resolveStrategie(raw: string | undefined): SemantischeStrategie {
  return raw === "type_scoped" || raw === "beide" ? raw : "lui";
}

export function semantischeStrategie(): SemantischeStrategie {
  return resolveStrategie(process.env.SEMANTISCHE_EXTRACTIE_STRATEGIE);
}

// ── Tekst-hulpjes (uit S1 tekst.ts) ─────────────────────────────────────────
// Whitespace-ongevoelige normalisatie: witruimte → één spatie, lowercase, trim.
export function normWS(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// Komt `evidence` (whitespace-genormaliseerd) letterlijk voor in `bron`? Dit is
// het goedkope anti-hallucinatie-signaal (S1: 98% source-accuracy) → evidence_verified.
export function evidenceVerbatim(evidence: string, bron: string): boolean {
  const e = normWS(evidence);
  if (e.length < 3) return false;
  return normWS(bron).includes(e);
}

// ── Negatie-/polariteitsguard (S1-faalpatroon 2) ────────────────────────────
// Cues die een binding ONTKENNEN of DISKWALIFICEREN. Precision-first: liever een
// terechte binding laten vallen dan een ontkende waarde als positief boeken.
const NEGATIE_CUES = [
  "niet",
  "geen",
  "nooit",
  "zonder",
  "uitgesloten",
  "uitsluiten",
  "afgezien",
  "mag niet",
  "kritieke fout",
  "foutief",
  "ongeldig",
  "afgewezen",
  "verworpen",
];

// Splits een zin in deelzinnen op harde grenzen (interpunctie) én tegenstellende
// voegwoorden, zodat een ontkenning in de éne deelzin niet op de andere afstraalt
// ("de standaardmethode geldt, de individuele methode niet").
function splitDeelzinnen(s: string): string[] {
  return s
    .split(/[.;:,]|\s+(?:maar|echter|terwijl|hoewel|behalve)\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// Zit ten minste één van de trefwoorden in een deelzin met een negatie-cue?
// Gebruikt voor policy_choice: de gebonden enum-waarde mag niet in een ontkende
// deelzin staan ("de individuele methode wordt níet toegepast" → true → binding valt).
export function bindingNegated(evidence: string, trefwoorden: string[]): boolean {
  const deelzinnen = splitDeelzinnen(evidence.toLowerCase());
  for (const kw of trefwoorden) {
    const k = kw.toLowerCase();
    const zin = deelzinnen.find((d) => d.includes(k));
    if (zin && NEGATIE_CUES.some((c) => zin.includes(c))) return true;
  }
  return false;
}

// ── Normalisatie (uit S1 concepts.ts, deterministisch) ──────────────────────
export interface NormResultaat {
  ok: boolean;
  value: number | string | null;
  currency: string | null;
  note?: string;
}

const MISLUKT = (note: string): NormResultaat => ({ ok: false, value: null, currency: null, note });

const WOORDGETAL: Record<string, number> = {
  nul: 0, een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6,
  zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13,
  veertien: 14, vijftien: 15, zestien: 16, zeventien: 17, achttien: 18,
  negentien: 19, twintig: 20, dertig: 30, veertig: 40, vijftig: 50,
  zestig: 60, zeventig: 70, tachtig: 80, negentig: 90, honderd: 100,
};

// percentage: "6,0%" → 0.06, "zes procent" → 0.06, kaal "0,06"/"6" → 0.06.
export function normaliseerPercentage(raw: string): NormResultaat {
  const m = raw.match(/(-?\d+(?:[.,]\d+)?)\s*(?:%|procent|pct)/i);
  if (m) {
    const getal = parseFloat(m[1].replace(",", "."));
    if (Number.isNaN(getal)) return MISLUKT(`onparsebaar getal: ${m[1]}`);
    return { ok: true, value: getal / 100, currency: null };
  }
  const w = raw.toLowerCase().match(/([a-zà-ÿ]+)\s*(?:%|procent|pct)/);
  if (w && w[1] in WOORDGETAL) return { ok: true, value: WOORDGETAL[w[1]] / 100, currency: null };
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
  `${j.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;

// date: diverse NL-notaties → ISO (YYYY-MM-DD).
export function normaliseerDatum(raw: string): NormResultaat {
  const s = raw.trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { ok: true, value: iso(+m[1], +m[2], +m[3]), currency: null };
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return { ok: true, value: iso(+m[3], +m[2], +m[1]), currency: null };
  m = s.match(/(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/i);
  if (m) {
    const maand = MAANDEN[m[2].toLowerCase()];
    if (maand) return { ok: true, value: iso(+m[3], maand, +m[1]), currency: null };
  }
  m = s.match(/([a-zà-ÿ]+)\s+(\d{4})/i);
  if (m) {
    const maand = MAANDEN[m[1].toLowerCase()];
    if (maand)
      return { ok: true, value: iso(+m[2], maand, 1), currency: null, note: "dag ontbrak; 1e aangenomen" };
  }
  return MISLUKT("geen herkenbare datumnotatie");
}

// amount: "€ 17.545" → 17545 (+ currency). Punt-/spatie-duizendtallen, komma-
// decimalen, schaalwoorden.
export function normaliseerBedrag(raw: string): NormResultaat {
  const currency = /€|eur/i.test(raw) ? "EUR" : null;
  const schaal = /miljard/i.test(raw) ? 1e9 : /miljoen/i.test(raw) ? 1e6 : 1;
  const m = raw.match(/-?\d[\d.,  ]*\d|\d/);
  if (!m) return MISLUKT("geen getal in bedrag gevonden");
  let cluster = m[0].replace(/[  ]/g, "");
  const heeftPunt = cluster.includes(".");
  const heeftKomma = cluster.includes(",");
  if (heeftPunt && heeftKomma) {
    if (cluster.lastIndexOf(",") > cluster.lastIndexOf(".")) {
      cluster = cluster.replace(/\./g, "").replace(",", ".");
    } else {
      cluster = cluster.replace(/,/g, "");
    }
  } else if (heeftKomma) {
    cluster = cluster.replace(",", ".");
  } else if (heeftPunt) {
    cluster = cluster.replace(/\./g, "");
  }
  const getal = parseFloat(cluster);
  if (Number.isNaN(getal)) return MISLUKT(`onparsebaar bedrag: ${m[0]}`);
  return { ok: true, value: getal * schaal, currency };
}

// policy_choice: tekst → enum-waarde. Eerst op value_raw (de door het model
// aangewezen keuze), dan pas op de evidence-zin. Ambigu (meerdere) → mislukt.
export function normaliseerPolicy(enums: EnumWaarde[], raw: string, evidence: string): NormResultaat {
  const matchIn = (tekst: string) => {
    const h = tekst.toLowerCase();
    return enums.filter((e) => e.trefwoorden.some((t) => h.includes(t)));
  };
  for (const bron of [raw, evidence]) {
    const treffers = matchIn(bron);
    if (treffers.length === 1) return { ok: true, value: treffers[0].waarde, currency: null };
    if (treffers.length > 1)
      return MISLUKT(`meerdere enum-waarden herkend (${treffers.map((t) => t.waarde).join(", ")}) — ambigu`);
  }
  return MISLUKT("geen enum-trefwoord herkend");
}

export function normaliseer(concept: ActiefConcept, valueRaw: string, evidence: string): NormResultaat {
  switch (concept.type) {
    case "percentage":
      return normaliseerPercentage(valueRaw);
    case "date":
      return normaliseerDatum(valueRaw);
    case "amount":
      return normaliseerBedrag(valueRaw);
    case "policy_choice":
      return normaliseerPolicy(concept.enums, valueRaw, evidence);
  }
}

// ── Van modelvoorkomens naar kandidaat-units ────────────────────────────────
// Eén ruw voorkomen zoals het model het via de tool teruggeeft.
export interface RawVoorkomen {
  value_raw: string;
  evidence: string;
  sectie?: string;
  model_confidence: "hoog" | "midden" | "laag";
}

// De bronchunk waarin gezocht is (voor locatie + verbatim-verificatie).
export interface BronChunk {
  id: string | null;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  structuur_label: string | null;
}

// Eén opslagklare kandidaat-unit (matcht de jsonb die fn_schrijf_semantische_extractie leest).
export interface KandidaatUnit {
  concept_id: string;
  type: ConceptType;
  chunk_id: string | null;
  statement: string;
  value_raw: string;
  value_num: number | null;
  value_date: string | null;
  value_text: string | null;
  value_unit: string | null;
  page: number | null;
  section: string | null;
  evidence: string;
  evidence_verified: boolean;
  confidence_signals: Record<string, unknown>;
  document_status: string | null;
}

// Zet de ruwe voorkomens van ÉÉN (chunk, concept) om naar gevalideerde kandidaten.
// Verwerpt wat de value_*-CHECK toch niet zou halen (normalisatie mislukt) en —
// voor policy_choice — wat in een ontkende deelzin gebonden zou worden (negatie-guard).
// evidence_verified reflecteert de verbatim-check; onverifieerbare units worden WEL
// bewaard maar als niet-betrouwbaar gemarkeerd (T8-criterium), niet gedropt.
export function bouwKandidaatUnits(input: {
  concept: ActiefConcept;
  chunk: BronChunk;
  voorkomens: RawVoorkomen[];
  documentStatus: string | null;
}): KandidaatUnit[] {
  const { concept, chunk, voorkomens, documentStatus } = input;
  const units: KandidaatUnit[] = [];

  for (const v of voorkomens) {
    if (!v || typeof v.value_raw !== "string" || typeof v.evidence !== "string") continue;
    if (v.evidence.trim().length === 0) continue; // evidence verplicht + niet-leeg (schema)

    const norm = normaliseer(concept, v.value_raw, v.evidence);
    if (!norm.ok) continue; // zonder geldige waarde geen value_*-kolom → drop

    // Negatie-/polariteitsguard: alleen zinvol voor policy_choice (de S1-faalmodus).
    let negationChecked = false;
    if (concept.type === "policy_choice") {
      const gebonden = concept.enums.find((e) => e.waarde === norm.value);
      if (gebonden && bindingNegated(v.evidence, gebonden.trefwoorden)) continue; // ontkende binding → drop
      negationChecked = true;
    }

    const evidenceVerified = evidenceVerbatim(v.evidence, chunk.tekst);

    let value_num: number | null = null;
    let value_date: string | null = null;
    let value_text: string | null = null;
    let value_unit: string | null = null;
    switch (concept.type) {
      case "percentage":
        value_num = norm.value as number;
        value_unit = "%";
        break;
      case "amount":
        value_num = norm.value as number;
        value_unit = norm.currency;
        break;
      case "date":
        value_date = norm.value as string;
        break;
      case "policy_choice":
        value_text = norm.value as string;
        break;
    }

    units.push({
      concept_id: concept.id,
      type: concept.type,
      chunk_id: chunk.id,
      statement: v.evidence.trim(), // verbatim bronzin = leesbaar statement
      value_raw: v.value_raw,
      value_num,
      value_date,
      value_text,
      value_unit,
      page: chunk.pagina,
      section: (v.sectie && v.sectie.trim()) || chunk.paragraaf || chunk.structuur_label || null,
      evidence: v.evidence,
      evidence_verified: evidenceVerified,
      confidence_signals: {
        schema_valid: true,
        evidence_literal: evidenceVerified,
        normalization_ok: true,
        model_confidence: v.model_confidence ?? null,
        negation_checked: negationChecked,
      },
      document_status: documentStatus,
    });
  }
  return units;
}

// Ontdubbelsleutel per (concept, genormaliseerde waarde). Zelfde waarde uit
// meerdere formuleringen/chunks → één unit; verschillende waarden (echt conflict)
// blijven aparte units (dat is de versie-/opvolgingsvraag, T5/T9).
export function ontdubbelSleutel(u: KandidaatUnit): string {
  const w =
    u.type === "date" ? u.value_date : u.type === "policy_choice" ? u.value_text : String(u.value_num);
  return `${u.concept_id}|${u.type}|${w}`;
}

const CONF_RANG: Record<string, number> = { hoog: 3, midden: 2, laag: 1 };

// Ontdubbel per sleutel; houd de sterkste kandidaat (verbatim-geverifieerd én
// hoogste model-confidence wint), zodat de bewaarde unit het meest betrouwbaar is.
export function ontdubbel(units: KandidaatUnit[]): KandidaatUnit[] {
  const gesorteerd = [...units].sort((a, b) => {
    if (a.evidence_verified !== b.evidence_verified) return a.evidence_verified ? -1 : 1;
    const ca = CONF_RANG[String(a.confidence_signals.model_confidence)] ?? 0;
    const cb = CONF_RANG[String(b.confidence_signals.model_confidence)] ?? 0;
    return cb - ca;
  });
  const gezien = new Set<string>();
  const uit: KandidaatUnit[] = [];
  for (const u of gesorteerd) {
    const s = ontdubbelSleutel(u);
    if (gezien.has(s)) continue;
    gezien.add(s);
    uit.push(u);
  }
  return uit;
}
