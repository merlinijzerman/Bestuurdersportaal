// ============================================================================
//  Assistent — gedeelde datatypen (P1a, besluit 0201).
// ----------------------------------------------------------------------------
//  De assistent bestaat uit drie lagen: context (L1), gesprek (L2) en
//  presentatie (L3). L1 en L2 wonen in `core/` zodat er straks een paneel naast
//  een module kan staan (P1b); ze mogen daarom NIET uit `app/` importeren.
//
//  Deze module is de gedeelde typebasis. `Bron` en `OnderbouwingMeta` stonden
//  eerder in `AntwoordWeergave.tsx` respectievelijk `OnderbouwingPaneel.tsx`;
//  ze zijn hier ONGEWIJZIGD naartoe verhuisd. Beide componenten re-exporteren
//  ze op hun oude plek, zodat geen enkele bestaande importregel wijzigt — ook
//  die van `AgendapuntChat.tsx` niet, dat buiten de scope van P1a valt.
//
//  Puur typen: geen runtime, geen React, geen IO.
// ============================================================================

import type { DocumentDekking } from "@/core/lib/document-dekking";
import type { Antwoordmodus, InlineMelding } from "@/core/lib/vraagtype";
import type { VergelijkResultaat } from "@/core/lib/vergelijk-types";
import type { DoorgrondSectieId } from "@/core/lib/doorgrond";
import type { Stuksoort } from "@/core/lib/stukvoorbereiding";
import type { ReflectieIngang } from "@/core/lib/reflectie-flow";

// ── Eén bronverwijzing onder een antwoord ────────────────────────────────────
export interface Bron {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  // Increment G — bronkaartvelden (status/bronstatus/datum/bronsoort).
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_tot?: string | null;
  bibliotheek?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
  // Tranche 2B — soort stuk en bestandsformaat, voor de documentlijst bij
  // antwoordmodus `bronoverzicht`. Beide optioneel: `documenttype` is nullable en
  // niet gebackfilld (metadata-review-queue), en oude, opgeslagen gesprekken
  // kennen de velden helemaal niet.
  documenttype?: string | null;
  bestandstype?: string | null;
}

// ── Controle-informatie per antwoord (paneel "Onderbouwing en bronnen") ─────
export interface OnderbouwingMeta {
  /** Korte samenvatting van de bronbasis (lib/vraagtype.bronbasisLabel). */
  bronbasis?: string | null;
  /** Label van de gebruikte/automatisch bepaalde antwoordmodus. */
  antwoordmodusLabel?: string | null;
  /** Ruwe antwoordmodus-waarde (voor het bepalen van vervolgacties). */
  antwoordmodus?: string | null;
  /** Retrieval-scope: 'actueel' | 'historisch' | 'besluitvorming' | 'alles'. */
  retrievalModus?: string | null;
  // Besluit 0139 (M-R4) — de zoekvraag waarop daadwerkelijk is gezocht en of die
  // door de history-aware reformulatie is herschreven. Alleen tonen bij
  // `gereformuleerd = true`; anders verandert de weergave niet.
  /** De (mogelijk herschreven) zoekvraag waarop is gezocht. */
  zoekvraag?: string | null;
  /** Of de vraag is herschreven tot een zelfstandige zoekvraag. */
  gereformuleerd?: boolean;
  /** Peildatum waarop de actuele-bron-filtering is toegepast. */
  peildatum?: string | null;
  /** Of er (ook) algemene kennis is gebruikt. */
  algemeneKennis?: boolean | null;
  /** Aantal geraadpleegde bronnen (voor de count-badge). */
  aantalBronnen?: number;
  /**
   * Documenttitels van de geraadpleegde bronnen, voor de ingeklapte balk.
   * Client-side afgeleid uit de bronnen die de caller tóch al heeft — géén extra
   * veld in de API-payload.
   */
  bronTitels?: string[];
  // Increment F (FO §14) — profielsturing. De transparantie dat de VOLGORDE/NADRUK
  // op het persoonlijk profiel is afgestemd staat hier in het controlevlak (niet
  // inline in het antwoord). De feitenbasis/bronnen zijn identiek; alleen ordening
  // verschilt. 'uitgeschakeld' = de bestuurder koos "Algemeen perspectief".
  /** Of het persoonlijk profiel de ordening heeft gestuurd. */
  profielsturing?: "actief" | "uitgeschakeld" | "geen-profiel" | null;
  // OP-4 (FO Organisatieprofiel v0.4 §8) — of het organisatieprofiel is meegewogen
  // ('actief') of ontbrak/leeg was ('geen-profiel'). De _aspecten voeden het
  // onderscheid feiten/strategie/risicohouding in het paneel (metadata, geen inhoud).
  /** Of het organisatieprofiel als context is meegewogen. */
  organisatieprofiel?: "actief" | "geen-profiel" | null;
  /** Welke veldgroepen zijn geïnjecteerd — voedt de feiten/strategie/risicohouding-split. */
  organisatieprofielAspecten?: {
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
  // Increment I-2 (FO §11a) — de automatische bronkeuze. Géén zichtbare badge in
  // de chat; de bestuurder ziet de gekozen intentie hier, in het controlevlak.
  /** Automatisch (of via verduidelijkingschip) bepaalde bron-intentie. */
  bronIntent?: "fonds" | "algemeen" | "gecombineerd" | null;
  /** Vertrouwen in de automatische bronkeuze ('zeker' | 'onzeker'). */
  bronVertrouwen?: "zeker" | "onzeker" | null;
  /** Of de bestuurder de vraag bewust tot fondsdocumenten beperkte. */
  alleenFondsdocumenten?: boolean | null;
  /** Intentie door de gebruiker bevestigd via een verduidelijkingschip (vs. heuristisch). */
  bronIntentOverride?: boolean | null;
  // Contextbesef (besluit 0090) — of de PORTAALSTAND (eigen eerstvolgende
  // processtap, komende vergadering, agendapunten zonder eigen inbreng) is
  // meegewogen. Aparte aanduiding in het controlevlak, onderscheiden van de
  // documentbronnen (transparantielijn besluit 0071).
  /** Of de eigen portaalstand als context is meegewogen. */
  portaalstandGebruikt?: boolean | null;
  // Besluit 0151 — de module-scope (procesdossier / risicomatrix / één risico) als
  // aparte aanduiding, onderscheiden van documentbronnen (transparantielijn 0071).
  /** De actieve modulecontext + hoeveel gekoppelde stukken de retrieval voedden. */
  moduleScope?: {
    soort: "proces" | "risicomatrix" | "risico";
    bronnen: number;
  } | null;
  // Increment I-3 — uniforme bronvermelding-transparantie. De model_knowledge-
  // herkomst (algemene kennis uit het taalmodel, met de genoemde instantie), en
  // de web-laag die VOORBEREID is maar nog niet gevuld (Scenario B).
  /** Algemene-kennisbronnen: per genoemde instantie + grond (kennis/wetgeving). */
  modelKennis?: { grond: "algemene_kennis" | "wetgeving"; instantie: string | null }[];
  /** True als voor dit antwoord live web-retrieval webbronnen opleverde (Scenario A). */
  webRetrievalActief?: boolean | null;
  /** Geverifieerde webbronnen (URL + titel + domein + ophaaldatum + normgewicht). */
  webBronnen?: {
    url: string;
    titel: string;
    domein: string;
    datum?: string | null;
    normgewicht?: string | null;
    ophaaldatum?: string | null;
  }[];
  // B1 / scope-split — reizen mee zodat de vervolgacties na herladen consistent zijn.
  /** Ging de vraag over een specifiek stuk of agendapunt? Stuurt de vervolgacties. */
  documentGericht?: boolean | null;
  /** Inhoudelijke vervolgvragen (B1), op basis van het antwoord gegenereerd. */
  vervolgvragen?: string[] | null;
  /** Vraagrouter v2: aantoonbare, code-gedreven documentdekking. */
  documentdekking?: DocumentDekking | null;
  /** Gesloten routerassen, zonder vrije vraagtekst of interne modelnaam. */
  vraagrouter?: {
    taak: string;
    scope: string;
    dekking: string;
    bewijsniveau: string;
  } | null;
}

// ============================================================================
//  Gespreks- en contexttypen (P1a C2).
// ----------------------------------------------------------------------------
//  Verhuisd uit `AssistentClient.tsx`, ONGEWIJZIGD op één punt na: ze zijn nu
//  geëxporteerd, en `StuurOpties` stond binnen de component genest (puur omdat
//  hij daar geschreven is) en staat nu op modulehoogte. De payload-bouwer en
//  straks de gesprekshook hebben ze nodig en wonen in `core/`.
// ============================================================================

export type Modus = "documenten" | "combineren" | "algemeen";

// Increment I-2 (FO §11a) — bij een twijfelgeval vraagt de assistent terug i.p.v.
// te gokken. Dit AI-bericht draagt de verduidelijkingsvraag + de twee chips en
// de originele vraag, zodat een chipkeuze dezelfde vraag opnieuw stuurt met een
// bevestigde bron-intentie (combineren-vloer voor "fonds", niet een harde scope).
export interface VerduidelijkingKeuze {
  vraag: string;
  opties: { intent: "fonds" | "algemeen"; label: string }[];
  origineleVraag: string;
}

export interface VolledigeAnalyseAanbod {
  origineel_log_id: string;
  document_id: string;
  document_titel: string;
  originele_vraag: string;
  label: string;
}

export interface Bericht {
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
  // T5 — een vergelijkresultaat (side-by-side per dimensie). Rendert via
  // VergelijkResultaatWeergave i.p.v. de gewone antwoordtekst.
  vergelijking?: VergelijkResultaat;
  // T5 — vergelijkvraag met twee mogelijke doelbronnen: een gerichte verduidelijking.
  vergelijkingVerduidelijking?: {
    bronHint: string | null;
    doelHint: string | null;
    bronKandidaten: { id: string; titel: string }[];
    doelKandidaten: { id: string; titel: string }[];
  };
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
  // Besluit 0137 (antwoord-eerst) — dit fondsgerichte antwoord kwam uit een
  // ONZEKERE bron-intentie; in plaats van de blokkerende terugvraag biedt de
  // assistent de twee keuzes als chips ÓNDER het antwoord aan. Een klik hergenereert
  // dezelfde vraag met de bevestigde intentie (bron_intent_override + vertrouwen
  // "zeker"), waarbij het eerste antwoord blijft staan (navolgbaarheid, M-B5).
  // `origineleVraag` herhaalt de vraag letterlijk. Live-only, net als `verbreding`:
  // de bronbasis-melding (die het schijnzekerheidsrisico afdekt) staat in
  // `onderbouwing` en overleeft wél een refresh.
  bronkeuzeAanbod?: {
    opties: { intent: "fonds" | "algemeen"; label: string }[];
    origineleVraag: string;
  };
  // M7 — server-gevalideerde opschaling van targeted naar volledige dekking.
  volledigeAnalyseAanbod?: VolledigeAnalyseAanbod;
  // Besluit 0098 — alleen een NETJES afgeronde generatie ('done' ontvangen) is
  // kopieerbaar. Welkomsttekst, foutmeldingen en afgebroken streams krijgen dus
  // geen kopieerknop: een herkomstregel onder iets dat geen antwoord is,
  // ondermijnt precies de geloofwaardigheid van diezelfde regel.
  voltooid?: boolean;
  // Plateau B — het id van de auditregel van dít antwoord. Nodig om de bronset
  // te bevriezen wanneer de bestuurder op dit antwoord gaat reflecteren: de
  // server valideert dat de logregel van deze gebruiker én dit gesprek is.
  // Puur correlatie, geen autorisatie — en het verdwijnt met het gesprek.
  //
  // Het staat op ELK antwoord, niet alleen op de gereflecteerde: het is geen
  // markering dat er gereflecteerd is (besluit 0112).
  logId?: string;
}

// Actieve documentscope (increment 1). titels op moment van zetten, zodat de
// chip en de gesprekshistorie het stuk herkenbaar tonen.
export interface DocumentScope {
  document_ids: string[];
  titels: string[];
  // Opt-in algemene kennis (increment 2). Default uit = strict-document.
  algemene_kennis?: boolean;
}

// Besluit 0151 — AI-modulecontext. De client houdt alleen de sleutel + een label
// voor de chip bij; de server resolveert de inhoud onder RLS. `risicomatrix` is de
// enige risico-ingang; `risico` ontstaat door in de chat in te zoomen (verdiep-chip).
export interface ModuleScope {
  soort: "proces" | "risicomatrix" | "risico";
  procedure_id?: string;
  risico_id?: string;
  // Alleen voor de chip/onderbouwing; niet naar de server (die kent de titel al).
  label: string;
}

// Eén suggestie in de @-mention-typeahead.
export interface DocSuggestie {
  id: string;
  titel: string;
  bron: string;
  bestandstype: string | null;
  aangemaakt: string | null;
}

// Eén item in het gesprekken-overzicht (Fase B2-volledig).
export interface GesprekItem {
  id: string;
  titel: string | null;
  bijgewerkt: string;
  berichten: Bericht[];
  document_scope?: unknown;
  actieve_antwoordmodus?: unknown;
}

// ADR 0028 — agendapunt-modus: de vraag is geframed door een agendapunt. We
// bewaren id + titel zodat de chip "Agendapunt: «titel»" toont en de toelichting
// per beurt server-side wordt opgehaald (de route trust de client-titel niet).
export interface AgendapuntContext {
  id: string;
  titel: string;
}

// Increment I-1 — vervolgacties kunnen de antwoordmodus en/of de bronselectie
// voor één turn overrulen zonder de gespreksinstelling te wijzigen.
export interface StuurOpties {
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
  // Besluit 0137 (antwoord-eerst) — het log-id van het eerste (fondsgerichte)
  // antwoord waar de bestuurder een bronkeuze-chip onder klikte. Uitsluitend voor
  // de audit-koppeling (bronkeuze_herzien); reist mee met de hergegenereerde beurt.
  bronkeuzeVorigeLogId?: string;
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
  // T2 — bureau-stand: de gekozen stuksoort. De route bouwt hieruit de
  // instructie + past de bureau-toon toe, maar alleen met de capability.
  stukvoorbereiding?: { stuksoort: Stuksoort };
  // P2 Deel A — markeert dat deze beurt uit een aangeklikte voorbeeldvraag komt
  // (telemetrie in het auditspoor; onderscheidt prefill van zelf getypt).
  startvraagBron?: "voorbeeldvraag";
  // De GESPREKSSCOPE die bij deze beurt bewaard moet worden. Alleen nodig als een
  // taak de scope in dezelfde tick zet én verstuurt (doorgronden) — dan is de
  // `documentScope`-state nog niet gecommit. Losstaand van `scopeOverride`, dat
  // een puur PER-TURN retrieval-override is (vervolgacties) en de bewaarde
  // gespreksscope juist NIET mag wijzigen.
  persistScope?: DocumentScope | null;
  // Plateau B — deze beurt komt uit het GELABELDE reflectie-invoerveld, niet
  // uit de normale invoerbalk. Het onderscheid volgt uitsluitend uit het
  // invoerkanaal; er wordt nooit op inhoud geclassificeerd (FR-56).
  reflectieAntwoord?: boolean;
  // B-opt tranche 1a — deze beurt is een HERFORMULERING vanuit de
  // conceptweergave (knop "Aanpassen"). Stuurt actie `herformuleren`; de status
  // blijft conceptweergave en de beurt verandert niet.
  reflectieHerformuleren?: boolean;
  // B-opt tranche 2d — "Nog een stap verdiepen": vraagt om één extra
  // verdiepingsvraag. Geen zichtbare gebruikersbeurt (geenNieuweVraag).
  reflectieVerdiepen?: boolean;
  // B-opt tranche 4a — "Wat pleit er tegen?": tegenperspectief, zelfde
  // transitie als verdiepen, andere promptvariant.
  reflectieTegenperspectief?: boolean;
  // De gekozen reflectie-ingang + de logregel waarvan de bronset bevriest.
  reflectieStart?: { ingang: ReflectieIngang; bronsetLogId: string | null };
  /** M7 — koppeling naar het targeted antwoord dat dit aanbod voortbracht. */
  volledigeAnalyse?: {
    origineelLogId: string;
    documentId: string;
  };
  /** Zichtbare actietekst; de server ontvangt voor de analyse de originele vraag. */
  weergaveTekst?: string;
}

