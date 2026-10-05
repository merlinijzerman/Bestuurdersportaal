// ============================================================================
//  core/lib/ai-gateway/gateway-productie.ts — de productie-gateway (server-only)
// ----------------------------------------------------------------------------
//  Wiring van de kern (gateway.ts) met de echte afhankelijkheden: de gateway-
//  databaseverbinding (rol ai_gateway), de drie provideradapters, de live poort
//  en de gestructureerde foutregistratie in app_errors (reviewbesluit R3). Eén
//  instantie per proces.
// ============================================================================

import "server-only";
import { poortCheck } from "../ai-poort";
import { logAppFout } from "../app-fout-schrijf";
import type { AiGateway } from "./contract";
import { productieGatewayDb } from "./config-db";
import { maakGateway } from "./gateway";
import { maakAnthropicAdapter } from "./adapters/anthropic";
import { maakOpenAIAdapter } from "./adapters/openai";
import { maakMistralAdapter } from "./adapters/mistral";

let instantie: AiGateway | undefined;

export function productieGateway(): AiGateway {
  if (instantie) return instantie;
  instantie = maakGateway({
    db: productieGatewayDb,
    adapters: {
      anthropic: maakAnthropicAdapter(),
      openai: maakOpenAIAdapter(),
      mistral: maakMistralAdapter(),
    },
    poortCheck,
    logFout: ({ label, correlatieId, fondsId, taaktype, fout }) => {
      console.error(`[ai-gateway] ${label} auditregel niet weggeschreven (${correlatieId}, ${taaktype})`, fout);
      logAppFout({
        label: `${label}:ai-gateway-log`,
        error: fout instanceof Error ? fout : new Error(String(fout)),
        httpStatus: 500,
        categorie: "retrieval_ai",
        severity: "hoog",
        correlatieId,
        context: { fonds_id: fondsId, taaktype },
      });
    },
  });
  return instantie;
}
