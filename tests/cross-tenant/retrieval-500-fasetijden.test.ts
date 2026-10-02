// ============================================================================
//  #500 — gecombineerde 150d-vraag: fasetijden en begrensde volscans.
// ----------------------------------------------------------------------------
//  Productie (02-10-2026): de gecombineerde vraag eindigde tweemaal na ~20 s in
//  `retrieval:timeout`, vóór enige modelcall en zonder governance-log. Gemeten
//  (read-only, als authenticated): elke `zoek_chunks`-aanroep is onder RLS een
//  volledige scan, en kost met een JWT van productieomvang 6–12 s tegen een
//  statement_timeout van 8 s. De FTS-keten deed er tot vier na elkaar
//  (strikt → verslapt → plain → ilike).
//
//  Deze suite toetst hermetisch:
//    F1–F3  de fasemeter: gedragsneutraal, inhoudsvrij, begrensd;
//    F4–F7  `voerFtsPogingenUit`: met `begrensVolscans` gelijktijdig (wandklok
//           max i.p.v. som) en met EXACT dezelfde uitkomst als sequentieel; na
//           een DB-time-out (57014) geen vangnet-volscan meer; zonder de vlag
//           byte-identiek aan vóór #500 (negatieve controle);
//    F8–F9  `voerHybridePogingenUit`: speculatieve G-12-verslapping, identieke
//           pogingen en meta;
//    F10    de Supabase-adapter zet de vlag ALLEEN bij een artikelfocus, en de
//           schakelaar `ARTIKELFOCUS_VOLSCANBEGRENZING=off` zet hem terug;
//    F11    de orkestratie schrijft óók bij een time-out één inhoudsvrije
//           `[retrieval][fasetijden]`-logregel.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  voerFtsPogingenUit,
  voerHybridePogingenUit,
  type DocumentChunk,
  type FtsDeps,
  type HybrideDeps,
} from "../../core/lib/rag";
import { bouwTerugvalFtsQuery } from "../../core/lib/fts-terugval";
import {
  FASEN,
  GEEN_FASEMETER,
  MAX_FASEMETINGEN,
  isDbTimeout,
  maakFasemeter,
  statusVanPostgrest,
} from "../../core/lib/retrieval/fasetijden";
import { RetrievalAfgebroken, isAfbreking, slaapMetSignaal } from "../../core/lib/retrieval/afbreken";
import { maakSupabaseAdapter } from "../../core/lib/retrieval/supabase-adapter";
import { voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import type { AdapterUitkomst, RetrievalAdapter, RetrievalContext, RetrievalQuery } from "../../core/lib/retrieval/contract";

const GECOMBINEERD =
  "Wat bepaalt artikel 150d Pensioenwet over het transitieplan en wat was volgens de memorie van toelichting de bedoeling daarvan?";
const STRIKT = "strikte-query";
const TERUGVAL = bouwTerugvalFtsQuery(GECOMBINEERD)!.query;
const DB_TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout" };
const ANDERE_FOUT = { code: "PGRST000", message: "verbinding" };

const slaap = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── F1–F3: de fasemeter ─────────────────────────────────────────────────────

test("#500-F1 — meet() is gedragsneutraal: uitkomst en fout gaan ongewijzigd door", async () => {
  let t = 1_000;
  const meter = maakFasemeter(() => t);
  const uitkomst = await meter.meet("rpc_fts", async () => {
    t += 40;
    return { data: [1, 2, 3], error: null };
  }, { poging: "strikt", rijen: (u) => u.data.length, status: (u) => statusVanPostgrest(u) });
  assert.deepEqual(uitkomst, { data: [1, 2, 3], error: null });
  const fout = new Error("boem");
  await assert.rejects(() => meter.meet("embedding", async () => { throw fout; }), (e) => e === fout);
  await assert.rejects(
    () => meter.meet("zoek", async () => { throw new RetrievalAfgebroken("timeout"); }),
    (e) => isAfbreking(e)
  );
  const s = meter.samenvatting("ok", 20_000);
  assert.deepEqual(s.fasen.map((f) => [f.fase, f.status, f.ms, f.rijen ?? null, f.poging ?? null]), [
    ["rpc_fts", "ok", 40, 3, "strikt"],
    ["embedding", "fout", 0, null, null],
    ["zoek", "afgebroken", 0, null, null],
  ]);
  assert.equal(s.budget_ms, 20_000);
  assert.equal(s.totaal_ms, 40);
  // De meter zonder staat voert het werk gewoon uit.
  assert.equal(await GEEN_FASEMETER.meet("zoek", async () => 7), 7);
  assert.deepEqual(GEEN_FASEMETER.samenvatting("ok").fasen, []);
});

test("#500-F2 — inhoudsvrij: gesloten sleutels, geen vraag-, query- of fouttekst in de samenvatting", async () => {
  const meter = maakFasemeter();
  const spoor = meter.voorSpoor(1);
  await spoor.meet("rpc_fts", async () => ({ data: [{ tekst: GECOMBINEERD }], error: { code: "57014", message: TERUGVAL } }), {
    poging: "terugval",
    rijen: (u) => u.data.length,
    status: (u) => statusVanPostgrest(u),
  });
  spoor.noteer("fts_plain", "overgeslagen");
  const s = meter.samenvatting("timeout", 20_000);
  const json = JSON.stringify(s);
  for (const verboden of [GECOMBINEERD, TERUGVAL, "150d", "Pensioenwet", "canceling statement"]) {
    assert.ok(!json.includes(verboden), `samenvatting bevat inhoud: ${verboden}`);
  }
  assert.deepEqual(Object.keys(s).sort(), ["afgekapt", "budget_ms", "fasen", "totaal_ms", "uitkomst", "versie"]);
  for (const f of s.fasen) {
    assert.ok((FASEN as readonly string[]).includes(f.fase));
    for (const k of Object.keys(f)) assert.ok(["fase", "spoor", "poging", "start_ms", "ms", "status", "rijen"].includes(k), k);
    assert.equal(f.spoor, 1);
  }
  assert.equal(s.fasen[0].status, "db_timeout");
  assert.equal(isDbTimeout(DB_TIMEOUT), true);
  assert.equal(isDbTimeout(ANDERE_FOUT), false);
});

test("#500-F3 — begrensd: hooguit MAX_FASEMETINGEN metingen, de rest geteld als afgekapt", async () => {
  const meter = maakFasemeter();
  for (let i = 0; i < MAX_FASEMETINGEN + 5; i++) meter.noteer("rpc_fts", "ok");
  const s = meter.samenvatting("ok");
  assert.equal(s.fasen.length, MAX_FASEMETINGEN);
  assert.equal(s.afgekapt, 5);
});

// ── F4–F7: de gerangschikte FTS-pogingen ────────────────────────────────────

type Antwoord = { data: unknown; error: unknown };
interface NepFts {
  deps: FtsDeps;
  aanroepen: { query: string; poging: string; start: number; eind: number }[];
  ongebruikt: number;
}

/** Nep-`zoek_chunks`: per query een antwoord en een duur; legt start/eind vast. */
function nepFts(
  antwoorden: { strikt: Antwoord; terugval: Antwoord },
  opties: { begrens: boolean; msPerAanroep?: number; signal?: AbortSignal }
): NepFts {
  const t0 = Date.now();
  const n: NepFts = { aanroepen: [], ongebruikt: 0, deps: undefined as unknown as FtsDeps };
  n.deps = {
    async draai(query, poging) {
      const rij = { query, poging, start: Date.now() - t0, eind: -1 };
      n.aanroepen.push(rij);
      await slaapMetSignaal(opties.msPerAanroep ?? 0, opties.signal);
      rij.eind = Date.now() - t0;
      return query === STRIKT ? antwoorden.strikt : antwoorden.terugval;
    },
    signal: opties.signal,
    begrensVolscans: opties.begrens,
    bijOngebruikt: () => {
      n.ongebruikt++;
    },
  };
  return n;
}

const RIJEN = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, document_id: "d", tekst: "t", rang: 1 }));

const SCENARIOS: { naam: string; strikt: Antwoord; terugval: Antwoord; zonder: string; met: string }[] = [
  { naam: "strikt levert rijen", strikt: { data: RIJEN(2), error: null }, terugval: { data: RIJEN(30), error: null }, zonder: "strikt", met: "strikt" },
  { naam: "strikt leeg, terugval rijen", strikt: { data: [], error: null }, terugval: { data: RIJEN(30), error: null }, zonder: "terugval", met: "terugval" },
  { naam: "beide leeg", strikt: { data: [], error: null }, terugval: { data: [], error: null }, zonder: "vangnet", met: "vangnet" },
  { naam: "strikt andere fout, terugval rijen", strikt: { data: null, error: ANDERE_FOUT }, terugval: { data: RIJEN(3), error: null }, zonder: "terugval", met: "terugval" },
  { naam: "strikt 57014, terugval rijen", strikt: { data: null, error: DB_TIMEOUT }, terugval: { data: RIJEN(3), error: null }, zonder: "terugval", met: "terugval" },
  { naam: "andere fouten", strikt: { data: null, error: ANDERE_FOUT }, terugval: { data: null, error: ANDERE_FOUT }, zonder: "vangnet", met: "vangnet" },
  // Het productiegeval: beide gerangschikte volscans breken op de 8 s-grens af.
  { naam: "beide 57014 (Productie)", strikt: { data: null, error: DB_TIMEOUT }, terugval: { data: null, error: DB_TIMEOUT }, zonder: "vangnet", met: "begrensd" },
  { naam: "strikt 57014, terugval leeg", strikt: { data: null, error: DB_TIMEOUT }, terugval: { data: [], error: null }, zonder: "vangnet", met: "begrensd" },
];

test("#500-F4 — dezelfde uitkomst met en zonder begrenzing; alleen 57014 maakt van het vangnet 'begrensd'", async () => {
  for (const s of SCENARIOS) {
    const zonder = await voerFtsPogingenUit(GECOMBINEERD, STRIKT, nepFts(s, { begrens: false }).deps);
    const met = await voerFtsPogingenUit(GECOMBINEERD, STRIKT, nepFts(s, { begrens: true }).deps);
    assert.equal(zonder.soort, s.zonder, `${s.naam} (zonder)`);
    assert.equal(met.soort, s.met, `${s.naam} (met)`);
    if (s.zonder === s.met) assert.deepEqual(met, zonder, `${s.naam}: uitkomst moet identiek zijn`);
  }
});

test("#500-F5 — zonder begrenzing byte-identiek aan vóór #500: sequentieel, terugval alleen na een lege strikte poging", async () => {
  const n = nepFts(SCENARIOS[0], { begrens: false, msPerAanroep: 20 });
  await voerFtsPogingenUit(GECOMBINEERD, STRIKT, n.deps);
  assert.deepEqual(n.aanroepen.map((a) => a.query), [STRIKT], "strikt met rijen: géén terugvalaanroep");
  const m = nepFts(SCENARIOS[1], { begrens: false, msPerAanroep: 20 });
  await voerFtsPogingenUit(GECOMBINEERD, STRIKT, m.deps);
  assert.deepEqual(m.aanroepen.map((a) => [a.query, a.poging]), [[STRIKT, "strikt"], [TERUGVAL, "terugval"]]);
  assert.ok(m.aanroepen[1].start >= m.aanroepen[0].eind, "zonder vlag start de terugval pas ná de strikte poging");
  assert.equal(m.ongebruikt, 0);
});

test("#500-F6 — met begrenzing lopen strikt en terugval gelijktijdig: wandklok max i.p.v. som", async () => {
  const MS = 120;
  const seq = nepFts(SCENARIOS[6], { begrens: false, msPerAanroep: MS });
  const t1 = Date.now();
  assert.equal((await voerFtsPogingenUit(GECOMBINEERD, STRIKT, seq.deps)).soort, "vangnet");
  const duurSeq = Date.now() - t1;
  const par = nepFts(SCENARIOS[6], { begrens: true, msPerAanroep: MS });
  const t2 = Date.now();
  assert.equal((await voerFtsPogingenUit(GECOMBINEERD, STRIKT, par.deps)).soort, "begrensd");
  const duurPar = Date.now() - t2;
  assert.ok(duurSeq >= 2 * MS - 5, `sequentieel hoort ≥ 2× een aanroep te duren (${duurSeq} ms)`);
  assert.ok(duurPar < 1.5 * MS, `gelijktijdig hoort < 1,5× een aanroep te duren (${duurPar} ms)`);
  assert.ok(par.aanroepen[1].start < par.aanroepen[0].eind, "de terugval start vóór de strikte poging klaar is");
  // Strikt wint: de speculatieve terugval is ongebruikt en zo gemeld.
  const winst = nepFts(SCENARIOS[0], { begrens: true, msPerAanroep: 10 });
  assert.equal((await voerFtsPogingenUit(GECOMBINEERD, STRIKT, winst.deps)).soort, "strikt");
  assert.equal(winst.ongebruikt, 1);
});

test("#500-F7 — een afbreking tijdens de strikte poging gooit door, zonder losse afwijzing van de terugval", async () => {
  const ctrl = new AbortController();
  const n = nepFts(SCENARIOS[1], { begrens: true, msPerAanroep: 200, signal: ctrl.signal });
  let losseAfwijzing = false;
  const opvanger = () => {
    losseAfwijzing = true;
  };
  process.on("unhandledRejection", opvanger);
  try {
    setTimeout(() => ctrl.abort(new RetrievalAfgebroken("timeout")), 20);
    await assert.rejects(() => voerFtsPogingenUit(GECOMBINEERD, STRIKT, n.deps), (e) => isAfbreking(e));
    await slaap(50);
  } finally {
    process.off("unhandledRejection", opvanger);
  }
  assert.equal(losseAfwijzing, false);
});

// ── F8–F9: de hybride pogingen ──────────────────────────────────────────────

function chunk(id: string, fts: number | null): DocumentChunk {
  return { id, document_id: `doc-${id}`, fts_rang: fts, vec_rang: 1 } as unknown as DocumentChunk;
}

function nepHybride(antwoorden: Record<string, DocumentChunk[] | null>, speculatief: boolean, ms = 0) {
  const aanroepen: { query: string; poging?: string; start: number; eind: number }[] = [];
  let ongebruikt = 0;
  const t0 = Date.now();
  const deps: HybrideDeps = {
    async draai(ftsQuery, _embedding, poging) {
      const rij = { query: ftsQuery, poging, start: Date.now() - t0, eind: -1 };
      aanroepen.push(rij);
      await slaap(ms);
      rij.eind = Date.now() - t0;
      return ftsQuery in antwoorden ? antwoorden[ftsQuery] : [];
    },
    async embed() {
      return [9];
    },
    ftsQueryVoor: (t) => `strikt(${t})`,
    ...(speculatief ? { speculatieveVerslapping: true, bijOngebruikt: () => void ongebruikt++ } : {}),
  };
  return { deps, aanroepen, ongebruikt: () => ongebruikt };
}

test("#500-F8 — speculatieve G-12-verslapping: identieke pogingen en meta in elk geval", async () => {
  const gevallen: Record<string, DocumentChunk[] | null>[] = [
    { [STRIKT]: [chunk("a", 1)], [TERUGVAL]: [chunk("b", 1)] }, // precisie werkte → geen verslapping
    { [STRIKT]: [chunk("a", null)], [TERUGVAL]: [chunk("b", 1)] }, // alleen vector → verslapping
    { [STRIKT]: [], [TERUGVAL]: [chunk("b", 1)] }, // niets → FTS-terugval, geen verslapping
    { [STRIKT]: null, [TERUGVAL]: [chunk("b", 1)] }, // primaire RPC-fout
    { [STRIKT]: [chunk("a", null)], [TERUGVAL]: null }, // verslapte RPC-fout: non-destructief
  ];
  for (const [i, antwoorden] of gevallen.entries()) {
    const seq = nepHybride(antwoorden, false);
    const spec = nepHybride(antwoorden, true);
    const a = await voerHybridePogingenUit(GECOMBINEERD, STRIKT, [1], undefined, seq.deps);
    const b = await voerHybridePogingenUit(GECOMBINEERD, STRIKT, [1], undefined, spec.deps);
    assert.deepEqual(b, a, `geval ${i}: uitkomst moet identiek zijn`);
    const gebruikt = a.soort === "pogingen" && a.pogingMeta.some((p) => p.naam === "verslapt");
    assert.equal(spec.ongebruikt(), gebruikt ? 0 : 1, `geval ${i}: ongebruikt-melding`);
  }
});

test("#500-F9 — speculatief start de verslapte hybride poging tegelijk met de primaire", async () => {
  const antwoorden = { [STRIKT]: [chunk("a", null)], [TERUGVAL]: [chunk("b", 1)] };
  const seq = nepHybride(antwoorden, false, 60);
  await voerHybridePogingenUit(GECOMBINEERD, STRIKT, [1], undefined, seq.deps);
  assert.ok(seq.aanroepen[1].start >= seq.aanroepen[0].eind, "zonder vlag: na elkaar");
  const spec = nepHybride(antwoorden, true, 60);
  await voerHybridePogingenUit(GECOMBINEERD, STRIKT, [1], undefined, spec.deps);
  const verslapt = spec.aanroepen.find((a) => a.poging === "verslapt")!;
  const primair = spec.aanroepen.find((a) => a.poging === "primair")!;
  assert.ok(verslapt.start < primair.eind, "met vlag: gelijktijdig");
});

// ── F10: de adapter zet de vlag alleen bij een artikelfocus ─────────────────

const CTX: RetrievalContext = {
  fondsId: "11111111-1111-4111-8111-111111111111",
  actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["fonds", "generiek", "notulen"] },
  correlationId: "corr-500-fasen",
  verzoekStartOp: new Date().toISOString(),
};
const QUERY = (over: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
  naam: "primair",
  origineleVraag: GECOMBINEERD,
  zoekvraag: GECOMBINEERD,
  strategie: "gericht",
  maxResultaten: 10,
  maxKandidaten: 30,
  maxContextTekens: 100_000,
  ...over,
});

test("#500-F10 — begrensVolscans uitsluitend bij een artikelfocus; schakelaar zet het oude gedrag terug", async () => {
  const gezien: Record<string, unknown>[] = [];
  const maak = () =>
    maakSupabaseAdapter({}, {}, {
      zoek: (async (...args: unknown[]) => {
        gezien.push(args[6] as Record<string, unknown>);
        return { chunks: [], meta: { methode: "geen", opgehaald: 0, geselecteerd: 0, chunks: [] } };
      }) as never,
      leesVersies: async () => new Map(),
      artikelkandidaten: async (b) => b,
    }).adapter;
  const focus = { artikelen: ["150d"], wet: "pw" as const };
  await maak().zoek(CTX, QUERY());
  await maak().zoek(CTX, QUERY({ artikelfocus: focus }));
  const vorig = process.env.ARTIKELFOCUS_VOLSCANBEGRENZING;
  process.env.ARTIKELFOCUS_VOLSCANBEGRENZING = "off";
  try {
    await maak().zoek(CTX, QUERY({ artikelfocus: focus }));
  } finally {
    if (vorig === undefined) delete process.env.ARTIKELFOCUS_VOLSCANBEGRENZING;
    else process.env.ARTIKELFOCUS_VOLSCANBEGRENZING = vorig;
  }
  assert.equal("begrensVolscans" in gezien[0], false, "zonder artikelfocus: de sleutel ontstaat niet (byte-identiek)");
  assert.equal("fasemeter" in gezien[0], false, "zonder meter op de context: geen meter in de opties");
  assert.equal(gezien[1].begrensVolscans, true, "met artikelfocus: begrensd");
  assert.equal("begrensVolscans" in gezien[2], false, "schakelaar uit: gedrag van vóór de hotfix");
});

// ── F11: de logregel bij een time-out ───────────────────────────────────────

test("#500-F11 — bij een retrieval-time-out schrijft de orkestratie één inhoudsvrije fasetijdenregel", async () => {
  const adapter: RetrievalAdapter = {
    naam: "supabase-rag",
    capabilities: () => ({
      bronsoorten: ["fonds", "generiek", "notulen"], strategieen: ["gericht"], ondersteundeFilters: [],
      versiebewijs: true, versiebeleid: { sterk: ["hash"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(ctx): Promise<AdapterUitkomst> {
      // Een "volscan" die de beurtdeadline overschrijdt, gemeten zoals de adapter dat doet.
      await (ctx.fasemeter ?? GEEN_FASEMETER).meet("rpc_fts", () => slaapMetSignaal(500, ctx.signal), { poging: "strikt" });
      return { kandidaten: [], methode: "geen", provider: "supabase", latencyMs: 0, opgehaald: 0 };
    },
  };
  const regels: string[] = [];
  const origWarn = console.warn;
  const origInfo = console.info;
  console.warn = (r: unknown) => void regels.push(String(r));
  console.info = (r: unknown) => void regels.push(String(r));
  try {
    await assert.rejects(
      () =>
        voerVolledigeRetrievalUit(
          CTX,
          { adapter, sporen: [{ query: QUERY(), grenzen: { maxPerDoc: 3, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false } }], timeoutMs: 60 },
          { primaireDocumentIds: new Set(), peildatum: "2026-10-02", hoofddocumentLabel: "" }
        ),
      (e) => isAfbreking(e)
    );
  } finally {
    console.warn = origWarn;
    console.info = origInfo;
  }
  const fasenregels = regels.filter((r) => r.startsWith("[retrieval][fasetijden] "));
  assert.equal(fasenregels.length, 1);
  const json = JSON.parse(fasenregels[0].slice("[retrieval][fasetijden] ".length));
  assert.equal(json.correlatie, "corr-500-fasen");
  assert.equal(json.uitkomst, "timeout");
  assert.equal(json.budget_ms, 60);
  const fasen = json.fasen
    .map((f: { fase: string; status: string; spoor: number | null }) => [f.fase, f.status, f.spoor])
    .sort((a: string[], b: string[]) => a[0].localeCompare(b[0]));
  assert.deepEqual(fasen, [["rpc_fts", "afgebroken", 0], ["zoek", "afgebroken", 0]]);
  assert.ok(!fasenregels[0].includes("150d") && !fasenregels[0].includes("Pensioenwet"), "geen vraagtekst in de logregel");
});

// ── F12: de logregel langs ÉLKE uitgang (#505-releasecheck leunt hierop) ─────
// De productieregressie-check telt `[retrieval][fasetijden]`-regels tegen het
// aantal gestelde vragen, juist omdat een afgebroken beurt geen governance-regel
// schrijft. Dat werkt alleen als de regel bij iedere afloop precies één keer
// verschijnt: ok, deadline (F11), annulering door de client en een onverwachte
// fout. Een harde platformkill (Vercel maxDuration 300 s) valt buiten elke
// `finally`; het retrievalbudget is begrensd op ≤ 60 s (TIMEOUT_MAX_MS), dus de
// deadline vuurt altijd eerst.

async function loopMetAdapter(
  zoek: RetrievalAdapter["zoek"],
  signal?: AbortSignal
): Promise<{ regels: { niveau: string; tekst: string }[]; fout: unknown }> {
  const adapter: RetrievalAdapter = {
    naam: "supabase-rag",
    capabilities: () => ({
      bronsoorten: ["fonds", "generiek", "notulen"], strategieen: ["gericht"], ondersteundeFilters: [],
      versiebewijs: true, versiebeleid: { sterk: ["hash"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    zoek,
  };
  const regels: { niveau: string; tekst: string }[] = [];
  const origWarn = console.warn;
  const origInfo = console.info;
  const origError = console.error;
  console.warn = (r: unknown) => void regels.push({ niveau: "warn", tekst: String(r) });
  console.info = (r: unknown) => void regels.push({ niveau: "info", tekst: String(r) });
  console.error = () => {};
  let fout: unknown = null;
  try {
    await voerVolledigeRetrievalUit(
      { ...CTX, ...(signal ? { signal } : {}) },
      { adapter, sporen: [{ query: QUERY(), grenzen: { maxPerDoc: 3, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false } }], timeoutMs: 5_000 },
      { primaireDocumentIds: new Set(), peildatum: "2026-10-02", hoofddocumentLabel: "" }
    );
  } catch (e) {
    fout = e;
  } finally {
    console.warn = origWarn;
    console.info = origInfo;
    console.error = origError;
  }
  return { regels: regels.filter((r) => r.tekst.startsWith("[retrieval][fasetijden] ")), fout };
}

const LEEG: AdapterUitkomst = { kandidaten: [], methode: "geen", provider: "supabase", latencyMs: 0, opgehaald: 0 };

test("#500-F12 — precies één fasetijdenregel bij ok, annulering én onverwachte fout", async () => {
  // ok
  const ok = await loopMetAdapter(async () => LEEG);
  assert.equal(ok.fout, null);
  assert.equal(ok.regels.length, 1, "ok: één regel");
  assert.equal(JSON.parse(ok.regels[0].tekst.slice(24)).uitkomst, "ok");
  assert.equal(ok.regels[0].niveau, "info");

  // annulering: de client breekt af terwijl de adapter nog loopt.
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 20);
  const afgebroken = await loopMetAdapter(async (ctx) => {
    await (ctx.fasemeter ?? GEEN_FASEMETER).meet("rpc_fts", () => slaapMetSignaal(500, ctx.signal), { poging: "strikt" });
    return LEEG;
  }, ctrl.signal);
  assert.ok(afgebroken.fout && isAfbreking(afgebroken.fout), "annulering gooit een afbreking door");
  assert.equal(afgebroken.regels.length, 1, "annulering: één regel");
  const a = JSON.parse(afgebroken.regels[0].tekst.slice(24));
  assert.equal(a.uitkomst, "annulering");
  assert.equal(afgebroken.regels[0].niveau, "warn");
  assert.ok(a.fasen.some((f: { fase: string; status: string }) => f.fase === "rpc_fts" && f.status === "afgebroken"));

  // onverwachte fout in de adapter (geen afbreking).
  const kapot = await loopMetAdapter(async () => {
    throw new Error("onverwacht");
  });
  assert.ok(kapot.fout instanceof Error && !isAfbreking(kapot.fout));
  assert.equal(kapot.regels.length, 1, "fout: één regel");
  assert.equal(JSON.parse(kapot.regels[0].tekst.slice(24)).uitkomst, "fout");
  assert.ok(!kapot.regels[0].tekst.includes("onverwacht"), "geen fouttekst in de logregel");
});

// ── F13: terminaal kenmerk, afloop en volgnummer (#505-releasecheck) ─────────
// De releasecheck beoordeelt per UNIEKE correlatie: precies één terminale regel,
// afloop `succes`. Daarvoor moet elke regel de correlatie (= request-id =
// retrieval_meta.correlation_id) dragen, als eindrecord herkenbaar zijn, en een
// herhaalde aanroep binnen dezelfde beurt zich als zodanig melden.

const regelJson = (r: { tekst: string }) => JSON.parse(r.tekst.slice("[retrieval][fasetijden] ".length));

test("#500-F13 — afloop succes/db_timeout/afgebroken/deadline/fout, terminaal en met correlatie", async () => {
  // succes
  const ok = regelJson((await loopMetAdapter(async () => LEEG)).regels[0]);
  assert.deepEqual([ok.terminaal, ok.afloop, ok.correlatie, ok.taak, ok.volgnummer, ok.uitkomst],
    [true, "succes", "corr-500-fasen", "chat_generatie", 1, "ok"]);

  // 57014 op een gerangschikte RPC, beurt zelf wel afgerond (de time-outroute).
  const viaTimeout = await loopMetAdapter(async (ctx) => {
    await (ctx.fasemeter ?? GEEN_FASEMETER).meet("rpc_fts", async () => ({ data: null, error: DB_TIMEOUT }), {
      poging: "strikt",
      status: statusVanPostgrest,
    });
    return LEEG;
  });
  const t = regelJson(viaTimeout.regels[0]);
  assert.equal(viaTimeout.regels.length, 1);
  assert.deepEqual([t.terminaal, t.uitkomst, t.afloop], [true, "ok", "db_timeout"]);

  // client-abort
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 20);
  const ab = await loopMetAdapter(async (ctx) => {
    await (ctx.fasemeter ?? GEEN_FASEMETER).meet("rpc_fts", () => slaapMetSignaal(500, ctx.signal), { poging: "strikt" });
    return LEEG;
  }, ctrl.signal);
  assert.equal(ab.regels.length, 1);
  assert.equal(regelJson(ab.regels[0]).afloop, "afgebroken");

  // fout
  const kapot = await loopMetAdapter(async () => {
    throw new Error("onverwacht");
  });
  assert.equal(kapot.regels.length, 1);
  assert.deepEqual([regelJson(kapot.regels[0]).terminaal, regelJson(kapot.regels[0]).afloop], [true, "fout"]);
});

test("#500-F13b — deadline: één terminale regel met afloop 'deadline'", async () => {
  const adapter: RetrievalAdapter = {
    naam: "supabase-rag",
    capabilities: () => ({
      bronsoorten: ["fonds", "generiek", "notulen"], strategieen: ["gericht"], ondersteundeFilters: [],
      versiebewijs: true, versiebeleid: { sterk: ["hash"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(ctx): Promise<AdapterUitkomst> {
      await (ctx.fasemeter ?? GEEN_FASEMETER).meet("rpc_fts", () => slaapMetSignaal(500, ctx.signal), { poging: "strikt" });
      return LEEG;
    },
  };
  const regels: string[] = [];
  const [w, i] = [console.warn, console.info];
  console.warn = (r: unknown) => void regels.push(String(r));
  console.info = (r: unknown) => void regels.push(String(r));
  try {
    await assert.rejects(() =>
      voerVolledigeRetrievalUit(
        CTX,
        { adapter, sporen: [{ query: QUERY(), grenzen: { maxPerDoc: 3, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false } }], timeoutMs: 40 },
        { primaireDocumentIds: new Set(), peildatum: "2026-10-02", hoofddocumentLabel: "" }
      )
    );
  } finally {
    [console.warn, console.info] = [w, i];
  }
  const f = regels.filter((r) => r.startsWith("[retrieval][fasetijden] "));
  assert.equal(f.length, 1);
  const j = JSON.parse(f[0].slice(24));
  assert.deepEqual([j.terminaal, j.afloop, j.uitkomst], [true, "deadline", "timeout"]);
});

test("#500-F13c — dubbele aanroep binnen één beurt: zelfde correlatie, volgnummer 1 en 2; aparte beurten elk 1", async () => {
  const meter = maakFasemeter();
  const regels: string[] = [];
  const [w, i] = [console.warn, console.info];
  console.warn = (r: unknown) => void regels.push(String(r));
  console.info = (r: unknown) => void regels.push(String(r));
  const adapter: RetrievalAdapter = {
    naam: "supabase-rag",
    capabilities: () => ({
      bronsoorten: ["fonds", "generiek", "notulen"], strategieen: ["gericht"], ondersteundeFilters: [],
      versiebewijs: true, versiebeleid: { sterk: ["hash"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    zoek: async () => LEEG,
  };
  const opdracht = { adapter, sporen: [{ query: QUERY(), grenzen: { maxPerDoc: 3, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false } }] as const, timeoutMs: 5_000 };
  const cit = { primaireDocumentIds: new Set<string>(), peildatum: "2026-10-02", hoofddocumentLabel: "" };
  try {
    await voerVolledigeRetrievalUit({ ...CTX, fasemeter: meter }, opdracht as never, cit);
    await voerVolledigeRetrievalUit({ ...CTX, fasemeter: meter }, opdracht as never, cit); // retry, zelfde beurt
    await voerVolledigeRetrievalUit({ ...CTX, correlationId: "corr-andere-beurt" }, opdracht as never, cit);
  } finally {
    [console.warn, console.info] = [w, i];
  }
  const j = regels.filter((r) => r.startsWith("[retrieval][fasetijden] ")).map((r) => JSON.parse(r.slice(24)));
  assert.deepEqual(j.map((x) => [x.correlatie, x.volgnummer, x.terminaal]), [
    ["corr-500-fasen", 1, true],
    ["corr-500-fasen", 2, true],
    ["corr-andere-beurt", 1, true],
  ]);
});
