// ============================================================
//  lib/query-reformulatie.ts — history-aware query-reformulatie (RAG Fase B1).
//
//  Doel: een vervolgvraag ("en wat betekent dat voor het bestuur?") omzetten
//  naar een zelfstandige zoekvraag, zodat de trefwoord-retrieval het juiste
//  onderwerp uit de gespreksgeschiedenis meeneemt. Zonder dit zoekt de pipeline
//  letterlijk op de losse zin en mist hij de context.
//
//  De beslissing "is reformulatie nodig?" is een PURE functie (geen SDK-imports,
//  deterministisch testbaar, zelfde discipline als lib/rag-select.ts). De
//  reformulatie zelf doet een lichte Haiku-call; de Anthropic-client wordt als
//  parameter meegegeven (dependency injection) zodat deze module zelf niets
//  instantieert.
// ============================================================

import type Anthropic from "@anthropic-ai/sdk";

// Nederlandse verwijswoorden die sterk wijzen op afhankelijkheid van eerdere
// context (anafora). Lowercase, als hele woorden gematcht.
const VERWIJSWOORDEN = new Set([
  "dat", "die", "dit", "deze", "diens", "hun",
  "hij", "zij", "ze", "het", "hem", "haar",
  "daar", "daarvan", "daarover", "daaruit", "daarmee", "daarbij", "daartoe",
  "hier", "hiervan", "hierover", "hieruit", "hiermee", "hierbij",
  "ervan", "erover", "ermee", "erbij", "eruit",
  "zo", "zulke", "dergelijke", "diezelfde", "datzelfde",
]);

// Voegwoorden/openers waarmee een vervolgvraag vaak begint.
const VERVOLG_OPENERS = [
  "en ", "maar ", "dus ", "of ", "want ", "ok ", "oké ", "oke ",
  "ja ", "nee ", "en?", "waarom", "hoezo", "en dan", "en wat", "en hoe",
];

function genormaliseerdeWoorden(tekst: string): string[] {
  return tekst
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// PURE: bepaalt of een vraag waarschijnlijk context uit het gesprek nodig heeft.
// Conservatief: zonder historie nooit reformuleren; met historie alleen als de
// vraag kort is, met een verwijswoord begint/bevat, of met een voegwoord opent.
export function heeftReformulatieNodig(
  vraag: string,
  heeftHistorie: boolean
): boolean {
  if (!heeftHistorie) return false;

  const schoon = vraag.trim().toLowerCase();
  if (schoon.length === 0) return false;

  const woorden = genormaliseerdeWoorden(vraag);

  // Korte vragen leunen bijna altijd op eerdere context.
  if (woorden.length <= 5) return true;

  // Begint met een typische vervolg-opener.
  if (VERVOLG_OPENERS.some((o) => schoon.startsWith(o))) return true;

  // Bevat een verwijswoord (anafora).
  if (woorden.some((w) => VERWIJSWOORDEN.has(w))) return true;

  return false;
}

interface Beurt {
  role: "user" | "assistant";
  content: string;
}

// Bouwt een compact transcript van de laatste beurten. Antwoorden worden
// ingekort zodat de reformulatie-call goedkoop en snel blijft.
function bouwTranscript(beurten: Beurt[], maxBeurten = 6, maxLengte = 400): string {
  return beurten
    .slice(-maxBeurten)
    .map((b) => {
      const label = b.role === "user" ? "Gebruiker" : "Assistent";
      const tekst =
        b.content.length > maxLengte
          ? b.content.slice(0, maxLengte) + "…"
          : b.content;
      return `${label}: ${tekst}`;
    })
    .join("\n");
}

const REFORMULATIE_SYSTEEM = `Je herschrijft de laatste vraag van een gebruiker tot één zelfstandige zoekvraag in het Nederlands, bedoeld voor een zoekmachine die de gespreksgeschiedenis NIET kent.

Regels:
- Vervang verwijswoorden (dat, die, hij, deze, daarover, …) door het concrete onderwerp uit het gesprek.
- Behoud vakjargon en eigennamen (bijv. "Wtp", "SPR", "artikel 102 PW").
- Maak er geen volzin van met uitleg; lever een bondige, zoekbare vraag of trefwoord-frase.
- Geef UITSLUITEND de herschreven zoekvraag terug — geen aanhalingstekens, geen toelichting, geen voorvoegsel.`;

// Reformuleert een vervolgvraag tot een zelfstandige zoekvraag via een lichte
// Haiku-call. Faalt veilig: bij een lege, te lange of foutieve respons valt de
// functie terug op de originele vraag, zodat retrieval altijd doorgaat.
export async function reformuleerVraag(
  client: Anthropic,
  priorBeurten: Beurt[],
  vraag: string,
  model: string
): Promise<string> {
  try {
    const transcript = bouwTranscript(priorBeurten);
    const response = await client.messages.create({
      model,
      max_tokens: 150,
      system: REFORMULATIE_SYSTEEM,
      messages: [
        {
          role: "user",
          content: `GESPREK TOT NU TOE:\n${transcript}\n\nLAATSTE VRAAG: ${vraag}\n\nHerschreven zelfstandige zoekvraag:`,
        },
      ],
    });

    const tekst =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

    // Vangnet: leeg, verdacht lang, of identiek → origineel gebruiken.
    if (!tekst || tekst.length > 300) return vraag;
    return tekst;
  } catch {
    return vraag;
  }
}
