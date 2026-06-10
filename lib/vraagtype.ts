// ============================================================================
// Vraagtype-detectie en strategiekeuze — document-scope increment 2
// ----------------------------------------------------------------------------
// Pure, transparante heuristiek (geen modelaanroep) die bepaalt of een
// gescoopte vraag dekkingsbreed is (samenvatten, beoordelen, risico's/besluiten
// benoemen) of specifiek. Voorspelbaar en uitlegbaar — past bij de governance-
// lijn — en programmatisch na te rekenen (zie lib/vraagtype.sanity.ts). Het
// query-reformulatie-pad mag later als verfijning; bewust niet nu.
//
// Strategiekeuze (ontwerp §5):
//   specifiek                       → "targeted"       (increment 1, ongewijzigd)
//   breed & tekst ≤ drempel         → "full_document"  (hele tekst in de prompt)
//   breed & tekst >  drempel        → "map_reduce"     (in batches verwerken)
// ============================================================================

export type Vraagtype = "breed" | "specifiek";
export type Strategie = "targeted" | "full_document" | "map_reduce";

// Signaalwoorden voor een dekkingsbrede vraag. Bewust een gecureerde lijst:
// elke toevoeging is een expliciete, navolgbare keuze.
const BREED_PATRONEN: RegExp[] = [
  /\bvat\b[^.?!]*\bsamen/, // "vat (dit/het) samen"
  /samenvatt/, // samenvatting, samenvatten
  /\boverzicht\b/,
  /\bbeoordeel\b/,
  /\bbeoordeling\b/,
  /waar gaat (dit|het|deze|dat)[^.?!]*\bover\b/,
  /welke risico/,
  /welke besluit/,
  /welke aandachtspunt/,
  /welke (kritische )?vrag/,
  /kritische vrag/,
  /\bhoofdpunten\b/,
  /\brode draad\b/,
  /\bstrekking\b/,
  /\bkernpunten\b/,
  /analyse van (dit|het|deze)/,
  /\bevalueer\b/,
  /\bvat dit document\b/,
];

/** Verwijdert diacritics en maakt lowercase voor robuuste matching. */
function normaliseer(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Bepaal of een vraag dekkingsbreed of specifiek is. Default: "specifiek"
 * (alleen bij een herkenbaar breed signaalwoord wordt het "breed").
 */
export function bepaalVraagtype(vraag: string): Vraagtype {
  const genormaliseerd = normaliseer(vraag);
  return BREED_PATRONEN.some((p) => p.test(genormaliseerd)) ? "breed" : "specifiek";
}

/**
 * Ruwe tokenschatting voor Nederlandse tekst (≈ 4 tekens per token). Bewust een
 * eenvoudige proxy: één plek, geen externe tokenizer-dependency.
 */
export function schatTokens(tekst: string): number {
  return Math.ceil(tekst.length / 4);
}

/**
 * Kies de retrievalstrategie op basis van vraagtype en (bij breed) de geschatte
 * documentgrootte t.o.v. de drempel.
 */
export function kiesStrategie(
  vraagtype: Vraagtype,
  geschatteTokens: number,
  drempel: number
): Strategie {
  if (vraagtype === "specifiek") return "targeted";
  return geschatteTokens <= drempel ? "full_document" : "map_reduce";
}

/**
 * Verdeel geordende items in batches op tokenbudget, met een harde bovengrens op
 * het aantal batches (kostenbewaking). Wordt de grens overschreden, dan worden
 * de resterende items NIET stil weggelaten: `afgekapt` wordt true zodat de
 * aanroeper de gebruiker kan melden dat de dekking gedeeltelijk is.
 */
export function maakBatches<T extends { tekst: string }>(
  items: T[],
  batchTokens: number,
  maxBatches: number
): { batches: T[][]; afgekapt: boolean } {
  const batches: T[][] = [];
  let huidige: T[] = [];
  let huidigeTokens = 0;

  for (const item of items) {
    const t = schatTokens(item.tekst);
    // Start een nieuwe batch als de huidige vol is (en niet leeg).
    if (huidige.length > 0 && huidigeTokens + t > batchTokens) {
      batches.push(huidige);
      if (batches.length >= maxBatches) {
        // Grens bereikt en er zijn nog items over → gedeeltelijke dekking.
        return { batches, afgekapt: true };
      }
      huidige = [];
      huidigeTokens = 0;
    }
    huidige.push(item);
    huidigeTokens += t;
  }

  if (huidige.length > 0) batches.push(huidige);
  return { batches, afgekapt: false };
}
