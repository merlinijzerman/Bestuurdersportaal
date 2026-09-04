// ============================================================================
//  core/lib/semantische-extractie.ts — de modelcall-laag van T8 (server-only).
// ----------------------------------------------------------------------------
//  De DURE, onzuivere helft: per (bronchunk, actief concept) één geforceerde
//  Haiku-tool-call (temperature 0, verbatim evidence) — exact het S1-patroon
//  uit de S1-proef, nu productie. De PURE verwerking (normalisatie,
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
import type { GatewayAanroep, NeutraleTool } from "./ai-gateway/contract";
import { isGatewayFout } from "./ai-gateway/fout";
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
const TOOL: NeutraleTool = {
  soort: "functie",
  naam: "leg_voorkomens_vast",
  beschrijving:
    "Leg alle voorkomens van het gevraagde concept in deze tekst vast. " +
    "Geef een lege lijst als het concept hier niet voorkomt.",
  schema: {
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
  verplicht: true,
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

// AI-BEGRENZING (besluit 0180). De extractor is een FABRIEK geworden: hij krijgt
// de poortcontext mee en elke tool-call loopt daar doorheen. De extractie draait
// in de ingest-worker, waar het quotum al is gereserveerd; hier wordt alleen de
// kill switch en de modelallowlist getoetst — live, per call.
export function maakGatewayVoorkomenExtractor(
  aanroep: GatewayAanroep,
  registreerModel?: (model: string) => void
): VoorkomenExtractor {
  return async (fragment, conceptOmschrijving) => {
  const resp = await aanroep.gateway.genereer(aanroep.ctx, {
    taaktype: "semantische_extractie",
    maxTokens: 1024,
    temperature: 0, // reproduceerbaarheid (besluit 0139-lijn)
    systeem: SYSTEEM,
    tools: [TOOL],
    berichten: [
      {
        role: "user",
        content: `Doelconcept:\n${conceptOmschrijving}\n\nTekst:\n"""\n${fragment}\n"""`,
      },
    ],
  });
  registreerModel?.(resp.model);
  const blok = resp.inhoud.find(
    (b): b is { type: "tool_use"; input: unknown } =>
      typeof b === "object" && b !== null && (b as { type?: unknown }).type === "tool_use"
  );
  if (!blok) return [];
  const input = blok.input as { voorkomens?: RawVoorkomen[] };
  return Array.isArray(input.voorkomens) ? input.voorkomens : [];
  };
}

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
  // Geen default-extractor meer: de aanroeper MOET er een meegeven, en de enige
  // productie-implementatie is maakGatewayVoorkomenExtractor(aanroep). Zo kan er
  // geen ongemeten providercall ontstaan door het argument te vergeten.
  extractor: VoorkomenExtractor
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
        if (isGatewayFout(e) && (e.categorie === "configuratie" || e.categorie === "poort_gesloten")) {
          throw e;
        }
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
