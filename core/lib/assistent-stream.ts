// ============================================================================
//  Assistent — de SSE-stream van /api/chat als PURE reducer (P1a C3, 0201).
// ----------------------------------------------------------------------------
//  WAAROM puur, terwijl de rest van P1a alleen verplaatst.
//
//  De stroomverwerking is het brosste pad van de assistent: acht eventsoorten,
//  een half antwoord dat per delta wordt herschreven, een terugvraag die het
//  'done'-event moet NEGEREN, en een reflectiestatus die uitsluitend van de
//  server mag komen (FR-67). In de oude vorm leefde dat als dertien mutabele
//  lokalen binnen één 300-regelige functie, verweven met setState — niet te
//  testen zonder een browser, dus alleen te verifiëren door te klikken.
//
//  Hier is het een reducer: (stand, event) -> (nieuwe stand, uitwerking). De
//  "uitwerking" zegt wat er met de berichtenlijst moet gebeuren; de hook voert
//  alleen die instructie uit. Daarmee is elk gedragsdetail vastleggbaar in
//  `assistent-stream.sanity.ts` en in een componenttest met een gescripte
//  eventreeks — inclusief de gevallen die je met de hand nooit betrouwbaar
//  naspeelt, zoals een afgebroken stream.
//
//  GEDRAGSNEUTRAAL: elke tak hieronder is een letterlijke overname van de
//  bijbehorende tak uit `verwerkEvent` in AssistentClient.tsx (origin/preview
//  8f74663, r. 1286-1496), inclusief de eigenaardigheden. Twee daarvan zijn
//  makkelijk per ongeluk "op te schonen" en zijn dat bewust niet:
//    - een 'done' ná een verduidelijking doet HELEMAAL NIETS (ook geen
//      voltooid-vlag); anders zou de terugvraagbubbel overschreven worden;
//    - het bericht dat bij de EERSTE delta wordt toegevoegd draagt nog géén
//      `voltooid` en géén `logId`; die komen pas bij de herschrijving.
//
//  React-vrij en IO-vrij.
// ============================================================================

import type { InlineMelding } from "@/core/lib/vraagtype";
import type { ReflectieStatus } from "@/core/lib/reflectie-flow";
import type { VergelijkResultaat } from "@/core/lib/vergelijk-types";
import {
  pasVoortgangToe,
  type VoortgangUI,
  type VoortgangEvent,
} from "@/core/lib/voortgang";
import type {
  Bericht,
  Bron,
  Modus,
  OnderbouwingMeta,
  VolledigeAnalyseAanbod,
} from "@/core/lib/assistent-types";

/** Eén event uit de SSE-stream van /api/chat. Overgenomen uit AssistentClient. */
export interface AssistentStreamEvent {
  type: string;
  text?: string;
  bronnen?: Bron[];
  modus?: Modus;
  error?: string;
  fase?: string;
  status?: string;
  label?: string;
  uitkomst?: string;
  batch?: number;
  totaal?: number;
  antwoordmodus?: string;
  antwoordmodus_label?: string;
  peildatum?: string | null;
  bronbasis?: string | null;
  retrieval_modus?: string | null;
  // Besluit 0139 (M-R4) — de zoekvraag waarop daadwerkelijk is gezocht en
  // of die is herschreven (voor het onderbouwingspaneel).
  zoekvraag?: string | null;
  gereformuleerd?: boolean;
  inline_meldingen?: InlineMelding[];
  // Increment I-2 — verduidelijkingsevent (vraag + chips).
  vraag?: string;
  opties?: { intent: "fonds" | "algemeen"; label: string }[];
  // Increment I-2 — automatische bronkeuze (meta-event).
  bron_intent?: "fonds" | "algemeen" | "gecombineerd" | null;
  bron_vertrouwen?: "zeker" | "onzeker" | null;
  bron_modus_auto?: "documenten" | "combineren" | "algemeen" | null;
  alleen_fondsdocumenten?: boolean;
  bron_intent_override?: boolean;
  // Contextbesef (besluit 0090) — of de portaalstand is meegewogen.
  portaalstand_gebruikt?: boolean;
  // Besluit 0151 — de actieve module-scope (proces/risicomatrix/risico) voor
  // het onderbouwingspaneel, onderscheiden van documentbronnen.
  module_scope?: {
    soort: "proces" | "risicomatrix" | "risico";
    procedure_id?: string;
    risico_id?: string;
    bron_ids?: string[];
  } | null;
  // 30-07-2026 — de actualiteitsfilter nam alle treffers weg terwijl er wél
  // niet-vastgestelde fondsstukken zijn: aanbod om ze mee te nemen.
  verbreding?: {
    type: "niet_vastgesteld";
    aantal: number;
    titels: string[];
    label: string;
  } | null;
  // Besluit 0137 (antwoord-eerst) — niet-blokkerend bronkeuze-aanbod: de
  // twee keuzes als chips ónder het fondsgerichte antwoord. null = n.v.t.
  bronkeuze_aanbod?: {
    opties: { intent: "fonds" | "algemeen"; label: string }[];
  } | null;
  // Increment I-3 — uniforme bronvermelding-transparantie.
  web_retrieval_actief?: boolean;
  model_kennis?: { grond: "algemene_kennis" | "wetgeving"; instantie: string | null }[];
  // Scenario A (besluit 0072) — geverifieerde webbronnen (done-event).
  web_bronnen?: {
    url: string;
    titel: string;
    domein: string;
    datum?: string | null;
    normgewicht?: string | null;
    ophaaldatum?: string | null;
  }[];
  // Increment F (FO §14) — profielsturing-status (paneel "Onderbouwing en bronnen").
  profielsturing?: "actief" | "uitgeschakeld" | "geen-profiel" | null;
  // OP-4 (FO §8) — organisatieprofiel-status + geïnjecteerde veldgroepen
  // voor het paneel "Onderbouwing en bronnen".
  organisatieprofiel?: "actief" | "geen-profiel" | null;
  organisatieprofiel_aspecten?: {
    organisatietype: boolean;
    uitvoerende_partijen: boolean;
    omvang: boolean;
    kernfeiten: boolean;
    missie: boolean;
    visie: boolean;
    strategische_speerpunten: boolean;
    risicohouding: boolean;
    peildatum: string | null;
  } | null;
  // B1 / scope-split — documentgericht (meta) + vervolgvragen (done).
  document_gericht?: boolean;
  vervolgvragen?: string[];
  documentdekking?: OnderbouwingMeta["documentdekking"];
  vraagrouter?: OnderbouwingMeta["vraagrouter"];
  volledige_analyse_aanbod?: VolledigeAnalyseAanbod | null;
  // Plateau B — het id van de auditregel van deze beurt, en de
  // server-controlled reflectiestatus. Beide komen in het 'done'-event.
  log_id?: string | null;
  reflectie?: { status?: string; beurt?: number; heeft_bronset?: boolean };
  // T5 — vergelijkmodus-events.
  resultaat?: VergelijkResultaat;
  bronHint?: string | null;
  doelHint?: string | null;
  bronKandidaten?: { id: string; titel: string }[];
  doelKandidaten?: { id: string; titel: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Stand en uitwerking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alles wat tijdens één generatie wordt opgebouwd. Dit waren de mutabele
 * lokalen binnen `stuurBericht`; de namen zijn bewust gelijk gebleven zodat de
 * herkomst van elk veld navolgbaar blijft.
 */
export interface StreamStand {
  /** De tot nu toe ontvangen antwoordtekst. */
  volledig: string;
  bronnen?: Bron[];
  modus: Modus;
  onderbouwing?: OnderbouwingMeta;
  inlineMeldingen?: InlineMelding[];
  verbreding?: Bericht["verbreding"];
  bronkeuzeAanbod?: Bericht["bronkeuzeAanbod"];
  volledigeAnalyseAanbod?: VolledigeAnalyseAanbod;
  /** Het id van de auditregel van dit antwoord (uit 'done'). */
  logId?: string;
  /**
   * Alleen true na een NETJES afgerond 'done' (besluit 0098 §4). Een afgebroken
   * stream houdt hem false, en daarmee verschijnt er geen kopieerknop met een
   * volledige herkomstregel onder een half antwoord.
   */
  voltooid: boolean;
  /** Staat er al een AI-bubbel waar deze generatie in schrijft? */
  aiToegevoegd: boolean;
  /** Eindigde deze beurt in een terugvraag/vergelijking i.p.v. een antwoord? */
  verduidelijkingActief: boolean;
  /** De terugvraag- of vergelijkbeurt als bewaarbaar bericht (besluit 0092). */
  verduidelijkingBericht?: Bericht;
  /** True zodra de eerste tokens binnen zijn; verbergt de typ-indicator. */
  antwoordGestart: boolean;
  voortgang: VoortgangUI | null;
  /**
   * De SERVER-controlled reflectiestatus. Komt uitsluitend uit het 'done'-event
   * en nergens anders: de client leidt hem niet af uit wat hij verstuurde
   * (FR-67, besluit 0110). `null` = de server zei er niets over, dus niet
   * aanraken.
   */
  reflectie: { status: ReflectieStatus; beurt?: number } | null;
}

/** Wat er met de berichtenlijst moet gebeuren na dit event. */
export type StreamUitwerking =
  | { soort: "geen" }
  /** Voeg dit bericht achteraan toe. */
  | { soort: "voegToe"; bericht: Bericht }
  /** Vervang het laatste bericht door dit bericht. */
  | { soort: "herschrijf"; bericht: Bericht };

export function leegeStreamStand(): StreamStand {
  return {
    volledig: "",
    modus: "combineren",
    voltooid: false,
    aiToegevoegd: false,
    verduidelijkingActief: false,
    antwoordGestart: false,
    voortgang: null,
    reflectie: null,
  };
}

/** Het antwoordbericht zoals `schrijfAi()` het samenstelde. */
function aiBericht(s: StreamStand): Bericht {
  return {
    rol: "ai",
    tekst: s.volledig,
    bronnen: s.bronnen,
    modus: s.modus,
    onderbouwing: s.onderbouwing,
    inlineMeldingen: s.inlineMeldingen,
    verbreding: s.verbreding,
    bronkeuzeAanbod: s.bronkeuzeAanbod,
    volledigeAnalyseAanbod: s.volledigeAnalyseAanbod,
    voltooid: s.voltooid,
    logId: s.logId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  De reducer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verwerkt één stream-event.
 *
 * @param vraag De vraag van deze beurt. Nodig omdat `verbreding` en
 *   `bronkeuzeAanbod` hem meedragen: een chip moet dezelfde vraag letterlijk
 *   opnieuw kunnen stellen.
 */
export function pasStreamEventToe(
  stand: StreamStand,
  evt: AssistentStreamEvent,
  vraag: string
): { stand: StreamStand; uitwerking: StreamUitwerking } {
  const geen = (s: StreamStand) => ({ stand: s, uitwerking: { soort: "geen" as const } });

  if (evt.type === "verduidelijking") {
    // Twijfelgeval: toon de verduidelijkingsvraag met twee chips, géén
    // antwoord. aiToegevoegd voorkomt dat het vangnet "geen antwoord" slaat;
    // verduidelijkingActief voorkomt dat 'done' de bubbel overschrijft.
    const bericht: Bericht = {
      rol: "ai",
      tekst:
        evt.vraag || "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?",
      verduidelijking: {
        vraag: evt.vraag || "",
        opties: evt.opties ?? [],
        origineleVraag: vraag,
      },
    };
    return {
      stand: {
        ...stand,
        verduidelijkingActief: true,
        aiToegevoegd: true,
        voortgang: null,
        verduidelijkingBericht: bericht,
      },
      uitwerking: { soort: "voegToe", bericht },
    };
  }

  if (evt.type === "vergelijking") {
    // T5 — vergelijkresultaat: geen antwoordbubbel maar de side-by-side
    // component. Hergebruikt het verduidelijking-spoor (geen 'done'-
    // overschrijving + dezelfde persistentie van de beurt).
    const basis: StreamStand = {
      ...stand,
      verduidelijkingActief: true,
      aiToegevoegd: true,
      voortgang: null,
    };
    if (!evt.resultaat) return geen(basis);
    const bericht: Bericht = {
      rol: "ai",
      tekst: "Vergelijking",
      vergelijking: evt.resultaat,
      voltooid: true,
    };
    return {
      stand: { ...basis, verduidelijkingBericht: bericht },
      uitwerking: { soort: "voegToe", bericht },
    };
  }

  if (evt.type === "vergelijking_verduidelijking") {
    // T5 — twee mogelijke doelbronnen: een gerichte verduidelijking i.p.v. gokken.
    const bericht: Bericht = {
      rol: "ai",
      tekst: "Welke documenten wilt u vergelijken?",
      vergelijkingVerduidelijking: {
        bronHint: evt.bronHint ?? null,
        doelHint: evt.doelHint ?? null,
        bronKandidaten: evt.bronKandidaten ?? [],
        doelKandidaten: evt.doelKandidaten ?? [],
      },
    };
    return {
      stand: {
        ...stand,
        verduidelijkingActief: true,
        aiToegevoegd: true,
        voortgang: null,
        verduidelijkingBericht: bericht,
      },
      uitwerking: { soort: "voegToe", bericht },
    };
  }

  if (evt.type === "meta") {
    const aantal = evt.bronnen?.length ?? 0;
    const onderbouwing: OnderbouwingMeta = {
      bronbasis: evt.bronbasis ?? null,
      antwoordmodusLabel: evt.antwoordmodus_label ?? evt.antwoordmodus ?? null,
      antwoordmodus: evt.antwoordmodus ?? null,
      retrievalModus: evt.retrieval_modus ?? null,
      // Besluit 0139 (M-R4) — gebruikte zoekvraag; alleen getoond bij reformulatie.
      zoekvraag: evt.zoekvraag ?? null,
      gereformuleerd: evt.gereformuleerd ?? false,
      peildatum: evt.peildatum ?? null,
      algemeneKennis: evt.bronbasis
        ? /algemene kennis/i.test(evt.bronbasis)
        : undefined,
      aantalBronnen: aantal,
      bronIntent: evt.bron_intent ?? null,
      bronVertrouwen: evt.bron_vertrouwen ?? null,
      alleenFondsdocumenten: evt.alleen_fondsdocumenten ?? null,
      bronIntentOverride: evt.bron_intent_override ?? null,
      portaalstandGebruikt: evt.portaalstand_gebruikt ?? null,
      moduleScope: evt.module_scope
        ? {
            soort: evt.module_scope.soort,
            bronnen: evt.module_scope.bron_ids?.length ?? 0,
          }
        : null,
      webRetrievalActief: evt.web_retrieval_actief ?? false,
      modelKennis: [],
      profielsturing: evt.profielsturing ?? null,
      organisatieprofiel: evt.organisatieprofiel ?? null,
      organisatieprofielAspecten: evt.organisatieprofiel_aspecten ?? null,
      documentGericht: evt.document_gericht ?? null,
      vervolgvragen: [],
      documentdekking: evt.documentdekking ?? null,
      vraagrouter: evt.vraagrouter ?? null,
    };
    return geen({
      ...stand,
      bronnen: evt.bronnen,
      modus: evt.modus || "combineren",
      onderbouwing,
      // Deterministische inline-meldingen (pre-stream); de #4-melding kan in
      // het 'done'-event nog worden aangevuld.
      inlineMeldingen: evt.inline_meldingen ?? [],
      verbreding: evt.verbreding ? { ...evt.verbreding, vraag } : undefined,
      bronkeuzeAanbod: evt.bronkeuze_aanbod
        ? { opties: evt.bronkeuze_aanbod.opties, origineleVraag: vraag }
        : undefined,
    });
  }

  if (evt.type === "progress") {
    // Voortgang per bereikte serverfase (besluit 0087) — gedeelde reducer.
    return geen({
      ...stand,
      voortgang: pasVoortgangToe(stand.voortgang, evt as VoortgangEvent),
    });
  }

  if (evt.type === "delta") {
    const volledig = stand.volledig + (evt.text || "");
    if (!stand.aiToegevoegd) {
      const nieuw: StreamStand = {
        ...stand,
        volledig,
        aiToegevoegd: true,
        voortgang: null, // analyse klaar, antwoord begint
        antwoordGestart: true,
      };
      // Let op: dit eerste bericht draagt bewust nog GEEN `voltooid` en geen
      // `logId` — precies zoals het origineel. Beide komen bij 'done'.
      return {
        stand: nieuw,
        uitwerking: {
          soort: "voegToe",
          bericht: {
            rol: "ai",
            tekst: volledig,
            bronnen: nieuw.bronnen,
            modus: nieuw.modus,
            onderbouwing: nieuw.onderbouwing,
            inlineMeldingen: nieuw.inlineMeldingen,
            verbreding: nieuw.verbreding,
            bronkeuzeAanbod: nieuw.bronkeuzeAanbod,
            volledigeAnalyseAanbod: nieuw.volledigeAnalyseAanbod,
          },
        },
      };
    }
    const nieuw = { ...stand, volledig };
    return { stand: nieuw, uitwerking: { soort: "herschrijf", bericht: aiBericht(nieuw) } };
  }

  if (evt.type === "done") {
    // Bij een verduidelijking is er geen antwoordbubbel om bij te werken.
    if (stand.verduidelijkingActief) return geen(stand);

    let onderbouwing = stand.onderbouwing;
    if (evt.model_kennis && onderbouwing) {
      onderbouwing = { ...onderbouwing, modelKennis: evt.model_kennis };
    }
    if (onderbouwing) {
      onderbouwing = {
        ...onderbouwing,
        webRetrievalActief:
          evt.web_retrieval_actief ?? onderbouwing.webRetrievalActief ?? false,
        webBronnen: evt.web_bronnen ?? onderbouwing.webBronnen ?? [],
      };
    }
    if (onderbouwing) {
      onderbouwing = {
        ...onderbouwing,
        vervolgvragen: evt.vervolgvragen ?? [],
        documentdekking: evt.documentdekking ?? onderbouwing.documentdekking ?? null,
        vraagrouter: evt.vraagrouter ?? onderbouwing.vraagrouter ?? null,
      };
    }

    const nieuw: StreamStand = {
      ...stand,
      // Vanaf hier is de generatie netjes afgerond; pas nu mag er gekopieerd.
      voltooid: true,
      // Definitieve (content-afhankelijke) inline-meldingen, incl. #4.
      inlineMeldingen: evt.inline_meldingen ?? stand.inlineMeldingen,
      onderbouwing,
      volledigeAnalyseAanbod: evt.volledige_analyse_aanbod ?? undefined,
      // 30-07-2026 — definitieve verbredings-aanbieding (kan in 'done' pas
      // definitief zijn; blijft anders staan zoals in 'meta' gezet).
      verbreding:
        evt.verbreding !== undefined
          ? evt.verbreding
            ? { ...evt.verbreding, vraag }
            : undefined
          : stand.verbreding,
      logId: typeof evt.log_id === "string" ? evt.log_id : stand.logId,
      // De server-controlled flowstatus. Hij komt hiervandaan en nergens
      // anders: de client leidt hem niet af uit wat hij zojuist verstuurde.
      reflectie: evt.reflectie?.status
        ? {
            status: evt.reflectie.status as ReflectieStatus,
            beurt:
              typeof evt.reflectie.beurt === "number" ? evt.reflectie.beurt : undefined,
          }
        : stand.reflectie,
    };

    // `schrijfAi()` had een guard: zonder AI-bubbel gebeurt er niets.
    if (!nieuw.aiToegevoegd) return geen(nieuw);
    return { stand: nieuw, uitwerking: { soort: "herschrijf", bericht: aiBericht(nieuw) } };
  }

  if (evt.type === "error") {
    if (stand.aiToegevoegd) return geen(stand);
    const bericht: Bericht = {
      rol: "ai",
      tekst: evt.error || "Er is een fout opgetreden.",
    };
    return {
      stand: { ...stand, aiToegevoegd: true },
      uitwerking: { soort: "voegToe", bericht },
    };
  }

  return geen(stand);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Framing van de SSE-stroom
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Knipt een leesbuffer in complete events. Events zijn gescheiden door een lege
 * regel; de rest (een half binnengekomen event) blijft over voor de volgende
 * lezing.
 */
export function splitsStreamBuffer(buffer: string): { delen: string[]; rest: string } {
  const delen = buffer.split("\n\n");
  const rest = delen.pop() || "";
  return { delen, rest };
}

/**
 * Leest één SSE-regel naar een event. Levert `null` bij een lege regel of bij
 * onleesbare JSON — het origineel negeerde die stilzwijgend, en dat blijft zo:
 * een half event mag de generatie niet laten klappen.
 */
export function leesStreamRegel(raw: string): AssistentStreamEvent | null {
  const regel = raw.replace(/^data: ?/, "").trim();
  if (!regel) return null;
  try {
    return JSON.parse(regel) as AssistentStreamEvent;
  } catch {
    return null;
  }
}
