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
//  Bewust een BRON-assertie (leest de component-tekst): de begroeting wordt
//  inline opgebouwd uit groet/voornaam/fondsnaam en is geen pure functie.
//  Uitvoeren: npx tsx core/lib/ai-begroeting-copy.sanity.ts
//
//  P1a (besluit 0201) — de assistent is gesplitst in drie lagen, en de twee
//  helften van deze pin wonen daardoor in verschillende bestanden:
//    - de BEGROETING zelf hoort bij de gesprekslaag (useAssistent.ts): ze wordt
//      uit het profiel opgebouwd en in het eerste bericht gezet;
//    - de BADGE met de transparantie-tooltip is presentatie (AssistentClient).
//  De pin leest ze allebei. Dat hij bij de splitsing rood werd is het bewijs
//  dat hij werkt: hij wees naar een bestand waar de tekst niet meer stond.
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

/** De gesprekslaag: bouwt de begroeting op uit groet, voornaam en fondsnaam. */
const GESPREKSLAAG = readFileSync("core/components/assistent/useAssistent.ts", "utf8");
/** De presentatielaag: draagt de badge met de transparantie-tooltip.
 *  T1 — heette `AssistentClient.tsx` tot het oppervlak de inhoud van het paneel
 *  werd; die naam is nu de /ai-brug en bevat geen copy meer. */
const WEERGAVE = readFileSync(
  "app/(dashboard)/ai/_components/AssistentOppervlak.tsx",
  "utf8"
);

const AI_VERMELDING =
  "U spreekt hier met een AI-assistent; controleer belangrijke informatie altijd bij de vermelde bron.";
const LOG_ZIN =
  "Elke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt.";

check("de begroeting draagt de AI-vermelding (statisch + gepersonaliseerd)", () => {
  const aantal = GESPREKSLAAG.split(AI_VERMELDING).length - 1;
  assert.ok(aantal >= 2, `verwacht de AI-vermelding ≥2× (was ${aantal}×)`);
});

check("de begroetingsregels dragen niet langer de Governance-Log-zin", () => {
  // Elke regel die de begroeting opbouwt bevat "Ik help u graag met vragen rondom"
  // of de statische welkomsttekst; geen daarvan mag nog naar de Governance Log
  // verwijzen (die transparantie is naar de badge-tooltip verplaatst).
  // Beide lagen, niet alleen de gesprekslaag: verschijnt er ooit weer een
  // begroetingsregel in de presentatielaag, dan moet die óók vrij blijven van de
  // Governance-Log-zin. Een negatieve assertie die maar één bestand leest, is
  // precies zo sterk als de aanname dat de tekst nooit terugverhuist.
  const begroetingsRegels = `${GESPREKSLAAG}\n${WEERGAVE}`.split("\n").filter(
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
  assert.ok(
    WEERGAVE.includes(LOG_ZIN),
    "de transparantiezin is nergens meer aanwezig"
  );
  assert.ok(
    WEERGAVE.includes(`title="${LOG_ZIN}"`),
    "de transparantiezin staat niet als tooltip (title) op de badge"
  );
  assert.ok(
    WEERGAVE.includes("Governance logging actief"),
    "de badge zelf ontbreekt"
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
