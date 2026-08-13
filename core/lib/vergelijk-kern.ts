// ============================================================================
//  core/lib/vergelijk-kern.ts — de PURE orchestratie van de vergelijkmodus (T5).
// ----------------------------------------------------------------------------
//  Bevat de beslislogica van de symmetrische vergelijking, ZONDER directe SDK-/
//  Supabase-afhankelijkheden: alle I/O (retrieval, semantic_units lezen, Haiku/
//  Opus, wegschrijven) loopt via een injecteerbare `VergelijkDeps`. Zo is het
//  deterministisch-vs-LLM-pad los toetsbaar (vergelijk-kern.sanity.ts) met fakes,
//  en levert de service dezelfde logica in productie via vergelijk-productie.ts.
//  Zelfde pure/onzuiver-splitsing als semantische-concepten.ts ↔ semantische-
//  extractie.ts.
//
//  GRENS (T5): levert alleen RUWE verschillen (verschil_type_ruw) — geen
//  bestuurlijke classificatie/materialiteit (dat is T9).
// ============================================================================

import { mintFindingKey } from "./vergelijk-findingkey";
import type {
  ConceptType,
  Dimensie,
  Finding,
  FindingZijde,
  VerschilTypeRuw,
  VergelijkResultaat,
} from "./vergelijk-types";

// ── I/O-vormen (door de deps geleverd) ──────────────────────────────────────
export interface ConceptLite {
  id: string;
  key: string;
  label: string;
  type: string; // percentage|date|amount|policy_choice
  status: string; // actief|conditioneel|uitgesteld
}

export interface SemanticUnitLite {
  concept_id: string;
  type: string;
  value_num: number | null;
  value_date: string | null; // ISO
  value_text: string | null;
  value_raw: string;
  value_unit: string | null;
  page: number | null;
  evidence: string;
}

export interface PassageLite {
  tekst: string;
  page: number | null;
}

// Wat het LLM-pad teruggeeft per dimensie. `gelijk` is het SEMANTISCHE oordeel;
// de structurele verschil_type_ruw leidt de kern zelf af uit de aanwezigheid van
// waarden (zodat alleen_bron/alleen_doel deterministisch blijven, niet LLM-geraden).
export interface LLMVergelijkUitkomst {
  bron_value: string | null;
  bron_evidence: string | null;
  bron_page: number | null;
  doel_value: string | null;
  doel_evidence: string | null;
  doel_page: number | null;
  gelijk: boolean;
}

export interface PersisteerInvoer {
  mode: "symmetrisch";
  model: string;
  promptVersion: string;
  comparatorVersion: string;
  findings: Finding[];
}

export interface VergelijkDeps {
  leesConcepten(): Promise<ConceptLite[]>;
  leesSemanticUnits(documentId: string): Promise<SemanticUnitLite[]>;
  // Haiku: extra (niet-catalogus) dimensies afleiden uit de twee documenten. Mag
  // een lege lijst geven; best-effort (een gemiste dimensie = een gemiste as).
  bepaalExtraDimensies(input: {
    bronDocumentId: string;
    doelDocumentId: string;
    catalogus: Dimensie[];
  }): Promise<Dimensie[]>;
  retrieveerPassages(documentId: string, dimensie: Dimensie): Promise<PassageLite[]>;
  vergelijkWaardeLLM(input: {
    dimensie: Dimensie;
    passagesBron: PassageLite[];
    passagesDoel: PassageLite[];
  }): Promise<LLMVergelijkUitkomst>;
  // Schrijft comparison_run + comparison_results en geeft de run-id terug (of null
  // wanneer er bewust niet gepersisteerd wordt).
  persisteer(input: PersisteerInvoer): Promise<string | null>;
  // De contingentie-poort: alleen als dit true is mag het deterministische pad vuren.
  deterministischVertrouwd: boolean;
}

export interface VergelijkParams {
  mode: "symmetrisch";
  bronDocumentId: string;
  doelDocumentId: string;
  // Door de bestuurder aangevulde dimensies (labels/sleutels), best-effort.
  extraDimensies?: string[];
  versies: { model: string; promptVersion: string; comparatorVersion: string };
}

const EPS = 1e-9;

// ── Pure helpers (los getoetst) ──────────────────────────────────────────────

/** De vier ruwe uitkomsten uit aanwezigheid + (bij beide aanwezig) gelijkheid. */
export function bepaalVerschilTypeRuw(
  bronAanwezig: boolean,
  doelAanwezig: boolean,
  gelijk: boolean
): VerschilTypeRuw {
  if (bronAanwezig && doelAanwezig) return gelijk ? "gelijk" : "verschilt";
  if (bronAanwezig) return "alleen_bron";
  return "alleen_doel"; // doelAanwezig (de caller emit geen finding als geen van beide)
}

/** Catalogus-dimensies uit de actieve concepten (status ≠ 'uitgesteld'). */
export function bouwCatalogusDimensies(concepten: ConceptLite[]): Dimensie[] {
  return concepten
    .filter((c) => c.status !== "uitgesteld")
    .map((c) => ({
      key: c.key,
      label: c.label,
      concept_id: c.id,
      concept_key: c.key,
      type: c.type as ConceptType,
      herkomst: "catalogus" as const,
    }));
}

/** Dedup op key; eerste voorkomen wint (catalogus vóór llm vóór aangevuld). */
export function dedupDimensies(dims: Dimensie[]): Dimensie[] {
  const gezien = new Set<string>();
  const uit: Dimensie[] = [];
  for (const d of dims) {
    const k = d.key.trim().toLowerCase();
    if (gezien.has(k)) continue;
    gezien.add(k);
    uit.push(d);
  }
  return uit;
}

// Deterministische waardevergelijking (beide zijden hebben een semantic_unit).
// Vergelijkt op de getypeerde kolom; geeft de genormaliseerde weergave terug voor
// reproduceerbaarheid van het oordeel.
export function deterministischeVergelijking(
  bron: SemanticUnitLite,
  doel: SemanticUnitLite,
  type: ConceptType | string | null | undefined
): { gelijk: boolean; bronNorm: string | null; doelNorm: string | null } {
  switch (type) {
    case "percentage":
    case "amount": {
      const a = bron.value_num;
      const b = doel.value_num;
      const gelijk = a != null && b != null && Math.abs(a - b) <= EPS;
      return { gelijk, bronNorm: a != null ? String(a) : null, doelNorm: b != null ? String(b) : null };
    }
    case "date": {
      const a = bron.value_date;
      const b = doel.value_date;
      return { gelijk: !!a && !!b && a === b, bronNorm: a ?? null, doelNorm: b ?? null };
    }
    case "policy_choice":
    default: {
      const a = (bron.value_text ?? "").trim().toLowerCase();
      const b = (doel.value_text ?? "").trim().toLowerCase();
      return {
        gelijk: a !== "" && a === b,
        bronNorm: bron.value_text ?? null,
        doelNorm: doel.value_text ?? null,
      };
    }
  }
}

// ── Orchestratie ─────────────────────────────────────────────────────────────

function indexeerUnits(units: SemanticUnitLite[]): Map<string, SemanticUnitLite> {
  const m = new Map<string, SemanticUnitLite>();
  for (const u of units) {
    // Eerste unit per concept wint (ontdubbeling gebeurde al bij extractie; een
    // dimensie vergelijkt op één representatieve waarde per document).
    if (!m.has(u.concept_id)) m.set(u.concept_id, u);
  }
  return m;
}

function zijdeUitUnit(documentId: string, u: SemanticUnitLite, norm: string | null): FindingZijde {
  return {
    value: u.value_raw,
    value_normalized: norm,
    evidence: u.evidence,
    page: u.page,
    document_id: documentId,
  };
}

/**
 * Voer één symmetrische vergelijking uit. Pure orchestratie: alle I/O via `deps`.
 * Bepaalt per dimensie het deterministische (beide zijden een semantic_unit én de
 * vertrouwens-poort open) óf het LLM-pad, bouwt findings met een stabiele
 * finding_key en persisteert via deps.persisteer.
 */
export async function voerVergelijkingUit(
  params: VergelijkParams,
  deps: VergelijkDeps
): Promise<VergelijkResultaat> {
  const { mode, bronDocumentId, doelDocumentId } = params;

  // 1. Dimensies: catalogus (actieve concepten) + LLM-afgeleid + door de bestuurder
  //    aangevuld. Best-effort; dedup op key.
  const concepten = await deps.leesConcepten();
  const catalogus = bouwCatalogusDimensies(concepten);
  const extra = await deps.bepaalExtraDimensies({ bronDocumentId, doelDocumentId, catalogus });
  const aangevuld: Dimensie[] = (params.extraDimensies ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const match = catalogus.find((d) => d.key.toLowerCase() === s.toLowerCase());
      return match ?? { key: s, label: s, herkomst: "aangevuld" as const };
    });
  const dimensies = dedupDimensies([...catalogus, ...extra, ...aangevuld]);

  // 2. Semantic units per document één keer lezen (voor het deterministische pad).
  const bronUnits = indexeerUnits(await deps.leesSemanticUnits(bronDocumentId));
  const doelUnits = indexeerUnits(await deps.leesSemanticUnits(doelDocumentId));

  // 3. Per dimensie een finding bouwen.
  const findings: Finding[] = [];
  for (const dim of dimensies) {
    const conceptId = dim.concept_id ?? null;
    const finding_key = mintFindingKey({
      mode,
      bronDocumentId,
      doelDocumentId,
      conceptId,
      dimensie: dim.key,
    });

    const bu = conceptId ? bronUnits.get(conceptId) : undefined;
    const du = conceptId ? doelUnits.get(conceptId) : undefined;

    // Deterministisch pad: alleen als de poort open is ÉN BEIDE zijden een unit
    // hebben (acceptatiecriterium). Anders LLM.
    if (deps.deterministischVertrouwd && bu && du) {
      const cmp = deterministischeVergelijking(bu, du, dim.type);
      findings.push({
        finding_key,
        dimensie: dim.key,
        concept_id: conceptId,
        bron: zijdeUitUnit(bronDocumentId, bu, cmp.bronNorm),
        doel: zijdeUitUnit(doelDocumentId, du, cmp.doelNorm),
        verschil_type_ruw: bepaalVerschilTypeRuw(true, true, cmp.gelijk),
        method: "deterministisch",
      });
      continue;
    }

    // LLM-pad: passages per zijde ophalen, dan Opus. Structurele verschil_type_ruw
    // leidt de kern zelf af uit de aanwezigheid van waarden.
    const [passagesBron, passagesDoel] = await Promise.all([
      deps.retrieveerPassages(bronDocumentId, dim),
      deps.retrieveerPassages(doelDocumentId, dim),
    ]);
    const uit = await deps.vergelijkWaardeLLM({ dimensie: dim, passagesBron, passagesDoel });

    const bronAanwezig = uit.bron_value != null && uit.bron_value !== "";
    const doelAanwezig = uit.doel_value != null && uit.doel_value !== "";
    // Geen enkele zijde een waarde → niets te vergelijken; geen finding (geen
    // valse gelijkheids-/afwezigheidsclaim).
    if (!bronAanwezig && !doelAanwezig) continue;

    findings.push({
      finding_key,
      dimensie: dim.key,
      concept_id: conceptId,
      bron: {
        value: uit.bron_value,
        evidence: uit.bron_evidence,
        page: uit.bron_page,
        document_id: bronDocumentId,
      },
      doel: {
        value: uit.doel_value,
        evidence: uit.doel_evidence,
        page: uit.doel_page,
        document_id: doelDocumentId,
      },
      verschil_type_ruw: bepaalVerschilTypeRuw(bronAanwezig, doelAanwezig, uit.gelijk),
      method: "llm",
    });
  }

  // 4. Persisteren (append-only run + results via de DEFINER-RPC in productie).
  const comparison_run_id = await deps.persisteer({
    mode,
    model: params.versies.model,
    promptVersion: params.versies.promptVersion,
    comparatorVersion: params.versies.comparatorVersion,
    findings,
  });

  return {
    comparison_run_id,
    mode,
    bron_document_id: bronDocumentId,
    doel_document_id: doelDocumentId,
    dimensies,
    findings,
  };
}
