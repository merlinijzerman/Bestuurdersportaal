// ============================================================
//  Agendapunt-toelichting als seed-context voor de AI-assistent (ADR 0028).
//
//  De toelichting (agendapunten.beschrijving) is ongevalideerde vrije tekst van
//  een bestuurder — geen vastgestelde fondsbron. Ze gaat als GELABELDE seed-
//  context de prompt in (niet gechunkt/geëmbed), met een eigen herkomstlabel
//  [Toelichting agendapunt] dat strikt gescheiden blijft van [Bron N]
//  (vastgestelde fondsbron) en [Algemene kennis].
//
//  Deze module bevat uitsluitend PURE functies (geen IO), zodat het promptblok,
//  de labelregels en de herkomststring programmatisch te sanity-testen zijn.
// ============================================================

// Het herkomstlabel waarmee toelichting-afgeleide claims in het antwoord worden
// gemarkeerd. Centrale constante zodat prompt en (eventuele) UI/validatie nooit
// uiteenlopen.
export const TOELICHTING_LABEL = "[Toelichting agendapunt]";

export interface AgendapuntSeed {
  id: string;
  titel: string;
  toelichting: string | null;
}

// Of er daadwerkelijk een toelichting is om als seed mee te geven. Een
// agendapunt zonder beschrijving levert nog steeds een geldige seed (de titel
// frame't de vraag), maar het toelichtingsblok zelf blijft dan leeg.
export function heeftToelichting(seed: AgendapuntSeed): boolean {
  return typeof seed.toelichting === "string" && seed.toelichting.trim().length > 0;
}

// Bouwt het gelabelde seed-contextblok dat vóór de overige context in de
// gebruikersprompt wordt geplaatst. De koptekst maakt de herkomst expliciet:
// door het bestuur opgesteld, geen vastgestelde fondsbron.
export function bouwToelichtingBlok(seed: AgendapuntSeed): string {
  const titelRegel = `Titel van het agendapunt: ${seed.titel}`;
  const body = heeftToelichting(seed)
    ? `${titelRegel}\n\nToelichting:\n${seed.toelichting!.trim()}`
    : `${titelRegel}\n\n(Er is geen toelichting bij dit agendapunt opgesteld.)`;
  return `=== TOELICHTING OP HET AGENDAPUNT (door bestuur opgesteld, geen vastgestelde fondsbron) ===\n${body}`;
}

// De herkomststring voor het auditspoor (governance_log.retrieval_meta.herkomst),
// zodat herleidbaar is dat de vraag door dit agendapunt is geframed.
export function herkomstString(agendapuntId: string): string {
  return `agendapunt:${agendapuntId}`;
}

// De inhoudsregels voor de agendapunt-modus. Combineren-stijl: de assistent mag
// de toelichting én eventuele gekoppelde stukken én algemene kennis gebruiken,
// maar moet de drie herkomsten strikt apart labelen en nooit door elkaar laten
// lopen (ADR 0028 §4). GEEN strict-document "niet aangetroffen"-gedrag.
export const SP_AGENDAPUNT_REGELS = `U beantwoordt vragen over een specifiek agendapunt. U beschikt over drie soorten herkomst, die u ALTIJD strikt gescheiden labelt:

1. DE TOELICHTING OP HET AGENDAPUNT — vrije tekst die het bestuur bij dit punt heeft opgesteld. Dit is GEEN bestuurlijk vastgestelde fondsbron. Markeer elke claim die hierop steunt met ${TOELICHTING_LABEL}. Gebruik hiervoor NOOIT [Bron N] (dat suggereert een vastgestelde bron) en presenteer het nooit stilzwijgend als algemene kennis.
2. GEKOPPELDE STUKKEN — de aangeleverde interne fondsbronnen. Markeer claims hieruit met [Bron N], waarbij N exact overeenkomt met het bron-label uit de context. Schrijf elke verwijzing als afzonderlijke marker: [Bron 1][Bron 2], niet [Bron 1, 2].
3. ALGEMENE KENNIS — uw kennis over pensioenwetgeving, governance, risicobeheer e.d. Markeer met [Algemene kennis] of [Volgens wetgeving] en noem hooguit de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid, SZW). Verzin NOOIT een documenttitel, vindplaats, URL of paginanummer.

REGELS VAN INHOUD:
- Plaats een marker bij élke feitelijke claim, ook als dezelfde herkomst in een eerdere zin al genoemd is.
- Zijn er geen gekoppelde stukken, dan beantwoordt u de vraag op basis van de toelichting (${TOELICHTING_LABEL}) en, waar dat de vraag beter beantwoordt, uw algemene kennis ([Algemene kennis]). Geef GEEN "geen bron"-weigering — de toelichting is een legitieme aanleiding om op door te denken.
- Verzin geen fondsspecifieke feiten die niet in de toelichting of de stukken staan.
- Laat de drie herkomsten nooit door elkaar lopen: een claim uit een stuk blijft [Bron N], een claim uit de toelichting blijft ${TOELICHTING_LABEL}.

VERVOLGVRAGEN (verplicht slot):
Sluit ieder antwoord af met het vetgedrukte kopje **Om door te vragen**, gevolgd door 2-3 korte, concrete vervolgvragen die de bestuurder ú over dit agendapunt kan stellen. Formuleer ze vanuit de bestuurder ("Wat betekent dit voor..."), aansluitend op uw antwoord — geen generieke vragen. Bronmarkers zijn hier niet nodig. Dit kopje vervalt nooit, ook niet bij een kort antwoord.`;
