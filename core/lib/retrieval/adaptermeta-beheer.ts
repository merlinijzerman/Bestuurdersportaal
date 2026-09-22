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
//  namen, geen paden. De invoer is bovendien al tweemaal gevalideerd: door de
//  TypeScript-validator vóór het wegschrijven en door de SQL-vormcontrole bij
//  het lezen. Deze functie vertrouwt daar niet blind op en filtert zelf nog
//  eens op de gesloten enums — een rij uit een handmatig geschreven logregel
//  hoort de weergave niet te kunnen sturen.
// ============================================================================
import { ADAPTERMETA_NAMEN, ADAPTERMETA_RESULTATEN } from "./adaptermeta";
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

function isBruikbaar(rij: unknown): rij is AdapterMeta {
  if (typeof rij !== "object" || rij === null) return false;
  const r = rij as Record<string, unknown>;
  return (
    typeof r.naam === "string" &&
    (ADAPTERMETA_NAMEN as readonly string[]).includes(r.naam) &&
    typeof r.resultaat === "string" &&
    (ADAPTERMETA_RESULTATEN as readonly string[]).includes(r.resultaat)
  );
}

const getal = (waarde: unknown): number =>
  typeof waarde === "number" && Number.isFinite(waarde) && waarde >= 0 ? waarde : 0;

/**
 * Aggregeert de `adapters`-rijen uit een reeks duurzame metaobjecten.
 *
 * Rijen die niet aan de gesloten vorm voldoen worden OVERGESLAGEN, niet
 * gerepareerd: een beheerstand die een onleesbare rij invult met nullen, toont
 * een werkelijkheid die er niet was.
 */
export function aggregeerAdapterMeta(
  metaRijen: readonly unknown[]
): AdapterBeheerregel[] {
  const perAdapter = new Map<string, AdapterBeheerregel>();

  for (const meta of metaRijen) {
    if (typeof meta !== "object" || meta === null) continue;
    const adapters = (meta as { adapters?: unknown }).adapters;
    if (!Array.isArray(adapters)) continue;

    for (const rij of adapters) {
      if (!isBruikbaar(rij)) continue;
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
      for (const teller of TELLERS) {
        huidig[teller] += getal((rij as unknown as Record<string, unknown>)[teller]);
      }
      for (const grond of AFWIJZINGEN) {
        huidig.afwijzingen_totaal += getal((rij as unknown as Record<string, unknown>)[grond]);
      }
      perAdapter.set(rij.naam, huidig);
    }
  }

  // Deterministische volgorde; anders verschilt de weergave per aanroep.
  return [...perAdapter.values()].sort((a, b) => (a.naam < b.naam ? -1 : a.naam > b.naam ? 1 : 0));
}
