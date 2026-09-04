// ============================================================================
//  core/lib/ai-gateway/adapters/types.ts — het adaptercontract (technisch)
// ----------------------------------------------------------------------------
//  Een adapter kent alleen het provider-protocol: verzoek → resultaat/stream.
//  Productregels (fondstoegang, poort, quotum, audit) zitten in de gateway,
//  nooit hier. Adapters zijn de ENIGE bestanden met een provider-SDK of -endpoint
//  (tests/cross-tenant/ai-poort.test.ts).
// ============================================================================

import type {
  Bericht,
  NeutraleTool,
  Provider,
  ReasoningEffort,
  StopReden,
  TekstBlok,
  Usage,
} from "../contract";
import type { Credentials } from "../secrets";

export interface AdapterVerzoek {
  model: string;
  systeem: string | TekstBlok[];
  berichten: Bericht[];
  maxTokens: number;
  temperature?: number | null;
  topP?: number | null;
  tools?: NeutraleTool[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Reasoning-model (OpenAI o-serie/GPT-5): andere parametermapping. */
  redeneermodel?: boolean;
  reasoningEffort?: ReasoningEffort | null;
}

export interface AdapterResultaat {
  tekst: string;
  inhoud: unknown[];
  stopReden: StopReden;
  usage: Usage;
  latencyMs: number;
}

export interface AdapterStream {
  onTekst(cb: (delta: string) => void): void;
  afronden(): Promise<AdapterResultaat>;
}

export interface ProviderAdapter {
  readonly provider: Provider;
  genereer(verzoek: AdapterVerzoek, credentials: Credentials): Promise<AdapterResultaat>;
  /** Adapters zonder streaming gooien een GatewayFout("configuratie","streaming_niet_ondersteund"). */
  stream(verzoek: AdapterVerzoek, credentials: Credentials): AdapterStream;
}

export function legeUsage(): Usage {
  return { in: 0, out: 0, cacheLezen: 0, cacheCreatie: 0, totaal: 0 };
}

export function maakUsage(v: { in?: number; out?: number; cacheLezen?: number; cacheCreatie?: number }): Usage {
  const inn = v.in ?? 0;
  const out = v.out ?? 0;
  const cacheLezen = v.cacheLezen ?? 0;
  const cacheCreatie = v.cacheCreatie ?? 0;
  return { in: inn, out, cacheLezen, cacheCreatie, totaal: inn + cacheLezen + cacheCreatie + out };
}

/** Vouwt string of blokken tot één system-string (OpenAI/Mistral chat-completions). */
export function systeemNaarTekst(systeem: string | TekstBlok[]): string {
  if (typeof systeem === "string") return systeem;
  return systeem
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .filter((t) => t.length > 0)
    .join("\n\n");
}
