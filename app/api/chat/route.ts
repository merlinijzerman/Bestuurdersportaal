import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { zoekRelevanteChunksMetMeta, maakContext, haalDocumentChunks, verrijkNotulenChunks, type DocumentChunk, type BronVerwijzing, type RetrievalMeta, type RetrievalFilters } from "@/core/lib/rag";
import { heeftReformulatieNodig, reformuleerVraag } from "@/core/lib/query-reformulatie";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { hybrideZoekenAan } from "@/core/lib/fonds-config";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { valideerScope, type ScopeDocumentRij } from "@/core/lib/document-scope";
import { bepaalVraagtype, schatTokens, kiesStrategie, maakBatches, bepaalAntwoordmodus, retrievalModusVoor, bepaalInlineMeldingen, bronbasisLabel, bepaalBronIntent, moetVerduidelijken, bepaalAutoBronModus, VERDUIDELIJKINGSVRAAG, VERDUIDELIJKING_OPTIES, ANTWOORDMODUS_LABEL, type Strategie, type Antwoordmodus, type BronModus, type BronIntent, type BronIntentResultaat } from "@/core/lib/vraagtype";
import { bepaalBronsoortprofiel } from "@/core/lib/weeg-bronsoort";
import { haalBesluitBronnen, topProcesinstanties, opmaakBesluitContext } from "@/core/lib/besluitvorming-bron";
import { documentBronNaarSource, modelKennisBronnenUitAntwoord, bouwSourceSamenvatting, ontbrekendeAlgemeneKennisMarkering, type AssistantSource } from "@/core/lib/assistant-source";
import { bouwProfielsturing, type ProfielsturingAspecten } from "@/core/lib/profielsturing";
import { bouwOrganisatieprofiel } from "@/core/lib/organisatieprofiel";
import { SP_AGENDAPUNT_REGELS, bouwToelichtingBlok, herkomstString, type AgendapuntSeed } from "@/core/lib/agendapunt-context";
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
  SP_ALGEMEEN_REGELS,
  SP_COMBINEREN_REGELS,
  SP_DOCUMENT_SCOPE_REGELS,
  SP_DOCUMENT_SCOPE_BREED_REGELS,
  SP_DOCUMENT_SCOPE_ALG_REGELS,
  SP_TRANSFORMATIE_REGELS,
  SP_MAP_EXTRACTIE,
  ROL_LABEL,
  bouwSysteemBlokken,
  type BestuurderContext,
} from "@/core/lib/generatie-kern";

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
const MAP_MODEL = "claude-haiku-4-5-20251001";

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
//  TODO(web-retrieval — Scenario A): zodra er ECHTE web-retrieval bestaat (Route B /
//  web-ingestion met whitelist), komt in generatie-kern een SP_WEB_REGELS-blok dat
//  het model instrueert uitsluitend te citeren uit de aangeleverde, opgehaalde
//  webresultaten (kind 'web' in lib/assistant-source.ts) — nooit uit verzonnen
//  URL's. De UI en het auditspoor zijn al voorbereid (AssistantSource.web +
//  source_summary.web_retrieval_actief).
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
    };
    // Bouw geschiedenis-array. Backwards compat: als alleen `vraag` wordt
    // meegestuurd, behandelen we dat als one-shot conversatie.
    const messages: ChatBericht[] =
      body.messages && Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages
        : body.vraag
        ? [{ role: "user", content: body.vraag }]
        : [];

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "messages of vraag is verplicht" },
        { status: 400 }
      );
    }

    const laatste = messages[messages.length - 1];
    if (laatste.role !== "user" || !laatste.content?.trim()) {
      return NextResponse.json(
        { error: "Het laatste bericht moet een vraag van de gebruiker zijn" },
        { status: 400 }
      );
    }
    const vraag = laatste.content.trim();

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
    const limiet = await controleerLimiet(supabase, LIMIETEN.chat);
    if (!limiet.toegestaan) return rateLimited("chat.POST", limiet.resetAt);

    // Profiel + fondsnaam ophalen voor persoonlijke context
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol, fonds_id, fondsen(naam)")
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
      | { naam: string }
      | { naam: string }[]
      | null
      | undefined;
    const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;

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

    // ── FO duiding v0.3 (06-07) — module-context in agendapunt-modus ────────
    // Doorvragen na "Stel mijn voorbereiding op" mag niet minder weten dan de
    // voorbereiding-route: actieve risico's + lopende procedures gaan compact
    // mee (zelfde selecties als die route). Alleen in agendapunt-modus, om
    // kosten en ruis in de overige modi te vermijden. Geen genummerde bronnen:
    // het model verwijst bij naam (herleidbaarheidskeuze gelijk aan de
    // voorbereiding-route; profielsturing loopt al generiek via Increment F).
    let modulesBlok = "";
    if (agendapuntModusActief && profiel?.fonds_id) {
      const [{ data: risicoRows }, { data: procedureRows }] = await Promise.all([
        supabase
          .from("risicos")
          .select("titel, toelichting, niveau, type_risico, categorie")
          .eq("fonds_id", profiel.fonds_id)
          .eq("status", "actief")
          .order("niveau", { ascending: false })
          .limit(15),
        supabase
          .from("procedures")
          .select("titel, beschrijving, status, template_code")
          .eq("fonds_id", profiel.fonds_id)
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
      if (delen.length > 0) modulesBlok = `\n\n${delen.join("\n\n")}`;
    }

    // ── Document-scope (increment 1): server-side validatie vóór retrieval ──
    // De client mag document_id's meesturen, maar de server valideert altijd
    // (§7): bestaat, actief, toegang (RLS), geïndexeerd. Faalt een check, dan een
    // concrete melding — nooit een stille terugval naar de hele bibliotheek.
    const gevraagdeScopeIds = (body.document_scope?.document_ids ?? []).filter(
      (id) => typeof id === "string" && id.length > 0
    );
    let scopeDocumentIds: string[] | undefined;
    let scopeTitels: string[] = [];

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
    }

    // scopeActief = STRICT document-scope. Agendapunt-modus gebruikt de scope-ids
    // wél voor retrieval, maar nooit voor strict-document gedrag (ADR 0028).
    const scopeActief =
      !agendapuntModusActief && !!scopeDocumentIds && scopeDocumentIds.length > 0;
    // Agendapunt-modus mét doorzoekbare gekoppelde stukken: retrieval beperkt tot
    // die stukken ([Bron N]); zonder stukken halen we niets op (toelichting-only).
    const agendapuntMetStukken =
      agendapuntModusActief && !!scopeDocumentIds && scopeDocumentIds.length > 0;

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
    const bronIntentResultaat: BronIntentResultaat | null =
      scopeActief || agendapuntModusActief
        ? null
        : intentOverride
        ? { intent: intentOverride, vertrouwen: "zeker" }
        : bepaalBronIntent(vraag);
    const bronIntent: BronIntent | undefined = bronIntentResultaat?.intent;

    // Verduidelijkingstak: twijfel → één SSE-event met de vraag + chips, géén
    // modelcall en géén governance_log-antwoordregel (er is geen antwoord). De
    // beslissing om te verduidelijken is puur reproduceerbaar uit de vraag.
    if (
      !transformatieActief &&
      bronIntentResultaat &&
      moetVerduidelijken(bronIntentResultaat, alleenFondsdocumenten)
    ) {
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

    if (scopeActief && !transformatieActief) {
      if (bepaalVraagtype(vraag) === "breed") {
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

    // ── Antwoordmodusfamilie (Increment G) ──────────────────────────────────
    // Orthogonaal op de bron-modus. Vastgezet (gesprekken.actieve_antwoordmodus)
    // is leidend; anders auto-detectie op de vraag. Increment I-1 (rustige
    // weergave §11c): de afwijking wordt niet meer als globale wissel-melding
    // getoond maar — waar relevant — als conditionele inline-melding bij het
    // antwoord (interpretatieve duiding/besluitvorming).
    const vastgezetteModus: Antwoordmodus | null = body.actieve_antwoordmodus ?? null;
    const gedetecteerdeModus: Antwoordmodus = bepaalAntwoordmodus(vraag);
    const antwoordmodus: Antwoordmodus = vastgezetteModus ?? gedetecteerdeModus;

    // Retrieval-filters volgen de antwoordmodus (peildatum = vandaag) + de
    // bronsoort-weging volgt het vraagtype. Bij een ACTIEVE document-scope laten
    // we de status-/geldigheidsfilter bewust achterwege: de gebruiker koos dat
    // specifieke stuk en wil het zien, ongeacht actuele-bron-status.
    const vandaag = new Date().toISOString().slice(0, 10);
    // Bij een actieve scope én in agendapunt-modus (de gebruiker koos die stukken
    // bewust) laten we de status-/geldigheidsfilter achterwege.
    const retrievalFilters: RetrievalFilters | undefined =
      scopeActief || agendapuntModusActief
      ? undefined
      : {
          modus: retrievalModusVoor(antwoordmodus),
          peildatum: vandaag,
          bronsoortprofiel: bepaalBronsoortprofiel(vraag),
        };

    // RAG-zoeken: voor de bibliotheek-modi, of bij een actieve scope met een
    // SPECIFIEKE vraag (targeted). Brede scope-vragen halen hieronder hun chunks
    // via haalDocumentChunks (volledige dekking i.p.v. top-N).
    let chunks: DocumentChunk[] = [];
    let bronnen: BronVerwijzing[] = [];
    let contextTekst = "";
    let retrievalMeta: RetrievalMeta | null = null;

    // Agendapunt-modus (ADR 0028): retrieval alleen als er doorzoekbare gekoppelde
    // stukken zijn. Zonder stukken halen we niets op — de toelichting is dan de
    // enige context (geen brede bibliotheek-retrieval, ticket §2.2).
    const moetRetrieven = !breedActief && (
      agendapuntModusActief
        ? agendapuntMetStukken
        : scopeActief || bronModusRetrieval === "documenten" || bronModusRetrieval === "combineren"
    );
    if (moetRetrieven) {
      // Hybride-schakelaar (T8): gelezen uit de generieke feature-flag-laag
      // (fonds_feature_flags via lib/fonds-config). De flag is per-fonds leidend;
      // zonder flag valt het terug op de env-default HYBRID_SEARCH — 1-op-1 het
      // gedrag van vóór de generalisatie (backfill borgt de bestaande waarde).
      // fondsId is server-side afgeleid, nooit uit de request-body.
      const hybrideAan = await hybrideZoekenAan(fondsId);

      // History-aware reformulatie (Fase B1): bij een vervolgvraag die op
      // eerdere context leunt, herschrijven we de vraag tot een zelfstandige
      // zoekvraag vóór de retrieval. De originele vraag blijft ongemoeid in de
      // prompt en in de governance_log; de herschreven zoekvraag wordt enkel
      // gebruikt om te zoeken en wordt vastgelegd in retrieval_meta.
      const priorBeurten = messages.slice(0, -1);
      let zoekVraag = vraag;
      let gereformuleerd = false;

      if (heeftReformulatieNodig(vraag, priorBeurten.length > 0)) {
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
      }

      const res = await zoekRelevanteChunksMetMeta(
        zoekVraag,
        fondsId,
        CHUNK_BUDGET,
        hybrideAan,
        scopeDocumentIds,
        retrievalFilters
      );
      chunks = res.chunks;
      retrievalMeta = {
        ...res.meta,
        zoekvraag: zoekVraag,
        gereformuleerd,
        body_fonds_id_genegeerd: bodyFondsAfwijkend,
      };
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
      const ctx = maakContext(chunks);
      contextTekst = ctx.contextTekst;
      bronnen = ctx.bronnen;

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
      chunks = breedChunks;
      bronnen = documentBronnen(breedChunks);
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

    // Bouw prompt op basis van modus, met persoonlijke context
    let systeemBlokken: Anthropic.Messages.TextBlockParam[];
    let gebruikersPrompt: string;

    if (transformatieActief) {
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
        antwoordmodus
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
        antwoordmodus
      );
      const toelichtingBlok = bouwToelichtingBlok(agendapuntSeed!);
      const stukkenBlok =
        chunks.length > 0
          ? `\n\n=== GEKOPPELDE STUKKEN BIJ DIT AGENDAPUNT ===\n\n${contextTekst}`
          : "\n\n(Er zijn geen doorzoekbare stukken aan dit agendapunt gekoppeld; baseer uw antwoord op de toelichting en, waar passend, uw algemene kennis.)";
      // Module-context (risico's/procedures) na de stukken — zie opbouw hierboven.
      gebruikersPrompt = `${toelichtingBlok}${stukkenBlok}${modulesBlok}\n\n---\n\nVRAAG: ${vraag}`;
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
      systeemBlokken = bouwSysteemBlokken(scopeRegels, ctxBestuurder);

      if (scopeStrategie === "map_reduce") {
        // De gebruikersprompt voor map-reduce wordt in de stream opgebouwd uit de
        // map-deelanalyses; hier een placeholder (wordt daar vervangen).
        gebruikersPrompt = "";
      } else if (breedActief) {
        // full-document: volledige documenttekst in de prompt.
        gebruikersPrompt = `VOLLEDIGE INHOUD VAN HET DOCUMENT ${titelLabel}:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`;
      } else {
        // targeted (increment 1): top-N fragmenten.
        gebruikersPrompt =
          chunks.length > 0
            ? `BESCHIKBARE FRAGMENTEN UIT HET DOCUMENT ${titelLabel}:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}\n\nBeantwoord de vraag uitsluitend op basis van bovenstaande fragmenten. Staat het antwoord er niet in, zeg dan letterlijk: "Dit is niet in dit document aangetroffen."`
            : `In het document ${titelLabel} zijn geen passages gevonden die op deze vraag aansluiten.\n\nVRAAG: ${vraag}\n\nAls het antwoord niet in dit document staat, antwoord dan letterlijk: "Dit is niet in dit document aangetroffen." Verzin geen antwoord en vul niet aan uit andere bronnen of algemene kennis.`;
      }
    } else if (promptModus === "algemeen") {
      systeemBlokken = bouwSysteemBlokken(SP_ALGEMEEN_REGELS, ctxBestuurder, antwoordmodus);
      gebruikersPrompt = `VRAAG: ${vraag}`;
    } else if (promptModus === "combineren") {
      // Bij nul interne treffers valt het antwoord terug op algemene kennis. Gebruik
      // dan ook de algemene-kennis-regels (die [Bron N] verbieden) i.p.v. de
      // combineren-regels — anders kan het model naar niet-bestaande [Bron N]
      // verwijzen (kapotte bron-chips). De bronbasis-melding blijft "combineren".
      systeemBlokken = bouwSysteemBlokken(
        chunks.length > 0 ? SP_COMBINEREN_REGELS : SP_ALGEMEEN_REGELS,
        ctxBestuurder,
        antwoordmodus
      );
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE INTERNE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `Er zijn geen interne documenten gevonden die direct relevant zijn voor deze vraag.\n\nVRAAG: ${vraag}\n\nGebruik je algemene kennis om de vraag zo goed mogelijk te beantwoorden, en markeer claims met [Algemene kennis]. Sluit af met een opmerking dat er geen interne bronnen zijn gevonden.`;
    } else {
      // documenten (strikte modus)
      systeemBlokken = bouwSysteemBlokken(SP_DOCUMENTEN_REGELS, ctxBestuurder, antwoordmodus);
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `Er zijn geen relevante documenten gevonden voor deze vraag.\n\nVRAAG: ${vraag}\n\nGeef aan dat er geen relevante bronnen zijn gevonden en stel voor welk type document zou kunnen helpen.`;
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
    const inlineMeldingenPre = bepaalInlineMeldingen({
      bronModus: bronModusRetrieval,
      antwoordmodus,
      aantalBronnen: bronnen.length,
      scopeActief,
    });

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
    //   { type: "meta",  bronnen, modus, chunks_gevonden }  — als eerste
    //   { type: "delta", text }                              — per token
    //   { type: "done" }                                     — na het loggen
    //   { type: "error", error }                             — bij een fout
    // De governance_log-insert gebeurt PAS na het voltooien van de stream, met
    // het volledige antwoord. Append-only blijft intact: enkel een insert, geen
    // UPDATE/DELETE. Een afgebroken stream logt geen half antwoord als definitief.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        try {
          send({
            type: "meta",
            bronnen,
            modus: effectieveModus,
            transformatie: transformatieActief,
            chunks_gevonden: chunks.length,
            // "Documentgericht" = de vraag ging over een specifiek stuk (strict
            // document-scope) of een agendapunt met stukken. Bepaalt in de UI welke
            // vervolgacties (duiding/kritische vragen) blijven staan naast de B1-
            // vervolgvragen. Reist mee in de onderbouwing zodat het na herladen klopt.
            document_gericht: scopeActief || agendapuntModusActief,
            scope: scopeActief
              ? {
                  document_ids: scopeDocumentIds,
                  titels: scopeTitels,
                  strategie: scopeStrategie,
                }
              : null,
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
            // Increment I-2 (FO §11a) — automatische bronkeuze: de (verborgen)
            // intentie + gekozen retrieval-modus. Géén zichtbare badge in de
            // chat; uitsluitend voor het paneel "Onderbouwing en bronnen".
            bron_intent: bronIntent ?? null,
            bron_vertrouwen: bronIntentResultaat?.vertrouwen ?? null,
            bron_modus_auto: scopeActief ? null : bronModusRetrieval,
            alleen_fondsdocumenten: alleenFondsdocumenten,
            bron_intent_override: scopeActief ? false : intentOverride !== undefined,
            // Increment I-3 — uniform bronmodel voor het paneel "Onderbouwing en
            // bronnen". Documentbronnen zijn nu bekend; model_knowledge volgt in
            // 'done'. web_retrieval_actief signaleert dat er (nog) geen live
            // web-retrieval is — de UI toont dat expliciet.
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
          let streamMessages = claudeBerichten;
          if (scopeStrategie === "map_reduce") {
            const titelLabel = scopeTitels[0] ? `«${scopeTitels[0]}»` : "het document";
            const deelanalyses: string[] = [];
            for (let i = 0; i < breedBatches.length; i++) {
              send({
                type: "progress",
                fase: "analyse",
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
            }\n\n---\n\nVRAAG: ${vraag}\n\nStel op basis van bovenstaande deelanalyses één samenhangend antwoord op het document op. Gebruik paginaverwijzingen "(pag. X)" waar die in de deelanalyses staan.${dekkingNoot}`;

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
          const metVervolgvragen = !transformatieActief;
          const streamSysteem = metVervolgvragen
            ? [
                ...systeemBlokken,
                { type: "text" as const, text: VERVOLGVRAGEN_INSTRUCTIE },
              ]
            : systeemBlokken;

          const claudeStream = anthropic.messages.stream({
            model: AI_MODEL,
            max_tokens: ruimBudget ? MAX_TOKENS_BESTUURLIJK : MAX_TOKENS,
            system: streamSysteem,
            messages: streamMessages,
          });

          // Stream de zichtbare tekst, maar houd steeds een staart ter grootte van
          // de marker achter: zo lekt "###VERVOLGVRAGEN###" nooit naar de client,
          // ook niet als de marker over twee deltas heen arriveert. Zodra de marker
          // opduikt, sturen we tot dáár en daarna niets meer.
          let verzonden = 0;
          let markerGezien = false;
          claudeStream.on("text", (delta) => {
            volledig += delta;
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

          await claudeStream.finalMessage();

          // Flush de resterende zichtbare staart als de marker nooit kwam.
          if (!markerGezien && verzonden < volledig.length) {
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
          const inlineMeldingenFinaal = bepaalInlineMeldingen({
            bronModus: bronModusRetrieval,
            antwoordmodus,
            aantalBronnen: bronnen.length,
            scopeActief,
            algemeneKennisMarkers,
          });

          // Increment I-3 — leid nu (mét de antwoordinhoud) de model_knowledge-
          // bronnen af: één per door het antwoord GENOEMDE instantie per
          // markertype. Verzint nooit een instantie die niet in de tekst staat.
          // Bij scope of pure documentmodus levert dit niets (geen algemene kennis).
          const modelKennisSources = scopeActief
            ? []
            : modelKennisBronnenUitAntwoord(zichtbaarAntwoord);
          const alleSources: AssistantSource[] = [
            ...documentSources,
            ...modelKennisSources,
          ];
          const sourceSamenvatting = bouwSourceSamenvatting(alleSources, false);
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
                }),
          };

          // Loggen ná voltooiing, met het volledige antwoord.
          await supabase.from("governance_log").insert({
            gebruiker_id: user.id,
            gebruiker_naam: profiel?.naam || user.email,
            fonds_id: fondsId,
            vraag,
            antwoord: zichtbaarAntwoord,
            bronnen,
            modus: effectieveModus,
            model: AI_MODEL,
            retrieval_meta: teLoggenMeta,
          });

          // Stuur de definitieve inline-meldingen mee zodat de UI de #4-melding
          // (content-afhankelijk) kan tonen ná het streamen.
          send({
            type: "done",
            inline_meldingen: inlineMeldingenFinaal,
            // Increment I-3 — de content-afhankelijke model_knowledge-bronnen +
            // bijgewerkte samenvatting voor het paneel "Onderbouwing en bronnen".
            model_kennis: modelKennisSources,
            source_summary: sourceSamenvatting,
            // B1 — inhoudelijke vervolgvragen op basis van het antwoord (kunnen
            // leeg zijn). De UI toont ze als klikbare chips ná de onderbouwing.
            vervolgvragen,
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
