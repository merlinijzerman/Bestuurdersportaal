// ============================================================================
//  core/lib/vergelijk-productie.ts — productie-wiring van de vergelijkmodus (T5).
// ----------------------------------------------------------------------------
//  De ONZUIVERE helft: bouwt een VergelijkDeps met de echte I/O — semantic_units
//  lezen (RLS-client), per-bron retrieval via adapter + orkestratie, Haiku voor
//  extra dimensies, Opus voor de LLM-waardevergelijking, en de append-only schrijf
//  via de SECURITY DEFINER-RPC fn_schrijf_vergelijking. De pure beslislogica leeft
//  in vergelijk-kern.ts; hier worden alleen de deps ingevuld. "server-only": raakt
//  ANTHROPIC_API_KEY en de Supabase-sessieclient.
//
//  TENANT: alle reads lopen via de meegegeven RLS-sessieclient (fonds-scope door
//  RLS); de schrijf-RPC bepaalt fonds_id server-side uit auth.uid(). Geen service-role.
// ============================================================================

import "server-only";
import type { AiGateway, GatewayContext, NeutraleTool } from "./ai-gateway/contract";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL } from "./generatie-kern";
import { deterministischVertrouwd } from "./vergelijk-config";
import type { RetrievalOpties } from "./rag";
import { voerVolledigeRetrievalUit } from "./retrieval/orkestratie";
import { bewaakNaIO, isAfbreking } from "./retrieval/afbreken";
import type { Bronresultaat, RetrievalAdapter, RetrievalContext, RetrievalUitkomst } from "./retrieval/contract";
import { maakDocumentIdentiteit } from "./retrieval/identiteit";
import { citaatOpdracht, maakVergelijkSpoor } from "./retrieval/productiepaden-core";
import type {
  ConceptLite,
  LLMVergelijkUitkomst,
  PassageLite,
  PersisteerInvoer,
  SemanticUnitLite,
  VergelijkDeps,
} from "./vergelijk-kern";
import type { Dimensie, VergelijkBron, VergelijkRetrievalMeta, VergelijkRetrievalPoging } from "./vergelijk-types";

/** #311: beide modelcalls lopen door de AI-gateway (fondsconfiguratie + poort + audit). */
type GatewayDeps = { gateway: AiGateway; ctx: GatewayContext };

/** Eerste tool_use-blok uit de ruwe providerinhoud (server-side extractie). */
function toolUse(inhoud: unknown[]): { input: unknown } | null {
  for (const b of inhoud) {
    if (b && typeof b === "object" && (b as { type?: unknown }).type === "tool_use") {
      return { input: (b as { input?: unknown }).input };
    }
  }
  return null;
}

// Reproduceerbaarheids-stempels (belanden in comparison_run). Bump bij een bewuste
// wijziging aan het prompt- of comparator-gedrag.
export const VERGELIJK_PROMPT_VERSIE = "t5-vergelijk-v1";
export const VERGELIJK_COMPARATOR_VERSIE = "t5-v1";
// Het synthese-/duidingsmodel voor het LLM-pad (Opus). Haiku doet alleen de
// dimensiebepaling; het geregistreerde run-model is het zwaarste model in de keten.
export const VERGELIJK_MODEL = AI_MODEL;

const MAX_PASSAGES_PER_ZIJDE = 4;
const MAX_EXTRA_DIMENSIES = 6;

interface VergelijkRetrieval {
  adapter: RetrievalAdapter;
  context: RetrievalContext;
  timeoutMs: number;
  hybrideAan: boolean;
  vlaggen: RetrievalOpties;
  audit: VergelijkAuditVerzamelaar;
}

interface GeregistreerdePoging {
  sleutel: string;
  poging: VergelijkRetrievalPoging;
  bronnen: { bron: Bronresultaat; verwijzing: RetrievalUitkomst["bronverwijzingen"][number] }[];
}

/**
 * Request-lokale verzamelaar. Parallelle bron-/doelretrievals mogen in een
 * willekeurige tijdsvolgorde eindigen; `snapshot()` sorteert daarom op een
 * expliciete dimensie/document-sleutel voordat citation-id's worden toegekend.
 */
export class VergelijkAuditVerzamelaar {
  private readonly pogingen = new Map<string, GeregistreerdePoging>();

  constructor(private readonly correlationId: string) {}

  registreer(documentId: string, dimensie: Dimensie, uitkomst: RetrievalUitkomst): void {
    const sleutel = `${dimensie.key}\u0000${documentId}`;
    this.pogingen.set(sleutel, {
      sleutel,
      poging: {
        document_id: documentId,
        dimensie: dimensie.key,
        methode: uitkomst.meta.methode,
        opgehaald: uitkomst.meta.opgehaald,
        geselecteerd: uitkomst.meta.geselecteerd,
        ...(uitkomst.fout ? { fout: uitkomst.fout } : {}),
        ...(uitkomst.meta.toelating ? { toelating: uitkomst.meta.toelating } : {}),
      },
      bronnen: uitkomst.geselecteerd.map((bron, index) => ({
        bron,
        verwijzing: uitkomst.bronverwijzingen[index],
      })).filter((paar) => Boolean(paar.verwijzing)),
    });
  }

  registreerProviderfout(documentId: string, dimensie: Dimensie): void {
    const sleutel = `${dimensie.key}\u0000${documentId}`;
    this.pogingen.set(sleutel, {
      sleutel,
      poging: {
        document_id: documentId,
        dimensie: dimensie.key,
        methode: "geen",
        opgehaald: 0,
        geselecteerd: 0,
        fout: "providerfout",
      },
      bronnen: [],
    });
  }

  snapshot(): { bronnen: VergelijkBron[]; meta: VergelijkRetrievalMeta } {
    const geordend = [...this.pogingen.values()].sort((a, b) => a.sleutel.localeCompare(b.sleutel));
    const uniek = new Map<string, Omit<VergelijkBron, "citation_id">>();
    const categorieen: Record<string, number> = {};
    const gronden: Record<string, number> = {};
    let geweigerd = 0;

    for (const item of geordend) {
      const toelating = item.poging.toelating;
      if (toelating) {
        geweigerd += toelating.geweigerd;
        for (const [k, v] of Object.entries(toelating.categorieen)) categorieen[k] = (categorieen[k] ?? 0) + (v ?? 0);
        for (const [k, v] of Object.entries(toelating.gronden)) gronden[k] = (gronden[k] ?? 0) + (v ?? 0);
      }
      for (const { bron, verwijzing } of item.bronnen) {
        if (uniek.has(bron.ref)) continue;
        uniek.set(bron.ref, {
          passage_ref: bron.ref,
          bronsoort: bron.bronsoort,
          verwijzing,
          versie: bron.versie,
          status: bron.status,
        });
      }
    }

    return {
      bronnen: [...uniek.values()].map((bron, index) => ({ citation_id: index + 1, ...bron })),
      meta: {
        correlation_id: this.correlationId,
        pogingen: geordend.map((p) => p.poging),
        ...(geweigerd > 0 ? { toelating: { geweigerd, categorieen, gronden } } : {}),
      },
    };
  }
}

// AI-BEGRENZING (besluit 0180). Geen eigen client: beide modelcalls lopen door
// de centrale poort, die vlak vóór elke call de kill switch en de allowlist
// toetst. Het quotum is al gereserveerd door /api/vergelijk (of, als de chat de
// vergelijking oproept, door de chatactie zelf) — één vergelijking is één
// AI-actie, ook al doet hij N modelcalls.

// ── Retrieval per (document, dimensie) ───────────────────────────────────────
// Scope op één document → gebalanceerd per bron (elke zijde krijgt een eigen budget,
// structureel sterker dan perSourceMin op een gecombineerde set). De fondsvlaggen
// sturen o.a. parent-retrieval. Een providerfout blijft best-effort; afbraak niet.
async function haalPassages(
  retrieval: VergelijkRetrieval,
  documentId: string,
  dimensie: Dimensie,
  maxResultaten = MAX_PASSAGES_PER_ZIJDE
): Promise<PassageLite[]> {
  const vraag = `${dimensie.label} (${dimensie.key})`;
  const auditDocumentId = maakDocumentIdentiteit(`fonds:${retrieval.context.fondsId}`, documentId);
  try {
    const uitkomst = await voerVolledigeRetrievalUit(
      { ...retrieval.context, scope: { ...retrieval.context.scope, documentIds: [documentId] } },
      {
        adapter: retrieval.adapter,
        timeoutMs: retrieval.timeoutMs,
        sporen: [
          maakVergelijkSpoor({
            vraag,
            documentId,
            hybrideAan: retrieval.hybrideAan,
            vlaggen: retrieval.vlaggen,
            maxResultaten,
          }),
        ],
      },
      citaatOpdracht([maakDocumentIdentiteit(`fonds:${retrieval.context.fondsId}`, documentId)])
    );
    retrieval.audit.registreer(auditDocumentId, dimensie, uitkomst);
    return uitkomst.geselecteerd.map((b) => ({
      tekst: b.weergave?.aangeleverdePassage ?? b.passage,
      page: b.locator.pagina ?? null,
      passage_ref: b.ref,
    }));
  } catch (e) {
    // Een providerfout blijft best-effort zoals vóór #369; annulering en onze
    // deadline zijn terminal en mogen nooit als een lege evidence-set doorgaan.
    if (isAfbreking(e)) throw e;
    retrieval.audit.registreerProviderfout(auditDocumentId, dimensie);
    console.error(`[vergelijk] retrieval mislukt (doc ${documentId}, dim ${dimensie.key}):`, (e as Error).message);
    return [];
  }
}

// Zoek de pagina van de passage waaruit een evidence-zin (deels) komt, zodat de
// evidence-link een paginanummer draagt zonder het model dat te laten raden.
function passageVoorEvidence(passages: PassageLite[], evidence: string | null): PassageLite | null {
  if (!evidence) return null;
  const naald = evidence.trim().slice(0, 40).toLowerCase();
  if (naald.length === 0) return null;
  for (const p of passages) {
    if (p.tekst.toLowerCase().includes(naald)) return p;
  }
  return passages[0] ?? null;
}

// ── Haiku: extra (niet-catalogus) dimensies afleiden ─────────────────────────
const DIM_TOOL: Extract<NeutraleTool, { soort: "functie" }> = {
  soort: "functie",
  verplicht: true,
  naam: "stel_dimensies_voor",
  beschrijving:
    "Stel de bestuurlijke vergelijkingsdimensies voor die in BEIDE documenten spelen " +
    "en NOG NIET in de gegeven cataloguslijst staan. Alleen concrete, vergelijkbare " +
    "grootheden (parameters, bedragen, datums, beleidskeuzes).",
  schema: {
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
  gw: GatewayDeps,
  retrieval: VergelijkRetrieval,
  bronDocumentId: string,
  doelDocumentId: string,
  catalogus: Dimensie[]
): Promise<Dimensie[]> {
  try {
    // Representatieve passages van beide zijden (generieke bestuurlijke query).
    const generiek = "kernparameters, percentages, bedragen, datums en beleidskeuzes";
    const generiekeDimensie: Dimensie = { key: "generiek", label: generiek, herkomst: "aangevuld" };
    const [bron, doel] = await Promise.all([
      haalPassages(retrieval, bronDocumentId, generiekeDimensie, 5),
      haalPassages(retrieval, doelDocumentId, generiekeDimensie, 5),
    ]);
    const tekstBron = bron.map((p) => p.tekst).join("\n---\n").slice(0, 8000);
    const tekstDoel = doel.map((p) => p.tekst).join("\n---\n").slice(0, 8000);
    const bekend = catalogus.map((d) => d.key).join(", ") || "(geen)";

    const resp = await gw.gateway.genereer(gw.ctx, {
      taaktype: "vergelijk_dimensies",
      maxTokens: 512,
      temperature: 0,
      signal: retrieval.context.signal,
      systeem:
        "Je bent een analist die twee versies van een pensioenfonds-document vergelijkt. " +
        "Je benoemt uitsluitend concrete, vergelijkbare dimensies die in BEIDE teksten " +
        "voorkomen en niet al in de cataloguslijst staan. Verzin niets.",
      tools: [DIM_TOOL],
      berichten: [
        {
          role: "user",
          content:
            `Cataloguslijst (niet herhalen): ${bekend}\n\n` +
            `DOCUMENT A (bron):\n"""\n${tekstBron}\n"""\n\n` +
            `DOCUMENT B (doel):\n"""\n${tekstDoel}\n"""`,
        },
      ],
    });
    const blok = toolUse(resp.inhoud);
    if (!blok) return [];
    const input = blok.input as { dimensies?: { key?: string; label?: string }[] };
    const rijen = Array.isArray(input.dimensies) ? input.dimensies : [];
    const bekendSet = new Set(catalogus.map((d) => d.key.toLowerCase()));
    return rijen
      .filter((d) => d.key && d.label && !bekendSet.has(d.key.toLowerCase()))
      .slice(0, MAX_EXTRA_DIMENSIES)
      .map((d) => ({ key: d.key!.trim(), label: d.label!.trim(), herkomst: "llm" as const }));
  } catch (e) {
    if (isAfbreking(e)) throw e;
    console.error(`[vergelijk] dimensiebepaling mislukt:`, (e as Error).message);
    return [];
  }
}

// ── Opus: LLM-waardevergelijking per dimensie ────────────────────────────────
const CMP_TOOL: Extract<NeutraleTool, { soort: "functie" }> = {
  soort: "functie",
  verplicht: true,
  naam: "vergelijk_dimensie",
  beschrijving:
    "Bepaal de waarde van de dimensie in DOCUMENT A (bron) en DOCUMENT B (doel), met " +
    "een verbatim bronzin als bewijs, en of de twee waarden gelijk zijn. Laat een " +
    "waarde leeg (null) als de dimensie in dat document niet voorkomt. Verzin niets.",
  schema: {
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

async function vergelijkWaardeLLM(gw: GatewayDeps, input: {
  dimensie: Dimensie;
  passagesBron: PassageLite[];
  passagesDoel: PassageLite[];
  signal?: AbortSignal;
}): Promise<LLMVergelijkUitkomst> {
  const { dimensie, passagesBron, passagesDoel } = input;
  const leeg: LLMVergelijkUitkomst = {
    bron_value: null, bron_evidence: null, bron_page: null,
    doel_value: null, doel_evidence: null, doel_page: null, gelijk: false,
  };
  try {
    const resp = await gw.gateway.genereer(gw.ctx, {
      taaktype: "vergelijk_waarde",
      maxTokens: 700,
      temperature: 0,
      signal: input.signal,
      systeem:
        "Je vergelijkt één specifieke dimensie tussen twee versies van een pensioenfonds-" +
        "document. Neem bewijszinnen LETTERLIJK over. Bind een waarde alleen als de tekst " +
        "die ondubbelzinnig ondersteunt; bij twijfel of afwezigheid: null. Geen parafrase, verzin niets.",
      tools: [CMP_TOOL],
      berichten: [
        {
          role: "user",
          content:
            `Dimensie: ${dimensie.label} (${dimensie.key})\n\n` +
            `DOCUMENT A (bron):\n${nummerPassages(passagesBron)}\n\n` +
            `DOCUMENT B (doel):\n${nummerPassages(passagesDoel)}`,
        },
      ],
    });
    const blok = toolUse(resp.inhoud);
    if (!blok) return leeg;
    const r = blok.input as Partial<LLMVergelijkUitkomst>;
    const bron_evidence = (r.bron_evidence as string | null) ?? null;
    const doel_evidence = (r.doel_evidence as string | null) ?? null;
    const bronPassage = passageVoorEvidence(passagesBron, bron_evidence);
    const doelPassage = passageVoorEvidence(passagesDoel, doel_evidence);
    return {
      bron_value: (r.bron_value as string | null) ?? null,
      bron_evidence,
      bron_page: bronPassage?.page ?? null,
      bron_passage_ref: bronPassage?.passage_ref ?? null,
      doel_value: (r.doel_value as string | null) ?? null,
      doel_evidence,
      doel_page: doelPassage?.page ?? null,
      doel_passage_ref: doelPassage?.passage_ref ?? null,
      gelijk: r.gelijk === true,
    };
  } catch (e) {
    if (isAfbreking(e)) throw e;
    console.error(`[vergelijk] LLM-vergelijking mislukt (dim ${dimensie.key}):`, (e as Error).message);
    return leeg;
  }
}

// ── Semantic units + concepten lezen (RLS-client) ────────────────────────────
async function leesConcepten(supabase: SupabaseClient, signal?: AbortSignal): Promise<ConceptLite[]> {
  let query = supabase.from("concepts").select("id, key, label, type, status");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (isAfbreking(error)) throw error;
  if (error || !data) return [];
  return data as ConceptLite[];
}

async function leesSemanticUnits(supabase: SupabaseClient, documentId: string, signal?: AbortSignal): Promise<SemanticUnitLite[]> {
  let query = supabase
    .from("semantic_units")
    .select("concept_id, type, value_num, value_date, value_text, value_raw, value_unit, page, evidence")
    .eq("document_id", documentId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (isAfbreking(error)) throw error;
  if (error || !data) return [];
  return data as SemanticUnitLite[];
}

// ── Persisteren via de DEFINER-RPC ───────────────────────────────────────────
async function persisteer(supabase: SupabaseClient, inv: PersisteerInvoer, signal?: AbortSignal): Promise<string | null> {
  bewaakNaIO(signal);
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
    bron_passage_ref: f.bron.passage_ref ?? null,
    doel_passage_ref: f.doel.passage_ref ?? null,
  }));
  const p_bronnen = (inv.bronnen ?? []).map((b) => ({
    citation_id: b.citation_id,
    passage_ref: b.passage_ref,
    document_id: b.verwijzing.document_id,
    pagina: b.verwijzing.pagina,
    bibliotheek: b.verwijzing.bibliotheek ?? null,
    bronsoort: b.bronsoort,
    documentstatus: b.status.documentstatus ?? null,
    bronstatus: b.status.bronstatus ?? null,
    geldig_tot: b.status.geldigTot ?? null,
    versie: b.versie,
  }));
  let query = supabase.rpc("fn_schrijf_vergelijking", {
    p_mode: inv.mode,
    p_model: inv.model,
    p_prompt_version: inv.promptVersion,
    p_comparator_version: inv.comparatorVersion,
    p_findings,
    p_correlation_id: inv.retrievalMeta?.correlation_id ?? null,
    p_retrieval_meta: inv.retrievalMeta ?? {},
    p_bronnen,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  bewaakNaIO(signal, error);
  if (error) {
    console.error(`[vergelijk] persisteren mislukt:`, error.message);
    throw new Error(`vergelijking_persisteren: ${error.message}`);
  }
  return (data as string) ?? null;
}

// ── Deps-fabriek ─────────────────────────────────────────────────────────────
export function productieDeps(ctx: {
  supabase: SupabaseClient;
  fondsId: string;
  gateway: AiGateway;
  gatewayCtx: GatewayContext;
  retrieval: VergelijkRetrieval;
}): VergelijkDeps {
  const { supabase } = ctx;
  const gw: GatewayDeps = { gateway: ctx.gateway, ctx: ctx.gatewayCtx };
  const audit = ctx.retrieval.audit;
  return {
    leesConcepten: () => leesConcepten(supabase, ctx.retrieval.context.signal),
    // Gemotiveerde uitzondering: semantic_units zijn reeds geëxtraheerde,
    // getypeerde waarden voor het deterministische vergelijkpad. Ze zijn geen
    // zoekprovider en worden onder dezelfde RLS-client, documentbinding en
    // request-cancellation gelezen. T2-4 kan dit evidencepad typed opnemen.
    leesSemanticUnits: (documentId) => leesSemanticUnits(supabase, documentId, ctx.retrieval.context.signal),
    bepaalExtraDimensies: ({ bronDocumentId, doelDocumentId, catalogus }) =>
      haalExtraDimensies(gw, ctx.retrieval, bronDocumentId, doelDocumentId, catalogus),
    retrieveerPassages: (documentId, dimensie) => haalPassages(ctx.retrieval, documentId, dimensie),
    vergelijkWaardeLLM: (input) => vergelijkWaardeLLM(gw, { ...input, signal: ctx.retrieval.context.signal }),
    persisteer: (inv) => persisteer(supabase, inv, ctx.retrieval.context.signal),
    retrievalAudit: () => audit.snapshot(),
    deterministischVertrouwd: deterministischVertrouwd(),
  };
}

// Versie-set voor de comparison_run-header.
export const VERGELIJK_VERSIES = {
  model: VERGELIJK_MODEL,
  promptVersion: VERGELIJK_PROMPT_VERSIE,
  comparatorVersion: VERGELIJK_COMPARATOR_VERSIE,
};
