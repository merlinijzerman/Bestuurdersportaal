// ============================================================================
//  §15-matrix — #500 hotfix productietime-out: de artikeltoelating zonder
//  `zoek_chunks`. Hermetisch (geen netwerk, geen database).
//
//  Dezelfde pariteitsmatrix als de DB-check
//  (supabase/checks/2026_09_29_500_artikelspoor.sql, sectie M): die bewijst
//  onder echte RLS dat nieuwe toelating == zoek_chunks == verwacht. Deze suite
//  bewijst op dezelfde rijen en scenario's dat
//   (T1) het pure predicaat `voldoetAanZoekfilters` exact `verwacht` geeft;
//   (T2) de PostgREST-filters van `toelatingsfilters` — geïnterpreteerd met
//        PostgREST-/SQL-semantiek — nooit iets toelaten wat het predicaat
//        weigert en nooit iets weigeren wat het predicaat toelaat, behalve
//        precies de twee regels die chunk- en documentkolom combineren;
//   (N) negatieve controle: één regel weglaten ⇒ minstens één scenario rood,
//        en een lek-variant van de filters ⇒ rood.
//  RLS en de frase (FTS) worden hier nagebootst zoals de DB ze toepast: fonds B
//  is voor gebruiker A onzichtbaar; `frase=false` komt niet door `@@`.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/retrieval-artikeltoelating.test.ts
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARTIKEL_TOELATING_ID_MAX,
  TOELATINGSREGELS,
  pasToelatingsfiltersToe,
  toelatingsfilters,
  voldoetAanZoekfilters,
  type Toelatingsfilter,
  type ToelatingsRij,
  type Toelatingsparameters,
} from "../../core/lib/retrieval/artikeltoelating";
import { ARTIKEL_OPZOEK_MAX, type RetrievalFilters } from "../../core/lib/rag";
import type { RetrievalModus } from "../../core/lib/vraagtype";

interface Matrixrij {
  sleutel: string;
  document_id: string;
  chunk_id: string;
  fonds_id: string | null;
  bibliotheek: string;
  status: string | null;
  bronstatus: string | null;
  actief: boolean;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  volgende_review: string | null;
  procesinstantie_id: string | null;
  frase: boolean;
  aangewezen: boolean;
}
interface Scenario {
  naam: string;
  parameters: {
    modus: RetrievalModus | null;
    peildatum: string;
    fonds_id: string | null;
    documentscope: string[] | null;
    bronstatus: string[] | null;
    documentstatus: string[] | null;
    procesinstantie_ids: string[] | null;
    bronsoort: string[] | null;
  };
  toegelaten: string[];
}
const MATRIX = JSON.parse(
  readFileSync(new URL("./fixtures/500-artikeltoelating-matrix.json", import.meta.url), "utf8")
) as { fonds_a: string; frase: string; rijen: Matrixrij[]; scenarios: Scenario[] };

/** Zoals `fn_chunk_denorm` de chunk vult: statusvelden van de documentrij. */
function alsRij(m: Matrixrij): ToelatingsRij {
  return {
    id: m.chunk_id,
    document_id: m.document_id,
    tekst: m.frase ? `Artikel 150d Pensioenwet (Transitieplan)\nMatrixrij ${m.sleutel}` : `Vervolgtekst ${m.sleutel}`,
    pagina: 1,
    paragraaf: null,
    chunk_index: 0,
    documentstatus: m.status,
    bronstatus: m.bronstatus,
    documentdatum: null,
    geldig_vanaf: m.geldig_vanaf,
    geldig_tot: m.geldig_tot,
    procesinstantie_id: m.procesinstantie_id,
    bronorganisatie: null,
    normgewicht: null,
    extern_url: null,
    wettelijk_regime: null,
    bibliotheek: m.bibliotheek,
    documenten: {
      titel: `Matrix — ${m.sleutel}`,
      bron: m.bibliotheek === "generiek" ? "Extern" : "Intern",
      bibliotheek: m.bibliotheek,
      opslag_pad: null,
      fonds_id: m.fonds_id,
      volgende_review: m.volgende_review,
      actief: m.actief,
    },
  };
}
const RIJEN = MATRIX.rijen.map((m) => ({ m, r: alsRij(m) }));
/** RLS voor fondsgebruiker A (chunks select: eigen fonds of generiek). */
const zichtbaar = (m: Matrixrij) => m.bibliotheek === "generiek" || m.fonds_id === MATRIX.fonds_a;

function parametersVan(s: Scenario): Toelatingsparameters {
  const p = s.parameters;
  const filters: RetrievalFilters = { peildatum: p.peildatum };
  if (p.modus) filters.modus = p.modus;
  if (p.bronstatus) filters.bronstatus = p.bronstatus;
  if (p.documentstatus) filters.documentstatus = p.documentstatus;
  if (p.procesinstantie_ids) filters.procesinstantie_ids = p.procesinstantie_ids;
  if (p.bronsoort) filters.bronsoort = p.bronsoort;
  return {
    ids: MATRIX.rijen.filter((m) => m.aangewezen).map((m) => m.chunk_id),
    frase: MATRIX.frase,
    documentscope: p.documentscope,
    filters,
    fondsId: p.fonds_id,
    peildatum: p.peildatum,
  };
}

// ── Een kleine PostgREST-interpreter voor de filters ────────────────────────
// SQL-semantiek zonder negatie: NULL in een vergelijking is "niet waar".
function waardeVan(r: ToelatingsRij, kolom: string): unknown {
  if (kolom.startsWith("documenten.")) return (r.documenten as Record<string, unknown> | null)?.[kolom.slice(11)] ?? null;
  return (r as unknown as Record<string, unknown>)[kolom] ?? null;
}
function splits(expr: string): string[] {
  const delen: string[] = [];
  let diepte = 0;
  let aanhaling = false;
  let huidig = "";
  for (let i = 0; i < expr.length; i++) {
    const t = expr[i];
    if (t === "\\" && aanhaling) {
      huidig += t + expr[++i];
      continue;
    }
    if (t === '"') aanhaling = !aanhaling;
    if (!aanhaling && t === "(") diepte++;
    if (!aanhaling && t === ")") diepte--;
    if (!aanhaling && diepte === 0 && t === ",") {
      delen.push(huidig);
      huidig = "";
    } else huidig += t;
  }
  delen.push(huidig);
  return delen;
}
const ontquote = (v: string) => (v.startsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v);
function term(r: ToelatingsRij, t: string): boolean {
  const logisch = t.match(/^(and|or)\(([^]*)\)$/);
  if (logisch) {
    const delen = splits(logisch[2]).map((d) => term(r, d));
    return logisch[1] === "and" ? delen.every(Boolean) : delen.some(Boolean);
  }
  const m = t.match(/^([a-z_.]+)\.(is|eq|neq|lte|gte|in)\.([^]*)$/);
  assert.ok(m, `onbekende filterterm: ${t}`);
  const [, kolom, op, rauw] = m;
  const x = waardeVan(r, kolom);
  if (op === "is") return rauw === "null" ? x === null : false;
  if (x === null) return false;
  if (op === "in") return splits(rauw.slice(1, -1)).map(ontquote).includes(String(x));
  const v = ontquote(rauw);
  const s = String(x);
  return op === "eq" ? s === v : op === "neq" ? s !== v : op === "lte" ? s <= v : s >= v;
}
function dbFilter(r: ToelatingsRij, frase: boolean, filters: Toelatingsfilter[]): boolean {
  return filters.every((f) => {
    if (f.op === "textSearch") return frase;
    if (f.op === "eq") return waardeVan(r, f.kolom) === f.waarde;
    if (f.op === "in") {
      const x = waardeVan(r, f.kolom);
      return x !== null && f.waarden.includes(String(x));
    }
    return splits(f.expressie).some((t) => term(r, t));
  });
}

/** Wat de nieuwe toelating in de database oplevert: RLS ∧ DB-filters ∧ predicaat. */
function toegelaten(s: Scenario, regels = TOELATINGSREGELS, filters = toelatingsfilters(parametersVan(s))): string[] {
  const p = parametersVan(s);
  return RIJEN.filter(({ m, r }) => zichtbaar(m) && dbFilter(r, m.frase, filters) && voldoetAanZoekfilters(r, p, regels))
    .map(({ m }) => m.sleutel)
    .sort();
}

// ── (T) Pariteit ────────────────────────────────────────────────────────────

test("#500-T0 — de matrix dekt de weigergronden uit de opdracht", () => {
  const sleutels = new Set(MATRIX.rijen.map((m) => m.sleutel));
  for (const nodig of [
    "b_ander_fonds", "f_concept", "g_concept", "f_gearchiveerd", "g_gearchiveerd", "f_inactief", "g_inactief",
    "f_geldig_tot_verstreken", "f_geldig_vanaf_toekomst", "g_review_verlopen", "f_bronstatus_uitgesloten",
    "g_bronstatus_historisch", "f_niet_aangewezen", "g_geen_frase",
  ]) assert.ok(sleutels.has(nodig), nodig);
  const namen = new Set(MATRIX.scenarios.map((s) => s.naam));
  for (const nodig of ["actueel_fonds_a", "bronsoort_fonds", "documentscope", "fonds_mismatch", "procesinstantie"]) {
    assert.ok(namen.has(nodig), nodig);
  }
});

for (const s of MATRIX.scenarios) {
  test(`#500-T1 — [${s.naam}] nieuwe toelating == verwacht (== zoek_chunks, zie DB-check M1)`, () => {
    assert.deepEqual(toegelaten(s), [...s.toegelaten].sort(), s.naam);
  });
}

test("#500-T2 — DB-filters en predicaat zijn consistent: de filters weigeren alleen wat het predicaat ook weigert", () => {
  // Regels die uitsluitend in het predicaat staan (chunk- én documentkolom).
  const alleenPredicaat = new Set(["fonds", "generiek_review"]);
  for (const s of MATRIX.scenarios) {
    const p = parametersVan(s);
    const filters = toelatingsfilters(p);
    for (const { m, r } of RIJEN) {
      const db = dbFilter(r, m.frase, filters);
      const zonderAlleenPredicaat = voldoetAanZoekfilters(r, p, TOELATINGSREGELS.filter((g) => !alleenPredicaat.has(g.naam)));
      assert.equal(db, m.frase && zonderAlleenPredicaat, `[${s.naam}] ${m.sleutel}: DB-filter ${db}, predicaat ${zonderAlleenPredicaat}`);
    }
  }
});

test("#500-T3 — de filters zijn id-begrensd en compleet voor het productiefilterblok", () => {
  const p: Toelatingsparameters = {
    ids: ["c2", "c1", "c1"],
    frase: '"artikel 150d" OR "art 150d"',
    documentscope: ["d1"],
    filters: { modus: "actueel", peildatum: "2026-09-29", bronsoort: ["fonds", "generiek"] },
    fondsId: "f-a",
    peildatum: "2026-09-29",
  };
  assert.deepEqual(toelatingsfilters(p), [
    { op: "in", kolom: "id", waarden: ["c1", "c2"] },
    { op: "eq", kolom: "documenten.actief", waarde: true },
    { op: "or", expressie: "documentstatus.is.null,documentstatus.neq.gearchiveerd" },
    { op: "textSearch", kolom: "zoek_vector", query: '"artikel 150d" OR "art 150d"', config: "dutch", type: "websearch" },
    { op: "in", kolom: "document_id", waarden: ["d1"] },
    { op: "in", kolom: "documentstatus", waarden: ["vastgesteld", "van_kracht"] },
    { op: "or", expressie: "bronstatus.is.null,bronstatus.eq.actief" },
    { op: "or", expressie: 'geldig_vanaf.is.null,geldig_vanaf.lte."2026-09-29"' },
    { op: "or", expressie: 'geldig_tot.is.null,geldig_tot.gte."2026-09-29"' },
    { op: "in", kolom: "bibliotheek", waarden: ["fonds", "generiek"] },
    {
      op: "or",
      expressie: "bibliotheek.is.null,bibliotheek.neq.generiek,and(documentstatus.eq.van_kracht,or(bronstatus.is.null,bronstatus.eq.actief))",
    },
  ]);
  assert.equal(ARTIKEL_OPZOEK_MAX, ARTIKEL_TOELATING_ID_MAX, "de toelating is nooit breder dan de opzoeking");

  // De builder past ze in volgorde toe op een supabase-js-achtige builder.
  const aanroepen: unknown[][] = [];
  const b = {
    in: (...a: unknown[]) => (aanroepen.push(["in", ...a]), b),
    eq: (...a: unknown[]) => (aanroepen.push(["eq", ...a]), b),
    or: (...a: unknown[]) => (aanroepen.push(["or", ...a]), b),
    textSearch: (...a: unknown[]) => (aanroepen.push(["textSearch", ...a]), b),
  };
  pasToelatingsfiltersToe(b, toelatingsfilters(p));
  assert.equal(aanroepen.length, 11);
  assert.deepEqual(aanroepen[3], ["textSearch", "zoek_vector", '"artikel 150d" OR "art 150d"', { config: "dutch", type: "websearch" }]);
});

test("#500-T4 — waarden in or-expressies worden gequote en ontsnapt", () => {
  const f = toelatingsfilters({
    ids: ["c1"],
    frase: "x",
    documentscope: null,
    filters: { bronstatus: ['actief', 'raar,"(waarde)'] },
    fondsId: null,
    peildatum: "2026-09-29",
  });
  const or = f.find((x) => x.op === "or" && x.expressie.startsWith("bronstatus.is.null"));
  assert.ok(or && or.op === "or");
  assert.equal(or.expressie, 'bronstatus.is.null,bronstatus.in.("actief","raar,\\"(waarde)")');
  const r = alsRij({ ...MATRIX.rijen[0], bronstatus: 'raar,"(waarde)' });
  assert.equal(term(r, splits(or.expressie)[1]), true);
});

// ── (N) Negatieve controle ─────────────────────────────────────────────────

test("#500-N2 — negatieve controle: elke toelatingsregel weglaten maakt minstens één scenario rood", () => {
  // Alleen RLS + frase + predicaat: het predicaat staat hier alleen, zoals als laatste grens.
  const alleenFrase: Toelatingsfilter[] = [
    { op: "textSearch", kolom: "zoek_vector", query: MATRIX.frase, config: "dutch", type: "websearch" },
  ];
  for (const s of MATRIX.scenarios) {
    assert.deepEqual(toegelaten(s, TOELATINGSREGELS, alleenFrase), [...s.toegelaten].sort(), `predicaat alleen: ${s.naam}`);
  }
  for (const regel of TOELATINGSREGELS) {
    const zonder = TOELATINGSREGELS.filter((g) => g !== regel);
    const rood = MATRIX.scenarios.filter(
      (s) => JSON.stringify(toegelaten(s, zonder, alleenFrase)) !== JSON.stringify([...s.toegelaten].sort())
    );
    assert.ok(rood.length > 0, `regel ${regel.naam} weglaten wordt door geen scenario opgemerkt`);
  }
});

test("#500-N3 — negatieve controle: een lek in de DB-filters wordt door het predicaat opgevangen, en zonder predicaat rood", () => {
  const s = MATRIX.scenarios.find((x) => x.naam === "actueel_fonds_a")!;
  const lek = toelatingsfilters(parametersVan(s)).filter((f) => !(f.op === "in" && f.kolom === "documentstatus"));
  // Met predicaat: nog steeds exact.
  assert.deepEqual(toegelaten(s, TOELATINGSREGELS, lek), [...s.toegelaten].sort());
  // Zonder predicaat (alleen de lekkende filters): rood — concept/status-null komen erdoor.
  const alleenDb = RIJEN.filter(({ m, r }) => zichtbaar(m) && dbFilter(r, m.frase, lek) && parametersVan(s).ids.includes(r.id))
    .map(({ m }) => m.sleutel);
  assert.ok(alleenDb.includes("f_concept"), "de lek-variant hoort f_concept door te laten");
});
