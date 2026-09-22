// ============================================================================
//  #434 T4-F — de beheerweergave over de DUURZAME adapterdiagnostiek.
// ----------------------------------------------------------------------------
//  Leest uitsluitend wat al gevalideerd in het auditspoor staat. Geen live
//  Microsoft-call, geen tokenbron, geen bronregister: wat hier wordt getoond is
//  wat er is vastgelegd, niet wat er nú het geval is. Dat onderscheid is de
//  reden dat deze weergave geen enkele externe afhankelijkheid heeft.
//
//  De uitvoer is GESLOTEN en inhoudsvrij, net als de invoer. Er wordt niets
//  toegevoegd wat niet al in `meta.adapters` stond — geen identifiers, geen
//  namen, geen paden.
//
//  ÉÉN LEESBAARHEIDSREGEL, NIET EEN DERDE. Deze weergave toetst met dezelfde
//  `valideerAdapterMeta()` als het schrijfpad en als de SQL-projectie. Een
//  eigen, lossere toets (naam en resultaat en verder maar zien) was precies de
//  manier waarop een beheerstand iets anders kan tonen dan het auditspoor
//  bevat.
//
//  EN: WAT WORDT OVERGESLAGEN, WORDT GETELD. Een onleesbare rij vult deze
//  functie niet aan met nullen — dat zou een werkelijkheid tonen die er niet
//  was. Maar stil overslaan is even misleidend: dan toont de stand een
//  onvolledig beeld dat er volledig uitziet. Daarom draagt de uitkomst haar
//  eigen dekkingsverklaring, en die is geen optioneel extraatje: `volledig`
//  staat in het type, dus een weergave kan hem niet vergeten te lezen zonder
//  dat de typecheck erover valt.
// ============================================================================
import { valideerAdapterMeta } from "./adaptermeta";
import type { AdapterMeta } from "../rag";

export interface AdapterBeheerregel {
  naam: AdapterMeta["naam"];
  /** Hoe vaak deze adapter in de gelezen periode voorkwam. */
  beurten: number;
  /** Per gesloten resultaatcategorie het aantal beurten. */
  treffers: number;
  leeg: number;
  niet_geraadpleegd: number;
  // Geaggregeerde tellers. Sommen, geen gemiddelden: een gemiddelde verbergt
  // een uitschieter, en juist die is in een beheerstand interessant.
  netwerkpogingen: number;
  latency_ms: number;
  downloads: number;
  bytes: number;
  throttles: number;
  retries: number;
  afwijzingen_totaal: number;
  opgenomen_passages: number;
}

/** De dekking van de stand: waarop is hij gebouwd, en wat ontbreekt eraan. */
export interface AdapterBeheerdekking {
  /** Logregels met een bruikbare `adapters`-array. */
  metarijen_gelezen: number;
  /**
   * Logregels zonder `adapters`. GEEN degradatie: een beurt met één
   * adaptergroep kent de sleutel niet. Apart geteld zodat "niet aanwezig" niet
   * met "onleesbaar" wordt verward.
   */
  metarijen_zonder_adapters: number;
  /** Logregels die `adapters` wél droegen maar niet in bruikbare vorm. */
  metarijen_overgeslagen: number;
  /** Losse adapterrijen die de gesloten vorm niet haalden. */
  adapterrijen_overgeslagen: number;
}

export interface AdapterBeheerstand {
  regels: AdapterBeheerregel[];
  dekking: AdapterBeheerdekking;
  /**
   * Is er niets overgeslagen? Alleen dan beschrijven de regels de volledige
   * gelezen periode. Is dit false, dan MOET de weergave dat tonen — de cijfers
   * zijn dan een ondergrens, geen stand.
   */
  volledig: boolean;
}

const TELLERS = [
  "netwerkpogingen",
  "latency_ms",
  "downloads",
  "bytes",
  "throttles",
  "retries",
  "opgenomen_passages",
] as const;

const AFWIJZINGEN = [
  "afwijzing_root",
  "afwijzing_mapping",
  "afwijzing_binding",
  "afwijzing_rechten",
  "afwijzing_versie",
  "afwijzing_download",
  "afwijzing_extractie",
  "afwijzing_lokalisatie",
  "afwijzing_grens",
] as const;

/**
 * Dezelfde gesloten vorm als het schrijfpad en als SQL. Werpt de validator, dan
 * is de rij onleesbaar — niet half leesbaar, want een rij waarvan één veld niet
 * klopt, is een rij waarvan we de rest ook niet kunnen vertrouwen.
 */
function isBruikbaar(rij: unknown): rij is AdapterMeta {
  try {
    valideerAdapterMeta([rij]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Aggregeert de `adapters`-rijen uit een reeks duurzame metaobjecten.
 *
 * Rijen die niet aan de gesloten vorm voldoen worden OVERGESLAGEN én GETELD.
 * Overslaan zonder tellen is de stille degradatie in beheervorm: de stand ziet
 * er compleet uit, en niemand kan zien dat hij het niet is.
 */
export function aggregeerAdapterMeta(metaRijen: readonly unknown[]): AdapterBeheerstand {
  const perAdapter = new Map<string, AdapterBeheerregel>();
  const dekking: AdapterBeheerdekking = {
    metarijen_gelezen: 0,
    metarijen_zonder_adapters: 0,
    metarijen_overgeslagen: 0,
    adapterrijen_overgeslagen: 0,
  };

  for (const meta of metaRijen) {
    if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
      dekking.metarijen_overgeslagen += 1;
      continue;
    }
    if (!("adapters" in meta)) {
      dekking.metarijen_zonder_adapters += 1;
      continue;
    }
    const adapters = (meta as { adapters?: unknown }).adapters;
    if (!Array.isArray(adapters)) {
      // De sleutel was er wél, maar niet als array. Dat is een kapotte regel,
      // niet een beurt met één adapter.
      dekking.metarijen_overgeslagen += 1;
      continue;
    }
    dekking.metarijen_gelezen += 1;

    for (const rij of adapters) {
      if (!isBruikbaar(rij)) {
        dekking.adapterrijen_overgeslagen += 1;
        continue;
      }
      const huidig =
        perAdapter.get(rij.naam) ??
        ({
          naam: rij.naam,
          beurten: 0,
          treffers: 0,
          leeg: 0,
          niet_geraadpleegd: 0,
          netwerkpogingen: 0,
          latency_ms: 0,
          downloads: 0,
          bytes: 0,
          throttles: 0,
          retries: 0,
          afwijzingen_totaal: 0,
          opgenomen_passages: 0,
        } satisfies AdapterBeheerregel);

      huidig.beurten += 1;
      huidig[rij.resultaat] += 1;
      for (const teller of TELLERS) huidig[teller] += rij[teller];
      for (const grond of AFWIJZINGEN) huidig.afwijzingen_totaal += rij[grond];
      perAdapter.set(rij.naam, huidig);
    }
  }

  return {
    // Deterministische volgorde; anders verschilt de weergave per aanroep.
    regels: [...perAdapter.values()].sort((a, b) =>
      a.naam < b.naam ? -1 : a.naam > b.naam ? 1 : 0
    ),
    dekking,
    volledig: dekking.metarijen_overgeslagen === 0 && dekking.adapterrijen_overgeslagen === 0,
  };
}
