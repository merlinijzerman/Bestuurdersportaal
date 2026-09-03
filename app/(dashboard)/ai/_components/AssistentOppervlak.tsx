"use client";
import { useState, useRef, useEffect, useCallback } from "react";
// P1a — de assistent in drie lagen (besluit 0201). Dit bestand is L3: de
// presentatie. Het houdt alleen kijkstaat en rendert wat L1 (context) en L2
// (gesprek) leveren; het bouwt geen aanroep en kent de payload niet.
import { useAssistent } from "@/core/components/assistent/useAssistent";
import { useAssistentContext } from "@/core/components/assistent/AssistentContextProvider";
import { useAssistentPaneel } from "@/core/components/assistent/AssistentPaneelProvider";
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
} from "./AntwoordWeergave";
import { isDocumentbron } from "@/core/lib/documentlijst";
import { VoortgangWeergave, type VoortgangUI } from "./Voortgang";
import Startpunt from "./Startpunt";
import { GENERIEKE_STARTVRAGEN } from "@/core/lib/startvragen";
import VergelijkResultaatWeergave from "./VergelijkResultaatWeergave";
import DocumentDoorgronden, { type DoorgrondDoc } from "./DocumentDoorgronden";
import StukVoorbereiden from "./StukVoorbereiden";
import Icoon from "@/core/components/icons/Icoon";
// Plateau B — de reflectiedialoog. De flowstatus is server-controlled; deze
// module levert alleen de labels, de type-guards en de weergavehulp.
import { isActief as isReflectieActief } from "@/core/lib/reflectie-flow";
import ReflectieKaart, {
  REFLECTIE_VRAAG_BESLUITMOMENT,
} from "@/core/components/ReflectieKaart";
import ReflectieInvoer from "@/core/components/ReflectieInvoer";
import { verwijderDialoogTekst } from "@/core/lib/gesprek-verwijderen";
import type {
  PortaalContext,
  DocumentCtx,
} from "@/core/lib/portaalcontext-afleiding";
// P1a — de gespreks- en contexttypen wonen sinds de laagsplitsing in `core/`,
// zodat de payload-bouwer en de gesprekshook ze kunnen gebruiken zonder uit
// `app/` te importeren (boundary T9). Ongewijzigd verhuisd uit dit bestand.
import type {
  Bericht,
  DocumentScope,
  ModuleScope,
  DocSuggestie,
  AgendapuntContext,
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

// Ingreep 2 — leesbare labels voor de module-ingang (/ai?herkomst=<slug>). Bewust
// een vaste tabel: de slug uit de URL wordt nooit als vrije tekst getoond.
const HERKOMST_LABEL: Record<string, string> = {
  vergaderingen: "Vergaderingen",
  risicomatrix: "Risicomatrix",
  procedures: "Processen",
  bibliotheek: "Bibliotheek",
  portaal: "het portaal",
};

/**
 * L3 — de presentatie: kijkstaat en opmaak, verder niets.
 *
 * T1 (besluit 0204): dit oppervlak is niet langer "de pagina /ai" maar de
 * INHOUD VAN HET PANEEL, en het paneel hangt in `DashboardShell`. De provider
 * die hier stond is meeverhuisd naar die schil; `startpuntContext` is geen prop
 * meer maar komt uit de paneelstaat, omdat alleen de route `/ai` hem
 * server-side ophaalt (`getPortaalContext()` — 4 à 5 query's, die we niet aan
 * elke dashboardpagina willen opdringen).
 *
 * Eén instantie, in de schil. Twee zouden twee gesprekken zijn, twee
 * Supabase-clients en twee schrijvers naar dezelfde `gesprekken`-rij.
 */
export default function AssistentOppervlak() {
  // ── Kijkstaat: alles wat alleen over de WEERGAVE gaat ────────────────────
  const [aanpassenOpen, setAanpassenOpen] = useState(false);
  const [historieOpen, setHistorieOpen] = useState(false);
  // Welke onderbouwingspanelen open staan (per bericht-index). Default dicht.
  const [openPanelen, setOpenPanelen] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<{
    berichtIdx: number;
    bronIdx: number;
  } | null>(null);
  // Scrollen is presentatie: deze refs horen hier. De gesprekslaag zet alleen
  // het doel (na een verstuurde vraag) of de vlag (bij een geopend gesprek).
  const scrollDoel = useRef<number | null>(null);
  const scrollNaarOnder = useRef<boolean>(false);
  // Startpunt (P1, besluit 0085) — ref op het invoerveld zodat "Vrije vraag"
  // de cursor direct in het invoerveld zet.
  const invoerRef = useRef<HTMLTextAreaElement | null>(null);
  // De gesprekslaag krijgt handelingen, geen refs: zo raakt zij geen DOM aan en
  // blijft overzichtelijk wie wanneer leest en schrijft.
  const focusInvoer = useCallback(() => invoerRef.current?.focus(), []);
  const zetScrollDoel = useCallback((berichtIndex: number | null) => {
    scrollDoel.current = berichtIndex;
  }, []);
  const markeerScrollNaarOnder = useCallback((aan: boolean) => {
    scrollNaarOnder.current = aan;
  }, []);
  // @-mention-typeahead op documenttitels.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionSuggesties, setMentionSuggesties] = useState<DocSuggestie[]>([]);

  // ── De paneelstaat: stand, openstaande ingang-aanvraag, startpuntgegevens ──
  const paneel = useAssistentPaneel();
  const { startpuntContext } = paneel;

  // ── L1: waar kijkt de bestuurder naar? ────────────────────────────────────
  const context = useAssistentContext();
  const {
    documentScope,
    zetDocumentScope,
    agendapuntContext,
    zetAgendapuntContext,
    moduleScope,
    zetModuleScope,
    risicoLijst,
    zetRisicoLijst,
    herkomst,
    zetHerkomst,
  } = context;

  // ── L2: het gesprek ───────────────────────────────────────────────────────
  const {
    pasIngangToe,
    berichten,
    invoer,
    setInvoer,
    laden,
    antwoordGestart,
    voortgang,
    stuurBericht,
    startNieuwGesprek,
    voornaam,
    fondsNaam,
    magStukVoorbereiden,
    alleenFondsdocumenten,
    setAlleenFondsdocumenten,
    algemeenPerspectief,
    setAlgemeenPerspectief,
    antwoordmodus,
    setAntwoordmodus,
    voorbereidingsstand,
    setVoorbereidingsstand,
    gesprekken,
    actiefGesprekId,
    openGesprek,
    verwijderGesprek,
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
    kiesVerduidelijking,
    kiesVerbreding,
    kiesBronkeuze,
    kiesVolledigeAnalyse,
    stuurVervolgactie,
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
    zoekDocumenten,
    haalVorigeVersie,
  } = useAssistent({
    context,
    focusInvoer,
    zetScrollDoel,
    markeerScrollNaarOnder,
    bijGesprekGeopend: () => setHistorieOpen(false),
    bijNieuwGesprek: () => {
      sluitMention();
      setHistorieOpen(false);
    },
    toonBronnen: (idx) => setOpenPanelen((s) => new Set(s).add(idx)),
  });

  const scrollNaarBron = useCallback((berichtIdx: number, bronIdx: number) => {
    // Increment I-1 — de bronkaarten leven in het (standaard ingeklapte) paneel
    // "Onderbouwing en bronnen"; open het eerst, scrol daarna na de render.
    setOpenPanelen((s) => new Set(s).add(berichtIdx));
    window.setTimeout(() => {
      const el = document.getElementById(`bron-${berichtIdx}-${bronIdx}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setHighlight({ berichtIdx, bronIdx });
  }, []);

  // De highlight dooft na twee seconden. Dit stond eerder als `setTimeout` op
  // een ref binnen `scrollNaarBron`; die functie wordt tijdens de render aan de
  // antwoordrenderer meegegeven, en een ref lezen in de render is precies wat
  // je niet moet doen (React Compiler: "Cannot access refs during render").
  // Als effect is het bovendien korter: de opruimfunctie annuleert vanzelf de
  // vorige timer wanneer er een nieuwe bron wordt aangewezen.
  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlight]);


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
    zetAgendapuntContext(null);
    zetDocumentScope({ document_ids: documentIds, titels, algemene_kennis: true });
    focusInvoer();
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
    zetAgendapuntContext(null);
    zetDocumentScope({ document_ids: [s.id], titels: [s.titel] });
    setInvoer((huidig) => huidig.replace(/@([^\s@]*)$/, "").trimEnd());
    sluitMention();
  }

  // Zoek documenten zodra het @-fragment wijzigt. De suggestiebron zelf
  // (`zoekDocumenten`) komt uit de gesprekslaag: één implementatie voor zowel
  // deze typeahead als de documentkiezer in "een document doorgronden"
  // (P2 Deel B, criterium 8 — geen tweede zoekcode).

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

  // ── De ingang-aanvraag verzilveren (T1) ───────────────────────────────────
  // Een module-knop legt alleen een AANVRAAG neer; hier wordt hij opgezocht en
  // toegepast, met dezelfde resolver als een deeplink. Waarom hier en niet in de
  // knop: de resolutie heeft de Supabase-client van de gesprekslaag nodig, en
  // die bestaat pas als dit oppervlak gemount is — wat bij de eerste klik per
  // definitie nog niet zo was. De aanvraag blijft daarom staan tot ze verwerkt
  // is; `sleutel` maakt twee klikken op dezelfde knop onderscheidbaar.
  const aanvraag = paneel.aanvraag;
  const meldAanvraagVerwerkt = paneel.meldAanvraagVerwerkt;
  useEffect(() => {
    if (!aanvraag) return;
    let afgebroken = false;
    void (async () => {
      await pasIngangToe(aanvraag.ingangen);
      if (!afgebroken) meldAanvraagVerwerkt(aanvraag.sleutel);
    })();
    return () => {
      afgebroken = true;
    };
  }, [aanvraag, pasIngangToe, meldAanvraagVerwerkt]);

  // T1 — de hoogte komt van het PANEEL, niet meer van dit oppervlak. Hier stond
  // `h-[calc(100vh-3.5rem)] md:h-screen`, een compensatie voor de mobiele
  // topbalk van de shell. Het paneel is nu de vaste container (top/bottom in
  // `app/globals.css`) en trekt die balk daar af; nog een keer rekenen zou hem
  // dubbel tellen. `min-h-0` is nodig omdat een flex-kind anders niet kleiner
  // wordt dan zijn inhoud en de scroll van het gesprek naar het paneel verhuist.
  //
  // De vh/dvh-keuze uit P1a blijft daarmee op één plek staan (globals.css); een
  // eventuele overstap op `dvh` is nog steeds een keuze voor de hele keten.
  return (
    <div className="assistent-oppervlak flex h-full min-h-0 flex-col">
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-app-bg hover:text-ink"
                aria-label="Sluiten"
              >
                <Icoon sleutel="sluiten" grootte={17} />
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
                      g.id === actiefGesprekId
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
                      <Icoon sleutel="prullenbak" grootte={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-line p-3">
              <button
                onClick={startNieuwGesprek}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink transition-colors hover:border-accent"
              >
                <Icoon sleutel="plus" grootte={15} />
                Nieuw gesprek
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Werkbalk onder de paneelkop: governance, brongebruik als compacte chip
          mét zichtbare stand (i.p.v. de volzin), antwoordmodus als segmented
          control, en rechts de gespreksacties.
          Brongebruik én antwoordmodus blijven volledig afleesbaar (transparantie,
          besluit 0068/0071); alleen de brongebruik-VOLZIN is een chip-met-stand
          geworden — de volledige uitleg staat in de tooltip. Dit vervangt de drie
          losse kopbalken (topbar h-14 + brongebruik + antwoordmodus, ~200px chrome). */}
      <div className="assistent-werkbalk">
        <div className="assistent-werkbalk-instellingen">
          <span
            className="assistent-governance cursor-help"
            title="Elke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt."
            aria-label="Governance logging actief. Elke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt."
          >
            Governance actief
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
            <Icoon
              sleutel="chevron-rechts"
              grootte={13}
              className={aanpassenOpen ? "-rotate-90" : "rotate-90"}
            />
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
              onClick={() => zetHerkomst(null)}
              aria-label="Herkomst wissen en terug naar automatische bronkeuze"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-white/70 hover:text-ink"
            >
              <Icoon sleutel="sluiten" grootte={12} streek={2} />
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
            <Icoon sleutel="gebruikers" grootte={14} />
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
        </div>

        {/* Gespreksacties — rechts uitgelijnd. */}
        <div className="assistent-werkbalk-acties">
          <button
            onClick={() => setHistorieOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-muted transition-colors hover:border-ai hover:text-ink"
            title="Gespreksgeschiedenis"
          >
            <Icoon sleutel="geschiedenis" grootte={14} />
            <span className="assistent-actielabel">
              Gesprekken{gesprekken.length > 0 ? ` (${gesprekken.length})` : ""}
            </span>
          </button>
          <button
            onClick={startNieuwGesprek}
            disabled={laden || berichten.length <= 1}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-muted transition-colors hover:border-ai hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            title="Nieuw gesprek"
          >
            <Icoon sleutel="plus" grootte={14} />
            <span className="assistent-actielabel">Nieuw gesprek</span>
          </button>
        </div>
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
      <div className="assistent-gesprek relative flex-1 overflow-y-auto">
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
          {/* T1 — het startpunt vraagt om `PortaalContext`, en die haalt alleen de
              route `/ai` server-side op. In het smalle paneel is er voor het
              kaartenraster sowieso geen ruimte; daar staat de compacte lege
              stand hieronder. Bewuste keuze, besluit 0204. */}
          {toonStartpunt && startpuntContext && (
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
          {/* De compacte lege stand van het paneel: geen kaartenraster, wel een
              begroeting en dezelfde voorbeeldvragen. */}
          {toonStartpunt && !startpuntContext && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-ink">
                {voornaam ? `Dag ${voornaam}. ` : ""}Waar kan ik u mee helpen?
              </p>
              <ul className="space-y-1.5">
                {GENERIEKE_STARTVRAGEN.map((startvraag) => (
                  <li key={startvraag.vraag}>
                    <button
                      type="button"
                      onClick={() => startVoorbeeldvraag(startvraag)}
                      className="w-full rounded-lg border border-line bg-app-surface px-3 py-2 text-left text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                    >
                      {startvraag.vraag}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
              onAnnuleren={sluitDoorgronden}
            />
          )}
          {/* T2 — "een stuk voorbereiden": bureau-scherpsteltoestand binnen /ai. */}
          {stukOpen && (
            <StukVoorbereiden
              laden={laden}
              zoekDocumenten={zoekDocumenten}
              onStart={startStukVoorbereiden}
              onAnnuleren={sluitStukVoorbereiden}
            />
          )}
        </div>
      </div>

      {/* Invoerbalk */}
      <div className="assistent-invoerbalk">
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
                    zetModuleScope(null);
                    zetRisicoLijst([]);
                  }}
                  className="shrink-0 w-4 h-4 rounded-full bg-accent hover:bg-accent text-accent-ink flex items-center justify-center"
                  aria-label="Modulecontext wissen"
                  title="Context wissen — niet langer over deze module vragen"
                >
                  <Icoon sleutel="sluiten" grootte={10} streek={2.2} />
                </button>
              </span>
              {moduleScope.soort === "risico" && (
                <button
                  onClick={() =>
                    zetModuleScope({ soort: "risicomatrix", label: "de risicomatrix" })
                  }
                  className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-ink underline underline-offset-2"
                >
                  <Icoon sleutel="chevron-links" grootte={13} />
                  hele risicomatrix
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
                          zetModuleScope({
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
                  zetAgendapuntContext(null);
                  zetDocumentScope(null);
                }}
                className="shrink-0 w-4 h-4 rounded-full bg-accent hover:bg-accent text-accent-ink flex items-center justify-center"
                aria-label="Agendapunt-scope wissen"
                title="Scope wissen — niet langer over dit agendapunt vragen"
              >
                <Icoon sleutel="sluiten" grootte={10} streek={2.2} />
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
                onClick={() => zetDocumentScope(null)}
                className="shrink-0 w-4 h-4 rounded-full bg-warn hover:bg-warn text-warn-ink flex items-center justify-center"
                aria-label="Documentscope wissen"
                title="Onderwerp wissen — weer zonder hoofddocument vragen"
              >
                <Icoon sleutel="sluiten" grootte={10} streek={2.2} />
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
                  zetDocumentScope(
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

        <div className="assistent-composer">
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
            rows={2}
            disabled={laden}
          />
          <button
            onClick={() => stuurBericht()}
            disabled={laden || !invoer.trim()}
            className="assistent-verstuurknop"
            aria-label="Vraag versturen"
          >
            <Icoon sleutel="versturen" grootte={17} streek={1.8} />
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
