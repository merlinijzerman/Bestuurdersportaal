// lib/aqlab/seed/gate.ts
// -----------------------------------------------------------------------------
// Seeding-gate (pre-seed validatierapport §6). GATE-FIRST: de loader mag geen
// enkele write doen zolang SEED_ALLOWED = false. SEED_ALLOWED wordt AFGELEID uit
// de vier poorten — nooit hardcoded — zodat hij automatisch omslaat zodra de
// poorten sluiten.
// -----------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

export const PLACEHOLDER = '<sha256-placeholder>';

export interface GatePoort {
  key: string;
  omschrijving: string;
  groen: boolean;
}

export interface GateResultaat {
  poorten: GatePoort[];
  seedAllowed: boolean;
  redenen: string[]; // waarom (nog) niet toegestaan
}

interface ValidationState {
  avg_scope_SEC06_confirmed?: boolean;
  legal_compliance_confirmed?: boolean;
  judge_json_schemas_present?: boolean;
}

/**
 * Bepaal de gate-status.
 * @param seedYamlRaw  ruwe inhoud van AQLAB-SEED-STRUCTUUR-v0.2.yaml (voor placeholder-detectie)
 * @param statePath    pad naar AQLAB-VALIDATION-STATE.yaml (menselijke poorten)
 */
export function evalueerGate(seedYamlRaw: string, statePath: string): GateResultaat {
  let state: ValidationState = {};
  try {
    state = (yaml.load(readFileSync(statePath, 'utf8')) as ValidationState) ?? {};
  } catch {
    // Ontbrekend/onleesbaar state-bestand = poorten open (fail-closed).
    state = {};
  }

  const hashGevuld = !seedYamlRaw.includes(PLACEHOLDER);

  const poorten: GatePoort[] = [
    {
      key: 'content_hash_gevuld',
      omschrijving: 'content_hash ingevuld in de bron (geen placeholders)',
      groen: hashGevuld,
    },
    {
      key: 'avg_scope_SEC06',
      omschrijving: 'AVG-scope SEC-06 (FIX-19) juridisch/FG-bevestigd',
      groen: state.avg_scope_SEC06_confirmed === true,
    },
    {
      key: 'legal_compliance',
      omschrijving: 'juridische/compliance-duiding BS-06/BV-04/SEC-04 gevalideerd',
      groen: state.legal_compliance_confirmed === true,
    },
    {
      key: 'judge_json_schemas',
      omschrijving: "judge-JSON-schema's gedefinieerd",
      groen: state.judge_json_schemas_present === true,
    },
  ];

  const redenen = poorten.filter((p) => !p.groen).map((p) => p.omschrijving);
  return { poorten, seedAllowed: redenen.length === 0, redenen };
}
