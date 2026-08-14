// Procedure-definitie — canonieke procedurebeschrijving als data (decision 0002).
//
// Een *definitie* is de rijke, gevalideerde bron voor een procedure:
// stappen (met fase, parallelle afhankelijkheden en checklist), de
// bewijslast (requirements) en de fasebeschrijvingen. De engine leest
// deze definitie bij het starten van een procedure (snapshot) en de
// readiness-functie consumeert de requirements.
//
// Bewust GEEN zod: dit project hanteert "geen extra runtime-dep" en
// valideert net als de overige lib-modules met een lichte, eigen check
// die onder `npm run sanity` draait (zie procedure-definitie.sanity.ts).
// De validatie is daarmee net zo streng als een schema-validator, maar
// zonder nieuwe afhankelijkheid.

import type {
  ProcessTemplate,
  ProcessTemplateStap,
} from "./proces-templates";

// ── Requirement-types ─────────────────────────────────────────────────
//
// De tien basistypen komen overeen met de CHECK-enum op
// `procedure_requirements` (migratie 2026_05_07_decision_object.sql).
// `external_submission` en `consultation` zijn de twee uitbreidingen uit
// het proceduremodule-ontwerp v0.2 die de zwaarste invaarstappen (1, 8, 9)
// auditbaar maken; ze worden met deze tranche aan de DB-enum toegevoegd en
// in readiness/evidence ondersteund.
export const REQUIREMENT_TYPES = [
  "document",
  "field",
  "assumption",
  "risk",
  "ai_validation",
  "approval",
  "mandate_check",
  "kpi",
  "evaluation",
  "dissent_review",
  "external_submission",
  "consultation",
] as const;

export type DefinitieRequirementType = (typeof REQUIREMENT_TYPES)[number];

// ── Definitie-contract ────────────────────────────────────────────────

export interface DefinitieRequirement {
  requirement_type: DefinitieRequirementType;
  label: string;
  /** OB-E10: bestuurlijke toelichting bij dit bewijsstuk (standaardset). */
  toelichting?: string | null;
  documenttype?: string | null;
  veld_pad?: string | null;
  verplicht: boolean;
  blokkerend: boolean;
  min_aantal?: number;
  vereist_validatie_domein?: string | null;
  // Puur definitie-metadata (nog niet in het DB-model); documenteert de
  // bevestigings-/termijneis van een externe indiening. Zie openstaande
  // punt OB-1 (readiness-semantiek external_submission/consultation).
  bevestiging_vereist?: boolean;
  termijngebonden?: boolean;
}

export interface DefinitieChecklistItem {
  label: string;
  bewijs_vereist: boolean;
  /** OB-E10: toelichting bij dit checklistpunt (standaardset). */
  toelichting?: string | null;
}

export interface DefinitieStap {
  volgorde: number;
  naam: string;
  beschrijving: string;
  fase_code: string;
  fase_type?: string;
  vereist_besluit: boolean;
  geschatte_dagen: number;
  /** Stap-volgordes die eerst `afgerond` moeten zijn. Leeg = geen gate. */
  blokkerende_afhankelijkheden: number[];
  checklist: DefinitieChecklistItem[];
  requirements: DefinitieRequirement[];
}

export interface DefinitieFase {
  fase_code: string;
  volgorde: number;
  titel: string;
  generieke_beschrijving?: string | null;
}

export interface ProcedureDefinitie {
  code: string;
  versie: string;
  naam: string;
  sector: string;
  fonds_variant?: string;
  profiel_type?: string;
  korte_omschrijving: string;
  context?: string;
  aanleiding?: string;
  frequentie?: string;
  eigenaar_rol?: string;
  regelgeving?: string[];
  geschat_aantal_dagen: number;
  classificatie_default?: Record<string, unknown>;
  fasen: DefinitieFase[];
  stappen: DefinitieStap[];
}

// ── Validatie (lichtgewicht, geen dep) ────────────────────────────────

const SEMVER = /^\d+\.\d+\.\d+$/;

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/**
 * Structurele validatie van een definitie. Retourneert een lijst
 * foutmeldingen; leeg = geldig. Dekt schema (verplichte velden + types),
 * fase-referenties, requirement-types en de DAG-eis op afhankelijkheden.
 */
export function valideerDefinitie(def: unknown): string[] {
  const fouten: string[] = [];
  if (typeof def !== "object" || def === null) {
    return ["definitie is geen object"];
  }
  const d = def as Record<string, unknown>;

  if (!isStr(d.code)) fouten.push("code ontbreekt of is leeg");
  if (!isStr(d.versie) || !SEMVER.test(String(d.versie))) {
    fouten.push("versie ontbreekt of is geen semver (x.y.z)");
  }
  if (!isStr(d.naam)) fouten.push("naam ontbreekt of is leeg");
  if (!isStr(d.sector)) fouten.push("sector ontbreekt of is leeg");
  if (!isStr(d.korte_omschrijving)) fouten.push("korte_omschrijving ontbreekt");
  if (!isInt(d.geschat_aantal_dagen)) {
    fouten.push("geschat_aantal_dagen ontbreekt of is geen geheel getal");
  }

  // Fasen
  const faseCodes = new Set<string>();
  if (!Array.isArray(d.fasen) || d.fasen.length === 0) {
    fouten.push("fasen ontbreekt of is leeg");
  } else {
    for (const [i, f0] of d.fasen.entries()) {
      const f = f0 as Record<string, unknown>;
      if (!isStr(f.fase_code)) {
        fouten.push(`fase[${i}]: fase_code ontbreekt`);
        continue;
      }
      if (faseCodes.has(String(f.fase_code))) {
        fouten.push(`fase_code '${f.fase_code}' is dubbel`);
      }
      faseCodes.add(String(f.fase_code));
      if (!isStr(f.titel)) fouten.push(`fase '${f.fase_code}': titel ontbreekt`);
      if (!isInt(f.volgorde)) {
        fouten.push(`fase '${f.fase_code}': volgorde is geen geheel getal`);
      }
    }
  }

  // Stappen
  const volgordes = new Set<number>();
  if (!Array.isArray(d.stappen) || d.stappen.length === 0) {
    fouten.push("stappen ontbreekt of is leeg");
    return fouten;
  }
  for (const [i, s0] of d.stappen.entries()) {
    const s = s0 as Record<string, unknown>;
    const pos = isInt(s.volgorde) ? `stap ${s.volgorde}` : `stap[${i}]`;
    if (!isInt(s.volgorde) || (s.volgorde as number) < 1) {
      fouten.push(`${pos}: volgorde ontbreekt of < 1`);
    } else if (volgordes.has(s.volgorde as number)) {
      fouten.push(`${pos}: volgorde is dubbel`);
    } else {
      volgordes.add(s.volgorde as number);
    }
    if (!isStr(s.naam)) fouten.push(`${pos}: naam ontbreekt`);
    if (!isStr(s.beschrijving)) fouten.push(`${pos}: beschrijving ontbreekt`);
    if (!isBool(s.vereist_besluit)) fouten.push(`${pos}: vereist_besluit ontbreekt`);
    if (!isInt(s.geschatte_dagen)) fouten.push(`${pos}: geschatte_dagen ontbreekt`);
    if (!isStr(s.fase_code)) {
      fouten.push(`${pos}: fase_code ontbreekt`);
    } else if (faseCodes.size > 0 && !faseCodes.has(String(s.fase_code))) {
      fouten.push(`${pos}: fase_code '${s.fase_code}' bestaat niet in fasen[]`);
    }

    if (!Array.isArray(s.blokkerende_afhankelijkheden)) {
      fouten.push(`${pos}: blokkerende_afhankelijkheden ontbreekt (mag [] zijn)`);
    } else {
      for (const dep of s.blokkerende_afhankelijkheden) {
        if (!isInt(dep)) fouten.push(`${pos}: afhankelijkheid '${dep}' is geen getal`);
        else if (dep === s.volgorde) fouten.push(`${pos}: verwijst naar zichzelf`);
      }
    }

    if (!Array.isArray(s.checklist)) {
      fouten.push(`${pos}: checklist ontbreekt (mag [] zijn)`);
    } else {
      for (const [j, c0] of s.checklist.entries()) {
        const c = c0 as Record<string, unknown>;
        if (!isStr(c.label)) fouten.push(`${pos} checklist[${j}]: label ontbreekt`);
        if (!isBool(c.bewijs_vereist)) {
          fouten.push(`${pos} checklist[${j}]: bewijs_vereist ontbreekt`);
        }
      }
    }

    if (!Array.isArray(s.requirements)) {
      fouten.push(`${pos}: requirements ontbreekt (mag [] zijn)`);
    } else {
      for (const [j, r0] of s.requirements.entries()) {
        const r = r0 as Record<string, unknown>;
        const rp = `${pos} requirement[${j}]`;
        if (!isStr(r.requirement_type) ||
            !REQUIREMENT_TYPES.includes(r.requirement_type as DefinitieRequirementType)) {
          fouten.push(`${rp}: onbekend requirement_type '${r.requirement_type}'`);
        }
        if (!isStr(r.label)) fouten.push(`${rp}: label ontbreekt`);
        if (!isBool(r.verplicht)) fouten.push(`${rp}: verplicht ontbreekt`);
        if (!isBool(r.blokkerend)) fouten.push(`${rp}: blokkerend ontbreekt`);
        if (r.requirement_type === "field" && !isStr(r.veld_pad)) {
          fouten.push(`${rp}: field vereist een veld_pad`);
        }
        if (r.min_aantal !== undefined && (!isInt(r.min_aantal) || (r.min_aantal as number) < 1)) {
          fouten.push(`${rp}: min_aantal moet een geheel getal >= 1 zijn`);
        }
      }
    }
  }

  // Afhankelijkheden verwijzen naar bestaande stappen
  for (const s0 of d.stappen as Record<string, unknown>[]) {
    const deps = Array.isArray(s0.blokkerende_afhankelijkheden)
      ? (s0.blokkerende_afhankelijkheden as unknown[])
      : [];
    for (const dep of deps) {
      if (isInt(dep) && !volgordes.has(dep)) {
        fouten.push(`stap ${s0.volgorde}: afhankelijkheid ${dep} verwijst naar een niet-bestaande stap`);
      }
    }
  }

  // DAG-check (geen cyclus)
  fouten.push(...valideerDAG(d.stappen as DefinitieStap[]));

  return fouten;
}

/**
 * Topologische cyclus-detectie op de `blokkerende_afhankelijkheden`-graaf.
 * Een cyclus is een harde importfout (zou de activatie laten vastlopen).
 * Retourneert foutmeldingen; leeg = acyclisch.
 */
export function valideerDAG(stappen: DefinitieStap[]): string[] {
  const deps = new Map<number, number[]>();
  for (const s of stappen) {
    deps.set(
      s.volgorde,
      (s.blokkerende_afhankelijkheden ?? []).filter((v) => typeof v === "number")
    );
  }
  const status = new Map<number, 0 | 1 | 2>(); // 0=wit,1=grijs,2=zwart
  const fouten: string[] = [];

  const bezoek = (n: number, pad: number[]): boolean => {
    status.set(n, 1);
    for (const m of deps.get(n) ?? []) {
      if (!deps.has(m)) continue; // niet-bestaande stap → elders al gemeld
      const st = status.get(m) ?? 0;
      if (st === 1) {
        fouten.push(`cyclus in afhankelijkheden: ${[...pad, n, m].join(" → ")}`);
        return true;
      }
      if (st === 0 && bezoek(m, [...pad, n])) return true;
    }
    status.set(n, 2);
    return false;
  };

  for (const n of deps.keys()) {
    if ((status.get(n) ?? 0) === 0) {
      if (bezoek(n, [])) break;
    }
  }
  return fouten;
}

// ── Mapping naar het ProcessTemplate-contract (snapshot-bron) ──────────

/**
 * Zet een gevalideerde definitie om naar het bestaande
 * `ProcessTemplate`-contract dat de procedure-startroute snapshot. De
 * requirements gaan NIET mee (die leven globaal in `procedure_requirements`
 * en worden live door de readiness-functie gelezen); wél de per-stap
 * `fase_code` en `blokkerende_afhankelijkheden` voor D6/D8.
 */
export function definitieNaarProcessTemplate(def: ProcedureDefinitie): ProcessTemplate {
  const stappen: ProcessTemplateStap[] = def.stappen
    .slice()
    .sort((a, b) => a.volgorde - b.volgorde)
    .map((s) => ({
      volgorde: s.volgorde,
      naam: s.naam,
      beschrijving: s.beschrijving,
      vereist_besluit: s.vereist_besluit,
      geschatte_dagen: s.geschatte_dagen,
      fase_code: s.fase_code,
      blokkerende_afhankelijkheden: s.blokkerende_afhankelijkheden ?? [],
      checklist: s.checklist.map((c, i) => ({
        volgorde: i + 1,
        label: c.label,
        bewijs_vereist: c.bewijs_vereist,
        toelichting: c.toelichting ?? null,
      })),
    }));

  return {
    code: def.code,
    naam: def.naam,
    korte_omschrijving: def.korte_omschrijving,
    geschat_aantal_dagen: def.geschat_aantal_dagen,
    stappen,
  };
}
