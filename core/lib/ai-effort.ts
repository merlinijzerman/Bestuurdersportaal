// ============================================================================
//  Productpolicy voor model-effort (#438 PR2).
// ----------------------------------------------------------------------------
//  Effort is een productkeuze, geen providerdefault. De router bepaalt de
//  antwoordvorm; deze pure mapping vertaalt die naar de rekeninspanning. Alleen
//  een expliciete gebruikersactie mag `max` kiezen.
// ============================================================================

import type { EffortNiveau, Taaktype } from "./ai-gateway/contract";
import type { Antwoordmodus } from "./vraagtype";

export type ProductEffort = Exclude<EffortNiveau, "minimal">;

const STANDAARD_EFFORT: Readonly<Record<Taaktype, ProductEffort>> = {
  chat_generatie: "high",
  chat_contextresolutie: "low",
  chat_reformulatie: "low",
  chat_vraagrouter: "low",
  chat_mapstap: "low",
  rerank: "low",
  vergelijk_dimensies: "low",
  vergelijk_waarde: "medium",
  samenvatting: "medium",
  context_prefix: "low",
  generiek_context_prefix: "low",
  semantische_extractie: "low",
  afschrift_concept: "xhigh",
  besluit_concept: "xhigh",
  aqlab_generatie: "high",
  aqlab_judge: "high",
};

/** Default voor iedere gatewaytaak. Call-sites mogen alleen bewust verfijnen. */
export function standaardEffortVoorTaaktype(taaktype: Taaktype): ProductEffort {
  return STANDAARD_EFFORT[taaktype];
}

export function effortVoorChatAntwoord(invoer: {
  antwoordmodus: Antwoordmodus;
  grondigeAnalyse: boolean;
  stukvoorbereiding: boolean;
  opsteltaak: boolean;
}): ProductEffort {
  if (invoer.grondigeAnalyse) return "max";
  if (invoer.stukvoorbereiding || invoer.opsteltaak) return "xhigh";

  switch (invoer.antwoordmodus) {
    case "feitelijk":
    case "bronoverzicht":
      return "low";
    case "historisch":
      return "medium";
    case "duiding":
    case "sparring":
      return "high";
    case "besluitrijpheid":
    case "persoonlijke_voorbereiding":
      return "xhigh";
  }
}
