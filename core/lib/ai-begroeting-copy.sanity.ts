// ============================================================================
//  Copy-pin voor de AI-begroeting (T5 C1) — de EVAL-CHECK voor C1.
// ----------------------------------------------------------------------------
//  C1 verwijderde de zin "Elke vraag wordt vastgelegd in de Governance Log,
//  inclusief welke bron is gebruikt." uit de BEGROETING en verving die door een
//  algemene AI-vermelding. De AVG-transparantie mag daardoor niet stilzwijgend
//  verdwijnen: ze is elders geborgd (de tooltip op de "Governance logging
//  actief"-badge). Deze pin bewaakt beide kanten tegelijk, zodat een latere
//  copy-wijziging die de transparantie wegneemt zichtbaar rood wordt.
//
//  Bewust een BRON-assertie (leest de component-tekst): de begroeting wordt inline
//  in AssistentClient.tsx opgebouwd uit groet/voornaam/fondsnaam en is geen pure
//  functie. Uitvoeren: npx tsx core/lib/ai-begroeting-copy.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("ai-begroeting-copy sanity-tests:");

const BRON = readFileSync("app/(dashboard)/ai/_components/AssistentClient.tsx", "utf8");

const AI_VERMELDING =
  "U spreekt hier met een AI-assistent; controleer belangrijke informatie altijd bij de vermelde bron.";
const LOG_ZIN =
  "Elke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt.";

check("de begroeting draagt de AI-vermelding (statisch + gepersonaliseerd)", () => {
  const aantal = BRON.split(AI_VERMELDING).length - 1;
  assert.ok(aantal >= 2, `verwacht de AI-vermelding ≥2× (was ${aantal}×)`);
});

check("de begroetingsregels dragen niet langer de Governance-Log-zin", () => {
  // Elke regel die de begroeting opbouwt bevat "Ik help u graag met vragen rondom"
  // of de statische welkomsttekst; geen daarvan mag nog naar de Governance Log
  // verwijzen (die transparantie is naar de badge-tooltip verplaatst).
  const begroetingsRegels = BRON.split("\n").filter(
    (r) =>
      r.includes("Ik help u graag met vragen rondom") ||
      r.includes("Welkom terug. Ik ben uw AI-assistent")
  );
  assert.ok(begroetingsRegels.length >= 2, "begroetingsregels niet gevonden");
  for (const r of begroetingsRegels) {
    assert.ok(!r.includes("Governance Log"), `begroeting verwijst nog naar de log: ${r.trim()}`);
  }
});

check("de AVG-transparantie is geborgd in de badge-tooltip (title-attribuut)", () => {
  // De volledige transparantiezin blijft bestaan — nu als tooltip op de
  // permanente "Governance logging actief"-badge, zodat ze niet verdwijnt.
  assert.ok(BRON.includes(LOG_ZIN), "de transparantiezin is nergens meer aanwezig");
  assert.ok(
    BRON.includes(`title="${LOG_ZIN}"`),
    "de transparantiezin staat niet als tooltip (title) op de badge"
  );
  assert.ok(BRON.includes("Governance logging actief"), "de badge zelf ontbreekt");
});

console.log(`\n${n} sanity-tests geslaagd.`);
