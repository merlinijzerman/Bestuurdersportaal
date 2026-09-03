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
