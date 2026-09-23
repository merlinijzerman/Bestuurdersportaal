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
 * De gesloten METHODEN. `methode` was vrije tekst met alleen een lengtegrens —
 * dat is geen gesloten vorm: elke string tot 40 tekens paste erin, en juist een
 * korte string is een prima drager voor een identifier of een fouttekst.
 *
 * De lijst is exact `AdapterMeta["methode"]`; de assertie onderaan dit bestand
 * laat de typecheck falen zodra een van beide een waarde krijgt die de ander
 * niet kent. `sharepoint_live` is de enige niet-Supabase-methode en komt uit
 * `AdapterUitkomst["methode"]`.
 */
export const ADAPTERMETA_METHODEN = [
  "hybride_rrf",
  "fts_dutch_ranked",
  "fts_dutch_terugval",
  "fts_plain",
  "ilike",
  "geen",
  "sharepoint_live",
] as const;

/**
 * Het maximum aantal rijen. Eén rij per adaptergroep, en acht adaptergroepen in
 * één beurt is al ruim buiten alles wat het ontwerp kent.
 *
 * Deze grens stond alleen in SQL. Daardoor kon TypeScript een array van
 * duizenden rijen accepteren die de database vervolgens weigerde: de beurt
 * faalde dan pas bij het wegschrijven, met een databasefout in plaats van de
 * eigen, inhoudsvrije foutcategorie. Beide lagen hanteren nu dezelfde grens en
 * een pariteitsgate houdt ze gelijk.
 */
export const ADAPTERMETA_MAX_RIJEN = 8;

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
 * DUURZAAM, en dat woord is hier letterlijk. Deze categorie is een van de
 * uitkomsten van `foutcategorieVoor()` en komt daarmee langs het bestaande
 * afbreekpad op `ai_actie.resultaat_ref` terecht als `retrieval:
 * adaptermetadata_ongeldig` — via `rondAfStrikt()`, dus mét alarm wanneer die
 * schrijfactie zelf niet lukt. Droeg alleen het Error-object de categorie, dan
 * bestond de weigering na afloop van het verzoek nergens meer: de beurt stopte,
 * het antwoord bleef uit en achteraf was niet te zien waaróm. Precies de
 * stilte die deze sleutel moest uitsluiten.
 *
 * WAT ER NIET IN DE DUURZAME VERWIJZING STAAT: het afgewezen veld. `veld`
 * hieronder is voor de serverlog en de tests; de duurzame verwijzing blijft één
 * vaste string, zodat er geen pad is waarlangs er ooit een waarde in groeit.
 *
 * Bewust géén uitbreiding van `RetrievalFoutcategorie`: dat is de union die
 * ADAPTERS mogen produceren, en dit is een fout van ONS. En bewust zonder veld
 * voor "wat er precies mis was" — een validator die logt wát hij weigerde, lekt
 * precies wat hij moest tegenhouden.
 */
export const ADAPTERMETA_FOUTCATEGORIE = "adaptermetadata_ongeldig" as const;

/** De duurzame verwijzing zoals zij op `ai_actie.resultaat_ref` belandt. */
export const ADAPTERMETA_DUURZAME_REF = `retrieval:${ADAPTERMETA_FOUTCATEGORIE}` as const;

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
 * Toetst vijf dingen, en alle vijf fail-closed. De volgorde en de grenzen zijn
 * EXACT die van `meta_adapters_projectie()` in SQL; een pariteitsgate leest de
 * migratie en vergelijkt haar met de constanten hierboven. Liepen de twee
 * uiteen, dan accepteerde de ene laag wat de andere weigerde — en dan faalt de
 * beurt pas bij het wegschrijven, met een databasefout in plaats van de eigen
 * inhoudsvrije foutcategorie:
 *   1. het AANTAL rijen is ten hoogste `ADAPTERMETA_MAX_RIJEN`;
 *   2. de veldverzameling is EXACT de gesloten lijst — geen ontbrekend veld en
 *      geen extra veld. Een extra veld is hoe een identifier of een genest
 *      object hier zou binnenkomen;
 *   3. elke enumwaarde zit in haar eigen gesloten lijst — `methode` inbegrepen;
 *   4. elk getal is een GEHEEL getal: `Number.isInteger` sluit `NaN`,
 *      `Infinity` en 1.5 in één keer uit. SQL eist `floor(x) = x`; met alleen
 *      `Number.isFinite` liet TypeScript een breuk door die SQL weigerde;
 *   5. elk getal is niet-negatief — een teller telt niet terug.
 */
export function valideerAdapterMeta(kandidaten: readonly unknown[]): asserts kandidaten is AdapterMeta[] {
  if (kandidaten.length > ADAPTERMETA_MAX_RIJEN) throw new AdaptermetadataOngeldig(null);
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
    if (!isGeslotenWaarde(ADAPTERMETA_METHODEN, rij.methode)) {
      throw new AdaptermetadataOngeldig("methode");
    }
    for (const veld of NUMERIEKE_VELDEN) {
      const waarde = rij[veld];
      if (typeof waarde !== "number" || !Number.isInteger(waarde) || waarde < 0) {
        throw new AdaptermetadataOngeldig(veld);
      }
    }
  }
}

// ── Typegelijkheid tussen de enumlijst en het type ──────────────────────────
// De lijst hierboven en `AdapterMeta["methode"]` beschrijven dezelfde
// verzameling. Deze twee regels laten de TYPECHECK falen zodra dat niet meer zo
// is — in beide richtingen. Een pariteitstest kan een ontbrekende waarde pas ná
// het schrijven vinden; dit vindt hem tijdens het schrijven.
const _methodenDekkenHetType: readonly AdapterMeta["methode"][] = ADAPTERMETA_METHODEN;
void _methodenDekkenHetType;
type _MethodeNietInDeLijst = Exclude<AdapterMeta["methode"], (typeof ADAPTERMETA_METHODEN)[number]>;
const _geenMethodeGemist: _MethodeNietInDeLijst extends never ? true : never = true;
void _geenMethodeGemist;
