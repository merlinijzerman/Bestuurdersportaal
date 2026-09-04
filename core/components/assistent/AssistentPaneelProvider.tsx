"use client";
// ============================================================================
//  Assistent — de PANEELSTAAT (T1, besluit 0204).
// ----------------------------------------------------------------------------
//  Naast L1 (waar kijkt de bestuurder naar) staat een tweede, kleinere staat:
//  staat het paneel open, en hoe groot. Bewust gescheiden gehouden van de
//  contextlaag, want ze beantwoorden verschillende vragen — de context bestaat
//  óók als het paneel dicht is (besluit uit P1a: "context volgt wat open staat,
//  maar opent het paneel niet").
//
//  DE AANVRAAG IS HET KOPPELSTUK. Een module-ingang zet zélf geen scope: hij
//  legt een AANVRAAG neer (welke URL-ingangen) en de gespreklaag verzilvert die
//  met `resolveerAssistentContext()` — dezelfde resolver die de deeplinks
//  gebruiken. Eén resolutiepad voor knop én URL. Dat is ook waarom de aanvraag
//  blijft staan tot hij is verwerkt: het oppervlak wordt pas bij de eerste
//  opening gemount, dus de klik komt vóór de consument.
//
//  `module` in de aanvraag is UITSLUITEND clientstaat, voor het label
//  "Vanuit «…»" in het paneel. Hij gaat NIET de payload in. `/api/chat` logt
//  `bron_intent_bron`/`bron_intent_herkomst` alleen als er ook een
//  `bron_intent_override` is (route.ts r. 3184-3187 en r. 3814-3826), dus een
//  module-slug meesturen zou een veld zijn dat de route weggooit — een tweede
//  dood pad naast het pad dat dit ticket opruimt. Het aansluiten van de
//  herkomst op het auditspoor is uitgesteld naar T2, waar route en ingangen in
//  één keer meegaan. Zie besluit 0204 en §3b van issue #281.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AssistentUrlIngang } from "@/core/lib/assistent-url-ingang";
import type { Antwoordmodus } from "@/core/lib/vraagtype";
import type { PortaalContext } from "@/core/lib/portaalcontext-afleiding";

/**
 * Vier standen. `volledig` is de stand van de route `/ai`; de knop
 * "volledig scherm" navigeert daar zacht naartoe, zodat de route deelbaar en
 * bookmarkbaar blijft en het gesprek toch niet opnieuw begint (de layout — en
 * dus het oppervlak — blijft gemount).
 */
export type PaneelStand = "dicht" | "paneel" | "vergroot" | "volledig";

/**
 * Een beurt die de ingang zélf al meebrengt (T2, #304). De knop "Bereid dit punt
 * voor" opent niet alleen het paneel met de juiste context; hij stelt ook meteen
 * de vraag. Zo loopt de voorbereiding door dezelfde payloadbouwer, dezelfde
 * stroomverwerking en hetzelfde auditspoor als elke andere beurt.
 *
 * Net als `module` is dit UITSLUITEND clientstaat: het veld gaat niet als veld
 * de payload in. `vraag` wordt de gewone gebruikersbeurt en `antwoordmodus` gaat
 * als per-beurt-override mee (niet als vastgezette gespreksmodus — anders zou
 * elke vervolgvraag in voorbereidingsmodus blijven hangen).
 */
export interface PaneelStartbeurt {
  vraag: string;
  antwoordmodus: Antwoordmodus;
  /**
   * Het agendapunt waarvan deze beurt het product bijwerkt. De kaart luistert
   * hierop om de bewaarde voorbereiding opnieuw in te lezen; zonder dat signaal
   * zou de bestuurder het resultaat pas na een herlaadbeurt in de kaart zien.
   */
  productVoorAgendapunt?: string;
}

/** Wat een ingang aanvraagt. `sleutel` maakt twee gelijke klikken onderscheidbaar. */
export interface PaneelAanvraag {
  ingangen: AssistentUrlIngang[];
  module: string | null;
  startbeurt?: PaneelStartbeurt;
  sleutel: number;
}

/** Handelingen die door de gespreklaag worden geleverd, maar in de paneelkop
 * staan. De schil kent de gespreksimplementatie bewust niet. */
export interface AssistentPaneelBediening {
  nieuwGesprek: () => void;
  nieuwGesprekBeschikbaar: boolean;
  openInstellingen: () => void;
}

export interface AssistentPaneelWaarde {
  stand: PaneelStand;
  /** Manifest (T8): staat module `ai` uit, dan bestaat er geen enkele ingang. */
  aiBeschikbaar: boolean;
  /** Pas ná de eerste opening wordt het oppervlak gemount (en blijft het staan). */
  ooitGeopend: boolean;
  /** Het label "Vanuit «…»" in de paneelkop. Clientstaat, geen payloadveld. */
  ingangModule: string | null;
  /** Laat een puur presentatieve modulecontext los. */
  wisIngangModule: () => void;
  /** De openstaande aanvraag, of null. */
  aanvraag: PaneelAanvraag | null;
  /** De gespreklaag meldt dat ze de aanvraag heeft verzilverd. */
  meldAanvraagVerwerkt: (sleutel: number) => void;
  /** Registreert gespreksacties die de paneelkop mag aanbieden. */
  bediening: AssistentPaneelBediening | null;
  registreerBediening: (bediening: AssistentPaneelBediening | null) => void;
  /**
   * Teller die ophoogt zodra een startbeurt een agendapuntproduct heeft
   * bijgewerkt. De agendapuntkaart leest daarop opnieuw in. Bewust een teller en
   * geen payload: de kaart haalt de waarheid uit de database, niet uit een
   * boodschap die onderweg kan verschralen.
   */
  productSignaal: { agendapuntId: string; teller: number } | null;
  meldProductBijgewerkt: (agendapuntId: string) => void;
  /** Opent het paneel met een context-aanvraag (de zes module-ingangen). */
  openMet: (aanvraag: {
    ingangen: AssistentUrlIngang[];
    module: string | null;
    startbeurt?: PaneelStartbeurt;
  }) => void;
  /** Opent het paneel zonder aanvraag (de knop rechtsonder). */
  openGeneriek: () => void;
  zetStand: (stand: PaneelStand) => void;
  /**
   * Krimpt uit volledig scherm naar het paneel — en alleen dán. Bewust een
   * handeling van deze laag en geen `zetStand("paneel")` bij de aanroeper: de
   * beslissing "stond hij nog volledig?" hoort bij de staat zelf, anders moet
   * elke aanroeper die waarde in een ref bijhouden.
   */
  krimpUitVolledig: () => void;
  sluit: () => void;
  /**
   * Het pad waar de bestuurder vandaan kwam toen hij naar volledig scherm ging.
   * Zonder dit zou "terug naar het paneel" een `router.back()` zijn, en die
   * loopt bij een rechtstreeks geopende `/ai` (bookmark) het portaal uit.
   */
  vorigPad: string | null;
  zetVorigPad: (pad: string | null) => void;
  /**
   * De startpuntgegevens (besluit 0085/0088). Alleen `/ai` levert ze — daar
   * draait `getPortaalContext()` server-side. In het smalle paneel is er geen
   * ruimte voor het kaartenraster én geen context; dat krijgt een compacte
   * lege stand. Bewuste keuze, zie 0204.
   */
  startpuntContext: PortaalContext | null;
  zetStartpuntContext: (context: PortaalContext | null) => void;
}

const PaneelContext = createContext<AssistentPaneelWaarde | null>(null);

/**
 * Bouwt de paneelstaat. Apart van de provider omdat `DashboardShell` de stand
 * óók zelf nodig heeft — de contentmarge hangt eraan — en een component zijn
 * eigen context niet kan consumeren.
 */
export function useAssistentPaneelStaat({
  aiBeschikbaar,
}: {
  aiBeschikbaar: boolean;
}): AssistentPaneelWaarde {
  const [stand, zetStandRuw] = useState<PaneelStand>("dicht");
  const [ooitGeopend, zetOoitGeopend] = useState(false);
  const [aanvraag, zetAanvraag] = useState<PaneelAanvraag | null>(null);
  const [ingangModule, zetIngangModule] = useState<string | null>(null);
  const [bediening, zetBediening] = useState<AssistentPaneelBediening | null>(null);
  const [startpuntContext, zetStartpuntContext] = useState<PortaalContext | null>(null);
  const [vorigPad, zetVorigPad] = useState<string | null>(null);
  const [productSignaal, zetProductSignaal] = useState<
    { agendapuntId: string; teller: number } | null
  >(null);
  // Waar de focus vandaan kwam. Bij sluiten keert hij daarheen terug; anders
  // valt de focus terug op <body> en is de bestuurder zijn plek kwijt.
  const openerRef = useRef<HTMLElement | null>(null);
  const sleutelRef = useRef(0);

  const onthoudOpener = useCallback(() => {
    const actief = typeof document !== "undefined" ? document.activeElement : null;
    openerRef.current = actief instanceof HTMLElement ? actief : null;
  }, []);

  const zetStand = useCallback(
    (volgende: PaneelStand) => {
      if (!aiBeschikbaar) return;
      if (volgende !== "dicht") zetOoitGeopend(true);
      zetStandRuw(volgende);
    },
    [aiBeschikbaar]
  );

  const openMet = useCallback(
    ({
      ingangen,
      module,
      startbeurt,
    }: {
      ingangen: AssistentUrlIngang[];
      module: string | null;
      startbeurt?: PaneelStartbeurt;
    }) => {
      if (!aiBeschikbaar) return;
      onthoudOpener();
      sleutelRef.current += 1;
      zetAanvraag({ ingangen, module, startbeurt, sleutel: sleutelRef.current });
      zetIngangModule(module);
      zetOoitGeopend(true);
      // Staat het paneel al vergroot of volledig open, dan verandert alleen de
      // context: terugkrimpen naar 400 px zou de bestuurder ruimte afpakken die
      // hij zelf heeft gekozen.
      zetStandRuw((huidig) => (huidig === "dicht" ? "paneel" : huidig));
    },
    [aiBeschikbaar, onthoudOpener]
  );

  const openGeneriek = useCallback(() => {
    if (!aiBeschikbaar) return;
    onthoudOpener();
    zetOoitGeopend(true);
    zetStandRuw((huidig) => (huidig === "dicht" ? "paneel" : huidig));
  }, [aiBeschikbaar, onthoudOpener]);

  const krimpUitVolledig = useCallback(() => {
    zetStandRuw((huidig) => (huidig === "volledig" ? "paneel" : huidig));
  }, []);

  const sluit = useCallback(() => {
    zetStandRuw("dicht");
    const opener = openerRef.current;
    if (opener && document.contains(opener)) opener.focus();
    openerRef.current = null;
  }, []);

  const meldAanvraagVerwerkt = useCallback((sleutel: number) => {
    zetAanvraag((huidig) => (huidig && huidig.sleutel === sleutel ? null : huidig));
  }, []);

  const meldProductBijgewerkt = useCallback((agendapuntId: string) => {
    zetProductSignaal((h) => ({
      agendapuntId,
      teller: (h?.agendapuntId === agendapuntId ? h.teller : 0) + 1,
    }));
  }, []);

  const wisIngangModule = useCallback(() => zetIngangModule(null), []);
  const registreerBediening = useCallback(
    (volgende: AssistentPaneelBediening | null) => zetBediening(volgende),
    []
  );

  return useMemo<AssistentPaneelWaarde>(
    () => ({
      stand,
      aiBeschikbaar,
      ooitGeopend,
      ingangModule,
      wisIngangModule,
      aanvraag,
      meldAanvraagVerwerkt,
      bediening,
      registreerBediening,
      productSignaal,
      meldProductBijgewerkt,
      openMet,
      openGeneriek,
      zetStand,
      krimpUitVolledig,
      sluit,
      vorigPad,
      zetVorigPad,
      startpuntContext,
      zetStartpuntContext,
    }),
    [
      stand,
      aiBeschikbaar,
      ooitGeopend,
      ingangModule,
      wisIngangModule,
      aanvraag,
      meldAanvraagVerwerkt,
      bediening,
      registreerBediening,
      productSignaal,
      meldProductBijgewerkt,
      openMet,
      openGeneriek,
      zetStand,
      krimpUitVolledig,
      sluit,
      vorigPad,
      zetVorigPad,
      startpuntContext,
      zetStartpuntContext,
    ]
  );
}

export function AssistentPaneelProvider({
  waarde,
  children,
}: {
  waarde: AssistentPaneelWaarde;
  children: ReactNode;
}) {
  return <PaneelContext.Provider value={waarde}>{children}</PaneelContext.Provider>;
}

/**
 * De paneelstaat.
 *
 * Werpt niet maar geeft `null` terug: een assistent-ingang kan in een boom
 * staan die buiten `DashboardShell` valt (het platformdeel heeft een eigen
 * schil). Zo'n knop hoort daar niets te doen, niet de pagina te breken.
 */
export function useAssistentPaneelOptioneel(): AssistentPaneelWaarde | null {
  return useContext(PaneelContext);
}

/** De paneelstaat, met de eis dat er een paneel is. Voor het paneel zelf. */
export function useAssistentPaneel(): AssistentPaneelWaarde {
  const waarde = useContext(PaneelContext);
  if (!waarde) {
    throw new Error(
      "useAssistentPaneel() vereist een <AssistentPaneelProvider> erboven."
    );
  }
  return waarde;
}
