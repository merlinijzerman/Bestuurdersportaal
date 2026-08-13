// ============================================================================
//  core/lib/vergelijk-productie.ts — productie-wiring van de vergelijkmodus (T5).
// ----------------------------------------------------------------------------
//  De ONZUIVERE helft: bouwt een VergelijkDeps met de echte I/O — semantic_units
//  lezen (RLS-client), per-bron retrieval + parent-retrieval (rag.ts), Haiku voor
//  extra dimensies, Opus voor de LLM-waardevergelijking, en de append-only schrijf
//  via de SECURITY DEFINER-RPC fn_schrijf_vergelijking. De pure beslislogica leeft
//  in vergelijk-kern.ts; hier worden alleen de deps ingevuld. "server-only": raakt
//  ANTHROPIC_API_KEY en de Supabase-sessieclient.
//
//  TENANT: alle reads lopen via de meegegeven RLS-sessieclient (fonds-scope door
//  RLS); de schrijf-RPC bepaalt fonds_id server-side uit auth.uid(). Geen service-role.
// ============================================================================

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL } from "./generatie-kern";
import { HAIKU_MODEL } from "./llm-modellen";
import { deterministischVertrouwd } from "./vergelijk-config";
import { zoekRelevanteChunksMetMeta } from "./rag";
import type {
  ConceptLite,
  LLMVergelijkUitkomst,
  PassageLite,
  PersisteerInvoer,
  SemanticUnitLite,
  VergelijkDeps,
} from "./vergelijk-kern";
import type { Dimensie } from "./vergelijk-types";

// Reproduceerbaarheids-stempels (belanden in comparison_run). Bump bij een bewuste
// wijziging aan het prompt- of comparator-gedrag.
export const VERGELIJK_PROMPT_VERSIE = "t5-vergelijk-v1";
export const VERGELIJK_COMPARATOR_VERSIE = "t5-v1";
// Het synthese-/duidingsmodel voor het LLM-pad (Opus). Haiku doet alleen de
// dimensiebepaling; het geregistreerde run-model is het zwaarste model in de keten.
export const VERGELIJK_MODEL = AI_MODEL;

const MAX_PASSAGES_PER_ZIJDE = 4;
const MAX_EXTRA_DIMENSIES = 6;

let _client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

// ── Retrieval per (document, dimensie) ───────────────────────────────────────
// Scope op één document → gebalanceerd per bron (elke zijde krijgt een eigen budget,
// structureel sterker dan perSourceMin op een gecombineerde set). parentRetrieval aan
// voor de omliggende structuur-unit. Faalt zacht: bij een fout geen passages.
async function haalPassages(
  fondsId: string,
  documentId: string,
  dimensie: Dimensie
): Promise<PassageLite[]> {
  const vraag = `${dimensie.label} (${dimensie.key})`;
  try {
    const { chunks } = await zoekRelevanteChunksMetMeta(
      vraag,
      fondsId,
      MAX_PASSAGES_PER_ZIJDE,
      undefined,
      [documentId],
      {},
      { parentRetrieval: true }
    );
    return chunks.map((c) => ({
      tekst: c.aangeleverde_passage ?? c.tekst,
      page: c.pagina,
    }));
  } catch (e) {
    console.error(`[vergelijk] retrieval mislukt (doc ${documentId}, dim ${dimensie.key}):`, (e as Error).message);
    return [];
  }
}

// Zoek de pagina van de passage waaruit een evidence-zin (deels) komt, zodat de
// evidence-link een paginanummer draagt zonder het model dat te laten raden.
function paginaVoorEvidence(passages: PassageLite[], evidence: string | null): number | null {
  if (!evidence) return null;
  const naald = evidence.trim().slice(0, 40).toLowerCase();
  if (naald.length === 0) return null;
  for (const p of passages) {
    if (p.tekst.toLowerCase().includes(naald)) return p.page;
  }
  return passages[0]?.page ?? null;
}

// ── Haiku: extra (niet-catalogus) dimensies afleiden ─────────────────────────
const DIM_TOOL: Anthropic.Tool = {
  name: "stel_dimensies_voor",
  description:
    "Stel de bestuurlijke vergelijkingsdimensies voor die in BEIDE documenten spelen " +
    "en NOG NIET in de gegeven cataloguslijst staan. Alleen concrete, vergelijkbare " +
    "grootheden (parameters, bedragen, datums, beleidskeuzes).",
  input_schema: {
    type: "object",
    properties: {
      dimensies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "korte, stabiele sleutel, bv. 'premiedekkingsgraad'" },
            label: { type: "string", description: "leesbare naam" },
          },
          required: ["key", "label"],
        },
      },
    },
    required: ["dimensies"],
  },
};

async function haalExtraDimensies(
  fondsId: string,
  bronDocumentId: string,
  doelDocumentId: string,
  catalogus: Dimensie[]
): Promise<Dimensie[]> {
  try {
    // Representatieve passages van beide zijden (generieke bestuurlijke query).
    const generiek = "kernparameters, percentages, bedragen, datums en beleidskeuzes";
    const [bron, doel] = await Promise.all([
      zoekRelevanteChunksMetMeta(generiek, fondsId, 5, undefined, [bronDocumentId], {}, { parentRetrieval: true }),
      zoekRelevanteChunksMetMeta(generiek, fondsId, 5, undefined, [doelDocumentId], {}, { parentRetrieval: true }),
    ]);
    const tekstBron = bron.chunks.map((c) => c.aangeleverde_passage ?? c.tekst).join("\n---\n").slice(0, 8000);
    const tekstDoel = doel.chunks.map((c) => c.aangeleverde_passage ?? c.tekst).join("\n---\n").slice(0, 8000);
    const bekend = catalogus.map((d) => d.key).join(", ") || "(geen)";

    const resp = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 512,
      temperature: 0,
      system:
        "Je bent een analist die twee versies van een pensioenfonds-document vergelijkt. " +
        "Je benoemt uitsluitend concrete, vergelijkbare dimensies die in BEIDE teksten " +
        "voorkomen en niet al in de cataloguslijst staan. Verzin niets.",
      tools: [DIM_TOOL],
      tool_choice: { type: "tool", name: DIM_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `Cataloguslijst (niet herhalen): ${bekend}\n\n` +
            `DOCUMENT A (bron):\n"""\n${tekstBron}\n"""\n\n` +
            `DOCUMENT B (doel):\n"""\n${tekstDoel}\n"""`,
        },
      ],
    });
    const blok = resp.content.find((b) => b.type === "tool_use");
    if (!blok || blok.type !== "tool_use") return [];
    const input = blok.input as { dimensies?: { key?: string; label?: string }[] };
    const rijen = Array.isArray(input.dimensies) ? input.dimensies : [];
    const bekendSet = new Set(catalogus.map((d) => d.key.toLowerCase()));
    return rijen
      .filter((d) => d.key && d.label && !bekendSet.has(d.key.toLowerCase()))
      .slice(0, MAX_EXTRA_DIMENSIES)
      .map((d) => ({ key: d.key!.trim(), label: d.label!.trim(), herkomst: "llm" as const }));
  } catch (e) {
    console.error(`[vergelijk] dimensiebepaling mislukt:`, (e as Error).message);
    return [];
  }
}

// ── Opus: LLM-waardevergelijking per dimensie ────────────────────────────────
const CMP_TOOL: Anthropic.Tool = {
  name: "vergelijk_dimensie",
  description:
    "Bepaal de waarde van de dimensie in DOCUMENT A (bron) en DOCUMENT B (doel), met " +
    "een verbatim bronzin als bewijs, en of de twee waarden gelijk zijn. Laat een " +
    "waarde leeg (null) als de dimensie in dat document niet voorkomt. Verzin niets.",
  input_schema: {
    type: "object",
    properties: {
      bron_value: { type: ["string", "null"], description: "waarde in A, exact zoals in de tekst; null indien afwezig" },
      bron_evidence: { type: ["string", "null"], description: "verbatim bronzin uit A; null indien afwezig" },
      doel_value: { type: ["string", "null"], description: "waarde in B; null indien afwezig" },
      doel_evidence: { type: ["string", "null"], description: "verbatim bronzin uit B; null indien afwezig" },
      gelijk: { type: "boolean", description: "true als de waarden inhoudelijk gelijk zijn" },
    },
    required: ["bron_value", "doel_value", "gelijk"],
  },
};

function nummerPassages(passages: PassageLite[]): string {
  if (passages.length === 0) return "(geen passages gevonden)";
  return passages.map((p, i) => `[${i + 1}${p.page != null ? `, p.${p.page}` : ""}] ${p.tekst}`).join("\n\n");
}

async function vergelijkWaardeLLM(input: {
  dimensie: Dimensie;
  passagesBron: PassageLite[];
  passagesDoel: PassageLite[];
}): Promise<LLMVergelijkUitkomst> {
  const { dimensie, passagesBron, passagesDoel } = input;
  const leeg: LLMVergelijkUitkomst = {
    bron_value: null, bron_evidence: null, bron_page: null,
    doel_value: null, doel_evidence: null, doel_page: null, gelijk: false,
  };
  try {
    const resp = await anthropic().messages.create({
      model: VERGELIJK_MODEL,
      max_tokens: 700,
      temperature: 0,
      system:
        "Je vergelijkt één specifieke dimensie tussen twee versies van een pensioenfonds-" +
        "document. Neem bewijszinnen LETTERLIJK over. Bind een waarde alleen als de tekst " +
        "die ondubbelzinnig ondersteunt; bij twijfel of afwezigheid: null. Geen parafrase, verzin niets.",
      tools: [CMP_TOOL],
      tool_choice: { type: "tool", name: CMP_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `Dimensie: ${dimensie.label} (${dimensie.key})\n\n` +
            `DOCUMENT A (bron):\n${nummerPassages(passagesBron)}\n\n` +
            `DOCUMENT B (doel):\n${nummerPassages(passagesDoel)}`,
        },
      ],
    });
    const blok = resp.content.find((b) => b.type === "tool_use");
    if (!blok || blok.type !== "tool_use") return leeg;
    const r = blok.input as Partial<LLMVergelijkUitkomst>;
    const bron_evidence = (r.bron_evidence as string | null) ?? null;
    const doel_evidence = (r.doel_evidence as string | null) ?? null;
    return {
      bron_value: (r.bron_value as string | null) ?? null,
      bron_evidence,
      bron_page: paginaVoorEvidence(passagesBron, bron_evidence),
      doel_value: (r.doel_value as string | null) ?? null,
      doel_evidence,
      doel_page: paginaVoorEvidence(passagesDoel, doel_evidence),
      gelijk: r.gelijk === true,
    };
  } catch (e) {
    console.error(`[vergelijk] LLM-vergelijking mislukt (dim ${dimensie.key}):`, (e as Error).message);
    return leeg;
  }
}

// ── Semantic units + concepten lezen (RLS-client) ────────────────────────────
async function leesConcepten(supabase: SupabaseClient): Promise<ConceptLite[]> {
  const { data, error } = await supabase.from("concepts").select("id, key, label, type, status");
  if (error || !data) return [];
  return data as ConceptLite[];
}

async function leesSemanticUnits(supabase: SupabaseClient, documentId: string): Promise<SemanticUnitLite[]> {
  const { data, error } = await supabase
    .from("semantic_units")
    .select("concept_id, type, value_num, value_date, value_text, value_raw, value_unit, page, evidence")
    .eq("document_id", documentId);
  if (error || !data) return [];
  return data as SemanticUnitLite[];
}

// ── Persisteren via de DEFINER-RPC ───────────────────────────────────────────
async function persisteer(supabase: SupabaseClient, inv: PersisteerInvoer): Promise<string | null> {
  const p_findings = inv.findings.map((f) => ({
    finding_key: f.finding_key,
    dimensie: f.dimensie,
    concept_id: f.concept_id ?? null,
    bron_document_id: f.bron.document_id,
    bron_value: f.bron.value,
    bron_evidence: f.bron.evidence,
    bron_page: f.bron.page,
    doel_document_id: f.doel.document_id,
    doel_value: f.doel.value,
    doel_evidence: f.doel.evidence,
    doel_page: f.doel.page,
    verschil_type_ruw: f.verschil_type_ruw,
    method: f.method,
  }));
  const { data, error } = await supabase.rpc("fn_schrijf_vergelijking", {
    p_mode: inv.mode,
    p_model: inv.model,
    p_prompt_version: inv.promptVersion,
    p_comparator_version: inv.comparatorVersion,
    p_findings,
  });
  if (error) {
    console.error(`[vergelijk] persisteren mislukt:`, error.message);
    throw new Error(`vergelijking_persisteren: ${error.message}`);
  }
  return (data as string) ?? null;
}

// ── Deps-fabriek ─────────────────────────────────────────────────────────────
export function productieDeps(ctx: { supabase: SupabaseClient; fondsId: string }): VergelijkDeps {
  const { supabase, fondsId } = ctx;
  return {
    leesConcepten: () => leesConcepten(supabase),
    leesSemanticUnits: (documentId) => leesSemanticUnits(supabase, documentId),
    bepaalExtraDimensies: ({ bronDocumentId, doelDocumentId, catalogus }) =>
      haalExtraDimensies(fondsId, bronDocumentId, doelDocumentId, catalogus),
    retrieveerPassages: (documentId, dimensie) => haalPassages(fondsId, documentId, dimensie),
    vergelijkWaardeLLM,
    persisteer: (inv) => persisteer(supabase, inv),
    deterministischVertrouwd: deterministischVertrouwd(),
  };
}

// Versie-set voor de comparison_run-header.
export const VERGELIJK_VERSIES = {
  model: VERGELIJK_MODEL,
  promptVersion: VERGELIJK_PROMPT_VERSIE,
  comparatorVersion: VERGELIJK_COMPARATOR_VERSIE,
};
