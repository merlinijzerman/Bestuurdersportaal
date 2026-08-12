// ============================================================================
//  core/lib/semantische-extractie.ts — de modelcall-laag van T8 (server-only).
// ----------------------------------------------------------------------------
//  De DURE, onzuivere helft: per (bronchunk, actief concept) één geforceerde
//  Haiku-tool-call (temperature 0, verbatim evidence) — exact het S1-patroon
//  (scripts/spike-s1/extract.ts), nu productie. De PURE verwerking (normalisatie,
//  verbatim-check, negatie-guard, ontdubbeling) leeft in core/lib/semantische-
//  concepten.ts en wordt hier alleen aangeroepen, zodat die los toetsbaar blijft.
//
//  De modelclient is INJECTEERBAAR (VoorkomenExtractor) — de echte impl gebruikt
//  de Anthropic-SDK; tests injecteren een fake en raken zo nooit de API (patroon
//  platform/lib/aqlab/judge.ts).
//
//  "server-only": raakt ANTHROPIC_API_KEY; nooit naar de browser.
// ============================================================================

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { HAIKU_MODEL } from "./llm-modellen";
import {
  bouwKandidaatUnits,
  ontdubbel,
  type ActiefConcept,
  type BronChunk,
  type KandidaatUnit,
  type RawVoorkomen,
} from "./semantische-concepten";

// Max. chunktekst per modelcall — houdt context/kosten klein. Chunks zijn ruim
// binnen deze grens; een uitschieter wordt afgekapt (evidence-verificatie draait
// op de VOLLEDIGE chunktekst, dus afkappen kan hooguit recall drukken, geen precisie).
const MAX_CHUNK_TEKST = 12000;

// Geforceerde-tool-schema (S1): het model geeft ALLEEN value_raw + verbatim
// evidence + optionele sectie + grof confidence-signaal. Nooit de genormaliseerde
// waarde (dat doen wij) of het paginanummer (dat is de bron-chunk).
const TOOL: Anthropic.Tool = {
  name: "leg_voorkomens_vast",
  description:
    "Leg alle voorkomens van het gevraagde concept in deze tekst vast. " +
    "Geef een lege lijst als het concept hier niet voorkomt.",
  input_schema: {
    type: "object",
    properties: {
      voorkomens: {
        type: "array",
        items: {
          type: "object",
          properties: {
            value_raw: { type: "string", description: "De waarde exact zoals in de tekst (bv. '6,0%')." },
            evidence: {
              type: "string",
              description:
                "De bronzin LETTERLIJK overgenomen uit de tekst — geen parafrase, geen aanpassing.",
            },
            sectie: { type: "string", description: "Kop/sectie waarin dit staat, indien zichtbaar; anders leeg." },
            model_confidence: { type: "string", enum: ["hoog", "midden", "laag"] },
          },
          required: ["value_raw", "evidence", "model_confidence"],
        },
      },
    },
    required: ["voorkomens"],
  },
};

const SYSTEEM =
  "Je bent een nauwkeurige extractie-assistent voor Nederlandse pensioenfonds-" +
  "documenten. Je krijgt een tekstfragment en precies één doelconcept. Je taak: " +
  "vind ALLE voorkomens van uitsluitend dat concept in dit fragment. Regels: " +
  "(1) Neem de evidence-zin LETTERLIJK over uit de tekst. (2) Bind een waarde alleen " +
  "aan het concept als de tekst dat ondubbelzinnig ondersteunt — bij twijfel niet " +
  "opnemen. (3) Verwar het concept niet met naburige, andere grootheden. (4) Neem een " +
  "waarde NIET op als de tekst hem ontkent, uitsluit of afkeurt ('niet', 'geen', 'als " +
  "kritieke fout'). (5) Geen voorkomens? Geef een lege lijst. Verzin nooit tekst.";

// Injecteerbare modelclient: gegeven fragment + concept-omschrijving → ruwe voorkomens.
export type VoorkomenExtractor = (
  fragment: string,
  conceptOmschrijving: string
) => Promise<RawVoorkomen[]>;

let _client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

// De echte extractor: één geforceerde Haiku-tool-call, defensief geparst.
export const haikuVoorkomenExtractor: VoorkomenExtractor = async (fragment, conceptOmschrijving) => {
  const resp = await anthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    temperature: 0, // reproduceerbaarheid (besluit 0139-lijn)
    system: SYSTEEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: `Doelconcept:\n${conceptOmschrijving}\n\nTekst:\n"""\n${fragment}\n"""`,
      },
    ],
  });
  const blok = resp.content.find((b) => b.type === "tool_use");
  if (!blok || blok.type !== "tool_use") return [];
  const input = blok.input as { voorkomens?: RawVoorkomen[] };
  return Array.isArray(input.voorkomens) ? input.voorkomens : [];
};

export interface ExtractieMeting {
  calls: number;
  callFouten: number;
}

// Extraheer + valideer + ontdubbel voor een set bronchunks × actieve concepten.
// Retourneert opslagklare, ontdubbelde units + een lichte meting. De caller (job)
// bepaalt wélke chunks (incrementeel: alleen gewijzigde) en schrijft het resultaat weg.
export async function extraheerUnits(
  chunks: BronChunk[],
  concepten: ActiefConcept[],
  documentStatus: string | null,
  extractor: VoorkomenExtractor = haikuVoorkomenExtractor
): Promise<{ units: KandidaatUnit[]; meting: ExtractieMeting }> {
  const kandidaten: KandidaatUnit[] = [];
  const meting: ExtractieMeting = { calls: 0, callFouten: 0 };

  for (const chunk of chunks) {
    if (!chunk.tekst || chunk.tekst.trim().length === 0) continue;
    const fragment = chunk.tekst.length > MAX_CHUNK_TEKST ? chunk.tekst.slice(0, MAX_CHUNK_TEKST) : chunk.tekst;

    for (const concept of concepten) {
      let voorkomens: RawVoorkomen[];
      try {
        voorkomens = await extractor(fragment, concept.omschrijving);
        meting.calls += 1;
      } catch (e) {
        meting.callFouten += 1;
        console.error(
          `[semantische-extractie] call mislukt (chunk ${chunk.id}, concept ${concept.key}):`,
          (e as Error).message
        );
        continue;
      }
      kandidaten.push(...bouwKandidaatUnits({ concept, chunk, voorkomens, documentStatus }));
    }
  }

  return { units: ontdubbel(kandidaten), meting };
}
