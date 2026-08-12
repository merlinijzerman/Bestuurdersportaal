// ============================================================================
//  extract.ts — per document → per pagina/segment → per concept → Haiku.
// ----------------------------------------------------------------------------
//  Draai:  ./node_modules/.bin/tsx scripts/spike-s1/extract.ts
//  (vanuit de mvp/-map). Leest alle documenten uit scripts/spike-s1/data/,
//  extraheert met DEZELFDE tekst-extractielaag als productie
//  (core/lib/document-extractie.ts), vraagt Haiku per (pagina, concept) om alle
//  voorkomens via geforceerde tool-use (temperature 0), verifieert de evidence
//  verbatim, normaliseert de waarde deterministisch, en schrijft
//  scripts/spike-s1/output/units.json.
//
//  Wegwerp-spike. Geen DB, geen UI, geen API-route.
// ============================================================================

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  extractTekst,
  type Bestandstype,
} from "../../core/lib/document-extractie";
import { HAIKU_MODEL } from "../../core/lib/llm-modellen";
import { CONCEPTEN, normaliseer } from "./concepts";
import type { Unit } from "./types";
import { evidenceVerbatim } from "./tekst";

const HIER = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HIER, "data");
const OUTPUT_DIR = join(HIER, "output");

// Max. paginatekst per modelcall — houdt de context klein en de kosten laag.
// Pensioendocument-pagina's zijn ruim binnen deze grens; XLSX-segmenten kunnen
// groter zijn en worden dan afgekapt (met notitie in de log).
const MAX_PAGINA_TEKST = 12000;

// ── env: laad mvp/.env.local zodat ANTHROPIC_API_KEY beschikbaar is ─
// De sleutel valt onder de bestaande Anthropic-DPA/EU-residency-afspraken van
// het platform (zie §4 van de werkopdracht) — geen privésleutel gebruiken.
function laadEnv(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  const envPad = resolve(HIER, "../../.env.local");
  if (!existsSync(envPad)) return;
  for (const regel of readFileSync(envPad, "utf8").split("\n")) {
    const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const waarde = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = waarde;
  }
}

const EXT_NAAR_TYPE: Record<string, Bestandstype> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
};

// ── Tool-schema: forceer gestructureerde output ─────────────────────
// We vragen het model NIET om de genormaliseerde waarde of het paginanummer —
// die zijn objectief (normaliser resp. bron-segment). Alleen value_raw,
// verbatim evidence, een optionele sectiehint en een grof confidence-signaal.
const TOOL: Anthropic.Tool = {
  name: "leg_voorkomens_vast",
  description:
    "Leg alle voorkomens van het gevraagde concept op deze pagina vast. " +
    "Geef een lege lijst als het concept niet op deze pagina voorkomt.",
  input_schema: {
    type: "object",
    properties: {
      voorkomens: {
        type: "array",
        items: {
          type: "object",
          properties: {
            value_raw: {
              type: "string",
              description: "De waarde exact zoals in de tekst (bv. '6,0%').",
            },
            evidence: {
              type: "string",
              description:
                "De bronzin LETTERLIJK overgenomen uit de paginatekst — geen " +
                "parafrase, geen aanpassing.",
            },
            sectie: {
              type: "string",
              description: "Kop/sectie waarin dit staat, indien zichtbaar; anders leeg.",
            },
            model_confidence: {
              type: "string",
              enum: ["hoog", "midden", "laag"],
            },
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
  "documenten. Je krijgt de tekst van één pagina en precies één doelconcept. " +
  "Je taak: vind ALLE voorkomens van uitsluitend dat concept op deze pagina. " +
  "Regels: (1) Neem de evidence-zin LETTERLIJK over uit de tekst. (2) Bind een " +
  "waarde alleen aan het concept als de tekst dat ondubbelzinnig ondersteunt — " +
  "bij twijfel niet opnemen. (3) Verwar het concept niet met naburige, andere " +
  "grootheden. (4) Geen voorkomens? Geef een lege lijst. Verzin nooit tekst.";

interface RawVoorkomen {
  value_raw: string;
  evidence: string;
  sectie?: string;
  model_confidence: "hoog" | "midden" | "laag";
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client)
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

async function vraagHaiku(
  paginaTekst: string,
  conceptOmschrijving: string
): Promise<RawVoorkomen[]> {
  const resp = await client().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    temperature: 0, // reproduceerbaarheid (§8 werkopdracht)
    system: SYSTEEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content:
          `Doelconcept:\n${conceptOmschrijving}\n\n` +
          `Paginatekst:\n"""\n${paginaTekst}\n"""`,
      },
    ],
  });
  const blok = resp.content.find((b) => b.type === "tool_use");
  if (!blok || blok.type !== "tool_use") return [];
  const input = blok.input as { voorkomens?: RawVoorkomen[] };
  return Array.isArray(input.voorkomens) ? input.voorkomens : [];
}

async function main() {
  laadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "GEEN ANTHROPIC_API_KEY gevonden (env of mvp/.env.local). Afgebroken."
    );
    process.exit(1);
  }

  const bestanden = existsSync(DATA_DIR)
    ? readdirSync(DATA_DIR).filter((f) => extname(f).toLowerCase() in EXT_NAAR_TYPE)
    : [];

  if (bestanden.length === 0) {
    console.error(
      `Geen ondersteunde documenten in ${DATA_DIR}.\n` +
        "Zet de (gitignored) testdocumenten daar neer (.pdf/.docx/.pptx/.xlsx)."
    );
    process.exit(1);
  }

  const units: Unit[] = [];
  let calls = 0;

  for (const bestand of bestanden) {
    const type = EXT_NAAR_TYPE[extname(bestand).toLowerCase()];
    const buffer = readFileSync(join(DATA_DIR, bestand));
    console.log(`\n=== ${bestand} (${type}) ===`);

    let resultaat;
    try {
      resultaat = await extractTekst(buffer, type);
    } catch (e) {
      console.error(`  extractie mislukt: ${(e as Error).message}`);
      continue;
    }
    console.log(
      `  ${resultaat.segmenten.length} segment(en), ${resultaat.aantalPaginas ?? "?"} pagina('s)`
    );

    for (const seg of resultaat.segmenten) {
      const paginaTekst =
        seg.tekst.length > MAX_PAGINA_TEKST
          ? seg.tekst.slice(0, MAX_PAGINA_TEKST)
          : seg.tekst;

      for (const def of CONCEPTEN) {
        let voorkomens: RawVoorkomen[];
        try {
          voorkomens = await vraagHaiku(paginaTekst, def.omschrijving);
          calls++;
        } catch (e) {
          console.error(
            `  Haiku-call mislukt (pag ${seg.pagina}, ${def.concept}): ${(e as Error).message}`
          );
          continue;
        }

        for (const v of voorkomens) {
          const norm = normaliseer(def, v.value_raw, v.evidence);
          const evOk = evidenceVerbatim(v.evidence, seg.tekst);
          units.push({
            document: bestand,
            concept: def.concept,
            type: def.type,
            page: seg.pagina,
            section: v.sectie?.trim() || seg.paragraaf || null,
            value_raw: v.value_raw,
            value_normalized: norm.value,
            currency: norm.currency,
            evidence: v.evidence,
            evidence_ok: evOk,
            norm_ok: norm.ok,
            model_confidence: v.model_confidence,
          });
        }
      }
    }
  }

  writeFileSync(join(OUTPUT_DIR, "units.json"), JSON.stringify(units, null, 2));
  console.log(
    `\nKlaar: ${units.length} unit(s) uit ${bestanden.length} document(en), ` +
      `${calls} modelcall(s). → output/units.json`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
