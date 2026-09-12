// ============================================================================
//  #369 — één afbreek-/deadlinegrens over de VOLLEDIGE vergelijking.
// ----------------------------------------------------------------------------
//  Retrieval heeft zelf een grendel, maar een vergelijking doet méér I/O:
//  concepten, semantic_units, dimensiebepaling, waardemodel en persistentie.
//  Deze wrapper bewaakt elke dependency vóór én na de await. Daardoor kan een
//  dependency die een AbortSignal per ongeluk negeert nooit na een verlopen
//  deadline alsnog de volgende stap — in het bijzonder `persisteer()` — starten.
// ============================================================================

import { voerVergelijkingUit, type VergelijkDeps, type VergelijkParams } from "./vergelijk-kern";
import type { VergelijkResultaat } from "./vergelijk-types";
import { maakAfbreekgrendel } from "./retrieval/afbreken";

export interface VergelijkDeadlineOpdracht {
  clientSignal?: AbortSignal;
  timeoutMs: number;
  depsVoorSignal(signal: AbortSignal): VergelijkDeps;
}

/** Bewaak één async dependency aan beide kanten van de I/O-grens. */
function bewaak<TArgs extends unknown[], TResult>(
  controle: () => void,
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    controle();
    const resultaat = await fn(...args);
    controle();
    return resultaat;
  };
}

export async function voerVergelijkingBinnenDeadline(
  params: VergelijkParams,
  opdracht: VergelijkDeadlineOpdracht
): Promise<VergelijkResultaat> {
  const grendel = maakAfbreekgrendel(opdracht.clientSignal, opdracht.timeoutMs);
  try {
    const deps = opdracht.depsVoorSignal(grendel.signal);
    const bewaakteDeps: VergelijkDeps = {
      ...deps,
      leesConcepten: bewaak(grendel.bewaak, deps.leesConcepten),
      leesSemanticUnits: bewaak(grendel.bewaak, deps.leesSemanticUnits),
      bepaalExtraDimensies: bewaak(grendel.bewaak, deps.bepaalExtraDimensies),
      retrieveerPassages: bewaak(grendel.bewaak, deps.retrieveerPassages),
      vergelijkWaardeLLM: bewaak(grendel.bewaak, deps.vergelijkWaardeLLM),
      persisteer: bewaak(grendel.bewaak, deps.persisteer),
    };
    grendel.bewaak();
    const resultaat = await voerVergelijkingUit(params, bewaakteDeps);
    grendel.bewaak();
    return resultaat;
  } finally {
    grendel.stop();
  }
}
