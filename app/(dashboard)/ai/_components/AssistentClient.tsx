"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/core/lib/supabase";
import {
  ZICHTBARE_ANTWOORDMODI,
  bepaalVervolgacties,
  isTransformatieActie,
  type Antwoordmodus,
  type Vervolgactie,
  type InlineMelding,
} from "@/core/lib/vraagtype";
import OnderbouwingPaneel, { type OnderbouwingMeta } from "./OnderbouwingPaneel";
import {
  renderAntwoord,
  Bronkaart,
  AntwoordKopieerKnop,
  Documentenlijst,
  leesAntwoordmodus,
  documentlijstZichtbaar,
  type Bron,
} from "./AntwoordWeergave";
import { isDocumentbron } from "@/core/lib/documentlijst";
import {
  pasVoortgangToe,
  VoortgangWeergave,
  type VoortgangUI,
} from "./Voortgang";
import Startpunt from "./Startpunt";
import DocumentDoorgronden, { type DoorgrondDoc } from "./DocumentDoorgronden";
import { ACTIEF_GESPREK_SLEUTEL } from "@/core/lib/ai-sessie";
import type {
  PortaalContext,
  DocumentCtx,
} from "@/core/lib/portaalcontext-afleiding";
import { GENERIEKE_STARTVRAGEN, type Startvraag } from "@/core/lib/startvragen";
import { bouwDoorgrondZin, type DoorgrondSectieId } from "@/core/lib/doorgrond";

type Modus = "documenten" | "combineren" | "algemeen";

// Antwoordmodusfamilie — Increment I-1 (FO §13): nog maar VIER zichtbare modi.
// Auto (= null) plus de drie hieronder. De overige interne modi (historisch,
// besluitrijpheid, …) blijven onder de motorkap bestaan via auto-detectie en
// vervolgacties, maar krijgen geen knop meer.
const ANTWOORDMODUS_HELP: Record<Antwoordmodus, string> = {
  feitelijk: "Feitelijke beantwoording op documenten/beleid/besluiten",
  duiding: "Bestuurlijke interpretatie, governance, risico's en besluitrijpheid",
  sparring: "Meedenken: opties, scenario's en kritische tegenvragen",
  historisch: "Inclusief oude/vervangen bronnen (met label)",
  besluitrijpheid: "Weegt besluitvorming, neemt de besluitregistratie mee",
  bronoverzicht: "Overzicht van relevante bronnen",
  persoonlijke_voorbereiding: "Persoonlijke voorbereiding",
};
// Korte knoplabels (FO §13: Auto · Feiten · Duiding · Sparren).
const ANTWOORDMODUS_KNOP_LABEL: Record<Antwoordmodus, string> = {
  feitelijk: "Feiten",
  duiding: "Duiding",
  sparring: "Sparren",
  historisch: "Historie",
  besluitrijpheid: "Besluit",
  bronoverzicht: "Bronnen",
  persoonlijke_voorbereiding: "Voorbereiding",
};
const ANTWOORDMODUS_KEUZES: { value: Antwoordmodus; label: string; help: string }[] =
  ZICHTBARE_ANTWOORDMODI.map((value) => ({
    value,
    label: ANTWOORDMODUS_KNOP_LABEL[value],
    help: ANTWOORDMODUS_HELP[value],
  }));


// Increment I-2 (FO §11a) — bij een twijfelgeval vraagt de assistent terug i.p.v.
// te gokken. Dit AI-bericht draagt de verduidelijkingsvraag + de twee chips en
// de originele vraag, zodat een chipkeuze dezelfde vraag opnieuw stuurt met een
// bevestigde bron-intentie (combineren-vloer voor "fonds", niet een harde scope).
interface VerduidelijkingKeuze {
  vraag: string;
  opties: { intent: "fonds" | "algemeen"; label: string }[];
  origineleVraag: string;
}

interface Bericht {
  rol: "gebruiker" | "ai";
  tekst: string;
  bronnen?: Bron[];
  modus?: Modus;
  // Increment I-1 (FO §11c) — rustige weergave: controle-informatie voor het
  // paneel "Onderbouwing en bronnen" + de conditionele inline-meldingen.
  onderbouwing?: OnderbouwingMeta;
  inlineMeldingen?: InlineMelding[];
  // Increment I-2 (FO §11a) — verduidelijkingsvraag met chips (geen antwoord).
  verduidelijking?: VerduidelijkingKeuze;
  // 30-07-2026 — de actualiteitsfilter nam alle treffers weg terwijl er wél
  // niet-vastgestelde fondsstukken over het onderwerp zijn. Eén chip stelt
  // dezelfde vraag opnieuw met die filter uit. `vraag` is de oorspronkelijke
  // vraag, zodat de chip hem letterlijk kan herhalen.
  verbreding?: {
    aantal: number;
    titels: string[];
    label: string;
    vraag: string;
  };
  // Besluit 0098 — alleen een NETJES afgeronde generatie ('done' ontvangen) is
  // kopieerbaar. Welkomsttekst, foutmeldingen en afgebroken streams krijgen dus
  // geen kopieerknop: een herkomstregel onder iets dat geen antwoord is,
  // ondermijnt precies de geloofwaardigheid van diezelfde regel.
  voltooid?: boolean;
}

// Actieve documentscope (increment 1). titels op moment van zetten, zodat de
// chip en de gesprekshistorie het stuk herkenbaar tonen.
interface DocumentScope {
  document_ids: string[];
  titels: string[];
  // Opt-in algemene kennis (increment 2). Default uit = strict-document.
  algemene_kennis?: boolean;
}

// Eén suggestie in de @-mention-typeahead.
interface DocSuggestie {
  id: string;
  titel: string;
  bron: string;
  bestandstype: string | null;
  aangemaakt: string | null;
}

// Eén item in het gesprekken-overzicht (Fase B2-volledig).
interface GesprekItem {
  id: string;
  titel: string | null;
  bijgewerkt: string;
  berichten: Bericht[];
  document_scope?: unknown;
  actieve_antwoordmodus?: unknown;
}

// `leesAntwoordmodus` woont sinds tranche 2B in de gedeelde renderer (zie de
// import hierboven): de agendapuntchat heeft hem ook nodig, en twee kopieën van
// de modusnamenlijst zouden vroeg of laat uiteenlopen.

// Leest de jsonb-scope uit een gesprek terug naar de UI-vorm (of null).
function leesScope(ruw: unknown): DocumentScope | null {
  if (!ruw || typeof ruw !== "object") return null;
  const o = ruw as { document_ids?: unknown; titels?: unknown };
  const ids = Array.isArray(o.document_ids)
    ? o.document_ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) return null;
  const titels = Array.isArray(o.titels)
    ? o.titels.filter((x): x is string => typeof x === "string")
    : [];
  const ak = (ruw as { algemene_kennis?: unknown }).algemene_kennis === true;
  return { document_ids: ids, titels, algemene_kennis: ak };
}

// ADR 0028 — agendapunt-modus: de vraag is geframed door een agendapunt. We
// bewaren id + titel zodat de chip "Agendapunt: «titel»" toont en de toelichting
// per beurt server-side wordt opgehaald (de route trust de client-titel niet).
interface AgendapuntContext {
  id: string;
  titel: string;
}

// Leest het (additieve) agendapunt_context-blok uit een opgeslagen gesprek terug,
// zodat een hervat agendapunt-gesprek de framing behoudt.
function leesAgendapuntContext(ruw: unknown): AgendapuntContext | null {
  if (!ruw || typeof ruw !== "object") return null;
  const o = (ruw as { agendapunt_context?: unknown }).agendapunt_context;
  if (!o || typeof o !== "object") return null;
  const id = (o as { id?: unknown }).id;
  const titel = (o as { titel?: unknown }).titel;
  if (typeof id !== "string" || id.length === 0) return null;
  return { id, titel: typeof titel === "string" && titel ? titel : "dit agendapunt" };
}


function dagdeelGroet() {
  const u = new Date().getHours();
  if (u < 6) return "Goedenacht";
  if (u < 12) return "Goedemorgen";
  if (u < 18) return "Goedemiddag";
  return "Goedenavond";
}

// Voortgang tijdens het wachten (besluit 0087): types, reducer en weergave leven
// in ./Voortgang, gedeeld met de agenda-voorbereiding (AgendapuntChat).

// Ingreep 2 — leesbare labels voor de module-ingang (/ai?herkomst=<slug>). Bewust
// een vaste tabel: de slug uit de URL wordt nooit als vrije tekst getoond.
const HERKOMST_LABEL: Record<string, string> = {
  vergaderingen: "Vergaderingen",
  risicomatrix: "Risicomatrix",
  procedures: "Processen",
  bibliotheek: "Bibliotheek",
  portaal: "het portaal",
};

export default function AssistentClient({
  startpuntContext,
}: {
  startpuntContext: PortaalContext;
}) {
  const [berichten, setBerichten] = useState<Bericht[]>([
    {
      rol: "ai",
      tekst: `Welkom terug. Ik ben uw AI-assistent voor het bestuurdersportaal.\n\nElke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt.`,
    },
  ]);
  const [invoer, setInvoer] = useState("");
  const [laden, setLaden] = useState(false);
  // True zodra de eerste tokens van een antwoord binnenstromen — gebruikt om de
  // typ-indicator te verbergen zodra de tekst zelf begint te verschijnen.
  const [antwoordGestart, setAntwoordGestart] = useState(false);
  const [fondsId, setFondsId] = useState<string>("");
  // Voornaam voor de startpunt-aanhef ("Waar werkt u nu aan, {voornaam}?"). Wordt
  // in het profiel-effect gezet; leeg tot dat geladen is (fallback zonder naam).
  const [voornaam, setVoornaam] = useState<string>("");
  // Fondsnaam voor de herkomstregel onder een kopie (besluit 0098). Leeg tot
  // het profiel geladen is; de herkomstregel laat de vermelding dan weg.
  const [fondsNaam, setFondsNaam] = useState<string>("");
  // Increment I-2 (FO §11a) — de zichtbare bron-as is vervangen door automatische
  // bronkeuze. De gebruiker kiest geen bron-modus meer; alleen de expliciete
  // restrictie "Alleen fondsdocumenten" (onder "Aanpassen") blijft over.
  const [alleenFondsdocumenten, setAlleenFondsdocumenten] = useState(false);
  // Increment F (FO §14) — "algemeen perspectief": schakelt de profielgestuurde
  // prioritering uit (zelfde bronnen, collectieve weergave). Default uit = het
  // antwoord wordt op het eigen profiel geprioriteerd indien dat is ingevuld.
  const [algemeenPerspectief, setAlgemeenPerspectief] = useState(false);
  const [aanpassenOpen, setAanpassenOpen] = useState(false);
  // Increment G — vastgezette antwoordmodus (null = auto-detectie). De feitelijk
  // gebruikte modus + bronbasis komen per antwoord in het paneel "Onderbouwing
  // en bronnen" (Increment I-1, rustige weergave §11c) — niet meer in een
  // globale balk. De hybride-schakelaar is uit de eindgebruikers-UI gehaald
  // (I-1): de per-fonds instelling (default aan) blijft server-side leidend.
  const [antwoordmodus, setAntwoordmodus] = useState<Antwoordmodus | null>(null);
  // Welke onderbouwingspanelen open staan (per bericht-index). Default dicht.
  const [openPanelen, setOpenPanelen] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<{
    berichtIdx: number;
    bronIdx: number;
  } | null>(null);
  // Index van het bericht waar na het versturen van een vraag naartoe moet
  // worden gescrold (begin van de vraag bovenaan), i.p.v. mee te schuiven naar
  // de onderkant/bronnen tijdens het streamen.
  const scrollDoel = useRef<number | null>(null);
  const highlightTimer = useRef<number | null>(null);
  // Persistentie (Fase B2): id van het huidige opgeslagen gesprek en de
  // ingelogde gebruiker. Refs i.p.v. state — wijziging hoeft geen re-render.
  const gesprekId = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Gepersonaliseerde welkomstboodschap, zodat "nieuw gesprek" altijd een
  // schone start toont (ook nadat een eerder gesprek is geopend).
  const welkomstRef = useRef<Bericht | null>(null);
  // Startpunt (P1, besluit 0085) — ref op het invoerveld zodat "Vrije vraag"
  // de cursor direct in het invoerveld zet.
  const invoerRef = useRef<HTMLTextAreaElement | null>(null);
  // Gesprekken-overzicht (Fase B2-volledig).
  const [gesprekken, setGesprekken] = useState<GesprekItem[]>([]);
  const [historieOpen, setHistorieOpen] = useState(false);
  // Document-scope (increment 1): beperkt de vraag tot één specifiek stuk.
  const [documentScope, setDocumentScope] = useState<DocumentScope | null>(null);
  // Agendapunt-modus (ADR 0028): de vraag is geframed door een agendapunt; de
  // toelichting wordt per beurt server-side opgehaald aan de hand van dit id.
  const [agendapuntContext, setAgendapuntContext] =
    useState<AgendapuntContext | null>(null);
  // @-mention-typeahead op documenttitels.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionSuggesties, setMentionSuggesties] = useState<DocSuggestie[]>([]);
  // P2 Deel B — "een document doorgronden": scherpsteltoestand binnen /ai (geen
  // route). Open + het (voorgevulde) document waarop de taak wordt uitgevoerd.
  const [doorgrondOpen, setDoorgrondOpen] = useState(false);
  const [doorgrondDoc, setDoorgrondDoc] = useState<DocumentCtx | null>(null);
  // Ingreep 2 (30-07-2026) — HERKOMST-INGANG. Wordt de assistent geopend vanuit een
  // module (/ai?intent=fonds&herkomst=risicomatrix), dan is de scope al bekend: wie
  // vanuit de risicomatrix een vraag stelt, vraagt naar het eigen fonds. Die kennis
  // gooien we niet weg om hem daarna met patronen te reconstrueren — we sturen hem
  // mee als bevestigde bron-intentie, precies zoals een verduidelijkingschip dat
  // doet. Geldt voor dit gesprek; "Nieuw gesprek" wist hem. Zichtbaar in de header
  // zodat de bestuurder ziet waaróp geantwoord wordt en het kan wegklikken.
  const [herkomst, setHerkomst] = useState<{
    intent: "fonds" | "algemeen";
    module: string;
  } | null>(null);
  // P2 Deel A — de voorbeeldvragen verschijnen pas nadat de gebruiker op "Een vrije
  // vraag stellen" klikte (i.p.v. altijd op de lege staat). De vragen zelf zijn een
  // vaste, generieke set (GENERIEKE_STARTVRAGEN) — geen context/query nodig.
  const [vrijeVraagOpen, setVrijeVraagOpen] = useState(false);
  // Voortgang tijdens het wachten (besluit 0087): één staat die de actieve fase
  // als lopende regel toont en afgeronde fasen (met hun uitkomst) eronder. Bij
  // brede documentanalyse draagt de analyse-fase batch/totaal. null zodra het
  // antwoord begint te streamen (eerste delta) of bij een schone start.
  const [voortgang, setVoortgang] = useState<VoortgangUI | null>(null);
  const supabase = createClient();

  // Haalt de eigen, niet-gearchiveerde gesprekken op voor het overzicht.
  // RLS beperkt dit al tot de eigen gesprekken; de gebruiker_id-filter maakt het
  // expliciet. Best-effort.
  async function laadGesprekken() {
    try {
      const uid = userIdRef.current;
      if (!uid) return;
      const { data } = await supabase
        .from("gesprekken")
        .select("id, titel, bijgewerkt, berichten, document_scope, actieve_antwoordmodus")
        .eq("gebruiker_id", uid)
        .eq("gearchiveerd", false)
        .order("bijgewerkt", { ascending: false })
        .limit(50);
      if (Array.isArray(data)) setGesprekken(data as GesprekItem[]);
    } catch (e) {
      console.error("Gesprekken laden mislukt:", e);
    }
  }

  // Auto-restore-begrenzing (besluit 0086): markeer/wis het actieve gesprek in
  // sessionStorage (per tab). Zo herstelt /ai bij mount alleen een gesprek dat
  // in DEZE browsersessie actief was — niet automatisch het laatste uit de DB.
  function markeerActiefGesprek(id: string) {
    gesprekId.current = id;
    try {
      window.sessionStorage.setItem(ACTIEF_GESPREK_SLEUTEL, id);
    } catch {
      /* private mode e.d. — markering is best-effort */
    }
  }
  function wisActiefGesprek() {
    gesprekId.current = null;
    try {
      window.sessionStorage.removeItem(ACTIEF_GESPREK_SLEUTEL);
    } catch {
      /* best-effort */
    }
  }

  // Herstelde gesprekken (uit de lade of via auto-restore) zijn opgeslagen ná
  // een geslaagde generatie, dus de AI-beurten daarin zijn per definitie
  // voltooid. Gesprekken van vóór besluit 0098 dragen de vlag nog niet; die
  // leiden we af uit de aanwezigheid van `onderbouwing` — die zetten alleen
  // echte antwoorden, niet de welkomsttekst of een foutmelding.
  function herstelVoltooidVlag(lijst: Bericht[]): Bericht[] {
    return lijst.map((b) =>
      b.rol === "ai" && b.voltooid === undefined
        ? { ...b, voltooid: Boolean(b.onderbouwing) }
        : b
    );
  }

  // Opent een bestaand gesprek in de chat — inclusief de opgeslagen scope (§8),
  // zodat een hervat gesprek herkenbaar "over «titel»" blijft.
  function openGesprek(item: GesprekItem) {
    if (laden) return;
    markeerActiefGesprek(item.id);
    setBerichten(
      Array.isArray(item.berichten) && item.berichten.length > 0
        ? herstelVoltooidVlag(item.berichten)
        : welkomstRef.current
        ? [welkomstRef.current]
        : []
    );
    setDocumentScope(leesScope(item.document_scope));
    setAgendapuntContext(leesAgendapuntContext(item.document_scope));
    setAntwoordmodus(leesAntwoordmodus(item.actieve_antwoordmodus));
    setHistorieOpen(false);
  }

  // ── Startpunt-taken (P1, besluit 0085) — routeren/scope-zetten, GEEN nieuwe
  // AI-logica. "Vrije vraag" zet enkel de cursor in het invoerveld. "Een document
  // doorgronden" opent de scherpsteltoestand (P2 Deel B). Het startscherm
  // verdwijnt zodra er een scope of een bericht is. "Agendapunt voorbereiden"
  // routeert (via <Link> in Startpunt) naar de vergaderpagina — geen handler.
  function startVrijeVraag() {
    // Toon de voorbeeldvragen en zet de cursor in het invoerveld.
    setVrijeVraagOpen(true);
    invoerRef.current?.focus();
  }

  // P2 Deel A — een aangeklikte voorbeeldvraag start meteen (patroon STARTVRAGEN
  // in AgendapuntChat). Het zijn generieke vragen zonder koppeling: gewoon een
  // vrije vraag, met een marker in het auditspoor dat een prefill is gebruikt.
  //
  // Ingreep 1 (30-07-2026): de startvraag draagt zijn eigen bron-intentie mee, die
  // we als override meesturen. Zo krijgt een door ONS voorgestelde vraag nooit een
  // verduidelijkingsvraag terug ("Wilt u dit weten voor uw fonds specifiek, of in
  // algemene zin?") en wordt een generieke governance-vraag ook niet stil als
  // fondsvraag geframed. `bronIntentBron` houdt in het auditspoor herleidbaar dat
  // dit een prefill was en géén keuze van de bestuurder.
  function startVoorbeeldvraag(startvraag: Startvraag) {
    if (laden) return;
    stuurBericht(startvraag.vraag, {
      startvraagBron: "voorbeeldvraag",
      bronIntentOverride: startvraag.intent,
      bronIntentBron: "startvraag",
    });
  }

  // P2 Deel B — open de scherpsteltoestand i.p.v. direct scope + focus. De taak
  // wordt pas een gesprek na "Start" (startDoorgronden).
  function startDocumentVraag(doc: DocumentCtx) {
    if (laden) return;
    setVrijeVraagOpen(false);
    setDoorgrondDoc(doc);
    setDoorgrondOpen(true);
  }

  // P2 Deel B — "Start" in de scherpstel: schone start, scope op het document
  // (+ bij "Afwijkingen" de eerdere versie, zodat het model daadwerkelijk kan
  // vergelijken), en één leesbare gebruikersbeurt. De samengestelde instructie +
  // parameterlogging gebeuren server-side (route.ts).
  function startDoorgronden(
    doc: DoorgrondDoc,
    secties: DoorgrondSectieId[],
    vorige: DoorgrondDoc | null
  ) {
    if (laden || secties.length === 0) return;
    wisActiefGesprek();
    setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    setAgendapuntContext(null);
    // De voorganger komt ALLEEN in de scope (en het auditspoor) als "Afwijkingen"
    // gekozen is — anders zou een pure "Samenvatting" de hele vorige versie
    // meetrekken (retrieval-dilutie) en een niet-gevraagde vergelijking loggen.
    const vergelijk = secties.includes("afwijkingen") ? vorige : null;
    const ids = vergelijk ? [doc.id, vergelijk.id] : [doc.id];
    const titels = vergelijk ? [doc.titel, vergelijk.titel] : [doc.titel];
    const scope: DocumentScope = { document_ids: ids, titels };
    setDocumentScope(scope);
    setDoorgrondOpen(false);
    setDoorgrondDoc(null);
    // Leesbare gebruikersbeurt (B5), uit dezelfde bron als de server-instructie.
    const zin = bouwDoorgrondZin(doc.titel, secties);
    void stuurBericht(zin, {
      scopeOverride: scope,
      // De scope in dezelfde tick gezet én verstuurd → expliciet meegeven voor opslag.
      persistScope: scope,
      doorgrond: { secties, vorigeId: vergelijk?.id ?? null },
    });
  }

  // Archiveert een gesprek (soft-delete). governance_log blijft intact. Als het
  // huidige gesprek wordt gearchiveerd, start een schone weergave.
  async function archiveerGesprek(id: string) {
    try {
      await supabase.from("gesprekken").update({ gearchiveerd: true }).eq("id", id);
    } catch (e) {
      console.error("Gesprek archiveren mislukt:", e);
    }
    if (gesprekId.current === id) {
      wisActiefGesprek();
      setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
      setDocumentScope(null);
      setAgendapuntContext(null);
    }
    laadGesprekken();
  }

  // Slaat het gesprek best-effort op. Faalt veilig: een mislukte opslag mag de
  // chat nooit verstoren. governance_log (auditspoor) staat hier los van.
  // `scopeVoorOpslag` is de GESPREKSSCOPE die bewaard moet worden. Normaal is dat
  // gewoon de gecommitte `documentScope`-state; alleen wanneer een taak de scope in
  // dezelfde tick zet én verstuurt (P2 "doorgronden") geeft de aanroeper de nieuwe
  // scope expliciet mee (anders zou de nog-niet-gecommitte closure worden bewaard).
  // Bewust NIET de per-turn `scopeOverride` van een vervolgactie: die is een
  // retrieval-override en mag de bewaarde gespreksscope niet wijzigen.
  async function bewaarGesprek(
    finale: Bericht[],
    scopeVoorOpslag: DocumentScope | null
  ) {
    try {
      const uid = userIdRef.current;
      if (!uid || !fondsId || finale.length === 0) return;
      const eersteVraag =
        finale.find((b) => b.rol === "gebruiker")?.tekst || "Gesprek";
      const titel = eersteVraag.slice(0, 80);

      // Scope meeschrijven als jsonb {type, document_ids, titels, gezet_op}.
      // ADR 0028: in agendapunt-modus bewaren we additief agendapunt_context, ook
      // als er 0 stukken zijn (documentScope null) — zodat de framing terugkomt.
      const scopePayload =
        scopeVoorOpslag || agendapuntContext
          ? {
              type: "single",
              document_ids: scopeVoorOpslag?.document_ids ?? [],
              titels: scopeVoorOpslag?.titels ?? [],
              algemene_kennis: scopeVoorOpslag?.algemene_kennis === true,
              ...(agendapuntContext
                ? {
                    agendapunt_context: {
                      id: agendapuntContext.id,
                      titel: agendapuntContext.titel,
                    },
                  }
                : {}),
              gezet_op: new Date().toISOString(),
            }
          : null;

      if (gesprekId.current) {
        await supabase
          .from("gesprekken")
          .update({
            berichten: finale,
            document_scope: scopePayload,
            actieve_antwoordmodus: antwoordmodus,
            bijgewerkt: new Date().toISOString(),
          })
          .eq("id", gesprekId.current);
      } else {
        const { data } = await supabase
          .from("gesprekken")
          .insert({
            gebruiker_id: uid,
            fonds_id: fondsId,
            titel,
            berichten: finale,
            document_scope: scopePayload,
            actieve_antwoordmodus: antwoordmodus,
          })
          .select("id")
          .single();
        if (data?.id) markeerActiefGesprek(data.id as string);
      }
      // Ververs het overzicht zodat nieuwe/bijgewerkte gesprekken bovenaan komen.
      laadGesprekken();
    } catch (e) {
      console.error("Gesprek opslaan mislukt:", e);
    }
  }

  function scrollNaarBron(berichtIdx: number, bronIdx: number) {
    // Increment I-1 — de bronkaarten leven in het (standaard ingeklapte) paneel
    // "Onderbouwing en bronnen"; open het eerst, scrol daarna na de render.
    setOpenPanelen((s) => new Set(s).add(berichtIdx));
    window.setTimeout(() => {
      const el = document.getElementById(`bron-${berichtIdx}-${bronIdx}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setHighlight({ berichtIdx, bronIdx });
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlight(null);
      highlightTimer.current = null;
    }, 2000);
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        userIdRef.current = user.id;
        const { data } = await supabase
          .from("profielen")
          .select("fonds_id, naam, rol, standaard_ai_modus, fondsen(naam)")
          .eq("id", user.id)
          .single();
        if (data?.fonds_id) setFondsId(data.fonds_id);

        const voornaam = (data?.naam as string | null)?.split(" ")[0] || "";
        setVoornaam(voornaam);
        const fondsenRel = data?.fondsen as
          | { naam: string }
          | { naam: string }[]
          | null
          | undefined;
        const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
        const fondsnaam =
          fondsenObj?.naam || "uw fonds";
        if (fondsenObj?.naam) setFondsNaam(fondsenObj.naam);

        const groet = dagdeelGroet();
        const personalTekst = voornaam
          ? `${groet} ${voornaam}, fijn u te zien.\n\nIk help u graag met vragen rondom ${fondsnaam}.\n\nElke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt.`
          : `${groet}. Ik help u graag met vragen rondom ${fondsnaam}.\n\nElke vraag wordt vastgelegd in de Governance Log.`;

        welkomstRef.current = { rol: "ai", tekst: personalTekst };

        // Auto-restore (Fase B2), begrensd tot de browsersessie (besluit 0086).
        // We herstellen ALLEEN als er in DEZE tab een actief-gesprek-markering is
        // (sessionStorage) — niet automatisch het laatste gesprek uit de DB. Zo
        // landt een terugkerende gebruiker (nieuwe tab / opnieuw ingelogd) op het
        // startpunt. De gesprekken-lade houdt alle gesprekken bereikbaar. RLS +
        // de expliciete gebruiker_id-filter beperken tot de eigen gesprekken.
        let hersteld = false;
        let actiefGesprekId: string | null = null;
        try {
          actiefGesprekId = window.sessionStorage.getItem(ACTIEF_GESPREK_SLEUTEL);
        } catch {
          actiefGesprekId = null;
        }
        if (actiefGesprekId) {
          try {
            const { data: laatste } = await supabase
              .from("gesprekken")
              .select("id, berichten, document_scope, actieve_antwoordmodus")
              .eq("gebruiker_id", user.id)
              .eq("gearchiveerd", false)
              .eq("id", actiefGesprekId)
              .maybeSingle();

            const opgeslagen = laatste?.berichten as Bericht[] | undefined;
            if (laatste?.id && Array.isArray(opgeslagen) && opgeslagen.length > 0) {
              markeerActiefGesprek(laatste.id as string);
              setBerichten(herstelVoltooidVlag(opgeslagen));
              setDocumentScope(leesScope(laatste.document_scope));
              setAgendapuntContext(leesAgendapuntContext(laatste.document_scope));
              setAntwoordmodus(leesAntwoordmodus(laatste.actieve_antwoordmodus));
              hersteld = true;
            } else {
              // Markering wees naar een gearchiveerd/verwijderd gesprek → opruimen.
              wisActiefGesprek();
            }
          } catch (e) {
            console.error("Gesprek herstellen mislukt:", e);
          }
        }

        if (!hersteld) {
          setBerichten([{ rol: "ai", tekst: personalTekst }]);
          // Increment F (A4) — profiel-default voorselecteert de antwoordmodus bij
          // een schone start (geen hersteld gesprek met eigen vastgezette modus).
          const profielModus = leesAntwoordmodus(data?.standaard_ai_modus);
          if (profielModus) setAntwoordmodus(profielModus);
        }

        // Instappunt-knop "Vraag de AI over dit stuk": /ai?doc=<id> opent de chat
        // met scope op dat document. We zetten de scope expliciet (validatie volgt
        // server-side bij de eerste vraag). Een nieuw gesprek starten zodat de
        // scope niet over een bestaand gesprek heen valt.
        try {
          const docParam = new URLSearchParams(window.location.search).get("doc");
          if (docParam) {
            const { data: d } = await supabase
              .from("documenten")
              .select("id, titel, actief")
              .eq("id", docParam)
              .maybeSingle();
            if (d?.id && d.actief !== false) {
              gesprekId.current = null;
              setBerichten([{ rol: "ai", tekst: personalTekst }]);
              setDocumentScope({
                document_ids: [d.id as string],
                titels: [(d.titel as string) || "dit document"],
              });
            }
          }
        } catch (e) {
          console.error("Scope uit ?doc= zetten mislukt:", e);
        }

        // Instappunt-knop "Vraag de AI over dit agendapunt": /ai?agendapunt=<id>
        // opent de chat geframed door het agendapunt (ADR 0028). We laden id+titel
        // (RLS) en koppelen de actieve stukken als retrieval-scope. De toelichting
        // zelf wordt server-side per beurt opgehaald — niet hier meegegeven. Een
        // nieuw gesprek starten zodat de framing niet over een bestaand gesprek
        // heen valt.
        try {
          const apParam = new URLSearchParams(window.location.search).get(
            "agendapunt"
          );
          if (apParam) {
            const { data: ap } = await supabase
              .from("agendapunten")
              .select("id, titel")
              .eq("id", apParam)
              .maybeSingle();
            if (ap?.id) {
              const { data: stukken } = await supabase
                .from("documenten")
                .select("id, titel")
                .eq("agendapunt_id", ap.id)
                .eq("actief", true);
              const geldig = Array.isArray(stukken)
                ? stukken.filter(
                    (s): s is { id: string; titel: string } =>
                      typeof s?.id === "string"
                  )
                : [];
              gesprekId.current = null;
              setBerichten([{ rol: "ai", tekst: personalTekst }]);
              setAgendapuntContext({
                id: ap.id as string,
                titel: (ap.titel as string) || "dit agendapunt",
              });
              setDocumentScope(
                geldig.length > 0
                  ? {
                      document_ids: geldig.map((s) => s.id),
                      titels: geldig.map((s) => s.titel || "stuk"),
                    }
                  : null
              );
            }
          }
        } catch (e) {
          console.error("Scope uit ?agendapunt= zetten mislukt:", e);
        }

        // Ingreep 2 — module-ingang: /ai?intent=fonds&herkomst=<module>. Zet de
        // bevestigde bron-intentie voor dit gesprek. Bewust NA de ?doc=/?agendapunt=-
        // takken: die zetten een document-scope, en dan negeert de route de
        // bron-intentie toch (scopeActief ⇒ bronIntentResultaat = null). De
        // parameter is een gebruikersactie (hij klikte in die module op de knop),
        // geen heuristiek — daarom mag hij het vertrouwen op "zeker" zetten.
        try {
          const params = new URLSearchParams(window.location.search);
          const intentParam = params.get("intent");
          if (intentParam === "fonds" || intentParam === "algemeen") {
            const moduleParam = (params.get("herkomst") || "").slice(0, 40);
            setHerkomst({
              intent: intentParam,
              // Alleen een sobere slug toestaan; de waarde landt in het auditspoor
              // en (als label) in de UI, dus geen vrije tekst uit de URL.
              module: /^[a-z0-9-]{1,40}$/.test(moduleParam) ? moduleParam : "portaal",
            });
          }
        } catch (e) {
          console.error("Bron-intentie uit ?intent= zetten mislukt:", e);
        }

        // Vul het gesprekken-overzicht.
        laadGesprekken();
      }
    });
  }, []);

  useEffect(() => {
    // Scroll alleen wanneer er een nieuw doel is gezet (na het versturen van een
    // vraag) — niet bij elk gestreamd token. Daardoor blijft de weergave aan het
    // begin van het antwoord staan in plaats van mee te schieten naar onderen.
    if (scrollDoel.current != null) {
      document
        .getElementById(`bericht-${scrollDoel.current}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      scrollDoel.current = null;
    }
  }, [berichten]);

  // Increment I-1 — vervolgacties kunnen de antwoordmodus en/of de bronselectie
  // voor één turn overrulen zonder de gespreksinstelling te wijzigen.
  interface StuurOpties {
    antwoordmodusOverride?: Antwoordmodus | null;
    scopeOverride?: DocumentScope | null;
    // Increment I-2 (FO §11a) — bevestigde bron-intentie na een verduidelijkingschip.
    bronIntentOverride?: "fonds" | "algemeen";
    // Waar komt die bevestigde intentie vandaan (ingreep 1/2)? Uitsluitend voor het
    // auditspoor: "chip" = de bestuurder koos zelf, "startvraag" = prefill uit onze
    // eigen copy, "herkomst" = de module waaruit de assistent is geopend. Zonder dit
    // onderscheid staat in de log alleen dat er een override wás, niet van wie.
    bronIntentBron?: "chip" | "startvraag" | "herkomst";
    // 30-07-2026 — zet de actualiteitsfilter uit voor deze beurt: neem stukken met
    // status concept/ter bespreking/vervallen mee. Alleen via de expliciete chip.
    neemNietVastgesteldeMee?: boolean;
    // Stuurt dezelfde (al getoonde) vraag opnieuw zonder een nieuwe gebruikersbubbel
    // toe te voegen; `basisBerichten` is dan de geschiedenis die op die vraag eindigt.
    geenNieuweVraag?: boolean;
    basisBerichten?: Bericht[];
    // FO §13 — transformatie-vervolgactie: bewerk het vorige antwoord i.p.v. een
    // nieuwe documentvraag. De route schakelt dan naar herschrijf-intent.
    transformatie?: boolean;
    // P2 Deel B — "een document doorgronden": de gekozen secties (+ bij Afwijkingen
    // de eerdere versie). De route stelt hieruit de instructie samen en logt de
    // parameters; de zichtbare beurt blijft de korte zin.
    doorgrond?: { secties: DoorgrondSectieId[]; vorigeId: string | null };
    // P2 Deel A — markeert dat deze beurt uit een aangeklikte voorbeeldvraag komt
    // (telemetrie in het auditspoor; onderscheidt prefill van zelf getypt).
    startvraagBron?: "voorbeeldvraag";
    // De GESPREKSSCOPE die bij deze beurt bewaard moet worden. Alleen nodig als een
    // taak de scope in dezelfde tick zet én verstuurt (doorgronden) — dan is de
    // `documentScope`-state nog niet gecommit. Losstaand van `scopeOverride`, dat
    // een puur PER-TURN retrieval-override is (vervolgacties) en de bewaarde
    // gespreksscope juist NIET mag wijzigen.
    persistScope?: DocumentScope | null;
  }

  async function stuurBericht(vraag?: string, opties?: StuurOpties) {
    const tekst = vraag || invoer.trim();
    if (!tekst || laden) return;
    setInvoer("");
    setVrijeVraagOpen(false);
    setLaden(true);

    // Eén-turn-overrides (vervolgacties); undefined = gebruik de gespreksstaat.
    const effAntwoordmodus =
      opties?.antwoordmodusOverride !== undefined
        ? opties.antwoordmodusOverride
        : antwoordmodus;
    const effScope =
      opties?.scopeOverride !== undefined ? opties.scopeOverride : documentScope;
    // De te BEWAREN gespreksscope. Default = de (gecommitte) documentScope-state,
    // zodat vervolgacties met een per-turn scopeOverride de bewaarde gespreksscope
    // NIET wijzigen (regressie-fix). Alleen doorgronden geeft persistScope mee,
    // omdat het de scope in dezelfde tick zet én verstuurt (state nog niet gecommit).
    const scopeVoorOpslag =
      opties?.persistScope !== undefined ? opties.persistScope : documentScope;

    // Voeg de nieuwe vraag toe en stuur de complete geschiedenis mee. Bij een
    // verduidelijkingsvervolg (geenNieuweVraag) eindigt `basisBerichten` al op de
    // oorspronkelijke vraag; we voegen geen tweede gebruikersbubbel toe en wissen
    // tegelijk de verduidelijkingsbubbel uit de weergave.
    const basis = opties?.basisBerichten ?? berichten;
    const nieuw: Bericht = { rol: "gebruiker", tekst };
    const conversatie = opties?.geenNieuweVraag ? basis : [...basis, nieuw];
    setBerichten(conversatie);
    // Scroll het zojuist gestelde bericht naar boven, zodat het antwoord eronder
    // vanaf het begin in beeld komt te staan.
    scrollDoel.current = conversatie.length - 1;

    // Bouw de messages-array voor de API. We slaan het eerste bericht over
    // als dat de welkomst-AI-tekst is (puur UI, geen onderdeel van het gesprek).
    const messages = conversatie
      .filter((b, i) => !(i === 0 && b.rol === "ai"))
      .map((b) => ({
        role: b.rol === "gebruiker" ? ("user" as const) : ("assistant" as const),
        content: b.tekst,
      }));

    setAntwoordGestart(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          fonds_id: fondsId,
          // Increment I-2 (FO §11a) — geen zichtbare bron-modus meer; alleen de
          // expliciete restrictie + (na een chip) de bevestigde bron-intentie.
          alleen_fondsdocumenten: alleenFondsdocumenten,
          // Precedentie: een expliciete keuze in DEZE beurt (chip of startvraag)
          // gaat vóór de herkomst-ingang van het gesprek (ingreep 2).
          bron_intent_override: opties?.bronIntentOverride ?? herkomst?.intent,
          // Auditspoor (ingreep 1/2): van wie kwam de bevestigde intentie? Zonder
          // dit staat er alleen dát er een override was, niet wie hem zette.
          bron_intent_bron:
            opties?.bronIntentBron ?? (herkomst ? "herkomst" : undefined),
          bron_intent_herkomst: herkomst?.module,
          document_scope: effScope
            ? {
                document_ids: effScope.document_ids,
                algemene_kennis: effScope.algemene_kennis === true,
              }
            : undefined,
          // Increment G — vastgezette antwoordmodus (null = auto-detectie).
          actieve_antwoordmodus: effAntwoordmodus,
          // Increment F (FO §14) — "algemeen perspectief": profielsturing overslaan.
          algemeen_perspectief: algemeenPerspectief,
          // FO §13 — transformatie-vervolgactie (herschrijf-intent op vorige antwoord).
          transformatie: opties?.transformatie === true,
          // ADR 0028 — agendapunt-modus: alleen het id (+ titel voor de UI). De
          // route haalt de toelichting zelf op onder RLS; de client-titel wordt
          // niet vertrouwd voor de promptinhoud. Precedentie: stuurt een
          // vervolgactie tegelijk een per-turn scopeOverride mee, dan wint
          // agendapunt-modus server-side (route.ts) — die override-stukken worden
          // dan agendapunt-retrievalscope i.p.v. een strikte document-scope.
          agendapunt_context: agendapuntContext
            ? { id: agendapuntContext.id, titel: agendapuntContext.titel }
            : undefined,
          // P2 Deel B — de doorgrond-parameters; de route stelt hieruit de
          // instructie samen en logt ze in retrieval_meta (criterium 13).
          doorgrond: opties?.doorgrond
            ? {
                secties: opties.doorgrond.secties,
                vorige_document_id: opties.doorgrond.vorigeId ?? undefined,
              }
            : undefined,
          // P2 Deel A — herkomst voorbeeldvraag, meegelogd (criterium 4).
          startvraag_bron: opties?.startvraagBron,
          // 30-07-2026 — expliciete verbreding na de melding "wel stukken, niet
          // vastgesteld". Alleen true als de gebruiker de chip aanklikte.
          neem_niet_vastgestelde_mee: opties?.neemNietVastgesteldeMee === true,
        }),
      });

      // Fouten (400/401/500) komen als JSON terug, niet als stream.
      if (!res.ok || !res.body) {
        const fout = await res.json().catch(() => null);
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: fout?.error || "Er is een fout opgetreden." },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aiToegevoegd = false;
      // Is de generatie NETJES afgerond ('done' ontvangen)? Alleen dan mag er
      // gekopieerd worden (besluit 0098 §4). `!laden` is daarvoor niet genoeg:
      // bij een verbindingsfout zet het finally-blok `laden` ook op false, en
      // dan zou een half gestreamd antwoord een kopieerknop krijgen met een
      // volledige herkomstregel eronder.
      let voltooid = false;
      let volledig = "";
      let bronnenData: Bron[] | undefined;
      let modusData: Modus = "combineren";
      // Increment I-2 — bij een twijfelgeval stuurt de server één verduidelijkings-
      // event i.p.v. een antwoord; dan slaan we het 'done'-overschrijven over.
      let verduidelijkingActief = false;
      // Increment I-1 — rustige weergave: per-antwoord controle-informatie en
      // conditionele inline-meldingen (FO §11c).
      let onderbouwingData: OnderbouwingMeta | undefined;
      let inlineMeldingenData: InlineMelding[] | undefined;
      // 30-07-2026 — verbredings-aanbod (niet-vastgestelde stukken meenemen).
      let verbredingData: Bericht["verbreding"] | undefined;
      // Besluit 0092 — de verduidelijkingsbeurt als bewaarbaar bericht. Zonder dit
      // bleef een vraag die in de terugvraag eindigde nergens staan: `bewaarGesprek`
      // liep alleen bij gestreamde antwoordtekst, en de server sloeg de logregel over.
      let verduidelijkingBericht: Bericht | undefined;

      // Werkt het laatste (AI-)bericht bij, of voegt het toe als het nog niet
      // bestaat. Bronnen worden meegegeven zodra die binnen zijn.
      const schrijfAi = () => {
        setBerichten((prev) => {
          if (!aiToegevoegd) return prev; // veiligheid
          const kopie = [...prev];
          kopie[kopie.length - 1] = {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            modus: modusData,
            onderbouwing: onderbouwingData,
            inlineMeldingen: inlineMeldingenData,
            verbreding: verbredingData,
            voltooid,
          };
          return kopie;
        });
      };

      const verwerkEvent = (raw: string) => {
        const regel = raw.replace(/^data: ?/, "").trim();
        if (!regel) return;
        let evt: {
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
          // 30-07-2026 — de actualiteitsfilter nam alle treffers weg terwijl er wél
          // niet-vastgestelde fondsstukken zijn: aanbod om ze mee te nemen.
          verbreding?: {
            type: "niet_vastgesteld";
            aantal: number;
            titels: string[];
            label: string;
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
        };
        try {
          evt = JSON.parse(regel);
        } catch {
          return;
        }

        if (evt.type === "verduidelijking") {
          // Twijfelgeval: toon de verduidelijkingsvraag met twee chips, géén
          // antwoord. aiToegevoegd voorkomt dat het vangnet "geen antwoord" slaat;
          // verduidelijkingActief voorkomt dat 'done' de bubbel overschrijft.
          verduidelijkingActief = true;
          aiToegevoegd = true;
          setVoortgang(null);
          verduidelijkingBericht = {
            rol: "ai",
            tekst:
              evt.vraag ||
              "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?",
            verduidelijking: {
              vraag: evt.vraag || "",
              opties: evt.opties ?? [],
              origineleVraag: tekst,
            },
          };
          setBerichten((prev) => [...prev, verduidelijkingBericht!]);
        } else if (evt.type === "meta") {
          bronnenData = evt.bronnen;
          modusData = evt.modus || "combineren";
          // Increment I-1 — controle-informatie naar het paneel "Onderbouwing en
          // bronnen" (per antwoord, standaard ingeklapt) i.p.v. een globale balk.
          const aantal = evt.bronnen?.length ?? 0;
          onderbouwingData = {
            bronbasis: evt.bronbasis ?? null,
            antwoordmodusLabel: evt.antwoordmodus_label ?? evt.antwoordmodus ?? null,
            antwoordmodus: evt.antwoordmodus ?? null,
            retrievalModus: evt.retrieval_modus ?? null,
            peildatum: evt.peildatum ?? null,
            algemeneKennis: evt.bronbasis
              ? /algemene kennis/i.test(evt.bronbasis)
              : undefined,
            aantalBronnen: aantal,
            // Increment I-2 — automatische bronkeuze (alleen in het controlevlak).
            bronIntent: evt.bron_intent ?? null,
            bronVertrouwen: evt.bron_vertrouwen ?? null,
            alleenFondsdocumenten: evt.alleen_fondsdocumenten ?? null,
            bronIntentOverride: evt.bron_intent_override ?? null,
            // Contextbesef (besluit 0090) — portaalstand als aparte aanduiding.
            portaalstandGebruikt: evt.portaalstand_gebruikt ?? null,
            // Increment I-3 — web-retrieval is (nog) niet actief (Scenario B); de
            // model_knowledge-bronnen volgen in het 'done'-event (content-afhankelijk).
            webRetrievalActief: evt.web_retrieval_actief ?? false,
            modelKennis: [],
            // Increment F (FO §14) — transparantie profielsturing in het controlevlak.
            profielsturing: evt.profielsturing ?? null,
            // OP-4 (FO §8) — organisatieprofiel in het controlevlak (status + veldgroepen).
            organisatieprofiel: evt.organisatieprofiel ?? null,
            organisatieprofielAspecten: evt.organisatieprofiel_aspecten ?? null,
            // B1 / scope-split — documentgericht bepaalt in de render welke
            // vervolgacties (duiding/kritische vragen) blijven staan.
            documentGericht: evt.document_gericht ?? null,
            vervolgvragen: [],
          };
          // Deterministische inline-meldingen (pre-stream); de #4-melding kan in
          // het 'done'-event nog worden aangevuld.
          inlineMeldingenData = evt.inline_meldingen ?? [];
          // 30-07-2026 — nam de actualiteitsfilter alle treffers weg? Dan biedt de
          // server één verbredings-chip aan; de vraag bewaren we mee zodat de chip
          // exact dezelfde vraag opnieuw kan stellen.
          verbredingData = evt.verbreding
            ? { ...evt.verbreding, vraag: tekst }
            : undefined;
        } else if (evt.type === "progress") {
          // Voortgang per bereikte serverfase (besluit 0087) — gedeelde reducer.
          setVoortgang((v) => pasVoortgangToe(v, evt));
        } else if (evt.type === "delta") {
          volledig += evt.text || "";
          if (!aiToegevoegd) {
            aiToegevoegd = true;
            setVoortgang(null); // analyse klaar, antwoord begint
            setAntwoordGestart(true);
            setBerichten((prev) => [
              ...prev,
              {
                rol: "ai",
                tekst: volledig,
                bronnen: bronnenData,
                modus: modusData,
                onderbouwing: onderbouwingData,
                inlineMeldingen: inlineMeldingenData,
                verbreding: verbredingData,
              },
            ]);
          } else {
            schrijfAi();
          }
        } else if (evt.type === "done") {
          // Bij een verduidelijking is er geen antwoordbubbel om bij te werken.
          if (verduidelijkingActief) return;
          // Vanaf hier is de generatie netjes afgerond; pas nu mag er gekopieerd.
          voltooid = true;
          // Definitieve (content-afhankelijke) inline-meldingen, incl. #4.
          if (evt.inline_meldingen) inlineMeldingenData = evt.inline_meldingen;
          // Increment I-3 — de afgeleide model_knowledge-bronnen (algemene kennis
          // met genoemde instantie) komen in het 'done'-event en horen in het paneel.
          if (evt.model_kennis && onderbouwingData) {
            onderbouwingData = { ...onderbouwingData, modelKennis: evt.model_kennis };
          }
          // Scenario A (besluit 0072) — de geverifieerde webbronnen + vlag komen in
          // het 'done'-event (content-afhankelijk) en horen in het paneel.
          if (onderbouwingData) {
            onderbouwingData = {
              ...onderbouwingData,
              webRetrievalActief: evt.web_retrieval_actief ?? onderbouwingData.webRetrievalActief ?? false,
              webBronnen: evt.web_bronnen ?? onderbouwingData.webBronnen ?? [],
            };
          }
          // B1 — inhoudelijke vervolgvragen (kunnen leeg zijn) naar het bericht.
          if (onderbouwingData) {
            onderbouwingData = {
              ...onderbouwingData,
              vervolgvragen: evt.vervolgvragen ?? [],
            };
          }
          // 30-07-2026 — definitieve verbredings-aanbieding (kan in 'done' pas
          // definitief zijn; blijft anders staan zoals in 'meta' gezet).
          if (evt.verbreding !== undefined) {
            verbredingData = evt.verbreding
              ? { ...evt.verbreding, vraag: tekst }
              : undefined;
          }
          schrijfAi();
        } else if (evt.type === "error") {
          if (!aiToegevoegd) {
            setBerichten((prev) => [
              ...prev,
              { rol: "ai", tekst: evt.error || "Er is een fout opgetreden." },
            ]);
            aiToegevoegd = true;
          }
        }
      };

      // Lees de SSE-stream; events zijn gescheiden door een lege regel.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const delen = buffer.split("\n\n");
        buffer = delen.pop() || "";
        for (const deel of delen) verwerkEvent(deel);
      }
      if (buffer.trim()) verwerkEvent(buffer);

      // Vangnet: stream eindigde zonder enige tekst.
      if (!aiToegevoegd) {
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: "Er is geen antwoord ontvangen. Probeer het opnieuw." },
        ]);
      } else if (volledig.trim()) {
        // Persisteer het gesprek (Fase B2) na een geslaagd antwoord.
        const finale: Bericht[] = [
          ...conversatie,
          {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            modus: modusData,
            onderbouwing: onderbouwingData,
            inlineMeldingen: inlineMeldingenData,
          },
        ];
        await bewaarGesprek(finale, scopeVoorOpslag);
      } else if (verduidelijkingBericht) {
        // Besluit 0092 — ook een TERUGVRAAG is een beurt: bewaren zodat de vraag een
        // refresh overleeft en in de lade "Gesprekken" terugkomt. Klikt de bestuurder
        // daarna op een chip, dan overschrijft die beurt dezelfde gespreksrij
        // (`gesprekId` is dan gezet) met de vraag + het echte antwoord — de
        // verduidelijkingsbubbel verdwijnt dus netjes, geen dubbele beurt.
        await bewaarGesprek([...conversatie, verduidelijkingBericht], scopeVoorOpslag);
      }
    } catch {
      setBerichten((prev) => [
        ...prev,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ]);
    } finally {
      setLaden(false);
      setAntwoordGestart(false);
      setVoortgang(null);
    }
  }

  // Increment I-2 (FO §11a) — de bestuurder koos een verduidelijkingschip. We
  // sturen DEZELFDE vraag opnieuw met de bevestigde bron-intentie en wissen de
  // verduidelijkingsbubbel; de oorspronkelijke vraag blijft staan (geen tweede
  // gebruikersbubbel). "Voor mijn fonds" = fonds-intentie (combineren-vloer, geen
  // harde scope); "In algemene zin" = algemeen-intentie.
  function kiesVerduidelijking(
    intent: "fonds" | "algemeen",
    origineleVraag: string,
    idx: number
  ) {
    if (laden) return;
    const basis = berichten.slice(0, idx); // laat de verduidelijkingsbubbel vallen
    stuurBericht(origineleVraag, {
      bronIntentOverride: intent,
      bronIntentBron: "chip",
      geenNieuweVraag: true,
      basisBerichten: basis,
    });
  }

  // 30-07-2026 — de bestuurder koos "Neem niet-vastgestelde stukken mee". We
  // stellen DEZELFDE vraag opnieuw met de actualiteitsfilter uit. Anders dan bij de
  // verduidelijkingschip laten we het eerdere antwoord staan: dat antwoord was niet
  // fout (er is geen actuele bron), het is alleen niet het hele beeld. Zo blijft in
  // het gesprek zichtbaar dat er eerst niets actueels was — belangrijk voor de
  // navolgbaarheid van wat de bestuurder heeft gezien.
  function kiesVerbreding(
    origineleVraag: string,
    bronIntent: "fonds" | "algemeen" | "gecombineerd" | null
  ) {
    if (laden) return;
    // De intentie van het antwoord dat we verbreden gaat MEE. Zonder dat
    // classificeerde de route de vraag opnieuw, kwam bij een ankerloze vraag weer
    // op 'onzeker' uit en vuurde de verduidelijkingstak — waarmee de chip precies
    // niet werkte voor de vragen die met een terugvraag begonnen (geconstateerd in
    // productie, 30-07-2026). 'gecombineerd' en 'onbekend' vallen terug op "fonds":
    // de verbreding gaat per definitie over weggefilterde FONDSstukken.
    stuurBericht(origineleVraag, {
      neemNietVastgesteldeMee: true,
      bronIntentOverride: bronIntent === "algemeen" ? "algemeen" : "fonds",
      bronIntentBron: "chip",
    });
  }

  // Besluit 0099 — vervolgactie vanuit de documentlijst: zet de bestaande
  // client-scope en zet de cursor in het invoerveld. Bewust GEEN vraag versturen:
  // de bestuurder formuleert zelf wat hij wil weten. De server-side validatie
  // (valideerScope: bestaat, actief, geïndexeerd, RLS-toegang) blijft onverkort
  // leidend en wordt pas bij het versturen doorlopen; een geweigerd document
  // geeft daar de bestaande zichtbare fout — nooit een stille terugval.
  function scopeUitDocumentlijst(documentIds: string[], titels: string[]) {
    if (laden || documentIds.length === 0) return;
    setAgendapuntContext(null);
    setDocumentScope({ document_ids: documentIds, titels, algemene_kennis: true });
    invoerRef.current?.focus();
  }

  // Increment I-1 (FO §11c) — open/sluit het onderbouwingspaneel van één bericht.
  function togglePaneel(idx: number) {
    setOpenPanelen((s) => {
      const kopie = new Set(s);
      if (kopie.has(idx)) kopie.delete(idx);
      else kopie.add(idx);
      return kopie;
    });
  }

  // Increment I-1 (FO §13) — voer een contextbewuste vervolgactie uit. Reformat-
  // acties hergebruiken strikt dezelfde bronselectie als het oorspronkelijke
  // antwoord; verbredende acties (besluitvorming, tijdlijn) niet.
  function stuurVervolgactie(actie: Vervolgactie, bron: Bericht, idx: number) {
    if (actie.type === "toon_bronnen") {
      setOpenPanelen((s) => new Set(s).add(idx));
      return;
    }
    const docIds = [...new Set((bron.bronnen ?? []).map((b) => b.document_id))];
    const scopeOverride: DocumentScope | null =
      actie.hergebruikScope && docIds.length > 0
        ? {
            document_ids: docIds,
            titels: [...new Set((bron.bronnen ?? []).map((b) => b.titel))],
            algemene_kennis: true,
          }
        : null;
    stuurBericht(actie.prompt, {
      antwoordmodusOverride: actie.modus,
      scopeOverride,
      transformatie: isTransformatieActie(actie.type),
    });
  }

  function startNieuwGesprek() {
    if (laden) return;
    // Met het gesprekken-overzicht hoeft "nieuw" niets te wissen: het lopende
    // gesprek blijft gewoon in de lijst staan. We starten enkel een schone chat.
    gesprekId.current = null;
    setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    setInvoer("");
    setDocumentScope(null);
    setAgendapuntContext(null);
    setHerkomst(null); // ingreep 2 — de module-ingang gold voor het vorige gesprek
    setVrijeVraagOpen(false);
    sluitMention();
    setHistorieOpen(false);
  }

  // ── @-mention-typeahead op documenttitels ──────────────────────────────────
  // Detecteert een `@…`-fragment aan het eind van de invoer en opent een
  // typeahead. RLS beperkt de zoekresultaten tot het eigen fonds (+ generiek).
  function verwerkInvoer(waarde: string) {
    setInvoer(waarde);
    const m = waarde.match(/@([^\s@]*)$/);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[1]);
    } else {
      sluitMention();
    }
  }

  function sluitMention() {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionSuggesties([]);
  }

  // Selectie zet de scope (single → vervangt een bestaande scope) en verwijdert
  // het @-fragment uit de invoer. Selectie is altijd expliciet (§4).
  function kiesDocument(s: DocSuggestie) {
    // Een expliciete documentkeuze verlaat de agendapunt-modus (ADR 0028): de
    // gebruiker stuurt nu zelf op één stuk i.p.v. de agendapunt-framing.
    setAgendapuntContext(null);
    setDocumentScope({ document_ids: [s.id], titels: [s.titel] });
    setInvoer((huidig) => huidig.replace(/@([^\s@]*)$/, "").trimEnd());
    sluitMention();
  }

  // Gedeelde documentzoek-suggestiebron (ILIKE op titel, eigen fonds via RLS).
  // Eén implementatie voor zowel de @-mention-typeahead als de documentkiezer in
  // "een document doorgronden" (P2 Deel B, criterium 8 — geen tweede zoekcode).
  const zoekDocumenten = useCallback(
    async (query: string): Promise<DocSuggestie[]> => {
      try {
        let q = supabase
          .from("documenten")
          .select("id, titel, bron, bestandstype, aangemaakt")
          .eq("actief", true)
          .order("aangemaakt", { ascending: false })
          .limit(8);
        if (query.trim()) q = q.ilike("titel", `%${query.trim()}%`);
        const { data } = await q;
        return Array.isArray(data) ? (data as DocSuggestie[]) : [];
      } catch (e) {
        console.error("Documenten zoeken mislukt:", e);
        return [];
      }
    },
    // supabase is de browser-client (effectief stabiel); bewust buiten de deps,
    // conform de bestaande effecten in dit bestand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Bepaalt de aantoonbaar eerdere versie van een document (besluitpunt 2):
  // documenten.vervangt_document_id (self-FK, server-side afgedwongen bij de
  // overgang naar status 'vervangen'). RLS scoopt beide reads tot het eigen fonds.
  const haalVorigeVersie = useCallback(
    async (docId: string): Promise<DoorgrondDoc | null> => {
      try {
        const { data: rij } = await supabase
          .from("documenten")
          .select("vervangt_document_id")
          .eq("id", docId)
          .maybeSingle();
        const vorigeId = (rij as { vervangt_document_id?: string | null } | null)
          ?.vervangt_document_id;
        if (!vorigeId) return null;
        const { data: v } = await supabase
          .from("documenten")
          .select("id, titel")
          .eq("id", vorigeId)
          .eq("actief", true)
          .maybeSingle();
        return v ? { id: v.id as string, titel: v.titel as string } : null;
      } catch (e) {
        console.error("Vorige versie ophalen mislukt:", e);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Zoek documenten zodra het @-fragment wijzigt (gedeelde suggestiebron).
  useEffect(() => {
    if (!mentionOpen) return;
    let geannuleerd = false;
    const timer = window.setTimeout(async () => {
      const data = await zoekDocumenten(mentionQuery);
      if (!geannuleerd) setMentionSuggesties(data);
    }, 150);
    return () => {
      geannuleerd = true;
      window.clearTimeout(timer);
    };
  }, [mentionOpen, mentionQuery, zoekDocumenten]);

  // Lege staat: geen gesprek, geen scope. Dan tonen we het startpunt (met de
  // editoriale aanhef) i.p.v. de begroetingsbubbel; zodra er een vraag loopt,
  // verschijnt de reguliere chat. De doorgrond-scherpstel (P2 Deel B) neemt de
  // lege staat tijdelijk over: dan tonen we noch het startpunt, noch de chat.
  const scherpstelActief = doorgrondOpen && !!doorgrondDoc;
  const toonStartpunt =
    !scherpstelActief &&
    berichten.length <= 1 &&
    !documentScope &&
    !agendapuntContext;

  // De shell (core/components/DashboardShell) zet onder `md` een vaste topbalk
  // van 3.5rem en compenseert die met `pt-14`. `min-h-screen` op de <main> is
  // border-box, dus die padding valt daarbinnen — maar een kind van `h-screen`
  // telt er wél bovenop, en het document werd precies 56px te hoog. Trek de balk
  // er dus af onder `md`.
  //
  // Bewust `vh` en niet `dvh`: de <main> eromheen staat op `min-h-screen` (100vh).
  // Zou dit kind op `dvh` staan, dan houdt die <main> op mobiel met uitgeschoven
  // browserbalk een resthoogte van (lvh − dvh) over — precies de restscroll die
  // we hier wegnemen. Eén eenheid in de hele keten. Overstappen op `dvh` kan,
  // maar dan in DashboardShell én hier tegelijk.
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Gesprekken-overzicht (drawer) */}
      {historieOpen && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setHistorieOpen(false)}
          />
          <div className="absolute top-0 left-0 h-full w-80 max-w-[85vw] bg-card shadow-xl flex flex-col">
            <div className="px-5 h-14 flex items-center justify-between border-b border-line">
              <span className="font-bold text-ink">Gesprekken</span>
              <button
                onClick={() => setHistorieOpen(false)}
                className="text-muted hover:text-ink text-lg leading-none"
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {gesprekken.length === 0 ? (
                <p className="text-sm text-muted px-2 py-4">
                  Nog geen opgeslagen gesprekken.
                </p>
              ) : (
                gesprekken.map((g) => (
                  <div
                    key={g.id}
                    className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                      g.id === gesprekId.current
                        ? "bg-accent/15"
                        : "hover:bg-app-bg"
                    }`}
                    onClick={() => openGesprek(g)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink truncate">
                        {g.titel || "Gesprek"}
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(g.bijgewerkt).toLocaleString("nl-NL", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Dit gesprek archiveren?")) archiveerGesprek(g.id);
                      }}
                      title="Archiveren"
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-err-ink text-sm transition-opacity flex-shrink-0"
                      aria-label="Archiveren"
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-line p-3">
              <button
                onClick={startNieuwGesprek}
                className="w-full text-sm text-ink border border-line rounded-lg px-3 py-2 hover:border-accent transition-colors"
              >
                + Nieuw gesprek
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kopbalk — samengevoegd tot één balk (besluitpunt 1, middenpad): titel +
          governance-badge, brongebruik als compacte chip mét zichtbare stand (i.p.v.
          de volzin), antwoordmodus als segmented control, en rechts de gespreksacties.
          Brongebruik én antwoordmodus blijven volledig afleesbaar (transparantie,
          besluit 0068/0071); alleen de brongebruik-VOLZIN is een chip-met-stand
          geworden — de volledige uitleg staat in de tooltip. Dit vervangt de drie
          losse kopbalken (topbar h-14 + brongebruik + antwoordmodus, ~200px chrome). */}
      <div className="bg-card border-b border-line px-7 py-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
        <span className="font-bold text-ink">AI Assistent</span>
        <span className="bg-ok-tint text-ok-ink text-xs font-semibold px-2.5 py-1 rounded-full">
          ● Governance logging actief
        </span>

        {/* Brongebruik-chip — toont de gekozen bron-stand en opent de aanpas-popover.
            De volledige uitleg ("automatische bronkeuze …") staat in de tooltip, zodat
            er t.o.v. de oude volzin geen informatie verloren gaat. */}
        <div className="relative">
          <button
            onClick={() => setAanpassenOpen((o) => !o)}
            aria-expanded={aanpassenOpen}
            title="De assistent kiest automatisch de passende bron — uw documenten, algemene kennis of een combinatie. Klik om te beperken tot fondsdocumenten of over te schakelen naar een collectieve weergave."
            className="text-xs text-muted hover:text-ink border border-line px-2.5 py-1 rounded-md hover:border-accent transition-colors inline-flex items-center gap-1.5"
          >
            <span className="font-semibold uppercase tracking-wide">Bron</span>
            <span className="text-ink">
              {alleenFondsdocumenten ? "alleen fondsdocumenten" : "automatisch"}
            </span>
            <span>{aanpassenOpen ? "▴" : "▾"}</span>
          </button>
          {aanpassenOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-64 bg-card border border-line rounded-lg shadow-lg z-20 p-3 space-y-2.5">
              <label className="text-xs text-muted flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={alleenFondsdocumenten}
                  onChange={(e) => setAlleenFondsdocumenten(e.target.checked)}
                  className="accent-accent"
                />
                Alleen fondsdocumenten
              </label>
              <label
                className="text-xs text-muted flex items-center gap-1.5 cursor-pointer select-none"
                title="Toon dezelfde feiten en bronnen, maar zonder prioritering op uw persoonlijke profiel (collectieve weergave)."
              >
                <input
                  type="checkbox"
                  checked={algemeenPerspectief}
                  onChange={(e) => setAlgemeenPerspectief(e.target.checked)}
                  className="accent-accent"
                />
                Algemeen perspectief
              </label>
            </div>
          )}
        </div>

        {/* Ingreep 2 — herkomst-chip. Is de assistent vanuit een module geopend
            (/ai?intent=fonds&herkomst=…), dan staat de bron-intentie voor dit
            gesprek vast. Dat maken we zichtbaar én wegklikbaar: de bestuurder mag
            nooit onwetend zijn over de scope waarop geantwoord wordt (CLAUDE.md,
            "maak vereisten en blokkers expliciet"), en een verkeerd geraden
            herkomst moet met één klik terug naar automatisch kunnen. */}
        {herkomst && (
          <span
            className="text-xs text-ink bg-warn-tint border border-line px-2.5 py-1 rounded-md inline-flex items-center gap-1.5"
            title={
              herkomst.intent === "fonds"
                ? `U opende de assistent vanuit ${HERKOMST_LABEL[herkomst.module] ?? "het portaal"}. Vragen worden daarom als fondsvraag behandeld — zonder tussenvraag. Klik op × voor automatische bronkeuze.`
                : `U opende de assistent vanuit ${HERKOMST_LABEL[herkomst.module] ?? "het portaal"}. Vragen worden als algemene vraag behandeld. Klik op × voor automatische bronkeuze.`
            }
          >
            <span className="font-semibold uppercase tracking-wide text-muted">
              Vanuit
            </span>
            {HERKOMST_LABEL[herkomst.module] ?? "portaal"}
            <span className="text-muted">·</span>
            {herkomst.intent === "fonds" ? "uw fonds" : "algemeen"}
            <button
              type="button"
              onClick={() => setHerkomst(null)}
              aria-label="Herkomst wissen en terug naar automatische bronkeuze"
              className="text-muted hover:text-ink"
            >
              ×
            </button>
          </span>
        )}

        {/* Actieve-stand-indicator: de bron-chip draagt de bron-stand al; dit
            governance-signaal (niet op profiel geprioriteerd) niet. */}
        {algemeenPerspectief && (
          <span
            className="text-xs text-ink inline-flex items-center gap-1"
            title="Collectieve weergave — niet op uw profiel geprioriteerd"
          >
            <span>👥</span>
            <span>Collectief</span>
          </span>
        )}

        {/* Antwoordmodus — Auto (default) · Sparren; blijft volledig zichtbaar
            (besluit 0068). De gebruikte modus staat per antwoord in "Onderbouwing en
            bronnen". */}
        <span className="text-xs text-muted font-semibold uppercase tracking-wide">
          Antwoordmodus
        </span>
        <div className="flex gap-0.5 bg-app-bg rounded-lg p-1">
          <button
            onClick={() => setAntwoordmodus(null)}
            title="Automatisch de passende antwoordvorm bepalen op basis van uw vraag"
            className={`px-3 py-1.5 text-xs rounded-md transition-all ${
              antwoordmodus === null
                ? "bg-card text-ink font-semibold shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            Auto
          </button>
          {ANTWOORDMODUS_KEUZES.map((m) => (
            <button
              key={m.value}
              onClick={() => setAntwoordmodus(m.value)}
              title={m.help}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                antwoordmodus === m.value
                  ? "bg-card text-ink font-semibold shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Gespreksacties — rechts uitgelijnd. */}
        <button
          onClick={() => setHistorieOpen(true)}
          className="ml-auto text-xs text-muted hover:text-ink border border-line px-3 py-1.5 rounded-lg hover:border-accent transition-colors"
        >
          🕑 Gesprekken{gesprekken.length > 0 ? ` (${gesprekken.length})` : ""}
        </button>
        <button
          onClick={startNieuwGesprek}
          disabled={laden || berichten.length <= 1}
          className="text-xs text-muted hover:text-ink border border-line px-3 py-1.5 rounded-lg hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Nieuw gesprek
        </button>
      </div>

      {/* Chat — gedeelde kolom: één centrerende wrapper (max-w-[1020px], mockup
          .wrap) omvat zowel de berichten als het startpunt, zodat de bubbels en de
          startpuntkaarten dezelfde linker- en rechterrand delen. De scrollbar blijft
          aan de schermrand (de scrollcontainer houdt flex-1 overflow-y-auto). */}
      {/* `relative` is functioneel, geen opmaak. De aria-live-melding van
          "Antwoord kopiëren" (`<span class="sr-only">` in KopieerKnop) is absoluut
          gepositioneerd en staat in de actiebalk — dus BUITEN `.ai-blok`, dat als
          enige `position: relative` draagt (globals.css). Zonder gepositioneerde
          voorouder is haar containing block het viewport: ze ontsnapt aan de clip
          van deze scrollcontainer en rekt het DOCUMENT op tot de volle hoogte van
          de gespreksinhoud. Gemeten op een gesprek van 29 berichten: 6.187 px lege
          scroll, en exact 0 met deze regel. De kopieerknoppen per blok zitten wél
          in `.ai-blok` en waren nooit het probleem. */}
      <div className="relative flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-[1020px] space-y-5">
        {!toonStartpunt && !scherpstelActief &&
          berichten.map((b, i) => (
          <div key={i} id={`bericht-${i}`} className={b.rol === "gebruiker" ? "flex justify-end" : "flex"}>
            {/* `min-w-0` op de AI-kolom: een flex-item krimpt standaard niet onder
                zijn min-content-breedte. Zonder dit duwt een brede bronkaart (of
                een lange documenttitel) de hele kolom voorbij de 1020px-maat. */}
            <div className={b.rol === "gebruiker" ? "max-w-[75%]" : "flex-1 min-w-0"}>
              {/* Inline-meldingen (FO §11c) — alleen bij de zes uitzonderingen,
                  direct boven het antwoord. */}
              {b.rol === "ai" &&
                b.inlineMeldingen &&
                b.inlineMeldingen.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {b.inlineMeldingen.map((m) => (
                      <InlineMeldingBanner key={m.type} melding={m} />
                    ))}
                  </div>
                )}

              <div
                className={
                  b.rol === "gebruiker"
                    ? // De eigen vraag is een rustig blok, geen gekleurd vlak: massief
                      // violet trok in een lang gesprek meer aandacht dan het antwoord
                      // eronder. Wél de kaartbehandeling van de rest van de app
                      // (wit + hairline + schaduw): een tint op de grijze
                      // app-achtergrond haalt maar 1,03:1 en liet de vraag
                      // vervagen. De referentie zet de bubbel op een wítte kaart —
                      // daar werkt zebra wél, hier niet.
                      "bg-app-surface text-ink border border-line shadow-card px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                    : "text-sm leading-relaxed text-ink"
                }
              >
                {b.rol === "ai"
                  ? renderAntwoord(
                      b.tekst,
                      b.bronnen,
                      i,
                      highlight,
                      scrollNaarBron,
                      // Kopieerknoppen alleen op een netjes afgeronde generatie:
                      // een halve kopie met een volledige herkomstregel zou meer
                      // suggereren dan er staat.
                      b.voltooid
                        ? { fondsnaam: fondsNaam || null, surface: "assistent" }
                        : null,
                    )
                  : b.tekst.split("\n").map((regel, j) => (
                      <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                        {regel}
                      </p>
                    ))}
              </div>

              {/* Documentlijst bij antwoordmodus `bronoverzicht` (besluit 0099).
                  De modus is server-side bepaald en reist mee in de onderbouwing
                  van dít bericht — er komt geen nieuwe state aan te pas, en de
                  detectie zelf is niet aangeraakt. */}
              {b.rol === "ai" && documentlijstZichtbaar(b) && (
                <Documentenlijst
                  bronnen={b.bronnen}
                  onScope={(ids, titels) => scopeUitDocumentlijst(ids, titels)}
                  ankerIdVoorBron={(j) => `bron-${i}-${j}`}
                  gehighlightBronIdx={
                    highlight?.berichtIdx === i ? highlight.bronIdx : null
                  }
                />
              )}

              {/* Actiebalk onder het antwoord (besluit 0098) — "Antwoord
                  kopiëren". De kopie draagt altijd de bronnenlijst en de
                  herkomstregel; die zitten in de helper, niet in deze knop.
                  Kopiëren wordt bewust NIET gelogd. */}
              {b.rol === "ai" &&
                b.voltooid &&
                b.tekst.trim().length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <AntwoordKopieerKnop
                      tekst={b.tekst}
                      bronnen={b.bronnen}
                      herkomst={{
                        fondsnaam: fondsNaam || null,
                        surface: "assistent",
                      }}
                    />
                  </div>
                )}

              {/* Increment I-2 (FO §11a) — verduidelijkingschips bij een twijfelgeval.
                  Eén klik herstuurt dezelfde vraag met de bevestigde bron-intentie. */}
              {b.rol === "ai" && b.verduidelijking && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {b.verduidelijking.opties.map((o) => (
                    <button
                      key={o.intent}
                      disabled={laden}
                      onClick={() =>
                        kiesVerduidelijking(o.intent, b.verduidelijking!.origineleVraag, i)
                      }
                      className="text-xs text-ink border border-app-line-strong px-3 py-1.5 rounded-full hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              {/* 30-07-2026 — verbredingschip: de actualiteitsfilter nam alle
                  treffers weg terwijl er wél niet-vastgestelde stukken liggen. De
                  melding staat al bij het antwoord (inline_meldingen); dit is de
                  handeling die erbij hoort. Titels als hint, geen bronvermelding —
                  het antwoord is niet op deze stukken gebaseerd. */}
              {b.rol === "ai" && b.verbreding && (
                <div className="mt-2">
                  {b.verbreding.titels.length > 0 && (
                    <div className="text-xs text-muted mb-1.5">
                      Niet meegenomen:{" "}
                      {b.verbreding.titels.map((t) => `«${t}»`).join(", ")}
                      {b.verbreding.aantal > b.verbreding.titels.length
                        ? ` en ${b.verbreding.aantal - b.verbreding.titels.length} meer`
                        : ""}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={laden}
                    onClick={() =>
                      kiesVerbreding(
                        b.verbreding!.vraag,
                        b.onderbouwing?.bronIntent ?? null
                      )
                    }
                    className="text-xs text-ink border border-app-line-strong px-3 py-1.5 rounded-full hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {b.verbreding.label}
                  </button>
                </div>
              )}

              {/* Onderbouwing en bronnen (FO §11c) — standaard ingeklapt.
                  Staat bewust vóór de vervolgacties: het antwoord staat zo
                  direct naast zijn bronnen, en de vervolgvragen sluiten daar
                  daaronder op aan. */}
              {b.rol === "ai" && b.onderbouwing && (
                <OnderbouwingPaneel
                  meta={{
                    ...b.onderbouwing,
                    aantalBronnen: b.bronnen?.length ?? 0,
                    bronTitels: (b.bronnen ?? []).map((bron) => bron.titel),
                  }}
                  open={openPanelen.has(i)}
                  onToggle={() => togglePaneel(i)}
                  ankerId={`onderbouwing-${i}`}
                  bronKolommen={2}
                  bronnenInAntwoord={documentlijstZichtbaar(b)}
                >
                  {/* Bij een zichtbare documentlijst blijven alléén de bronnen
                      staan die géén document zijn — vandaag de besluitregistratie.
                      Die hoort niet in een documentlijst (ander domein, ander
                      statusbegrip, en haar id is een decision_id), maar mag ook
                      niet verdwijnen: het is de formeel zwaarste bron. */}
                  {(() => {
                    const lijstAan = documentlijstZichtbaar(b);
                    const zichtbaar = (b.bronnen ?? [])
                      .map((bron, j) => ({ bron, j }))
                      .filter(({ bron }) => !lijstAan || !isDocumentbron(bron));
                    if (zichtbaar.length === 0) return null;
                    return zichtbaar.map(({ bron, j }) => (
                      <Bronkaart
                        key={j}
                        idx={j}
                        bron={bron}
                        idVoorScroll={`bron-${i}-${j}`}
                        gehighlight={
                          highlight?.berichtIdx === i && highlight?.bronIdx === j
                        }
                      />
                    ));
                  })()}
                </OnderbouwingPaneel>
              )}

              {/* B1 — inhoudelijke vervolgvragen (op basis van het antwoord).
                  Ná de onderbouwing, zodat ze duidelijk bij het antwoord horen.
                  Deze starten een NIEUWE vraag (geen transformatie). */}
              {b.rol === "ai" &&
                b.onderbouwing?.vervolgvragen &&
                b.onderbouwing.vervolgvragen.length > 0 &&
                !(laden && i === berichten.length - 1) && (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                      Vervolgvragen
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {b.onderbouwing.vervolgvragen.map((vraag, vi) => (
                        <button
                          key={vi}
                          onClick={() => stuurBericht(vraag)}
                          disabled={laden}
                          className="text-xs text-ink bg-card border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {vraag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {/* Contextbewuste vervolgacties (FO §13) — ná de onderbouwing.
                  Bij documentgerichte vragen blijven bestuurlijke duiding en
                  kritische vragen behouden; bij algemene vragen niet. */}
              {b.rol === "ai" &&
                b.onderbouwing &&
                !(laden && i === berichten.length - 1) &&
                (() => {
                  const vorigeVraag =
                    i > 0 && berichten[i - 1].rol === "gebruiker"
                      ? berichten[i - 1].tekst
                      : "";
                  const am =
                    leesAntwoordmodus(b.onderbouwing.antwoordmodus) ?? "feitelijk";
                  const acties = bepaalVervolgacties(
                    vorigeVraag,
                    am,
                    !!b.bronnen?.length,
                    b.onderbouwing?.documentGericht === true
                  );
                  if (acties.length === 0) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {acties.map((a) => (
                        <button
                          key={a.type}
                          onClick={() => stuurVervolgactie(a, b, i)}
                          disabled={laden}
                          className="text-xs text-ink bg-card border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
            </div>
          </div>
        ))}

        {laden && !antwoordGestart && (
          <div className="flex">
            <div className="text-sm leading-relaxed text-ink">
              <VoortgangWeergave voortgang={voortgang} />
            </div>
          </div>
        )}
          {/* Startpunt (P1, besluit 0085) — vervangt de oude VOORGESTELDE_VRAGEN-chips.
              Toont wat er nu speelt + taakknoppen zolang er geen gesprek/scope loopt;
              verdwijnt zodra er een bericht, een documentscope of een agendapunt-scope
              is (dan gedraagt /ai zich exact zoals voorheen). Staat binnen de gedeelde
              kolom-wrapper zodat het startpunt dezelfde breedte erft als de bubbels. */}
          {toonStartpunt && (
            <Startpunt
              context={startpuntContext}
              voornaam={voornaam}
              voorbeeldvragen={GENERIEKE_STARTVRAGEN}
              voorbeeldvragenZichtbaar={vrijeVraagOpen}
              onVrijeVraag={startVrijeVraag}
              onVoorbeeldvraag={startVoorbeeldvraag}
              onDocumentVraag={startDocumentVraag}
            />
          )}
          {/* P2 Deel B — "een document doorgronden": scherpsteltoestand binnen /ai
              (geen route). Neemt de lege staat over; Annuleren keert terug. */}
          {scherpstelActief && (
            <DocumentDoorgronden
              initieelDoc={{ id: doorgrondDoc!.id, titel: doorgrondDoc!.titel }}
              laden={laden}
              zoekDocumenten={zoekDocumenten}
              haalVorigeVersie={haalVorigeVersie}
              onStart={startDoorgronden}
              onAnnuleren={() => {
                setDoorgrondOpen(false);
                setDoorgrondDoc(null);
              }}
            />
          )}
        </div>
      </div>

      {/* Invoerbalk */}
      <div className="bg-card border-t border-line p-4 relative">
        {/* @-mention-typeahead */}
        {mentionOpen && (
          <div className="absolute bottom-full left-4 right-4 mb-2 max-h-64 overflow-y-auto bg-card border border-line rounded-xl shadow-lg z-20">
            <div className="px-3 py-2 text-xs text-muted border-b border-line">
              Kies een document om uw vraag tot dat stuk te beperken
            </div>
            {mentionSuggesties.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted">
                Geen document met deze titel gevonden.
              </div>
            ) : (
              mentionSuggesties.map((s) => (
                <button
                  key={s.id}
                  onClick={() => kiesDocument(s)}
                  className="w-full text-left px-3 py-2 hover:bg-warn-tint border-b border-line last:border-0"
                >
                  <div className="text-sm font-medium text-ink truncate">{s.titel}</div>
                  <div className="text-xs text-muted">
                    {s.bron}
                    {s.bestandstype ? ` · ${s.bestandstype.toUpperCase()}` : ""}
                    {s.aangemaakt
                      ? ` · ${new Date(s.aangemaakt).toLocaleDateString("nl-NL")}`
                      : ""}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Agendapunt-chip (ADR 0028): de vraag is geframed door een agendapunt.
            Eigen chip met eigen herkomst; geen algemene-kennis-toggle (de modus
            combineert toelichting + eventuele stukken + algemene kennis altijd in
            drie gescheiden delen). Wis verbreedt: agendapunt én stukken weg. */}
        {agendapuntContext && (
          <div className="mb-2 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-2 max-w-full bg-accent-tint border border-accent/30 text-accent-ink text-xs rounded-full pl-3 pr-2 py-1">
              <span className="truncate">
                Agendapunt: «{agendapuntContext.titel}»
                {documentScope && documentScope.document_ids.length > 0
                  ? ` · ${documentScope.document_ids.length} ${
                      documentScope.document_ids.length === 1 ? "stuk" : "stukken"
                    }`
                  : " · geen stukken"}
              </span>
              <button
                onClick={() => {
                  setAgendapuntContext(null);
                  setDocumentScope(null);
                }}
                className="shrink-0 w-4 h-4 rounded-full bg-accent hover:bg-accent text-accent-ink flex items-center justify-center"
                aria-label="Agendapunt-scope wissen"
                title="Scope wissen — niet langer over dit agendapunt vragen"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {/* Scope-chip: "Je vraagt nu over: «titel»" + wis-knop + algemene-kennis-toggle */}
        {!agendapuntContext && documentScope && (
          <div className="mb-2 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-2 max-w-full bg-warn-tint border border-warn/30 text-warn-ink text-xs rounded-full pl-3 pr-2 py-1">
              <span className="truncate">
                Je vraagt nu over: «{documentScope.titels[0] || "dit document"}»
                {documentScope.document_ids.length > 1
                  ? ` +${documentScope.document_ids.length - 1}`
                  : ""}
              </span>
              <button
                onClick={() => setDocumentScope(null)}
                className="shrink-0 w-4 h-4 rounded-full bg-warn hover:bg-warn text-warn-ink flex items-center justify-center"
                aria-label="Documentscope wissen"
                title="Scope wissen — weer de hele bibliotheek bevragen"
              >
                ✕
              </button>
            </span>
            <label
              className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              title="Standaard antwoordt de AI strikt uit dit document. Aan: ook algemene kennis, in drie gescheiden delen."
            >
              <input
                type="checkbox"
                checked={documentScope.algemene_kennis === true}
                onChange={(e) =>
                  setDocumentScope(
                    documentScope
                      ? { ...documentScope, algemene_kennis: e.target.checked }
                      : null
                  )
                }
                className="accent-accent"
              />
              Ook algemene kennis gebruiken
            </label>
          </div>
        )}

        <div className="flex gap-3">
          <textarea
            ref={invoerRef}
            value={invoer}
            onChange={(e) => verwerkInvoer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && mentionOpen) {
                sluitMention();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (mentionOpen) return; // Enter binnen de typeahead niet versturen
                stuurBericht();
              }
            }}
            placeholder={
              documentScope
                ? "Stel een vraag over dit document... (@ om te wisselen)"
                : "Stel een vraag... (@ om een specifiek document te kiezen)"
            }
            className="flex-1 border border-line rounded-xl px-3 py-2.5 text-sm resize-none outline-none focus:border-accent bg-app-bg"
            rows={2}
            disabled={laden}
          />
          <button
            onClick={() => stuurBericht()}
            disabled={laden || !invoer.trim()}
            className="w-11 h-11 bg-accent rounded-xl flex items-center justify-center text-white hover:bg-accent hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-end"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}


// Increment I-1 (FO §11c) — conditionele inline-melding direct in het antwoord.
// Caution-meldingen (geen/onvoldoende fondsbasis) krijgen amber; informatieve
// meldingen (bronbasis/duiding/besluit) een rustigere blauwe stijl. Bewust géén
// schijnzekerheid: de teksten suggereren nooit een actuele fondsbron die er niet is.
function InlineMeldingBanner({ melding }: { melding: InlineMelding }) {
  const caution =
    melding.type === "geen_fondstreffer" || melding.type === "onvoldoende_basis";
  const stijl = caution
    ? "bg-warn-tint border-warn/30 text-warn-ink"
    : "bg-accent-tint border-accent/30 text-accent-ink";
  return (
    <div
      className={`inline-flex items-start gap-1.5 text-[11px] border px-2 py-1 rounded-md ${stijl}`}
    >
      <span aria-hidden>{caution ? "⚠️" : "ℹ️"}</span>
      <span>{melding.tekst}</span>
    </div>
  );
}
