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
//  reformulatie zelf doet een lichte modelcall op het sterke rewrite-model
//  (REWRITE_MODEL in app/api/chat/route.ts, thans claude-sonnet-4-6); de
//  Anthropic-client wordt als parameter meegegeven (dependency injection) zodat
//  deze module zelf niets instantieert. De call draait op temperature:0
//  (reproduceerbare retrieval, besluit 0139): dezelfde vraag + historie levert
//  dezelfde zoekvraag.
//
//  PLATEAU 1 (contextvaste vervolgvragen): in de chatroute is de MODELCALL van
//  deze module op het hot path VERVANGEN door de vroege contextresolver
//  (core/lib/vraag-context.ts) zodra CHATCONTEXT_RESOLVER=enforce. Die resolver
//  levert één `effectieveVraag` die niet alleen de retrieval maar de hele
//  beslisketen stuurt, en subsumeert daarmee deze reformulatie. Bij off/observe
//  blijft `reformuleerVraag` het hot path. De PURE `heeftReformulatieNodig`
//  blijft hoe dan ook in gebruik (off/observe-hotpath + gelogd signaal); haar
//  gepinde meetset in query-reformulatie.sanity.ts verandert niet.
// ============================================================


// Nederlandse verwijswoorden die sterk wijzen op afhankelijkheid van eerdere
// context (anafora). Lowercase, als hele woorden gematcht.
//
// Besluit 0139 (reproduceerbare retrieval): "het" is HIER verwijderd — het is
// verreweg meestal een lidwoord ("het reglement"), geen anafoor, en liet elke
// achtwoordige vraag met een lidwoord onterecht herformuleren. De aanwijzende
// voornaamwoorden dat/die/dit/deze staan NIET meer in deze vlakke set maar
// worden POSITIONEEL beoordeeld (zie DEMONSTRATIEVEN + isDeterminatorContext):
// "deze regeling" is een determinator (geen reformulatie), "kun je dat
// toelichten?" is een anafoor (wel reformulatie).
const VERWIJSWOORDEN = new Set([
  "diens", "hun",
  "hij", "zij", "ze", "hem", "haar",
  "daar", "daarvan", "daarover", "daaruit", "daarmee", "daarbij", "daartoe",
  "hier", "hiervan", "hierover", "hieruit", "hiermee", "hierbij",
  "ervan", "erover", "ermee", "erbij", "eruit",
  "zo", "zulke", "dergelijke", "diezelfde", "datzelfde",
]);

// Aanwijzende voornaamwoorden: anafoor (→ reformuleren) wanneer ze ALLEENSTAAND
// zijn of gevolgd worden door een functiewoord/werkwoord ("dat toelichten",
// "dit ook", "hoe zit dat"); determinator (→ negeren) wanneer ze direct gevolgd
// worden door een waarschijnlijk zelfstandig naamwoord ("deze regeling", "dat
// reglement"). Zie isDeterminatorContext.
const DEMONSTRATIEVEN = new Set(["dat", "die", "dit", "deze"]);

// Signalen dat het woord NÁ een demonstratief een zelfstandig naamwoord is
// (→ demonstratief = determinator). Geen POS-tagger; een pragmatische benadering
// die de meetset in query-reformulatie.sanity.ts dekt.
const NOMEN_SUFFIXEN = ["ing", "heid", "tie", "teit", "iteit", "schap", "ment", "eling", "age", "sel"];
const DOMEIN_NOMINA = new Set([
  "reglement", "regeling", "bestuur", "besluit", "document", "stuk", "beleid",
  "fonds", "dossier", "verslag", "notulen", "agenda", "rapport", "deelnemer",
]);
// Functiewoorden die nooit het hoofd van een nominale groep zijn: staan ze ná
// een demonstratief, dan is dat demonstratief anaforisch ("dat met", "dit ook").
const FUNCTIEWOORDEN_NA = new Set([
  "met", "ook", "voor", "van", "in", "op", "aan", "bij", "om", "te", "en",
  "of", "maar", "is", "was", "wordt", "werd", "zijn", "heeft", "had", "dan",
]);

// Beoordeelt of het woord ná een demonstratief dat demonstratief tot
// DETERMINATOR maakt (waarschijnlijk een zelfstandig naamwoord erachter).
// Alleenstaand of gevolgd door een functiewoord → geen determinator = anafoor.
function isDeterminatorContext(volgend: string | undefined): boolean {
  if (!volgend) return false;
  if (FUNCTIEWOORDEN_NA.has(volgend)) return false;
  if (DOMEIN_NOMINA.has(volgend)) return true;
  return NOMEN_SUFFIXEN.some((s) => volgend.length > s.length + 1 && volgend.endsWith(s));
}

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
// vraag met een vervolg-opener opent, een (niet-determinerend) verwijswoord
// bevat, of een anaforisch aanwijzend voornaamwoord bevat.
//
// Besluit 0139: de losse regel "kort (<=5 woorden) → altijd reformuleren" is
// GESCHRAPT. Kort ≠ contextafhankelijk ("Wat zijn onze strategische
// doelstellingen?" is vijf woorden en volledig zelfstandig). Echte
// vervolgvragen ("Waarom?", "Kun je dat toelichten?") vuren nu via de opener-
// of demonstratief-regel; de meetset in query-reformulatie.sanity.ts borgt dat
// geen enkele echte anafoor wegvalt.
export function heeftReformulatieNodig(
  vraag: string,
  heeftHistorie: boolean
): boolean {
  if (!heeftHistorie) return false;

  const schoon = vraag.trim().toLowerCase();
  if (schoon.length === 0) return false;

  const woorden = genormaliseerdeWoorden(vraag);

  // Begint met een typische vervolg-opener ("en ", "waarom", …).
  if (VERVOLG_OPENERS.some((o) => schoon.startsWith(o))) return true;

  // Bevat een positie-onafhankelijk verwijswoord (anafora).
  if (woorden.some((w) => VERWIJSWOORDEN.has(w))) return true;

  // Bevat een aanwijzend voornaamwoord in ANAFORISCH gebruik (niet als
  // determinator vóór een zelfstandig naamwoord).
  for (let i = 0; i < woorden.length; i++) {
    if (DEMONSTRATIEVEN.has(woorden[i]) && !isDeterminatorContext(woorden[i + 1])) {
      return true;
    }
  }

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
/**
 * De providercall zelf wordt door de aanroeper geleverd (#311: de chatroute
 * geeft een closure op de AI-gateway, taaktype `chat_reformulatie`). Zo blijft
 * dit bestand SDK-vrij en kan geen tweede caller de poort omzeilen (G5).
 */
export type ReformulatieAanroep = (invoer: {
  systeem: string;
  gebruiker: string;
  maxTokens: number;
  temperature: number;
}) => Promise<string>;

export async function reformuleerVraag(
  roep: ReformulatieAanroep,
  priorBeurten: Beurt[],
  vraag: string
): Promise<string> {
  try {
    const transcript = bouwTranscript(priorBeurten);
    const ruw = await roep({
      systeem: REFORMULATIE_SYSTEEM,
      gebruiker: `GESPREK TOT NU TOE:\n${transcript}\n\nLAATSTE VRAAG: ${vraag}\n\nHerschreven zelfstandige zoekvraag:`,
      maxTokens: 150,
      // Besluit 0139 — reproduceerbare retrieval: zonder temperature levert
      // dezelfde vraag + historie twee verschillende zoekvragen (incident
      // 06-08 15:29/15:34). temperature:0 maakt de herschrijving deterministisch.
      temperature: 0,
    });

    const tekst = ruw.trim();

    // Vangnet: leeg, verdacht lang, of identiek → origineel gebruiken.
    if (!tekst || tekst.length > 300) return vraag;
    return tekst;
  } catch {
    return vraag;
  }
}
