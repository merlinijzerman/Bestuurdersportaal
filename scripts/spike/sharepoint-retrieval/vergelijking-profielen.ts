// ============================================================================
//  #407 T3 — vaste meetprofielen voor de lokale kwaliteitsvergelijking.
// ----------------------------------------------------------------------------
//  Een profiel is een kosten- en veiligheidsgrens, geen handige default. De
//  lokale config mag de waarden van een benoemd profiel daarom niet overriden.
// ============================================================================
import { VERGELIJK_ARMEN, type VergelijkArm } from "./vergelijking";
import {
  SEMANTISCHE_SCENARIO_CODES,
  VERGELIJK_SCENARIO_CODES,
  type VergelijkScenario,
} from "./vergelijking-scenarios";
import type { VeiligeVergelijkrij } from "./types";

export const MINIMAAL_COPILOT_PROFIEL = "copilot_beslispoort_4" as const;
export type VergelijkProfiel = typeof MINIMAAL_COPILOT_PROFIEL;

export interface VergelijkMeetplan {
  profiel: VergelijkProfiel | null;
  rondes: number;
  armen: VergelijkArm[];
  scenarios: VergelijkScenario[];
  /** Feitelijke POST-pogingen per Copilot-meting, inclusief retries. */
  copilotRequestBudget: number;
  /** Hard plafond voor alle Copilot Retrieval-POST-pogingen in deze run. */
  maxCopilotCalls: number;
  /** Stop na de eerste mislukte Copilot-rij; `geen_resultaten` is een meetuitkomst. */
  stopNaCopilotFout: boolean;
}

export interface VergelijkMeetplanInvoer {
  profiel?: unknown;
  rondes?: unknown;
  armen?: unknown;
  scenarios?: unknown;
}

const MINIMAAL_PLAN: VergelijkMeetplan = {
  profiel: MINIMAAL_COPILOT_PROFIEL,
  rondes: 2,
  armen: [...VERGELIJK_ARMEN],
  scenarios: [...SEMANTISCHE_SCENARIO_CODES],
  copilotRequestBudget: 1,
  maxCopilotCalls: 4,
  stopNaCopilotFout: true,
};

function isVergelijkArm(waarde: unknown): waarde is VergelijkArm {
  return typeof waarde === "string" && VERGELIJK_ARMEN.includes(waarde as VergelijkArm);
}

function isVergelijkScenario(waarde: unknown): waarde is VergelijkScenario {
  return typeof waarde === "string" && VERGELIJK_SCENARIO_CODES.includes(waarde as VergelijkScenario);
}

export function geplandeCopilotCalls(plan: Pick<VergelijkMeetplan, "rondes" | "armen" | "scenarios" | "copilotRequestBudget">): number {
  if (!plan.armen.includes("copilot_retrieval")) return 0;
  return plan.rondes * plan.scenarios.length * plan.copilotRequestBudget;
}

/**
 * Lost de config fail-closed op naar een meetplan.
 *
 * Het minimale profiel is opzettelijk niet aanpasbaar vanuit JSON. Een wijziging
 * van rondes, armen of scenario's vraagt een codewijziging en dus review.
 */
export function maakVergelijkMeetplan(invoer: VergelijkMeetplanInvoer): VergelijkMeetplan {
  if (invoer.profiel !== undefined) {
    if (invoer.profiel !== MINIMAAL_COPILOT_PROFIEL) throw new Error("onbekend vergelijkingsprofiel");
    const overrides = (["rondes", "armen", "scenarios"] as const).filter((veld) => invoer[veld] !== undefined);
    if (overrides.length > 0) {
      throw new Error(`profiel ${MINIMAAL_COPILOT_PROFIEL} accepteert geen overrides: ${overrides.join(", ")}`);
    }
    const plan: VergelijkMeetplan = {
      ...MINIMAAL_PLAN,
      armen: [...MINIMAAL_PLAN.armen],
      scenarios: [...MINIMAAL_PLAN.scenarios],
    };
    if (geplandeCopilotCalls(plan) !== plan.maxCopilotCalls) {
      throw new Error("minimaal Copilot-profiel wijkt af van het vaste callplafond");
    }
    return plan;
  }

  if (typeof invoer.rondes !== "number" || !Number.isInteger(invoer.rondes) || invoer.rondes < 2 || invoer.rondes > 10) {
    throw new Error("rondes moet tussen 2 en 10 liggen");
  }
  if (invoer.armen !== undefined && (!Array.isArray(invoer.armen) || invoer.armen.length === 0 || invoer.armen.some((arm) => !isVergelijkArm(arm)))) {
    throw new Error("armen is ongeldig");
  }
  if (invoer.scenarios !== undefined && (!Array.isArray(invoer.scenarios) || invoer.scenarios.length === 0 || invoer.scenarios.some((code) => !isVergelijkScenario(code)))) {
    throw new Error("scenarios is ongeldig");
  }
  const plan: VergelijkMeetplan = {
    profiel: null,
    rondes: invoer.rondes,
    armen: invoer.armen === undefined ? [...VERGELIJK_ARMEN] : [...invoer.armen] as VergelijkArm[],
    scenarios: invoer.scenarios === undefined ? [...VERGELIJK_SCENARIO_CODES] : [...invoer.scenarios] as VergelijkScenario[],
    copilotRequestBudget: 1,
    maxCopilotCalls: 0,
    stopNaCopilotFout: false,
  };
  plan.maxCopilotCalls = geplandeCopilotCalls(plan);
  return plan;
}

/** Een lege Copilot-uitkomst is kwaliteitssignaal; een echte fout stopt het minimale profiel. */
export function fataleCopilotRij(rijen: readonly VeiligeVergelijkrij[]): VeiligeVergelijkrij | null {
  return rijen.find((rij) => rij.route === "copilot_retrieval" && rij.resultaat === "mislukt") ?? null;
}
