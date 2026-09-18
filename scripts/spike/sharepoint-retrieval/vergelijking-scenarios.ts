// ============================================================================
//  #407 T2 — vaste scenarioset voor de kwaliteitsvergelijking.
// ----------------------------------------------------------------------------
//  Deze set leeft bewust in het spikeharnas en NIET in
//  `core/lib/microsoft-sharepoint-retrieval-smoke-core.ts`. Die laatste voedt de
//  Preview-brug — live-retrievalproductiecode — en blijft in deze tranche
//  ongewijzigd. De vergelijkingsrunner leest uitsluitend hieruit; browserinvoer
//  kan geen scenario, zoekterm, KQL of scope toevoegen.
//
//  S02, S03, S04 en S04H zijn letterlijk overgenomen uit de vastgestelde
//  acceptatieset (#354/#385) zodat de vergelijking op dezelfde vaste set draait.
//  SEM01 en SEM02 zijn de twee door #407 geëiste semantische scenario's.
// ============================================================================
import type { SpikeVraag } from "./types";

/**
 * LET OP — voorwaarde voor een LIVE semantische meting.
 *
 * De #385-fixtures zijn volledig rond unieke canary-termen gebouwd: de
 * generator zet de canaryterm, de vraag én het antwoordfeit letterlijk in het
 * document (`tests/e2e/fixtures/pgb-sharepoint/bron/genereer-docx.py`). Er staat
 * geen parafrase- of synoniemtekst in. SEM01 en SEM02 zijn daarom in deze
 * tranche uitsluitend HERMETISCH meetbaar, met eigen gegenereerde bytes.
 *
 * Een live semantische meting vereist eerst twee nieuwe synthetische fixtures
 * met parafrasetekst in het manifest én in SharePoint. Dat is fixture- en
 * tenantwerk en hoort bij T3; het staat als expliciete voorwaarde in de
 * licentie-, kosten- en consentnotitie.
 */
export const SEMANTISCHE_FIXTURES_VEREIST = ["PGB407-DOC-101", "PGB407-DOC-102"] as const;

export const VERGELIJK_SCENARIOS = {
  S02: {
    code: "S02",
    soort: "gericht",
    vraag: "Welke hersteltermijn geldt voor Koraalmaat 47?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Koraalmaat 47"],
    microsoftZoektermen: ["Welke hersteltermijn geldt voor Koraalmaat 47", "Koraalmaat 47 hersteltermijn"],
    copilotVraag: "Welke hersteltermijn geldt voor Koraalmaat 47?",
    verwachteFixtures: ["PGB354-DOC-001"],
    primaireFixture: "PGB354-DOC-001",
  },
  S03: {
    code: "S03",
    soort: "meerdere_documenten",
    vraag: "Welke hersteltermijn geldt voor Koraalmaat 47 en op welke datum staat het oefenbesluit voor IJsvogelkompas 73?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Koraalmaat 47", "IJsvogelkompas 73"],
    microsoftZoektermen: ["Koraalmaat 47 IJsvogelkompas 73", "hersteltermijn oefenbesluit"],
    copilotVraag: "Welke hersteltermijn geldt voor Koraalmaat 47 en op welke datum staat het oefenbesluit voor IJsvogelkompas 73?",
    verwachteFixtures: ["PGB354-DOC-001", "PGB354-PPT-001"],
    primaireFixture: "PGB354-DOC-001",
  },
  S04: {
    code: "S04",
    soort: "versieconflict",
    vraag: "Wat is de actuele bandbreedte voor Maananker 61?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Maananker Actueel 61"],
    microsoftZoektermen: ["actuele bandbreedte Maananker 61", "Maananker Actueel 61"],
    copilotVraag: "Wat is de actuele bandbreedte voor Maananker 61?",
    verwachteFixtures: ["PGB354-PDF-001"],
    primaireFixture: "PGB354-PDF-001",
  },
  S04H: {
    code: "S04H",
    soort: "versieconflict",
    vraag: "Wat was de historische bandbreedte voor Maananker 61?",
    actualiteitsbeleid: "alleen_historisch",
    driveZoektermen: ["Maananker Historisch 61"],
    microsoftZoektermen: ["historische bandbreedte Maananker 61", "Maananker Historisch 61"],
    copilotVraag: "Wat was de historische bandbreedte voor Maananker 61?",
    verwachteFixtures: ["PGB354-PDF-002"],
    primaireFixture: "PGB354-PDF-002",
  },
  // ---- semantische scenario's -------------------------------------------
  // De doelpassage bevat geen letterlijke term uit de vraag. De lexicale armen
  // horen hier weinig tot niets te vinden; dat is geen defect maar precies het
  // verschil dat #407 wil meten.
  SEM01: {
    code: "SEM01",
    soort: "gericht",
    vraag: "Hoeveel tijd krijgt het bestuur om een geconstateerd tekort weg te werken?",
    actualiteitsbeleid: "alleen_actueel",
    semantisch: true,
    driveZoektermen: ["tekort wegwerken termijn"],
    microsoftZoektermen: ["hoeveel tijd om een tekort weg te werken"],
    copilotVraag: "Hoeveel tijd krijgt het bestuur om een geconstateerd tekort weg te werken?",
    verwachteFixtures: ["PGB407-DOC-101"],
    primaireFixture: "PGB407-DOC-101",
  },
  SEM02: {
    code: "SEM02",
    soort: "gericht",
    vraag: "Wanneer komt het bestuur bijeen om de proefbeslissing te bekrachtigen?",
    actualiteitsbeleid: "alleen_actueel",
    semantisch: true,
    driveZoektermen: ["bijeenkomst proefbeslissing"],
    microsoftZoektermen: ["wanneer bekrachtigt het bestuur de proefbeslissing"],
    copilotVraag: "Wanneer komt het bestuur bijeen om de proefbeslissing te bekrachtigen?",
    verwachteFixtures: ["PGB407-DOC-102"],
    primaireFixture: "PGB407-DOC-102",
  },
} as const satisfies Record<string, Omit<SpikeVraag, "verwachteFixtures"> & { verwachteFixtures: readonly string[] }>;

export type VergelijkScenario = keyof typeof VERGELIJK_SCENARIOS;
export const VERGELIJK_SCENARIO_CODES = Object.keys(VERGELIJK_SCENARIOS) as VergelijkScenario[];
export const SEMANTISCHE_SCENARIO_CODES = VERGELIJK_SCENARIO_CODES.filter(
  (code) => vergelijkScenario(code).semantisch === true,
);

/** Levert een muteerbare kopie; de vaste set zelf blijft onaantastbaar. */
export function vergelijkScenario(code: VergelijkScenario): SpikeVraag {
  const scenario = VERGELIJK_SCENARIOS[code];
  return {
    ...scenario,
    driveZoektermen: [...scenario.driveZoektermen],
    microsoftZoektermen: [...scenario.microsoftZoektermen],
    verwachteFixtures: [...scenario.verwachteFixtures],
  };
}
