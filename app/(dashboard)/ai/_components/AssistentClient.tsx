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
  LichteReflectieBron,
  AntwoordKopieerKnop,
  Documentenlijst,
  leesAntwoordmodus,
  type Bron,
} from "./AntwoordWeergave";
import { isDocumentbron } from "@/core/lib/documentlijst";
import {
  pasVoortgangToe,
  VoortgangWeergave,
  type VoortgangUI,
} from "./Voortgang";
import Startpunt from "./Startpunt";
import VergelijkResultaatWeergave from "./VergelijkResultaatWeergave";
import type { VergelijkResultaat } from "@/core/lib/vergelijk-types";
import DocumentDoorgronden, { type DoorgrondDoc } from "./DocumentDoorgronden";
import StukVoorbereiden from "./StukVoorbereiden";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
import { bouwStukZin, parseStukZin, type Stuksoort } from "@/core/lib/stukvoorbereiding";
import {
  ACTIEF_GESPREK_SLEUTEL,
  reflectieUitnodigingGetoond,
  markeerReflectieUitnodiging,
} from "@/core/lib/ai-sessie";
// Plateau B — de reflectiedialoog. De flowstatus is server-controlled; deze
// module levert alleen de labels, de type-guards en de weergavehulp.
import {
  INGANG_LABEL,
  isActief as isReflectieActief,
  type ReflectieStatus,
  type ReflectieIngang,
} from "@/core/lib/reflectie-flow";
import ReflectieKaart, {
  REFLECTIE_VRAAG_BESLUITMOMENT,
} from "@/core/components/ReflectieKaart";
import ReflectieInvoer from "@/core/components/ReflectieInvoer";
import { verwijderDialoogTekst, verwijderGesprekViaApi } from "@/core/lib/gesprek-verwijderen";
import type {
  PortaalContext,
  DocumentCtx,
} from "@/core/lib/portaalcontext-afleiding";
import { GENERIEKE_STARTVRAGEN, type Startvraag } from "@/core/lib/startvragen";
import { bouwDoorgrondZin, type DoorgrondSectieId } from "@/core/lib/doorgrond";
import { maakIdempotentVerzoek } from "@/core/lib/idempotency-key";
import { bouwChatPayload } from "@/core/lib/assistent-payload";
// P1a — de gespreks- en contexttypen wonen sinds de laagsplitsing in `core/`,
// zodat de payload-bouwer en de gesprekshook ze kunnen gebruiken zonder uit
// `app/` te importeren (boundary T9). Ongewijzigd verhuisd uit dit bestand.
import type {
  Modus,
  VerduidelijkingKeuze,
  VolledigeAnalyseAanbod,
  Bericht,
  DocumentScope,
  ModuleScope,
  DocSuggestie,
  GesprekItem,
  AgendapuntContext,
  StuurOpties,
} from "@/core/lib/assistent-types";


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


// B2-vervolg (2026-08-10) — herstelt de stuk-context van een heropend/herladen
// bureau-stuk-gesprek uit de openingszin, zodat de Word-export weer beschikbaar is
// (die hing op vluchtige sessie-state en verdween bij heropenen/herladen). Levert
// null als het gesprek geen stuk-opdracht is → dan geen exportknop (correct).
function stukContextUitBerichten(
  berichten: unknown
): { stuksoort: Stuksoort; onderwerp: string } | null {
  if (!Array.isArray(berichten)) return null;
  const eerste = berichten.find(
    (b): b is Bericht =>
      !!b &&
      typeof b === "object" &&
      (b as { rol?: unknown }).rol === "gebruiker" &&
      typeof (b as { tekst?: unknown }).tekst === "string"
  );
  return eerste ? parseStukZin(eerste.tekst) : null;
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
      tekst: `Welkom terug. Ik ben uw AI-assistent voor het bestuurdersportaal.\n\nU spreekt hier met een AI-assistent; controleer belangrijke informatie altijd bij de vermelde bron.`,
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
  // ── Plateau B — de reflectiedialoog ───────────────────────────────────────
  // De status komt van de SERVER (gesprek_reflectie_state via
  // /api/reflectie/transitie) en wordt hier alleen weergegeven. De client
  // bepaalt hem nooit zelf: dat is de kern van besluit 0110 en van AC-18.
  const [reflectieStatus, setReflectieStatus] =
    useState<ReflectieStatus>("niet_actief");
  // De uitnodiging is een TIJDELIJKE UI-KAART, geen bericht (FR-50, besluit
  // 0109). Ze staat daarom in componentstate en nergens anders — wegklikken
  // raakt `gesprekken.berichten` niet en schrijft geen auditregel.
  const [uitnodigingZichtbaar, setUitnodigingZichtbaar] = useState(false);
  // B-opt tranche 1c — is de PROACTIEVE uitnodiging een besluitmoment? Zo ja, dan
  // de besluitmoment-variant van de openingsvraag. De permanent beschikbare actie
  // ("Reflecteer op dit antwoord") is dat niet: die kiest de bestuurder zelf op
  // een willekeurig antwoord, dus daar blijft de standaardvraag staan.
  const [uitnodigingBesluitmoment, setUitnodigingBesluitmoment] = useState(false);
  // B-opt tranche 1a — het eigen laatste reflectieantwoord, om het herformuleer-
  // veld ("Aanpassen") mee voor te vullen. Nooit de AI-tekst van het concept.
  const [laatsteReflectieAntwoord, setLaatsteReflectieAntwoord] = useState("");
  // B-opt tranche 2d — de huidige beurt; bepaalt of "Nog een stap verdiepen" nog
  // zichtbaar is. Komt server-side mee in het done-event; nooit zelf afgeleid.
  const [reflectieBeurt, setReflectieBeurt] = useState(0);
  // Permanente opt-out uit het profiel (FR-15). Default aan; pas als het profiel
  // geladen is kan hij uit staan. Zolang we het niet weten tonen we niets —
  // liever geen uitnodiging dan een uitnodiging aan wie hem heeft uitgezet.
  const [uitnodigingToegestaan, setUitnodigingToegestaan] = useState(false);
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
  // T5 C2 — bij het OPENEN van een bestaand gesprek start de weergave onderaan,
  // bij het laatste bericht (niet bovenaan). Losstaand van scrollDoel (dat na het
  // versturen van een vraag naar de top van díe vraag scrollt); deze eenmalige
  // vlag scrollt naar de onderkant van het laatste bericht, zonder animatie.
  const scrollNaarOnder = useRef<boolean>(false);
  const highlightTimer = useRef<number | null>(null);
  // Persistentie (Fase B2): id van het huidige opgeslagen gesprek en de
  // ingelogde gebruiker. Refs i.p.v. state — wijziging hoeft geen re-render.
  const gesprekId = useRef<string | null>(null);
  // Plateau A — bestaat de rij in `gesprekken` al? Het id wordt sinds plateau A
  // vóór de eerste beurt gegenereerd, dus `gesprekId.current !== null` betekent
  // niet langer "staat al in de database".
  const gesprekBestaatInDb = useRef(false);
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
  // ── Werkstand "stukken in voorbereiding" (12-08-2026) ─────────────────────
  // Zet de actualiteitsfilter uit voor élke vraag in dit gesprek: concept- en
  // nog niet vastgestelde stukken komen mee. Het serverveld hiervoor
  // (neem_niet_vastgestelde_mee) bestond al, maar was alleen bereikbaar via een
  // chip die pas verscheen als de retrieval NUL fondstreffers had — bij een
  // vergadervoorbereiding dus vrijwel nooit. Vergaderstukken krijgen bij ingest
  // de DB-default status 'concept' en zijn daarmee per constructie onvindbaar
  // onder de standaardmodus; deze stand is de expliciete uitweg.
  //
  // Bewust een STAND en geen gok: het systeem hoeft niet uit de woordkeuze af te
  // leiden of iemand een vergadering voorbereidt, de gebruiker zegt het.
  const [voorbereidingsstand, setVoorbereidingsstand] = useState(false);
  // Agendapunt-modus (ADR 0028): de vraag is geframed door een agendapunt; de
  // toelichting wordt per beurt server-side opgehaald aan de hand van dit id.
  const [agendapuntContext, setAgendapuntContext] =
    useState<AgendapuntContext | null>(null);
  // Besluit 0151 — module-scope (procesdossier / risicomatrix / één risico) +
  // de risico's van het fonds voor de "verdiep dit risico"-chips (RLS-lijst,
  // alleen id+titel; de inhoud komt server-side per beurt).
  const [moduleScope, setModuleScope] = useState<ModuleScope | null>(null);
  const [risicoLijst, setRisicoLijst] = useState<{ id: string; titel: string }[]>([]);
  // @-mention-typeahead op documenttitels.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionSuggesties, setMentionSuggesties] = useState<DocSuggestie[]>([]);
  // P2 Deel B — "een document doorgronden": scherpsteltoestand binnen /ai (geen
  // route). Open + het (voorgevulde) document waarop de taak wordt uitgevoerd.
  const [doorgrondOpen, setDoorgrondOpen] = useState(false);
  const [doorgrondDoc, setDoorgrondDoc] = useState<DocumentCtx | null>(null);
  // T2 — bureau-stand "Een stuk voorbereiden". `rol` bepaalt (cosmetisch) of de
  // taakkaart verschijnt; de echte gate zit server-side (route + RPC). `stukOpen`
  // is de scherpsteltoestand; `stukContext` onthoudt de stuksoort + het onderwerp
  // zodat de Word-export weet wat te exporteren.
  const [rol, setRol] = useState<string | null>(null);
  const [stukOpen, setStukOpen] = useState(false);
  const [stukContext, setStukContext] = useState<{
    stuksoort: Stuksoort;
    onderwerp: string;
  } | null>(null);
  const [stukExportBezig, setStukExportBezig] = useState<number | null>(null);
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
  // De browserclient hoort bij deze gemounte assistent. Een lazy initializer
  // voorkomt dat een gewone rerender een nieuwe client (en daarmee een nieuw
  // initialisatie-effect) oplevert.
  const [supabase] = useState(createClient);

  // Haalt de eigen, niet-gearchiveerde gesprekken op voor het overzicht.
  // RLS beperkt dit al tot de eigen gesprekken; de gebruiker_id-filter maakt het
  // expliciet. Best-effort.
  const laadGesprekken = useCallback(async () => {
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
  }, [supabase]);

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

  // Plateau A — het gesprek-id wordt CLIENT-SIDE gemaakt, vóór de eerste beurt.
  //
  // Waarom: de chat-route moet elke auditregel aan een gesprek koppelen
  // (`gesprek_audit_id`), anders is die interactie later niet te verwijderen. De
  // rij in `gesprekken` ontstond echter pas ná de stream, dus de eerste beurt
  // van elk gesprek had nooit een id om mee te sturen. Door het id vooraf te
  // genereren en het straks als expliciete `id` bij de insert te gebruiken, is
  // elke beurt vanaf de eerste koppelbaar.
  //
  // `gesprekBestaatInDb` houdt bij of de rij er al is: het id is nu al gezet,
  // dus daaraan alleen valt niet meer af te lezen of we moeten inserten of
  // updaten.
  function zorgVoorGesprekId(): string {
    if (!gesprekId.current) {
      gesprekBestaatInDb.current = false;
      markeerActiefGesprek(crypto.randomUUID());
    }
    return gesprekId.current!;
  }

  function wisActiefGesprek() {
    gesprekId.current = null;
    gesprekBestaatInDb.current = false;
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
    gesprekBestaatInDb.current = true;   // komt uit de lijst, staat dus in de DB
    // T5 C2 — een geopend gesprek start onderaan bij het laatste bericht.
    scrollNaarOnder.current =
      Array.isArray(item.berichten) && item.berichten.length > 0;
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
    // B2-vervolg: herstel de stuk-context, zodat de Word-export beschikbaar is op
    // een heropend stuk-gesprek (en cleart hem voor een niet-stuk-gesprek).
    setStukContext(stukContextUitBerichten(item.berichten));
    setHistorieOpen(false);
    // Plateau B / AC-23 — de flowstatus hoort bij dít gesprek, niet bij het
    // vorige. Zonder deze reset zou een reflectie uit gesprek A doorlopen in
    // gesprek B en zouden G1-G4 daar ten onrechte gelden.
    void herstelReflectieStatus(item.id);
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

  // T2 — bureau-stand. Open de scherpsteltoestand voor "Een stuk voorbereiden".
  const magStukVoorbereiden = rolHeeftCapability(rol, "ai.stukvoorbereiding");
  function startStukVraag() {
    if (laden) return;
    setVrijeVraagOpen(false);
    setStukOpen(true);
  }

  // "Start" in de stuk-scherpstel: schone start, scope op de geselecteerde
  // stukken (leveren de bronnen), en één leesbare gebruikersbeurt. De instructie,
  // de bureau-toon en het auditspoor (retrieval_meta.bureau) komen server-side.
  function startStukVoorbereiden(
    stuksoort: Stuksoort,
    onderwerp: string,
    documenten: DoorgrondDoc[]
  ) {
    // T5 B1: een bron is niet langer verplicht. Zonder gekozen stukken start de
    // bronloze variant (concept-skelet, variant iii); mét stukken de bron-
    // onderbouwde variant (i). Een lege beurt (bronloos zonder onderwerp) laten
    // we niet starten — de scherpstel dwingt dat al af, dit is de backstop.
    const bronloos = documenten.length === 0;
    if (laden || (bronloos && !onderwerp.trim())) return;
    wisActiefGesprek();
    setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    setAgendapuntContext(null);
    // Bij de bronloze variant is er geen document-scope: de server draait dan de
    // concept-skelet-tak. Bij de bron-variant leveren de stukken de bronnen.
    const scope: DocumentScope | null = bronloos
      ? null
      : {
          document_ids: documenten.map((d) => d.id),
          titels: documenten.map((d) => d.titel),
        };
    setDocumentScope(scope);
    setStukOpen(false);
    // Onthoud de stuk-context zodat de Word-export weet wat te exporteren.
    setStukContext({ stuksoort, onderwerp: onderwerp.trim() });
    const zin = bouwStukZin(stuksoort, onderwerp);
    // Expliciet `null` (niet undefined) meegeven: stuurBericht valt bij undefined
    // terug op de — nog niet gecommitte — documentScope-state; null betekent
    // ondubbelzinnig "geen scope" en stuurt de server de bronloze bureau-tak in.
    void stuurBericht(zin, {
      scopeOverride: scope,
      persistScope: scope,
      stukvoorbereiding: { stuksoort },
    });
  }

  // T2 — Word-export van een (bureau-)antwoord. Server-side: capability-gate +
  // append-only logging (B-4). De browser ontvangt het .docx als download.
  async function exporteerNaarWord(bericht: Bericht, idx: number) {
    if (!stukContext) return;
    setStukExportBezig(idx);
    try {
      const bronnen = (bericht.bronnen ?? []).map((b, i) => ({
        nummer: i + 1,
        titel: b.titel,
        bron: b.bron,
        paragraaf: b.paragraaf,
        pagina: b.pagina,
        documentdatum: b.documentdatum,
        documentstatus: b.documentstatus,
      }));
      const res = await fetch("/api/ai/stuk-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          antwoord: bericht.tekst,
          bronnen,
          stuksoort: stukContext.stuksoort,
          onderwerp: stukContext.onderwerp,
          gesprek_id: gesprekId.current ?? undefined,
        }),
      });
      if (!res.ok) {
        const melding = await res
          .json()
          .then((j) => (j as { error?: string }).error)
          .catch(() => null);
        alert(melding || "De Word-export is niet gelukt.");
        return;
      }
      const blob = await res.blob();
      const naam =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || "stuk.docx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = naam;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("De Word-export is niet gelukt.");
    } finally {
      setStukExportBezig(null);
    }
  }

  // Verwijdert een gesprek DEFINITIEF (plateau A). Vervangt het oude
  // "archiveren", dat alleen `gearchiveerd = true` zette: de chatinhoud bleef
  // staan en de auditregels bleven onaangeroerd, terwijl de knop een prullenbak
  // toonde. Nu gaat de chatinhoud écht weg — inclusief de vraag en het antwoord
  // bij de gekoppelde auditregels — en blijft alleen het spoor (wie, wanneer,
  // welke modus) bestaan, met één redactieregel als tegenhanger.
  //
  // De route doet niets zelf: `verwijder_gesprek()` regelt eigenaarschap,
  // volgorde en idempotentie in één transactie. `request_id` maakt een
  // netwerkretry onschadelijk.
  async function verwijderGesprek(id: string) {
    const uitkomst = await verwijderGesprekViaApi(id);
    if (!uitkomst.ok) {
      alert(uitkomst.melding);
      return;
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

      // Plateau A — het id is al bepaald vóór de beurt (zorgVoorGesprekId), zodat
      // de chat-route elke auditregel kon koppelen. Of we inserten of updaten
      // hangt daarom af van `gesprekBestaatInDb`, niet meer van het id zelf.
      if (gesprekBestaatInDb.current && gesprekId.current) {
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
        const { data, error } = await supabase
          .from("gesprekken")
          .insert({
            // Expliciet id: hetzelfde dat als gesprek_audit_id is meegestuurd.
            id: zorgVoorGesprekId(),
            gebruiker_id: uid,
            fonds_id: fondsId,
            titel,
            berichten: finale,
            document_scope: scopePayload,
            actieve_antwoordmodus: antwoordmodus,
          })
          .select("id")
          .single();
        if (!error && data?.id) {
          markeerActiefGesprek(data.id as string);
          gesprekBestaatInDb.current = true;
        }
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
          .select(
            "fonds_id, naam, rol, standaard_ai_modus, reflectie_uitnodiging, fondsen(naam)"
          )
          .eq("id", user.id)
          .single();
        if (data?.fonds_id) setFondsId(data.fonds_id);
        // T2 — rol vasthouden voor de (cosmetische) zichtbaarheid van de
        // bureau-taakkaart. Autorisatie blijft server-side.
        setRol((data?.rol as string | null) ?? null);
        // Plateau B / B-6 — de permanente opt-out (FR-15). Strikt zelfbeheerd
        // (besluit 0017): dit veld staat op de eigen profielrij en niemand
        // anders kan het zetten. Ontbreekt de kolom (migratie nog niet gedraaid)
        // of is de waarde onbekend, dan blijft de uitnodiging UIT — liever geen
        // uitnodiging dan een uitnodiging aan wie hem heeft weggezet.
        setUitnodigingToegestaan(data?.reflectie_uitnodiging === true);

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
          ? `${groet} ${voornaam}, fijn u te zien.\n\nIk help u graag met vragen rondom ${fondsnaam}.\n\nU spreekt hier met een AI-assistent; controleer belangrijke informatie altijd bij de vermelde bron.`
          : `${groet}. Ik help u graag met vragen rondom ${fondsnaam}.\n\nU spreekt hier met een AI-assistent; controleer belangrijke informatie altijd bij de vermelde bron.`;

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
              gesprekBestaatInDb.current = true;   // net uit de DB gelezen
              // T5 C2 — na een refresh het herstelde gesprek onderaan tonen.
              scrollNaarOnder.current = true;
              setBerichten(herstelVoltooidVlag(opgeslagen));
              setDocumentScope(leesScope(laatste.document_scope));
              setAgendapuntContext(leesAgendapuntContext(laatste.document_scope));
              setAntwoordmodus(leesAntwoordmodus(laatste.actieve_antwoordmodus));
              // B2-vervolg: herstel de stuk-context na een refresh (Word-export).
              setStukContext(stukContextUitBerichten(opgeslagen));
              // Plateau B / AC-23 — de flowstatus herstellen na een refresh.
              // Er wordt NOOIT automatisch een bericht verstuurd; we halen
              // alleen de status op. De server past zelf de fail-safe toe (24
              // uur), dus bij twijfel komt hier `niet_actief` terug.
              void herstelReflectieStatus(laatste.id as string);
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
              gesprekBestaatInDb.current = false;
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
              gesprekBestaatInDb.current = false;
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

        // Besluit 0151 — module-scope-ingang. /ai?proces=<id> opent de chat in de
        // context van dat dossier; /ai?risicomatrix=1 in de context van de hele
        // risicomatrix (de enige risico-ingang). De inhoud resolveert de server
        // per beurt onder RLS; hier zetten we alleen de sleutel + een label voor de
        // chip. Een nieuw gesprek starten zodat de scope niet over een bestaand
        // gesprek heen valt (gelijk aan ?doc=/?agendapunt=).
        try {
          const params = new URLSearchParams(window.location.search);
          const procesParam = params.get("proces");
          const risicomatrixParam = params.get("risicomatrix");
          if (procesParam) {
            const { data: p } = await supabase
              .from("procedures")
              .select("id, titel")
              .eq("id", procesParam)
              .maybeSingle();
            if (p?.id) {
              gesprekId.current = null;
              gesprekBestaatInDb.current = false;
              setBerichten([{ rol: "ai", tekst: personalTekst }]);
              setModuleScope({
                soort: "proces",
                procedure_id: p.id as string,
                label: (p.titel as string) || "dit proces",
              });
            }
          } else if (risicomatrixParam) {
            gesprekId.current = null;
            gesprekBestaatInDb.current = false;
            setBerichten([{ rol: "ai", tekst: personalTekst }]);
            setModuleScope({ soort: "risicomatrix", label: "de risicomatrix" });
            // De risico's van het fonds voor de "verdiep dit risico"-chips (RLS).
            const { data: rs } = await supabase
              .from("risicos")
              .select("id, titel")
              .eq("status", "actief")
              .order("niveau", { ascending: false });
            setRisicoLijst(
              (rs ?? [])
                .filter((r): r is { id: string; titel: string } => typeof r?.id === "string")
                .map((r) => ({ id: r.id, titel: r.titel || "risico" }))
            );
          }
        } catch (e) {
          console.error("Module-scope uit ?proces=/?risicomatrix= zetten mislukt:", e);
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
  }, [laadGesprekken, supabase]);

  useEffect(() => {
    // T5 C2 — een zojuist geopend bestaand gesprek start onderaan bij het laatste
    // bericht. Wint van scrollDoel (dat hoort bij een verstuurde vraag) en scrollt
    // zonder animatie direct naar de onderkant.
    if (scrollNaarOnder.current) {
      const idx = berichten.length - 1;
      if (idx >= 0) {
        document
          .getElementById(`bericht-${idx}`)
          ?.scrollIntoView({ behavior: "auto", block: "end" });
      }
      scrollNaarOnder.current = false;
      scrollDoel.current = null;
      return;
    }
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


  async function stuurBericht(vraag?: string, opties?: StuurOpties) {
    const tekst = vraag || invoer.trim();
    // "Nog een stap verdiepen" en "Wat pleit er tegen?" hebben geen
    // gebruikerstekst: de assistent stelt de volgende vraag. Anders blijft de
    // lege-invoer-guard staan.
    if (
      (!tekst && !opties?.reflectieVerdiepen && !opties?.reflectieTegenperspectief) ||
      laden
    )
      return;
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
    const nieuw: Bericht = {
      rol: "gebruiker",
      tekst: opties?.weergaveTekst ?? tekst,
    };
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
    // Bij een volledige-analyseactie ziet de gebruiker een korte actietekst,
    // terwijl de server de oorspronkelijke inhoudelijke vraag opnieuw uitvoert.
    if (opties?.weergaveTekst && !opties.geenNieuweVraag && messages.length > 0) {
      messages[messages.length - 1] = { role: "user", content: tekst };
    }

    setAntwoordGestart(false);

    // Eén sleutel per logische gebruikersactie. Als dezelfde fetch door de
    // transportlaag opnieuw wordt aangeboden, blijven request en header gelijk;
    // een volgende aanroep van stuurBericht krijgt een nieuwe sleutel.
    const idempotentVerzoek = maakIdempotentVerzoek();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: idempotentVerzoek.headers({ "Content-Type": "application/json" }),
        // P1a — het verzoeklichaam wordt gebouwd door de ENE payload-bouwer
        // (core/lib/assistent-payload.ts). Zo kan geen enkele surface nog een
        // eigen, verschraalde variant van dit object opbouwen; de contracttest
        // `assistent-payload.sanity.ts` bewaakt dat het veld voor veld gelijk
        // blijft aan het origineel dat hier stond.
        body: JSON.stringify(
          bouwChatPayload({
            messages,
            fondsId,
            alleenFondsdocumenten,
            algemeenPerspectief,
            voorbereidingsstand,
            herkomst,
            documentScope: effScope,
            antwoordmodus: effAntwoordmodus,
            agendapuntContext,
            moduleScope,
            gesprekId: zorgVoorGesprekId(),
            opties,
          })
        ),
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
      // Besluit 0137 — niet-blokkerend bronkeuze-aanbod (chips ónder het antwoord).
      let bronkeuzeAanbodData: Bericht["bronkeuzeAanbod"] | undefined;
      let volledigeAnalyseAanbodData: Bericht["volledigeAnalyseAanbod"] | undefined;
      // Plateau B — het id van de auditregel van dit antwoord (uit 'done').
      let logIdData: string | undefined;
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
            bronkeuzeAanbod: bronkeuzeAanbodData,
            volledigeAnalyseAanbod: volledigeAnalyseAanbodData,
            voltooid,
            logId: logIdData,
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
        } else if (evt.type === "vergelijking") {
          // T5 — vergelijkresultaat: geen antwoordbubbel maar de side-by-side
          // component. Hergebruikt het verduidelijking-spoor (geen 'done'-
          // overschrijving + dezelfde persistentie van de beurt).
          verduidelijkingActief = true;
          aiToegevoegd = true;
          setVoortgang(null);
          if (evt.resultaat) {
            verduidelijkingBericht = {
              rol: "ai",
              tekst: "Vergelijking",
              vergelijking: evt.resultaat,
              voltooid: true,
            };
            setBerichten((prev) => [...prev, verduidelijkingBericht!]);
          }
        } else if (evt.type === "vergelijking_verduidelijking") {
          // T5 — twee mogelijke doelbronnen: een gerichte verduidelijking i.p.v. gokken.
          verduidelijkingActief = true;
          aiToegevoegd = true;
          setVoortgang(null);
          verduidelijkingBericht = {
            rol: "ai",
            tekst: "Welke documenten wilt u vergelijken?",
            vergelijkingVerduidelijking: {
              bronHint: evt.bronHint ?? null,
              doelHint: evt.doelHint ?? null,
              bronKandidaten: evt.bronKandidaten ?? [],
              doelKandidaten: evt.doelKandidaten ?? [],
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
            // Besluit 0139 (M-R4) — gebruikte zoekvraag; alleen getoond bij reformulatie.
            zoekvraag: evt.zoekvraag ?? null,
            gereformuleerd: evt.gereformuleerd ?? false,
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
            // Besluit 0151 — de gebruikte module-scope, apart van documentbronnen.
            moduleScope: evt.module_scope
              ? {
                  soort: evt.module_scope.soort,
                  bronnen: evt.module_scope.bron_ids?.length ?? 0,
                }
              : null,
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
            documentdekking: evt.documentdekking ?? null,
            vraagrouter: evt.vraagrouter ?? null,
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
          // Besluit 0137 — bood de server (bij modus antwoord_eerst) een
          // niet-blokkerend bronkeuze-aanbod aan? De originele vraag bewaren we mee
          // zodat een chipklik dezelfde vraag letterlijk hergenereert.
          bronkeuzeAanbodData = evt.bronkeuze_aanbod
            ? { opties: evt.bronkeuze_aanbod.opties, origineleVraag: tekst }
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
                bronkeuzeAanbod: bronkeuzeAanbodData,
                volledigeAnalyseAanbod: volledigeAnalyseAanbodData,
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
              documentdekking:
                evt.documentdekking ?? onderbouwingData.documentdekking ?? null,
              vraagrouter: evt.vraagrouter ?? onderbouwingData.vraagrouter ?? null,
            };
          }
          volledigeAnalyseAanbodData =
            evt.volledige_analyse_aanbod ?? undefined;
          // 30-07-2026 — definitieve verbredings-aanbieding (kan in 'done' pas
          // definitief zijn; blijft anders staan zoals in 'meta' gezet).
          if (evt.verbreding !== undefined) {
            verbredingData = evt.verbreding
              ? { ...evt.verbreding, vraag: tekst }
              : undefined;
          }
          // ── Plateau B ────────────────────────────────────────────────────
          // Het id van de auditregel, zodat een latere reflectie op dít antwoord
          // de juiste bronset kan bevriezen.
          if (typeof evt.log_id === "string") logIdData = evt.log_id;
          // De server-controlled flowstatus. Hij komt hiervandaan en nergens
          // anders: de client leidt hem niet af uit wat hij zojuist verstuurde.
          if (evt.reflectie?.status) {
            const nieuweStatus = evt.reflectie.status as ReflectieStatus;
            setReflectieStatus(nieuweStatus);
            if (typeof evt.reflectie.beurt === "number") setReflectieBeurt(evt.reflectie.beurt);
            // Loopt er een reflectie, dan is de uitnodiging niet aan de orde.
            if (nieuweStatus !== "niet_actief") setUitnodigingZichtbaar(false);
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
            volledigeAnalyseAanbod: volledigeAnalyseAanbodData,
            logId: logIdData,
          },
        ];
        await bewaarGesprek(finale, scopeVoorOpslag);

        // ── Plateau B / B-2 — de proactieve uitnodiging ────────────────────
        // Nadrukkelijk PAS hier: het antwoord is af en bewaard. De uitnodiging
        // onderbreekt niets en blokkeert niets; wie hem negeert mist niets.
        overweegUitnodiging(onderbouwingData, opties);
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

  // ══════════════════════════════════════════════════════════════════════════
  //  Plateau B — de reflectiedialoog
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * De flowstatus opnieuw ophalen bij het openen of herstellen van een gesprek
   * (FR-57, AC-23). Er wordt nooit automatisch een bericht verstuurd — dit is
   * puur een leesactie. De server past de fail-safe (24 uur) zelf toe; bij
   * twijfel komt `niet_actief` terug, en dat is ook de uitkomst bij elke fout.
   */
  async function herstelReflectieStatus(id: string) {
    setUitnodigingZichtbaar(false);
    setUitnodigingBesluitmoment(false);
    // B-opt 1a — de voorvultekst van "Aanpassen" is niet persistent en hoort bij
    // het gesprek waarin hij is getypt. Bij het herstellen van een (ander)
    // gesprek is die eigen tekst niet beschikbaar; dan liever een leeg veld dan
    // de tekst uit een vorig gesprek. Zie code-review B-opt tranche 1.
    setLaatsteReflectieAntwoord("");
    try {
      const res = await fetch(
        `/api/reflectie/transitie?gesprek_id=${encodeURIComponent(id)}`
      );
      const data = await res.json().catch(() => null);
      setReflectieStatus(res.ok && data?.status ? data.status : "niet_actief");
      setReflectieBeurt(res.ok && typeof data?.beurt === "number" ? data.beurt : 0);
    } catch {
      setReflectieStatus("niet_actief");
      setReflectieBeurt(0);
    }
  }

  /**
   * Mag er nú een PROACTIEVE uitnodiging verschijnen? (FR-14, T1-T5 uit v1.0 §9.1)
   *
   * Vier voorwaarden, alle vier hard:
   *   1. de permanente opt-out staat niet aan (uit het profiel, FR-15);
   *   2. er loopt nog geen reflectie;
   *   3. deze beurt is een van de triggermomenten;
   *   4. in deze browsersessie is voor deze context nog niet uitgenodigd
   *      (sessionStorage, besluit 0121 — géén databaseopslag).
   *
   * ⚠ T3 en T4 zijn een AANNAME. Ontwerp v1.0 §9.1 spreekt van "na een
   * vergelijking van alternatieven — taak voltooid" en "een risico- of
   * evenwichtigheidsanalyse — als zodanig geclassificeerd", maar er is geen
   * takenregister in deze codebase. Het dichtstbijzijnde deterministische
   * signaal is de gebruikte antwoordmodus. Dit is precies wat de gebruikerstoets
   * uit besluit 0122 moet bevestigen; het staat als openstaand punt genoteerd.
   */
  function overweegUitnodiging(
    onderbouwing: OnderbouwingMeta | undefined,
    opties?: StuurOpties
  ) {
    if (!uitnodigingToegestaan) return;              // 1 — permanente opt-out
    if (reflectieStatus !== "niet_actief") return;   // 2 — er loopt er al een
    if (
      opties?.reflectieAntwoord ||
      opties?.reflectieStart ||
      opties?.reflectieHerformuleren ||
      opties?.reflectieVerdiepen ||
      opties?.reflectieTegenperspectief
    )
      return;
    if (opties?.transformatie) {
      // T3 — "werk uit richting besluitvorming" is de enige transformatie die
      // als vergelijking van alternatieven telt. De overige (korter, concreter,
      // feitelijker) zijn opmaakacties en verdienen geen uitnodiging.
      if (opties.antwoordmodusOverride !== "besluitrijpheid") return;
    } else {
      // T2 — besluitrijpheidsanalyse. B-opt tranche 1b: de `sparring`-proxy is
      // vervallen — die vuurde te breed en was de meest waarschijnlijke oorzaak
      // van "verschijnt te vaak" (H-3). Alleen `besluitrijpheid` blijft over.
      const modus = leesAntwoordmodus(onderbouwing?.antwoordmodus);
      if (modus !== "besluitrijpheid") return;
    }

    const context = gesprekId.current;
    if (!context) return;
    if (reflectieUitnodigingGetoond(context)) return; // 4 — één per sessie
    markeerReflectieUitnodiging(context);
    // B-opt tranche 1c — elke overgebleven proactieve trigger (T2/T3) is een
    // besluitrijpheidsmoment; toon dus de besluitmoment-variant van de vraag.
    setUitnodigingBesluitmoment(true);
    setUitnodigingZichtbaar(true);
  }

  /**
   * Eén transitie aanvragen die NIET aan een chatbeurt hangt (afronden,
   * afbreken). De server is leidend: wat hij teruggeeft is de nieuwe status,
   * ook als dat iets anders is dan we vroegen.
   */
  async function vraagTransitie(actie: "afronden" | "afbreken") {
    const id = gesprekId.current;
    if (!id) return;
    try {
      const res = await fetch("/api/reflectie/transitie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gesprek_id: id, actie }),
      });
      const data = await res.json().catch(() => null);
      // Ook bij een geweigerde overgang (409) valt de UI terug op niet_actief:
      // de reflectie vasthouden terwijl de server hem niet kent is de enige
      // uitkomst die de gebruiker echt klem zet.
      setReflectieStatus(res.ok && data?.status ? data.status : "niet_actief");
      setReflectieBeurt(res.ok && typeof data?.beurt === "number" ? data.beurt : 0);
    } catch {
      setReflectieStatus("niet_actief");
      setReflectieBeurt(0);
    }
  }

  /**
   * De bestuurder koos een reflectie-ingang. PAS hier begint de dialoog: de
   * keuze wordt een gewoon gebruikersbericht in de chat, en vanaf dat moment
   * loopt alles via het normale chatpad (besluit 0108, FR-REF-1).
   *
   * De bronset bevriest op het LAATSTE voltooide antwoord — dat is het antwoord
   * waaronder de kaart staat.
   */
  function startReflectie(ingang: ReflectieIngang) {
    if (laden) return;
    setUitnodigingZichtbaar(false);
    const laatsteAntwoord = [...berichten].reverse().find((b) => b.rol === "ai");
    stuurBericht(INGANG_LABEL[ingang], {
      reflectieStart: { ingang, bronsetLogId: laatsteAntwoord?.logId ?? null },
    });
  }

  /**
   * De uitnodiging wegklikken of "Geen aanvullende reflectie" kiezen.
   *
   * Dit slaat NIETS op: geen chatbericht, geen databasewaarde, geen auditregel
   * (FR-50, AC-15). De keuze betekent ook niets — geen instemming, geen
   * geruststelling, geen besluitrijpheid (FR-22). De sessionStorage-markering is
   * al bij het TONEN gezet, niet hier: anders zou het wegklikken zelf de
   * registratie zijn die we vermijden.
   */
  function sluitUitnodiging() {
    setUitnodigingZichtbaar(false);
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
    const voorTerugvraag = berichten.slice(0, idx); // laat de verduidelijkingsbubbel vallen
    // Een deterministische terugvraag kan in dezelfde renderbatch landen als de
    // oorspronkelijke gebruikersbubbel. In dat snelle pad bevat de closure van
    // de chip nog niet altijd die bubbel, waardoor `messages` leeg bij de API
    // aankwam. Borg de oorspronkelijke vraag expliciet in de basis; als hij er
    // al staat, blijft de bestaande geschiedenis ongewijzigd.
    const heeftOrigineleVraag = voorTerugvraag.some(
      (b) => b.rol === "gebruiker" && b.tekst === origineleVraag
    );
    const basis = heeftOrigineleVraag
      ? voorTerugvraag
      : [...voorTerugvraag, { rol: "gebruiker" as const, tekst: origineleVraag }];
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

  // Besluit 0137 (antwoord-eerst) — de bestuurder klikte een bronkeuze-chip ónder
  // een fondsgericht antwoord ("liever in algemene zin?" / "voor mijn fonds").
  // Hergegenereerd met de bevestigde intentie (bron_intent_override → vertrouwen
  // "zeker", precies het bestaande herstelpad). Net als bij kiesVerbreding laten we
  // het eerste antwoord STAAN: dat antwoord ís aan de bestuurder getoond en kan zijn
  // overgenomen — beide beurten horen in het gesprek en in het auditspoor (M-B5).
  // `vorigeLogId` koppelt de nieuwe beurt aan de eerste (retrieval_meta.bronkeuze_herzien).
  function kiesBronkeuze(
    intent: "fonds" | "algemeen",
    origineleVraag: string,
    vorigeLogId: string | undefined
  ) {
    if (laden) return;
    stuurBericht(origineleVraag, {
      bronIntentOverride: intent,
      bronIntentBron: "chip",
      bronkeuzeVorigeLogId: vorigeLogId,
    });
  }

  // M7 — expliciete opschaling na een targeted antwoord. De server valideert
  // opnieuw dat het aanbod bij deze gebruiker, dit fonds, deze vraag en precies
  // dit document hoort; de ids uit de client zijn dus alleen correlatiesleutels.
  function kiesVolledigeAnalyse(aanbod: VolledigeAnalyseAanbod) {
    if (laden) return;
    const scope: DocumentScope = {
      document_ids: [aanbod.document_id],
      titels: [aanbod.document_titel],
      algemene_kennis: false,
    };
    stuurBericht(aanbod.originele_vraag, {
      volledigeAnalyse: {
        origineelLogId: aanbod.origineel_log_id,
        documentId: aanbod.document_id,
      },
      weergaveTekst: `Volledige analyse uitvoeren voor «${aanbod.document_titel}»`,
      scopeOverride: scope,
      persistScope: scope,
    });
  }

  // Besluit 0099 — één conditie voor "de documentlijst staat in het antwoord",
  // gebruikt door zowel de lijst zelf als de anti-dubbelingsvlag op het paneel.
  // Ze moeten identiek zijn: zou het paneel de vlag alleen op de modus zetten,
  // dan claimt het tijdens het streamen, bij een afgebroken antwoord of bij nul
  // documentbronnen een lijst die er niet staat — én verbergt het tegelijk de
  // bronkaarten. Precies de schijnzekerheid die de vervangen fallbacktekst
  // moest voorkomen.
  function documentlijstZichtbaar(b: Bericht): boolean {
    if (!b.voltooid) return false;
    if (leesAntwoordmodus(b.onderbouwing?.antwoordmodus) !== "bronoverzicht") return false;
    return (b.bronnen ?? []).some(isDocumentbron);
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
    gesprekBestaatInDb.current = false;
    setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    setInvoer("");
    setDocumentScope(null);
    setAgendapuntContext(null);
    // Besluit 0151 — de module-scope + verdiep-lijst golden voor het vorige gesprek.
    setModuleScope(null);
    setRisicoLijst([]);
    setHerkomst(null); // ingreep 2 — de module-ingang gold voor het vorige gesprek
    setVrijeVraagOpen(false);
    sluitMention();
    setHistorieOpen(false);
    // Plateau B — een schone chat begint zonder reflectie en zonder kaart.
    setReflectieStatus("niet_actief");
    setReflectieBeurt(0);
    setUitnodigingZichtbaar(false);
    setUitnodigingBesluitmoment(false);
    // B-opt 1a — de voorvultekst van "Aanpassen" hoort bij het vorige gesprek;
    // nooit meenemen naar een nieuw gesprek (het moet de EIGEN woorden van dít
    // gesprek zijn).
    setLaatsteReflectieAntwoord("");
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
  const scherpstelActief = (doorgrondOpen && !!doorgrondDoc) || stukOpen;
  const toonStartpunt =
    !scherpstelActief &&
    berichten.length <= 1 &&
    !documentScope &&
    !agendapuntContext &&
    // Besluit 0151 — bij een actieve module-scope tonen we direct het chatvenster
    // (met scope-chip), niet het generieke startpunt.
    !moduleScope;

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
                        if (confirm(verwijderDialoogTekst(g.titel))) verwijderGesprek(g.id);
                      }}
                      title="Definitief verwijderen"
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-err-ink text-sm transition-opacity flex-shrink-0"
                      aria-label="Gesprek definitief verwijderen"
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
        <span
          className="bg-ok-tint text-ok-ink text-xs font-semibold px-2.5 py-1 rounded-full cursor-help"
          title="Elke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt."
          aria-label="Governance logging actief. Elke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt."
        >
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
                      // eronder. Zebra + hairline houdt de nadruk waar hij hoort.
                      "bg-app-zebra text-ink border border-app-line px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
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
                    {/* T2 — Word-export. Alleen bij een bureau-stuk-gesprek
                        (stukContext gezet) én met de capability. Server-side
                        gebouwd + append-only gelogd (B-4); de knop start alleen
                        de download. */}
                    {magStukVoorbereiden && stukContext && (
                      <button
                        type="button"
                        disabled={stukExportBezig === i}
                        onClick={() => void exporteerNaarWord(b, i)}
                        className="text-xs text-ink border border-line rounded-lg px-3 py-1.5 hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {stukExportBezig === i ? "Word maken…" : "Download als Word"}
                      </button>
                    )}
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

              {/* T5 — vergelijkresultaat: side-by-side per dimensie. De component
                  toont alleen (geen vergelijk-logica in de UI). De reflectie-hook
                  (T10) prefilt de composer met een startzin bij de bevinding. */}
              {b.rol === "ai" && b.vergelijking && (
                <div className="mt-2">
                  <VergelijkResultaatWeergave
                    resultaat={b.vergelijking}
                    onReageer={(f) =>
                      setInvoer(
                        `Ik wil reageren op de bevinding "${f.dimensie}" (bron: ${
                          f.bron.value ?? "—"
                        } / doel: ${f.doel.value ?? "—"}): `
                      )
                    }
                  />
                </div>
              )}

              {/* T5 — vergelijkvraag met twee mogelijke doelbronnen: gerichte
                  verduidelijking via kandidaat-paren (nooit gokken). Eén klik
                  prefilt de composer met een eenduidige vergelijkvraag. */}
              {b.rol === "ai" && b.vergelijkingVerduidelijking && (
                <div className="mt-2">
                  <p className="text-xs text-muted mb-1.5">
                    Welke documenten bedoelt u? Kies een combinatie:
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {b.vergelijkingVerduidelijking.bronKandidaten
                      .flatMap((bron) =>
                        b.vergelijkingVerduidelijking!.doelKandidaten
                          .filter((doel) => doel.id !== bron.id)
                          .map((doel) => ({ bron, doel }))
                      )
                      .slice(0, 4)
                      .map(({ bron, doel }) => (
                        <button
                          key={`${bron.id}-${doel.id}`}
                          disabled={laden}
                          onClick={() => setInvoer(`Vergelijk ${bron.titel} met ${doel.titel}`)}
                          className="text-xs text-ink border border-app-line-strong px-3 py-1.5 rounded-full hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {bron.titel} ↔ {doel.titel}
                        </button>
                      ))}
                  </div>
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

              {/* Besluit 0137 (antwoord-eerst) — niet-blokkerend bronkeuze-aanbod.
                  Het antwoord is fondsgericht gegeven (onzekere intentie); de
                  bestuurder ziet dát die keuze is gemaakt en kan hem corrigeren,
                  zonder vooraf onderbroken te zijn. De bronbasis-melding staat al
                  bij het antwoord (onderbouwing) en dekt het schijnzekerheidsrisico;
                  deze chips VERVANGEN die melding niet, ze vullen hem aan. */}
              {b.rol === "ai" && b.bronkeuzeAanbod && (
                <div className="mt-2">
                  <div className="text-xs text-muted mb-1.5">
                    Dit antwoord gaat uit van uw fonds — liever in algemene zin?
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {b.bronkeuzeAanbod.opties.map((o) => (
                      <button
                        key={o.intent}
                        type="button"
                        disabled={laden}
                        onClick={() =>
                          kiesBronkeuze(
                            o.intent,
                            b.bronkeuzeAanbod!.origineleVraag,
                            b.logId
                          )
                        }
                        className="text-xs text-ink border border-app-line-strong px-3 py-1.5 rounded-full hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* M7 — de targeted beantwoording blijft staan. Alleen een
                  expliciete klik start een tweede, aantoonbaar bredere analyse;
                  de kosten-/wachttijdmelding staat daarom direct bij de actie. */}
              {b.rol === "ai" && b.volledigeAnalyseAanbod && (
                <div className="mt-3 rounded-lg border border-line bg-card px-3 py-2.5">
                  <p className="text-xs text-muted mb-2">
                    Dit kan langer duren en meer AI-verbruik veroorzaken.
                  </p>
                  <button
                    type="button"
                    disabled={laden}
                    onClick={() => kiesVolledigeAnalyse(b.volledigeAnalyseAanbod!)}
                    className="text-xs text-ink border border-app-line-strong px-3 py-1.5 rounded-full hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {b.volledigeAnalyseAanbod.label}
                  </button>
                </div>
              )}

              {/* B-opt tranche 2f — lichte bronweergave tijdens reflectie
                  (ANTWOORDPAD §4). Alleen op de HUIDIGE reflectiebeurt (de laatste
                  AI-beurt terwijl de flow loopt); afgeleid uit de live status,
                  nooit uit een opgeslagen markering (besluit 0112). Bevat de beurt
                  een dossieruitspraak ([Bron N]), dan één gedempte regel die
                  uitklapt; anders niets. */}
              {b.rol === "ai" &&
                b.onderbouwing &&
                i === berichten.length - 1 &&
                isReflectieActief(reflectieStatus) &&
                /\[Bron\s*\d/i.test(b.tekst ?? "") && (
                  <LichteReflectieBron
                    open={openPanelen.has(i)}
                    onToggle={() => togglePaneel(i)}
                  >
                    {(b.bronnen ?? []).map((bron, j) => (
                      <Bronkaart
                        key={j}
                        idx={j}
                        bron={bron}
                        idVoorScroll={`bron-${i}-${j}`}
                        gehighlight={
                          highlight?.berichtIdx === i && highlight?.bronIdx === j
                        }
                      />
                    ))}
                  </LichteReflectieBron>
                )}

              {/* Onderbouwing en bronnen (FO §11c) — standaard ingeklapt.
                  Staat bewust vóór de vervolgacties: het antwoord staat zo
                  direct naast zijn bronnen, en de vervolgvragen sluiten daar
                  daaronder op aan. Niet tijdens de huidige reflectiebeurt: die
                  krijgt de lichte weergave hierboven. */}
              {b.rol === "ai" &&
                b.onderbouwing &&
                !(i === berichten.length - 1 && isReflectieActief(reflectieStatus)) && (
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
                !(laden && i === berichten.length - 1) &&
                // B-opt tranche 2f — tijdens de huidige reflectiebeurt geen
                // inhoudelijke vervolgvragen: die maken van de reflectie weer een
                // analyse (de server stuurt ze op een reflectiebeurt niet uit,
                // maar we zetten het hier expliciet dicht).
                !(i === berichten.length - 1 && isReflectieActief(reflectieStatus)) && (
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
                    b.onderbouwing?.documentGericht === true,
                    // G1 (plateau B) — tijdens een actieve reflectieflow geen
                    // vervolgacties. "Stel kritische vragen" duwt de bestuurder
                    // een richting in die hij juist zelf aan het bepalen is;
                    // "maak korter" slaat nergens op bij een verdiepingsvraag
                    // over zijn eigen twijfel. De status komt van de server.
                    isReflectieActief(reflectieStatus)
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

              {/* ── Plateau B — de reflectiefunctie, onder het LAATSTE antwoord ──
                  Twee dingen, die elkaar uitsluiten:

                  1. de permanent beschikbare gebruikersactie + de tijdelijke
                     uitnodigingskaart (B-2), zolang er geen reflectie loopt;
                  2. het gelabelde reflectie-invoerveld / de conceptkeuze (B-3),
                     zodra de flow actief is.

                  De kaart is GEEN chatbericht (FR-50): ze staat in de render,
                  niet in `berichten`, en verdwijnt met een klik zonder spoor. */}
              {b.rol === "ai" &&
                b.onderbouwing &&
                i === berichten.length - 1 &&
                !laden && (
                  <>
                    {!isReflectieActief(reflectieStatus) && (
                      <>
                        {uitnodigingZichtbaar ? (
                          <ReflectieKaart
                            vraag={
                              uitnodigingBesluitmoment
                                ? REFLECTIE_VRAAG_BESLUITMOMENT
                                : undefined
                            }
                            onKies={startReflectie}
                            onSluit={sluitUitnodiging}
                            bezig={laden}
                          />
                        ) : (
                          /* De PERMANENT beschikbare actie (v1.0 §9.1 A):
                             rustig, niet-prominent, altijd bereikbaar en niet
                             meegeteld in enige frequentiebegrenzing. Zelf gekozen
                             op een willekeurig antwoord ⇒ standaardvraag, geen
                             besluitmoment-variant. */
                          <button
                            type="button"
                            onClick={() => {
                              setUitnodigingBesluitmoment(false);
                              setUitnodigingZichtbaar(true);
                            }}
                            className="mt-2 text-xs text-muted hover:text-ink transition-colors"
                          >
                            Reflecteer op dit antwoord
                          </button>
                        )}
                      </>
                    )}

                    {isReflectieActief(reflectieStatus) && (
                      <ReflectieInvoer
                        status={reflectieStatus}
                        beurt={reflectieBeurt}
                        bezig={laden}
                        laatsteAntwoord={laatsteReflectieAntwoord}
                        onAntwoord={(t) => {
                          setLaatsteReflectieAntwoord(t);
                          stuurBericht(t, { reflectieAntwoord: true });
                        }}
                        onAfronden={() => vraagTransitie("afronden")}
                        onVerdiepen={() =>
                          // Geen zichtbare gebruikersbeurt: de assistent stelt
                          // de volgende verdiepingsvraag (B-opt tranche 2d).
                          stuurBericht(undefined, {
                            reflectieVerdiepen: true,
                            geenNieuweVraag: true,
                          })
                        }
                        onTegenperspectief={() =>
                          // B-opt tranche 4a — tegenperspectief-vraag, geen
                          // zichtbare gebruikersbeurt.
                          stuurBericht(undefined, {
                            reflectieTegenperspectief: true,
                            geenNieuweVraag: true,
                          })
                        }
                        onHerformuleren={(t) => {
                          // B-opt tranche 1a — de bestuurder scherpt zijn eigen
                          // overweging aan. Actie `herformuleren`: blijft in
                          // conceptweergave, beurt onveranderd; het concept wordt
                          // opnieuw opgebouwd met deze inbreng.
                          setLaatsteReflectieAntwoord(t);
                          stuurBericht(t, { reflectieHerformuleren: true });
                        }}
                        onAfbreken={() => vraagTransitie("afbreken")}
                      />
                    )}
                  </>
                )}
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
              magStukVoorbereiden={magStukVoorbereiden}
              onStukVoorbereiden={startStukVraag}
            />
          )}
          {/* P2 Deel B — "een document doorgronden": scherpsteltoestand binnen /ai
              (geen route). Neemt de lege staat over; Annuleren keert terug. */}
          {doorgrondOpen && !!doorgrondDoc && (
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
          {/* T2 — "een stuk voorbereiden": bureau-scherpsteltoestand binnen /ai. */}
          {stukOpen && (
            <StukVoorbereiden
              laden={laden}
              zoekDocumenten={zoekDocumenten}
              onStart={startStukVoorbereiden}
              onAnnuleren={() => setStukOpen(false)}
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

        {/* Besluit 0151 — module-scope-chip + "verdiep dit risico"-chips. De scope
            is zichtbaar als scope (onderscheiden van documentbronnen). Bij de
            risicomatrix/één-risico kan de bestuurder in de chat inzoomen op één
            risico; "hele risicomatrix" brengt de brede blik terug. */}
        {moduleScope && (
          <div className="mb-2 flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-2 max-w-full bg-accent-tint border border-accent/30 text-accent-ink text-xs rounded-full pl-3 pr-2 py-1">
                <span className="truncate">
                  {moduleScope.soort === "proces"
                    ? `Proces: «${moduleScope.label}»`
                    : moduleScope.soort === "risico"
                      ? `Risico: «${moduleScope.label}»`
                      : "Risicomatrix"}
                </span>
                <button
                  onClick={() => {
                    setModuleScope(null);
                    setRisicoLijst([]);
                  }}
                  className="shrink-0 w-4 h-4 rounded-full bg-accent hover:bg-accent text-accent-ink flex items-center justify-center"
                  aria-label="Modulecontext wissen"
                  title="Context wissen — niet langer over deze module vragen"
                >
                  ✕
                </button>
              </span>
              {moduleScope.soort === "risico" && (
                <button
                  onClick={() =>
                    setModuleScope({ soort: "risicomatrix", label: "de risicomatrix" })
                  }
                  className="text-xs text-accent hover:text-accent-ink underline underline-offset-2"
                >
                  ← hele risicomatrix
                </button>
              )}
            </div>
            {/* Inzoomen op één risico (verdieping). Alleen bij een actieve risico-
                scope en zolang de fondslijst is geladen. */}
            {(moduleScope.soort === "risicomatrix" || moduleScope.soort === "risico") &&
              risicoLijst.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-muted">Verdiep:</span>
                  {risicoLijst.map((r) => {
                    const actief =
                      moduleScope.soort === "risico" && moduleScope.risico_id === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() =>
                          setModuleScope({
                            soort: "risico",
                            risico_id: r.id,
                            label: r.titel,
                          })
                        }
                        aria-pressed={actief}
                        className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
                          actief
                            ? "bg-accent text-white border-accent"
                            : "border-line text-ink hover:border-accent"
                        }`}
                        title={`Inzoomen op «${r.titel}»`}
                      >
                        {r.titel.length > 34 ? `${r.titel.slice(0, 34)}…` : r.titel}
                      </button>
                    );
                  })}
                </div>
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
                Onderwerp: «{documentScope.titels[0] || "dit document"}»
                {documentScope.document_ids.length > 1
                  ? ` +${documentScope.document_ids.length - 1}`
                  : ""}
              </span>
              <button
                onClick={() => setDocumentScope(null)}
                className="shrink-0 w-4 h-4 rounded-full bg-warn hover:bg-warn text-warn-ink flex items-center justify-center"
                aria-label="Documentscope wissen"
                title="Onderwerp wissen — weer zonder hoofddocument vragen"
              >
                ✕
              </button>
            </span>
            <label
              className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              title="Het gekozen stuk is het onderwerp; de rest van de bibliotheek blijft beschikbaar als aanvulling. Aan: ook algemene kennis van het model, in gescheiden delen."
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

        {/* Werkstand "stukken in voorbereiding" — zie de state hierboven. Bewust
            hier, direct boven het invoerveld: het is een stand die geldt voor de
            volgende vraag, geen instelling die je in een menu zoekt. */}
        <div className="mb-2 flex items-center gap-2">
          <label
            className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer"
            title="Aan: stukken die nog niet zijn vastgesteld (concepten, vergaderstukken, stukken die ter besluitvorming voorliggen) worden meegenomen in het antwoord. Ze blijven herkenbaar aan hun statuslabel."
          >
            <input
              type="checkbox"
              checked={voorbereidingsstand}
              onChange={(e) => setVoorbereidingsstand(e.target.checked)}
              className="accent-accent"
              disabled={laden}
            />
            Stukken in voorbereiding meenemen
          </label>
          {voorbereidingsstand && (
            <span className="text-[11px] text-warn-ink bg-warn-tint border border-warn/30 rounded-full px-2 py-0.5">
              concepten worden meegenomen
            </span>
          )}
        </div>

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
