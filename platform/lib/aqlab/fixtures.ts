// lib/aqlab/fixtures.ts
// -----------------------------------------------------------------------------
// AQLab — synthetische fixture-teksten (AQL-2). De canonieke fixture-inhoud
// leeft in ai-quality-lab/AQLAB-HORIZON-FIXTURES-v0.2.md (dezelfde bron als de
// seed). De orchestrator resolvet per testcase de required fixtures naar hun
// canonieke tekst; de titels komen uit aqlab_fixture_documents.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCanonical } from "./seed/canonical";

const FIXTURES_MD = join(process.cwd(), "ai-quality-lab", "AQLAB-HORIZON-FIXTURES-v0.2.md");

let cache: Record<string, string> | null = null;

/** Canonieke fixture-teksten keyed op fixture_id (gecachet per proces). */
export function laadFixtureCanoniek(): Record<string, string> {
  if (!cache) {
    cache = extractCanonical(readFileSync(FIXTURES_MD, "utf8"));
  }
  return cache;
}

/** Canonieke tekst voor één fixture_id (of undefined). */
export function fixtureTekst(fixtureId: string): string | undefined {
  return laadFixtureCanoniek()[fixtureId];
}
