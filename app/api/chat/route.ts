import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { zoekRelevanteChunksMetMeta, telNietActueleFondstreffers, maakContext, maakBronSentinel, haalDocumentChunks, haalBevrorenChunks, verrijkNotulenChunks, verrijkDocumentmetadata, type DocumentChunk, type BronVerwijzing, type RetrievalMeta, type RetrievalFilters } from "@/core/lib/rag";
// Plateau B — de reflectieflow. `isActief` heet hier `isReflectieActief` omdat
// `actief` in deze route al een half dozijn andere betekenissen heeft.
import { effectieveStatus, isActief as isReflectieActief, isReflectieIngang, type ReflectieStatus, type ReflectieActie, type ReflectieIngang } from "@/core/lib/reflectie-flow";
import { valideerVerdiepingsvraag, standaardVraag, tegenperspectiefVraag } from "@/core/lib/reflectie-richtingen";
import { bepaalBronset } from "@/core/lib/bronset";
import { heeftReformulatieNodig, reformuleerVraag } from "@/core/lib/query-reformulatie";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { valideerChatInvoer } from "@/core/lib/chat-invoer";
import { rateLimited } from "@/core/lib/api-errors";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { hybrideZoekenAan, retrievalVlaggenVoorFonds, bronkeuzeModusVoorFonds } from "@/core/lib/fonds-config";
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
import { beoordeelWebGate, buildWebSearchTool, extractWebResultaten, bouwWebbronnen, bevraagdeDomeinen } from "@/core/lib/web-retrieval";
import { bevatPersoonsgegevens } from "@/core/lib/pii-gate";
import { bouwProfielsturing, type ProfielsturingAspecten } from "@/core/lib/profielsturing";
import { bouwOrganisatieprofiel, bouwRegimeKaderBlok } from "@/core/lib/organisatieprofiel";
import { SP_AGENDAPUNT_REGELS, bouwToelichtingBlok, herkomstString, type AgendapuntSeed } from "@/core/lib/agendapunt-context";
import { splitsRetrievalMeta } from "@/core/lib/audit-meta";
import { bouwInhoudZegel } from "@/core/lib/audit-hmac";
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
  SP_DOCUMENT_SCOPE_REGELS,
  SP_DOCUMENT_SCOPE_BREED_REGELS,
  SP_DOCUMENT_SCOPE_ALG_REGELS,
  SP_TRANSFORMATIE_REGELS,
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Centrale instellingen voor de RETRIEVAL-voorbewerking. De answer-generation-
// constanten (AI_MODEL, MAX_TOKENS, MAX_TOKENS_BESTUURLIJK, BESTUURLIJKE_STIJL)
// leven in lib/generatie-kern.ts en worden hierboven geïmporteerd — één gedeelde
// kern voor route én Lab.
const CHUNK_BUDGET = 10;
// History-aware query-reformulatie (Fase B1). Bewust op het sterke model: de
// rewrite bepaalt wat de retrieval ophaalt, dus fouten hier (bv. dubbelzinnige
// afkortingen verkeerd expanderen) vergiftigen álle downstream-resultaten. De
// meerkosten zijn klein (één korte call), de hefboom op antwoordkwaliteit groot.
const REWRITE_MODEL = "claude-sonnet-4-6";

// ── Document-scope increment 2: dekkingsbrede strategieën ──────────────────
// Drempel full-document vs. map-reduce, in geschatte tokens (≈ tekens/4). Onder
// de drempel past de volledige documenttekst in één prompt (accuraat, één call);
// erboven verwerken we in batches (map-reduce). Conservatief gekozen: ruim
// binnen het contextvenster, met plek voor systeemprompt + antwoord. Eén knop.
const VOLLEDIG_DOC_TOKEN_DREMPEL = 48000;
// Tokenbudget per map-batch en harde bovengrens op het aantal batches
// (kostenbewaking — voorkomt kostenrunaway bij extreem grote documenten).
const MAP_BATCH_TOKENS = 16000;
const MAX_BATCHES = 12;
// Goedkoop/snel model voor de extractieve map-stap; het sterke AI_MODEL doet de
// reduce-stap (kwaliteit van het eindantwoord).
const MAP_MODEL = HAIKU_MODEL;

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

export async function POST(req: NextRequest) {
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

    // Authenticatie
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

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
      .eq("id", user.id)
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
      gebruikerId: user.id,
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
        `[T4] body.fonds_id (${body.fonds_id}) wijkt af van sessie-fonds (${fondsId}) — genegeerd (gebruiker ${user.id}).`
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

    const volledigeNaam = profiel?.naam || user.email || "een bestuurslid";
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
      const sturing = await bouwProfielsturing(supabase, user.id);
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
    const gevraagdeScopeIds = (body.document_scope?.document_ids ?? []).filter(
      (id) => typeof id === "string" && id.length > 0
    );
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
            `[0151] module_scope risico_id (${moduleScope.risico_id}) niet gevonden onder RLS — geweigerd (gebruiker ${user.id}, fonds ${fondsId}).`
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
          .select("id, titel, status, template_code, beschrijving, decision_id")
          .eq("id", moduleScope.procedure_id)
          .maybeSingle();
        if (!proc?.id) {
          console.warn(
            `[0151] module_scope procedure_id (${moduleScope.procedure_id}) niet gevonden onder RLS — geweigerd (gebruiker ${user.id}, fonds ${fondsId}).`
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
        // geen vervuld/niet-vervuld-oordeel — dat vergt de readiness-engine).
        let requirements: RequirementRij[] = [];
        if (proc.template_code && huidigeStap) {
          const { data: reqRows } = await supabase
            .from("procedure_requirements")
            .select("label, requirement_type, verplicht, blokkerend")
            .eq("template_code", proc.template_code as string)
            .eq("stap_volgorde", huidigeStap.volgorde);
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
        : bepaalBronIntent(vraag);
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
    if (moetVerduidelijkenNu && bronkeuzeModus === "blokkerend") {
      try {
        // Plateau A — spoor en inhoud in één transactie via de definer-RPC.
        // `fonds_id` en `gebruiker_naam` zijn hier bewust GEEN parameter meer:
        // de functie leidt ze server-side af uit auth.uid(). Daarmee is het
        // probleem waar core/lib/audit-fonds-guard.ts tegen beschermde
        // structureel weg in plaats van per aanroeppunt bewaakt.
        const zegel = bouwInhoudZegel(vraag, VERDUIDELIJKINGSVRAAG);
        const { error: logFout } = await supabase.rpc("schrijf_ai_interactie", {
          p_vraag: vraag,
          p_antwoord: VERDUIDELIJKINGSVRAAG,
          p_bronnen: [],
          // `modus` kent een CHECK op documenten|combineren|algemeen; we leggen de
          // modus vast waar de vraag naartoe onderweg was (combineren-vloer, of
          // documenten bij een expliciete fondsrestrictie) — niet een verzonnen waarde.
          p_modus: bepaalAutoBronModus(alleenFondsdocumenten),
          p_model: null,
          p_retrieval_meta: {
            // Markeert de regel als een TERUGVRAAG, geen antwoord. Zo is in het log
            // te onderscheiden en te meten hoe vaak de assistent doorvraagt.
            verduidelijking: true,
            geen_modelcall: true,
            bron_intent: bronIntentResultaat.intent,
            bron_vertrouwen: bronIntentResultaat.vertrouwen,
            alleen_fondsdocumenten: alleenFondsdocumenten,
          },
          // Deze tak kent geen retrieval, dus ook geen inhoudsdragende meta.
          p_retrieval_meta_inhoud: {},
          p_gesprek_audit_id: gesprekAuditId,
          p_inhoud_hmac: zegel?.inhoud_hmac ?? null,
          p_hmac_schema_versie: zegel?.hmac_schema_versie ?? null,
          p_hmac_sleutel_versie: zegel?.hmac_sleutel_versie ?? null,
        });
        if (logFout) throw logFout;
      } catch (e) {
        // Fail-safe: een mislukte logregel mag de terugvraag niet blokkeren. Wel
        // zichtbaar in de serverlog, zodat een structureel probleem opvalt.
        console.error("Governance-log voor verduidelijking mislukt:", e);
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
    let breedAfgekapt = false;

    // G3 (plateau B) — een dekkingsbrede strategie is tijdens een reflectie per
    // definitie fout: de bronset is bevroren op de top-N van één antwoord, niet
    // op een heel document.
    if (scopeActief && !transformatieActief && !reflectieActief) {
      // Doorgronden forceert breed: de secties zijn dekkingsbreed, ook als de
      // korte zichtbare zin geen breed-signaalwoord bevat (bv. alleen "Afwijkingen").
      if (bepaalVraagtype(vraag) === "breed" || doorgrondActief) {
        // T4 — geef de server-side fonds mee: dit dekkingsbrede pad loopt niet via
        // de RPC (met p_fonds_id), dus de app-guard in haalDocumentChunks is hier de
        // enige expliciete fonds-laag náást RLS.
        breedChunks = await haalDocumentChunks(scopeDocumentIds!, fondsId);
        const totaalTekst = breedChunks.map((c) => c.tekst).join("\n\n");
        scopeStrategie = kiesStrategie(
          "breed",
          schatTokens(totaalTekst),
          VOLLEDIG_DOC_TOKEN_DREMPEL
        );
        if (scopeStrategie === "map_reduce") {
          const r = maakBatches(breedChunks, MAP_BATCH_TOKENS, MAX_BATCHES);
          breedBatches = r.batches;
          breedAfgekapt = r.afgekapt;
        }
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
    const vraagVoorPrompt = doorgrondInstructie ?? vraag;

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
      : bepaalAntwoordmodus(vraag);
    const antwoordmodus: Antwoordmodus = reflectieActief
      ? "sparring"
      : vastgezetteModus ?? gedetecteerdeModus;

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
    const retrievalFilters: RetrievalFilters | undefined =
      scopeActief || agendapuntModusActief || procesModusInPrompt
      ? undefined
      : {
          modus: neemNietVastgesteldeMee
            ? "alles"
            : retrievalModusVoorVraag(antwoordmodus, vraag),
          peildatum: vandaag,
          bronsoortprofiel: bepaalBronsoortprofiel(vraag),
          // T4 — regime-demotie op basis van het geldende fondsregime.
          primairRegime: fondsRegime,
        };

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
        ? agendapuntMetStukken
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

      if (heeftReformulatieNodig(vraag, priorBeurten.length > 0)) {
        // Voortgang (besluit 0087): de reformulatie draait op het STERKE model en
        // is meestal het grootste stille-tijd-blok. Melden vóór en na de call.
        send({ type: "progress", fase: "reformulatie", status: "bezig", label: VOORTGANG_LABEL.reformulatie });
        const herschreven = await reformuleerVraag(
          anthropic,
          priorBeurten,
          vraag,
          REWRITE_MODEL
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
      const res = await zoekRelevanteChunksMetMeta(
        zoekVraag,
        fondsId,
        CHUNK_BUDGET,
        hybrideAan,
        scopeDocumentIds,
        retrievalFilters,
        // Besluit 0139 (M-R3): bij een geherformuleerde zoekvraag geven we de
        // ORIGINELE vraag mee, zodat de hybride retrieval een extra poging met
        // de originele vraag draait en fuseert (reformulatie voegt alleen recall
        // toe, nooit minder). Niet-geherformuleerd → ongewijzigd gedrag.
        gereformuleerd ? { ...retrievalVlaggen, origineleVraag: vraag } : retrievalVlaggen
      );
      chunks = res.chunks;
      retrievalMeta = {
        ...res.meta,
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
      const uniekeDocumenten = new Set(res.meta.chunks.map((c) => c.document_id)).size;
      send({
        type: "progress",
        fase: "retrieval",
        status: "klaar",
        label: VOORTGANG_LABEL.retrieval,
        uitkomst: retrievalUitkomst(uniekeDocumenten, res.meta.geselecteerd),
      });
      // Auditspoor (§9): leg de scope vast waarop deze vraag is beperkt.
      if (scopeActief) {
        retrievalMeta.scope = {
          document_ids: scopeDocumentIds!,
          titels: scopeTitels,
          strategie: "targeted",
          algemene_kennis: algemeneKennis,
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
      const ctx = maakContext(chunks);
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
      heeftPortaalstandNodig(vraag);
    if (portaalstandNodig) {
      const stand = await getPortaalContext({
        userId: user.id,
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
      systeemBlokken = bouwSysteemBlokken(
        SP_AGENDAPUNT_REGELS,
        ctxBestuurder,
        antwoordmodus,
        chunks.length > 0 ? bronSentinel : null
      );
      const toelichtingBlok = bouwToelichtingBlok(agendapuntSeed!);
      const stukkenBlok =
        chunks.length > 0
          ? `\n\n=== GEKOPPELDE STUKKEN BIJ DIT AGENDAPUNT ===\n\n${contextTekst}`
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
      const scopeRegels = algemeneKennis
        ? SP_DOCUMENT_SCOPE_ALG_REGELS
        : breedActief
        ? SP_DOCUMENT_SCOPE_BREED_REGELS
        : SP_DOCUMENT_SCOPE_REGELS;
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
        gebruikersPrompt = `VOLLEDIGE INHOUD VAN HET DOCUMENT ${titelLabel}:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraagVoorPrompt}`;
      } else {
        // targeted (increment 1): top-N fragmenten.
        gebruikersPrompt =
          chunks.length > 0
            ? `BESCHIKBARE FRAGMENTEN UIT HET DOCUMENT ${titelLabel}:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}\n\nBeantwoord de vraag uitsluitend op basis van bovenstaande fragmenten. Staat het antwoord er niet in, zeg dan letterlijk: "Dit is niet in dit document aangetroffen."`
            : `In het document ${titelLabel} zijn geen passages gevonden die op deze vraag aansluiten.\n\nVRAAG: ${vraag}\n\nAls het antwoord niet in dit document staat, antwoord dan letterlijk: "Dit is niet in dit document aangetroffen." Verzin geen antwoord en vul niet aan uit andere bronnen of algemene kennis.`;
      }
    } else if (promptModus === "algemeen") {
      systeemBlokken = bouwSysteemBlokken(SP_ALGEMEEN_REGELS, ctxBestuurder, antwoordmodus, null, false, opstelTaak);
      gebruikersPrompt = `${portaalContextPrefix}VRAAG: ${vraag}`;
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
          ? `${portaalContextPrefix}BESCHIKBARE INTERNE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `${portaalContextPrefix}Er zijn geen interne documenten gevonden die direct relevant zijn voor deze vraag.\n\nVRAAG: ${vraag}\n\nGebruik je algemene kennis om de vraag zo goed mogelijk te beantwoorden, en markeer claims met [Algemene kennis]. Sluit af met een opmerking dat er geen interne bronnen zijn gevonden.`;
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
          ? `${portaalContextPrefix}BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `${portaalContextPrefix}Er zijn geen relevante documenten gevonden voor deze vraag.\n\nVRAAG: ${vraag}\n\nGeef aan dat er geen relevante bronnen zijn gevonden en stel voor welk type document zou kunnen helpen.`;
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
    if (
      !scopeActief &&
      !agendapuntModusActief &&
      !transformatieActief &&
      !neemNietVastgesteldeMee &&
      fondsTreffers === 0 &&
      retrievalFilters?.modus === "actueel"
    ) {
      const telling = await telNietActueleFondstreffers(vraag, fondsId, vandaag);
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
    const webBronsoortprofiel = bepaalBronsoortprofiel(vraag);
    const whitelistEntries =
      WEB_RETRIEVAL_ACTIEF && !scopeActief ? await haalActieveWhitelist(supabase) : [];
    const piiUitkomst = bevatPersoonsgegevens(vraag, [fondsnaam]);
    const webGate = beoordeelWebGate({
      vlagAan: WEB_RETRIEVAL_ACTIEF,
      aantalActieveEntries: whitelistEntries.length,
      scopeActief,
      bronsoortprofiel: webBronsoortprofiel,
      bevatPii: piiUitkomst.bevatPii,
    });
    const webTool = webGate.mag
      ? buildWebSearchTool(allowedDomeinenUit(whitelistEntries), WEB_MAX_USES)
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
            const deelanalyses: string[] = [];
            for (let i = 0; i < breedBatches.length; i++) {
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
              const mapResp = await anthropic.messages.create({
                model: MAP_MODEL,
                max_tokens: 1200,
                system: SP_MAP_EXTRACTIE,
                messages: [
                  {
                    role: "user",
                    content: `VRAAG: ${vraag}\n\nDOCUMENTDEEL ${i + 1}/${breedBatches.length} uit ${titelLabel}:\n\n${batchTekst}`,
                  },
                ],
              });
              // P5 signaal 6 — de map-tak verbruikt echte tokens; die apart
              // bijhouden zodat de teller niet doet alsof ze niet bestaan.
              mapCalls += 1;
              mapTokensIn += mapResp.usage?.input_tokens ?? 0;
              mapTokensUit += mapResp.usage?.output_tokens ?? 0;
              const mapTekst =
                mapResp.content[0]?.type === "text" ? mapResp.content[0].text.trim() : "";
              if (mapTekst && !/^geen$/i.test(mapTekst)) {
                deelanalyses.push(`— Deel ${i + 1}:\n${mapTekst}`);
              }
            }

            const dekkingNoot = breedAfgekapt
              ? "\n\nLET OP: het document was te groot om volledig te verwerken; alleen de eerste delen zijn meegenomen. Meld in het antwoord dat de dekking gedeeltelijk is."
              : "";
            const reducePrompt = `DEELANALYSES VAN HET DOCUMENT ${titelLabel} (${breedBatches.length} delen):\n\n${
              deelanalyses.join("\n\n") || "(geen relevante passages aangetroffen in het document)"
            }\n\n---\n\nVRAAG: ${vraagVoorPrompt}\n\nStel op basis van bovenstaande deelanalyses één samenhangend antwoord op het document op. Gebruik paginaverwijzingen "(pag. X)" waar die in de deelanalyses staan.${dekkingNoot}`;

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
            ...(metVervolgvragen
              ? [{ type: "text" as const, text: VERVOLGVRAGEN_INSTRUCTIE }]
              : []),
          ];

          // Basis-call; de web_search-server-tool wordt defensief toegevoegd (SDK
          // 0.39 typeert deze server-tool nog niet — de API ondersteunt hem wel).
          const streamParams: Anthropic.Messages.MessageStreamParams = {
            model: AI_MODEL,
            max_tokens: ruimBudget ? MAX_TOKENS_BESTUURLIJK : MAX_TOKENS,
            system: streamSysteem,
            messages: streamMessages,
          };
          if (webTool) {
            (streamParams as { tools?: unknown[] }).tools = [webTool];
          }
          // P5 signaal 3: duur van de generatie. De provider-adapter meet dit al
          // (core/lib/llm-providers/anthropic.ts), maar dit pad loopt daar niet
          // doorheen — het roept de SDK rechtstreeks aan. Meet vanaf de aanroep
          // tot finalMessage(), dus inclusief wachttijd bij de provider.
          const generatieStart = Date.now();
          const claudeStream = anthropic.messages.stream(streamParams);

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
          claudeStream.on("text", (delta) => {
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

          const finaleMsg = await claudeStream.finalMessage();
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
          if (finaleMsg.stop_reason === "max_tokens") {
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
            const webRes = extractWebResultaten(finaleMsg.content);
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
                (finaleMsg.usage?.input_tokens ?? 0) +
                (finaleMsg.usage?.cache_creation_input_tokens ?? 0) +
                (finaleMsg.usage?.cache_read_input_tokens ?? 0) +
                mapTokensIn,
              out: (finaleMsg.usage?.output_tokens ?? 0) + mapTokensUit,
            },
            tokendekking: {
              map_calls: mapCalls,
              bevat_reranker: false,
              bevat_query_reformulatie: false,
              bevat_web_search: false,
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
            p_model: AI_MODEL,
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
}
