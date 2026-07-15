// ============================================================================
//  lib/rerank.ts — Haiku-reranker voor de retrieval-kandidatenset (R1.3).
// ----------------------------------------------------------------------------
//  Doel (RAG-review B2): RRF fuseert ranglijsten maar beoordeelt niet of een
//  chunk de VRÁÁG beantwoordt. Een goedkope listwise LLM-rerank op de overfetch-
//  set herordent naar precisie@k — de goedkoopste grote kwaliteitssprong bij
//  juridisch/bestuurlijk jargon waar lexicale én vector-ranking ruis geven.
//
//  ONTWERP:
//  - Listwise in ÉÉN call (latency/kosten): alle kandidaten genummerd in één
//    prompt, JSON-uitvoer met per kandidaat een relevantiescore 0–100.
//  - Rerank over de VERRIJKTE tekst (context_prefix + fragment), consistent met
//    wat geëmbed/geïndexeerd wordt. De prefix blijft onzichtbaar voor de
//    gebruiker (prefix-isolatie, besluit 0025): de reranker ziet hem, de
//    getoonde passage nooit.
//  - FAIL-SAFE: bij API-fout, timeout of onparseerbare uitvoer → originele
//    (RRF-)volgorde behouden en `fallback_reason` loggen. De rerankscores gaan
//    mee terug zodat de relevantie-drempel (R1.5) erop kan poorten; bij fallback
//    zijn er geen scores en wordt er dus niet gepoort (geen schijnzekerheid).
//
//  Zuivere kern (parse + herordening) is los testbaar (lib/rerank.sanity.ts);
//  de Anthropic-client is injecteerbaar voor hermetische tests.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { HAIKU_MODEL } from "./llm-modellen";

// Tijdsbudget voor de rerank-call. Bewust krap: de rerank staat in het kritieke
// pad vóór generatie; bij overschrijding valt hij terug op de RRF-volgorde.
export const RERANK_TIMEOUT_MS = 4000;

// Hoeveel tekens van (de verrijkte) tekst we per kandidaat aan het model tonen.
// Ruim genoeg om relevantie te beoordelen, begrensd tegen kosten (~30 kandidaten).
const RERANK_INPUT_MAX = 800;

// Bovengrens op het aantal kandidaten in één call (tokenbudget). De overfetch is
// ~20–30; hierboven knippen we voor de zekerheid.
const RERANK_MAX_KANDIDATEN = 40;

const SP_RERANK = `Je bent een herrangschikker voor een zoeksysteem van een Nederlands pensioenfonds. Je krijgt een zoekvraag en genummerde tekstfragmenten uit de documentbibliotheek.

Beoordeel per fragment hoe goed het de ZOEKVRAAG beantwoordt, met een score van 0 tot 100 (100 = beantwoordt de vraag direct en volledig; 0 = niet relevant). Baseer je uitsluitend op de gegeven fragmenttekst; verzin niets.

Geef UITSLUITEND een JSON-array terug, exact één object per fragment, in de vorm:
[{"i": <fragmentnummer>, "score": <geheel getal 0-100>}]
Geen toelichting, geen extra tekst.`;

/** Injecteerbare, minimale Anthropic-client (hermetische tests). */
export type RerankClient = Pick<Anthropic["messages"], "create">;

let gedeeldeClient: Anthropic | null = null;
function client(): RerankClient {
  if (!gedeeldeClient) {
    gedeeldeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return gedeeldeClient.messages;
}

export interface RerankMeta {
  methode: "haiku_listwise";
  model: string;
  toegepast: boolean;
  fallback_reason?: string;
  // chunk_id → rerankscore (0–100). Leeg bij fallback.
  scores: Record<string, number>;
  volgorde_voor: string[];
  volgorde_na: string[];
}

export interface RerankOpties {
  client?: RerankClient;
  timeoutMs?: number;
  model?: string;
}

// ── Zuivere kern ─────────────────────────────────────────────────────────────

// Parseert de modeluitvoer naar een map fragmentnummer(1-based) → score. Robuust:
// pakt de eerste JSON-array uit de tekst, klemt scores in [0,100]. Geeft null bij
// onparseerbare/lege uitvoer (→ caller houdt RRF-volgorde).
export function parseRerankScores(ruw: string, aantal: number): Map<number, number> | null {
  const start = ruw.indexOf("[");
  const eind = ruw.lastIndexOf("]");
  if (start === -1 || eind === -1 || eind <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(ruw.slice(start, eind + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const scores = new Map<number, number>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const i = Number(rec.i);
    const s = Number(rec.score);
    if (!Number.isInteger(i) || i < 1 || i > aantal) continue;
    if (!Number.isFinite(s)) continue;
    scores.set(i, Math.max(0, Math.min(100, Math.round(s))));
  }
  return scores.size > 0 ? scores : null;
}

// Herordent kandidaten op aflopende score (stabiel: gelijke scores en kandidaten
// zonder score behouden hun onderlinge RRF-volgorde). Kandidaten zonder score
// krijgen -1 zodat ze achteraan komen maar niet verdwijnen. Geeft de herordende
// lijst plus de score-per-id map terug.
export function pasVolgordeToe<T extends { id: string }>(
  kandidaten: T[],
  scoresPerNummer: Map<number, number>
): { volgorde: T[]; scoresPerId: Record<string, number> } {
  const scoresPerId: Record<string, number> = {};
  const verrijkt = kandidaten.map((c, idx) => {
    const score = scoresPerNummer.get(idx + 1);
    if (score !== undefined) scoresPerId[c.id] = score;
    return { c, idx, score: score ?? -1 };
  });
  verrijkt.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return { volgorde: verrijkt.map((x) => x.c), scoresPerId };
}

// ── Onzuivere schil (LLM-call met fail-safe) ─────────────────────────────────

function metFallback<T extends { id: string }>(
  kandidaten: T[],
  reden: string,
  model: string
): { chunks: T[]; meta: RerankMeta } {
  const ids = kandidaten.map((c) => c.id);
  return {
    chunks: kandidaten,
    meta: {
      methode: "haiku_listwise",
      model,
      toegepast: false,
      fallback_reason: reden,
      scores: {},
      volgorde_voor: ids,
      volgorde_na: ids,
    },
  };
}

// Rerankt de kandidatenset listwise via Haiku over de verrijkte tekst. Geeft bij
// elke fout/timeout de originele volgorde terug (fail-safe). `verrijkteTekstVan`
// levert per kandidaat de tekst waarover gescoord wordt (context_prefix + fragment).
export async function rerankChunks<T extends { id: string }>(
  zoekvraag: string,
  kandidaten: T[],
  verrijkteTekstVan: (c: T) => string,
  opties?: RerankOpties
): Promise<{ chunks: T[]; meta: RerankMeta }> {
  const model = opties?.model ?? HAIKU_MODEL;
  if (kandidaten.length < 2) return metFallback(kandidaten, "geen_herordening_nodig", model);

  const set = kandidaten.slice(0, RERANK_MAX_KANDIDATEN);
  const gekapt = kandidaten.slice(RERANK_MAX_KANDIDATEN); // buiten de rerank; achteraan
  const genummerd = set
    .map((c, i) => {
      const t = verrijkteTekstVan(c);
      const kort = t.length > RERANK_INPUT_MAX ? t.slice(0, RERANK_INPUT_MAX) + " […]" : t;
      return `[${i + 1}] ${kort}`;
    })
    .join("\n\n");

  const timeoutMs = opties?.timeoutMs ?? RERANK_TIMEOUT_MS;
  const c = opties?.client ?? client();

  let ruw: string;
  // Timer-handle buiten de try zodat we hem in `finally` altijd opruimen: wint de
  // API-call de race, dan blijft de timeout anders 4s gewapend staan en houdt hij
  // de event loop bezig (dangling teardown-latency op het kritieke chatpad).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = c.create({
      model,
      max_tokens: 1024,
      system: SP_RERANK,
      messages: [
        {
          role: "user",
          content: `Zoekvraag: ${zoekvraag}\n\nFragmenten:\n${genummerd}\n\nJSON:`,
        },
      ],
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("rerank_timeout")), timeoutMs);
    });
    const response = await Promise.race([call, timeout]);
    ruw = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch (e) {
    const reden = e instanceof Error && e.message === "rerank_timeout" ? "timeout" : "api_error";
    console.error("[rerank] fallback naar RRF-volgorde:", e);
    return metFallback(kandidaten, reden, model);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const scores = parseRerankScores(ruw, set.length);
  if (!scores) return metFallback(kandidaten, "onparseerbaar", model);

  const { volgorde, scoresPerId } = pasVolgordeToe(set, scores);
  const nieuw = [...volgorde, ...gekapt];
  return {
    chunks: nieuw,
    meta: {
      methode: "haiku_listwise",
      model,
      toegepast: true,
      scores: scoresPerId,
      volgorde_voor: kandidaten.map((x) => x.id),
      volgorde_na: nieuw.map((x) => x.id),
    },
  };
}
