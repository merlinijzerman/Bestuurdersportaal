// ============================================================================
//  core/lib/ai-gateway/gateway.test.ts — contracttests van de AI-gateway (#311)
// ----------------------------------------------------------------------------
//  Hermetisch: gemockte configuratie-DB, gemockte adapter, gemockte poort. Elke
//  test bewijst één regel uit AI-GATEWAY-ONTWERP.md §3 / de acceptatiecriteria:
//  provider en model komen uitsluitend uit fonds + taaktype; spoofing wordt
//  genegeerd of geweigerd; onbekende configuratie/adapter/secret faalt gesloten
//  ZONDER netwerkcall; kill switch stopt vóór de gemockte netwerkcall; streaming
//  en non-streaming normaliseren usage/stopreden; timeout/annulering/rate-limit/
//  providerfout krijgen hun categorie; de auditregel bevat de vereiste velden en
//  nooit inhoud; een mislukte auditregel blokkeert het antwoord niet (R3).
// ============================================================================

import assert from "node:assert/strict";
import { test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { maakGateway, type GatewayDeps } from "./gateway";
import { GatewayFout, isGatewayFout } from "./fout";
import type { GatewayContext, GenereerVerzoek } from "./contract";
import type { ConfigUitkomst, GatewayDb, GatewayLogRegel, PlatformProfielUitkomst } from "./config-db";
import type { AdapterResultaat, AdapterVerzoek, ProviderAdapter } from "./adapters/types";
import { maakUsage } from "./adapters/types";

const FONDS_A = "a1111111-1111-1111-1111-1111111111a1";
const FONDS_B = "a2222222-2222-2222-2222-2222222222a2";

function ctx(over: Partial<GatewayContext> = {}): GatewayContext {
  return {
    supabase: {} as unknown as SupabaseClient,
    fondsId: FONDS_A,
    actor: { soort: "gebruiker", id: "b1111111-1111-1111-1111-111111111111" },
    actieId: "c1111111-1111-1111-1111-111111111111",
    correlatieId: "req-0001-abcdef",
    label: "chat.POST",
    ...over,
  };
}

function verzoek(over: Partial<GenereerVerzoek> = {}): GenereerVerzoek {
  return {
    taaktype: "chat_generatie",
    systeem: [{ type: "text", text: "GEHEIME SYSTEEMPROMPT" }],
    berichten: [{ role: "user", content: "GEHEIME VRAAG met persoonsgegevens" }],
    maxTokens: 5000,
    ...over,
  };
}

const configA: ConfigUitkomst = {
  ok: true,
  profielId: "platform-anthropic",
  profielVersie: 1,
  eigenaarFondsId: null,
  provider: "anthropic",
  model: "claude-opus-4-8",
  secretRef: "ANTHROPIC_API_KEY",
  endpointRef: null,
  versie: 3,
};

function db(over: Partial<GatewayDb> & { logboek?: GatewayLogRegel[] } = {}): GatewayDb & { logboek: GatewayLogRegel[] } {
  const logboek = over.logboek ?? [];
  return {
    logboek,
    leesConfig: over.leesConfig ?? (async (fondsId) => (fondsId === FONDS_A ? configA : { ok: false, reden: "config_ontbreekt" })),
    leesPlatformProfiel:
      over.leesPlatformProfiel ??
      (async (provider): Promise<PlatformProfielUitkomst> => ({
        ok: true,
        profielId: `platform-${provider}`,
        profielVersie: 1,
        provider,
        secretRef: provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "openai" ? "OPENAI_API_KEY" : "MISTRAL_API_KEY",
        endpointRef: null,
      })),
    schrijfLog:
      over.schrijfLog ??
      (async (regel) => {
        logboek.push(regel);
      }),
  };
}

function adapter(over: Partial<ProviderAdapter> & { calls?: AdapterVerzoek[] } = {}): ProviderAdapter & { calls: AdapterVerzoek[] } {
  const calls = over.calls ?? [];
  const ok = (v: AdapterVerzoek): AdapterResultaat => ({
    tekst: `antwoord op ${v.model}`,
    inhoud: [{ type: "text", text: `antwoord op ${v.model}` }],
    stopReden: "einde",
    usage: maakUsage({ in: 10, out: 4, cacheLezen: 2, cacheCreatie: 1 }),
    latencyMs: 12,
  });
  return {
    calls,
    provider: "anthropic",
    genereer:
      over.genereer ??
      (async (v) => {
        calls.push(v);
        return ok(v);
      }),
    stream:
      over.stream ??
      ((v) => {
        calls.push(v);
        let cb: ((d: string) => void) | null = null;
        return {
          onTekst(f) {
            cb = f;
          },
          async afronden() {
            cb?.("deel 1 ");
            cb?.("deel 2");
            return ok(v);
          },
        };
      }),
  };
}

const ENV = { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-oa-test" };

type TestDb = ReturnType<typeof db>;

function deps(
  over: Partial<Omit<GatewayDeps, "db">> & { db?: TestDb } = {}
): Omit<GatewayDeps, "db"> & { db: TestDb; poortAanroepen: string[]; fouten: unknown[] } {
  const poortAanroepen: string[] = [];
  const fouten: unknown[] = [];
  return {
    poortAanroepen,
    fouten,
    db: over.db ?? db(),
    adapters: over.adapters ?? { anthropic: adapter() },
    poortCheck:
      over.poortCheck ??
      (async (_c, provider, model) => {
        poortAanroepen.push(`${provider}:${model}`);
      }),
    env: over.env ?? ENV,
    logFout: over.logFout ?? ((info) => fouten.push(info)),
  };
}

async function faalt(p: Promise<unknown>): Promise<GatewayFout> {
  try {
    await p;
  } catch (e) {
    assert.ok(isGatewayFout(e), `verwachtte GatewayFout, kreeg ${String(e)}`);
    return e;
  }
  throw new Error("verwachtte een fout");
}

console.log("ai-gateway contracttests:");

test("provider en model komen uit fonds + taaktype; de call-site kiest niets", async () => {
  const d = deps();
  const gw = maakGateway(d);
  const r = await gw.genereer(ctx(), verzoek());
  const a = d.adapters.anthropic as ReturnType<typeof adapter>;
  assert.equal(a.calls[0]?.model, "claude-opus-4-8");
  assert.equal(r.model, "claude-opus-4-8");
  assert.equal(r.provider, "anthropic");
  assert.equal(r.profielId, "platform-anthropic");
  assert.equal(r.configVersie, 3);
  assert.deepEqual(d.poortAanroepen, ["anthropic:claude-opus-4-8"]);
});

test("een modelOverride op een fondsgebonden taak wordt GEWEIGERD zonder call", async () => {
  const d = deps();
  const gw = maakGateway(d);
  const f = await faalt(gw.genereer(ctx(), verzoek({ modelOverride: { provider: "openai", model: "gpt-5" } })));
  assert.equal(f.categorie, "configuratie");
  assert.equal(f.reden, "model_override_niet_toegestaan");
  assert.equal((d.adapters.anthropic as ReturnType<typeof adapter>).calls.length, 0);
  assert.deepEqual(d.poortAanroepen, []);
});

test("verkeerde fondscontext: geen configuratie → fail-closed, geen call, geen fallback", async () => {
  const d = deps();
  const gw = maakGateway(d);
  const f = await faalt(gw.genereer(ctx({ fondsId: FONDS_B }), verzoek()));
  assert.equal(f.categorie, "configuratie");
  assert.equal(f.reden, "config_ontbreekt");
  assert.equal((d.adapters.anthropic as ReturnType<typeof adapter>).calls.length, 0);
  const log = d.db.logboek.at(-1)!;
  assert.equal(log.resultaat, "configuratiefout");
  assert.equal(log.fonds_id, FONDS_B);
});

test("profiel van een ander fonds wordt geweigerd (defense-in-depth naast de DB)", async () => {
  const d = deps({ db: db({ leesConfig: async () => ({ ...configA, profielId: "klant-b", eigenaarFondsId: FONDS_B }) }) });
  const gw = maakGateway(d);
  const f = await faalt(gw.genereer(ctx(), verzoek()));
  assert.equal(f.reden, "profiel_niet_van_fonds");
});

test("ontbrekende reservering (actieId) → geen call", async () => {
  const d = deps();
  const f = await faalt(maakGateway(d).genereer(ctx({ actieId: null }), verzoek()));
  assert.equal(f.reden, "reservering_ontbreekt");
  assert.equal((d.adapters.anthropic as ReturnType<typeof adapter>).calls.length, 0);
});

test("ontbrekend secret, onbekende secret-ref en ontbrekende adapter falen gesloten zonder call", async () => {
  const geenSleutel = deps({ env: {} });
  let f = await faalt(maakGateway(geenSleutel).genereer(ctx(), verzoek()));
  assert.equal(f.reden, "secret_ontbreekt");

  const vreemdeRef = deps({ db: db({ leesConfig: async () => ({ ...configA, secretRef: "EVIL_REF" }) }) });
  f = await faalt(maakGateway(vreemdeRef).genereer(ctx(), verzoek()));
  assert.equal(f.reden, "secret_ref_onbekend");

  const geenAdapter = deps({ adapters: {} });
  f = await faalt(maakGateway(geenAdapter).genereer(ctx(), verzoek()));
  assert.equal(f.reden, "adapter_ontbreekt");
  assert.deepEqual(geenAdapter.poortAanroepen, []);
});

test("kill switch/allowlist (poort) blokkeert VÓÓR de gemockte netwerkcall", async () => {
  const d = deps({
    poortCheck: async () => {
      const e = new Error("dicht") as Error & { reden: string };
      e.name = "AiPoortGeslotenError";
      e.reden = "globaal_gestopt";
      throw e;
    },
  });
  const gw = maakGateway(d);
  const f = await faalt(gw.genereer(ctx(), verzoek()));
  assert.equal(f.categorie, "poort_gesloten");
  assert.equal(f.reden, "globaal_gestopt");
  assert.equal((d.adapters.anthropic as ReturnType<typeof adapter>).calls.length, 0);
  assert.equal(d.db.logboek.at(-1)?.resultaat, "poort_gesloten");
});

test("non-streaming: genormaliseerde usage, stopreden en auditregel zonder inhoud", async () => {
  const d = deps();
  const r = await maakGateway(d).genereer(ctx(), verzoek());
  assert.deepEqual(r.usage, { in: 10, out: 4, cacheLezen: 2, cacheCreatie: 1, totaal: 17 });
  assert.equal(r.stopReden, "einde");
  const log = d.db.logboek.at(-1)!;
  assert.equal(log.resultaat, "ok");
  assert.equal(log.taaktype, "chat_generatie");
  assert.equal(log.taakgroep, "generatie");
  assert.equal(log.provider, "anthropic");
  assert.equal(log.model, "claude-opus-4-8");
  assert.equal(log.profiel_id, "platform-anthropic");
  assert.equal(log.config_versie, 3);
  assert.equal(log.correlatie_id, "req-0001-abcdef");
  assert.equal(log.actie_id, "c1111111-1111-1111-1111-111111111111");
  assert.equal(log.tokens_totaal, 17);
  assert.equal(log.latency_ms, 12);
  const serialisatie = JSON.stringify(log);
  assert.doesNotMatch(serialisatie, /GEHEIME/);
  assert.doesNotMatch(serialisatie, /sk-ant/);
});

test("streaming: delta's komen door, afronden normaliseert en logt", async () => {
  const d = deps();
  const h = await maakGateway(d).stream(ctx(), verzoek());
  const delen: string[] = [];
  h.onTekst((t) => delen.push(t));
  const r = await h.afronden();
  assert.deepEqual(delen, ["deel 1 ", "deel 2"]);
  assert.equal(r.tekst, "antwoord op claude-opus-4-8");
  assert.equal(d.db.logboek.at(-1)?.resultaat, "ok");
});

test("timeout, annulering, rate-limit en providerfout krijgen hun categorie én auditregel", async () => {
  const gooi = (maak: () => unknown) =>
    deps({
      adapters: {
        anthropic: adapter({
          genereer: async () => {
            throw maak();
          },
        }),
      },
    });

  let d = gooi(() => Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }));
  let f = await faalt(maakGateway(d).genereer(ctx(), verzoek()));
  assert.equal(f.categorie, "timeout");
  assert.equal(d.db.logboek.at(-1)?.resultaat, "timeout");

  d = gooi(() => Object.assign(new Error("aborted"), { name: "APIUserAbortError" }));
  f = await faalt(maakGateway(d).genereer(ctx(), verzoek()));
  assert.equal(f.categorie, "geannuleerd");

  const ac = new AbortController();
  ac.abort();
  d = gooi(() => new Error("iets"));
  f = await faalt(maakGateway(d).genereer(ctx(), verzoek({ signal: ac.signal })));
  assert.equal(f.categorie, "geannuleerd");

  d = gooi(() => Object.assign(new Error("429"), { status: 429 }));
  f = await faalt(maakGateway(d).genereer(ctx(), verzoek()));
  assert.equal(f.categorie, "rate_limit");
  assert.equal(f.herhaalbaar, true);

  d = gooi(() => Object.assign(new Error("401"), { status: 401 }));
  f = await faalt(maakGateway(d).genereer(ctx(), verzoek()));
  assert.equal(f.categorie, "configuratie");

  d = gooi(() => Object.assign(new Error("500"), { status: 500 }));
  f = await faalt(maakGateway(d).genereer(ctx(), verzoek()));
  assert.equal(f.categorie, "provider");
  assert.equal(d.db.logboek.at(-1)?.resultaat, "providerfout");
});

test("een mislukte auditregel blokkeert het antwoord niet, maar wordt gestructureerd gemeld (R3)", async () => {
  const d = deps({
    db: db({
      schrijfLog: async () => {
        throw new Error("db weg");
      },
    }),
  });
  const r = await maakGateway(d).genereer(ctx(), verzoek());
  assert.equal(r.tekst, "antwoord op claude-opus-4-8");
  assert.equal(d.fouten.length, 1);
  const info = d.fouten[0] as { correlatieId: string; taaktype: string; label: string };
  assert.equal(info.correlatieId, "req-0001-abcdef");
  assert.equal(info.taaktype, "chat_generatie");
  assert.equal(info.label, "chat.POST");
});

test("platformbrede taak: fonds moet null zijn, override verplicht, platformprofiel geeft de referentie", async () => {
  const d = deps({ adapters: { anthropic: adapter(), openai: { ...adapter(), provider: "openai" } } });
  const gw = maakGateway(d);
  let f = await faalt(gw.genereer(ctx({ fondsId: FONDS_A }), verzoek({ taaktype: "aqlab_generatie", modelOverride: { provider: "openai", model: "gpt-5" } })));
  assert.equal(f.reden, "fonds_bij_platformbrede_taak");
  f = await faalt(gw.genereer(ctx({ fondsId: null }), verzoek({ taaktype: "aqlab_generatie" })));
  assert.equal(f.reden, "model_override_vereist");
  const r = await gw.genereer(
    ctx({ fondsId: null, actor: { soort: "systeem", proces: "aqlab" } }),
    verzoek({ taaktype: "aqlab_generatie", modelOverride: { provider: "openai", model: "gpt-5" } })
  );
  assert.equal(r.provider, "openai");
  assert.equal(r.model, "gpt-5");
  assert.equal(r.configVersie, null);
  assert.deepEqual(d.poortAanroepen, ["openai:gpt-5"]);
  assert.equal(d.db.logboek.at(-1)?.taakgroep, null);
  assert.equal(d.db.logboek.at(-1)?.proces, "aqlab");
});

test("onbekend taaktype en ongeldig tokenbudget falen gesloten", async () => {
  const d = deps();
  let f = await faalt(maakGateway(d).genereer(ctx(), verzoek({ taaktype: "bestaat_niet" as never })));
  assert.equal(f.reden, "taaktype_onbekend");
  f = await faalt(maakGateway(d).genereer(ctx(), verzoek({ maxTokens: 0 })));
  assert.equal(f.reden, "max_tokens_ongeldig");
});
