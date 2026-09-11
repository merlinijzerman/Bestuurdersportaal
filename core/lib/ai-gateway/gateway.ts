// ============================================================================
//  core/lib/ai-gateway/gateway.ts — de centrale AI-gateway (kern, zonder I/O)
// ----------------------------------------------------------------------------
//  VOLGORDE PER CALL — elke controle vóór stap 5, fail-closed, geen fallback:
//    1. context: reservering (actieId), correlatie-id, taaktype;
//    2. configuratie: fonds × taakgroep → profiel/provider/model (DB, rol ai_gateway)
//       — óf, alleen platformbreed (fonds = null), een expliciete modelOverride
//       met het platformprofiel van die provider;
//    3. credentials: secret-/endpointreferentie → omgeving (code-allowlist);
//    4. poort: fn_ai_poort_check(provider, model) — LIVE kill switch + allowlist;
//    5. adapter: de providercall;
//    6. normaliseren + auditregel (best-effort, gestructureerde fout bij falen).
//
//  Alle afhankelijkheden zijn injecteerbaar; dit bestand importeert geen SDK,
//  geen Pool en geen server-only module, zodat het contract hermetisch te
//  testen is (core/lib/ai-gateway/gateway.test.ts).
// ============================================================================

import type { PoortContext, Provider as PoortProvider } from "../ai-poort";
import {
  TAAKGROEP_VAN_TAAKTYPE,
  isTaaktype,
  type AiGateway,
  type GatewayContext,
  type GenereerResultaat,
  type GenereerVerzoek,
  type Provider,
  type StreamHandle,
  type Taakgroep,
} from "./contract";
import { GatewayFout, classificeerProviderFout, isGatewayFout } from "./fout";
import { resolveerCredentials, type Credentials } from "./secrets";
import type { GatewayDb, GatewayLogRegel } from "./config-db";
import type { AdapterResultaat, AdapterVerzoek, ProviderAdapter } from "./adapters/types";

export interface GatewayDeps {
  db: GatewayDb;
  adapters: Partial<Record<Provider, ProviderAdapter>>;
  poortCheck: (ctx: PoortContext, provider: PoortProvider, model: string) => Promise<void>;
  env?: Record<string, string | undefined>;
  /** Gestructureerde registratie van een mislukte auditregel (R3). */
  logFout: (info: {
    label: string;
    correlatieId: string;
    fondsId: string | null;
    taaktype: string;
    fout: unknown;
  }) => void;
  nu?: () => number;
}

type Resolutie = {
  provider: Provider;
  model: string;
  profielId: string;
  configVersie: number | null;
  taakgroep: Taakgroep | null;
  credentials: Credentials;
  adapter: ProviderAdapter;
};

function eisContext(ctx: GatewayContext, verzoek: GenereerVerzoek): void {
  if (!ctx.correlatieId || ctx.correlatieId.length < 8) {
    throw new GatewayFout("configuratie", "correlatie_id_ontbreekt");
  }
  if (!ctx.actieId) {
    // Geen preflight-reservering = geen providercall. Zo kan geen hulpfunctie
    // het quotum of de idempotentie omzeilen (#311 §5).
    throw new GatewayFout("configuratie", "reservering_ontbreekt");
  }
  if (!isTaaktype(verzoek.taaktype)) {
    throw new GatewayFout("configuratie", "taaktype_onbekend");
  }
  if (!Number.isInteger(verzoek.maxTokens) || verzoek.maxTokens <= 0) {
    throw new GatewayFout("configuratie", "max_tokens_ongeldig");
  }
}

async function resolveer(deps: GatewayDeps, ctx: GatewayContext, verzoek: GenereerVerzoek): Promise<Resolutie> {
  const taakgroep = TAAKGROEP_VAN_TAAKTYPE[verzoek.taaktype];
  let provider: Provider;
  let model: string;
  let profielId: string;
  let configVersie: number | null;
  let refs: { secretRef: string; endpointRef: string | null };

  if (taakgroep === null) {
    // Platformbreed (AQLab): geen fonds, expliciete keuze binnen de allowlist.
    if (ctx.fondsId !== null) throw new GatewayFout("configuratie", "fonds_bij_platformbrede_taak");
    if (!verzoek.modelOverride) throw new GatewayFout("configuratie", "model_override_vereist");
    const profiel = await deps.db.leesPlatformProfiel(verzoek.modelOverride.provider);
    if (!profiel.ok) throw new GatewayFout("configuratie", profiel.reden);
    provider = profiel.provider;
    model = verzoek.modelOverride.model;
    profielId = profiel.profielId;
    configVersie = null;
    refs = { secretRef: profiel.secretRef, endpointRef: profiel.endpointRef };
  } else {
    if (!ctx.fondsId) throw new GatewayFout("configuratie", "fonds_ontbreekt");
    if (verzoek.modelOverride) {
      // Provider/model komen UITSLUITEND uit fonds + taakgroep; een override op
      // een fondsgebonden taak is per definitie een omzeiling.
      throw new GatewayFout("configuratie", "model_override_niet_toegestaan");
    }
    const cfg = await deps.db.leesConfig(ctx.fondsId, taakgroep);
    if (!cfg.ok) throw new GatewayFout("configuratie", cfg.reden);
    if (cfg.eigenaarFondsId !== null && cfg.eigenaarFondsId !== ctx.fondsId) {
      throw new GatewayFout("configuratie", "profiel_niet_van_fonds");
    }
    provider = cfg.provider;
    model = cfg.model;
    profielId = cfg.profielId;
    configVersie = cfg.versie;
    refs = { secretRef: cfg.secretRef, endpointRef: cfg.endpointRef };
  }

  const credentials = resolveerCredentials(refs, deps.env ?? process.env);
  const adapter = deps.adapters[provider];
  if (!adapter) throw new GatewayFout("configuratie", "adapter_ontbreekt");

  return { provider, model, profielId, configVersie, taakgroep, credentials, adapter };
}

function adapterVerzoek(verzoek: GenereerVerzoek, model: string): AdapterVerzoek {
  return {
    model,
    systeem: verzoek.systeem,
    berichten: verzoek.berichten,
    maxTokens: verzoek.maxTokens,
    temperature: verzoek.temperature,
    topP: verzoek.topP,
    tools: verzoek.tools,
    timeoutMs: verzoek.timeoutMs,
    signal: verzoek.signal,
    redeneermodel: verzoek.modelOverride?.redeneermodel,
    reasoningEffort: verzoek.modelOverride?.reasoningEffort ?? null,
  };
}

function resultaatCategorie(f: GatewayFout): GatewayLogRegel["resultaat"] {
  switch (f.categorie) {
    case "configuratie":
      return "configuratiefout";
    case "poort_gesloten":
      return "poort_gesloten";
    case "timeout":
      return "timeout";
    case "rate_limit":
      return "rate_limit";
    case "geannuleerd":
      return "geannuleerd";
    default:
      return "providerfout";
  }
}

export function maakGateway(deps: GatewayDeps): AiGateway {
  const nu = deps.nu ?? (() => Date.now());

  async function schrijfLog(
    ctx: GatewayContext,
    verzoek: GenereerVerzoek,
    res: Resolutie | null,
    uitkomst: { ok: true; r: AdapterResultaat } | { ok: false; fout: GatewayFout },
    latencyMs: number | null
  ): Promise<void> {
    const regel: GatewayLogRegel = {
      fonds_id: ctx.fondsId,
      actor_soort: ctx.actor.soort,
      actor_id: ctx.actor.soort === "gebruiker" ? ctx.actor.id : null,
      proces: ctx.actor.soort === "systeem" ? ctx.actor.proces : null,
      taaktype: verzoek.taaktype,
      taakgroep: res?.taakgroep ?? TAAKGROEP_VAN_TAAKTYPE[verzoek.taaktype],
      modaliteit: "tekst",
      provider: res?.provider ?? verzoek.modelOverride?.provider ?? "anthropic",
      model: res?.model ?? verzoek.modelOverride?.model ?? "onbepaald",
      profiel_id: res?.profielId ?? null,
      config_versie: res?.configVersie ?? null,
      poort_config_versie: null,
      resultaat: uitkomst.ok ? "ok" : resultaatCategorie(uitkomst.fout),
      stop_reden: uitkomst.ok ? uitkomst.r.stopReden : null,
      latency_ms: latencyMs,
      tokens_in: uitkomst.ok ? uitkomst.r.usage.in : 0,
      tokens_out: uitkomst.ok ? uitkomst.r.usage.out : 0,
      tokens_cache_lezen: uitkomst.ok ? uitkomst.r.usage.cacheLezen : 0,
      tokens_cache_creatie: uitkomst.ok ? uitkomst.r.usage.cacheCreatie : 0,
      tokens_totaal: uitkomst.ok ? uitkomst.r.usage.totaal : 0,
      correlatie_id: ctx.correlatieId,
      actie_id: ctx.actieId,
      label: ctx.label,
    };
    try {
      await deps.db.schrijfLog(regel);
    } catch (fout) {
      // Best-effort (reviewbesluit R3): een antwoord dat er al is, gaat niet
      // stuk op een administratieve schrijfactie — maar stil is het niet.
      deps.logFout({
        label: ctx.label,
        correlatieId: ctx.correlatieId,
        fondsId: ctx.fondsId,
        taaktype: verzoek.taaktype,
        fout,
      });
    }
  }

  function naarResultaat(res: Resolutie, r: AdapterResultaat): GenereerResultaat {
    return {
      tekst: r.tekst,
      inhoud: r.inhoud,
      stopReden: r.stopReden,
      usage: r.usage,
      latencyMs: r.latencyMs,
      provider: res.provider,
      model: res.model,
      profielId: res.profielId,
      configVersie: res.configVersie,
    };
  }

  async function voorbereiden(ctx: GatewayContext, verzoek: GenereerVerzoek): Promise<Resolutie> {
    let res: Resolutie;
    try {
      eisContext(ctx, verzoek);
      res = await resolveer(deps, ctx, verzoek);
      await deps.poortCheck({ supabase: ctx.supabase, label: ctx.label }, res.provider, res.model);
    } catch (e) {
      const fout = classificeerProviderFout(e, verzoek.signal);
      await schrijfLog(ctx, verzoek, null, { ok: false, fout }, null);
      throw fout;
    }
    return res;
  }

  return {
    async genereer(ctx, verzoek) {
      const res = await voorbereiden(ctx, verzoek);
      const start = nu();
      let r: AdapterResultaat;
      try {
        r = await res.adapter.genereer(adapterVerzoek(verzoek, res.model), res.credentials);
      } catch (e) {
        const fout = classificeerProviderFout(e, verzoek.signal);
        await schrijfLog(ctx, verzoek, res, { ok: false, fout }, nu() - start);
        throw fout;
      }
      await schrijfLog(ctx, verzoek, res, { ok: true, r }, r.latencyMs);
      return naarResultaat(res, r);
    },

    async stream(ctx, verzoek) {
      const res = await voorbereiden(ctx, verzoek);
      const start = nu();
      let adapterStream;
      try {
        adapterStream = res.adapter.stream(adapterVerzoek(verzoek, res.model), res.credentials);
      } catch (e) {
        const fout = classificeerProviderFout(e, verzoek.signal);
        await schrijfLog(ctx, verzoek, res, { ok: false, fout }, nu() - start);
        throw fout;
      }
      const handle: StreamHandle = {
        onTekst: (cb) => adapterStream.onTekst(cb),
        afronden: async () => {
          let r: AdapterResultaat;
          try {
            r = await adapterStream.afronden();
          } catch (e) {
            const fout = classificeerProviderFout(e, verzoek.signal);
            await schrijfLog(ctx, verzoek, res, { ok: false, fout }, nu() - start);
            throw fout;
          }
          await schrijfLog(ctx, verzoek, res, { ok: true, r }, r.latencyMs);
          return naarResultaat(res, r);
        },
      };
      return handle;
    },
  };
}

export { isGatewayFout };
