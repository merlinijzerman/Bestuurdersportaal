import test from "node:test";
import assert from "node:assert/strict";
import { maakHybrideRpc, resolveerRetrievalVlaggen } from "../../core/lib/rag";
import { ZOEK_HYBRIDE_V2_ENV, zoekHybrideV2Actief } from "../../core/lib/retrieval/zoekhybride-vlag";
import { maakFasemeter } from "../../core/lib/retrieval/fasetijden";

function metEnv<T>(waarde: string | undefined, fn: () => T): T {
  const oud = process.env[ZOEK_HYBRIDE_V2_ENV];
  if (waarde === undefined) delete process.env[ZOEK_HYBRIDE_V2_ENV];
  else process.env[ZOEK_HYBRIDE_V2_ENV] = waarde;
  try { return fn(); } finally {
    if (oud === undefined) delete process.env[ZOEK_HYBRIDE_V2_ENV];
    else process.env[ZOEK_HYBRIDE_V2_ENV] = oud;
  }
}

type Aanroep = { fn: string; args: Record<string, unknown> };
function nepSupabase(antwoord: (fn: string) => { data: unknown; error: unknown }) {
  const aanroepen: Aanroep[] = [];
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      aanroepen.push({ fn, args });
      const builder = {
        abortSignal: () => builder,
        then: (ok: (v: unknown) => unknown, nok?: (e: unknown) => unknown) =>
          Promise.resolve(antwoord(fn)).then(ok, nok),
      };
      return builder;
    },
  };
  return { supabase, aanroepen };
}

const PARAMS = { p_limit: 30, p_fonds_id: "fonds-a", p_modus: "actueel", p_document_ids: ["doc-a"] };
const EMBEDDING = [0.1, 0.2, 0.3];

test("R1b: env-hoofdstop en expliciete fondsvlag, beide standaard uit", () => {
  for (const env of [undefined, "off", "true", "ON", ""]) {
    assert.equal(zoekHybrideV2Actief(env, true), false);
  }
  assert.equal(zoekHybrideV2Actief("on", undefined), false);
  assert.equal(zoekHybrideV2Actief("on", false), false);
  assert.equal(zoekHybrideV2Actief("on", true), true);
  assert.equal(metEnv(undefined, () => resolveerRetrievalVlaggen({ zoekHybrideV2: true }).zoekHybrideV2), false);
  assert.equal(metEnv("on", () => resolveerRetrievalVlaggen({}).zoekHybrideV2), false);
  assert.equal(metEnv("on", () => resolveerRetrievalVlaggen({ zoekHybrideV2: true }).zoekHybrideV2), true);
});

test("R1b: vlag uit = oude RPC zonder marker; vlag aan = alleen functienaam anders", async () => {
  const oud = nepSupabase(() => ({ data: [], error: null }));
  const nieuw = nepSupabase(() => ({ data: [], error: null }));
  const oudeMeter = maakFasemeter(() => 0);
  const nieuweMeter = maakFasemeter(() => 0);
  await maakHybrideRpc(oud.supabase, PARAMS, undefined, { meter: oudeMeter, zoekHybrideV2: false })("pensioen", EMBEDDING);
  await maakHybrideRpc(nieuw.supabase, PARAMS, undefined, { meter: nieuweMeter, zoekHybrideV2: true })("pensioen", EMBEDDING);
  assert.deepEqual(oud.aanroepen.map((a) => a.fn), ["zoek_chunks_hybride"]);
  assert.deepEqual(nieuw.aanroepen.map((a) => a.fn), ["zoek_chunks_hybride_begrensd"]);
  assert.equal(JSON.stringify(oud.aanroepen[0].args), JSON.stringify(nieuw.aanroepen[0].args));
  assert.ok(!("hybridezoekpad" in oudeMeter.samenvatting("ok")));
  assert.equal(nieuweMeter.samenvatting("ok").hybridezoekpad, "nieuw");
});

test("R1b: PGRST202 valt eenmaal terug, met auditmarker en zonder extra filters te verliezen", async () => {
  const { supabase, aanroepen } = nepSupabase((fn) => fn === "zoek_chunks_hybride_begrensd"
    ? { data: null, error: { code: "PGRST202" } }
    : { data: [], error: null });
  const meldingen: string[] = [];
  const meter = maakFasemeter(() => 0);
  const draai = maakHybrideRpc(supabase, PARAMS, undefined, {
    meter, zoekHybrideV2: true, waarschuw: (melding) => meldingen.push(melding),
  });
  await Promise.all([draai("strikt", EMBEDDING), draai("verslapt", EMBEDDING)]);
  await draai("origineel", EMBEDDING);
  assert.equal(aanroepen.filter((a) => a.fn === "zoek_chunks_hybride_begrensd").length, 2);
  assert.equal(aanroepen.filter((a) => a.fn === "zoek_chunks_hybride").length, 3);
  assert.equal(meldingen.length, 1);
  assert.equal(meter.samenvatting("ok").hybridezoekpad, "fallback_pgrst202");
  for (const a of aanroepen) {
    assert.equal(a.args.p_fonds_id, PARAMS.p_fonds_id);
    assert.deepEqual(a.args.p_document_ids, PARAMS.p_document_ids);
    assert.equal(a.args.p_modus, PARAMS.p_modus);
  }
});

test("R1b: 57014 en 42501 worden niet als PGRST202 gemaskeerd", async () => {
  for (const code of ["57014", "42501"]) {
    const { supabase, aanroepen } = nepSupabase(() => ({ data: null, error: { code } }));
    const meting = maakFasemeter(() => 0);
    const uit = await maakHybrideRpc(supabase, PARAMS, undefined, { meter: meting, zoekHybrideV2: true })("q", EMBEDDING);
    assert.equal(uit, null);
    assert.deepEqual(aanroepen.map((a) => a.fn), ["zoek_chunks_hybride_begrensd"]);
    assert.equal(meting.samenvatting("fout").hybridezoekpad, "nieuw");
  }
});
