// ============================================================================
//  #434 T4-F — `meta.adapters`: gesloten, plat en inhoudsvrij.
// ----------------------------------------------------------------------------
//  Deze sleutel is GEEN vrijblijvende telemetrie. Zij draagt de zichtbare
//  bronstatus en het duurzame auditspoor, en dat bepaalt twee dingen:
//
//    • de VORM is gesloten — een array van PLATTE records. Geen genest vrij
//      object, ook niet als "één klein extra veldje": daar kan later iets in
//      groeien wat niemand heeft goedgekeurd, en de SQL-projectie kan er niet
//      op filteren;
//    • de VALIDATIE is fail-closed. Een ongeldige vorm stopt de beurt. Stil
//      weglaten zou een antwoord volledig ogend maken terwijl juist de
//      informatie over een niet-geraadpleegde bron is verdwenen — precies de
//      stille degradatie die T4-E moest uitsluiten.
//
//  WAT HIER NOOIT IN MAG, ook niet gehasht: URL, ref, pad, bestandsnaam,
//  drive-/item-/bron-id, opaque identifier, tokenclaim, providerfouttekst,
//  HTTP-body of fragment. Een hash is een pseudoniem, geen anonimisering: met
//  een kleine bronset is hij triviaal terug te rekenen. Gevolg, bewust
//  aanvaard: deze sleutel maakt GEEN correlatie over beurten heen mogelijk.
//  "Welke bron faalt structureel" hoort bij een afzonderlijk, streng
//  geautoriseerd beheerspoor.
// ============================================================================
import type { AdapterMeta } from "../rag";

export const ADAPTERMETA_NAMEN = ["supabase-rag", "microsoft-sharepoint"] as const;

export const ADAPTERMETA_RESULTATEN = ["treffers", "leeg", "niet_geraadpleegd"] as const;

/**
 * De gesloten veldverzameling. Elk veld staat hier óf het bestaat niet.
 *
 * De volgorde is die van het type en wordt door een sanity-test gelijk
 * gehouden: een veld toevoegen aan het type zonder het hier te noemen, of
 * andersom, is precies de drift die deze lijst moet uitsluiten.
 */
export const ADAPTERMETA_VELDEN = [
  "naam",
  "methode",
  "resultaat",
  // Beurtbreed — ONAFHANKELIJK van de citaatafkapping.
  "netwerkpogingen",
  "latency_ms",
  "downloads",
  "bytes",
  "throttles",
  "retries",
  "kandidaten_voor_poort",
  "kandidaten_na_poort",
  "afwijzing_root",
  "afwijzing_mapping",
  "afwijzing_binding",
  "afwijzing_rechten",
  "afwijzing_versie",
  "afwijzing_download",
  "afwijzing_extractie",
  "afwijzing_lokalisatie",
  "afwijzing_grens",
  // SELECTIEGEBONDEN — na de contextafkapping opnieuw berekend.
  "opgenomen_passages",
  "opgenomen_documenten",
] as const;

/** Velden die per definitie niet door de afkapping veranderen. */
export const ADAPTERMETA_BEURTBREED: readonly string[] = ADAPTERMETA_VELDEN.filter(
  (v) => !v.startsWith("opgenomen_") && v !== "naam" && v !== "methode" && v !== "resultaat"
);

/** Velden die ná de citaatafkapping opnieuw worden berekend. */
export const ADAPTERMETA_SELECTIEGEBONDEN = ["opgenomen_passages", "opgenomen_documenten"] as const;

const NUMERIEKE_VELDEN: readonly string[] = ADAPTERMETA_VELDEN.filter(
  (v) => v !== "naam" && v !== "methode" && v !== "resultaat"
);

/**
 * De DUURZAME foutcategorie. Eén vaste waarde, en nooit iets anders.
 *
 * Bewust géén uitbreiding van `RetrievalFoutcategorie`: dat is de union die
 * ADAPTERS mogen produceren, en dit is een fout van ONS. En bewust zonder veld
 * voor "wat er precies mis was" — een validator die logt wát hij weigerde, lekt
 * precies wat hij moest tegenhouden.
 */
export const ADAPTERMETA_FOUTCATEGORIE = "adaptermetadata_ongeldig" as const;

/**
 * Ongeldige adaptermetadata. Stopt de beurt: geen antwoord, geen citaten.
 *
 * De boodschap is vast en inhoudsvrij. `veld` benoemt hooguit WELK veld faalde
 * — een naam uit de gesloten verzameling hierboven, dus zelf geen inhoud — en
 * nooit de afgewezen waarde.
 */
export class AdaptermetadataOngeldig extends Error {
  readonly categorie = ADAPTERMETA_FOUTCATEGORIE;
  readonly veld: string | null;
  constructor(veld: string | null) {
    super("retrieval: adaptermetadata voldoet niet aan de gesloten vorm");
    this.name = "AdaptermetadataOngeldig";
    this.veld = veld;
  }
}

function isGeslotenWaarde(lijst: readonly string[], waarde: unknown): boolean {
  return typeof waarde === "string" && lijst.includes(waarde);
}

/**
 * Totale validatie vóór de auditlaag. Werpt bij de eerste afwijking.
 *
 * Toetst drie dingen, en alle drie fail-closed:
 *   1. de veldverzameling is EXACT de gesloten lijst — geen ontbrekend veld en
 *      geen extra veld. Een extra veld is hoe een identifier of een genest
 *      object hier zou binnenkomen;
 *   2. elke enumwaarde zit in haar eigen gesloten lijst;
 *   3. elk getal is `Number.isFinite` — `NaN` en `Infinity` zijn geen tellers.
 */
export function valideerAdapterMeta(kandidaten: readonly unknown[]): asserts kandidaten is AdapterMeta[] {
  for (const kandidaat of kandidaten) {
    if (typeof kandidaat !== "object" || kandidaat === null || Array.isArray(kandidaat)) {
      throw new AdaptermetadataOngeldig(null);
    }
    const sleutels = Object.keys(kandidaat as Record<string, unknown>);
    if (sleutels.length !== ADAPTERMETA_VELDEN.length) throw new AdaptermetadataOngeldig(null);
    for (const sleutel of sleutels) {
      if (!(ADAPTERMETA_VELDEN as readonly string[]).includes(sleutel)) {
        // Een onbekend veld: precies de weg waarlangs een identifier of een
        // genest object hier zou binnenkomen.
        throw new AdaptermetadataOngeldig(null);
      }
    }
    const rij = kandidaat as Record<string, unknown>;
    if (!isGeslotenWaarde(ADAPTERMETA_NAMEN, rij.naam)) throw new AdaptermetadataOngeldig("naam");
    if (!isGeslotenWaarde(ADAPTERMETA_RESULTATEN, rij.resultaat)) {
      throw new AdaptermetadataOngeldig("resultaat");
    }
    if (typeof rij.methode !== "string" || rij.methode.length === 0 || rij.methode.length > 40) {
      throw new AdaptermetadataOngeldig("methode");
    }
    for (const veld of NUMERIEKE_VELDEN) {
      const waarde = rij[veld];
      if (typeof waarde !== "number" || !Number.isFinite(waarde) || waarde < 0) {
        throw new AdaptermetadataOngeldig(veld);
      }
    }
  }
}
