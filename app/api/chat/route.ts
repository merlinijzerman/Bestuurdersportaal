import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
// #311 — de centrale AI-gateway: provider/model komen server-side uit fonds +
// taaktype (ai_gateway_private), de poort (kill switch/allowlist) draait vlak
// vóór iedere call en elke call krijgt een inhoudsvrije auditregel.
import { productieGateway } from "@/core/lib/ai-gateway/gateway-productie";
import { isVoorNetwerkGestopt } from "@/core/lib/ai-gateway/fout";
import type { GatewayContext } from "@/core/lib/ai-gateway/contract";
import {
  preflight,
  preflightRespons,
  rondAf,
  sleutelUitRequest,
  vingerafdruk,
} from "@/core/lib/ai-preflight";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { zoekRelevanteChunksMetMeta, telNietActueleFondstreffers, maakContext, maakBronSentinel, haalDocumentChunksMetDekking, telDocumentChunks, VOLLEDIGE_DOCUMENT_CHUNK_CAP, haalBevrorenChunks, verrijkNotulenChunks, verrijkDocumentmetadata, type DocumentChunk, type DocumentChunkOphaalresultaat, type BronVerwijzing, type RetrievalMeta, type RetrievalFilters } from "@/core/lib/rag";
// Plateau B — de reflectieflow. `isActief` heet hier `isReflectieActief` omdat
// `actief` in deze route al een half dozijn andere betekenissen heeft.
import { effectieveStatus, isActief as isReflectieActief, isReflectieIngang, type ReflectieStatus, type ReflectieActie, type ReflectieIngang } from "@/core/lib/reflectie-flow";
import { valideerVerdiepingsvraag, standaardVraag, tegenperspectiefVraag } from "@/core/lib/reflectie-richtingen";
import { bepaalBronset } from "@/core/lib/bronset";
import { heeftReformulatieNodig, reformuleerVraag } from "@/core/lib/query-reformulatie";
// Plateau 1 — vroege contextresolutie: leidt één zelfstandige `effectieveVraag`
// af die de normale-informatie-downstream stuurt (bronintentie, router,
// antwoordmodus, retrieval, webprofiel, prompt). Zie AI-CHATCONTEXT-ONTWERP.md.
import {
  resolveVraagContext,
  chatcontextModus,
  contextTelemetrie,
  type VraagContext,
} from "@/core/lib/vraag-context";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { valideerChatInvoer } from "@/core/lib/chat-invoer";
import { rateLimited, badRequest } from "@/core/lib/api-errors";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { hybrideZoekenAan, retrievalVlaggenVoorFonds, bronkeuzeModusVoorFonds, vraagrouterVlaggenVoorFonds } from "@/core/lib/fonds-config";
import {
  VOORTGANG_LABEL,
  retrievalUitkomst,
  webUitkomst,
} from "@/core/lib/voortgang";
import { HAIKU_MODEL } from "@/core/lib/llm-modellen";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { valideerScope, type ScopeDocumentRij } from "@/core/lib/document-scope";
import {
  parseModuleScope,
  bouwRisicomatrixBlok,
  bouwRisicoBlok,
  bouwProcesBlok,
  type ModuleScope,
  type ModuleScopeSoort,
  type RisicoRij,
  type RisicoLogRij,
  type MaatregelRij,
  type DecisionRij,
  type StapRij,
  type RequirementRij,
  type BewijsRij,
} from "@/core/lib/module-scope";
import { bepaalVraagtype, schatTokens, kiesStrategie, maakBatches, bepaalAntwoordmodus, retrievalModusVoor, retrievalModusVoorVraag, isOpsteltaak, bepaalInlineMeldingen, AFGEKAPT_MELDING, meldingNietVastgesteldeStukken, bronbasisLabel, bepaalBronIntent, moetVerduidelijken, isKorteBevestiging, bepaalAutoBronModus, heeftPortaalstandNodig, VERDUIDELIJKINGSVRAAG, VERDUIDELIJKING_OPTIES, ANTWOORDMODUS_LABEL, type Strategie, type Antwoordmodus, type BronModus, type BronIntent, type BronIntentResultaat, type InlineMelding } from "@/core/lib/vraagtype";
import { getPortaalContext } from "@/core/lib/portaalcontext";
import { bouwPortaalstandBlok } from "@/core/lib/portaalstand-blok";
import { bepaalBronsoortprofiel } from "@/core/lib/weeg-bronsoort";
import { haalBesluitBronnen, topProcesinstanties, opmaakBesluitContext } from "@/core/lib/besluitvorming-bron";
import { documentBronNaarSource, modelKennisBronnenUitAntwoord, bouwSourceSamenvatting, ontbrekendeAlgemeneKennisMarkering, type AssistantSource, type AssistantSourceWeb } from "@/core/lib/assistant-source";
import { allowedDomeinenUit } from "@/core/lib/web-whitelist";
import { haalActieveWhitelist } from "@/core/lib/web-whitelist-data";
import { beoordeelWebGate, extractWebResultaten, bouwWebbronnen, bevraagdeDomeinen } from "@/core/lib/web-retrieval";
import { bevatPersoonsgegevens } from "@/core/lib/pii-gate";
import { bouwProfielsturing, type ProfielsturingAspecten } from "@/core/lib/profielsturing";
import { bouwOrganisatieprofiel, bouwRegimeKaderBlok } from "@/core/lib/organisatieprofiel";
import { SP_AGENDAPUNT_REGELS, bouwToelichtingBlok, herkomstString, type AgendapuntSeed } from "@/core/lib/agendapunt-context";
import { bouwVoorbereidingProduct } from "@/core/lib/voorbereiding-product";
import { splitsRetrievalMeta } from "@/core/lib/audit-meta";
import { bouwInhoudZegel } from "@/core/lib/audit-hmac";
// T5 — Vergelijkmodus. De logica zit volledig in core/lib/vergelijk-* (los
// testbaar); deze route is enkel de confidence-gated ingang + governance-logging.
import { bepaalVergelijkIntent, koppelDocumenten, type DocumentRef } from "@/core/lib/vergelijk-intent";
import { vergelijkmodusAan } from "@/core/lib/vergelijk-config";
import { voerVergelijkingUit } from "@/core/lib/vergelijk-kern";
import { productieDeps, VERGELIJK_VERSIES, VERGELIJK_MODEL } from "@/core/lib/vergelijk-productie";
// AQL-2 / spike 1 — de answer-generation-kern (toon-systeemprompt, per-modus
// instructiesets, system-prompt-builders, model-/budgetconstanten) is verplaatst
// naar lib/generatie-kern.ts zodat zowel deze streaming-route als het AI Quality
// Lab EXACT dezelfde kern draaien. Deze route blijft de eigenaar van het SSE-pad
// (streamt) en importeert die kern hier terug — de assemblage is byte-identiek
// (bewaakt door lib/generatie-kern.sanity.ts).
import {
  AI_MODEL,
  MAX_TOKENS,
  MAX_TOKENS_BESTUURLIJK,
  BESTUURLIJKE_STIJL,
  VERVOLGVRAGEN_MARKER,
  VERVOLGVRAGEN_INSTRUCTIE,
  splitsVervolgvragen,
  SP_DOCUMENTEN_REGELS,
  SP_BUREAU_BRONLOOS_REGELS,
  SP_ALGEMEEN_REGELS,
  SP_COMBINEREN_REGELS,
  SP_DOCUMENT_PRIMAIR_REGELS,
  SP_DOCUMENT_PRIMAIR_ALG_REGELS,
  SP_DOCUMENT_SCOPE_BREED_REGELS,
  SP_DOCUMENT_BREED_ALG_REGELS,
  SP_TRANSFORMATIE_REGELS,
  SP_VOORBEREIDING_REGELS,
  SP_REFLECTIE_REGELS,
  SP_REFLECTIE_CONCEPT_REGELS,
  SP_REFLECTIE_TEGENPERSPECTIEF,
  SP_MAP_EXTRACTIE,
  SP_WEB_REGELS,
  ROL_LABEL,
  bouwSysteemBlokken,
  type BestuurderContext,
} from "@/core/lib/generatie-kern";
import {
  DOORGROND_SECTIES,
  DOORGROND_PROMPTVARIANT,
  bouwDoorgrondInstructie,
  type DoorgrondSectieId,
} from "@/core/lib/doorgrond";
import {
  STUK_PROMPTVARIANT,
  SLOTSECTIE,
  bouwStukInstructie,
  isStuksoort,
  stuksoortDef,
  type Stuksoort,
} from "@/core/lib/stukvoorbereiding";
import { rolHeeftCapability } from "@/core/lib/capabilities";
import {
  bouwAnalyseplan,
  formatteerAnalyseplan,
  resolveerGenoemdDocument,
  routeerVraag,
  type Vraagroute,
  type VraagScope,
} from "@/core/lib/vraagrouter";
import { verfijnVraagrouteMetModel } from "@/core/lib/vraagrouter-model";
import { z } from "zod";
import {
  bredeDekking,
  dekkingsInstructie,
  finaliseerRouteMetDekking,
  gerichteDekking,
  magVolledigeAnalyseAanbieden,
  type DekkingsAfkapreden,
  type DocumentDekking,
} from "@/core/lib/document-dekking";

// AI-BEGRENZING (besluit 0180). Geen module-level client meer: elke van de vijf
// soorten providercalls in deze route (Opus-stream, Haiku-mapstap,
// Sonnet-reformulatie, Mistral-embeddings via de retrieval, Haiku-reranker)
// loopt door de centrale poort, die LIVE de kill switch en de modelallowlist
// toetst. Het maandquotum wordt één keer per chatvraag gereserveerd.

// Centrale instellingen voor de RETRIEVAL-voorbewerking. De answer-generation-
// constanten (AI_MODEL, MAX_TOKENS, MAX_TOKENS_BESTUURLIJK, BESTUURLIJKE_STIJL)
// leven in lib/generatie-kern.ts en worden hierboven geïmporteerd — één gedeelde
// kern voor route én Lab.
const CHUNK_BUDGET = 10;
// 12-08-2026 — budget voor het AANVULLENDE spoor bij een primair document.
// Bewust een eigen budget bovenop CHUNK_BUDGET in plaats van een verdeling
// binnen dat budget: zo houdt het gekozen hoofddocument exact de ruimte die het
// vóór deze wijziging had en kan de verbreding de dekking van dat stuk per
// constructie niet verslechteren. De prompt groeit met hooguit 5 passages.
const AANVULLEND_BUDGET = 5;
// History-aware query-reformulatie (Fase B1) en de contextresolver draaien op
// het STERKE hulpmodel: de rewrite bepaalt wat de retrieval ophaalt, dus fouten
// hier (bv. dubbelzinnige afkortingen verkeerd expanderen) vergiftigen álle
// downstream-resultaten. #311: welk model dat is, bepaalt de fondsconfiguratie
// (taakgroep hulp_sterk, taaktypes chat_contextresolutie/chat_reformulatie) —
// niet langer een constante in deze route.

// Plateau 1 — harde timeout op de vroege contextresolver. De resolver blokkeert
// de retrieval, dus een trage call mag de hele chat niet ophouden: bij overschrijding
// breken we de call écht af (AbortController + signal, patroon map-stap) en vallen
// we terug op de originele vraag.
const CONTEXTRESOLVER_TIMEOUT_MS = 3500;
// De AbortController is het HARDE budget (3500 ms). De SDK-timeout staat bewust
// ruimer, zodat de signal-abort altijd als eerste vuurt en een overschrijding
// betrouwbaar als `timeout` (aborted) wordt geregistreerd i.p.v. als providerfout —
// géén race tussen twee timers op dezelfde deadline.
const CONTEXTRESOLVER_SDK_TIMEOUT_MS = CONTEXTRESOLVER_TIMEOUT_MS + 2000;

// ── Document-scope increment 2: dekkingsbrede strategieën ──────────────────
// Drempel full-document vs. map-reduce, in geschatte tokens (≈ tekens/4). Onder
// de drempel past de volledige documenttekst in één prompt (accuraat, één call);
// erboven verwerken we in batches (map-reduce). Conservatief gekozen: ruim
// binnen het contextvenster, met plek voor systeemprompt + antwoord. Eén knop.
const VOLLEDIG_DOC_TOKEN_DREMPEL = 48000;
// Tokenbudget per map-batch en harde bovengrens op het aantal batches
// (kostenbewaking — voorkomt kostenrunaway bij extreem grote documenten).
const MAP_BATCH_TOKENS = 16000;
const MAX_BATCHES = 8;
const MAP_CONCURRENCY = 2;
const MAP_CALL_TIMEOUT_MS = 20_000;
const MAP_FASE_TIMEOUT_MS = 60_000;
const VOLLEDIGE_ANALYSE_GENERATIE_TIMEOUT_MS = 45_000;
// Conservatieve preflight voor het aanbod: bij 800 tekens/chunk komt 640 chunks
// overeen met het harde mapbudget van 8 × 16k tokens.
const MAX_VOLLEDIGE_ANALYSE_PASSAGES = 640;

function telDekkingslocaties(chunks: DocumentChunk[]): {
  paginas: number;
  secties: number;
} {
  return {
    paginas: new Set(
      chunks
        .map((chunk) => chunk.pagina)
        .filter((pagina): pagina is number => typeof pagina === "number")
    ).size,
    secties: new Set(
      chunks
        .map((chunk) => chunk.paragraaf?.trim())
        .filter((sectie): sectie is string => !!sectie)
    ).size,
  };
}
// Goedkoop/snel model voor de extractieve map-stap; het sterke AI_MODEL doet de
// reduce-stap (kwaliteit van het eindantwoord).
// #311: het mapstap-model komt uit de fondsconfiguratie (taakgroep hulp_snel, taaktype chat_mapstap).

// ── Scenario A live web-retrieval (besluit 0072) ────────────────────────────
// Hoofdschakelaar: web-retrieval draait ALLEEN als WEB_RETRIEVAL_ACTIEF='true'
// (dubbele poort náást DB-actieve whitelist-entries). Staat de vlag uit, dan
// draait de assistent in Scenario B — ongewijzigd gedrag. WEB_MAX_USES begrenst
// het aantal zoekopdrachten per antwoord (kosten-/latency-cap, 0019).
const WEB_RETRIEVAL_ACTIEF = process.env.WEB_RETRIEVAL_ACTIEF === "true";
const WEB_MAX_USES = Number(process.env.WEB_MAX_USES ?? 3) || 3;

type Modus = "documenten" | "combineren" | "algemeen";

// ============================================================
//  Answer-generation-kern → lib/generatie-kern.ts (AQL-2 / spike 1)
// ------------------------------------------------------------
//  De toon-systeemprompt (TOON_BLOK), de per-modus instructiesets (SP_*), de
//  bestuurlijke/sparring-varianten, de vervolgvragen-logica en de system-prompt-
//  builders (bouwStatischeInstructies/bouwDynamischeContext/bouwSysteemBlokken)
//  zijn verplaatst naar lib/generatie-kern.ts en worden bovenaan geïmporteerd.
//  Zo draaien deze streaming-route én het AI Quality Lab EXACT dezelfde kern
//  (byte-identiek; bewaakt door lib/generatie-kern.sanity.ts). Wijzig de
//  toon-prompt daar, niet hier.
//
//  Scenario A live web-retrieval (besluit 0072, GEEFFECTUEERD): SP_WEB_REGELS in
//  generatie-kern instrueert het model uitsluitend te citeren uit de aangeleverde,
//  opgehaalde webresultaten (kind 'web' in lib/assistant-source.ts) — nooit uit
//  verzonnen URL's. De whitelist-fetch + gating + citaat-herverificatie hangen in
//  de streaming-handler hieronder; de UI en het auditspoor waren al voorbereid
//  (AssistantSource.web + source_summary.web_retrieval_actief). Alles achter de
//  env-vlag WEB_RETRIEVAL_ACTIEF (uit = Scenario B, ongewijzigd gedrag).
// ============================================================

// ============================================================
//  POST handler
// ============================================================

interface ChatBericht {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_LIMIT = 12; // laatste N berichten meenemen

// Locatie-prefix voor een chunk in de volledige documenttekst, bv. "[3.2, pag. 12] ".
function locatieLabel(c: DocumentChunk): string {
  const loc = [c.paragraaf, c.pagina ? `pag. ${c.pagina}` : null]
    .filter(Boolean)
    .join(", ");
  return loc ? `[${loc}] ` : "";
}

// ── B-opt tranche 3d — samenstelling van het oorspronkelijke antwoord ────────
// Leidt de feitelijke bronsamenstelling af uit `retrieval_meta.source_summary`
// van de logregel waarop wordt gereflecteerd. Puur afgeleid, geen nieuwe opslag.
// Retourneert de exacte zin voor de prompt, of null wanneer niets bruikbaars is
// vastgesteld (dan mag het model niets over de herkomst zeggen — AC-R7).
function leidSamenstellingAf(retrievalMeta: unknown): string | null {
  if (!retrievalMeta || typeof retrievalMeta !== "object") return null;
  const ss = (retrievalMeta as { source_summary?: unknown }).source_summary;
  if (!ss || typeof ss !== "object") return null;
  const s = ss as { documenten?: unknown; web?: unknown; model_kennis?: unknown };
  const doc = typeof s.documenten === "number" ? s.documenten : 0;
  const web = typeof s.web === "number" ? s.web : 0;
  const model = typeof s.model_kennis === "number" ? s.model_kennis : 0;
  if (doc > 0 && web > 0) return "uw stukken en geverifieerde webbronnen";
  if (doc > 0 && model > 0) return "uw stukken en algemene kennis van het model";
  if (doc > 0) return "alleen uw stukken";
  if (web > 0) return "geverifieerde webbronnen";
  if (model > 0) return "alleen algemene kennis van het model";
  return null;
}

// Bouwt één bronkaart per gescoopt document (i.p.v. per chunk). Voor de brede
// strategieën verwijst het antwoord tekstueel naar pagina's; de UI toont het
// document als bron met een link naar het origineel.
function documentBronnen(chunks: DocumentChunk[]): BronVerwijzing[] {
  const perDoc = new Map<string, BronVerwijzing>();
  for (const c of chunks) {
    if (perDoc.has(c.document_id)) continue;
    perDoc.set(c.document_id, {
      document_id: c.document_id,
      titel: c.documenten.titel,
      bron: c.documenten.bron,
      pagina: null,
      paragraaf: null,
      fragment: "",
      heeft_origineel: !!c.documenten.opslag_pad,
      // Tranche 2B — doorgeefvelden voor de documentlijst; gevuld door
      // verrijkDocumentmetadata() vóór deze aanroep.
      documenttype: c.documenten.documenttype ?? null,
      bestandstype: c.documenten.bestandstype ?? null,
      // Óók de bestaande bronkaartvelden. Ze stonden hier niet, waardoor dit pad
      // als enige geen status, datum of normgewicht toonde — en het filter
      // "alleen vastgesteld" dus 0 van N gaf terwijl de status alleen niet was
      // meegestuurd. `haalDocumentChunks` selecteert ze al.
      documentstatus: c.documenten.documentstatus ?? null,
      bronstatus: c.documenten.bronstatus ?? null,
      documentdatum: c.documenten.documentdatum ?? null,
      geldig_tot: c.documenten.geldig_tot ?? null,
      bibliotheek: c.documenten.bibliotheek ?? null,
      bronorganisatie: c.documenten.bronorganisatie ?? null,
      normgewicht: c.documenten.normgewicht ?? null,
      extern_url: c.documenten.extern_url ?? null,
    });
  }
  return [...perDoc.values()];
}

// ============================================================
//  Increment F (FO §14) — profielgestuurde PRIORITERING
// ----------------------------------------------------------------------------
//  De implementatie van bouwProfielsturing() + het type ProfielsturingAspecten
//  zijn verplaatst naar lib/profielsturing.ts, zodat zowel de AI-assistent als
//  de agenda-voorbereiding dezelfde profielvoorkeuren kunnen hergebruiken
//  (DRY, één bron van waarheid). Zie de import bovenaan dit bestand.
// ============================================================

// SSE-ROUTE (W5, #101) — de meest blootgestelde route van het platform.
//
// `hostGuard: "route-eigen"`, en dat is een WAARDE en geen weglating. De wrapper
// zou de host-guard vóór de handler trekken, en daarmee vóór de fail-closed rate
// limit (H-12) en vóór de eigen `!fondsId`-403. Die volgorde is hier uitgeschreven
// en gemotiveerd: de rate limit is de enige rem op het aantal Opus-aanroepen en
// moet als eerste staan, want anders kost een geweigerd verzoek alsnog een
// teller-omweg. De guard blijft daarom inline staan, met de reden erbij.
// (Zelfde vorm als `documents/upload` in W4.)
//
// W5 raakt ALLEEN de preambule aan. Deze route is 3.735 regels en bevinding S-05;
// splitsen is R-28 en hoort in deploy 3.
//
// Het vangnet van de wrapper omhult alleen de aanroep van deze handler. Zodra de
// Response met de ReadableStream is teruggegeven (het "stream-openpunt", besluit
// 0087) is status 200 verzonden en doet de wrapper niets meer — bewezen met een
// geïnjecteerde throw ná het eerste enqueue in core/lib/route-wrapper.sanity.ts.
export const POST = withFondsRoute({ hostGuard: "route-eigen", rateLimit: "route-eigen", audit: { handeling: "chat.gebruiken" }, capability: "chat.use", schema: z.object({ "actieve_antwoordmodus": z.unknown().optional(), "agendapunt_context": z.unknown().optional(), "algemeen_perspectief": z.unknown().optional(), "alleen_fondsdocumenten": z.unknown().optional(), "bron_intent_bron": z.unknown().optional(), "bron_intent_herkomst": z.unknown().optional(), "bron_intent_override": z.unknown().optional(), "bronkeuze_vorige_log_id": z.unknown().optional(), "const": z.unknown().optional(), "document_scope": z.unknown().optional(), "doorgrond": z.unknown().optional(), "fonds_id": z.unknown().optional(), "gesprek_id": z.unknown().optional(), "messages": z.unknown().optional(), "module_scope": z.unknown().optional(), "neem_niet_vastgestelde_mee": z.unknown().optional(), "reflectie_antwoord": z.unknown().optional(), "reflectie_herformuleren": z.unknown().optional(), "reflectie_start": z.unknown().optional(), "reflectie_tegenperspectief": z.unknown().optional(), "reflectie_verdiepen": z.unknown().optional(), "startvraag_bron": z.unknown().optional(), "stukvoorbereiding": z.unknown().optional(), "transformatie": z.unknown().optional(), "volledige_analyse": z.unknown().optional(), "vraag": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest) => {
  try {
    const body = (await req.json()) as {
      // nieuw: volledige conversatiegeschiedenis
      messages?: ChatBericht[];
      // backwards-compat: één losse vraag
      vraag?: string;
      // NB (T1.3, besluit 0042): de client mag dit veld nog meesturen voor
      // backwards-compat, maar het wordt server-side GENEGEERD. De fonds-scope
      // komt uitsluitend uit de sessie (profiel.fonds_id), nooit uit de body.
      fonds_id?: string;
      // Increment I-2 (FO §11a) — de zichtbare bron-as is vervangen door
      // automatische bronkeuze. De client stuurt geen bron-modus meer; alleen de
      // expliciete restrictie "Alleen fondsdocumenten" (onder "Aanpassen") en —
      // wanneer de gebruiker een verduidelijkingschip koos — de bevestigde intentie.
      alleen_fondsdocumenten?: boolean;
      bron_intent_override?: "fonds" | "algemeen";
      // Document-scope (increment 1): beperk de vraag tot één/enkele document(en).
      // `algemene_kennis` is increment 2 — in increment 1 forceren we strict.
      document_scope?: { document_ids?: string[]; algemene_kennis?: boolean };
      // Increment G — door de gebruiker vastgezette antwoordmodus (gespreksniveau,
      // gesprekken.actieve_antwoordmodus). null/afwezig = auto-detectie per vraag.
      actieve_antwoordmodus?: Antwoordmodus | null;
      // Increment F (FO §14) — "algemeen perspectief"-toggle. true = profielsturing
      // overslaan: identieke bronnen/retrieval, maar het antwoord wordt NIET op het
      // persoonlijke profiel geprioriteerd (collectieve weergave). Afwezig/false =
      // profielsturing actief (indien de gebruiker een profiel heeft ingevuld).
      algemeen_perspectief?: boolean;
      // Transformatie-vervolgactie (FO §13): true = deze beurt bewerkt het VORIGE
      // antwoord (werk uit / duiding / feitelijker / korter / concreter). De route
      // schakelt dan naar herschrijf-intent i.p.v. een nieuwe documentlookup, zodat
      // strict-document niet onterecht "niet aangetroffen" teruggeeft. De client zet
      // dit alleen voor de gesloten set transformatie-acties (isTransformatieActie).
      transformatie?: boolean;
      // ADR 0028 — agendapunt-modus: de vraag is geframed door een agendapunt. De
      // client stuurt alleen het id (+ titel voor weergave); de route haalt de
      // toelichting (agendapunten.beschrijving) zélf op via RLS — zo wordt de
      // fonds-grens server-side afgedwongen en logt het auditspoor de échte
      // toelichting i.p.v. door de client aanleverbare tekst. De meegestuurde
      // document_scope (de gekoppelde stukken) dient dan als retrieval-scope,
      // zónder strict-document gedrag.
      agendapunt_context?: { id?: string; titel?: string };
      // P2 Deel B — "een document doorgronden": de gekozen secties + (bij
      // "Afwijkingen") de aantoonbaar eerdere versie. De zichtbare beurt blijft de
      // korte zin in `messages`; de route stelt hieruit server-side de instructie
      // samen en legt de parameters vast in retrieval_meta (B6). `vorige_document_id`
      // hoort óók in `document_scope.document_ids` te staan (retrieval van beide).
      doorgrond?: { secties?: string[]; vorige_document_id?: string };
      // T2 — bureau-stand "Een stuk voorbereiden". De client kiest een stuksoort;
      // de route stelt hieruit server-side de instructie samen (in de
      // GEBRUIKERSPROMPT) en past de bureau-toon toe — maar UITSLUITEND wanneer de
      // sessie de capability ai.stukvoorbereiding draagt (G2/FR-21). Zonder die
      // capability wordt dit veld genegeerd: geen instructie, geen bureau-toon.
      stukvoorbereiding?: { stuksoort?: string };
      // P2 Deel A — herkomst van een aangeklikte voorbeeldvraag (context|signaal),
      // meegelogd zodat meetbaar is welke generator werkt (criterium 4).
      startvraag_bron?: string;
      // Ingreep 1/2 — herkomst van de bevestigde bron-intentie (auditspoor).
      bron_intent_bron?: string;
      bron_intent_herkomst?: string;
      // 30-07-2026 — de gebruiker koos expliciet "Neem niet-vastgestelde stukken
      // mee" na de melding dat de actualiteitsfilter treffers wegnam.
      neem_niet_vastgestelde_mee?: boolean;
      // Besluit 0137 (antwoord-eerst) — de client klikte een bronkeuze-chip ónder
      // een fondsgericht antwoord ("liever in algemene zin?"). Bevat het log-id van
      // dat eerste antwoord (uit het 'done'-event), zodat de hergegenereerde beurt
      // in het auditspoor naar de eerste verwijst (bronkeuze_herzien). De bevestigde
      // intentie reist mee via bron_intent_override; dit veld is uitsluitend de
      // audit-koppeling. Puur correlatie — geen FK, niet vertrouwd voor autorisatie.
      bronkeuze_vorige_log_id?: string;
      // Plateau A — het id van het gesprek waarin deze beurt valt. De CLIENT
      // genereert dit met crypto.randomUUID() vóór de eerste beurt en gebruikt
      // hetzelfde id als expliciete `id` bij de insert in `gesprekken`. Zonder
      // die volgorde is de eerste interactie van elk gesprek niet koppelbaar —
      // de rij in `gesprekken` ontstaat immers pas ná de stream — en daarmee
      // niet verwijderbaar. Puur correlatie: de waarde wordt niet vertrouwd voor
      // autorisatie (verwijder_gesprek() toetst het eigenaarschap zelf).
      gesprek_id?: string;
      // ── Plateau B — de reflectiedialoog ────────────────────────────────────
      // `reflectie_antwoord` = deze beurt komt uit het GELABELDE reflectie-
      // invoerveld, niet uit de normale invoerbalk. Het onderscheid volgt
      // uitsluitend uit het invoerkanaal; er wordt nooit op inhoud
      // geclassificeerd (FR-56).
      //
      // Dit is een SIGNAAL, geen waarheid. De route vraagt de transitie aan bij
      // reflectie_transitie(), die valideert tegen de opnieuw uitgelezen status.
      // Staat de flow op `niet_actief`, dan faalt die aanroep en wordt de beurt
      // gewoon als normale chatbeurt afgehandeld — een client kan zich dus geen
      // reflectie toe-eigenen (FR-67).
      reflectie_antwoord?: boolean;
      // B-opt tranche 1a — deze beurt is een HERFORMULERING vanuit de
      // conceptweergave: de bestuurder scherpt zijn eigen overweging aan. Ook een
      // signaal, geen waarheid — de RPC weigert `herformuleren` buiten
      // `conceptweergave`, en dan wordt de beurt gewoon als normale chatbeurt
      // afgehandeld (afbreken). Sluit `reflectie_antwoord` uit: de client stuurt
      // er precies één van beide.
      reflectie_herformuleren?: boolean;
      // B-opt tranche 2d — "Nog een stap verdiepen": de bestuurder vraagt vanuit
      // de conceptweergave om één extra verdiepingsvraag. Signaal; de RPC keert
      // terug naar verdieping_{beurt} en weigert bij het beurtplafond.
      reflectie_verdiepen?: boolean;
      // B-opt tranche 4a — "Wat pleit er tegen?": zelfde transitie als verdiepen
      // (conceptweergave → verdieping_{beurt}), maar een andere promptvariant. De
      // assistent VRAAGT om het tegenargument, hij levert het niet.
      reflectie_tegenperspectief?: boolean;
      // De reflectie-ingang bij het STARTEN van een flow, plus het id van de
      // logregel waarvan de bronset wordt bevroren. De RPC toetst zelf dat die
      // logregel van deze gebruiker én dit gesprek is (AC-18).
      reflectie_start?: { ingang?: string; bronset_log_id?: string };
      // Besluit 0151 — AI-modulecontext. De client stuurt ALLEEN de sleutel; de
      // server resolveert de inhoud onder RLS. Drie soorten: een procesdossier,
      // de fondsbrede risicomatrix, of de verdieping op één risico. Net als een
      // document_scope zet een geldige module_scope de intent-heuristiek uit.
      module_scope?: {
        soort?: string;
        procedure_id?: string;
        risico_id?: string;
      };
      // M7 — expliciete vervolgactie vanuit een eerder targeted antwoord. De
      // server valideert eigenaar, fonds, originele vraag en document opnieuw.
      volledige_analyse?: {
        origineel_log_id?: string;
        document_id?: string;
      };
    };
    // ── H-12 (review 2026-07-30): runtime-validatie + harde invoercaps ─────
    // De historie kwam via een TypeScript-cast binnen en werd nergens op vorm
    // of lengte gecontroleerd; alleen het laatste bericht werd getoetst. Dat
    // gaf twee problemen: (a) denial-of-wallet — onbegrensde invoer op een
    // Opus-model, en (b) guardrail-bypass — een gefabriceerde "assistant"-beurt
    // kan de instructieset relativeren. Zie core/lib/chat-invoer.ts.
    // B-opt tranche 2d/4a — "Nog een stap verdiepen" en "Wat pleit er tegen?"
    // laten de assistent de volgende vraag stellen zonder nieuwe gebruikersbeurt;
    // de historie eindigt dan bewust op de conceptweergave (assistentbeurt).
    const reflectieVervolg =
      body.reflectie_verdiepen === true || body.reflectie_tegenperspectief === true;
    const invoer = valideerChatInvoer(body.messages, body.vraag, { reflectieVervolg });
    if (!invoer.ok) {
      return NextResponse.json(
        { error: invoer.melding, foutcode: invoer.foutcode },
        { status: invoer.status }
      );
    }
    const messages: ChatBericht[] = invoer.messages;
    const vraag = invoer.vraag;
    // B1: opsteltaak-detectie → opsteller-register (TOON_BLOK_OPSTELLER) i.p.v. de
    // gesprekspartner-toon op de normale antwoord-takken (algemeen/combineren/
    // documenten). Corrigeert alleen de toon; ontsluit geen bevoegdheid.
    const opstelTaak = isOpsteltaak(vraag);

    // Authenticatie — door withFondsRoute.
    const supabase = ctx.supabase;

    // Rate limiting (WP2): vóór RAG/Anthropic, zodat een loop geen kosten maakt.
    // Moet vóór de SSE-stream gebeuren — een 429 is een gewone JSON-response.
    // H-12: fail-closed. Bij een storing in de teller is doorlaten juist de
    // duurste optie — dit is de enige rem op het aantal Opus-aanroepen.
    const limiet = await controleerLimiet(supabase, LIMIETEN.chat, {
      failClosed: true,
    });
    if (!limiet.toegestaan) return rateLimited("chat.POST", limiet.resetAt);

    // Profiel + fondsnaam ophalen voor persoonlijke context
    const { data: profiel } = await supabase
      .from("profielen")
      // T4 — het geldende wettelijk regime van het fonds meelezen (fonds-niveau,
      // geen PII). Stuurt de regime-demotie in de retrieval (RetrievalFilters).
      .select("naam, rol, fonds_id, fondsen(naam, primair_wettelijk_regime)")
      .eq("id", ctx.gebruikerId)
      .single();

    // Fonds-scope komt UITSLUITEND uit de sessie (T1.3, besluit 0042). Nooit uit
    // de request-body — dat was de laatste client-gestuurde fonds-filter. Zonder
    // gekoppeld fonds is er geen tenant-context: fail-closed 403.
    const fondsId = profiel?.fonds_id ?? null;
    if (!fondsId) {
      return NextResponse.json(
        { error: "Geen fonds gekoppeld aan dit account" },
        { status: 403 }
      );
    }

    // T1.3 — host↔fonds-afdwinging (defense-in-depth náást RLS), vóór retrieval/
    // Anthropic. Observe + fail-closed onder TENANT_ENFORCE=on; gedrag-neutraal
    // zolang enforce uit staat.
    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: fondsId,
      gebruikerId: ctx.gebruikerId,
      label: "chat.POST",
    });
    if (!hostOordeel.toegestaan) {
      return NextResponse.json(
        { error: "Dit webadres hoort niet bij uw fonds." },
        { status: 403 }
      );
    }

    // T8 — server-side BESCHIKBAARHEIDSgate op dit hoog-risico module-entrypoint.
    // Staat de AI-module in het manifest van dit fonds UIT, dan weigeren we de
    // directe API-call (403) — niet alleen UI-verborgen. BESCHIKBAARHEID ≠
    // AUTORISATIE: dit komt BOVENOP de bestaande auth/RLS-checks en vervangt die
    // nooit. fondsId is server-side afgeleid (profiel), nooit uit de body.
    const moduleWeigering = await weigerAlsModuleUit(fondsId, "ai");
    if (moduleWeigering) return moduleWeigering;

    // M9 — per-fonds rollout. Alle drie default uit; afhankelijke functies
    // kunnen nooit buiten de hoofdrouter om activeren.
    const vraagrouterVlaggen = await vraagrouterVlaggenVoorFonds(fondsId);

    // M7 — valideer een expliciete volledige-analysevervolgactie vóór er quota
    // wordt gereserveerd of een provider wordt aangeroepen. Beide tabellen staan
    // onder RLS; de expliciete gebruiker-/fondsfilters zijn defense-in-depth.
    let volledigeAnalyseUitgevoerd = false;
    let volledigeAnalyseVorigeLogId: string | null = null;
    let volledigeAnalyseDocumentId: string | null = null;
    if (body.volledige_analyse) {
      if (!vraagrouterVlaggen.volledigeAnalyseVervolg) {
        return NextResponse.json(
          { error: "De volledige-analysefunctie is voor dit fonds niet actief." },
          { status: 400 }
        );
      }
      const vorigId =
        typeof body.volledige_analyse.origineel_log_id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.volledige_analyse.origineel_log_id
        )
          ? body.volledige_analyse.origineel_log_id
          : null;
      const documentId =
        typeof body.volledige_analyse.document_id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.volledige_analyse.document_id
        )
          ? body.volledige_analyse.document_id
          : null;
      if (!vorigId || !documentId) {
        return NextResponse.json(
          { error: "De verwijzing naar de eerdere analyse is ongeldig." },
          { status: 400 }
        );
      }
      const [{ data: vorigSpoor }, { data: vorigeInhoud }] = await Promise.all([
        supabase
          .from("governance_log")
          .select("id, gebruiker_id, fonds_id, retrieval_meta")
          .eq("id", vorigId)
          .eq("gebruiker_id", ctx.gebruikerId)
          .eq("fonds_id", fondsId)
          .maybeSingle(),
        supabase
          .from("governance_log_inhoud")
          .select("log_id, vraag")
          .eq("log_id", vorigId)
          .maybeSingle(),
      ]);
      const vorigMeta =
        vorigSpoor?.retrieval_meta && typeof vorigSpoor.retrieval_meta === "object"
          ? (vorigSpoor.retrieval_meta as Record<string, unknown>)
          : {};
      const vorigScope =
        vorigMeta.scope && typeof vorigMeta.scope === "object"
          ? (vorigMeta.scope as Record<string, unknown>)
          : {};
      const vorigeVolledigeAnalyse =
        vorigMeta.volledige_analyse && typeof vorigMeta.volledige_analyse === "object"
          ? (vorigMeta.volledige_analyse as Record<string, unknown>)
          : {};
      const vorigeIds = Array.isArray(vorigScope.document_ids)
        ? vorigScope.document_ids.filter((id): id is string => typeof id === "string")
        : [];
      const origineleVraag =
        typeof vorigeInhoud?.vraag === "string" ? vorigeInhoud.vraag.trim() : "";
      const geldigVervolg =
        !!vorigSpoor?.id &&
        origineleVraag.length > 0 &&
        origineleVraag === vraag.trim() &&
        vorigScope.strategie === "targeted" &&
        vorigeIds.length === 1 &&
        vorigeIds[0] === documentId &&
        vorigeVolledigeAnalyse.aangeboden === true;
      if (!geldigVervolg) {
        return NextResponse.json(
          { error: "Deze volledige analyse hoort niet bij een geldig eerder antwoord." },
          { status: 400 }
        );
      }
      volledigeAnalyseUitgevoerd = true;
      volledigeAnalyseVorigeLogId = vorigId;
      volledigeAnalyseDocumentId = documentId;
    }

    // ── AI-begrenzing (besluit 0180) ────────────────────────────────────────
    // Eén chatvraag = ÉÉN AI-actie, ongeacht hoeveel modelcalls eruit
    // voortkomen (Opus-stream + tot twaalf Haiku-mapstappen + reformulatie +
    // embeddings + reranker). Reserveren gebeurt hier, vóór de eerste
    // providercall; de poort hieronder draait daarna per afzonderlijke call.
    const idempotentie = sleutelUitRequest(req, "chat");
    if (!idempotentie) {
      return badRequest(
        "chat.POST",
        "Verzoek mist een geldige Idempotency-Key. Vernieuw de pagina en probeer het opnieuw."
      );
    }
    const pf = await preflight(supabase, {
      actietype: "chat",
      provider: "anthropic",
      model: AI_MODEL,
      idempotentie,
      // De vingerafdruk bindt de sleutel aan de INHOUD: dezelfde sleutel met een
      // andere vraag wordt geweigerd, zodat een hergebruikte sleutel geen
      // gratis kanaal wordt.
      vingerafdruk: vingerafdruk({
        vraag: body.vraag ?? null,
        berichten: body.messages?.length ?? 0,
        volledige_analyse_log_id: volledigeAnalyseVorigeLogId,
        volledige_analyse_document_id: volledigeAnalyseDocumentId,
      }),
    });
    const aiBlokkade = preflightRespons("chat.POST", pf);
    if (aiBlokkade) return aiBlokkade;
    const aiActieId = pf.uitkomst === "nieuw" ? pf.actieId : null;

    // #311 — één gateway-context per beurt: fonds en gebruiker uit de
    // sessiecontext, de reservering als bewijs, de request-id als correlatie.
    // Alle providercalls in deze route (contextresolver, reformulatie,
    // vraagrouter, reranker, mapstap, eindgeneratie, vergelijking) lopen hierdoor.
    const gateway = productieGateway();
    const gatewayCtx: GatewayContext = {
      supabase,
      fondsId,
      actor: { soort: "gebruiker", id: ctx.gebruikerId },
      actieId: aiActieId,
      correlatieId: ctx.requestId,
      label: "chat.POST",
    };

    // Increment T4 — manipulatie-signaal: de client MAG body.fonds_id nog meesturen
    // (backwards-compat), maar hij wordt genegeerd. Wijkt hij af van de server-side
    // fonds, dan is dat een poging tot cross-tenant sturing: log het en leg het vast
    // in retrieval_meta (body_fonds_id_genegeerd). De retrieval draait onverstoord
    // op de server-side fonds — dit is puur diagnostiek/auditspoor.
    const bodyFondsAfwijkend =
      typeof body.fonds_id === "string" &&
      body.fonds_id.length > 0 &&
      body.fonds_id !== fondsId;
    if (bodyFondsAfwijkend) {
      console.warn(
        `[T4] body.fonds_id (${body.fonds_id}) wijkt af van sessie-fonds (${fondsId}) — genegeerd (gebruiker ${ctx.gebruikerId}).`
      );
    }

    const fondsenRel = profiel?.fondsen as
      | { naam: string; primair_wettelijk_regime?: string | null }
      | { naam: string; primair_wettelijk_regime?: string | null }[]
      | null
      | undefined;
    const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
    // T4 — het geldende regime (pw/wvb/beide/algemeen; NULL ≡ algemeen → geen
    // demotie). Alleen een specifiek regime (pw/wvb) leidt tot demotie; de weging
    // (lib/weeg-regime) no-opt op de rest, dus doorgeven-zoals-is is veilig.
    const fondsRegime =
      (fondsenObj?.primair_wettelijk_regime ?? undefined) as
        | RetrievalFilters["primairRegime"]
        | undefined;

    const volledigeNaam = profiel?.naam || ctx.email || "een bestuurslid";
    const voornaam = volledigeNaam.split(" ")[0] || volledigeNaam;
    const rolLabel = ROL_LABEL[profiel?.rol || "bestuurder"] || "bestuurslid";
    const fondsnaam =
      fondsenObj?.naam || process.env.NEXT_PUBLIC_FONDS_NAAM || "het pensioenfonds";

    const ctxBestuurder: BestuurderContext = {
      voornaam,
      volledigeNaam,
      rolLabel,
      fondsnaam,
    };

    // ── Increment F (FO §14) — profielgestuurde PRIORITERING ────────────────
    // Standaard actief; de "algemeen perspectief"-toggle (body.algemeen_perspectief)
    // schakelt de prioritering uit zonder iets aan de bronnen/retrieval te wijzigen.
    // De sturing landt alleen in het dynamische contextblok (zie bouwDynamischeContext),
    // nooit in de gecachte toon-systeemprompt of de retrievalfilters.
    const algemeenPerspectief = body.algemeen_perspectief === true;
    let profielsturingStatus: NonNullable<RetrievalMeta["profielsturing"]>;
    let profielsturingAspecten: ProfielsturingAspecten | undefined;
    if (algemeenPerspectief) {
      profielsturingStatus = "uitgeschakeld";
    } else {
      const sturing = await bouwProfielsturing(supabase, ctx.gebruikerId);
      if (sturing) {
        ctxBestuurder.profielsturing = sturing.tekst;
        profielsturingStatus = "actief";
        profielsturingAspecten = sturing.aspecten;
      } else {
        profielsturingStatus = "geen-profiel";
      }
    }

    // ── OP-3 (FO Organisatieprofiel v0.4 §6, B3, FR-10) — organisatieprofiel ──
    // Generiek, bestuurlijk-licht contextprofiel van de EIGEN organisatie. Injectie
    // op de server-geverifieerde fonds_id van de ingelogde gebruiker (nooit de
    // client-waarde), zodat nooit een ander fonds lekt. Leeg/ontbrekend → geen blok.
    // Naast — niet in plaats van — profielsturing.
    let organisatieprofielStatus: NonNullable<RetrievalMeta["organisatieprofiel"]> =
      "geen-profiel";
    let organisatieprofielAspecten:
      | NonNullable<RetrievalMeta["organisatieprofiel_aspecten"]>
      | undefined;
    if (profiel?.fonds_id) {
      const orgProfiel = await bouwOrganisatieprofiel(supabase, profiel.fonds_id);
      if (orgProfiel) {
        ctxBestuurder.organisatieprofiel = orgProfiel.tekst;
        organisatieprofielStatus = "actief";
        organisatieprofielAspecten = orgProfiel.aspecten;
      }
    }

    // T4 Regime-borging (Deel B) — prompt-blok B6. Onafhankelijk van het
    // organisatieprofiel (een fonds met een specifiek regime maar leeg profiel
    // krijgt B6 wél). null bij beide/algemeen/NULL-regime → geen blok.
    ctxBestuurder.regimeKader = bouwRegimeKaderBlok(fondsRegime);

    // ── ADR 0028 — agendapunt-modus: toelichting als seed-context ────────────
    // De route haalt titel + toelichting zélf op via RLS. Een vreemd-fonds-id
    // (of verwijderd punt) geeft niets terug → modus uit (criterium 7 server-side).
    const agendapuntIdRaw =
      typeof body.agendapunt_context?.id === "string" ? body.agendapunt_context.id : "";
    let agendapuntSeed: AgendapuntSeed | null = null;
    if (agendapuntIdRaw) {
      const { data: apRow } = await supabase
        .from("agendapunten")
        .select("id, titel, beschrijving")
        .eq("id", agendapuntIdRaw)
        .maybeSingle();
      if (apRow?.id) {
        agendapuntSeed = {
          id: apRow.id as string,
          titel: (apRow.titel as string) || "dit agendapunt",
          toelichting: (apRow.beschrijving as string | null) ?? null,
        };
      }
    }
    const agendapuntModusActief = agendapuntSeed !== null;

    // ── FO duiding v0.3 (06-07) — fondsbrede module-context ─────────────────
    // Actieve risico's + lopende procedures gaan compact mee (zelfde selecties als
    // de voorbereiding-route). Geen genummerde bronnen: het model verwijst bij naam
    // (herleidbaarheidskeuze gelijk aan de voorbereiding-route; profielsturing loopt
    // al generiek via Increment F). Wordt ingezet in agendapunt-modus én — sinds
    // contextbesef (besluit 0090) — bij een persoonlijke/statusgerichte vraag; bij
    // een zuiver algemene vraag gaat er niets extra's mee (kosten/ruis-afweging).
    const haalModuleContextBlok = async (fid: string): Promise<string> => {
      const [{ data: risicoRows }, { data: procedureRows }] = await Promise.all([
        supabase
          .from("risicos")
          .select("titel, toelichting, niveau, type_risico, categorie")
          .eq("fonds_id", fid)
          .eq("status", "actief")
          .order("niveau", { ascending: false })
          .limit(15),
        supabase
          .from("procedures")
          .select("titel, beschrijving, status, template_code")
          .eq("fonds_id", fid)
          .neq("status", "afgerond")
          .order("gestart_op", { ascending: false })
          .limit(10),
      ]);
      const delen: string[] = [];
      if ((risicoRows?.length ?? 0) > 0) {
        delen.push(
          `=== ACTIEVE RISICO'S VAN HET FONDS (context — geen genummerde bron; verwijs bij naam) ===\n` +
            risicoRows!
              .map(
                (r) =>
                  `- [${String(r.niveau).toUpperCase()}] ${r.titel} (${r.categorie}, ${r.type_risico})${r.toelichting ? ` — ${String(r.toelichting).slice(0, 200)}` : ""}`
              )
              .join("\n")
        );
      }
      if ((procedureRows?.length ?? 0) > 0) {
        delen.push(
          `=== LOPENDE PROCEDURES (context — geen genummerde bron; verwijs bij naam) ===\n` +
            procedureRows!
              .map(
                (p) =>
                  `- ${p.titel} (${p.template_code}, ${p.status})${p.beschrijving ? ` — ${String(p.beschrijving).slice(0, 200)}` : ""}`
              )
              .join("\n")
        );
      }
      return delen.length > 0 ? `\n\n${delen.join("\n\n")}` : "";
    };

    // In agendapunt-modus staat de fondsbrede context al vóór het streamen vast
    // (die tak raakt de verduidelijkingstak nooit). De persoonlijke portaalstand +
    // de fondsbrede context voor een gewone persoonlijke/statusvraag worden PAS in
    // de stream opgebouwd (ná de verduidelijkingstak), zodat een onzekere statusvraag
    // die terugvraagt geen queries verspilt.
    let modulesBlok =
      agendapuntModusActief && profiel?.fonds_id
        ? await haalModuleContextBlok(profiel.fonds_id)
        : "";

    // ── Document-scope (increment 1): server-side validatie vóór retrieval ──
    // De client mag document_id's meesturen, maar de server valideert altijd
    // (§7): bestaat, actief, toegang (RLS), geïndexeerd. Faalt een check, dan een
    // concrete melding — nooit een stille terugval naar de hele bibliotheek.
    let scopeHerkomst: VraagScope = "fondscollectie";
    let gevraagdeScopeIds = volledigeAnalyseDocumentId
      ? [volledigeAnalyseDocumentId]
      : (body.document_scope?.document_ids ?? []).filter(
          (id) => typeof id === "string" && id.length > 0
        );
    if (gevraagdeScopeIds.length > 0) scopeHerkomst = "geselecteerd_document";

    // ── Plateau 1 — vroege contextresolutie ────────────────────────────────
    // Leidt vóór de eerste contextgevoelige routering/detectie één zelfstandige
    // `effectieveVraag` af uit de actuele vraag + de al meegestuurde historie.
    // Plaats: ná de poorten (rate limit/fonds/host/module/preflight) en ná de
    // agendapunt-seed, maar vóór documentnaam-detectie en bronintentie.
    //
    // Skip (geen modelcall) op de speciale paden met een eigen contract: die doen
    // geen onderwerp-arme-vervolg-retrieval. Een enkel laat-bekend pad
    // (server-status-reflectie, doorgronden zonder body-secties) kan de resolver
    // tóch draaien, maar `effectieveVraag` wordt daar bewust NIET geconsumeerd —
    // die takken houden de ruwe `vraag`/`vraagVoorPrompt`.
    const contextModus = chatcontextModus();
    const contextPriorBeurten = messages.slice(0, -1).map((b) => ({
      role: b.role,
      content: b.content,
    }));
    const contextSpeciaalPad =
      reflectieVervolg ||
      body.reflectie_antwoord === true ||
      body.reflectie_herformuleren === true ||
      !!body.reflectie_start ||
      body.transformatie === true ||
      !!body.stukvoorbereiding?.stuksoort ||
      (body.doorgrond?.secties?.length ?? 0) > 0 ||
      agendapuntModusActief ||
      gevraagdeScopeIds.length > 0 ||
      !!body.module_scope?.soort ||
      volledigeAnalyseUitgevoerd;
    const magContextResolveren =
      contextPriorBeurten.length > 0 && !contextSpeciaalPad;

    let vraagContext: VraagContext | null = null;
    if (contextModus !== "off") {
      vraagContext = await resolveVraagContext({
        origineleVraag: vraag,
        priorBeurten: contextPriorBeurten,
        modus: contextModus,
        magResolveren: magContextResolveren,
        roepModelAan: async (systeem, gebruiker) => {
          // Echte, afbreekbare timeout — patroon van de map-stap (AbortController
          // + signal). Puur Promise.race zou de call laten dooretteren.
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), CONTEXTRESOLVER_TIMEOUT_MS);
          const start = Date.now();
          // Expliciete runtimewaarde: pas true zodra de PROVIDERCALL echt start.
          // Een poortweigering (bewaakteAnthropic) draait de callback niet en telt
          // dus NIET als modelcall; een timeout ná start telt wél.
          let providercallGestart = false;
          try {
            providercallGestart = true;
            const resp = await gateway.genereer(gatewayCtx, {
              taaktype: "chat_contextresolutie",
              systeem,
              berichten: [{ role: "user", content: gebruiker }],
              maxTokens: 220,
              temperature: 0,
              timeoutMs: CONTEXTRESOLVER_SDK_TIMEOUT_MS,
              signal: ctrl.signal,
            });
            return {
              tekst: resp.tekst,
              meting: {
                model: resp.model,
                duurMs: Date.now() - start,
                tokensIn: resp.usage.in,
                tokensOut: resp.usage.out,
                timeout: false,
                modelAangeroepen: true,
              },
            };
          } catch (e) {
            // Nooit throwen: de resolver beslist de fallback op basis van de meting.
            // Drie onderscheidbare gevallen, expliciet (niet uit lege tekst afgeleid):
            //   aborted            → timeout ná callstart;
            //   call gestart, fout → providerfout;
            //   niet gestart       → configuratie-/poortweigering vóór het netwerk
            //                        (geen modelcall; de gateway stopt daar).
            if (isVoorNetwerkGestopt(e)) providercallGestart = false;
            const aborted = ctrl.signal.aborted;
            return {
              tekst: "",
              meting: {
                model: "niet_bepaald",
                duurMs: Date.now() - start,
                tokensIn: 0,
                tokensOut: 0,
                timeout: aborted,
                modelAangeroepen: providercallGestart,
                ...(!aborted && providercallGestart
                  ? { foutreden: "providerfout" as const }
                  : {}),
              },
            };
          } finally {
            clearTimeout(timer);
          }
        },
      });
    }
    // Downstream-vraag: alleen in enforce stuurt de effectieve vraag de keten.
    // In off én observe sturen de downstream-callsites op de ruwe vraag. Verschil:
    // `off` is byte-identiek aan het huidige gedrag (geen resolver); `observe` is
    // gedragsmatig NIET-afdwingend — dezelfde downstream-beslissingen en antwoord-
    // inhoud, maar mét een resolver-modelcall, extra latency/kosten en auditmetadata.
    const effectieveVraag =
      contextModus === "enforce" && vraagContext
        ? vraagContext.effectieveVraag
        : vraag;

    // M3 — een letterlijk genoemd document mag alleen automatisch scope worden
    // als precies één actief/geïndexeerd/toegankelijk document onder RLS past.
    // Bij meerdere kandidaten vragen we gericht te kiezen; nooit gokken.
    if (
      vraagrouterVlaggen.routerV2 &&
      gevraagdeScopeIds.length === 0 &&
      !agendapuntModusActief
    ) {
      // Lees de volledige onder RLS toegankelijke titelset gepagineerd. Een
      // vaste `.limit(500)` kan bij 501+ documenten ten onrechte "uniek" zeggen
      // terwijl een tweede gelijknamig document buiten de eerste pagina valt.
      // Boven de defensieve cap leiden we daarom géén scope af (veilig targeted).
      const benoembareRijen: { id: string; titel: string }[] = [];
      const titelPagina = 1000;
      const titelCap = 5000;
      let titelsetCompleet = true;
      for (let vanaf = 0; vanaf < titelCap; vanaf += titelPagina) {
        const { data: pagina, error: titelFout } = await supabase
          .from("documenten")
          .select("id, titel")
          .not("actief", "is", false)
          .eq("geindexeerd", true)
          .order("id", { ascending: true })
          .range(vanaf, vanaf + titelPagina - 1);
        if (titelFout) {
          titelsetCompleet = false;
          break;
        }
        benoembareRijen.push(
          ...(pagina ?? []).map((d) => ({
            id: d.id as string,
            titel: (d.titel as string) || "(zonder titel)",
          }))
        );
        if ((pagina?.length ?? 0) < titelPagina) break;
        if (vanaf + titelPagina >= titelCap) titelsetCompleet = false;
      }
      const naamResultaat = resolveerGenoemdDocument(
        effectieveVraag,
        titelsetCompleet ? benoembareRijen : []
      );
      if (naamResultaat.status === "meerdere") {
        return NextResponse.json(
          {
            error:
              "Meerdere documenten passen bij deze naam: " +
              naamResultaat.kandidaten.map((d) => `«${d.titel}»`).join(", ") +
              ". Kies het bedoelde document via @ of de documentlijst.",
          },
          { status: 400 }
        );
      }
      if (naamResultaat.status === "eenduidig") {
        const { data: eersteChunk } = await supabase
          .from("document_chunks")
          .select("document_id")
          .eq("document_id", naamResultaat.document.id)
          .limit(1);
        if ((eersteChunk?.length ?? 0) > 0) {
          gevraagdeScopeIds = [naamResultaat.document.id];
          scopeHerkomst = "genoemd_document";
        }
      }
    }
    let scopeDocumentIds: string[] | undefined;
    let scopeTitels: string[] = [];
    // Titel per (server-gevalideerd) scope-id — bron voor het "Afwijkingen"-label
    // in de doorgrond-instructie (P2 Deel B), zodat de route de voorgangertitel niet
    // van de client hoeft te vertrouwen.
    const scopeTitelPerId = new Map<string, string>();

    if (gevraagdeScopeIds.length > 0) {
      // Documentrijen ophalen — RLS beperkt tot eigen fonds (+ generiek). Een
      // vreemd-fonds-id valt buiten deze set en wordt door valideerScope afgewezen.
      const { data: docRows } = await supabase
        .from("documenten")
        .select("id, titel, bron, actief, geindexeerd, gepubliceerd, aangemaakt")
        .in("id", gevraagdeScopeIds);

      // Chunk-presentie per document (is het doorzoekbaar gemaakt?).
      const { data: chunkRows } = await supabase
        .from("document_chunks")
        .select("document_id")
        .in("document_id", gevraagdeScopeIds)
        .limit(2000);
      const metChunks = new Set(
        (chunkRows ?? []).map((r) => r.document_id as string)
      );

      const gevonden: ScopeDocumentRij[] = (docRows ?? []).map((d) => ({
        id: d.id as string,
        titel: (d.titel as string) ?? "(zonder titel)",
        bron: (d.bron as string) ?? "",
        actief: d.actief !== false,
        geindexeerd: d.geindexeerd === true,
        gepubliceerd: (d.gepubliceerd as string | null) ?? null,
        aangemaakt: (d.aangemaakt as string | null) ?? null,
        heeft_chunks: metChunks.has(d.id as string),
      }));

      if (agendapuntModusActief) {
        // Agendapunt-modus (ADR 0028): de gekoppelde stukken zijn de retrieval-
        // scope, maar GEEN strict gedrag en GEEN harde 400. Een verse, nog niet
        // geïndexeerde stuk wordt stil weggelaten; 0 geldige stukken → toelichting-
        // only (de vraag wordt dan op de toelichting beantwoord, criterium 2).
        const geldig = gevonden.filter(
          (d) => d.actief && d.geindexeerd && d.heeft_chunks
        );
        scopeDocumentIds = geldig.length > 0 ? geldig.map((d) => d.id) : undefined;
        scopeTitels = geldig.map((d) => d.titel);
      } else {
        const validatie = valideerScope(gevraagdeScopeIds, gevonden);
        if (!validatie.ok) {
          return NextResponse.json({ error: validatie.melding }, { status: 400 });
        }
        scopeDocumentIds = validatie.documenten.map((d) => d.id);
        scopeTitels = validatie.documenten.map((d) => d.titel);
      }
      for (const d of gevonden) scopeTitelPerId.set(d.id, d.titel);
    }

    // ── Module-scope (besluit 0151) — server-side resolutie onder RLS ────────
    // De client stuurt alleen de sleutel; de inhoud wordt hier onder RLS
    // opgebouwd. Een id van een ander fonds valt door RLS weg en wordt GEWEIGERD
    // (400) — nooit een stille terugval. De `risicomatrix`-soort kent geen id en
    // is altijd geldig (leeg fonds → expliciet "geen risico's", geen weigering).
    // Een geldige module-scope zet — net als document_scope — de intent-heuristiek
    // uit (moduleScopeActief hieronder). Het contextblok reist als BENOEMDE tekst
    // mee via portaalContextPrefix; de instructie zit ín het blok (sha256-pin
    // ongewijzigd). Proces is een HYBRIDE: het blok geeft reikwijdte/fase, en de
    // gekoppelde bewijsstukken worden — net als agendapunt-modus (ADR 0028), niet
    // strict-document — als retrieval-scope ([Bron N]) gezet.
    const moduleScope: ModuleScope | null = parseModuleScope(body.module_scope);
    let moduleScopeBlok = "";
    let moduleScopeSoort: ModuleScopeSoort | null = null;
    let procesModusActief = false;
    let procesMetStukken = false;
    let moduleScopeBronIds: string[] = [];
    // Sleutel (procedure_id/risico_id) voor het auditspoor (module_scope-meta).
    let moduleScopeSleutel: { procedure_id?: string; risico_id?: string } = {};

    if (moduleScope) {
      moduleScopeSoort = moduleScope.soort;

      if (moduleScope.soort === "risicomatrix") {
        // Fondsbreed: alle risico's (RLS) + de recentste weging-/sluitregels.
        const { data: risicoRows } = await supabase
          .from("risicos")
          .select(
            "id, categorie, titel, toelichting, kans, impact, niveau, type_risico, status, eigenaar_naam, volgende_beoordeling, gesloten_op, sluit_motivering"
          )
          .eq("fonds_id", fondsId)
          .order("niveau", { ascending: false });
        const risicos = (risicoRows ?? []) as RisicoRij[];
        const titelPerId = new Map(risicos.map((r) => [r.id, r.titel]));
        let logs: RisicoLogRij[] = [];
        if (risicos.length > 0) {
          const { data: logRows } = await supabase
            .from("risico_log")
            .select("risico_id, event_type, payload, actor_naam, tijdstip")
            .in("risico_id", Array.from(titelPerId.keys()))
            .order("tijdstip", { ascending: false })
            .limit(80);
          logs = (logRows ?? []).map((l) => ({
            risico_id: l.risico_id as string,
            risico_titel: titelPerId.get(l.risico_id as string) ?? "risico",
            event_type: l.event_type as string,
            payload: l.payload,
            actor_naam: (l.actor_naam as string | null) ?? null,
            tijdstip: (l.tijdstip as string | null) ?? null,
          }));
        }
        moduleScopeBlok = bouwRisicomatrixBlok(risicos, logs);
      } else if (moduleScope.soort === "risico") {
        // Verdieping op één risico. RLS-weigering bij een vreemd-fonds-id.
        const { data: r } = await supabase
          .from("risicos")
          .select(
            "id, categorie, titel, toelichting, kans, impact, niveau, type_risico, status, eigenaar_naam, volgende_beoordeling, gesloten_op, sluit_motivering"
          )
          .eq("id", moduleScope.risico_id)
          .maybeSingle();
        if (!r?.id) {
          // Manipulatiesignaal (vgl. de body.fonds_id-lijn): een risico-id dat onder
          // RLS niets teruggeeft is ofwel verwijderd ofwel van een ander fonds.
          console.warn(
            `[0151] module_scope risico_id (${moduleScope.risico_id}) niet gevonden onder RLS — geweigerd (gebruiker ${ctx.gebruikerId}, fonds ${fondsId}).`
          );
          return NextResponse.json(
            { error: "Het gekozen risico is niet gevonden of u heeft er geen toegang toe." },
            { status: 400 }
          );
        }
        const risico = r as RisicoRij;
        const [{ data: logRows }, { data: maatregelRows }] = await Promise.all([
          supabase
            .from("risico_log")
            .select("risico_id, event_type, payload, actor_naam, tijdstip")
            .eq("risico_id", risico.id)
            .order("tijdstip", { ascending: false }),
          supabase
            .from("risico_maatregelen")
            .select("beschrijving, status, verantwoordelijke, volgorde")
            .eq("risico_id", risico.id)
            .order("volgorde", { ascending: true }),
        ]);
        const logs: RisicoLogRij[] = (logRows ?? []).map((l) => ({
          risico_id: l.risico_id as string,
          risico_titel: risico.titel,
          event_type: l.event_type as string,
          payload: l.payload,
          actor_naam: (l.actor_naam as string | null) ?? null,
          tijdstip: (l.tijdstip as string | null) ?? null,
        }));
        const maatregelen = (maatregelRows ?? []) as MaatregelRij[];
        moduleScopeBlok = bouwRisicoBlok(risico, logs, maatregelen);
        moduleScopeSleutel = { risico_id: risico.id };
      } else if (moduleScope.soort === "proces") {
        // Reikwijdte/fase uit het Decision Object + de gekoppelde bewijsstukken.
        const { data: proc } = await supabase
          .from("procedures")
          .select(
            "id, titel, status, template_code, template_versie, beschrijving, decision_id"
          )
          .eq("id", moduleScope.procedure_id)
          .maybeSingle();
        if (!proc?.id) {
          console.warn(
            `[0151] module_scope procedure_id (${moduleScope.procedure_id}) niet gevonden onder RLS — geweigerd (gebruiker ${ctx.gebruikerId}, fonds ${fondsId}).`
          );
          return NextResponse.json(
            { error: "Het gekozen proces is niet gevonden of u heeft er geen toegang toe." },
            { status: 400 }
          );
        }
        // Decision Object (via decision_id, anders via procedure_id) onder RLS.
        let decisionRij: DecisionRij | null = null;
        const decisionQuery = supabase
          .from("decision_objects")
          .select(
            "besluitvraag, aanleiding, scope, governance_orgaan, complexiteit, risiconiveau, mandaatgevoelig, toezichtgevoelig, beleidsafwijking, ai_risicoklasse, status"
          );
        const { data: decisionRow } = proc.decision_id
          ? await decisionQuery.eq("id", proc.decision_id as string).maybeSingle()
          : await decisionQuery.eq("procedure_id", proc.id).eq("is_primary_decision", true).maybeSingle();
        if (decisionRow) decisionRij = decisionRow as DecisionRij;

        // Stappen → huidige stap + stap-ids voor de bewijsstukken.
        const { data: stapRows } = await supabase
          .from("procedure_stappen")
          .select("id, volgorde, naam, beschrijving, status")
          .eq("procedure_id", proc.id)
          .order("volgorde", { ascending: true });
        const stappen = (stapRows ?? []) as {
          id: string;
          volgorde: number;
          naam: string;
          beschrijving: string | null;
          status: string;
        }[];
        const huidigeStapRij =
          stappen.find((s) => s.status === "actief") ??
          stappen.find((s) => s.status !== "afgerond") ??
          null;
        const huidigeStap: StapRij | null = huidigeStapRij
          ? {
              volgorde: huidigeStapRij.volgorde,
              naam: huidigeStapRij.naam,
              beschrijving: huidigeStapRij.beschrijving,
              status: huidigeStapRij.status,
            }
          : null;

        // Requirements van de huidige stap (template-niveau; neutraal weergegeven,
        // geen vervuld/niet-vervuld-oordeel; dat oordeel hoort in de proceduremodule (evidence), niet hier).
        let requirements: RequirementRij[] = [];
        if (proc.template_code && huidigeStap) {
          // P1b (#166): versie-gefilterd op de gepinde versie; fallback naar
          // code-only als die (kortstondig) null is.
          let reqQuery = supabase
            .from("procedure_requirements")
            .select("label, requirement_type, verplicht, blokkerend")
            .eq("template_code", proc.template_code as string)
            .eq("stap_volgorde", huidigeStap.volgorde);
          if (proc.template_versie) {
            reqQuery = reqQuery.eq(
              "template_versie",
              proc.template_versie as string
            );
          }
          const { data: reqRows } = await reqQuery;
          requirements = (reqRows ?? []) as RequirementRij[];
        }

        // Bewijsstukken per stap → document-scope voor de retrieval ([Bron N]).
        const stapIds = stappen.map((s) => s.id);
        let bewijs: BewijsRij[] = [];
        if (stapIds.length > 0) {
          const { data: bewijsRows } = await supabase
            .from("procedure_bewijs")
            .select("document_id, titel, documenttype")
            .in("stap_id", stapIds);
          bewijs = (bewijsRows ?? []) as BewijsRij[];
        }
        // Alleen de geïndexeerde, actieve stukken zijn doorzoekbaar; alleen die
        // vullen de retrieval-scope (geen stille terugval naar de bibliotheek).
        const bewijsDocIds = Array.from(
          new Set(bewijs.map((b) => b.document_id).filter((id): id is string => !!id))
        );
        let bewijsVoorBlok: BewijsRij[] = [];
        if (bewijsDocIds.length > 0) {
          const [{ data: docRows }, { data: chunkRows }] = await Promise.all([
            supabase
              .from("documenten")
              .select("id, titel, actief, geindexeerd")
              .in("id", bewijsDocIds),
            supabase.from("document_chunks").select("document_id").in("document_id", bewijsDocIds).limit(2000),
          ]);
          const metChunks = new Set((chunkRows ?? []).map((c) => c.document_id as string));
          const geldigeDocs = (docRows ?? []).filter(
            (d) => d.actief !== false && d.geindexeerd === true && metChunks.has(d.id as string)
          );
          moduleScopeBronIds = geldigeDocs.map((d) => d.id as string);
          const geldigeSet = new Set(moduleScopeBronIds);
          bewijsVoorBlok = bewijs.filter((b) => b.document_id && geldigeSet.has(b.document_id));
        }
        procesMetStukken = moduleScopeBronIds.length > 0;
        procesModusActief = true;
        if (procesMetStukken) {
          // Retrieval beperken tot de gekoppelde stukken (niet strict-document).
          scopeDocumentIds = moduleScopeBronIds;
        }
        moduleScopeBlok = bouwProcesBlok({
          procedure: {
            id: proc.id as string,
            titel: (proc.titel as string) || "dit proces",
            status: (proc.status as string) || "",
            template_code: (proc.template_code as string | null) ?? null,
            beschrijving: (proc.beschrijving as string | null) ?? null,
          },
          decision: decisionRij,
          huidigeStap,
          requirements,
          bewijs: bewijsVoorBlok,
          heeftBronnen: procesMetStukken,
        });
        moduleScopeSleutel = { procedure_id: proc.id as string };
      }
    }
    // Een geldige module-scope is actief zodra er een blok is gebouwd.
    const moduleScopeActief = moduleScopeBlok.length > 0;

    // scopeActief = STRICT document-scope. Agendapunt-modus én proces-modus
    // gebruiken de scope-ids wél voor retrieval, maar nooit voor strict-document
    // gedrag (ADR 0028 / besluit 0151).
    const scopeActief =
      !agendapuntModusActief &&
      !procesModusActief &&
      !!scopeDocumentIds &&
      scopeDocumentIds.length > 0;
    // Agendapunt-modus mét doorzoekbare gekoppelde stukken: retrieval beperkt tot
    // die stukken ([Bron N]); zonder stukken halen we niets op (toelichting-only).
    const agendapuntMetStukken =
      agendapuntModusActief && !!scopeDocumentIds && scopeDocumentIds.length > 0;

    // ── P2 Deel B — "een document doorgronden" ───────────────────────────────
    // De client stuurt de gekozen secties (+ bij "Afwijkingen" de eerdere versie).
    // Alleen geldig binnen een strict document-scope. De zichtbare beurt blijft de
    // korte zin (vraag); de route stelt hieruit de instructie samen en forceert
    // breed (secties zijn dekkingsbreed — anders zou een enkel "Afwijkingen" als
    // 'specifiek' door de targeted-tak lopen). De voorgangertitel komt server-side
    // uit scopeTitelPerId, niet van de client.
    const GELDIGE_SECTIES = new Set<DoorgrondSectieId>(
      DOORGROND_SECTIES.map((s) => s.id)
    );
    const doorgrondSecties: DoorgrondSectieId[] = Array.isArray(body.doorgrond?.secties)
      ? (body.doorgrond!.secties!.filter(
          (s): s is DoorgrondSectieId =>
            typeof s === "string" && GELDIGE_SECTIES.has(s as DoorgrondSectieId)
        ))
      : [];
    const doorgrondActief = scopeActief && doorgrondSecties.length > 0;
    const doorgrondVorigeId =
      doorgrondActief && typeof body.doorgrond?.vorige_document_id === "string"
        ? body.doorgrond.vorige_document_id
        : null;
    const doorgrondVorigeTitel = doorgrondVorigeId
      ? scopeTitelPerId.get(doorgrondVorigeId) ?? null
      : null;

    // ── T2 — bureau-stand "Een stuk voorbereiden" ───────────────────────────
    // Server-side capability-gate (G2/FR-21): zonder ai.stukvoorbereiding wordt
    // de taak volledig genegeerd — de instructie wordt niet samengesteld en de
    // bureau-toon niet toegepast, ook niet bij een geknutseld request. De rol
    // staat al in `profiel`; we toetsen met de PURE mapping (geen extra DB-call).
    // Net als doorgrond vereist de taak een document-scope: de geselecteerde
    // stukken leveren de bronnen ([Bron N]) waarop het concept steunt.
    const stukCapability = rolHeeftCapability(
      (profiel as { rol?: string | null } | null)?.rol,
      "ai.stukvoorbereiding"
    );
    const stukSoort: Stuksoort | null =
      isStuksoort(body.stukvoorbereiding?.stuksoort)
        ? body.stukvoorbereiding!.stuksoort as Stuksoort
        : null;
    // T5 B1: de taak vereist niet langer een document-scope. Kiest de bureau-
    // medewerker gekoppelde stukken, dan draait het bron-onderbouwde concept
    // (variant i); kiest hij géén stukken, dan een bronloos concept-SKELET
    // (variant iii). De capability blijft de harde gate (G2/FR-21).
    const stukActief = stukCapability && stukSoort !== null;
    const bronloosBureau = stukActief && !scopeActief;
    const stukInstructie = stukActief ? bouwStukInstructie(stukSoort!) : null;

    // ── Transformatie-vervolgactie (FO §13) ─────────────────────────────────
    // De beurt bewerkt het vorige antwoord (herschrijf-intent). Vereist dat er
    // daadwerkelijk een eerder assistent-antwoord in de historie staat; anders is
    // er niets te transformeren en valt de route terug op normaal gedrag.
    const heeftVorigAntwoord = messages
      .slice(0, -1)
      .some((m) => m.role === "assistant");
    const transformatieActief = body.transformatie === true && heeftVorigAntwoord;

    // ── Increment I-2 (FO §11a) — automatische bronkeuze ────────────────────
    // Buiten een document-scope bepaalt het systeem zélf of de vraag fonds-,
    // algemeen- of gecombineerd-gericht is (pure heuristiek, lib/vraagtype.ts).
    // Een door de gebruiker gekozen verduidelijkingschip (bron_intent_override)
    // is leidend en zet de twijfel uit. Bij blijvende twijfel vragen we eerst
    // terug i.p.v. te gokken (schijnzekerheid-guardrail).
    const alleenFondsdocumenten =
      !scopeActief && body.alleen_fondsdocumenten === true;
    const intentOverride: BronIntent | undefined =
      body.bron_intent_override === "fonds" || body.bron_intent_override === "algemeen"
        ? body.bron_intent_override
        : undefined;
    // Ingreep 1/2 (30-07-2026) — herkomst van de override, uitsluitend voor het
    // auditspoor. Whitelist: nooit vrije tekst uit de body in de log.
    const INTENT_BRONNEN = ["chip", "startvraag", "herkomst"] as const;
    const intentBron: (typeof INTENT_BRONNEN)[number] | null =
      typeof body.bron_intent_bron === "string" &&
      (INTENT_BRONNEN as readonly string[]).includes(body.bron_intent_bron)
        ? (body.bron_intent_bron as (typeof INTENT_BRONNEN)[number])
        : null;
    const intentHerkomst: string | null =
      typeof body.bron_intent_herkomst === "string" &&
      /^[a-z0-9-]{1,40}$/.test(body.bron_intent_herkomst)
        ? body.bron_intent_herkomst
        : null;
    // T5 C3 — een korte bevestiging ("ja graag", "doe maar") die ná een assistent-
    // beurt komt, is geen nieuwe ankerloze vraag en mag de verduidelijkingsvraag
    // niet uitlokken. Vereist een eerder assistent-antwoord in de historie (dezelfde
    // signaalbron als transformatieActief), anders is het een openingszin en geldt
    // de normale classificatie.
    const bevestigingNaAntwoord = heeftVorigAntwoord && isKorteBevestiging(vraag);
    const bronIntentResultaat: BronIntentResultaat | null =
      // T5 B1: een bronloze bureau-taak is inherent een opsteltaak, geen fonds-/
      // algemeen-vraag — de verduidelijkingsvraag ("voor uw fonds / algemene zin")
      // hoort daar niet te vuren. Net als bij een actieve scope: geen intent-tak.
      // Besluit 0151: een expliciete module-scope zet de heuristiek óók uit — de
      // scope is expliciet, dus de assistent hoeft niet te raden (criterium 3).
      scopeActief || agendapuntModusActief || bronloosBureau || moduleScopeActief
        ? null
        : intentOverride
        ? { intent: intentOverride, vertrouwen: "zeker" }
        : bevestigingNaAntwoord
        ? // T5 C3: een korte bevestiging ("ja graag") ná een assistent-beurt is
          // geen nieuwe ankerloze vraag. Zet de intentie op "zeker" zodat de
          // verduidelijkingsvraag niet vuurt; fondsgericht (nooit stil algemeen).
          { intent: "fonds", vertrouwen: "zeker" }
        : bepaalBronIntent(effectieveVraag);
    const bronIntent: BronIntent | undefined = bronIntentResultaat?.intent;

    // Expliciete verbreding (chip "Neem niet-vastgestelde stukken mee"). Staat
    // bewust HIER, vóór de verduidelijkingstak: deze vlag komt per definitie ná een
    // antwoord waarin de bron-intentie al vaststond, dus doorvragen is daar altijd
    // fout. Zonder deze vangrail belandde een klik op de chip opnieuw in de
    // terugvraag — en werd de vlag weggegooid (geconstateerd in productie,
    // 30-07-2026). De client stuurt óók de bevestigde intentie mee; deze guard is
    // de server-side backstop zodat geen enkele clientfout die lus kan herhalen.
    const neemNietVastgesteldeMee = body.neem_niet_vastgestelde_mee === true;

    // Besluit 0137 (antwoord-eerst) — de audit-koppeling naar het eerste antwoord
    // wanneer de bestuurder een bronkeuze-chip klikt. Alleen een welgevormde UUID
    // gaat door; een onzinwaarde wordt genegeerd (de koppeling ontbreekt dan, geen
    // storing). Dit veld ONDERSCHEIDT een bronkeuze-herziening van de gewone
    // verduidelijkingschip/startvraag/herkomst-override: alleen bij aanwezigheid
    // krijgt de hergegenereerde regel `bronkeuze_herzien = true`.
    const bronkeuzeVorigeLogId =
      typeof body.bronkeuze_vorige_log_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.bronkeuze_vorige_log_id)
        ? body.bronkeuze_vorige_log_id
        : null;

    // Plateau A — correlatie met het gesprek. Alleen een welgevormde UUID gaat
    // door; een onzinwaarde zou de insert laten falen en daarmee de hele beurt.
    // Ontbreekt hij, dan wordt de regel niet gekoppeld en is de interactie niet
    // door de gebruiker te verwijderen — dat is een gemis, geen storing.
    const gesprekAuditId =
      typeof body.gesprek_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.gesprek_id)
        ? body.gesprek_id
        : null;

    // ── Plateau B — de reflectieflowstatus, SERVER-SIDE bepaald ─────────────
    // Vier gedragswijzigingen (G1-G4) hangen aan de vraag "loopt er nu een
    // reflectie?". Dat antwoord komt uit `gesprek_reflectie_state` via de
    // definer-RPC, nooit uit de request-body: de client stuurt hooguit een
    // SIGNAAL over het gebruikte invoerkanaal, en de RPC valideert dat tegen de
    // opnieuw uitgelezen actuele status (FR-67, besluit 0110).
    //
    // Drie gevallen:
    //   a. `reflectie_start`  — de gebruiker koos een reflectie-ingang. De RPC
    //      bevriest de bronset van het antwoord waarop wordt gereflecteerd.
    //   b. `reflectie_antwoord` — antwoord uit het gelabelde veld: beurt omhoog.
    //   c. anders — een gewone vraag via de normale invoerbalk. Die BEËINDIGT
    //      een lopende reflectie (FR-56); `afbreken` is een no-op wanneer er
    //      niets liep en maakt dan ook geen rij aan.
    //
    // ⚠ Er wordt hier NIETS gelogd (besluit 0112). Geen reflectiewaarde in
    // `modus`, geen sleutel in `retrieval_meta`, geen aparte auditregel. De
    // chatberichten die uit de reflectie voortkomen gaan door exact hetzelfde
    // logpad als elke andere beurt (FR-18).
    let reflectieStatus: ReflectieStatus = "niet_actief";
    let reflectieBeurt = 0;
    let reflectieBronsetChunkIds: string[] = [];
    // B-opt tranche 3 — de gekozen ingang (voor de deterministische terugval bij
    // een afgekeurde verdiepingsvraag) en de FEITELIJKE samenstelling van het
    // oorspronkelijke antwoord (§3d): alleen wanneer de server die meegeeft, mag
    // het model iets over de herkomst zeggen (AC-R7). `null` = niet meegeven.
    let reflectieIngang: ReflectieIngang | null = null;
    let reflectieSamenstelling: string | null = null;
    // B-opt tranche 2c/2d — de gevraagde actie is buiten dit blok nodig om te
    // bepalen wat de beurt toont (concept ná elk antwoord, verdiepingsvraag bij
    // `verdiepen`) en of ná de generatie naar de conceptweergave getransiteerd
    // moet worden. Default `afbreken`: geen actief reflectiesignaal.
    let reflectieActie: ReflectieActie = "afbreken";
    // B-opt tranche 3b — de verdiepingsvraag (niet het concept) wordt gebufferd,
    // gevalideerd en dan getoond i.p.v. gestreamd (guardrail 6). Gezet in de
    // reflectie-prompttak; gelezen in het streampad.
    let bufferReflectievraag = false;
    // B-opt tranche 4a — deze verdiepingsbeurt is een TEGENPERSPECTIEF ("Wat pleit
    // er tegen?"): andere promptvariant en een andere deterministische terugval.
    let reflectieTegenperspectief = false;

    if (gesprekAuditId) {
      const startIngang = isReflectieIngang(body.reflectie_start?.ingang)
        ? body.reflectie_start.ingang
        : null;
      const startBronsetLogId =
        typeof body.reflectie_start?.bronset_log_id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.reflectie_start.bronset_log_id
        )
          ? body.reflectie_start.bronset_log_id
          : null;

      const actie: ReflectieActie = startIngang
        ? "start"
        : body.reflectie_antwoord === true
        ? "antwoord"
        : // B-opt tranche 1a — herformuleren blijft in conceptweergave en
          // verhoogt de beurt niet. De RPC weigert hem buiten die status, waarna
          // de beurt als gewone chatbeurt (afbreken) doorloopt.
        body.reflectie_herformuleren === true
        ? "herformuleren"
        : // B-opt tranche 2d — "Nog een stap verdiepen": vraagt om één nieuwe
          // verdiepingsvraag. De RPC keert terug naar verdieping_{beurt} en
          // weigert bij beurt >= 3.
        body.reflectie_verdiepen === true || body.reflectie_tegenperspectief === true
        ? "verdiepen"
        : "afbreken";
      reflectieActie = actie;
      // Tegenperspectief loopt via dezelfde `verdiepen`-transitie; alleen de
      // promptvariant verschilt (tranche 4a).
      reflectieTegenperspectief = body.reflectie_tegenperspectief === true;

      const { data: flowRij, error: flowFout } = await supabase.rpc("reflectie_transitie", {
        p_gesprek_id: gesprekAuditId,
        p_actie: actie,
        p_ingang: startIngang,
        p_bronset_log_id: startBronsetLogId,
      });

      if (flowFout) {
        // Fail-safe naar `niet_actief`: een geweigerde of mislukte transitie mag
        // nooit tot gevolg hebben dat de beurt in reflectiemodus wordt
        // afgehandeld. De beurt loopt dan gewoon als normale chatbeurt door —
        // dat is het gedrag van vóór plateau B en dus altijd veilig.
        console.error("Reflectietransitie geweigerd of mislukt:", flowFout.message);
      } else if (flowRij) {
        const rij = flowRij as {
          status?: string;
          beurt?: number;
          ingang?: string | null;
          bronset_log_id?: string | null;
          bijgewerkt_op?: string | null;
        };
        reflectieStatus = effectieveStatus(
          rij.status as ReflectieStatus | null,
          rij.bijgewerkt_op ? Date.parse(rij.bijgewerkt_op) : null,
          Date.now()
        );
        reflectieBeurt = typeof rij.beurt === "number" ? rij.beurt : 0;
        reflectieIngang = isReflectieIngang(rij.ingang) ? rij.ingang : null;

        // G3 — de bevroren bronset ophalen. De chunk-ID's komen uit dezelfde
        // logregel die de RPC op eigenaarschap én gesprek heeft gevalideerd; de
        // client levert ze niet aan. Geen bronset = geen bronnen: de assistent
        // reflecteert dan uitsluitend op het antwoord en de woorden van de
        // gebruiker (FR-55).
        if (isReflectieActief(reflectieStatus) && rij.bronset_log_id) {
          const { data: logRij } = await supabase
            .from("governance_log")
            .select("retrieval_meta")
            .eq("id", rij.bronset_log_id)
            .maybeSingle();
          const meta = (logRij as { retrieval_meta?: unknown } | null)?.retrieval_meta;
          reflectieBronsetChunkIds = bepaalBronset(meta).chunkIds;
          // ── B-opt tranche 3d — feitelijke bronsamenstelling meegeven ────────
          // Route B uit ANTWOORDPAD §0.2: de server geeft de samenstelling van het
          // OORSPRONKELIJKE antwoord feitelijk mee (afgeleid uit source_summary in
          // dezelfde logregel), zodat een uitspraak over herkomst wáár is en niet
          // een gok van het model. Geen nieuwe opslag. Zonder deze regel verbiedt
          // de prompt (en AC-R7) elke herkomstuitspraak.
          reflectieSamenstelling = leidSamenstellingAf(meta);
        }
      }
    }

    const reflectieActief = isReflectieActief(reflectieStatus);

    // M1–M5 — één gesloten routebesluit. Reflectie/transformatie/bureau hebben
    // eigen, hoger-prioritaire contracten en blijven daarom buiten vraagrouter v2.
    let vraagRoute: Vraagroute | null = null;
    let vraagrouterUitvoering: RetrievalMeta["vraagrouter_uitvoering"] | null = null;
    if (
      vraagrouterVlaggen.routerV2 &&
      !reflectieActief &&
      !transformatieActief &&
      !stukActief
    ) {
      const routerStart = Date.now();
      const routeScope: VraagScope = agendapuntModusActief
        ? "agendapuntstukken"
        : scopeActief
        ? scopeHerkomst
        : alleenFondsdocumenten
        ? "fondscollectie"
        : "fonds_plus_algemeen_kader";
      const basisRoute = routeerVraag(effectieveVraag, {
        scope: routeScope,
        // Alleen strict/named document-scope ontsluit volledige dekking. Een
        // agendapunt of fondscollectie wordt niet stil volledig gemap-reduced.
        documentAantal: scopeActief ? scopeDocumentIds?.length ?? 0 : 0,
        forceerVolledig: volledigeAnalyseUitgevoerd || doorgrondActief,
      });
      if (volledigeAnalyseUitgevoerd || doorgrondActief) {
        vraagRoute = {
          ...basisRoute,
          bron: volledigeAnalyseUitgevoerd
            ? "expliciete_vervolgactie"
            : "deterministisch",
          signalen: [
            ...new Set([
              ...basisRoute.signalen,
              volledigeAnalyseUitgevoerd
                ? "expliciete_volledige_analyse"
                : "doorgrond_forceert_volledig",
            ]),
          ],
        };
        vraagrouterUitvoering = {
          router_ms: Date.now() - routerStart,
          modelrouter: {
            toegepast: false,
            model: null,
            duur_ms: 0,
            tokens_in: 0,
            tokens_uit: 0,
            uitkomst: "overgeslagen",
          },
        };
      } else {
        const verfijnd = await verfijnVraagrouteMetModel({
          vraag: effectieveVraag,
          basis: basisRoute,
          documentAantal: scopeActief ? scopeDocumentIds?.length ?? 0 : 0,
          actief: vraagrouterVlaggen.modelrouter,
          gateway,
          ctx: gatewayCtx,
        });
        vraagRoute = verfijnd.route;
        vraagrouterUitvoering = {
          router_ms: Date.now() - routerStart,
          modelrouter: verfijnd.meta,
        };
      }
    }

    // ── Besluit 0151 — module-scope "in effect" ─────────────────────────────
    // Het module-contextblok reist alléén mee in de gewone chat-takken
    // (algemeen/combineren/documenten via portaalContextPrefix). Een hoger-
    // prioritaire modus (reflectie/transformatie/agendapunt/bureau-stuk/strict
    // document-scope) wint de prompt-tak en gebruikt de prefix NIET. Omdat een
    // module-gesprek `module_scope` elke beurt meestuurt — óók bij een
    // transformatie-vervolgactie — mag het auditspoor de modulecontext alleen als
    // "gebruikt" loggen wanneer hij daadwerkelijk is geïnjecteerd. Dit is die ene
    // bron van waarheid voor prompt-injectie, retrieval-effect én logging.
    const moduleScopeInPrompt =
      moduleScopeActief &&
      !reflectieActief &&
      !transformatieActief &&
      !agendapuntModusActief &&
      !stukActief &&
      !scopeActief;
    // Proces-modus stuurt de retrieval (scope tot de bewijsstukken) alléén wanneer
    // de modulecontext ook echt in de prompt landt — anders zou een transformatie-
    // beurt stil op de bewijsstukken gaan retrieven.
    const procesModusInPrompt = procesModusActief && moduleScopeInPrompt;
    if (procesModusActief && !moduleScopeInPrompt) {
      // Een hoger-prioritaire modus wint deze beurt; laat de proces-retrievalscope
      // niet stil meelekken (de bewijsstukken waren alleen voor het procesblok).
      scopeDocumentIds = undefined;
    }

    // ── Bronkeuze-modus (FO §11a, besluit 0137 — herziet 0014) ──────────────
    // Hoe gaat de assistent om met een ONZEKERE bron-intentie?
    //   blokkerend (DEFAULT) — de terugvraag vóór het antwoord (geaccordeerd 0014);
    //   antwoord_eerst       — fondsgericht antwoorden, de twee keuzes als chips
    //                          ónder het antwoord (niet-blokkerend);
    //   uit                  — geen wedervraag, geen chips (vangnetstand).
    // Fail-safe naar blokkerend bij een ontbrekende fondsId (theoretisch),
    // leesfout of ongeldige vlagwaarde (in bronkeuzeModusVoorFonds afgehandeld):
    // nooit stil naar het nieuwe gedrag. Read ná de reflectietak, net als de
    // verduidelijkingstak zelf — een reflectiebeurt kent geen bronkeuze.
    const bronkeuzeModus = fondsId
      ? await bronkeuzeModusVoorFonds(fondsId)
      : "blokkerend";

    // "Moet er verduidelijkt worden?" is ONAFHANKELIJK van de modus: alle bestaande
    // vangrails blijven gelden (scope/agendapunt/bureau → bronIntentResultaat is
    // null; reflectie/transformatie/verbreding; en de fondsrestrictie via
    // moetVerduidelijken). De modus bepaalt alleen wát er met die twijfel gebeurt.
    const moetVerduidelijkenNu =
      !reflectieActief &&
      !transformatieActief &&
      !neemNietVastgesteldeMee &&
      bronIntentResultaat !== null &&
      moetVerduidelijken(bronIntentResultaat, alleenFondsdocumenten);

    // antwoord_eerst: géén blokkerende terugvraag, maar dóórlopen met de bestaande
    // fondsgerichte onzekere intentie en de twee keuzes als chip-AANBOD ónder het
    // antwoord. uit: geen tak, geen chips (de fondsgerichte fallback blijft staan).
    // Alleen blokkerend behoudt de vroege return hieronder.
    const bronkeuzeAanbod = moetVerduidelijkenNu && bronkeuzeModus === "antwoord_eerst";

    // Verduidelijkingstak: twijfel → één SSE-event met de vraag + chips, géén
    // modelcall. De beslissing om te verduidelijken is puur reproduceerbaar uit
    // de vraag.
    //
    // WÉL een governance_log-regel (besluit 0092, 30-07-2026 — herziet 0014).
    // Oorspronkelijk sloeg deze tak de log over met de redenering "er is geen
    // antwoord". Gevolg in de praktijk: een vraag die in de terugvraag eindigde en
    // waarbij niet op een chip werd geklikt, stond NERGENS — niet in
    // `governance_log` (deze tak) en niet in `gesprekken` (de client bewaart alleen
    // bij gestreamde antwoordtekst). Terwijl het scherm de bestuurder belooft: "Elke
    // vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt."
    // De VRAAG is een gebruikersinteractie met het AI-systeem; dat is wat de
    // navolgbaarheid (en de AI Act-lijn) vraagt, niet of er een antwoord kwam.
    // Er draait geen model, dus `model = null` — een modelnaam zou suggereren dat er
    // gegenereerd is. `antwoord` is de gestelde verduidelijkingsvraag, `bronnen` leeg.
    //
    // G2 (plateau B) — tijdens een actieve reflectieflow slaan we deze tak over
    // en wordt `moetVerduidelijken` niet aangeroepen. De terugvraag stelt
    // "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?" — een
    // zinnige vraag bij een informatievraag, een absurde bij "ik twijfel of de
    // planning klopt". De gebruiker is dan geen antwoord aan het zoeken maar
    // zijn eigen oordeel aan het vormen.
    // Alleen `blokkerend` retourneert vroeg met de terugvraag. Bij `antwoord_eerst`
    // en `uit` loopt de beurt door (fondsgericht); antwoord_eerst biedt de chips
    // ónder het antwoord aan (meta-event bronkeuze_aanbod).
    // ── T5 — Vergelijkmodus (confidence-gated, achter VERGELIJKMODUS) ────────
    // Een expliciete vergelijkvraag ("vergelijk X met Y") pre-empt de bron-
    // verduidelijking: eenduidig → direct de service draaien en het resultaat als
    // {type:"vergelijking"} streamen; twee mogelijke doelbronnen → een gerichte
    // {type:"vergelijking_verduidelijking"} (nooit gokken). Flag uit → deze tak doet
    // niets en de chat verloopt exact als voorheen (terugdraaibaarheid). fondsId is
    // hier al server-side afgeleid en non-null (guard hierboven).
    const vergelijkIntent = vergelijkmodusAan()
      ? bepaalVergelijkIntent(effectieveVraag)
      : { isVergelijk: false, bronHint: null, doelHint: null, vertrouwen: "onzeker" as const };
    if (vergelijkIntent.isVergelijk) {
      const streamHeaders = {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      };
      const stuurStream = (payload: unknown) => {
        const encoder = new TextEncoder();
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
            controller.close();
          },
        });
      };

      // Kandidaat-documenten binnen het eigen fonds (RLS scoping).
      const { data: docRijen } = await supabase
        .from("documenten")
        .select("id, titel")
        // "niet expliciet inactief" — NULL ≡ actief (spiegelt de ingest/extractie-job,
        // die alleen op actief===false overslaat). `.eq(true)` zou NULL-docs droppen.
        .not("actief", "is", false);
      const documenten: DocumentRef[] = (docRijen ?? []).map((d) => ({ id: d.id, titel: d.titel }));
      const koppeling = koppelDocumenten(vergelijkIntent.bronHint, vergelijkIntent.doelHint, documenten);

      if (koppeling.eenduidig && koppeling.bron && koppeling.doel) {
        const resultaat = await voerVergelijkingUit(
          {
            mode: "symmetrisch",
            bronDocumentId: koppeling.bron.id,
            doelDocumentId: koppeling.doel.id,
            versies: VERGELIJK_VERSIES,
          },
          productieDeps({ supabase, fondsId, gateway, gatewayCtx })
        );

        // Governance-logging: een vergelijking is een AI-interactie (verplicht spoor,
        // reproduceerbaar via comparison_run). Fail-safe: een mislukte logregel mag
        // het resultaat niet blokkeren, wel zichtbaar in de serverlog.
        try {
          const samenvatting =
            `Vergelijking ${koppeling.bron.titel} ↔ ${koppeling.doel.titel}: ` +
            `${resultaat.findings.length} bevinding(en) over ${resultaat.dimensies.length} dimensie(s).`;
          const zegel = bouwInhoudZegel(vraag, samenvatting);
          const { data: vergelijkLogId, error: logFout } = await supabase.rpc(
            "schrijf_ai_interactie",
            {
              p_vraag: vraag,
              p_antwoord: samenvatting,
              p_bronnen: [],
              p_modus: "documenten",
              p_model: VERGELIJK_MODEL,
              p_retrieval_meta: {
                vergelijkmodus: true,
                comparison_run_id: resultaat.comparison_run_id,
                bron_document_id: koppeling.bron.id,
                doel_document_id: koppeling.doel.id,
                aantal_findings: resultaat.findings.length,
                dimensies: resultaat.dimensies.map((d) => d.key),
                // Plateau 1 — een contextresolver-call kan vóór deze vroege return
                // hebben gedraaid; leg de telemetrie vast zodat hij niet stil buiten
                // het auditspoor valt.
                ...(vraagContext
                  ? { invoer: { context: contextTelemetrie(vraagContext, contextModus) } }
                  : {}),
              },
              p_retrieval_meta_inhoud:
                vraagContext && vraagContext.kandidaatVraag.trim() !== vraag.trim()
                  ? { invoer: { context_kandidaat_vraag: vraagContext.kandidaatVraag } }
                  : {},
              p_gesprek_audit_id: gesprekAuditId,
              p_inhoud_hmac: zegel?.inhoud_hmac ?? null,
              p_hmac_schema_versie: zegel?.hmac_schema_versie ?? null,
              p_hmac_sleutel_versie: zegel?.hmac_sleutel_versie ?? null,
            }
          );
          if (logFout) throw logFout;
          // AI-begrenzing (besluit 0180): sluit de gereserveerde AI-actie op deze
          // vroege return (een vergelijkingsmodel én mogelijk de resolver draaiden).
          await rondAf(
            supabase,
            aiActieId,
            "voltooid",
            vergelijkLogId ? `governance_log:${vergelijkLogId}` : null
          );
        } catch (e) {
          console.error("Governance-log voor vergelijking mislukt:", e);
          await rondAf(supabase, aiActieId, "mislukt", null);
        }

        return new Response(stuurStream({ type: "vergelijking", resultaat }), { headers: streamHeaders });
      }

      // Niet eenduidig → gerichte verduidelijking met de kandidaten (nooit gokken).
      // Ook dit is een AI-interactie: leg een governance-logregel vast (incl. een
      // eventuele resolver-providercall) en sluit de AI-actie af — nooit pending.
      const vergelijkVerduidelijkingResolverModel = vraagContext?.modelAangeroepen ?? false;
      try {
        const vvSamenvatting =
          `Vergelijkingsverduidelijking: bron «${vergelijkIntent.bronHint ?? "?"}» ↔ ` +
          `doel «${vergelijkIntent.doelHint ?? "?"}» — meerdere kandidaten, gericht nagevraagd.`;
        const vvZegel = bouwInhoudZegel(vraag, vvSamenvatting);
        const { data: vvLogId, error: vvLogFout } = await supabase.rpc(
          "schrijf_ai_interactie",
          {
            p_vraag: vraag,
            p_antwoord: vvSamenvatting,
            p_bronnen: [],
            p_modus: "documenten",
            p_model: vergelijkVerduidelijkingResolverModel ? (vraagContext?.meting?.model ?? null) : null,
            p_retrieval_meta: {
              vergelijkmodus: true,
              verduidelijking: true,
              // Geen ANTWOORD-generatie; wél mogelijk een resolver-providercall.
              // `geen_generatiecall` onder `invoer` (basis, migratievrij).
              geen_modelcall: !vergelijkVerduidelijkingResolverModel,
              invoer: {
                geen_generatiecall: true,
                ...(vraagContext
                  ? { context: contextTelemetrie(vraagContext, contextModus) }
                  : {}),
              },
            },
            p_retrieval_meta_inhoud:
              vraagContext && vraagContext.kandidaatVraag.trim() !== vraag.trim()
                ? { invoer: { context_kandidaat_vraag: vraagContext.kandidaatVraag } }
                : {},
            p_gesprek_audit_id: gesprekAuditId,
            p_inhoud_hmac: vvZegel?.inhoud_hmac ?? null,
            p_hmac_schema_versie: vvZegel?.hmac_schema_versie ?? null,
            p_hmac_sleutel_versie: vvZegel?.hmac_sleutel_versie ?? null,
          }
        );
        if (vvLogFout) throw vvLogFout;
        await rondAf(
          supabase,
          aiActieId,
          "voltooid",
          vvLogId ? `governance_log:${vvLogId}` : null
        );
      } catch (e) {
        console.error("Governance-log voor vergelijking_verduidelijking mislukt:", e);
        await rondAf(supabase, aiActieId, "mislukt", null);
      }

      return new Response(
        stuurStream({
          type: "vergelijking_verduidelijking",
          bronHint: vergelijkIntent.bronHint,
          doelHint: vergelijkIntent.doelHint,
          bronKandidaten: koppeling.bronKandidaten.slice(0, 5),
          doelKandidaten: koppeling.doelKandidaten.slice(0, 5),
        }),
        { headers: streamHeaders }
      );
    }

    if (moetVerduidelijkenNu && bronkeuzeModus === "blokkerend") {
      try {
        // Plateau A — spoor en inhoud in één transactie via de definer-RPC.
        // `fonds_id` en `gebruiker_naam` zijn hier bewust GEEN parameter meer:
        // de functie leidt ze server-side af uit auth.uid(). Daarmee is het
        // probleem waar core/lib/audit-fonds-guard.ts tegen beschermde
        // structureel weg in plaats van per aanroeppunt bewaakt.
        const zegel = bouwInhoudZegel(vraag, VERDUIDELIJKINGSVRAAG);
        // Plateau 1 — modelcall-semantiek. Deze tak doet geen ANTWOORD-generatie,
        // maar de contextresolver kan wél een providercall hebben gestart. Dan is
        // `geen_modelcall` false en registreren we het effectieve resolvermodel;
        // `geen_generatiecall` legt afzonderlijk vast dat er geen generatie was.
        const resolverModelGebruikt = vraagContext?.modelAangeroepen ?? false;
        const { data: verduidelijkingLogId, error: logFout } = await supabase.rpc(
          "schrijf_ai_interactie",
          {
            p_vraag: vraag,
            p_antwoord: VERDUIDELIJKINGSVRAAG,
            p_bronnen: [],
            // `modus` kent een CHECK op documenten|combineren|algemeen; we leggen de
            // modus vast waar de vraag naartoe onderweg was (combineren-vloer, of
            // documenten bij een expliciete fondsrestrictie) — niet een verzonnen waarde.
            p_modus: bepaalAutoBronModus(alleenFondsdocumenten),
            // Registreer het door de resolver gebruikte model waar het auditcontract
            // een modelveld verwacht; null als er geen enkele providercall was.
            p_model: resolverModelGebruikt ? (vraagContext?.meting?.model ?? null) : null,
            p_retrieval_meta: {
              // Markeert de regel als een TERUGVRAAG, geen antwoord. Zo is in het log
              // te onderscheiden en te meten hoe vaak de assistent doorvraagt.
              verduidelijking: true,
              // `geen_modelcall` = geen ENKELE providercall in deze interactie. Draaide
              // de resolver wél een call, dan is dat false (semantiek besluit 0092
              // ongewijzigd). `geen_generatiecall` staat onder `invoer` (basis,
              // migratievrij) en markeert de deterministische, generatie-loze return —
              // ook als er geen resolver draaide.
              geen_modelcall: !resolverModelGebruikt,
              bron_intent: bronIntentResultaat.intent,
              bron_vertrouwen: bronIntentResultaat.vertrouwen,
              alleen_fondsdocumenten: alleenFondsdocumenten,
              invoer: {
                geen_generatiecall: true,
                ...(vraagContext
                  ? { context: contextTelemetrie(vraagContext, contextModus) }
                  : {}),
              },
            },
            // Deze tak kent geen retrieval; alleen de eventuele resolver-kandidaatvraag
            // is inhoud (verwijderbaar).
            p_retrieval_meta_inhoud:
              vraagContext && vraagContext.kandidaatVraag.trim() !== vraag.trim()
                ? { invoer: { context_kandidaat_vraag: vraagContext.kandidaatVraag } }
                : {},
            p_gesprek_audit_id: gesprekAuditId,
            p_inhoud_hmac: zegel?.inhoud_hmac ?? null,
            p_hmac_schema_versie: zegel?.hmac_schema_versie ?? null,
            p_hmac_sleutel_versie: zegel?.hmac_sleutel_versie ?? null,
          }
        );
        if (logFout) throw logFout;
        // AI-begrenzing (besluit 0180): sluit de gereserveerde AI-actie óók op deze
        // vroege return, zodat een resolver-providercall geen actie in `pending` laat.
        await rondAf(
          supabase,
          aiActieId,
          "voltooid",
          verduidelijkingLogId ? `governance_log:${verduidelijkingLogId}` : null
        );
      } catch (e) {
        // Fail-safe: een mislukte logregel mag de terugvraag niet blokkeren. Wel
        // zichtbaar in de serverlog. De AI-actie mag echter niet in pending blijven:
        // sluit haar expliciet af als 'mislukt' (rondAf is een no-op bij null-id).
        console.error("Governance-log voor verduidelijking mislukt:", e);
        await rondAf(supabase, aiActieId, "mislukt", null);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "verduidelijking",
                vraag: VERDUIDELIJKINGSVRAAG,
                opties: VERDUIDELIJKING_OPTIES,
              })}\n\n`
            )
          );
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // ── Stream-openpunt (besluit 0087) ──────────────────────────────────────
    // Vanaf hier draait het retrieval- en promptopbouwblok BINNEN de stream,
    // zodat het per fase voortgang kan melden ({type:"progress"}). Auth, rate-
    // limiting, fonds-/host-/module-gates en de verduidelijkingstak staan bewust
    // vóór dit punt: die moeten een echte HTTP-status kunnen geven. Zodra de
    // stream open is, is status 200 verzonden — fouten hierna worden daarom
    // {type:"error"}-events binnen de 200-respons (het foutcontract verschuift;
    // de client toont ze als chatmelding). De governance_log-insert blijft
    // ongewijzigd op zijn plek ná het streamen. `progress`-events worden NOOIT
    // gelogd (vluchtige UI-state).
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        try {
    // Retrieval-modus (verborgen) volgt Design A "combineren-vloer": tenzij de
    // gebruiker expliciet beperkt tot fondsdocumenten, halen we altijd op — nooit
    // volledig overslaan. Bij een actieve document-scope is dit niet van
    // toepassing (strict-document hieronder).
    const bronModusRetrieval: Modus = scopeActief
      ? "documenten"
      : (bepaalAutoBronModus(alleenFondsdocumenten) as Modus);

    // ── Strategiekeuze (increment 2) bij actieve scope ──────────────────────
    // Specifieke vraag → targeted retrieval (increment 1). Dekkingsbrede vraag →
    // full-document (klein doc) of map-reduce (groot doc). Opt-in algemene kennis
    // staat hier los van: het bepaalt alleen of het eindantwoord strict blijft of
    // de drie-deling krijgt. Vraagtype op de ORIGINELE vraag (niet de zoekvraag).
    const algemeneKennis =
      scopeActief && body.document_scope?.algemene_kennis === true;
    let scopeStrategie: Strategie = "targeted";
    let breedChunks: DocumentChunk[] = [];
    let breedBatches: DocumentChunk[][] = [];
    let breedTotaalBatches = 0;
    let breedAfgekapt = false;
    let breedOphaalresultaat: DocumentChunkOphaalresultaat | null = null;
    let documentDekking: DocumentDekking = gerichteDekking(0);
    let totaalPassagesVoorAanbod: number | null = null;
    const analyseCriteria = vraagRoute ? bouwAnalyseplan(vraagRoute, effectieveVraag) : [];
    const analyseplanTekst = formatteerAnalyseplan(analyseCriteria);
    const analyseplanMeta: RetrievalMeta["analyseplan"] | undefined =
      analyseCriteria.length > 0
        ? {
            kader: "algemeen_controleplan_niet_juridisch_volledig",
            criteria: analyseCriteria.map((criterium) => ({
              id: criterium.id,
              herkomst: criterium.herkomst,
            })),
          }
        : undefined;

    // G3 (plateau B) — een dekkingsbrede strategie is tijdens een reflectie per
    // definitie fout: de bronset is bevroren op de top-N van één antwoord, niet
    // op een heel document.
    if (scopeActief && !transformatieActief && !reflectieActief) {
      // Doorgronden forceert breed: de secties zijn dekkingsbreed, ook als de
      // korte zichtbare zin geen breed-signaalwoord bevat (bv. alleen "Afwijkingen").
      const vraagtBredeDekking = vraagRoute
        ? vraagRoute.dekking !== "targeted"
        : bepaalVraagtype(effectieveVraag) === "breed";
      if (vraagtBredeDekking || doorgrondActief) {
        // T4 — geef de server-side fonds mee: dit dekkingsbrede pad loopt niet via
        // de RPC (met p_fonds_id), dus de app-guard in haalDocumentChunks is hier de
        // enige expliciete fonds-laag náást RLS.
        breedOphaalresultaat = await haalDocumentChunksMetDekking(
          scopeDocumentIds!,
          fondsId
        );
        breedChunks = breedOphaalresultaat.chunks;
        const totaalTekst = breedChunks.map((c) => c.tekst).join("\n\n");
        // Full-document is alleen toegestaan als de count en alle opgehaalde
        // rijen aantoonbaar sluiten. Bij cap/fout gaat het altijd via map-reduce
        // en blijft de dekking zichtbaar gedeeltelijk.
        scopeStrategie =
          breedOphaalresultaat.volledig &&
          schatTokens(totaalTekst) <= VOLLEDIG_DOC_TOKEN_DREMPEL
            ? "full_document"
            : "map_reduce";
        if (scopeStrategie === "map_reduce") {
          const volledigBatchplan = maakBatches(
            breedChunks,
            MAP_BATCH_TOKENS,
            Number.MAX_SAFE_INTEGER
          );
          const r = maakBatches(breedChunks, MAP_BATCH_TOKENS, MAX_BATCHES);
          breedBatches = r.batches;
          breedTotaalBatches = volledigBatchplan.batches.length;
          breedAfgekapt = !breedOphaalresultaat.volledig || r.afgekapt;
        }
        const ophaalRedenen: DekkingsAfkapreden[] = breedOphaalresultaat.afkapreden
          ? [breedOphaalresultaat.afkapreden]
          : [];
        const alleLocaties = telDekkingslocaties(breedChunks);
        const locatieTotalenBekend = breedOphaalresultaat.volledig;
        documentDekking =
          scopeStrategie === "full_document"
            ? bredeDekking({
                totaalPassages: breedOphaalresultaat.totaal_chunks,
                verwerktePassages: breedChunks.length,
                afkapredenen: ophaalRedenen,
                verwerktePaginas: alleLocaties.paginas,
                totaalPaginas: locatieTotalenBekend ? alleLocaties.paginas : null,
                verwerkteSecties: alleLocaties.secties,
                totaalSecties: locatieTotalenBekend ? alleLocaties.secties : null,
              })
            : bredeDekking({
                totaalPassages: breedOphaalresultaat.totaal_chunks,
                verwerktePassages: 0,
                totaalBatches: breedTotaalBatches,
                verwerkteBatches: 0,
                afkapredenen: ophaalRedenen,
                verwerktePaginas: 0,
                totaalPaginas: locatieTotalenBekend ? alleLocaties.paginas : null,
                verwerkteSecties: 0,
                totaalSecties: locatieTotalenBekend ? alleLocaties.secties : null,
              });
      }
    }
    const breedActief =
      scopeActief && !transformatieActief && scopeStrategie !== "targeted";

    // P2 Deel B — de samengestelde doorgrond-instructie (koppen per sectie +
    // vaste lengtenorm) vervangt de korte zichtbare zin ín de prompt. `vraag`
    // zelf blijft de korte zin (zichtbaar + gelogd); alleen wat het model als
    // instructie krijgt is de samenstelling. Enige bron: core/lib/doorgrond.ts.
    const doorgrondInstructie = doorgrondActief
      ? bouwDoorgrondInstructie(doorgrondSecties, doorgrondVorigeTitel)
      : null;
    // Plateau 1: op de niet-doorgrond-paden stuurt de effectieve vraag ook de
    // reduce-/map-prompt. Doorgronden (scope) houdt zijn samengestelde instructie
    // en draait sowieso met effectief == origineel (resolver overgeslagen).
    const vraagVoorPrompt = doorgrondInstructie ?? effectieveVraag;

    // Plateau 1 — dubbele prompt-framing voor de normale enkelvoudige antwoord-
    // takken: geef het model ZOWEL de originele formulering (toon/bedoeling van de
    // bestuurder) ALS de zelfstandige interpretatie die de bronselectie stuurde.
    // Alleen wanneer ze verschillen (enforce + echte vervolgvraag); anders exact de
    // bestaande `VRAAG: …`-regel, zodat de prompt in off (byte-identiek) én observe
    // (niet-afdwingend) ongewijzigd blijft; alleen enforce framet dubbel.
    const vraagBlok =
      effectieveVraag.trim() !== vraag.trim()
        ? `ORIGINELE VRAAG VAN DE GEBRUIKER: ${vraag}\nZELFSTANDIGE INTERPRETATIE VOOR CONTEXT EN BRONSELECTIE: ${effectieveVraag}`
        : `VRAAG: ${vraag}`;

    // ── Antwoordmodusfamilie (Increment G) ──────────────────────────────────
    // Orthogonaal op de bron-modus. Vastgezet (gesprekken.actieve_antwoordmodus)
    // is leidend; anders auto-detectie op de vraag. Increment I-1 (rustige
    // weergave §11c): de afwijking wordt niet meer als globale wissel-melding
    // getoond maar — waar relevant — als conditionele inline-melding bij het
    // antwoord (interpretatieve duiding/besluitvorming).
    //
    // G4 (plateau B) — tijdens een actieve reflectieflow wordt de automatische
    // modusdetectie OVERGESLAGEN. `bepaalAntwoordmodus` is een regex-heuristiek
    // met een zichtbare wisselmelding als bijeffect; die zou tijdens een
    // reflectie op de woorden van de gebruiker gaan reageren en de toon per
    // beurt laten verspringen. De modus staat vast op `sparring`: dat is de
    // bestaande modus die het dichtst bij spiegelen ligt — meedenken zonder te
    // concluderen. Er wordt geen nieuwe moduswaarde geïntroduceerd, ook niet in
    // het auditspoor (besluit 0112, AC-17).
    const vastgezetteModus: Antwoordmodus | null = body.actieve_antwoordmodus ?? null;
    const gedetecteerdeModus: Antwoordmodus = reflectieActief
      ? "sparring"
      : bepaalAntwoordmodus(effectieveVraag);
    const antwoordmodus: Antwoordmodus = reflectieActief
      ? "sparring"
      : vastgezetteModus ?? gedetecteerdeModus;

    // ── T2 (#304) — de BRONLOZE voorbereiding zoekt wél in de bibliotheek ────
    // Agendapunt-modus retrievet normaal alleen als er gekoppelde stukken zijn:
    // zonder stukken is de toelichting de enige context, en dat is bewust (ADR
    // 0028, criterium 5 — nooit een stille terugval op de hele bibliotheek).
    // Voor de VOORBEREIDING is dat een verlies: de vervallen route doorzocht de
    // bibliotheek altijd, ook bij een agendapunt zonder stukken. Juist daar heeft
    // een bestuurder het meest aan een voorbereiding, en juist daar zou hij nu nul
    // bronnen krijgen. Deze ene conditie herstelt die pariteit, en ze is
    // UITSLUITEND bereikbaar via de nieuwe modus: voor elke bestaande
    // agendapuntchat blijft `moetRetrieven` byte-voor-byte wat het was.
    // De zoektocht is hier geen stille terugval maar precies wat de bestuurder
    // vroeg — hij drukte op "Bereid dit punt voor", niet op "beantwoord mijn
    // vraag uit deze stukken".
    const voorbereidingZonderStukken =
      agendapuntModusActief &&
      !agendapuntMetStukken &&
      antwoordmodus === "persoonlijke_voorbereiding";

    // Retrieval-filters volgen de antwoordmodus (peildatum = vandaag) + de
    // bronsoort-weging volgt het vraagtype. Bij een ACTIEVE document-scope laten
    // we de status-/geldigheidsfilter bewust achterwege: de gebruiker koos dat
    // specifieke stuk en wil het zien, ongeacht actuele-bron-status.
    const vandaag = new Date().toISOString().slice(0, 10);
    // Bij een actieve scope én in agendapunt-modus (de gebruiker koos die stukken
    // bewust) laten we de status-/geldigheidsfilter achterwege.
    // 30-07-2026 — twee aanpassingen op de retrievalmodus:
    //  (a) Koos de gebruiker "Neem niet-vastgestelde stukken mee" (chip na de
    //      melding), dan verbreden we naar 'alles': de actualiteitsfilter vervalt
    //      en concept/ter bespreking/vervallen komen mee. Expliciete keuze, dus
    //      geen schijnzekerheid — de bronkaarten dragen hun statuslabel.
    //  (b) Anders bepaalt retrievalModusVoorVraag de modus: een voorstel-/
    //      conceptvraag die op 'actueel' zou uitkomen wordt 'besluitvorming',
    //      omdat een nog niet vastgesteld stuk anders per definitie onvindbaar is.
    // 12-08-2026 — `scopeActief` staat hier NIET meer bij. Een gekozen document
    // sluit de bibliotheek niet langer af, dus het AANVULLENDE spoor doorzoekt
    // de rest van de bibliotheek en moet daarbij gewoon de status-/actualiteits-
    // filter dragen — anders komen historische en niet-vastgestelde stukken
    // ongefilterd mee. Het HOOFDDOCUMENT zelf blijft vrijgesteld: het primaire
    // spoor hieronder krijgt `undefined` mee, exact zoals vóór deze wijziging.
    // Zonder die vrijstelling zou een bewust gekozen CONCEPT-vergaderstuk door
    // modus 'actueel' uit zijn eigen antwoord wegvallen.
    // De filters zoals ze voor een GEWONE bibliotheekvraag gelden. Sinds
    // 12-08-2026 apart benoemd, omdat ze op twee plaatsen nodig zijn: als de
    // filters van het enige spoor (gewone vraag), én als de filters van het
    // AANVULLENDE spoor in de primaire modi. Het primaire materiaal — het
    // gekozen document of de aan een agendapunt gekoppelde stukken — is er
    // bewust van vrijgesteld.
    const bibliotheekFilters: RetrievalFilters = {
      modus: neemNietVastgesteldeMee
        ? "alles"
        : retrievalModusVoorVraag(antwoordmodus, effectieveVraag),
      peildatum: vandaag,
      bronsoortprofiel: bepaalBronsoortprofiel(effectieveVraag),
      // T4 — regime-demotie op basis van het geldende fondsregime.
      primairRegime: fondsRegime,
    };

    const retrievalFilters: RetrievalFilters | undefined =
      // T2 (#304): de bronloze voorbereiding heeft geen primair spoor en zoekt
      // dus als enige spoor in de bibliotheek. Daar hóórt de status-/actualiteits-
      // filter bij — zonder deze uitzondering zou zij als enige tak de hele
      // bibliotheek inclusief historische stukken ongefilterd binnenhalen. De
      // filter staat voor deze modus op 'besluitvorming' (retrievalModusVoor),
      // exact de correctie die de vervallen route hardcodeerde.
      voorbereidingZonderStukken
      ? bibliotheekFilters
      : agendapuntModusActief || procesModusInPrompt
      ? undefined
      : bibliotheekFilters;

    // RAG-zoeken: voor de bibliotheek-modi, of bij een actieve scope met een
    // SPECIFIEKE vraag (targeted). Brede scope-vragen halen hieronder hun chunks
    // via haalDocumentChunks (volledige dekking i.p.v. top-N).
    let chunks: DocumentChunk[] = [];
    let bronnen: BronVerwijzing[] = [];
    let contextTekst = "";
    // H-10 — afbakening van de bronblokken. Eén sentinel per request: alle
    // contextblokken in deze prompt dragen dezelfde markering, zodat het model
    // consistent kan onderscheiden wat door het portaal is aangeleverd.
    let bronSentinel = maakBronSentinel();
    let contextGeneutraliseerd = 0;
    let retrievalMeta: RetrievalMeta | null = null;

    // ── G3 (plateau B) — de bevroren reflectiebronset ───────────────────────
    // Tijdens een actieve reflectieflow draait er GEEN retrieval: geen embedding,
    // geen RPC, geen FTS, geen PostgREST-terugval, geen reranker. Dat is
    // strenger dan het filter uit technisch ontwerp §6.3 (`p_document_ids` op de
    // retrieval-RPC's): een filter borgt alleen de paden die het kent, terwijl
    // deze aanpak élk pad borgt — ze draaien geen van alle (FR-54, AC-19, AC-20).
    //
    // In plaats daarvan worden precies de chunks van het oorspronkelijke antwoord
    // opgehaald, op ID. Is er geen bronset (een antwoord uit algemene kennis),
    // dan blijft de context leeg en reflecteert de assistent uitsluitend op het
    // antwoord en de woorden van de gebruiker — hij verzint geen dossiercontext
    // en haalt geen bronnen op (FR-55, AC-21).
    if (reflectieActief) {
      if (reflectieBronsetChunkIds.length > 0) {
        chunks = await haalBevrorenChunks(reflectieBronsetChunkIds, fondsId);
        chunks = await verrijkNotulenChunks(chunks);
        chunks = await verrijkDocumentmetadata(chunks, fondsId);
        const ctx = maakContext(chunks);
        contextTekst = ctx.contextTekst;
        bronnen = ctx.bronnen;
        bronSentinel = ctx.sentinel;
        contextGeneutraliseerd = ctx.geneutraliseerd;
      }
      // `retrieval_meta` krijgt bewust GEEN reflectiesleutel (besluit 0112,
      // AC-17). Wat er staat is precies wat er gebeurde: er is niet gezocht.
      // `methode: "geen"` is de bestaande waarde daarvoor en verraadt niets —
      // een antwoord uit algemene kennis levert hem ook op.
      retrievalMeta = {
        methode: "geen",
        opgehaald: chunks.length,
        geselecteerd: chunks.length,
        chunks: chunks.map((c) => ({ id: c.id, document_id: c.document_id, rang: null })),
        toegepaste_fonds_filter: fondsId ?? null,
        namespace_conventie: "bibliotheek",
        fondsdiscipline_gedropt: 0,
      };
    }

    // Agendapunt-modus (ADR 0028) en proces-modus (besluit 0151): retrieval alleen
    // als er doorzoekbare gekoppelde stukken zijn. Zonder stukken halen we niets op
    // — het contextblok is dan de enige context (geen brede bibliotheek-retrieval,
    // criterium 5: nooit een stille terugval naar de hele bibliotheek).
    const moetRetrieven = !reflectieActief && !breedActief && !bronloosBureau && (
      agendapuntModusActief
        ? agendapuntMetStukken || voorbereidingZonderStukken
        : procesModusInPrompt
        ? procesMetStukken
        : scopeActief || bronModusRetrieval === "documenten" || bronModusRetrieval === "combineren"
    );
    if (moetRetrieven) {
      // Hybride-schakelaar (T8): gelezen uit de generieke feature-flag-laag
      // (fonds_feature_flags via lib/fonds-config). De flag is per-fonds leidend;
      // zonder flag valt het terug op de env-default HYBRID_SEARCH — 1-op-1 het
      // gedrag van vóór de generalisatie (backfill borgt de bestaande waarde).
      // fondsId is server-side afgeleid, nooit uit de request-body.
      const hybrideAan = await hybrideZoekenAan(fondsId);

      // R1.3–R1.6 — retrieval-kwaliteitsvlaggen per fonds (reranker, relevantie-
      // drempel, jargonexpansie, parent-retrieval + drempelwaarde). Vallen terug
      // op de env-defaults; fondsId is server-side afgeleid. Worden als opties
      // doorgegeven aan de retrieval en volledig in retrieval_meta gelogd.
      const retrievalVlaggen = await retrievalVlaggenVoorFonds(fondsId);

      // History-aware reformulatie (Fase B1): bij een vervolgvraag die op
      // eerdere context leunt, herschrijven we de vraag tot een zelfstandige
      // zoekvraag vóór de retrieval. De originele vraag blijft ongemoeid in de
      // prompt en in de governance_log; de herschreven zoekvraag wordt enkel
      // gebruikt om te zoeken en wordt vastgelegd in retrieval_meta.
      const priorBeurten = messages.slice(0, -1);
      let zoekVraag = vraag;
      let gereformuleerd = false;

      if (contextModus === "enforce" && vraagContext) {
        // Plateau 1 (enforce): de vroege contextresolver leverde al één
        // zelfstandige `effectieveVraag`. Die IS de zoekvraag — de losse Fase-B1-
        // reformulatie hieronder is daarmee gesubsumeerd (geen tweede modelcall,
        // geen tweede concurrerende vraagrepresentatie). De additieve fusie met de
        // originele vraag blijft (zie retrievalOpties, besluit 0139 M-R3).
        if (effectieveVraag.trim() !== vraag.trim()) {
          zoekVraag = effectieveVraag.trim();
          gereformuleerd = true;
        }
      } else if (heeftReformulatieNodig(vraag, priorBeurten.length > 0)) {
        // off/observe: ongewijzigd gedrag — de bestaande history-aware
        // reformulatie (Fase B1) stuurt uitsluitend de zoekvraag.
        // Voortgang (besluit 0087): de reformulatie draait op het STERKE model en
        // is meestal het grootste stille-tijd-blok. Melden vóór en na de call.
        send({ type: "progress", fase: "reformulatie", status: "bezig", label: VOORTGANG_LABEL.reformulatie });
        const herschreven = await reformuleerVraag(
          async (invoer) =>
            (
              await gateway.genereer(gatewayCtx, {
                taaktype: "chat_reformulatie",
                systeem: invoer.systeem,
                berichten: [{ role: "user", content: invoer.gebruiker }],
                maxTokens: invoer.maxTokens,
                temperature: invoer.temperature,
              })
            ).tekst,
          priorBeurten,
          vraag
        );
        if (herschreven.trim() && herschreven.trim() !== vraag.trim()) {
          zoekVraag = herschreven.trim();
          gereformuleerd = true;
        }
        send({ type: "progress", fase: "reformulatie", status: "klaar", label: VOORTGANG_LABEL.reformulatie });
      }

      // Voortgang (besluit 0087): melden dat we de fondsdocumenten doorzoeken.
      // De reranker draait BINNEN deze call; we melden 'rerank' daarom als een
      // afgeronde stap ná de retrieval (alleen als de fondsvlag rerank aan staat).
      send({ type: "progress", fase: "retrieval", status: "bezig", label: VOORTGANG_LABEL.retrieval });
      // Besluit 0139 (M-R3): bij een geherformuleerde zoekvraag geven we de
      // ORIGINELE vraag mee, zodat de hybride retrieval een extra poging met de
      // originele vraag draait en fuseert (reformulatie voegt alleen recall toe,
      // nooit minder). Niet-geherformuleerd → ongewijzigd gedrag.
      // #311: de (optionele) reranker binnen de retrieval loopt door dezelfde
      // gateway-context als de rest van de beurt.
      const retrievalOpties = gereformuleerd
        ? { ...retrievalVlaggen, origineleVraag: vraag, gateway: { gateway, ctx: gatewayCtx } }
        : { ...retrievalVlaggen, gateway: { gateway, ctx: gatewayCtx } };

      // ── 12-08-2026 — tweesporen-retrieval bij een primair document ────────
      // Een documentselectie was tot nu toe een HARDE afbakening: de RPC's
      // kregen p_document_ids mee en de bibliotheek was fysiek onbereikbaar.
      // Dat maakte vergelijken en duiden onmogelijk. Nu:
      //
      //   Spoor A (primair) — byte-identiek aan het gedrag van vóór deze
      //     wijziging: scope = het gekozen document, filters = undefined. De
      //     gebruiker koos dat stuk bewust, dus géén status-/actualiteitsfilter.
      //     Hierdoor kan een gekozen CONCEPT-vergaderstuk niet alsnog uit zijn
      //     eigen antwoord vallen zodra het aanvullende spoor onder modus
      //     'actueel' draait.
      //   Spoor B (aanvullend) — de rest van de bibliotheek, mét de normale
      //     filters, met een EIGEN budget. Puur additief: het kan primaire
      //     treffers niet verdringen. Zelfde principe als fuseerHybridePogingen
      //     (rag.ts): een extra poging voegt recall toe, neemt nooit weg.
      //
      // Beide sporen draaien parallel — wandkloktijd is die van het traagste
      // spoor, niet de som. De kosten verdubbelen wél op dit pad (tweede
      // embedding + tweede rerank-call); bewuste afweging.
      // UITBREIDING 12-08-2026 — de primaire modus geldt ook in AGENDAPUNT-modus
      // (ADR 0028). Daar waren de gekoppelde stukken tot nu toe een harde
      // afbakening, met hetzelfde gevolg als bij de bibliotheek: "hoe verhoudt
      // dit voorstel zich tot het beleid dat we vorig jaar vaststelden?" was
      // onbeantwoordbaar, terwijl dat bij vergadervoorbereiding bijna de
      // standaardvraag is. De gekoppelde stukken blijven het primaire materiaal;
      // de bibliotheek komt er aanvullend en herkenbaar gescheiden bij.
      //
      // Proces-modus (besluit 0151) blijft BEWUST hard afgebakend: daar zijn de
      // bewijsstukken van een procedure de bron, en snapshot-integriteit weegt
      // daar zwaarder dan bredere duiding.
      const primairPadActief = scopeActief || agendapuntMetStukken;
      const primaireIds = new Set<string>(
        primairPadActief ? scopeDocumentIds ?? [] : []
      );
      const [res, resAanvullend] = await Promise.all([
        zoekRelevanteChunksMetMeta(
          zoekVraag,
          fondsId,
          CHUNK_BUDGET,
          hybrideAan,
          scopeDocumentIds,
          // Spoor A draagt géén filters in de primaire modi. In agendapunt-modus
          // was `retrievalFilters` daar al `undefined`; dit is dus geen
          // gedragswijziging, alleen expliciet gemaakt.
          primairPadActief ? undefined : retrievalFilters,
          retrievalOpties
        ),
        primairPadActief
          ? zoekRelevanteChunksMetMeta(
              zoekVraag,
              fondsId,
              AANVULLEND_BUDGET,
              hybrideAan,
              undefined,
              // Altijd de bibliotheekfilters, óók in agendapunt-modus waar het
              // primaire spoor ongefilterd draait. Zonder dit zou de hele
              // bibliotheek inclusief historische stukken ongefilterd meekomen.
              bibliotheekFilters,
              retrievalOpties
            )
          : Promise.resolve(null),
      ]);

      // Het hoofddocument zit al in spoor A; overlap eruit zodat een passage
      // nooit twee bronnummers krijgt.
      const aanvullendeChunks = (resAanvullend?.chunks ?? []).filter(
        (c) => !primaireIds.has(c.document_id)
      );
      // Volgorde is betekenisdragend: het hoofddocument krijgt de laagste
      // bronnummers, de aanvullende bronnen komen erachter.
      chunks = [...res.chunks, ...aanvullendeChunks];
      retrievalMeta = {
        ...res.meta,
        // De promptset is de SOM van beide sporen. `chunks` voedt de bronset-hash
        // en daarmee de bevroren reflectiebronset (core/lib/bronset.ts,
        // bepaalBronset). Stond hier alleen spoor A in, dan zou een reflectie op
        // dit antwoord de aanvullende bronnen niet terugzien terwijl ze wél in
        // het antwoord zijn gebruikt — en zou de TS-hash afwijken van de
        // SQL-spiegel in reflectie_transitie().
        chunks: [
          ...res.meta.chunks,
          ...aanvullendeChunks.map((c) => ({
            id: c.id,
            document_id: c.document_id,
            rang: c.rang ?? null,
          })),
        ],
        opgehaald: res.meta.opgehaald + (resAanvullend?.meta.opgehaald ?? 0),
        geselecteerd: res.meta.geselecteerd + aanvullendeChunks.length,
        // Wat de verbreding daadwerkelijk toevoegde. Alleen aanwezig als er een
        // aanvullend spoor draaide; geldt voor /ai én de agendapuntchat.
        ...(resAanvullend
          ? {
              aanvullend: {
                chunks: aanvullendeChunks.length,
                documenten: new Set(
                  aanvullendeChunks.map((c) => c.document_id)
                ).size,
              },
            }
          : {}),
        zoekvraag: zoekVraag,
        gereformuleerd,
        body_fonds_id_genegeerd: bodyFondsAfwijkend,
      };
      // Besluit 0138 (addendum op 0087) — één betekenisvolle retrieval-regel i.p.v.
      // een constante. `res.meta.opgehaald` was het ophaalplafond (CHUNK_BUDGET·3) en
      // varieerde nauwelijks; we tonen nu het aantal UNIEKE documenten en het aantal
      // DAADWERKELIJK geselecteerde passages. De reranker-uitkomst is hierin
      // opgenomen (geen aparte, van-een-vlag-afhankelijke rerank-regel meer): met
      // rerank aan is `geselecteerd` het aantal ná de drempel, met rerank uit het
      // aantal ná weging/selectie — de regel klopt dus in beide standen.
      // Telt over BEIDE sporen: de bestuurder ziet "3 documenten, 12 passages"
      // en dat moet overeenkomen met wat er daadwerkelijk in de prompt staat.
      const uniekeDocumenten = new Set(
        retrievalMeta.chunks.map((c) => c.document_id)
      ).size;
      send({
        type: "progress",
        fase: "retrieval",
        status: "klaar",
        label: VOORTGANG_LABEL.retrieval,
        uitkomst: retrievalUitkomst(uniekeDocumenten, retrievalMeta.geselecteerd),
      });
      // Auditspoor (§9): leg de scope vast waarop deze vraag is beperkt.
      if (scopeActief) {
        retrievalMeta.scope = {
          document_ids: scopeDocumentIds!,
          titels: scopeTitels,
          strategie: "targeted",
          algemene_kennis: algemeneKennis,
          // 12-08-2026 — leg vast dat het gekozen stuk het ONDERWERP was en niet
          // de afbakening. Wat de verbreding toevoegde staat in
          // retrievalMeta.aanvullend (top-level, geldt ook voor agendapunt-modus).
          modus: "primair",
        };
      }
      // Increment D — verrijk notulensegment-chunks met vergadering/agendapunt
      // zodat de bronvermelding "Vastgestelde notulen …, agendapunt N — …" klopt.
      chunks = await verrijkNotulenChunks(chunks);
      // Tranche 2B — documenttype/bestandstype voor de documentlijst bij
      // antwoordmodus `bronoverzicht`. Bewust hier, ná retrieval, ranking en
      // fondsdiscipline: het zijn doorgeefvelden voor de WEERGAVE en ze mogen
      // niets aan de selectie veranderen. Zie verrijkDocumentmetadata().
      chunks = await verrijkDocumentmetadata(chunks, fondsId);
      // primaireIds → herkomstmarkering [hoofddocument]/[aanvullend uit de
      // bibliotheek] in de bronkop; `vandaag` → geldigheidsdeel van het
      // statuslabel. Zonder scope is primaireIds leeg en verandert er niets.
      const ctx = maakContext(
        chunks,
        0,
        undefined,
        primaireIds,
        vandaag,
        // In agendapunt-modus is het primaire materiaal niet één gekozen stuk
        // maar de set gekoppelde stukken; "[gekoppeld stuk]" leest daar correcter.
        agendapuntModusActief ? " [gekoppeld stuk]" : " [hoofddocument]"
      );
      contextTekst = ctx.contextTekst;
      bronnen = ctx.bronnen;
      // H-10: de bron-afbakening en het aantal geneutraliseerde bronlabel-
      // patronen doorgeven aan respectievelijk de systeemprompt en het
      // auditspoor.
      bronSentinel = ctx.sentinel;
      contextGeneutraliseerd = ctx.geneutraliseerd;

      // Besluitvorming-modus (Increment G): voeg de Decision Object-
      // besluitregistratie van de relevante procesinstantie(s) toe als LEIDENDE
      // formele bron (regressietests #5/#12). Afgeleid uit de top-chunks
      // (denorm procesinstantie_id); RLS van decision_objects blijft leidend.
      if (antwoordmodus === "besluitrijpheid") {
        const procesIds = topProcesinstanties(
          chunks.map((c) => c.documenten.procesinstantie_id)
        );
        const besluitBronnen = await haalBesluitBronnen(supabase, procesIds);
        if (besluitBronnen.length > 0) {
          const fb = opmaakBesluitContext(besluitBronnen);
          // Formele bron leidend: vóór de document-context en vóór de bronkaarten.
          contextTekst = `${fb.contextTekst}\n\n---\n\n${contextTekst}`;
          bronnen = [...fb.bronnen, ...bronnen];
          if (retrievalMeta) {
            retrievalMeta = { ...retrievalMeta, besluitbronnen: besluitBronnen.length };
          }
        }
      }
    }

    // M6 — targeted betekent uitsluitend de daadwerkelijk geselecteerde promptset.
    // Voor de mogelijke vervolgactie tellen we het document zonder tekst op te
    // halen; dit verandert de retrieval niet.
    if (!breedActief) {
      documentDekking = gerichteDekking(
        retrievalMeta?.geselecteerd ?? chunks.length
      );
      if (
        vraagrouterVlaggen.volledigeAnalyseVervolg &&
        scopeActief &&
        (scopeDocumentIds?.length ?? 0) === 1
      ) {
        totaalPassagesVoorAanbod = await telDocumentChunks(scopeDocumentIds!);
      }
    }

    // Dekkingsbrede scope (increment 2): volledige documentdekking. Bronnen op
    // documentniveau (paginaverwijzingen in de tekst i.p.v. [Bron N]-pills); bij
    // full-document bouwen we de context hier, bij map-reduce in de stream.
    if (breedActief) {
      // Zelfde verrijking als op het gerangschikte pad: ook hier bouwen we
      // bronkaarten, dus ook hier horen documenttype en bestandstype mee.
      chunks = await verrijkDocumentmetadata(breedChunks, fondsId);
      bronnen = documentBronnen(chunks);
      if (scopeStrategie === "full_document") {
        contextTekst = breedChunks
          .map((c) => `${locatieLabel(c)}${c.tekst}`)
          .join("\n\n");
      }
      retrievalMeta = {
        methode: "geen",
        opgehaald: breedChunks.length,
        geselecteerd: breedChunks.length,
        chunks: [],
        // T4 — dit pad past de fonds-guard toe in haalDocumentChunks; leg de
        // toegepaste filter + het manipulatie-signaal ook hier in het auditspoor vast.
        toegepaste_fonds_filter: fondsId,
        namespace_conventie: "bibliotheek",
        body_fonds_id_genegeerd: bodyFondsAfwijkend,
        scope: {
          document_ids: scopeDocumentIds!,
          titels: scopeTitels,
          strategie: scopeStrategie,
          algemene_kennis: algemeneKennis,
          verwerkte_chunks: breedChunks.length,
          batches: scopeStrategie === "map_reduce" ? breedBatches.length : undefined,
          afgekapt: scopeStrategie === "map_reduce" ? breedAfgekapt : undefined,
        },
      };
    }

    // Eerste versie voor meta-event/prompt. De maplus actualiseert verwerkte
    // batches/passages verderop vóór logging en het definitieve done-event.
    if (retrievalMeta && vraagRoute) {
      vraagRoute = finaliseerRouteMetDekking(vraagRoute, documentDekking);
      retrievalMeta.vraagrouter = vraagRoute;
      if (vraagrouterUitvoering) {
        retrievalMeta.vraagrouter_uitvoering = vraagrouterUitvoering;
      }
      if (analyseplanMeta) retrievalMeta.analyseplan = analyseplanMeta;
      retrievalMeta.documentdekking = documentDekking;
      retrievalMeta.volledige_analyse = {
        aangeboden: false,
        uitgevoerd: volledigeAnalyseUitgevoerd,
        ...(volledigeAnalyseVorigeLogId
          ? { vorige_log_id: volledigeAnalyseVorigeLogId }
          : {}),
        ...(volledigeAnalyseDocumentId
          ? { document_id: volledigeAnalyseDocumentId }
          : {}),
      };
    }

    // ── Increment I-2 (FO §11a) — promptkeuze ontkoppeld van retrieval ───────
    // De retrieval-modus (bronModusRetrieval) bepaalt OF en hoe breed we ophalen
    // (Design A: combineren-vloer, altijd ophalen). De PROMPT-modus bepaalt welke
    // van de drie kostbare instructiesets (documenten/combineren/algemeen) de AI
    // krijgt. Die koppelen we aan de automatische bron-intentie: een expliciet
    // algemeen-gerichte vraag zónder fondstreffers krijgt de algemene prompt
    // (geen schijn-onderbouwing op afwezige bronnen); verder is combineren de
    // vloer. "Alleen fondsdocumenten" forceert de strikte documenten-prompt.
    const promptModus: Modus = alleenFondsdocumenten
      ? "documenten"
      : bronIntent === "algemeen" && bronnen.length === 0
      ? "algemeen"
      : "combineren";

    // ── Contextbesef (besluit 0090) — portaalstand meesturen ────────────────
    // Bij een persoonlijke of statusgerichte vraag (heeftPortaalstandNodig) buiten
    // scope/agendapunt/transformatie krijgt het model de eigen proces-/taakstand mee:
    // de eerstvolgende processtap, de komende vergadering en de agendapunten zonder
    // eigen inbreng — plus de fondsbrede risico's/procedures. De PERSOONLIJKE stand
    // komt uit getPortaalContext: uitsluitend query's onder RLS op de sessie (eigen
    // inbreng, eigen procedure-eigenaarschap), nooit een fondsbrede query voor iets
    // persoonlijks (criterium 7). Deze opbouw draait ná de verduidelijkingstak, zodat
    // een onzekere statusvraag die terugvraagt geen queries verspilt. Bij een zuiver
    // algemene vraag blijft dit blok leeg (criterium 6).
    let portaalstandBlok = "";
    const portaalstandNodig =
      !scopeActief &&
      !agendapuntModusActief &&
      !transformatieActief &&
      // Besluit 0151: bij een expliciete module-scope is het focusblok de context;
      // dan gaat de persoonlijke portaalstand + het generieke fondsbrede modulesBlok
      // niet óók mee (kosten/ruis, en de scope is bewust specifiek).
      !moduleScopeActief &&
      heeftPortaalstandNodig(effectieveVraag);
    if (portaalstandNodig) {
      const stand = await getPortaalContext({
        userId: ctx.gebruikerId,
        fondsId,
        gebruikerNaam: profiel?.naam ?? null,
        // T1 bureau-rol (§6.6): zonder de rol valt de afleiding terug op de
        // bestuurdersmaatstaf, en die telt agendapunten zonder EIGEN inbreng.
        // Voor `bestuursbureau` levert die query sinds migratie 2026_08_05 nul
        // rijen, dus de promptregel zou "zonder uw eigen inbreng: N van N"
        // melden — precies de misleiding die de maatstaf moest wegnemen.
        rol: (profiel as { rol?: string | null } | null)?.rol ?? null,
      });
      portaalstandBlok = bouwPortaalstandBlok(stand);
      // Fondsbrede module-context (risico's/procedures) ook buiten agendapunt-modus,
      // onder dezelfde conditie (stap 2). Agendapunt-modus vulde modulesBlok al vóór
      // het streamen; die tak komt hier niet.
      if (modulesBlok === "") modulesBlok = await haalModuleContextBlok(fondsId);
    }
    const portaalstandGebruikt = portaalstandBlok.length > 0;

    // Compacte context-prefix voor de gewone chat-takken (algemeen/combineren/
    // documenten): de portaalstand + fondsbrede modules + (besluit 0151) het
    // module-scope-focusblok vóór de vraag, gelabeld en met een scheidingslijn.
    // Leeg bij een zuiver algemene vraag → geen prefix. Het module-scope-blok draagt
    // zijn eigen instructie (signaleren/spiegelen), dus de toon-systeemprompt blijft
    // byte-identiek.
    const portaalDelen = [
      portaalstandBlok,
      modulesBlok.trim(),
      moduleScopeInPrompt ? moduleScopeBlok : "",
    ].filter((s) => s.length > 0);
    const portaalContextPrefix =
      portaalDelen.length > 0 ? `${portaalDelen.join("\n\n")}\n\n---\n\n` : "";

    // Bouw prompt op basis van modus, met persoonlijke context
    let systeemBlokken: Anthropic.Messages.TextBlockParam[];
    let gebruikersPrompt: string;

    if (reflectieActief) {
      // ── Plateau B — de reflectiebeurt ─────────────────────────────────────
      // Staat VOORAAN in de keten: een actieve reflectie overschrijft elke
      // andere prompt-tak. Een scope-, agendapunt- of transformatiebeurt kan
      // per definitie niet tegelijk een reflectiebeurt zijn — het invoerkanaal
      // is een ander (FR-56).
      //
      // Twee vormen: verdiepingsvraag of conceptweergave. Welke van de twee het
      // is, bepaalt de SERVER uit de GEVRAAGDE ACTIE — niet het model en niet de
      // client. B-opt tranche 2c: het concept verschijnt ná ELK reflectieantwoord
      // (en na een herformulering), niet meer alleen bij het bereikte plafond.
      // `verdiepen` (tranche 2d) vraagt juist om één nieuwe verdiepingsvraag.
      const toonConcept =
        reflectieActie === "antwoord" || reflectieActie === "herformuleren";
      const isVerdiepen = reflectieActie === "verdiepen";
      // Guardrail 6: de verdiepingsvraag (start of verdiepen) wordt niet gestreamd
      // maar gebufferd + gevalideerd. Het concept mag wél streamen.
      bufferReflectievraag = !toonConcept;

      // B-opt tranche 4a: bij een tegenperspectief-beurt plakken we het kleine
      // tegenperspectief-blok achter de reguliere reflectieregels.
      const reflectieRegels = toonConcept
        ? SP_REFLECTIE_CONCEPT_REGELS
        : reflectieTegenperspectief
        ? `${SP_REFLECTIE_REGELS}\n\n${SP_REFLECTIE_TEGENPERSPECTIEF}`
        : SP_REFLECTIE_REGELS;

      systeemBlokken = bouwSysteemBlokken(
        reflectieRegels,
        ctxBestuurder,
        antwoordmodus,
        chunks.length > 0 ? bronSentinel : null
      );

      // B-opt tranche 3d — de feitelijke samenstelling, direct boven het bronblok
      // en uitsluitend wanneer de server haar heeft vastgesteld. Ontbreekt deze
      // regel, dan verbiedt SP_REFLECTIE_REGELS elke uitspraak over herkomst.
      const samenstellingBlok = reflectieSamenstelling
        ? `SAMENSTELLING VAN HET EERDERE ANTWOORD: ${reflectieSamenstelling}.\nU mag dit noemen; u mag het niet aanvullen of afleiden.\n\n`
        : "";

      const bronBlok =
        samenstellingBlok +
        (chunks.length > 0
          ? `EERDER VASTGESTELDE BRONINFORMATIE (bevroren bij de start van deze reflectie; er is niet opnieuw gezocht):\n\n${contextTekst}\n\n---\n\n`
          : `(Bij het antwoord waarop wordt gereflecteerd zijn geen bronnen gebruikt. Reflecteer uitsluitend op dat antwoord en op de woorden van de bestuurder.)\n\n---\n\n`);

      gebruikersPrompt = toonConcept
        ? `${bronBlok}De bestuurder heeft hierboven in dit gesprek zijn afweging verwoord. Zijn laatste inbreng: ${vraag}\n\nToon nu de conceptweergave.`
        : reflectieTegenperspectief
        ? `${bronBlok}De bestuurder vraagt om een tegenperspectief. Stel op basis van dit gesprek precies één open vraag die hem uitnodigt zélf het sterkste tegenargument te benoemen. U levert het argument niet.`
        : isVerdiepen
        ? `${bronBlok}De bestuurder wil nog een stap verdiepen op zijn reflectie. Stel op basis van dit gesprek precies één nieuwe, aansluitende verdiepingsvraag — geen samenvatting, geen concept, geen conclusie.`
        : `${bronBlok}INBRENG VAN DE BESTUURDER: ${vraag}`;
    } else if (transformatieActief) {
      // Herschrijf-intent (FO §13): bewerk het vorige antwoord (staat al in de
      // historie van claudeBerichten). Géén strict-document-weigering; wel
      // grounding (geen nieuwe fondsfeiten). Eventuele gescoopte fragmenten gaan
      // als verankering mee. De antwoordmodus (besluitrijpheid/duiding/…) komt uit
      // de gekozen vervolgactie en stuurt de antwoordstijl.
      const transTitel =
        scopeTitels.length > 0
          ? scopeTitels.map((t) => `«${t}»`).join(", ")
          : null;
      systeemBlokken = bouwSysteemBlokken(
        SP_TRANSFORMATIE_REGELS,
        ctxBestuurder,
        antwoordmodus,
        chunks.length > 0 ? bronSentinel : null
      );
      gebruikersPrompt =
        chunks.length > 0
          ? `ONDERSTEUNENDE FRAGMENTEN${
              transTitel ? ` UIT ${transTitel}` : ""
            } (ter verankering; voeg geen feiten toe die hier of in uw vorige antwoord niet staan):\n\n${contextTekst}\n\n---\n\nOPDRACHT (bewerk uw vorige antwoord hierboven): ${vraag}`
          : `OPDRACHT (bewerk uw vorige antwoord hierboven in de berichtgeschiedenis): ${vraag}`;
    } else if (agendapuntModusActief) {
      // ADR 0028 — agendapunt-modus: de toelichting gaat als gelabelde seed-context
      // mee (geen vastgestelde fondsbron → [Toelichting agendapunt]); de eventuele
      // gekoppelde stukken komen als [Bron N] uit de retrieval. Combineren-stijl,
      // geen strict-document "niet aangetroffen"-gedrag.
      //
      // T2 (#304) — is dit de PERSOONLIJKE VOORBEREIDING, dan wisselt uitsluitend
      // de regelset. De toelichtingsseed, het stukkenblok, de bronsentinel en de
      // rest van deze tak blijven ongewijzigd: de voorbereiding is een andere
      // OPDRACHT binnen dezelfde modus, geen tiende tak.
      systeemBlokken = bouwSysteemBlokken(
        antwoordmodus === "persoonlijke_voorbereiding"
          ? SP_VOORBEREIDING_REGELS
          : SP_AGENDAPUNT_REGELS,
        ctxBestuurder,
        antwoordmodus,
        chunks.length > 0 ? bronSentinel : null
      );
      const toelichtingBlok = bouwToelichtingBlok(agendapuntSeed!);
      const stukkenBlok =
        // T2 (#304) — de bronloze voorbereiding heeft wél bronnen, maar geen
        // gekoppelde stukken. Er is dan niets als [gekoppeld stuk] gemarkeerd
        // (maakContext zet zonder primaire ids geen enkel herkomstlabel), dus de
        // kop mag die markering ook niet beloven: dat zou het model een
        // onderscheid laten benoemen dat in de bronkoppen niet bestaat.
        voorbereidingZonderStukken && chunks.length > 0
          ? `\n\n=== BRONNEN UIT DE BIBLIOTHEEK ===\nEr zijn geen stukken aan dit agendapunt gekoppeld. De bronnen hieronder komen uit de bibliotheek van het fonds en zijn erbij gezocht op de titel en toelichting van het agendapunt; ze zijn dus GEEN vergaderstukken bij dit punt. Duid ze als zodanig.\n\n${contextTekst}`
          : chunks.length > 0
          ? `\n\n=== BRONNEN BIJ DIT AGENDAPUNT ===\nDe aan dit agendapunt gekoppelde stukken zijn gemarkeerd met [gekoppeld stuk]. Bronnen met [aanvullend uit de bibliotheek] komen uit andere stukken van het fonds en zijn er ter duiding en vergelijking bij gezocht.\n\n${contextTekst}`
          : "\n\n(Er zijn geen doorzoekbare stukken aan dit agendapunt gekoppeld; baseer uw antwoord op de toelichting en, waar passend, uw algemene kennis.)";
      // Module-context (risico's/procedures) na de stukken — zie opbouw hierboven.
      gebruikersPrompt = `${toelichtingBlok}${stukkenBlok}${modulesBlok}\n\n---\n\nVRAAG: ${vraag}`;
    } else if (stukActief) {
      // ── T2 — bureau-stand "Een stuk voorbereiden" ───────────────────────────
      // Staat vóór de generieke scope-tak zodat de bureau-behandeling wint (de
      // taak vereist een scope, dus zonder deze tak zou de beurt als gewone
      // document-scope-vraag lopen). Twee dingen zijn hier anders dan elders:
      //  1. BUREAU-TOON: bouwSysteemBlokken krijgt bureauToon=true → TOON_BLOK_BUREAU
      //     i.p.v. TOON_BLOK. Dit is de ENIGE plek waar die vlag true is; overal
      //     anders blijft hij default false (nulgrens G23).
      //  2. De samengestelde stuk-instructie staat in de GEBRUIKERSPROMPT (niet in
      //     SP_* — CLAUDE.md-guardrail), inclusief de verruiming (voorstel van het
      //     bureau, geen besluit) en de niet-uitzetbare slotsectie (G3/G8/G13).
      // Basis: de strikte documentenregels (alleen [Bron N] uit de geselecteerde
      // stukken, niets verzinnen) — dat dwingt G8 af: gaten worden NIET met
      // algemene kennis gedicht maar onder "Aannames en open punten" benoemd.
      if (bronloosBureau) {
        // T5 B1 — variant (iii): geen bron gekozen. De basis-tak is de bronloze
        // regelset (concept-SKELET, anti-fabricage onverkort); TOON_BLOK_BUREAU
        // komt eroverheen (bureauToon). Er is niet gezocht (moetRetrieven=false),
        // dus geen bronblokken en geen sentinel.
        systeemBlokken = bouwSysteemBlokken(
          SP_BUREAU_BRONLOOS_REGELS,
          ctxBestuurder,
          "feitelijk",
          null,
          true // bureauToon
        );
        gebruikersPrompt =
          `U stelt dit stuk op ZONDER aangeleverde fondsdocumenten — lever een ` +
          `concept-SKELET, geen afgeronde notitie.\n\n${stukInstructie}\n\n` +
          `Verzin geen fondsspecifieke feiten of bronnen. Alles wat voor dit fonds ` +
          `nog moet worden ingevuld of opgevraagd, zet u onder "Aannames en open punten".`;
      } else {
        const stukTitelLabel =
          scopeTitels.length > 0 ? scopeTitels.map((t) => `«${t}»`).join(", ") : null;
        systeemBlokken = bouwSysteemBlokken(
          SP_DOCUMENTEN_REGELS,
          ctxBestuurder,
          "feitelijk",
          chunks.length > 0 ? bronSentinel : null,
          true // bureauToon
        );
        gebruikersPrompt =
          chunks.length > 0
            ? `BESCHIKBARE BRONNEN${
                stukTitelLabel ? ` UIT ${stukTitelLabel}` : ""
              }:\n\n${contextTekst}\n\n---\n\n${stukInstructie}`
            : `In de geselecteerde stukken zijn geen doorzoekbare passages gevonden.\n\n${stukInstructie}\n\nU beschikt niet over bronnen; benoem dat expliciet onder "Aannames en open punten" en verzin geen fondsspecifieke feiten.`;
      }
    } else if (scopeActief) {
      // Strict-document gedrag overschrijft de gekozen modus. De regels hangen af
      // van opt-in algemene kennis (drie-deling) en van breed vs. specifiek.
      const titelLabel =
        scopeTitels.length === 1
          ? `«${scopeTitels[0]}»`
          : scopeTitels.map((t) => `«${t}»`).join(", ");
      // 12-08-2026 — het BREDE pad (doorgronden/samenvatten) laadt het volledige
      // document en draait geen retrieval; daar bestaan dus geen aanvullende
      // bibliotheekbronnen en blijft de bestaande instructie staan. Het targeted
      // pad krijgt de primaire-modus: hoofddocument leidend, bibliotheek
      // aanvullend en herkenbaar gescheiden.
      const scopeRegels = breedActief
        ? algemeneKennis
          ? SP_DOCUMENT_BREED_ALG_REGELS
          : SP_DOCUMENT_SCOPE_BREED_REGELS
        : algemeneKennis
        ? SP_DOCUMENT_PRIMAIR_ALG_REGELS
        : SP_DOCUMENT_PRIMAIR_REGELS;
      systeemBlokken = bouwSysteemBlokken(
        scopeRegels,
        ctxBestuurder,
        "feitelijk",
        chunks.length > 0 ? bronSentinel : null
      );

      if (scopeStrategie === "map_reduce") {
        // De gebruikersprompt voor map-reduce wordt in de stream opgebouwd uit de
        // map-deelanalyses; hier een placeholder (wordt daar vervangen).
        gebruikersPrompt = "";
      } else if (breedActief) {
        // full-document: volledige documenttekst in de prompt.
        gebruikersPrompt = `VOLLEDIGE INHOUD VAN HET DOCUMENT ${titelLabel}:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraagVoorPrompt}${
          analyseplanTekst ? `\n\n${analyseplanTekst}` : ""
        }`;
      } else {
        // targeted (increment 1): top-N fragmenten.
        gebruikersPrompt =
          chunks.length > 0
            ? `HOOFDDOCUMENT: ${titelLabel}\n\nBESCHIKBARE BRONNEN — het gekozen stuk is gemarkeerd met [hoofddocument]; bronnen met [aanvullend uit de bibliotheek] komen uit andere stukken:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}\n\nBeantwoord de vraag met ${titelLabel} als onderwerp. Gebruik aanvullende bronnen om te duiden, te vergelijken of aan te vullen, en maak in de lopende tekst zichtbaar wanneer u dat doet. U zag alleen geselecteerde passages. Ontbreekt het antwoord daarin, formuleer exact: "Niet gevonden in de geselecteerde passages. Dit is geen uitspraak over het volledige document."`
            : `Voor deze vraag zijn geen passages geselecteerd uit het hoofddocument ${titelLabel} of uit de aanvullende bibliotheek.\n\nVRAAG: ${vraag}\n\nFormuleer exact: "Niet gevonden in de geselecteerde passages. Dit is geen uitspraak over het volledige document." Verzin geen antwoord en vul niet aan uit uw algemene kennis.`;
      }
    } else if (promptModus === "algemeen") {
      systeemBlokken = bouwSysteemBlokken(SP_ALGEMEEN_REGELS, ctxBestuurder, antwoordmodus, null, false, opstelTaak);
      gebruikersPrompt = `${portaalContextPrefix}${vraagBlok}`;
    } else if (promptModus === "combineren") {
      // Bij nul interne treffers valt het antwoord terug op algemene kennis. Gebruik
      // dan ook de algemene-kennis-regels (die [Bron N] verbieden) i.p.v. de
      // combineren-regels — anders kan het model naar niet-bestaande [Bron N]
      // verwijzen (kapotte bron-chips). De bronbasis-melding blijft "combineren".
      systeemBlokken = bouwSysteemBlokken(
        chunks.length > 0 ? SP_COMBINEREN_REGELS : SP_ALGEMEEN_REGELS,
        ctxBestuurder,
        antwoordmodus,
        chunks.length > 0 ? bronSentinel : null,
        false,
        opstelTaak
      );
      gebruikersPrompt =
        chunks.length > 0
          ? `${portaalContextPrefix}BESCHIKBARE INTERNE BRONNEN:\n\n${contextTekst}\n\n---\n\n${vraagBlok}`
          : `${portaalContextPrefix}Er zijn geen interne documenten gevonden die direct relevant zijn voor deze vraag.\n\n${vraagBlok}\n\nGebruik je algemene kennis om de vraag zo goed mogelijk te beantwoorden, en markeer claims met [Algemene kennis]. Sluit af met een opmerking dat er geen interne bronnen zijn gevonden.`;
    } else {
      // documenten (strikte modus)
      systeemBlokken = bouwSysteemBlokken(
        SP_DOCUMENTEN_REGELS,
        ctxBestuurder,
        antwoordmodus,
        chunks.length > 0 ? bronSentinel : null,
        false,
        opstelTaak
      );
      gebruikersPrompt =
        chunks.length > 0
          ? `${portaalContextPrefix}BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\n${vraagBlok}`
          : `${portaalContextPrefix}Er zijn geen relevante documenten gevonden voor deze vraag.\n\n${vraagBlok}\n\nGeef aan dat er geen relevante bronnen zijn gevonden en stel voor welk type document zou kunnen helpen.`;
    }

    // Bij een actieve scope is het gedrag strict-document, ongeacht de gekozen
    // modus. Voor de UI-meta en het auditspoor loggen we dat als 'documenten'
    // (strikt op interne bronnen); de scopedetails staan in retrieval_meta.
    // Agendapunt-modus combineert toelichting + (eventueel) stukken + algemene
    // kennis → log/UI als 'combineren'; de herkomst staat apart in retrieval_meta.
    const effectieveModus: Modus = agendapuntModusActief
      ? "combineren"
      : scopeActief
      ? "documenten"
      : promptModus;

    // ── Besluit 0151 — module-scope-meta (chip + onderbouwingspaneel + audit) ──
    // De sleutel (procedure_id/risico_id) en de gebruikte bron-ids zijn IDENTITEIT
    // (bron), begrensd tot wat de sessie onder RLS al mocht zien; blok_tekens is
    // telemetrie voor de tokenmeting (criterium 11). Titels reizen niet mee: de
    // client kent ze al uit de module-ingang en rendert de chip zelf.
    // Alleen loggen als "gebruikt" wanneer het blok daadwerkelijk in de prompt zat
    // (moduleScopeInPrompt) — een module-gesprek stuurt de scope óók mee bij een
    // transformatie-/reflectiebeurt, en dan hoort het auditspoor niet te claimen dat
    // de modulecontext meewoog.
    const moduleScopeMeta = moduleScopeInPrompt
      ? {
          soort: moduleScopeSoort!,
          ...moduleScopeSleutel,
          validatie: "ok" as const,
          ...(moduleScopeBronIds.length > 0 ? { bron_ids: moduleScopeBronIds } : {}),
          blok_tekens: moduleScopeBlok.length,
        }
      : null;

    // ── Increment I-1 (FO §11c) — rustige weergave ──────────────────────────
    // Bronbasis-samenvatting voor het paneel "Onderbouwing en bronnen" en het
    // auditspoor (§11d). Inline-meldingen pre-stream: deterministisch op basis
    // van bron-modus + antwoordmodus + treffers. De #4-melding (algemene kennis
    // náást treffers) hangt van de antwoordinhoud af en wordt ná het streamen
    // herberekend en in het 'done'-event meegestuurd.
    const bronbasis = bronbasisLabel(bronModusRetrieval, bronnen.length, scopeActief);

    // Increment I-3 — uniform bronmodel. De documentbronnen zijn nu al bekend;
    // de model_knowledge-bronnen (algemene kennis) hangen van de antwoordinhoud af
    // en worden ná het streamen afgeleid. Web-retrieval bestaat nog niet (Scenario
    // B), dus web_retrieval_actief = false en er komen geen web-bronnen bij.
    const documentSources: AssistantSource[] = bronnen.map(documentBronNaarSource);
    const sourceSamenvattingPre = bouwSourceSamenvatting(documentSources, false);
    // ── Schaduwtelling (30-07-2026) ────────────────────────────────────────
    // Nul treffers onder de actualiteitsfilter betekent NIET automatisch "er is
    // niets". De harde conceptregel (FO §6 / TO §3.1) haalt alles weg wat niet
    // 'vastgesteld'/'van_kracht' is, en die rijen zijn hier onzichtbaar. Zonder
    // deze telling meldt de assistent "geen relevante fondsdocumenten gevonden"
    // terwijl er een bestuursvoorstel over het onderwerp kan liggen — de
    // omgekeerde conclusie van de werkelijkheid. Alleen in het nul-treffergeval,
    // alleen als de filter daadwerkelijk actief WAS, en FTS-only (geen embedding).
    let nietVastgesteld: { documenten: number; chunks: number; titels: string[] } | null =
      null;
    // CORRECTIE 30-07-2026 (tweede ronde): de trigger is nul FONDStreffers, niet nul
    // treffers totaal. Bij een fondsvraag levert retrieval vaak wél generieke
    // treffers (Pensioenwet, DNB-guidance) terwijl er geen enkel fondsstuk doorheen
    // komt. Met `bronnen.length === 0` sloeg de telling dan niet aan en bleef het
    // antwoord "de bronnen die ik ken zijn zonder uitzondering generieke kaders" —
    // precies het geval waarvoor deze melding bedoeld is.
    const fondsTreffers = chunks.filter(
      (c) => c.documenten.bibliotheek !== "generiek"
    ).length;
    // CORRECTIE 12-08-2026 — `fondsTreffers === 0` is hier weggehaald. Die
    // drempel maakte de telling in de praktijk onbereikbaar: leverde de
    // retrieval één vastgesteld fondsstuk op, dan bleef een conceptstuk over
    // exact hetzelfde onderwerp onzichtbaar én onvermeld, en was de
    // verbredingschip niet te bereiken. Precies de dagelijkse klacht. De telling
    // draait nu zodra de actualiteitsfilter actief is; de MELDING blijft wél
    // voorbehouden aan het nul-treffers-geval (zie metNietVastgesteldeMelding),
    // zodat er geen tweede melding onder een geslaagd antwoord verschijnt.
    if (
      !scopeActief &&
      !agendapuntModusActief &&
      !transformatieActief &&
      !neemNietVastgesteldeMee &&
      retrievalFilters?.modus === "actueel"
    ) {
      const telling = await telNietActueleFondstreffers(effectieveVraag, fondsId, vandaag);
      if (telling.documenten > 0) nietVastgesteld = telling;
    }

    // De verbredings-aanbieding voor de UI: één chip die dezelfde vraag opnieuw
    // stelt met de actualiteitsfilter uit. Patroon gelijk aan de verduidelijkings-
    // chip (FO §11a): de gebruiker beslist, het systeem gokt niet.
    const verbreding = nietVastgesteld
      ? {
          type: "niet_vastgesteld" as const,
          aantal: nietVastgesteld.documenten,
          titels: nietVastgesteld.titels,
          label:
            nietVastgesteld.documenten === 1
              ? "Neem dit niet-vastgestelde stuk mee"
              : "Neem deze niet-vastgestelde stukken mee",
        }
      : null;

    // Vervang de misleidende "geen fondsdocumenten"-melding door de eerlijke
    // variant zodra de telling stukken vond. Bewust VERVANGEN, niet aanvullen:
    // twee meldingen die elkaar tegenspreken is erger dan één.
    const metNietVastgesteldeMelding = (meldingen: InlineMelding[]): InlineMelding[] => {
      if (!nietVastgesteld) return meldingen;
      // 12-08-2026 — de telling draait nu ook als er wél fondstreffers waren
      // (zodat de verbredingschip bereikbaar is). De VERVANGENDE melding hoort
      // dan niet: er is geen "geen fondsdocumenten"-melding om te vervangen, en
      // een extra melding onder een geslaagd antwoord is ruis. De chip alleen
      // volstaat: die biedt de keuze zonder een oordeel te vellen.
      if (fondsTreffers > 0) return meldingen;
      const vervangen = meldingNietVastgesteldeStukken(nietVastgesteld.documenten);
      const zonder = meldingen.filter((m) => m.type !== "geen_fondstreffer");
      return [vervangen, ...zonder];
    };

    const inlineMeldingenPre = metNietVastgesteldeMelding(
      bepaalInlineMeldingen({
        bronModus: bronModusRetrieval,
        antwoordmodus,
        aantalBronnen: bronnen.length,
        scopeActief,
      })
    );

    // ── Scenario A (besluit 0072) — beslis of live web-retrieval mag draaien ──
    // Deterministische gating (FR-1/FR-4/FR-9): env-vlag aan + ≥1 actieve
    // whitelist-entry + geen document-/agendapuntscope + extern (generiek/
    // gecombineerd) bronsoortsignaal + PII-gate slaagt. De whitelist wordt alleen
    // gelezen als de vlag aan staat (Scenario B doet géén extra query). fondsId is
    // server-side afgeleid; de PII-gate blokkeert de uitgaande zoekvraag bij
    // persoons-/fondsgegevens (AVG). Alles hierna is no-op bij WEB_RETRIEVAL_ACTIEF=false.
    const webBronsoortprofiel = bepaalBronsoortprofiel(effectieveVraag);
    // T4/G2 — live deskresearch is een expliciete bestuursbureau-capability.
    // De client kan deze poort niet beïnvloeden: de rol komt uit het onder RLS
    // geladen profiel. Zonder capability lezen we zelfs de whitelist niet en
    // wordt er nooit een extern webtool aan het model aangeboden.
    const deskresearchCapability = rolHeeftCapability(
      (profiel as { rol?: string | null } | null)?.rol,
      "ai.deskresearch"
    );
    const whitelistEntries =
      WEB_RETRIEVAL_ACTIEF && deskresearchCapability && !scopeActief
        ? await haalActieveWhitelist(supabase)
        : [];
    // Plateau 1 (§4.3) — fail-closed op BEIDE vraagvormen: als de originele óf de
    // effectieve vraag persoonsgegevens bevat, wordt live web-retrieval geblokkeerd.
    // Een contextresolutie mag een persoonsgegeven uit de originele vraag nooit
    // wegpoetsen. In off/observe is `effectieveVraag === vraag`, dus dit is daar een
    // no-op; alleen in enforce voegt het de effectieve vraag als tweede controle toe.
    const piiOrigineel = bevatPersoonsgegevens(vraag, [fondsnaam]);
    const piiEffectief = bevatPersoonsgegevens(effectieveVraag, [fondsnaam]);
    const piiUitkomst = {
      bevatPii: piiOrigineel.bevatPii || piiEffectief.bevatPii,
      soorten: Array.from(new Set([...piiOrigineel.soorten, ...piiEffectief.soorten])),
    };
    const webGate = beoordeelWebGate({
      vlagAan: WEB_RETRIEVAL_ACTIEF && deskresearchCapability,
      aantalActieveEntries: whitelistEntries.length,
      scopeActief,
      bronsoortprofiel: webBronsoortprofiel,
      bevatPii: piiUitkomst.bevatPii,
    });
    // #311: neutrale tool voor de gateway; de Anthropic-adapter mapt hem op de
    // web_search-servertool (zelfde parameters als vóór de gateway).
    const webTool = webGate.mag
      ? ({ soort: "webzoek", domeinen: allowedDomeinenUit(whitelistEntries), maxGebruik: WEB_MAX_USES } as const)
      : null;

    // Voortgang (besluit 0087): alleen melden als live web-retrieval daadwerkelijk
    // is toegestaan voor deze vraag (whitelist beschikbaar gemaakt). Uit → geen
    // fase (geen schijnzekerheid).
    if (webGate.mag) {
      send({
        type: "progress",
        fase: "web",
        status: "klaar",
        label: VOORTGANG_LABEL.web,
        uitkomst: webUitkomst(whitelistEntries.length),
      });
    }

    // Bouw de uiteindelijke messages-array voor Claude.
    // We knippen de geschiedenis op het maximum en vervangen de laatste
    // user-message door dezelfde vraag mét de zojuist opgehaalde RAG-context.
    const recente = messages.slice(-HISTORY_LIMIT);
    const claudeBerichten = recente
      .slice(0, -1)
      .map((b) => ({ role: b.role, content: b.content }));
    claudeBerichten.push({ role: "user" as const, content: gebruikersPrompt });

    // Stream het antwoord via Server-Sent Events.
    // Protocol (één JSON-object per `data:`-regel):
    //   { type: "progress", fase, status?, label?, uitkomst?, batch?, totaal? }
    //        — voortgang per bereikte serverfase (besluit 0087). `fase` ∈
    //          reformulatie | retrieval | rerank | web | analyse | generatie.
    //          status "bezig" = lopende regel; "klaar" = afgeronde regel (+ uitkomst,
    //          bv. "18 passages gevonden"). Analyse draagt batch/totaal (map-reduce).
    //          Overgeslagen fasen sturen geen event (geen schijnzekerheid). Deze
    //          events zijn VLUCHTIGE UI-STATE en worden NOOIT in het auditspoor gelogd.
    //   { type: "meta",  bronnen, modus, chunks_gevonden }  — vóór het eerste token
    //   { type: "delta", text }                              — per token
    //   { type: "done" }                                     — na het loggen
    //   { type: "error", error }                             — bij een fout (ook
    //        fouten in retrieval/promptopbouw: die draaien nu ín de stream, dus
    //        verschijnen als error-event in een 200-respons i.p.v. een HTTP-status).
    // De voorbereidingsroute (0071) kan deze eventvorm ongewijzigd overnemen.
    // De governance_log-insert gebeurt PAS na het voltooien van de stream, met
    // het volledige antwoord. Append-only blijft intact: enkel een insert, geen
    // UPDATE/DELETE. Een afgebroken stream logt geen half antwoord als definitief.
          // ── Generatiefase (besluit 0087): het antwoord wordt opgesteld. Deze
          // melding vervangt de lopende voortgangsregel tot het eerste delta-token.
          send({ type: "progress", fase: "generatie", status: "bezig", label: VOORTGANG_LABEL.generatie });
          send({
            type: "meta",
            bronnen,
            modus: effectieveModus,
            transformatie: transformatieActief,
            chunks_gevonden: chunks.length,
            // Besluit 0139 (M-R4) — de zoekvraag waarop DAADWERKELIJK is gezocht en
            // of die is herschreven. Voorheen alleen server-side in governance_log;
            // nu ook naar het onderbouwingspaneel, zodat de bestuurder zelf ziet
            // waarop gezocht is (transparantie + reproduceerbaarheid). Alleen
            // getoond bij gereformuleerd = true; anders verandert de weergave niet.
            zoekvraag: retrievalMeta?.zoekvraag ?? null,
            gereformuleerd: retrievalMeta?.gereformuleerd ?? false,
            // "Documentgericht" = de vraag ging over een specifiek stuk (strict
            // document-scope) of een agendapunt met stukken. Bepaalt in de UI welke
            // vervolgacties (duiding/kritische vragen) blijven staan naast de B1-
            // vervolgvragen. Reist mee in de onderbouwing zodat het na herladen klopt.
            document_gericht: scopeActief || agendapuntModusActief || procesModusInPrompt,
            scope: scopeActief
              ? {
                  document_ids: scopeDocumentIds,
                  titels: scopeTitels,
                  strategie: scopeStrategie,
                }
              : null,
            // M6/M8 — code-gedreven dekking; geen modeltekst en geen geschat
            // percentage. Map-reduce wordt in `done` met de echte batchuitkomst
            // geactualiseerd.
            documentdekking: vraagRoute ? documentDekking : null,
            vraagrouter: vraagRoute
              ? {
                  taak: vraagRoute.taak,
                  scope: vraagRoute.scope,
                  dekking: vraagRoute.dekking,
                  bewijsniveau: vraagRoute.bewijsniveau,
                }
              : null,
            // Besluit 0151 — de actieve module-scope voor de scope-chip en het
            // onderbouwingspaneel (onderscheiden van documentbronnen). null = geen.
            module_scope: moduleScopeMeta,
            // Increment G/I-1 — actieve antwoordmodus + label voor het paneel
            // "Onderbouwing en bronnen" (rustige weergave §11c).
            antwoordmodus,
            antwoordmodus_label: ANTWOORDMODUS_LABEL[antwoordmodus],
            retrieval_modus: retrievalFilters?.modus ?? null,
            peildatum: retrievalFilters?.peildatum ?? null,
            // Increment F (FO §14) — profielsturing-status voor het paneel
            // "Onderbouwing en bronnen". De transparantie ("ordening op uw profiel
            // afgestemd") landt deterministisch hier, niet inline in het antwoord.
            profielsturing: profielsturingStatus,
            // OP-3 (FO §8) — organisatieprofiel-status voor het onderbouwingspaneel.
            organisatieprofiel: organisatieprofielStatus,
            // OP-4 (FO §8) — veldgroepen (feiten/strategie/risicohouding) voor het
            // paneel; alleen metadata, geen profielinhoud.
            ...(organisatieprofielAspecten
              ? { organisatieprofiel_aspecten: organisatieprofielAspecten }
              : {}),
            // Increment I-1 (FO §11c) — rustige weergave: bronbasis voor het
            // onderbouwingspaneel + deterministische inline-meldingen.
            bronbasis,
            inline_meldingen: inlineMeldingenPre,
            // 30-07-2026 — aanbod om de actualiteitsfilter uit te zetten wanneer die
            // alle treffers wegnam. null = niet van toepassing.
            verbreding,
            // Increment I-2 (FO §11a) — automatische bronkeuze: de (verborgen)
            // intentie + gekozen retrieval-modus. Géén zichtbare badge in de
            // chat; uitsluitend voor het paneel "Onderbouwing en bronnen".
            bron_intent: bronIntent ?? null,
            bron_vertrouwen: bronIntentResultaat?.vertrouwen ?? null,
            bron_modus_auto: scopeActief ? null : bronModusRetrieval,
            alleen_fondsdocumenten: alleenFondsdocumenten,
            bron_intent_override: scopeActief ? false : intentOverride !== undefined,
            // Ingreep 1/2 — wie zette de intentie: de bestuurder (chip), onze eigen
            // startvraag-copy, of de module-ingang? Plus welke module.
            bron_intent_bron:
              scopeActief || intentOverride === undefined ? null : intentBron,
            bron_intent_herkomst:
              scopeActief || intentBron !== "herkomst" ? null : intentHerkomst,
            // Contextbesef (besluit 0090) — of de portaalstand is meegewogen; het
            // onderbouwingspaneel toont dit als aparte aanduiding, los van bronnen.
            portaalstand_gebruikt: portaalstandGebruikt,
            // Besluit 0137 (antwoord-eerst) — de niet-blokkerende bronkeuze. Bij
            // `antwoord_eerst` én een onzekere intentie reizen de twee keuzes mee als
            // AANBOD (geen gestelde vraag): de client rendert ze als chips ónder het
            // antwoord. null = niet van toepassing (blokkerend/uit, of geen twijfel).
            bronkeuze_aanbod: bronkeuzeAanbod
              ? { opties: VERDUIDELIJKING_OPTIES }
              : null,
            // Increment I-3 — uniform bronmodel voor het paneel "Onderbouwing en
            // bronnen". Documentbronnen zijn nu bekend; model_knowledge én de
            // (Scenario A) webbronnen hangen van de antwoordinhoud af en volgen in
            // 'done'. Pre-stream is web_retrieval_actief dus nog false; de definitieve
            // waarde + web_bronnen komen in het 'done'-event.
            sources: documentSources,
            source_summary: sourceSamenvattingPre,
            web_retrieval_actief: false,
          });

          // Map-reduce (increment 2): verwerk het document in batches (map, met
          // het goedkope model) en bouw daaruit de reduce-prompt. De maps zijn
          // niet-streambaar → we sturen progress-events; de reduce-stap streamt
          // wél token-voor-token. De interne calls vallen binnen deze ene
          // gebruikersactie en raken de WP2-rate-limit dus niet (die is bovenaan
          // de route al één keer geteld).
          // P5 signaal 3 — de TOTALE modelduur van deze beurt, dus INCLUSIEF de
          // map-reduce-lus hieronder. Die lus doet sequentiële modelaanroepen en
          // is juist de trage tak; een latencysignaal dat alleen de eindgeneratie
          // meet, telt zo'n beurt mee met een kunstmatig lage waarde en trekt de
          // p95 omlaag in precies het geval waarvoor je latencybewaking inricht.
          // `duur_ms` (verderop) houdt daarnaast de eindgeneratie apart, zodat de
          // decompositie zichtbaar blijft.
          const modelStart = Date.now();
          let mapCalls = 0;
          let mapTokensIn = 0;
          let mapTokensUit = 0;

          let streamMessages = claudeBerichten;
          if (scopeStrategie === "map_reduce") {
            const titelLabel = scopeTitels[0] ? `«${scopeTitels[0]}»` : "het document";
            type MapResultaat = {
              index: number;
              tekst: string;
              tokensIn: number;
              tokensUit: number;
              chunks: number;
              ok: boolean;
              timeout: boolean;
            };
            const resultaten: Array<MapResultaat | undefined> = new Array(
              breedBatches.length
            );
            let volgendeBatch = 0;
            const mapAbort = new AbortController();
            const mapFaseTimer = setTimeout(
              () => mapAbort.abort(),
              MAP_FASE_TIMEOUT_MS
            );
            const worker = async () => {
              for (;;) {
                const i = volgendeBatch++;
                if (i >= breedBatches.length) return;
                send({
                  type: "progress",
                  fase: "analyse",
                  label: VOORTGANG_LABEL.analyse,
                  batch: i + 1,
                  totaal: breedBatches.length,
                });
                const batchTekst = breedBatches[i]
                  .map((c) => `${locatieLabel(c)}${c.tekst}`)
                  .join("\n\n");
                mapCalls += 1;
                try {
                  const mapResp = await gateway.genereer(gatewayCtx, {
                    taaktype: "chat_mapstap",
                    systeem: SP_MAP_EXTRACTIE,
                    berichten: [
                      {
                        role: "user",
                        content: `VRAAG: ${effectieveVraag}\n\n${
                          analyseplanTekst ? `${analyseplanTekst}\n\n` : ""
                        }DOCUMENTDEEL ${i + 1}/${breedBatches.length} uit ${titelLabel}:\n\n${batchTekst}`,
                      },
                    ],
                    maxTokens: 1200,
                    temperature: 0,
                    timeoutMs: MAP_CALL_TIMEOUT_MS,
                    signal: mapAbort.signal,
                  });
                  const tekst = mapResp.tekst.trim();
                  resultaten[i] = {
                    index: i,
                    tekst,
                    tokensIn: mapResp.usage.in,
                    tokensUit: mapResp.usage.out,
                    chunks: breedBatches[i].length,
                    ok: true,
                    timeout: false,
                  };
                } catch (error) {
                  console.error(`Map-batch ${i + 1} mislukt:`, error);
                  resultaten[i] = {
                    index: i,
                    tekst: "",
                    tokensIn: 0,
                    tokensUit: 0,
                    chunks: 0,
                    ok: false,
                    timeout: mapAbort.signal.aborted,
                  };
                }
              }
            };
            try {
              await Promise.all(
                Array.from(
                  { length: Math.min(MAP_CONCURRENCY, Math.max(1, breedBatches.length)) },
                  () => worker()
                )
              );
            } finally {
              clearTimeout(mapFaseTimer);
            }

            const geslaagd = resultaten.filter(
              (r): r is MapResultaat => !!r?.ok
            );
            const mislukt = resultaten.filter((r) => r && !r.ok) as MapResultaat[];
            mapTokensIn = geslaagd.reduce((som, r) => som + r.tokensIn, 0);
            mapTokensUit = geslaagd.reduce((som, r) => som + r.tokensUit, 0);
            const deelanalyses = geslaagd
              .filter((r) => r.tekst && !/^geen$/i.test(r.tekst))
              .sort((a, b) => a.index - b.index)
              .map((r) => `— Deel ${r.index + 1}:\n${r.tekst}`);
            const afkapredenen: DekkingsAfkapreden[] = [];
            if (breedOphaalresultaat?.afkapreden) {
              afkapredenen.push(breedOphaalresultaat.afkapreden);
            }
            if (breedAfgekapt && !breedOphaalresultaat?.afkapreden) {
              afkapredenen.push("batch_cap");
            }
            if (mislukt.some((r) => r.timeout)) afkapredenen.push("batch_timeout");
            if (mislukt.some((r) => !r.timeout)) afkapredenen.push("batch_fout");
            const verwerkteChunks = geslaagd.flatMap(
              (resultaat) => breedBatches[resultaat.index] ?? []
            );
            const verwerkteLocaties = telDekkingslocaties(verwerkteChunks);
            const alleLocaties = telDekkingslocaties(breedChunks);
            const locatieTotalenBekend = breedOphaalresultaat?.volledig === true;
            documentDekking = bredeDekking({
              totaalPassages: breedOphaalresultaat?.totaal_chunks ?? null,
              verwerktePassages: geslaagd.reduce((som, r) => som + r.chunks, 0),
              totaalBatches: breedTotaalBatches,
              verwerkteBatches: geslaagd.length,
              afkapredenen,
              verwerktePaginas: verwerkteLocaties.paginas,
              totaalPaginas: locatieTotalenBekend ? alleLocaties.paginas : null,
              verwerkteSecties: verwerkteLocaties.secties,
              totaalSecties: locatieTotalenBekend ? alleLocaties.secties : null,
            });
            breedAfgekapt = !documentDekking.volledig;
            if (vraagRoute) vraagRoute = finaliseerRouteMetDekking(vraagRoute, documentDekking);
            if (retrievalMeta) {
              retrievalMeta.documentdekking = documentDekking;
              if (vraagRoute) retrievalMeta.vraagrouter = vraagRoute;
              if (retrievalMeta.scope) {
                retrievalMeta.scope.verwerkte_chunks = documentDekking.verwerkte_passages;
                retrievalMeta.scope.batches = documentDekking.verwerkte_batches ?? 0;
                retrievalMeta.scope.afgekapt = !documentDekking.volledig;
              }
            }

            const dekkingNoot = documentDekking.volledig
              ? ""
              : "\n\nDe verwerking was gedeeltelijk. Trek geen conclusie over ontbrekende inhoud in het volledige document.";
            const reducePrompt = `DEELANALYSES VAN HET DOCUMENT ${titelLabel} (${breedBatches.length} delen):\n\n${
              deelanalyses.join("\n\n") || "(geen relevante passages aangetroffen in het document)"
            }\n\n---\n\nVRAAG: ${vraagVoorPrompt}${
              analyseplanTekst ? `\n\n${analyseplanTekst}` : ""
            }\n\nStel op basis van bovenstaande deelanalyses één samenhangend antwoord op het document op. Gebruik paginaverwijzingen "(pag. X)" waar die in de deelanalyses staan.${dekkingNoot}`;

            streamMessages = [{ role: "user" as const, content: reducePrompt }];
          }

          let volledig = "";
          // Duiding/sparring leveren langere, gestructureerde antwoorden → ruimer
          // budget (zoals de env-vlag BESTUURLIJKE_STIJL al deed).
          const ruimBudget =
            BESTUURLIJKE_STIJL || antwoordmodus === "duiding" || antwoordmodus === "sparring";

          // B1 — vraag het model om inline vervolgvragen, behalve bij een
          // transformatie-actie (die herschrijft juist het vorige antwoord; daar
          // horen geen nieuwe vervolgvragen bij, dat zou de keten laten uitdijen).
          //
          // ⚠ B-opt tranche 2f/3b: óók NIET tijdens een reflectiebeurt. Anders
          // krijgt het model de ###VERVOLGVRAGEN###-marker-instructie, en die tail
          // (a) lekt rauw naar de gebruiker in het gebufferde verdiepingspad — dat
          // pad kent het stream-markervangnet niet — of (b) laat de gevalideerde
          // adaptieve vraag stil terugvallen op de deterministische vraag. Reflectie
          // toont per ontwerp geen inhoudelijke vervolgvragen (ANTWOORDPAD §4);
          // beide clients rekenen daar expliciet op.
          const metVervolgvragen = !transformatieActief && !reflectieActief;
          // Scenario A — voeg het webbronnen-instructieblok toe wanneer de
          // web_search-tool voor dit antwoord is ingeschakeld (injection-sandboxing,
          // weging, citatieplicht, geen PII in de zoekopdracht).
          const webBlok = webTool
            ? [{ type: "text" as const, text: SP_WEB_REGELS }]
            : [];
          const streamSysteem = [
            ...systeemBlokken,
            ...webBlok,
            ...(scopeActief && !transformatieActief && !reflectieActief
              ? [
                  {
                    type: "text" as const,
                    text: dekkingsInstructie(documentDekking),
                  },
                ]
              : []),
            ...(metVervolgvragen
              ? [{ type: "text" as const, text: VERVOLGVRAGEN_INSTRUCTIE }]
              : []),
          ];

          // #311 — eindgeneratie via de AI-gateway (taaktype chat_generatie,
          // taakgroep generatie). Provider/model komen uit de fondsconfiguratie;
          // de poort draait vlak vóór de call; usage/stopreden komen genormaliseerd
          // terug. De web_search-servertool gaat als neutrale tool mee.
          // P5 signaal 3: duur van de generatie, gemeten vanaf de aanroep tot en
          // met afronden(), dus inclusief wachttijd bij de provider.
          const generatieStart = Date.now();
          const claudeStream = await gateway.stream(gatewayCtx, {
            taaktype: "chat_generatie",
            systeem: streamSysteem,
            berichten: streamMessages,
            maxTokens: ruimBudget ? MAX_TOKENS_BESTUURLIJK : MAX_TOKENS,
            ...(webTool ? { tools: [webTool] } : {}),
            ...(scopeStrategie === "targeted"
              ? {}
              : { timeoutMs: VOLLEDIGE_ANALYSE_GENERATIE_TIMEOUT_MS }),
          });

          // Besluit 0151 (criterium 11) — tijd tot eerste zichtbare token (TTFT).
          // Gemeten vanaf de generatie-aanroep tot het eerste delta; per module-
          // scope-soort te vergelijken met een beurt zónder scope.
          let ttftMs: number | null = null;

          // Stream de zichtbare tekst, maar houd steeds een staart ter grootte van
          // de marker achter: zo lekt "###VERVOLGVRAGEN###" nooit naar de client,
          // ook niet als de marker over twee deltas heen arriveert. Zodra de marker
          // opduikt, sturen we tot dáár en daarna niets meer.
          let verzonden = 0;
          let markerGezien = false;
          claudeStream.onTekst((delta) => {
            if (ttftMs === null) ttftMs = Date.now() - generatieStart;
            volledig += delta;
            // B-opt tranche 3b — de verdiepingsvraag wordt niet gestreamd: accumuleer
            // alleen, valideer straks ná finalMessage en toon dan in één keer.
            if (bufferReflectievraag) return;
            if (markerGezien) return;
            const idx = volledig.indexOf(VERVOLGVRAGEN_MARKER);
            if (idx !== -1) {
              if (idx > verzonden) send({ type: "delta", text: volledig.slice(verzonden, idx) });
              verzonden = idx;
              markerGezien = true;
              return;
            }
            const veiligeGrens = Math.max(
              verzonden,
              volledig.length - VERVOLGVRAGEN_MARKER.length
            );
            if (veiligeGrens > verzonden) {
              send({ type: "delta", text: volledig.slice(verzonden, veiligeGrens) });
              verzonden = veiligeGrens;
            }
          });

          const finaleMsg = await claudeStream.afronden();
          const generatieDuurMs = Date.now() - generatieStart;

          if (bufferReflectievraag) {
            // ── B-opt tranche 3b — genereren → valideren → tonen (guardrail 6) ──
            // `volledig` is compleet maar er is nog niets verzonden. Valideer tegen
            // de vormeisen (AC-R1 t/m R7); faalt de vraag, dan de DETERMINISTISCHE
            // terugval per ingang (guardrail 5). De richting zelf verlaat de server
            // nooit (guardrail 2): we bufferen alleen de zichtbare vraag.
            const bevrorenBronNummers =
              reflectieBronsetChunkIds.length > 0
                ? Array.from({ length: chunks.length }, (_, k) => k + 1)
                : [];
            // Defensief: knip een eventuele ###VERVOLGVRAGEN###-tail weg vóór de
            // validatie en het tonen. Met de reflectie-uitsluiting hierboven mag
            // die marker niet meer voorkomen; dit voorkomt dat hij ooit rauw naar
            // de bestuurder lekt of de vraag onterecht doet terugvallen.
            const kandidaat = volledig.split(VERVOLGVRAGEN_MARKER)[0].trim();
            const uitkomst = valideerVerdiepingsvraag(kandidaat, {
              bevrorenBronNummers,
              samenstellingMeegegeven: reflectieSamenstelling !== null,
            });
            const terugvalVraag = reflectieTegenperspectief
              ? tegenperspectiefVraag(reflectieIngang ?? "twijfel")
              : standaardVraag(reflectieIngang ?? "twijfel");
            const definitief =
              uitkomst.ok && kandidaat.length > 0 ? kandidaat : terugvalVraag;
            if (!uitkomst.ok) {
              console.warn(
                "Reflectie-verdiepingsvraag afgekeurd, deterministische terugval:",
                uitkomst.reden
              );
            }
            volledig = definitief;
            send({ type: "delta", text: definitief });
            verzonden = definitief.length;
          } else if (!markerGezien && verzonden < volledig.length) {
            // Flush de resterende zichtbare staart als de marker nooit kwam.
            send({ type: "delta", text: volledig.slice(verzonden) });
            verzonden = volledig.length;
          }

          // Splits het zichtbare antwoord van de vervolgvragen. Alles hierná werkt
          // op het ZICHTBARE antwoord (citaties, markers, model_knowledge, logging).
          const { zichtbaar: zichtbaarAntwoord, vervolgvragen } =
            splitsVervolgvragen(volledig);

          // Bronvermelding-validatie: tel [Bron N]-citaties en hoeveel daarvan
          // buiten het bereik van de aangeleverde bronnen vallen (dangling).
          // Audit-signaal: zo is in de log zichtbaar wanneer het model een
          // niet-bestaande bron aanhaalde.
          if (retrievalMeta) {
            const citatieMatches = zichtbaarAntwoord.match(/\[Bron (\d+)\]/gi) || [];
            let ongeldig = 0;
            for (const m of citatieMatches) {
              const n = parseInt(/\d+/.exec(m)![0], 10);
              if (n < 1 || n > bronnen.length) ongeldig++;
            }
            retrievalMeta = {
              ...retrievalMeta,
              citaties: { totaal: citatieMatches.length, ongeldig },
            };
          }

          // Increment I-1 (FO §11c) — herbereken de inline-meldingen mét de
          // antwoordinhoud: tel [Algemene kennis]/[Volgens wetgeving]-markeringen
          // zodat de #4-melding (algemene kennis náást fondsdocumenten) verschijnt.
          const algemeneKennisMarkers = (
            zichtbaarAntwoord.match(/\[(?:Algemene kennis|Volgens wetgeving)\]/gi) || []
          ).length;
          const inlineMeldingenFinaal = metNietVastgesteldeMelding(
            bepaalInlineMeldingen({
              bronModus: bronModusRetrieval,
              antwoordmodus,
              aantalBronnen: bronnen.length,
              scopeActief,
              algemeneKennisMarkers,
            })
          );

          // Afkap-signaal: raakt het antwoord het max_tokens-plafond, dan tonen we
          // dat expliciet i.p.v. het stil af te kappen (relevant sinds de Opus-
          // overstap, besluit 0067). De gebruiker kan dan om een vervolg vragen.
          if (finaleMsg.stopReden === "max_tokens") {
            inlineMeldingenFinaal.push(AFGEKAPT_MELDING);
          }

          // Increment I-3 — leid nu (mét de antwoordinhoud) de model_knowledge-
          // bronnen af: één per door het antwoord GENOEMDE instantie per
          // markertype. Verzint nooit een instantie die niet in de tekst staat.
          // Bij scope of pure documentmodus levert dit niets (geen algemene kennis).
          const modelKennisSources = scopeActief
            ? []
            : modelKennisBronnenUitAntwoord(zichtbaarAntwoord);

          // Scenario A (besluit 0072) — leid de webbronnen af uit het afgeronde
          // antwoord: lees de door de tool geciteerde bronnen en HERVERIFIEER elke
          // URL tegen de whitelist (matchWhitelist, dwingt matchtype/padprefix af,
          // koppelt normgewicht). Niet-whitelist/onveilige citaties vallen af
          // (FR-1 / anti-fabricage). web_retrieval_actief = alleen true bij ≥1
          // geverifieerde webbron. Bij een uitgeschakelde tool: no-op + gelogde reden.
          let webBronnen: AssistantSourceWeb[] = [];
          let webAudit: RetrievalMeta["web"];
          if (webTool) {
            const ophaaltijdstip = new Date().toISOString();
            const webRes = extractWebResultaten(finaleMsg.inhoud);
            webBronnen = bouwWebbronnen(webRes.geciteerd, whitelistEntries, ophaaltijdstip);
            webAudit = {
              ingezet: true,
              ophaaltijdstip,
              bevraagde_domeinen: bevraagdeDomeinen(webRes.bevraagd),
              aantal_geciteerd: webRes.geciteerd.length,
              aantal_gebruikt: webBronnen.length,
              foutcode: webRes.foutcode,
              // Fallback-status (FR-7): niets bruikbaars opgehaald → terugval op RAG/kennis.
              fallback: webBronnen.length === 0,
              gebruikte_bronnen: webBronnen.map((w) => ({
                url: w.url,
                domein: w.domein,
                normgewicht: w.normgewicht ?? null,
              })),
            };
          } else {
            // Web niet ingezet: leg de deterministische reden vast (FR-8/FR-9).
            webAudit = {
              ingezet: false,
              reden: webGate.reden,
              ...(webGate.reden === "pii_geblokkeerd"
                ? { pii_soorten: piiUitkomst.soorten }
                : {}),
            };
          }
          const webRetrievalActief = webBronnen.length > 0;

          const alleSources: AssistantSource[] = [
            ...documentSources,
            ...modelKennisSources,
            ...webBronnen,
          ];
          const sourceSamenvatting = bouwSourceSamenvatting(alleSources, webRetrievalActief);
          // Markeer-handhaving (audit-signaal, geen blokkade): in pure algemeen-
          // modus hoort minstens één algemene-kennismarker te staan. Ontbreekt die,
          // dan is de herkomst-transparantie incompleet → zichtbaar in het auditspoor.
          const markeringOntbreekt = ontbrekendeAlgemeneKennisMarkering(
            scopeActief ? "documenten" : bronModusRetrieval,
            algemeneKennisMarkers
          );

          // M6/M7 — finaliseer ná eventuele mapfouten en beslis daarna pas of de
          // bewuste opschaling mag worden aangeboden. Het auditspoor legt vast dát
          // het aanbod is getoond; het done-event vult er na de insert het log-id bij.
          if (vraagRoute) vraagRoute = finaliseerRouteMetDekking(vraagRoute, documentDekking);
          const volledigeAnalyseWordtAangeboden =
            !!vraagRoute &&
            !volledigeAnalyseUitgevoerd &&
            magVolledigeAnalyseAanbieden({
              route: vraagRoute,
              dekking: documentDekking,
              documentIds: scopeDocumentIds ?? [],
              totaalPassages: totaalPassagesVoorAanbod,
              maximaalPassages: Math.min(
                VOLLEDIGE_DOCUMENT_CHUNK_CAP,
                MAX_VOLLEDIGE_ANALYSE_PASSAGES
              ),
              actief: vraagrouterVlaggen.volledigeAnalyseVervolg,
            });
          if (retrievalMeta && vraagRoute) {
            retrievalMeta.vraagrouter = vraagRoute;
            retrievalMeta.documentdekking = documentDekking;
            retrievalMeta.volledige_analyse = {
              aangeboden: volledigeAnalyseWordtAangeboden,
              uitgevoerd: volledigeAnalyseUitgevoerd,
              ...(volledigeAnalyseVorigeLogId
                ? { vorige_log_id: volledigeAnalyseVorigeLogId }
                : {}),
              ...(volledigeAnalyseDocumentId
                ? { document_id: volledigeAnalyseDocumentId }
                : {}),
            };
          }

          // Increment G/I-1 — de actieve antwoordmodus, bronbasis en getoonde
          // inline-meldingen horen altijd in het auditspoor (B10, §11d), óók in
          // modus 'algemeen' (geen retrieval → nog geen retrievalMeta).
          const teLoggenMeta: RetrievalMeta = {
            ...(retrievalMeta ?? {
              methode: "geen",
              opgehaald: 0,
              geselecteerd: 0,
              chunks: [],
            }),
            ...(vraagRoute
              ? {
                  vraagrouter: vraagRoute,
                  ...(vraagrouterUitvoering
                    ? { vraagrouter_uitvoering: vraagrouterUitvoering }
                    : {}),
                  ...(analyseplanMeta ? { analyseplan: analyseplanMeta } : {}),
                  documentdekking: documentDekking,
                  volledige_analyse: {
                    aangeboden: volledigeAnalyseWordtAangeboden,
                    uitgevoerd: volledigeAnalyseUitgevoerd,
                    ...(volledigeAnalyseVorigeLogId
                      ? { vorige_log_id: volledigeAnalyseVorigeLogId }
                      : {}),
                    ...(volledigeAnalyseDocumentId
                      ? { document_id: volledigeAnalyseDocumentId }
                      : {}),
                  },
                }
              : {}),
            antwoordmodus,
            transformatie: transformatieActief,
            // Besluit 0151 — module-scope in het auditspoor: soort + sleutel +
            // gebruikte bron-ids + validatiestatus, zodat de beurt reconstrueerbaar
            // is (criterium 8). `ttft_ms` = tijd tot eerste token (criterium 11).
            ...(moduleScopeMeta ? { module_scope: moduleScopeMeta } : {}),
            ...(ttftMs !== null ? { ttft_ms: ttftMs } : {}),
            // H-12/H-10 — invoer- en promptprovenance (zie RetrievalMeta).
            invoer: {
              beurten: messages.length,
              tekens: invoer.tekens,
              historie_hash: invoer.historieHash,
              // Plateau 1 — contextresolver. `context` is telemetrie (basis:
              // modus/relatie/vertrouwen/methode/meetmetadata, geen vraagtekst).
              // `context_kandidaat_vraag` is de door de resolver voorgestelde vraag
              // en is verwijderbare inhoud (audit-meta SUB_NIVEAUS.invoer). In
              // observe blijft dit zichtbaar zonder dat het downstream iets stuurt;
              // de effectieve zoekvraag zelf staat (in enforce) al in `zoekvraag`.
              ...(vraagContext
                ? { context: contextTelemetrie(vraagContext, contextModus) }
                : {}),
              ...(vraagContext &&
              vraagContext.kandidaatVraag.trim() !== vraag.trim()
                ? { context_kandidaat_vraag: vraagContext.kandidaatVraag }
                : {}),
            },
            ...(contextGeneutraliseerd > 0
              ? { context_geneutraliseerd: contextGeneutraliseerd }
              : {}),
            // P2 Deel B (B6/criterium 13) — de zichtbare beurt is korter dan de
            // instructie; leg de parameters vast zodat het antwoord reconstrueerbaar
            // is. Geen nieuw event-type; meelift in retrieval_meta.
            ...(doorgrondActief
              ? {
                  doorgrond: {
                    secties: doorgrondSecties,
                    document_ids: scopeDocumentIds ?? [],
                    vorige_document_id: doorgrondVorigeId,
                    promptvariant: DOORGROND_PROMPTVARIANT,
                  },
                }
              : {}),
            // T2 (FR-12, ontwerp §6.4) — de bureau-stand reconstrueerbaar: de
            // zichtbare beurt is korter dan de instructie. Geclassificeerd als
            // `bron` in audit-meta.ts (taak-/sectie-identiteit, geen tekst).
            ...(stukActief && stukSoort
              ? {
                  bureau: {
                    taak: "stukvoorbereiding" as const,
                    stuksoort: stukSoort,
                    secties: [
                      ...(stuksoortDef(stukSoort)?.secties ?? []),
                      SLOTSECTIE,
                    ],
                    // T5 B1: bronloos concept-skelet (variant iii) heeft geen
                    // fondsbron; leg dat vast zodat de log het onderscheid draagt.
                    bronbereik: bronloosBureau ? ([] as const) : (["fonds"] as const),
                    bron_aanwezig: !bronloosBureau,
                    promptvariant: STUK_PROMPTVARIANT,
                    rol_context: "bestuursbureau" as const,
                  },
                }
              : {}),
            // 30-07-2026 — hoeveel niet-vastgestelde fondsstukken zijn door de
            // actualiteitsfilter buiten dit antwoord gebleven, en heeft de gebruiker
            // ze deze beurt expliciet meegenomen? Zonder dit veld is achteraf niet
            // te verantwoorden dat er stukken waren die het antwoord niet haalden.
            ...(nietVastgesteld || neemNietVastgesteldeMee
              ? {
                  niet_vastgesteld: {
                    documenten: nietVastgesteld?.documenten ?? 0,
                    chunks: nietVastgesteld?.chunks ?? 0,
                    meegenomen: neemNietVastgesteldeMee,
                  },
                }
              : {}),
            // P2 Deel A — telemetrie: kwam de beurt uit een aangeklikte voorbeeldvraag?
            ...(body.startvraag_bron === "voorbeeldvraag"
              ? { startvraag_bron: body.startvraag_bron }
              : {}),
            // ADR 0028 — herkomst van de framing: legt in het auditspoor vast dat
            // de vraag door de toelichting van dit agendapunt is geframed.
            ...(agendapuntModusActief
              ? { herkomst: herkomstString(agendapuntSeed!.id) }
              : {}),
            bronbasis,
            inline_meldingen: inlineMeldingenFinaal,
            // Increment I-3 — uniform bronmodel volledig in het auditspoor: alle
            // herkomst (document + model_knowledge) + telling + de markeer-handhaving.
            sources: alleSources,
            source_summary: sourceSamenvatting,
            // Scenario A (FR-8) — retrieval-provenance van de web-tak: ingezet ja/nee
            // (+ reden), bevraagde domeinen, gebruikte webbronnen met normgewicht,
            // ophaaltijdstip, fallback-status. Geen tweede logmechanisme: dit reist
            // mee in het bestaande append-only governance_log.retrieval_meta.
            web: webAudit,
            markeringen: {
              algemene_kennis_markers: algemeneKennisMarkers,
              instanties: modelKennisSources
                .map((s) => s.instantie)
                .filter((i): i is string => i !== null),
              ontbrekend_signaal: markeringOntbreekt,
            },
            // Increment F (FO §14, B10/§11d) — profielsturing volledig herleidbaar:
            // status + welke profielvelden de prioritering voedden. Geen profielinhoud.
            profielsturing: profielsturingStatus,
            ...(profielsturingAspecten
              ? { profielsturing_aspecten: profielsturingAspecten }
              : {}),
            // OP-3 (FO §8) — organisatieprofiel volledig herleidbaar: status +
            // welke veldgroepen zijn geïnjecteerd (geen profielinhoud).
            organisatieprofiel: organisatieprofielStatus,
            ...(organisatieprofielAspecten
              ? { organisatieprofiel_aspecten: organisatieprofielAspecten }
              : {}),
            // Increment I-2 (FO §11a/§11d) — automatische bronkeuze in het
            // auditspoor: welke intentie, met welk vertrouwen, welke (verborgen)
            // retrieval-modus, en of de gebruiker tot fondsdocumenten beperkte.
            ...(scopeActief
              ? {}
              : {
                  bron_intent: bronIntent,
                  bron_vertrouwen: bronIntentResultaat?.vertrouwen,
                  bron_modus_auto: bronModusRetrieval,
                  alleen_fondsdocumenten: alleenFondsdocumenten,
                  bron_intent_override: intentOverride !== undefined,
                  // Ingreep 1/2 — herkomst van de override (chip | startvraag |
                  // herkomst) + de moduleslug bij een module-ingang. Alleen gezet
                  // als er daadwerkelijk een override was.
                  ...(intentOverride !== undefined && intentBron
                    ? {
                        bron_intent_bron: intentBron,
                        ...(intentBron === "herkomst" && intentHerkomst
                          ? { bron_intent_herkomst: intentHerkomst }
                          : {}),
                      }
                    : {}),
                  // Contextbesef (besluit 0090) — herleidbaar of de portaalstand meeging.
                  portaalstand_gebruikt: portaalstandGebruikt,
                  // Besluit 0137 (antwoord-eerst) — twee markers, additief in het
                  // BESTAANDE jsonb-veld (geen migratie, geen RPC-wijziging):
                  //  (a) bronkeuze_aanbod = dit fondsgerichte antwoord droeg de
                  //      niet-blokkerende chips (de bestuurder kón corrigeren);
                  //  (b) bronkeuze_herzien + _vorige_log_id = dit antwoord is de
                  //      hergeneratie ná een chipklik; de verwijzing maakt navolgbaar
                  //      wélke van de twee antwoorden bedoeld is en in welke volgorde
                  //      ze zijn getoond (M-B5). Beide regels blijven append-only staan.
                  ...(bronkeuzeAanbod ? { bronkeuze_aanbod: true } : {}),
                  ...(bronkeuzeVorigeLogId
                    ? {
                        bronkeuze_herzien: true,
                        bronkeuze_vorige_log_id: bronkeuzeVorigeLogId,
                      }
                    : {}),
                }),
            // P5 — operationele telemetrie voor signaal 3 (latency p95) en
            // signaal 6 (tokenverbruik per fonds). Sleutels in het BESTAANDE
            // jsonb-veld: geen migratie, geen extra logregel, geen tweede insert.
            // Het auditspoor blijft dus onveranderd van vorm.
            //
            // WAT DEZE GETALLEN WEL EN NIET DEKKEN — signaal 3 draait op
            // `duur_model_ms`, niet op `duur_ms`. `duur_ms` meet alleen de
            // eindgeneratie; bij een map-reduce-beurt staat de trage sequentiële
            // map-lus dáár volledig buiten, waardoor een 45-secondenbeurt als een
            // paar seconden zou meetellen en de p95 juist omlaag zou trekken.
            // `duur_model_ms` omvat de map-lus wél. Buiten beide vallen nog steeds:
            // retrieval, query-reformulatie en de reranker — het is modeltijd,
            // geen doorlooptijd van de beurt.
            //
            // `tokens` is de som van de eindgeneratie EN de map-lus, inclusief
            // cache-tokens (zonder `cache_read`/`cache_creation` is `input_tokens`
            // geen verbruik maar een restpost). Nog steeds NIET meegeteld: de
            // reranker, query-reformulatie, server-side web_search, en de AI-routes
            // buiten de assistentchat (voorbereiding, besluit-concept) die
            // überhaupt niet in governance_log landen. Ondergrens dus, en zo
            // gelabeld — een onvolledig getal dat als volledig wordt gepresenteerd
            // is schijnzekerheid.
            duur_ms: generatieDuurMs,
            duur_model_ms: Date.now() - modelStart,
            tokens: {
              in:
                finaleMsg.usage.in +
                finaleMsg.usage.cacheCreatie +
                finaleMsg.usage.cacheLezen +
                mapTokensIn,
              out: finaleMsg.usage.out + mapTokensUit,
            },
            tokendekking: {
              map_calls: mapCalls,
              bevat_reranker: false,
              bevat_query_reformulatie: false,
              bevat_web_search: false,
            },
            // #311 — de effectieve gateway-configuratie van deze eindgeneratie.
            gateway: {
              provider: finaleMsg.provider,
              model: finaleMsg.model,
              profiel_id: finaleMsg.profielId,
              config_versie: finaleMsg.configVersie,
            },
          };

          // Loggen ná voltooiing, met het volledige antwoord.
          //
          // Plateau A — spoor en inhoud in één transactie. `splitsRetrievalMeta`
          // haalt de inhoudsdragende sleutels uit de metadata: `zoekvraag` is de
          // vraag van de gebruiker, `sources[].fragment` is letterlijke
          // documenttekst. Zonder die splitsing zou de vraag gewoon in het
          // append-only spoor blijven staan en is het verplaatsen van de
          // kolommen cosmetisch. `onbekend` blijft hier bewust ongebruikt: een
          // niet-geclassificeerd veld valt fail-closed naar de inhoud én laat
          // core/lib/audit-meta.sanity.ts falen — dat is de plek om het te zien,
          // niet een console.warn in het hete pad.
          const { spoor: meta_spoor, inhoud: meta_inhoud } =
            splitsRetrievalMeta(teLoggenMeta);
          const zegel = bouwInhoudZegel(vraag, zichtbaarAntwoord);

          const { data: logId, error: logFout } = await supabase.rpc("schrijf_ai_interactie", {
            p_vraag: vraag,
            p_antwoord: zichtbaarAntwoord,
            p_bronnen: bronnen,
            p_modus: effectieveModus,
            p_model: finaleMsg.model,
            p_retrieval_meta: meta_spoor,
            p_retrieval_meta_inhoud: meta_inhoud,
            p_gesprek_audit_id: gesprekAuditId,
            p_inhoud_hmac: zegel?.inhoud_hmac ?? null,
            p_hmac_schema_versie: zegel?.hmac_schema_versie ?? null,
            p_hmac_sleutel_versie: zegel?.hmac_sleutel_versie ?? null,
          });
          // Ongewijzigd gedrag: een mislukte logregel valt in de outer catch en
          // levert de client {type:"error"} in plaats van {type:"done"}. Het
          // auditspoor is geen bijzaak die stil mag mislukken.
          if (logFout) throw logFout;

          // AI-begrenzing (besluit 0180): de actie is afgerond. Het VERBRUIK
          // verandert hier niet — dat is bij de reservering geboekt en blijft
          // staan. Alleen de levenscyclus sluit, met een verwijzing naar de
          // governance_log-regel zodat een herhaald verzoek met dezelfde
          // idempotentiesleutel het bestaande antwoord kan terugvinden.
          await rondAf(
            supabase,
            aiActieId,
            "voltooid",
            logId ? `governance_log:${logId}` : null
          );

          // ── T2 (#304) — de voorbereiding als bewaard product ──────────────
          // Server-side, uit dezelfde bron als het antwoord en het auditspoor:
          // zou de client dit schrijven, dan konden de kaart en de governance log
          // uiteenlopen zonder dat iets dat opmerkt.
          //
          // FAALT DIT, DAN SLAAGT DE BEURT TOCH. De bestuurder heeft zijn tekst
          // al gezien; hem alsnog een fout tonen zou hem iets afnemen dat er is.
          // De fout gaat naar de serverlog én als inline-melding mee, zodat hij
          // weet dat de kaart de uitkomst niet bewaart — stil falen zou hem laten
          // denken dat het punt is voorbereid.
          if (antwoordmodus === "persoonlijke_voorbereiding" && agendapuntSeed) {
            try {
              const product = bouwVoorbereidingProduct({
                tekst: zichtbaarAntwoord,
                bronnen,
                governanceLogId: (logId as string | null) ?? null,
                gesprekId: gesprekAuditId,
                nu: new Date().toISOString(),
              });
              // Upsert op de unique-constraint (agendapunt_id, gebruiker_id):
              // opnieuw opstellen overschrijft, er ontstaan geen versies.
              // Alleen de vier kolommen die dit pad BEZIT gaan mee — PostgREST
              // zet bij een conflict uitsluitend de meegestuurde kolommen, dus
              // `eigen_notities` en `vrije_notities` van de notities-route
              // blijven staan. Dat is geen aanname: het is gepind in
              // tests/cross-tenant/voorbereiding-product.test.ts.
              const { error: productFout } = await supabase
                .from("voorbereidingen")
                .upsert(
                  {
                    agendapunt_id: agendapuntSeed.id,
                    gebruiker_id: ctx.gebruikerId,
                    ai_output: product.ai_output,
                    bronnen_meta: product.bronnen_meta,
                    gegenereerd_op: product.ai_output.opgesteld_op,
                    bijgewerkt_op: product.ai_output.opgesteld_op,
                  },
                  { onConflict: "agendapunt_id,gebruiker_id" }
                );
              if (productFout) throw productFout;
            } catch (productFout) {
              console.error(
                `Voorbereiding bewaren mislukt (agendapunt ${agendapuntSeed.id}):`,
                productFout
              );
              // Ná het schrijven van de auditregel, dus deze melding staat niet
              // in `retrieval_meta`. Terecht: het auditspoor beschrijft de
              // AI-interactie, niet een opslagfout erná. Die hoort in de
              // serverlog (hierboven) en op het scherm (hier).
              inlineMeldingenFinaal.push({
                type: "onvoldoende_basis",
                tekst:
                  "Uw voorbereiding is opgesteld, maar kon niet bij het agendapunt worden bewaard. De tekst staat wel in dit gesprek.",
              });
            }
          }

          // ── Plateau B — de flow naar de conceptweergave brengen ───────────
          // De beurt hierboven TOONDE het concept; de status moet dat nu ook
          // zeggen, anders wordt een klik op "Klopt" (actie `afronden`) door de
          // RPC geweigerd. Bewust PAS hier: de status volgt wat er werkelijk is
          // gebeurd, niet wat er zou gaan gebeuren. Mislukt dit, dan blijft de
          // flow op de verdiepingsstatus staan en kan de gebruiker de reflectie
          // afbreken — geen verlies, wel zichtbaar in de serverlog.
          //
          // B-opt tranche 2c: dit gebeurt ná ELK reflectieantwoord (de beurt die
          // zojuist het concept toonde was een `antwoord`), niet meer alleen bij
          // het bereikte beurtplafond. `verdiepen`/`herformuleren` transiteren
          // hier niet: die tonen respectievelijk een verdiepingsvraag of blijven
          // al in de conceptweergave.
          if (
            gesprekAuditId &&
            reflectieActie === "antwoord" &&
            isReflectieActief(reflectieStatus) &&
            reflectieStatus !== "conceptweergave"
          ) {
            const { data: naConcept, error: conceptFout } = await supabase.rpc(
              "reflectie_transitie",
              {
                p_gesprek_id: gesprekAuditId,
                p_actie: "concept",
                p_ingang: null,
                p_bronset_log_id: null,
              }
            );
            if (conceptFout) {
              console.error("Overgang naar conceptweergave mislukt:", conceptFout.message);
            } else if (naConcept) {
              const rij = naConcept as { status?: string; beurt?: number };
              if (rij.status) reflectieStatus = rij.status as ReflectieStatus;
              if (typeof rij.beurt === "number") reflectieBeurt = rij.beurt;
            }
          }

          // Stuur de definitieve inline-meldingen mee zodat de UI de #4-melding
          // (content-afhankelijk) kan tonen ná het streamen.
          send({
            type: "done",
            inline_meldingen: inlineMeldingenFinaal,
            verbreding,
            documentdekking: vraagRoute ? documentDekking : null,
            vraagrouter: vraagRoute
              ? {
                  taak: vraagRoute.taak,
                  scope: vraagRoute.scope,
                  dekking: vraagRoute.dekking,
                  bewijsniveau: vraagRoute.bewijsniveau,
                }
              : null,
            volledige_analyse_aanbod:
              volledigeAnalyseWordtAangeboden && logId && scopeDocumentIds?.[0]
                ? {
                    origineel_log_id: logId,
                    document_id: scopeDocumentIds[0],
                    document_titel: scopeTitels[0] ?? "het document",
                    originele_vraag: vraag,
                    label: "Volledige analyse uitvoeren",
                  }
                : null,
            // Increment I-3 — de content-afhankelijke model_knowledge-bronnen +
            // bijgewerkte samenvatting voor het paneel "Onderbouwing en bronnen".
            model_kennis: modelKennisSources,
            source_summary: sourceSamenvatting,
            // Scenario A (besluit 0072) — geverifieerde webbronnen + vlag voor het
            // onderbouwingspaneel (URL + titel + ophaaldatum + normgewicht-badge).
            web_retrieval_actief: webRetrievalActief,
            web_bronnen: webBronnen,
            // B1 — inhoudelijke vervolgvragen op basis van het antwoord (kunnen
            // leeg zijn). De UI toont ze als klikbare chips ná de onderbouwing.
            vervolgvragen,
            // ── Plateau B ──────────────────────────────────────────────────
            // Het id van de zojuist geschreven auditregel. De client bewaart het
            // bij het antwoord en geeft het terug als `bronset_log_id` wanneer de
            // gebruiker op dít antwoord gaat reflecteren; de RPC bevriest dan de
            // bronset. Het is de eigen regel van de auteur — dezelfde afweging
            // als bij `gesprek_audit_id` — en geeft geen toegang tot inhoud:
            // `reflectie_transitie` accepteert alleen een regel van dezelfde
            // gebruiker én hetzelfde gesprek.
            log_id: logId ?? null,
            // De server-controlled flowstatus. De client conditioneert hierop
            // G1 (vervolgacties) en de weergave; hij bepaalt hem nooit zelf.
            reflectie: {
              status: reflectieStatus,
              beurt: reflectieBeurt,
              heeft_bronset: reflectieBronsetChunkIds.length > 0,
            },
          });
        } catch (streamFout) {
          console.error("Chat stream fout:", streamFout);
          send({
            type: "error",
            error: "Er is een fout opgetreden bij het verwerken van uw vraag.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API fout:", error);
    return NextResponse.json(
      { error: "Er is een fout opgetreden bij het verwerken van uw vraag." },
      { status: 500 }
    );
  }
});
