// ============================================================================
//  Provider-/modelspecifieke Anthropic-capabilities voor de centrale gateway.
// ----------------------------------------------------------------------------
//  Alleen modellen met afwijkend Messages-API-gedrag staan hier. Onbekende en
//  bestaande 4.x-modellen houden daardoor exact het bestaande adapterverzoek.
//  De database blijft leidend voor de modelkeuze; dit profiel bepaalt uitsluitend
//  hoe een reeds gekozen model veilig wordt aangeroepen.
// ============================================================================

import type { EffortNiveau } from "./contract";

export type AnthropicEffort = Exclude<EffortNiveau, "minimal">;

export interface AnthropicModelprofiel {
  model: "claude-opus-5-5" | "claude-sonnet-5";
  thinking: "altijd_adaptive" | "standaard_adaptive";
  samplingVergrendeld: true;
  forcedToolOndersteund: boolean;
  strictTools: true;
  refusalOndersteund: true;
  explicieteEffortVereist: true;
  effort: readonly AnthropicEffort[];
}

const ALLE_ANTHROPIC_EFFORT: readonly AnthropicEffort[] = ["low", "medium", "high", "xhigh", "max"];

const PROFIELEN: Readonly<Record<AnthropicModelprofiel["model"], AnthropicModelprofiel>> = {
  "claude-opus-5-5": {
    model: "claude-opus-5-5",
    thinking: "altijd_adaptive",
    samplingVergrendeld: true,
    forcedToolOndersteund: false,
    strictTools: true,
    refusalOndersteund: true,
    explicieteEffortVereist: true,
    effort: ALLE_ANTHROPIC_EFFORT,
  },
  "claude-sonnet-5": {
    model: "claude-sonnet-5",
    thinking: "standaard_adaptive",
    samplingVergrendeld: true,
    forcedToolOndersteund: true,
    strictTools: true,
    refusalOndersteund: true,
    explicieteEffortVereist: true,
    effort: ALLE_ANTHROPIC_EFFORT,
  },
};

export function anthropicModelprofiel(model: string): AnthropicModelprofiel | null {
  return Object.prototype.hasOwnProperty.call(PROFIELEN, model)
    ? PROFIELEN[model as AnthropicModelprofiel["model"]]
    : null;
}

export function isAnthropicEffort(waarde: EffortNiveau | null | undefined): waarde is AnthropicEffort {
  return waarde !== null && waarde !== undefined && waarde !== "minimal";
}
