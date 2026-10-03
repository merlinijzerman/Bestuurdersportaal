// ============================================================================
//  R1 (besluit 0218) — `zoek_chunks_begrensd` achter de vlag ZOEK_TEKST_V2.
// ----------------------------------------------------------------------------
//  Hermetisch (geen database): de vlag-waarheidstabel, de RPC-keuze met
//  byte-gelijk parameterblok, de éénmalige PGRST202-terugval, de auditmarker
//  op de fasemeter (alleen met de vlag aan) en de brontekstinvarianten die de
//  census/afbreektest aannemen. Het databasebewijs (pariteit, plan, limiet,
//  tiebreaker) staat in supabase/checks/2026_10_03_r1_zoektekst_*.sql.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maakTekstRpc, resolveerRetrievalVlaggen, isPgrst202 } from "../../core/lib/rag";
import { zoekTekstV2Actief, ZOEK_TEKST_V2_ENV } from "../../core/lib/retrieval/zoektekst-vlag";
import { maakFasemeter, GEEN_FASEMETER } from "../../core/lib/retrieval/fasetijden";

function metEnv<T>(waarde: string | undefined, fn: () => T): T {
  const oud = process.env[ZOEK_TEKST_V2_ENV];
  if (waarde === undefined) delete process.env[ZOEK_TEKST_V2_ENV];
  else process.env[ZOEK_TEKST_V2_ENV] = waarde;
  try {
    return fn();
  } finally {
    if (oud === undefined) delete process.env[ZOEK_TEKST_V2_ENV];
    else process.env[ZOEK_TEKST_V2_ENV] = oud;
  }
}

type Aanroep = { fn: string; args: Record<string, unknown> };
function nepSupabase(antwoord: (fn: string) => { data: unknown; error: unknown }) {
  const aanroepen: Aanroep[] = [];
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      aanroepen.push({ fn, args });
      const uit = antwoord(fn);
      // Een PostgREST-builder: thenable én met abortSignal() (metSignaal).
      const builder = {
        abortSignal: () => builder,
        then: (ok: (v: unknown) => unknown, nok?: (e: unknown) => unknown) => Promise.resolve(uit).then(ok, nok),
      };
      return builder;
    },
  };
  return { supabase, aanroepen };
}
const PGRST202 = { code: "PGRST202", message: "Could not find the function public.zoek_chunks_begrensd" };
const PARAMS = { p_limit: 24, p_document_ids: null, p_modus: "actueel", p_fonds_id: "f-a" };

// ── Vlag-waarheidstabel ──────────────────────────────────────────────────────

test("R1-V1 — waarheidstabel: env is de hoofdstop, fondsvlag kan alleen uitzetten", () => {
  // env ontbreekt / ≠ on ⇒ altijd uit, wat de fondsvlag ook zegt.
  for (const env of [undefined, "off", "", "ON", "true", "1"]) {
    assert.equal(zoekTekstV2Actief(env, undefined), false, `env=${env}, fonds=∅`);
    assert.equal(zoekTekstV2Actief(env, true), false, `env=${env}, fonds=true`);
    assert.equal(zoekTekstV2Actief(env, false), false, `env=${env}, fonds=false`);
  }
  // env on ⇒ default aan; fondsvlag false zet per fonds uit.
  assert.equal(zoekTekstV2Actief("on", undefined), true);
  assert.equal(zoekTekstV2Actief("on", true), true);
  assert.equal(zoekTekstV2Actief("on", false), false);
});

test("R1-V2 — resolveerRetrievalVlaggen past de hoofdstop opnieuw toe op een meegegeven vlag", () => {
  // Een aanroeper die `zoekTekstV2: true` meegeeft zonder env `on` krijgt uit.
  assert.equal(metEnv(undefined, () => resolveerRetrievalVlaggen({ zoekTekstV2: true }).zoekTekstV2), false);
  assert.equal(metEnv("off", () => resolveerRetrievalVlaggen({ zoekTekstV2: true }).zoekTekstV2), false);
  assert.equal(metEnv("on", () => resolveerRetrievalVlaggen({ zoekTekstV2: true }).zoekTekstV2), true);
  assert.equal(metEnv("on", () => resolveerRetrievalVlaggen({ zoekTekstV2: false }).zoekTekstV2), false);
  // Zonder meegegeven vlag: env on = aan (fonds zonder rij), anders uit.
  assert.equal(metEnv("on", () => resolveerRetrievalVlaggen({}).zoekTekstV2), true);
  assert.equal(metEnv(undefined, () => resolveerRetrievalVlaggen({}).zoekTekstV2), false);
  assert.equal(metEnv(undefined, () => resolveerRetrievalVlaggen(undefined).zoekTekstV2), false);
});

// ── RPC-keuze en parameterblok ───────────────────────────────────────────────

test("R1-R1 — vlag uit: uitsluitend zoek_chunks, geen marker (byte-gelijk aan vóór R1)", async () => {
  const { supabase, aanroepen } = nepSupabase(() => ({ data: [{ id: "x" }], error: null }));
  const rpc = maakTekstRpc(supabase, PARAMS, { zoekTekstV2: false });
  const uit = await rpc.draai("transitieplan");
  assert.deepEqual(uit, { data: [{ id: "x" }], error: null });
  assert.deepEqual(aanroepen.map((a) => a.fn), ["zoek_chunks"]);
  assert.equal(rpc.pad(), undefined);
});

test("R1-R2 — vlag aan: zoek_chunks_begrensd met EXACT hetzelfde parameterblok (sleutels, volgorde, waarden)", async () => {
  const uitkomst = { data: [{ id: "y" }], error: null };
  const oud = nepSupabase(() => uitkomst);
  const nieuw = nepSupabase(() => uitkomst);
  await maakTekstRpc(oud.supabase, PARAMS, { zoekTekstV2: false }).draai("bedoeling wetgever");
  const rpc = maakTekstRpc(nieuw.supabase, PARAMS, { zoekTekstV2: true });
  const uit = await rpc.draai("bedoeling wetgever");
  assert.deepEqual(uit, uitkomst);
  assert.deepEqual(nieuw.aanroepen.map((a) => a.fn), ["zoek_chunks_begrensd"]);
  // Zelfde JSON-body (sleutelvolgorde inbegrepen): alleen de functienaam verschilt.
  assert.equal(JSON.stringify(nieuw.aanroepen[0].args), JSON.stringify(oud.aanroepen[0].args));
  assert.deepEqual(Object.keys(nieuw.aanroepen[0].args), ["p_query", "p_limit", "p_document_ids", "p_modus", "p_fonds_id"]);
  assert.equal(rpc.pad(), "nieuw");
});

test("R1-R3 — PGRST202: éénmalige terugval op zoek_chunks, één warn, marker fallback_pgrst202", async () => {
  const { supabase, aanroepen } = nepSupabase((fn) =>
    fn === "zoek_chunks_begrensd" ? { data: null, error: PGRST202 } : { data: [{ id: "z" }], error: null }
  );
  const meldingen: string[] = [];
  const rpc = maakTekstRpc(supabase, PARAMS, { zoekTekstV2: true, waarschuw: (m) => meldingen.push(m) });
  const strikt = await rpc.draai("a b");
  assert.deepEqual(strikt, { data: [{ id: "z" }], error: null }, "de terugval levert de oude uitkomst");
  // Een tweede poging in dezelfde retrieval gaat DIRECT naar zoek_chunks.
  await rpc.draai("a or b");
  assert.deepEqual(aanroepen.map((a) => a.fn), ["zoek_chunks_begrensd", "zoek_chunks", "zoek_chunks"]);
  assert.equal(aanroepen[1].args.p_query, "a b");
  assert.equal(aanroepen[2].args.p_query, "a or b");
  assert.equal(meldingen.length, 1, "precies één warn-regel per retrieval");
  assert.match(meldingen[0], /\[retrieval\]\[tekstzoekpad\].*PGRST202/);
  assert.equal(rpc.pad(), "fallback_pgrst202");
});

test("R1-R4 — gelijktijdige pogingen (speculatieve terugval) delen de grendel: één warn", async () => {
  const { supabase, aanroepen } = nepSupabase((fn) =>
    fn === "zoek_chunks_begrensd" ? { data: null, error: PGRST202 } : { data: [], error: null }
  );
  const meldingen: string[] = [];
  const rpc = maakTekstRpc(supabase, PARAMS, { zoekTekstV2: true, waarschuw: (m) => meldingen.push(m) });
  await Promise.all([rpc.draai("strikt"), rpc.draai("verslapt")]);
  assert.equal(meldingen.length, 1);
  assert.equal(aanroepen.filter((a) => a.fn === "zoek_chunks").length, 2);
  assert.equal(rpc.pad(), "fallback_pgrst202");
});

test("R1-R5 — andere fouten (57014, 42501, lege uitkomst) worden NIET gemaskeerd door een terugval", async () => {
  for (const error of [{ code: "57014" }, { code: "42501" }, { code: "P0R01", message: "zoek_chunks_begrensd: p_limit > 1000" }]) {
    const { supabase, aanroepen } = nepSupabase(() => ({ data: null, error }));
    const meldingen: string[] = [];
    const rpc = maakTekstRpc(supabase, PARAMS, { zoekTekstV2: true, waarschuw: (m) => meldingen.push(m) });
    const uit = await rpc.draai("q");
    assert.deepEqual(uit.error, error);
    assert.deepEqual(aanroepen.map((a) => a.fn), ["zoek_chunks_begrensd"], `fout ${error.code}`);
    assert.equal(meldingen.length, 0);
    assert.equal(rpc.pad(), "nieuw");
  }
  // Nul rijen is een gewone uitkomst, geen terugval.
  const leeg = nepSupabase(() => ({ data: [], error: null }));
  const rpc = maakTekstRpc(leeg.supabase, PARAMS, { zoekTekstV2: true });
  await rpc.draai("q");
  assert.deepEqual(leeg.aanroepen.map((a) => a.fn), ["zoek_chunks_begrensd"]);
  assert.equal(isPgrst202(PGRST202), true);
  assert.equal(isPgrst202({ code: "PGRST201" }), false);
  assert.equal(isPgrst202(null), false);
});

// ── Auditmarker op de fasemeter ──────────────────────────────────────────────

test("R1-M1 — zonder marker is de samenvatting byte-gelijk aan vóór R1 (geen sleutel tekstzoekpad)", () => {
  const meter = maakFasemeter(() => 0);
  const s = meter.samenvatting("ok", 20_000);
  assert.ok(!("tekstzoekpad" in s));
  assert.deepEqual(Object.keys(s), ["versie", "uitkomst", "totaal_ms", "budget_ms", "afgekapt", "fasen"]);
  assert.ok(!("tekstzoekpad" in GEEN_FASEMETER.samenvatting("ok")));
  GEEN_FASEMETER.markeerTekstzoekpad("nieuw"); // no-op
  assert.ok(!("tekstzoekpad" in GEEN_FASEMETER.samenvatting("ok")));
});

test("R1-M2 — marker: nieuw, en fallback_pgrst202 wint beurtbreed (over sporen heen)", () => {
  const meter = maakFasemeter(() => 0);
  meter.voorSpoor(1).markeerTekstzoekpad("nieuw");
  assert.equal(meter.samenvatting("ok").tekstzoekpad, "nieuw");
  meter.voorSpoor(2).markeerTekstzoekpad("fallback_pgrst202");
  meter.voorSpoor(1).markeerTekstzoekpad("nieuw");
  assert.equal(meter.samenvatting("ok").tekstzoekpad, "fallback_pgrst202", "één terugval maakt de beurt een terugvalbeurt");
  // Gesloten enum: geen vraag-, query- of functietekst in de samenvatting.
  const json = JSON.stringify(meter.samenvatting("ok"));
  assert.ok(!/zoek_chunks|transitieplan|PGRST/.test(json));
});

// ── Brontekstinvarianten (census, afbreektest, releasecheck) ─────────────────

test("R1-B1 — beide RPC-namen staan letterlijk in rag.ts en lopen door metSignaal; geen schaduwmodus", () => {
  const rag = readFileSync(new URL("../../core/lib/rag.ts", import.meta.url), "utf8");
  assert.match(rag, /metSignaal\(supabase\.rpc\("zoek_chunks_begrensd", /);
  assert.match(rag, /metSignaal\(supabase\.rpc\("zoek_chunks", /);
  // Precies één aanroepplek per naam: geen tweede (schaduw)aanroep van de oude functie.
  assert.equal([...rag.matchAll(/supabase\.rpc\("zoek_chunks_begrensd"/g)].length, 1);
  assert.equal([...rag.matchAll(/supabase\.rpc\("zoek_chunks"/g)].length, 1);
});

test("R1-B2 — de releasecheck telt fallback_pgrst202 en db_timeout rood en leest de marker uit invoer.retrieval_fasetijden", () => {
  const sql = readFileSync(new URL("../../supabase/checks/2026_10_03_r1_releasecheck_productie.sql", import.meta.url), "utf8");
  assert.match(sql, /'invoer'->'retrieval_fasetijden'/);
  assert.match(sql, /tekstzoekpad/);
  assert.match(sql, /fallback_pgrst202/);
  assert.match(sql, /db_timeout/);
  assert.match(sql, /fasen_db_timeout = 0/);
  assert.match(sql, /fallback_pgrst202 = 0/);
});
