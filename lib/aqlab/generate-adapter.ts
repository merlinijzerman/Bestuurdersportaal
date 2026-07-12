// lib/aqlab/generate-adapter.ts
// -----------------------------------------------------------------------------
// AQLab — generatie-adapter (AQL-2, technisch §5.2).
//
// Roept de BESTAANDE generatie-/retrievalkern aan (lib/generatie-kern.ts +
// lib/rag.ts maakContext) met volledig GEPINDE parameters: synthetische
// fixture-context → [Bron N]-labeling identiek aan productie, dezelfde
// system-prompt-builders, hetzelfde model/max_tokens. Zo test het Lab exact wat
// productie draait (temp/model/labels identiek).
//
// De adapter is puur t.o.v. de DB (geen Supabase); de orchestrator levert de
// (synthetische) fixture-teksten aan en schrijft het resultaat weg conform
// persist_mode.
// -----------------------------------------------------------------------------

import { maakContext, type DocumentChunk, type BronVerwijzing } from "@/lib/rag";
import {
  bouwSysteemBlokken,
  genereerAntwoord,
  SP_DOCUMENTEN_REGELS,
  ROL_LABEL,
  AI_MODEL,
  MAX_TOKENS,
  type BestuurderContext,
  type EffectieveInstellingen,
  type GenereerAntwoordParams,
} from "@/lib/generatie-kern";
import { sha256 } from "@/lib/aqlab/seed/canonical";
import { providerVanModel, isRedeneermodel, type ModelProvider, type ReasoningEffort } from "@/lib/aqlab/modellen";

/** Eén synthetische fixture-bron voor een testcase. */
export interface FixtureContext {
  fixture_id: string;
  titel: string;
  bron?: string;
  tekst: string;
}

export interface AdapterModelConfig {
  model?: string;
  /** Generatie-provider (AQL-6). Ontbreekt → afgeleid uit het model (default anthropic). */
  provider?: ModelProvider;
  /** Reasoning-model (o-serie/GPT-5)? Ontbreekt → afgeleid uit de allowlist. */
  redeneermodel?: boolean;
  /** Reasoning-effort (alleen bij reasoning-modellen). null = provider-default. */
  reasoningEffort?: ReasoningEffort | null;
  maxTokens?: number;
  /** null/undefined → provider-default overnemen (zoals productie). */
  temperature?: number | null;
  topP?: number | null;
  /** Gevraagde retrieval-instellingen (worden als effectief vastgelegd). */
  retrievalSettings?: Record<string, unknown>;
}

export interface AdapterParams {
  vraag: string;
  /** Gebruikersrol (bestuurder/voorzitter/beheerder) → rolLabel. */
  rol?: string;
  fondsnaam?: string;
  fixtures: FixtureContext[];
  modelConfig?: AdapterModelConfig;
  promptVersieId?: string | null;
  metVervolgvragen?: boolean;
  /** Injecteerbare Anthropic stream-client (hermetische tests). */
  client?: GenereerAntwoordParams["client"];
  /** Injecteerbare fetch voor de OpenAI/Mistral-adapters (hermetische provider-pariteitstest). */
  fetchImpl?: GenereerAntwoordParams["fetchImpl"];
}

export interface AdapterResultaat {
  antwoord: string;
  vervolgvragen: string[];
  contextTekst: string;
  bronnen: BronVerwijzing[];
  bronnenAantal: number;
  /** refs_only: welke fixtures zijn gebruikt (geen materialisatie). */
  snapshot_refs: { fixture_ids: string[] };
  /** sha256 over de canonieke, gebruikte fixture-teksten (reproduceerbaarheid). */
  snapshot_hash: string;
  effectieveInstellingen: EffectieveInstellingen;
  retrieval_settings_effective: Record<string, unknown>;
  tokengebruik: { in: number; out: number };
  latency_ms: number;
  citaties: { totaal: number; ongeldig: number };
}

// Gepinde, synthetische persona per rol (reproduceerbaar; geen echte persoon).
function bestuurderContext(rol: string | undefined, fondsnaam: string): BestuurderContext {
  const rolLabel = ROL_LABEL[rol ?? "bestuurder"] ?? "bestuurslid";
  return {
    voornaam: "Testbestuurder",
    volledigeNaam: "Testbestuurder (synthetisch)",
    rolLabel,
    fondsnaam,
  };
}

/** Bouwt DocumentChunk-compatibele objecten zodat maakContext identiek labelt. */
function fixturesNaarChunks(fixtures: FixtureContext[]): DocumentChunk[] {
  return fixtures.map((f, i) => ({
    id: `${f.fixture_id}#0`,
    document_id: f.fixture_id,
    tekst: f.tekst,
    pagina: null,
    paragraaf: null,
    chunk_index: i,
    documenten: {
      titel: f.titel,
      bron: f.bron ?? f.fixture_id,
      bibliotheek: "fonds",
      opslag_pad: null,
    },
  }));
}

/**
 * Genereert één antwoord met de productiekern op synthetische fixture-context.
 * Volledig gepind en reproduceerbaar; legt effectieve instellingen + snapshot-hash vast.
 */
export async function genereerViaAdapter(params: AdapterParams): Promise<AdapterResultaat> {
  const fondsnaam = params.fondsnaam ?? "Stichting Pensioenfonds Horizon";
  const cfg = params.modelConfig ?? {};
  const model = cfg.model ?? AI_MODEL;
  const maxTokens = cfg.maxTokens ?? MAX_TOKENS;
  // Provider expliciet van de config, anders afgeleid uit de (unieke) modelnaam.
  const provider = cfg.provider ?? providerVanModel(model);
  // Reasoning-model + effort: expliciet van de config, anders afgeleid uit de allowlist.
  const redeneermodel = cfg.redeneermodel ?? isRedeneermodel(model);
  const reasoningEffort = cfg.reasoningEffort ?? null;

  const chunks = fixturesNaarChunks(params.fixtures);
  const { contextTekst, bronnen } = maakContext(chunks);

  const ctx = bestuurderContext(params.rol, fondsnaam);
  // Strikte documenten-modus: identiek aan de productie-"documenten"-tak.
  const systeemBlokken = bouwSysteemBlokken(SP_DOCUMENTEN_REGELS, ctx, "feitelijk");
  const gebruikersPrompt =
    params.fixtures.length > 0
      ? `BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${params.vraag}`
      : `Er zijn geen relevante documenten gevonden voor deze vraag.\n\nVRAAG: ${params.vraag}\n\nGeef aan dat er geen relevante bronnen zijn gevonden en stel voor welk type document zou kunnen helpen.`;

  const gen = await genereerAntwoord({
    systeemBlokken,
    berichten: [{ role: "user", content: gebruikersPrompt }],
    model,
    provider,
    redeneermodel,
    reasoningEffort,
    maxTokens,
    temperature: cfg.temperature,
    topP: cfg.topP,
    metVervolgvragen: params.metVervolgvragen ?? true,
    bronnenAantal: bronnen.length,
    client: params.client,
    fetchImpl: params.fetchImpl,
  });

  // snapshot_hash: sha256 over de gebruikte, canonieke fixture-teksten.
  const snapshotBron = params.fixtures
    .map((f) => `${f.fixture_id}\n${f.tekst}`)
    .join("\n---\n");

  return {
    antwoord: gen.antwoord,
    vervolgvragen: gen.vervolgvragen,
    contextTekst,
    bronnen,
    bronnenAantal: bronnen.length,
    snapshot_refs: { fixture_ids: params.fixtures.map((f) => f.fixture_id) },
    snapshot_hash: sha256(snapshotBron),
    effectieveInstellingen: gen.effectieveInstellingen,
    retrieval_settings_effective: {
      strategie: "synthetic_fixtures",
      chunk_budget: params.fixtures.length,
      ...(cfg.retrievalSettings ?? {}),
    },
    tokengebruik: gen.tokengebruik,
    latency_ms: gen.latency_ms,
    citaties: gen.citaties,
  };
}
