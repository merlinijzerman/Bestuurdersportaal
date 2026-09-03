"use client";
// ============================================================================
//  Assistent L2 — GESPREK (P1a, besluit 0201).
// ----------------------------------------------------------------------------
//  Eén hook draagt het hele gesprek: berichten, streaming, de events, de
//  verduidelijkingskeuze, de reflectieflow, de vervolgacties, de gespreksopslag
//  en — via `bouwChatPayload` — de VOLLEDIGE payload naar /api/chat.
//
//  DE REGEL DIE DIVERGENTIE VOORKOMT. Een surface (de pagina /ai, straks het
//  paneel, straks de agendapuntkaart) bouwt geen eigen aanroep meer. Ze levert
//  context aan (L1) en rendert wat deze hook teruggeeft. Zo kan het niet meer
//  gebeuren wat bij `AgendapuntChat` gebeurde: een kopie van een oudere aanroep
//  die niet meegroeide en negen van de vierentwintig velden stuurt, zonder dat
//  iets in de interface dat verklaart (ontwerpdoc §2).
//
//  Deze hook woont in `core/` en niet in `app/(dashboard)/ai/`, omdat er in
//  P1b een paneel naast een module komt te hangen — buiten de /ai-route.
//
//  GEDRAGSNEUTRAAL: de inhoud is één op één verhuisd uit `AssistentClient.tsx`.
//  Wat NIET meekwam is de kijkstaat: open panelen, highlight, de gesprekkenlade,
//  de @-mention-typeahead en het scrollen naar een bron. Die blijft in de
//  presentatielaag. Waar de gesprekslaag tóch een paneel moet sluiten, gebeurt
//  dat via een expliciete callback (`bijNieuwGesprek`, `bijGesprekGeopend`) en
//  niet door vanuit L2 in de weergave te grijpen.
// ============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/core/lib/supabase";
import {
  bepaalVervolgacties,
  isTransformatieActie,
  leesAntwoordmodus,
  type Antwoordmodus,
  type Vervolgactie,
} from "@/core/lib/vraagtype";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
import { bouwStukZin, parseStukZin, type Stuksoort } from "@/core/lib/stukvoorbereiding";
import {
  ACTIEF_GESPREK_SLEUTEL,
  reflectieUitnodigingGetoond,
  markeerReflectieUitnodiging,
} from "@/core/lib/ai-sessie";
import { INGANG_LABEL, type ReflectieStatus, type ReflectieIngang } from "@/core/lib/reflectie-flow";
import { verwijderGesprekViaApi } from "@/core/lib/gesprek-verwijderen";
import type { DocumentCtx } from "@/core/lib/portaalcontext-afleiding";
import type { Startvraag } from "@/core/lib/startvragen";
import { bouwDoorgrondZin, type DoorgrondSectieId } from "@/core/lib/doorgrond";
import { maakIdempotentVerzoek } from "@/core/lib/idempotency-key";
import { bouwChatPayload } from "@/core/lib/assistent-payload";
import {
  leegeStreamStand,
  leesStreamRegel,
  pasStreamEventToe,
  splitsStreamBuffer,
} from "@/core/lib/assistent-stream";
import {
  leesScope,
  leesAgendapuntContext,
  type AssistentContextWaarde,
} from "@/core/lib/assistent-context";
import {
  leesAssistentContextUitUrl,
  resolveerAssistentContext,
  type ContextLezer,
} from "@/core/lib/assistent-url-ingang";
import { type VoortgangUI } from "@/core/lib/voortgang";
import type {
  Bericht,
  DocSuggestie,
  OnderbouwingMeta,
  DocumentScope,
  GesprekItem,
  StuurOpties,
  VolledigeAnalyseAanbod,
} from "@/core/lib/assistent-types";

/** Eén document zoals de doorgrond-/stukscherpstel hem toont. */
interface DoorgrondDoc {
  id: string;
  titel: string;
}

export interface UseAssistentOpties {
  /** De contextlaag (L1): waar kijkt de bestuurder naar? */
  context: AssistentContextWaarde;
  // ── Handelingen ván de weergavelaag ─────────────────────────────────────
  //  Bewust CALLBACKS en geen refs. Een ref die de laaggrens oversteekt is een
  //  waarde waarvan geen van beide lagen nog kan overzien wanneer hij gelezen
  //  wordt; de React Compiler wijst dat terecht af. De gesprekslaag raakt dus
  //  geen enkele DOM-ref aan — ze zegt alleen wát er moet gebeuren.
  //  Geef ze stabiel mee (useCallback): het initialisatie-effect draagt ze in
  //  zijn dependency-lijst en mag maar één keer draaien.

  /** Zet de cursor in het invoerveld ("een vrije vraag stellen"). */
  focusInvoer: () => void;
  /** Waarheen na deze beurt gescrold moet worden (index), of null. */
  zetScrollDoel: (berichtIndex: number | null) => void;
  /** Toon een zojuist geopend/hersteld gesprek onderaan (T5 C2). */
  markeerScrollNaarOnder: (aan: boolean) => void;
  /** De weergavelaag sluit haar eigen panelen bij een nieuw gesprek. */
  bijNieuwGesprek?: () => void;
  /** …en bij het openen van een bestaand gesprek. */
  bijGesprekGeopend?: () => void;
  /**
   * De vervolgactie "toon gebruikte bronnen" klapt het onderbouwingspaneel van
   * één bericht open. Welke panelen open staan is kijkstaat en hoort in de
   * weergavelaag; de gesprekslaag geeft alleen door dát het moet.
   */
  toonBronnen?: (berichtIndex: number) => void;
}

// Voortgang tijdens het wachten (besluit 0087): types, reducer en weergave leven
// in core/lib/voortgang, gedeeld met de agenda-voorbereiding (AgendapuntChat).

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

export function useAssistent(opties: UseAssistentOpties) {
  const { context, focusInvoer, zetScrollDoel, markeerScrollNaarOnder } = opties;
  // De contextsetters apart: ze zijn stabiel (useState-setters), zodat het
  // initialisatie-effect hieronder ze in zijn dependency-lijst kan dragen zonder
  // opnieuw te vuren. Zou het effect van het hele `context`-object afhangen, dan
  // liep het bij elke scopewijziging opnieuw — en dat effect mag precies één
  // keer draaien.
  const {
    zetDocumentScope,
    zetAgendapuntContext,
    zetModuleScope,
    zetRisicoLijst,
    zetHerkomst,
  } = context;

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
  // Voornaam voor de startpunt-aanhef; fondsnaam voor de herkomstregel onder een
  // kopie (besluit 0098). Leeg tot het profiel geladen is.
  const [voornaam, setVoornaam] = useState<string>("");
  const [fondsNaam, setFondsNaam] = useState<string>("");
  // Increment I-2 (FO §11a) — de zichtbare bron-as is vervangen door automatische
  // bronkeuze; alleen de expliciete restrictie blijft over.
  const [alleenFondsdocumenten, setAlleenFondsdocumenten] = useState(false);
  // Increment F (FO §14) — "algemeen perspectief": profielgestuurde prioritering uit.
  const [algemeenPerspectief, setAlgemeenPerspectief] = useState(false);
  // Increment G — vastgezette antwoordmodus (null = auto-detectie).
  const [antwoordmodus, setAntwoordmodus] = useState<Antwoordmodus | null>(null);
  // ── Plateau B — de reflectiedialoog ───────────────────────────────────────
  // De status komt van de SERVER (gesprek_reflectie_state via
  // /api/reflectie/transitie) en wordt hier alleen weergegeven. De client
  // bepaalt hem nooit zelf: dat is de kern van besluit 0110 en van AC-18.
  const [reflectieStatus, setReflectieStatus] = useState<ReflectieStatus>("niet_actief");
  // De uitnodiging is een TIJDELIJKE UI-KAART, geen bericht (FR-50, besluit
  // 0109). Wegklikken raakt `gesprekken.berichten` niet en schrijft geen auditregel.
  const [uitnodigingZichtbaar, setUitnodigingZichtbaar] = useState(false);
  const [uitnodigingBesluitmoment, setUitnodigingBesluitmoment] = useState(false);
  // B-opt tranche 1a — het eigen laatste reflectieantwoord, om het herformuleer-
  // veld ("Aanpassen") mee voor te vullen. Nooit de AI-tekst van het concept.
  const [laatsteReflectieAntwoord, setLaatsteReflectieAntwoord] = useState("");
  // B-opt tranche 2d — de huidige beurt; komt server-side mee in het done-event.
  const [reflectieBeurt, setReflectieBeurt] = useState(0);
  // Permanente opt-out uit het profiel (FR-15). Zolang we het niet weten tonen we
  // niets — liever geen uitnodiging dan een uitnodiging aan wie hem heeft uitgezet.
  const [uitnodigingToegestaan, setUitnodigingToegestaan] = useState(false);
  // Persistentie (Fase B2): id van het huidige opgeslagen gesprek en de
  // ingelogde gebruiker. Refs i.p.v. state — wijziging hoeft geen re-render.
  const gesprekId = useRef<string | null>(null);
  // Plateau A — bestaat de rij in `gesprekken` al? Het id wordt sinds plateau A
  // vóór de eerste beurt gegenereerd, dus `gesprekId.current !== null` betekent
  // niet langer "staat al in de database".
  const gesprekBestaatInDb = useRef(false);
  // Het actieve gesprek-id óók als waarde. De ref blijft de bron van waarheid
  // (hij moet synchroon leesbaar zijn binnen één beurt); deze spiegel bestaat
  // puur zodat de gesprekkenlade het actieve gesprek kan markeren zonder een
  // ref tijdens de render te lezen. Elk pad dat de ref zet, zet ook al andere
  // state, dus dit levert geen extra render op.
  const [actiefGesprekId, setActiefGesprekId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Gepersonaliseerde welkomstboodschap, zodat "nieuw gesprek" altijd een
  // schone start toont (ook nadat een eerder gesprek is geopend).
  const welkomstRef = useRef<Bericht | null>(null);
  // Gesprekken-overzicht (Fase B2-volledig).
  const [gesprekken, setGesprekken] = useState<GesprekItem[]>([]);
  // ── Werkstand "stukken in voorbereiding" (12-08-2026) ─────────────────────
  // Zet de actualiteitsfilter uit voor élke vraag in dit gesprek. Bewust een
  // STAND en geen gok: het systeem hoeft niet uit de woordkeuze af te leiden of
  // iemand een vergadering voorbereidt, de gebruiker zegt het.
  const [voorbereidingsstand, setVoorbereidingsstand] = useState(false);
  // P2 Deel B — "een document doorgronden": scherpsteltoestand binnen de chat.
  const [doorgrondOpen, setDoorgrondOpen] = useState(false);
  const [doorgrondDoc, setDoorgrondDoc] = useState<DocumentCtx | null>(null);
  // T2 — bureau-stand "Een stuk voorbereiden". `rol` bepaalt (cosmetisch) of de
  // taakkaart verschijnt; de echte gate zit server-side (route + RPC).
  const [rol, setRol] = useState<string | null>(null);
  const [stukOpen, setStukOpen] = useState(false);
  const [stukContext, setStukContext] = useState<{
    stuksoort: Stuksoort;
    onderwerp: string;
  } | null>(null);
  const [stukExportBezig, setStukExportBezig] = useState<number | null>(null);
  // P2 Deel A — de voorbeeldvragen verschijnen pas na "Een vrije vraag stellen".
  const [vrijeVraagOpen, setVrijeVraagOpen] = useState(false);
  // Voortgang tijdens het wachten (besluit 0087): één staat die de actieve fase
  // als lopende regel toont en afgeronde fasen (met hun uitkomst) eronder.
  const [voortgang, setVoortgang] = useState<VoortgangUI | null>(null);
  // De browserclient hoort bij deze gemounte assistent. Een lazy initializer
  // voorkomt dat een gewone rerender een nieuwe client (en daarmee een nieuw
  // initialisatie-effect) oplevert.
  const [supabase] = useState(createClient);

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
    setActiefGesprekId(id);
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
    setActiefGesprekId(null);
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
    markeerScrollNaarOnder(
      Array.isArray(item.berichten) && item.berichten.length > 0
    );
    setBerichten(
      Array.isArray(item.berichten) && item.berichten.length > 0
        ? herstelVoltooidVlag(item.berichten)
        : welkomstRef.current
        ? [welkomstRef.current]
        : []
    );
    context.zetDocumentScope(leesScope(item.document_scope));
    context.zetAgendapuntContext(leesAgendapuntContext(item.document_scope));
    setAntwoordmodus(leesAntwoordmodus(item.actieve_antwoordmodus));
    // B2-vervolg: herstel de stuk-context, zodat de Word-export beschikbaar is op
    // een heropend stuk-gesprek (en cleart hem voor een niet-stuk-gesprek).
    setStukContext(stukContextUitBerichten(item.berichten));
    opties.bijGesprekGeopend?.();
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
    focusInvoer();
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

  /** "Annuleren" in de doorgrond-scherpstel: terug naar de lege staat. */
  function sluitDoorgronden() {
    setDoorgrondOpen(false);
    setDoorgrondDoc(null);
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
    context.zetAgendapuntContext(null);
    // De voorganger komt ALLEEN in de scope (en het auditspoor) als "Afwijkingen"
    // gekozen is — anders zou een pure "Samenvatting" de hele vorige versie
    // meetrekken (retrieval-dilutie) en een niet-gevraagde vergelijking loggen.
    const vergelijk = secties.includes("afwijkingen") ? vorige : null;
    const ids = vergelijk ? [doc.id, vergelijk.id] : [doc.id];
    const titels = vergelijk ? [doc.titel, vergelijk.titel] : [doc.titel];
    const scope: DocumentScope = { document_ids: ids, titels };
    context.zetDocumentScope(scope);
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

  /** "Annuleren" in de bureau-scherpstel. */
  function sluitStukVoorbereiden() {
    setStukOpen(false);
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
    context.zetAgendapuntContext(null);
    // Bij de bronloze variant is er geen document-scope: de server draait dan de
    // concept-skelet-tak. Bij de bron-variant leveren de stukken de bronnen.
    const scope: DocumentScope | null = bronloos
      ? null
      : {
          document_ids: documenten.map((d) => d.id),
          titels: documenten.map((d) => d.titel),
        };
    context.zetDocumentScope(scope);
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
      context.zetDocumentScope(null);
      context.zetAgendapuntContext(null);
    }
    laadGesprekken();
  }

  // Slaat het gesprek best-effort op. Faalt veilig: een mislukte opslag mag de
  // chat nooit verstoren. governance_log (auditspoor) staat hier los van.
  // `scopeVoorOpslag` is de GESPREKSSCOPE die bewaard moet worden. Normaal is dat
  // gewoon de gecommitte documentScope-state; alleen wanneer een taak de scope in
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
        scopeVoorOpslag || context.agendapuntContext
          ? {
              type: "single",
              document_ids: scopeVoorOpslag?.document_ids ?? [],
              titels: scopeVoorOpslag?.titels ?? [],
              algemene_kennis: scopeVoorOpslag?.algemene_kennis === true,
              ...(context.agendapuntContext
                ? {
                    agendapunt_context: {
                      id: context.agendapuntContext.id,
                      titel: context.agendapuntContext.titel,
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
              markeerScrollNaarOnder(true);
              setBerichten(herstelVoltooidVlag(opgeslagen));
              zetDocumentScope(leesScope(laatste.document_scope));
              zetAgendapuntContext(leesAgendapuntContext(laatste.document_scope));
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

        // ── De URL-ingang (L1) — ÉÉN plek ────────────────────────────────
        // `?doc=`, `?agendapunt=`, `?proces=`, `?risicomatrix=1` en `?intent=`
        // stonden hier als vier losse blokken, elk met een eigen
        // `new URLSearchParams(...)`, een eigen query en een eigen try/catch.
        // Ze wonen nu in `core/lib/assistent-url-ingang.ts`.
        //
        // Bewust op DEZELFDE plek in deze reeks aangeroepen en niet in een
        // eigen effect: de takken draaien ná het laden van het profiel en ná de
        // auto-restore, en ze gebruiken de gepersonaliseerde welkomsttekst. Een
        // eigen effect zou daarmee een race introduceren en bij een deeplink de
        // generieke begroeting kunnen tonen.
        const urlVerzoek = leesAssistentContextUitUrl(window.location.search);
        // De resolver vraagt om een MINIMALE leesinterface (select/eq/order),
        // niet om de supabase-client zelf: zo is hij te testen met een stub en is
        // aan zijn signatuur te zien dat hij nooit schrijft. De generieke typen
        // van de echte client matchen daar niet structureel op (tsc loopt vast op
        // de diepte), vandaar deze ene, bewuste versmalling.
        const urlContext = await resolveerAssistentContext(
          supabase as unknown as ContextLezer,
          urlVerzoek.ingang
        );
        if (urlContext.startSchoonGesprek) {
          // Een schoon gesprek, zodat de scope niet over een bestaand gesprek
          // heen valt.
          gesprekId.current = null;
          setActiefGesprekId(null);
          gesprekBestaatInDb.current = false;
          setBerichten([{ rol: "ai", tekst: personalTekst }]);
        }
        // Alleen de velden die deze ingang ZET; een ontbrekende sleutel laat het
        // veld met rust (zie AssistentContextPatch).
        const { patch } = urlContext;
        if (patch.documentScope !== undefined) zetDocumentScope(patch.documentScope);
        if (patch.agendapuntContext !== undefined)
          zetAgendapuntContext(patch.agendapuntContext);
        if (patch.moduleScope !== undefined) zetModuleScope(patch.moduleScope);
        if (patch.risicoLijst !== undefined) zetRisicoLijst(patch.risicoLijst);
        // Ingreep 2 — de bevestigde bron-intentie geldt voor dit gesprek en
        // staat NAAST een eventuele scope; "Nieuw gesprek" wist hem.
        if (urlVerzoek.herkomst) zetHerkomst(urlVerzoek.herkomst);


        // Vul het gesprekken-overzicht.
        laadGesprekken();
      }
    });
  }, [
    laadGesprekken,
    supabase,
    zetDocumentScope,
    zetAgendapuntContext,
    zetModuleScope,
    zetRisicoLijst,
    zetHerkomst,
    markeerScrollNaarOnder,
  ]);



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
      opties?.scopeOverride !== undefined ? opties.scopeOverride : context.documentScope;
    // De te BEWAREN gespreksscope. Default = de (gecommitte) documentScope-state,
    // zodat vervolgacties met een per-turn scopeOverride de bewaarde gespreksscope
    // NIET wijzigen (regressie-fix). Alleen doorgronden geeft persistScope mee,
    // omdat het de scope in dezelfde tick zet én verstuurt (state nog niet gecommit).
    const scopeVoorOpslag =
      opties?.persistScope !== undefined ? opties.persistScope : context.documentScope;

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
    zetScrollDoel(conversatie.length - 1);

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
            herkomst: context.herkomst,
            documentScope: effScope,
            antwoordmodus: effAntwoordmodus,
            agendapuntContext: context.agendapuntContext,
            moduleScope: context.moduleScope,
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
      // ── P1a — de stroomverwerking is een PURE reducer ────────────────────
      // `core/lib/assistent-stream.ts` bepaalt de nieuwe stand én zegt wat er
      // met de berichtenlijst moet gebeuren; hier blijft alleen het lezen van
      // de stroom en het toepassen daarvan op de React-staat. Reden: dit was
      // het enige pad van de assistent dat je niet kon verifiëren zonder te
      // klikken — dertien mutabele lokalen verweven met setState. Nu ligt elk
      // gedragsdetail vast in `assistent-stream.sanity.ts` en in
      // `tests/component/AssistentStream.component.test.tsx`.
      let stand = leegeStreamStand();

      const verwerkEvent = (raw: string) => {
        const evt = leesStreamRegel(raw);
        if (!evt) return;
        const vorige = stand;
        const { stand: nu, uitwerking } = pasStreamEventToe(vorige, evt, tekst);
        stand = nu;

        // Alleen zetten wat écht wijzigde, zodat de volgorde en het aantal
        // renders gelijk blijven aan de oude implementatie.
        if (nu.voortgang !== vorige.voortgang) setVoortgang(nu.voortgang);
        if (nu.antwoordGestart && !vorige.antwoordGestart) setAntwoordGestart(true);

        // De flowstatus komt van de SERVER en nergens anders: de client leidt
        // hem niet af uit wat hij zojuist verstuurde (FR-67, besluit 0110).
        // Loopt er een reflectie, dan is de uitnodiging niet aan de orde.
        if (nu.reflectie && nu.reflectie !== vorige.reflectie) {
          setReflectieStatus(nu.reflectie.status);
          if (typeof nu.reflectie.beurt === "number") setReflectieBeurt(nu.reflectie.beurt);
          if (nu.reflectie.status !== "niet_actief") setUitnodigingZichtbaar(false);
        }

        if (uitwerking.soort === "voegToe") {
          setBerichten((prev) => [...prev, uitwerking.bericht]);
        } else if (uitwerking.soort === "herschrijf") {
          setBerichten((prev) => {
            const kopie = [...prev];
            kopie[kopie.length - 1] = uitwerking.bericht;
            return kopie;
          });
        }
      };

      // Lees de SSE-stream; events zijn gescheiden door een lege regel.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { delen, rest } = splitsStreamBuffer(buffer);
        buffer = rest;
        for (const deel of delen) verwerkEvent(deel);
      }
      if (buffer.trim()) verwerkEvent(buffer);

      // Vangnet: stream eindigde zonder enige tekst.
      if (!stand.aiToegevoegd) {
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: "Er is geen antwoord ontvangen. Probeer het opnieuw." },
        ]);
      } else if (stand.volledig.trim()) {
        // Persisteer het gesprek (Fase B2) na een geslaagd antwoord. Bewust
        // NIET alle velden van de bubbel: `verbreding` en `bronkeuzeAanbod`
        // zijn live-only chips en horen niet in de opgeslagen historie.
        const finale: Bericht[] = [
          ...conversatie,
          {
            rol: "ai",
            tekst: stand.volledig,
            bronnen: stand.bronnen,
            modus: stand.modus,
            onderbouwing: stand.onderbouwing,
            inlineMeldingen: stand.inlineMeldingen,
            volledigeAnalyseAanbod: stand.volledigeAnalyseAanbod,
            logId: stand.logId,
          },
        ];
        await bewaarGesprek(finale, scopeVoorOpslag);

        // ── Plateau B / B-2 — de proactieve uitnodiging ────────────────────
        // Nadrukkelijk PAS hier: het antwoord is af en bewaard. De uitnodiging
        // onderbreekt niets en blokkeert niets; wie hem negeert mist niets.
        overweegUitnodiging(stand.onderbouwing, opties);
      } else if (stand.verduidelijkingBericht) {
        // Besluit 0092 — ook een TERUGVRAAG is een beurt: bewaren zodat de vraag een
        // refresh overleeft en in de lade "Gesprekken" terugkomt. Klikt de bestuurder
        // daarna op een chip, dan overschrijft die beurt dezelfde gespreksrij
        // (`gesprekId` is dan gezet) met de vraag + het echte antwoord — de
        // verduidelijkingsbubbel verdwijnt dus netjes, geen dubbele beurt.
        await bewaarGesprek(
          [...conversatie, stand.verduidelijkingBericht],
          scopeVoorOpslag
        );
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

  // Increment I-1 (FO §13) — voer een contextbewuste vervolgactie uit. Reformat-
  // acties hergebruiken strikt dezelfde bronselectie als het oorspronkelijke
  // antwoord; verbredende acties (besluitvorming, tijdlijn) niet.
  //
  // Eén actie is puur weergave: "toon gebruikte bronnen" klapt een paneel open.
  // Die staat bezit de gesprekslaag niet, dus daarvoor is er een callback.
  function stuurVervolgactie(actie: Vervolgactie, bron: Bericht, idx: number) {
    if (actie.type === "toon_bronnen") {
      opties.toonBronnen?.(idx);
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
    setActiefGesprekId(null);
    gesprekBestaatInDb.current = false;
    setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    setInvoer("");
    context.zetDocumentScope(null);
    context.zetAgendapuntContext(null);
    // Besluit 0151 — de module-scope + verdiep-lijst golden voor het vorige gesprek.
    context.zetModuleScope(null);
    context.zetRisicoLijst([]);
    context.zetHerkomst(null); // ingreep 2 — de module-ingang gold voor het vorige gesprek
    setVrijeVraagOpen(false);
    // De weergavelaag sluit haar eigen panelen (typeahead, gesprekkenlade):
    // die staat hoort niet in de gesprekslaag.
    opties.bijNieuwGesprek?.();
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


  return {
    // ── het gesprek ──────────────────────────────────────────────────────
    berichten,
    invoer,
    setInvoer,
    laden,
    antwoordGestart,
    voortgang,
    stuurBericht,
    startNieuwGesprek,

    // ── identiteit uit het profiel ───────────────────────────────────────
    fondsId,
    voornaam,
    fondsNaam,
    rol,
    magStukVoorbereiden,

    // ── gespreksinstellingen (gaan mee in de payload) ────────────────────
    alleenFondsdocumenten,
    setAlleenFondsdocumenten,
    algemeenPerspectief,
    setAlgemeenPerspectief,
    antwoordmodus,
    setAntwoordmodus,
    voorbereidingsstand,
    setVoorbereidingsstand,

    // ── de gesprekkenlade ────────────────────────────────────────────────
    gesprekken,
    /** Voor de lade: welk gesprek is nu actief? */
    actiefGesprekId,
    openGesprek,
    verwijderGesprek,

    // ── reflectie (server-controlled, FR-67) ─────────────────────────────
    reflectieStatus,
    reflectieBeurt,
    uitnodigingZichtbaar,
    setUitnodigingZichtbaar,
    uitnodigingBesluitmoment,
    setUitnodigingBesluitmoment,
    laatsteReflectieAntwoord,
    setLaatsteReflectieAntwoord,
    startReflectie,
    sluitUitnodiging,
    vraagTransitie,

    // ── handelingen op een antwoord ──────────────────────────────────────
    kiesVerduidelijking,
    kiesVerbreding,
    kiesBronkeuze,
    kiesVolledigeAnalyse,
    stuurVervolgactie,

    // ── taken die een gesprek openen ─────────────────────────────────────
    vrijeVraagOpen,
    startVrijeVraag,
    startVoorbeeldvraag,
    startDocumentVraag,
    doorgrondOpen,
    doorgrondDoc,
    sluitDoorgronden,
    startDoorgronden,
    stukOpen,
    startStukVraag,
    sluitStukVoorbereiden,
    startStukVoorbereiden,
    stukContext,
    stukExportBezig,
    exporteerNaarWord,

    // ── gedeelde documentzoek (ook voor de @-typeahead in de weergave) ───
    zoekDocumenten,
    haalVorigeVersie,
  };
}
