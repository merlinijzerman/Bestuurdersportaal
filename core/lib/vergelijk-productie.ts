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
import { leesSemantischeEvidence, type SemantischeEvidenceWaarde } from "./retrieval/supabase-evidence";
import {
  fondsModelcontextRij,
  generiekModelcontextRij,
  leesModelcontext,
  MODELCONTEXT_GEEN_GELDIGHEID,
} from "./retrieval/modelcontext-reader";
import type { EvidenceAudit, EvidenceItem } from "./retrieval/evidence-contract";
import { bouwBronfragment } from "./bronfragment";
import { selecteerGebruikteEvidence } from "./vergelijk-audit-core";
import { citaatOpdracht, maakVergelijkSpoor } from "./retrieval/productiepaden-core";
import { bouwVergelijkWaardePrompt, juridischeAuditprojectie } from "./vergelijk-kern";
import type {
  ConceptLite,
  LLMVergelijkUitkomst,
  PassageLite,
  PersisteerInvoer,
  SemanticUnitLite,
  VergelijkDeps,
  VergelijkDocumentprofiel,
} from "./vergelijk-kern";
import type {
  Dimensie,
  VergelijkBron,
  VergelijkJuridischeDuiding,
  VergelijkRetrievalMeta,
  VergelijkRetrievalPoging,
} from "./vergelijk-types";

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
export const VERGELIJK_PROMPT_VERSIE = "t5-vergelijk-v2";
export const VERGELIJK_COMPARATOR_VERSIE = "t5-v1";
// Het synthese-/duidingsmodel voor het LLM-pad (Opus). Haiku doet alleen de
// dimensiebepaling; het geregistreerde run-model is het zwaarste model in de keten.
export const VERGELIJK_MODEL = AI_MODEL;

const MAX_PASSAGES_PER_ZIJDE = 4;
const MAX_EXTRA_DIMENSIES = 6;
const MAX_VERGELIJK_AUDITBRONNEN = 1000;

interface VergelijkRetrieval {
  adapter: RetrievalAdapter;
  context: RetrievalContext;
  timeoutMs: number;
  hybrideAan: boolean;
  vlaggen: RetrievalOpties;
  audit: VergelijkAuditVerzamelaar;
  /**
   * V-1 — opaque-identiteitsnamespace per gekozen document (`generiek` of
   * `fonds:<id>`). Gezet door productieDeps uit de servergelezen documentrij;
   * zonder deze resolver geldt het oude fondsnamespace-gedrag.
   */
  namespaceVoor?: (documentId: string) => Promise<string>;
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
  private readonly gestructureerdeEvidence = new Map<string, EvidenceItem<SemantischeEvidenceWaarde>>();
  private readonly evidenceAuditPerRef = new Map<string, EvidenceAudit>();
  private readonly gebruikteEvidenceRefs = new Set<string>();

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

  registreerGestructureerdeEvidence(
    items: readonly EvidenceItem<SemantischeEvidenceWaarde>[],
    audit: EvidenceAudit
  ): void {
    for (const item of items) {
      this.gestructureerdeEvidence.set(item.ref, item);
      this.evidenceAuditPerRef.set(item.ref, audit);
    }
  }

  markeerGebruikteEvidence(refs: readonly string[]): void {
    for (const ref of refs) if (this.gestructureerdeEvidence.has(ref)) this.gebruikteEvidenceRefs.add(ref);
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

    const gebruikteEvidence = selecteerGebruikteEvidence(
      [...this.gestructureerdeEvidence.values()], this.gebruikteEvidenceRefs, MAX_VERGELIJK_AUDITBRONNEN
    );
    for (const item of gebruikteEvidence) {
      if (uniek.has(item.ref)) continue;
      uniek.set(item.ref, {
        passage_ref: item.ref,
        bronsoort: item.bronsoort,
        verwijzing: {
          citation_id: item.citationId,
          document_id: item.documentIdentiteit,
          titel: item.titel,
          bron: "Semantische evidence",
          pagina: item.locator.pagina ?? null,
          paragraaf: item.locator.paragraaf ?? null,
          fragment: bouwBronfragment(item.passage),
          heeft_origineel: false,
          documentstatus: item.status.documentstatus ?? null,
          bronstatus: item.status.bronstatus ?? null,
        },
        versie: item.versie,
        status: item.status,
      });
    }

    if (uniek.size > MAX_VERGELIJK_AUDITBRONNEN) throw new Error("vergelijk_bronnen_afgekapt");
    return {
      bronnen: [...uniek.values()].map((bron, index) => ({ citation_id: index + 1, ...bron })),
      meta: {
        correlation_id: this.correlationId,
        pogingen: geordend.map((p) => p.poging),
        ...(geweigerd > 0 ? { toelating: { geweigerd, categorieen, gronden } } : {}),
        ...(gebruikteEvidence.length > 0 ? {
          evidence: gebruikteEvidence.map((item) => {
            const basis = this.evidenceAuditPerRef.get(item.ref)!;
            return {
              ...basis,
              gevraagd: 1,
              toegelaten: 1,
              gerenderde_tekens: item.gerenderdeTekens ?? item.passage.length,
              versies: { sterk: item.versie.soort === "hash" ? 1 : 0, gedegradeerd: item.versie.soort === "status-datum" ? 1 : 0 },
            };
          }),
        } : {}),
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
  const vraag = dimensie.zoekvraag ?? `${dimensie.label} (${dimensie.key})`;
  // V-1 — een generiek document (wetgeving/wetsgeschiedenis staat uitsluitend in
  // de generieke bibliotheek) draagt de namespace `generiek`, net als in de
  // retrievalkern en de DEFINER-check van fn_schrijf_vergelijking. Met de oude
  // vaste fondsnamespace weigerde de schrijf-RPC elke vergelijking met een
  // generiek document (`vergelijking_vreemde_retrievalpoging`).
  const namespace = retrieval.namespaceVoor
    ? await retrieval.namespaceVoor(documentId)
    : `fonds:${retrieval.context.fondsId}`;
  const auditDocumentId = maakDocumentIdentiteit(namespace, documentId);
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
      citaatOpdracht([auditDocumentId])
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
      effort: "low",
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

async function vergelijkWaardeLLM(gw: GatewayDeps, input: {
  dimensie: Dimensie;
  passagesBron: PassageLite[];
  passagesDoel: PassageLite[];
  juridisch?: VergelijkJuridischeDuiding;
  signal?: AbortSignal;
}): Promise<LLMVergelijkUitkomst> {
  const { dimensie, passagesBron, passagesDoel } = input;
  // V-1 — de opdracht (incl. eventuele juridische rolregels) wordt puur en
  // servergeschreven opgebouwd in vergelijk-kern; bronpassages blijven data.
  const opdracht = bouwVergelijkWaardePrompt({
    dimensie,
    passagesBron,
    passagesDoel,
    juridisch: input.juridisch,
  });
  const leeg: LLMVergelijkUitkomst = {
    bron_value: null, bron_evidence: null, bron_page: null,
    doel_value: null, doel_evidence: null, doel_page: null, gelijk: false,
  };
  try {
    const resp = await gw.gateway.genereer(gw.ctx, {
      taaktype: "vergelijk_waarde",
      effort: "medium",
      // Adaptive thinking telt mee in max_tokens. Gebruik hetzelfde ruime
      // generatieplafond als chat zodat de verplichte toolcall niet wordt
      // verdrongen door reasoning-tokens.
      maxTokens: 32_000,
      // Opus 4.7+ weigert niet-standaard samplingparameters met HTTP 400.
      // De verplichte functietool en de strikte prompt begrenzen de uitvoer;
      // laat de provider daarom zijn standaardtemperatuur gebruiken.
      signal: input.signal,
      systeem: opdracht.systeem,
      tools: [CMP_TOOL],
      berichten: [
        {
          role: "user",
          content: opdracht.gebruiker,
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

async function leesSemanticUnits(retrieval: VergelijkRetrieval, supabase: SupabaseClient, documentId: string): Promise<SemanticUnitLite[]> {
  const uitkomst = await leesSemantischeEvidence(supabase, {
    context: retrieval.context,
    maxItems: 500,
    maxGerenderdeTekens: 60_000,
    // De vergelijkroute mag een expliciet gekoppelde historische voorganger
    // lezen. Alle overige evidencelezingen behouden het actuele beleid.
    levenscyclusbeleid: "vergelijkbare_versies",
  }, documentId);
  if (uitkomst.status === "geweigerd") {
    throw new Error(`semantic_evidence_${uitkomst.audit.fout}`);
  }
  retrieval.audit.registreerGestructureerdeEvidence(uitkomst.items, uitkomst.audit);
  return uitkomst.items.map((item) => ({
    // Leeg en uitsluitend voor compatibiliteit met bestaande testfixtures; de
    // productiekern koppelt via de stabiele conceptsleutel, nooit via DB-id.
    concept_id: "",
    concept_key: item.waarde.conceptSleutel,
    type: item.waarde.type,
    value_num: item.waarde.valueNum,
    value_date: item.waarde.valueDate,
    value_text: item.waarde.valueText,
    value_raw: item.waarde.valueRaw,
    value_unit: item.waarde.valueUnit,
    page: item.waarde.page,
    evidence: item.waarde.evidence,
    passage_ref: item.ref,
  }));
}

// ── V-1: documentprofielen van de twee gekozen documenten ────────────────────
// Per gekozen document één gebonden read via de typed modelcontextgrens (#368):
// scope (eigen fonds of échte generieke bron), private selector = precies dit
// document, cap 1, cancellation. De rij levert geen citeerbaar bewijs, alleen
// de metadata die de servergeschreven juridische rol en de opaque
// auditnamespace bepaalt.
//
// LEVENSCYCLUS BEWUST NIET VAN TOEPASSING. De toelating tot de vergelijking is
// al gebeurd door de expliciete, RLS-gecontroleerde documentkeuze (beleid
// `vergelijkbare_versies`; zie de route en maakVergelijkSpoor). Hier bepaalt de
// status alleen de getoonde rol: een bewust gekozen historische of inactieve
// voorganger mag daardoor niet alsnog wegvallen of `onbekend` worden. Er is dus
// geen actualiteits-, status- of peildatumfilter. Een weigering (scope/fout)
// degradeert naar `null` (neutrale rol `onbekend`); een afbreking niet.
interface DocumentprofielRij {
  id: string;
  fonds_id: string | null;
  bibliotheek: string | null;
  titel: string | null;
  documenttype: string | null;
  wetsgeschiedenis_subtype: string | null;
  dossiernummer: string | null;
  normgewicht: string | null;
  wettelijk_regime: string | null;
  documentdatum: string | null;
  status: string | null;
  bronstatus: string | null;
  geldig_tot: string | null;
}

interface Documentprofielen {
  profielen: Record<string, VergelijkDocumentprofiel | null>;
  namespaces: Map<string, string>;
}

async function leesDocumentprofiel(
  supabase: SupabaseClient,
  context: RetrievalContext,
  documentId: string
): Promise<DocumentprofielRij | null> {
  try {
    const rijen = await leesModelcontext<DocumentprofielRij>({
      context,
      soort: "documentlabels",
      scope: { fondsId: context.fondsId, privateRefs: [documentId] },
      maxItems: 1,
      levenscyclusbeleid: "vergelijkbare_versies",
      lees: async (signal) => {
        const { data, error } = await supabase
          .from("documenten")
          .select(
            "id, fonds_id, bibliotheek, titel, documenttype, wetsgeschiedenis_subtype, dossiernummer, " +
              "normgewicht, wettelijk_regime, documentdatum, status, bronstatus, geldig_tot"
          )
          .eq("id", documentId)
          .limit(2)
          .abortSignal(signal);
        return {
          data: ((data ?? []) as unknown as DocumentprofielRij[]).map((rij) =>
            rij.fonds_id === null && rij.bibliotheek === "generiek"
              ? generiekModelcontextRij(rij, rij.id, MODELCONTEXT_GEEN_GELDIGHEID)
              : fondsModelcontextRij(rij, context.fondsId, rij.id, MODELCONTEXT_GEEN_GELDIGHEID)
          ),
          error,
        };
      },
    });
    return rijen[0] ?? null;
  } catch (e) {
    if (isAfbreking(e) || context.signal?.aborted) throw e;
    console.error(`[vergelijk] documentprofiel niet leesbaar (doc ${documentId}):`, (e as Error).message);
    return null;
  }
}

async function leesDocumentprofielen(
  supabase: SupabaseClient,
  context: RetrievalContext,
  documentIds: readonly string[]
): Promise<Documentprofielen> {
  const profielen: Record<string, VergelijkDocumentprofiel | null> = {};
  const namespaces = new Map<string, string>();
  const rijen = await Promise.all(documentIds.map((id) => leesDocumentprofiel(supabase, context, id)));
  documentIds.forEach((id, index) => {
    const d = rijen[index];
    // App-guard náást RLS en de modelcontextgrens (T4-patroon).
    const generiek = d !== null && d.fonds_id === null && d.bibliotheek === "generiek";
    if (!d || d.id !== id || (!generiek && d.fonds_id !== context.fondsId)) {
      profielen[id] = null;
      return;
    }
    namespaces.set(id, generiek ? "generiek" : `fonds:${context.fondsId}`);
    profielen[id] = {
      titel: d.titel ?? null,
      documenttype: d.documenttype ?? null,
      wetsgeschiedenis_subtype: d.wetsgeschiedenis_subtype ?? null,
      dossiernummer: d.dossiernummer ?? null,
      normgewicht: d.normgewicht ?? null,
      wettelijk_regime: d.wettelijk_regime ?? null,
      documentdatum: d.documentdatum ?? null,
      status: d.status ?? null,
      bronstatus: d.bronstatus ?? null,
      geldig_tot: d.geldig_tot ?? null,
    };
  });
  return { profielen, namespaces };
}

// ── Persisteren via de DEFINER-RPC ───────────────────────────────────────────
async function persisteer(
  supabase: SupabaseClient,
  inv: PersisteerInvoer,
  signal?: AbortSignal,
  documentIdentiteit: (documentId: string) => string | null = () => null
): Promise<string | null> {
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
  const p_bronnen = (inv.bronnen ?? []).map((b) => {
    // `b.citation_id` is bewust het lokale, numerieke weergave-ordinaal in de
    // bestaande HTTP-respons. Het duurzame auditspoor krijgt uitsluitend de
    // centraal gevormde, providerneutrale citation-identiteit uit #367.
    if (!b.verwijzing.citation_id) {
      throw new Error("vergelijking_persisteren: opaque_citation_id_ontbreekt");
    }
    return {
      citation_id: b.verwijzing.citation_id,
      passage_ref: b.passage_ref,
      document_id: b.verwijzing.document_id,
      pagina: b.verwijzing.pagina,
      bibliotheek: b.verwijzing.bibliotheek ?? null,
      bronsoort: b.bronsoort,
      documentstatus: b.status.documentstatus ?? null,
      bronstatus: b.status.bronstatus ?? null,
      geldig_tot: b.status.geldigTot ?? null,
      actueel: b.status.actueel,
      versie: b.versie,
    };
  });
  let query = supabase.rpc("fn_schrijf_vergelijking", {
    p_mode: inv.mode,
    p_model: inv.model,
    p_prompt_version: inv.promptVersion,
    p_comparator_version: inv.comparatorVersion,
    p_findings,
    p_correlation_id: inv.retrievalMeta?.correlation_id ?? null,
    // V-1: de juridische duiding reist mee in het bestaande retrieval_meta-
    // object; de RPC projecteert en valideert haar allowlist-gebaseerd.
    p_retrieval_meta: inv.juridisch
      ? { ...(inv.retrievalMeta ?? {}), juridische_duiding: juridischeAuditprojectie(inv.juridisch, documentIdentiteit) }
      : inv.retrievalMeta ?? {},
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
  // V-1 — één gememoïseerde metadata-read voor precies de twee gekozen
  // documenten (de serverscope). Voedt de juridische rol én de juiste opaque
  // auditnamespace; retrieval en persistentie wachten op dezelfde uitkomst.
  const gekozen = ctx.retrieval.context.scope?.documentIds ?? [];
  let profielBelofte: Promise<Documentprofielen> | null = null;
  let profielUitkomst: Documentprofielen | null = null;
  const profielen = () => {
    profielBelofte ??= leesDocumentprofielen(supabase, ctx.retrieval.context, gekozen)
      .then((u) => (profielUitkomst = u));
    return profielBelofte;
  };
  const retrieval: VergelijkRetrieval = {
    ...ctx.retrieval,
    namespaceVoor: async (documentId) =>
      (await profielen()).namespaces.get(documentId) ?? `fonds:${ctx.fondsId}`,
  };
  const documentIdentiteit = (documentId: string): string | null => {
    const namespace = profielUitkomst?.namespaces.get(documentId);
    return namespace ? maakDocumentIdentiteit(namespace, documentId) : null;
  };
  return {
    leesConcepten: () => leesConcepten(supabase, ctx.retrieval.context.signal),
    // Gemotiveerde uitzondering: semantic_units zijn reeds geëxtraheerde,
    // getypeerde waarden voor het deterministische vergelijkpad. Ze zijn geen
    // zoekprovider en worden onder dezelfde RLS-client, documentbinding en
    // request-cancellation gelezen. T2-4 kan dit evidencepad typed opnemen.
    leesSemanticUnits: (documentId) => leesSemanticUnits(ctx.retrieval, supabase, documentId),
    bepaalExtraDimensies: ({ bronDocumentId, doelDocumentId, catalogus }) =>
      haalExtraDimensies(gw, retrieval, bronDocumentId, doelDocumentId, catalogus),
    retrieveerPassages: (documentId, dimensie) => haalPassages(retrieval, documentId, dimensie),
    vergelijkWaardeLLM: (input) => vergelijkWaardeLLM(gw, { ...input, signal: ctx.retrieval.context.signal }),
    persisteer: (inv) => persisteer(supabase, inv, ctx.retrieval.context.signal, documentIdentiteit),
    // V-1 — alleen de expliciet gekozen documenten; een id buiten de serverscope
    // krijgt nooit een profiel.
    leesDocumentprofielen: async (documentIds) => {
      const { profielen: alle } = await profielen();
      return Object.fromEntries(documentIds.map((id) => [id, alle[id] ?? null]));
    },
    retrievalAudit: () => audit.snapshot(),
    markeerGebruikteEvidence: (refs) => audit.markeerGebruikteEvidence(refs),
    deterministischVertrouwd: deterministischVertrouwd(),
  };
}

// Versie-set voor de comparison_run-header.
export const VERGELIJK_VERSIES = {
  model: VERGELIJK_MODEL,
  promptVersion: VERGELIJK_PROMPT_VERSIE,
  comparatorVersion: VERGELIJK_COMPARATOR_VERSIE,
};
