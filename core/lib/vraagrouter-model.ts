// Optionele lichte modelrouter. De pure beslis- en validatielogica staat in
// vraagrouter.ts; dit bestand is uitsluitend de provider-schil achter de flag.

import type { AiGateway, GatewayContext } from "./ai-gateway/contract";
import {
  isModelRouterKandidaat,
  veiligeRouterTerugval,
  valideerModelroute,
  type Vraagroute,
} from "./vraagrouter";

const ROUTER_TIMEOUT_MS = 2_500;
const ROUTER_MAX_TOKENS = 300;

export type ModelrouterUitkomst =
  | "overgeslagen"
  | "geaccepteerd"
  | "schema_terugval"
  | "provider_terugval";

export interface ModelrouterMeta {
  toegepast: boolean;
  model: string | null;
  duur_ms: number;
  tokens_in: number;
  tokens_uit: number;
  uitkomst: ModelrouterUitkomst;
}

export interface ModelrouterResultaat {
  route: Vraagroute;
  meta: ModelrouterMeta;
}

export async function verfijnVraagrouteMetModel(input: {
  vraag: string;
  basis: Vraagroute;
  documentAantal: number;
  actief: boolean;
  /** #311: provider/model komen uit fonds + taaktype `chat_vraagrouter` (taakgroep hulp_snel). */
  gateway: AiGateway;
  ctx: GatewayContext;
}): Promise<ModelrouterResultaat> {
  if (!input.actief || !isModelRouterKandidaat(input.basis)) {
    return {
      route: input.basis,
      meta: {
        toegepast: false,
        model: null,
        duur_ms: 0,
        tokens_in: 0,
        tokens_uit: 0,
        uitkomst: "overgeslagen",
      },
    };
  }
  const start = Date.now();
  let model: string | null = null;
  try {
    const response = await input.gateway.genereer(input.ctx, {
      taaktype: "chat_vraagrouter",
      maxTokens: ROUTER_MAX_TOKENS,
      temperature: 0,
      systeem:
        "Classificeer uitsluitend de taak en benodigde dekking van de gebruikersvraag. " +
        "Maak geen inhoudelijke analyse. Volledig/samengesteld mag alleen bij een integrale, volledige of kaderbrede opdracht; een pagina-, artikel-, datum-, percentage- of uitsluitend-vraag is targeted.",
      berichten: [{ role: "user", content: input.vraag }],
      tools: [
        {
          soort: "functie",
          naam: "classificeer_vraag",
          beschrijving: "Gesloten routeruitkomst",
          verplicht: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              taak: {
                type: "string",
                enum: [
                  "feitopzoeking",
                  "uitleg",
                  "samenvatting",
                  "volledigheidstoets",
                  "aansluitingstoets",
                  "vergelijking",
                  "risicoanalyse",
                  "besluitrijpheid",
                  "onbekend",
                ],
              },
              dekking: {
                type: "string",
                enum: ["targeted", "volledig_document", "samengesteld"],
              },
              vertrouwen: { type: "number", minimum: 0, maximum: 1 },
              signalen: {
                type: "array",
                maxItems: 8,
                items: { type: "string", pattern: "^[a-z0-9_]{1,50}$" },
              },
            },
            required: ["taak", "dekking", "vertrouwen", "signalen"],
          },
        },
      ],
      timeoutMs: ROUTER_TIMEOUT_MS,
    });
    model = response.model;
    const tool = (response.inhoud as Array<{ type?: string; input?: unknown }>).find(
      (blok) => blok?.type === "tool_use"
    );
    const geldig = tool ? valideerModelroute(input.basis, tool.input, input.documentAantal) : null;
    return {
      route: geldig ?? veiligeRouterTerugval(input.basis),
      meta: {
        toegepast: true,
        model: response.model,
        duur_ms: Date.now() - start,
        tokens_in: response.usage.in,
        tokens_uit: response.usage.out,
        uitkomst: geldig ? "geaccepteerd" : "schema_terugval",
      },
    };
  } catch (error) {
    console.error("Modelrouter faalde; veilige targeted-terugval:", error);
    return {
      route: veiligeRouterTerugval(input.basis),
      meta: {
        toegepast: true,
        model,
        duur_ms: Date.now() - start,
        tokens_in: 0,
        tokens_uit: 0,
        uitkomst: "provider_terugval",
      },
    };
  }
}
