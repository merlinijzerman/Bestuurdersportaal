// ============================================================================
//  core/lib/ai-gateway/config-db.ts — de enige verbinding van de gateway met
//  ai_gateway_private, via de minimale loginrol ai_gateway (reviewvoorwaarde 1)
// ----------------------------------------------------------------------------
//  Tenantroutes blijven op de RLS-client; deze Pool is server-only en kent
//  uitsluitend de vier benoemde functies. Elke fout is fail-closed: geen
//  configuratie = geen providercall.
// ============================================================================

import "server-only";
import { Pool } from "pg";
import { aiGatewayDbConfig } from "./config-db-core";
import { GatewayFout } from "./fout";
import type { Provider, Taakgroep } from "./contract";

export type ConfigUitkomst =
  | {
      ok: true;
      profielId: string;
      profielVersie: number;
      eigenaarFondsId: string | null;
      provider: Provider;
      model: string;
      secretRef: string;
      endpointRef: string | null;
      versie: number;
    }
  | { ok: false; reden: string };

export type PlatformProfielUitkomst =
  | { ok: true; profielId: string; profielVersie: number; provider: Provider; secretRef: string; endpointRef: string | null }
  | { ok: false; reden: string };

/** Inhoudsvrije logregel; de kolommen van ai_gateway_private.gateway_log. */
export interface GatewayLogRegel {
  fonds_id: string | null;
  actor_soort: "gebruiker" | "systeem";
  actor_id: string | null;
  proces: string | null;
  taaktype: string;
  taakgroep: Taakgroep | null;
  modaliteit?: "tekst" | "embedding" | "ocr";
  provider: Provider;
  model: string;
  profiel_id: string | null;
  config_versie: number | null;
  poort_config_versie: number | null;
  resultaat: "ok" | "configuratiefout" | "poort_gesloten" | "providerfout" | "timeout" | "rate_limit" | "geannuleerd";
  stop_reden: string | null;
  latency_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_lezen: number;
  tokens_cache_creatie: number;
  tokens_totaal: number;
  correlatie_id: string;
  actie_id: string | null;
  label: string | null;
}

export interface GatewayDb {
  leesConfig(fondsId: string, taakgroep: Taakgroep): Promise<ConfigUitkomst>;
  leesPlatformProfiel(provider: Provider): Promise<PlatformProfielUitkomst>;
  schrijfLog(regel: GatewayLogRegel): Promise<void>;
}

let pool: Pool | undefined;

function db(): Pool {
  if (pool) return pool;
  let config;
  try {
    config = aiGatewayDbConfig(process.env.AI_GATEWAY_DATABASE_URL, process.env.AI_GATEWAY_CA_CERT_BASE64, {
      sslUit: process.env.AI_GATEWAY_DB_SSL,
      doelomgeving: process.env.SEED_DOELOMGEVING,
    });
  } catch (e) {
    throw new GatewayFout("configuratie", "gateway_db_niet_geconfigureerd", { oorzaak: e });
  }
  pool = new Pool({
    connectionString: config.connectionString,
    max: 2,
    ssl: config.ssl === false ? false : { ca: config.ssl.ca, rejectUnauthorized: true },
    // Een hangende configuratielezing mag een chatbeurt niet eindeloos ophouden.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  return pool;
}

async function roep<T>(sql: string, args: unknown[]): Promise<T> {
  let rows: Array<{ r: T }>;
  try {
    const res = await db().query<{ r: T }>(sql, args);
    rows = res.rows;
  } catch (e) {
    if (e instanceof GatewayFout) throw e;
    // Serverlog krijgt de oorzaak; de aanroeper alleen de categorie.
    console.error("[ai-gateway] databasefout", e instanceof Error ? e.message : e);
    throw new GatewayFout("configuratie", "gateway_db_onbereikbaar", { oorzaak: e });
  }
  const r = rows[0]?.r;
  if (r === undefined || r === null) {
    throw new GatewayFout("configuratie", "gateway_db_leeg_antwoord");
  }
  return r;
}

function isProvider(w: unknown): w is Provider {
  return w === "anthropic" || w === "openai" || w === "mistral";
}

export const productieGatewayDb: GatewayDb = {
  async leesConfig(fondsId, taakgroep) {
    const r = await roep<Record<string, unknown>>("select ai_gateway_private.lees_config($1, $2) as r", [
      fondsId,
      taakgroep,
    ]);
    if (r.ok !== true) return { ok: false, reden: typeof r.reden === "string" ? r.reden : "config_onbegrepen" };
    if (
      typeof r.profiel_id !== "string" ||
      !isProvider(r.provider) ||
      typeof r.model !== "string" ||
      typeof r.secret_ref !== "string" ||
      typeof r.versie !== "number"
    ) {
      return { ok: false, reden: "config_onbegrepen" };
    }
    return {
      ok: true,
      profielId: r.profiel_id,
      profielVersie: typeof r.profiel_versie === "number" ? r.profiel_versie : 0,
      eigenaarFondsId: typeof r.eigenaar_fonds_id === "string" ? r.eigenaar_fonds_id : null,
      provider: r.provider,
      model: r.model,
      secretRef: r.secret_ref,
      endpointRef: typeof r.endpoint_ref === "string" ? r.endpoint_ref : null,
      versie: r.versie,
    };
  },

  async leesPlatformProfiel(provider) {
    const r = await roep<Record<string, unknown>>("select ai_gateway_private.lees_platform_profiel($1) as r", [
      provider,
    ]);
    if (r.ok !== true) return { ok: false, reden: typeof r.reden === "string" ? r.reden : "profiel_onbegrepen" };
    if (typeof r.profiel_id !== "string" || !isProvider(r.provider) || typeof r.secret_ref !== "string") {
      return { ok: false, reden: "profiel_onbegrepen" };
    }
    return {
      ok: true,
      profielId: r.profiel_id,
      profielVersie: typeof r.profiel_versie === "number" ? r.profiel_versie : 0,
      provider: r.provider,
      secretRef: r.secret_ref,
      endpointRef: typeof r.endpoint_ref === "string" ? r.endpoint_ref : null,
    };
  },

  async schrijfLog(regel) {
    await roep<string>("select ai_gateway_private.schrijf_log($1::jsonb) as r", [JSON.stringify(regel)]);
  },
};
