// Optionele lichte modelrouter. De pure beslis- en validatielogica staat in
// vraagrouter.ts; dit bestand is uitsluitend de provider-schil achter de flag.

import { bewaakteAnthropic, type PoortContext } from "./ai-poort";
import { HAIKU_MODEL } from "./llm-modellen";
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
  poort: PoortContext;
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
  try {
    const response = await bewaakteAnthropic(input.poort, HAIKU_MODEL, (client) =>
      client.messages.create(
        {
          model: HAIKU_MODEL,
          max_tokens: ROUTER_MAX_TOKENS,
          temperature: 0,
          system:
            "Classificeer uitsluitend de taak en benodigde dekking van de gebruikersvraag. " +
            "Maak geen inhoudelijke analyse. Volledig/samengesteld mag alleen bij een integrale, volledige of kaderbrede opdracht; een pagina-, artikel-, datum-, percentage- of uitsluitend-vraag is targeted.",
          messages: [{ role: "user", content: input.vraag }],
          tools: [
            {
              name: "classificeer_vraag",
              description: "Gesloten routeruitkomst",
              input_schema: {
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
          tool_choice: { type: "tool", name: "classificeer_vraag" },
        },
        { timeout: ROUTER_TIMEOUT_MS }
      )
    );
    const tool = response.content.find((blok) => blok.type === "tool_use");
    const geldig = tool?.type === "tool_use"
      ? valideerModelroute(input.basis, tool.input, input.documentAantal)
      : null;
    return {
      route: geldig ?? veiligeRouterTerugval(input.basis),
      meta: {
        toegepast: true,
        model: HAIKU_MODEL,
        duur_ms: Date.now() - start,
        tokens_in: response.usage?.input_tokens ?? 0,
        tokens_uit: response.usage?.output_tokens ?? 0,
        uitkomst: geldig ? "geaccepteerd" : "schema_terugval",
      },
    };
  } catch (error) {
    console.error("Modelrouter faalde; veilige targeted-terugval:", error);
    return {
      route: veiligeRouterTerugval(input.basis),
      meta: {
        toegepast: true,
        model: HAIKU_MODEL,
        duur_ms: Date.now() - start,
        tokens_in: 0,
        tokens_uit: 0,
        uitkomst: "provider_terugval",
      },
    };
  }
}
