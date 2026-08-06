// ============================================================================
//  lib/bronkeuze-modus.sanity.ts — besluit 0137 (antwoord-eerst, herziet 0014).
//  Twee bewijslasten, puur en programmatisch toetsbaar:
//
//   (a) De bronkeuze-modus-resolutie is FAIL-SAFE: een ontbrekende, onbekende of
//       ongeldige vlagwaarde valt terug op 'blokkerend' (het geaccordeerde gedrag),
//       nóóit stil op het nieuwe 'antwoord_eerst'/'uit'. Resolutie-orde:
//       fonds-flag → env-default → 'blokkerend'.
//
//   (b) DEMPENDE EIGENSCHAP 2 (werkopdracht): de bron-INTENTIE stuurt de retrieval
//       NIET. Een antwoord bij 'antwoord_eerst' (intent fonds/ONZEKER, geen override)
//       doorzoekt exact dezelfde bronnen als het antwoord ná een klik op "Voor mijn
//       fonds" (intent fonds/ZEKER via override). Dat bewijzen we door aan te tonen
//       dat de retrieval-bepalende functies (bepaalAutoBronModus, retrievalModusVoorVraag)
//       geen intent-parameter kennen en identiek uitkomen — alleen de framing verschilt.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/bronkeuze-modus.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { resolveBronkeuzeModus, type BronkeuzeModus } from "./fonds-config-core";
import {
  bepaalAutoBronModus,
  bepaalAntwoordmodus,
  retrievalModusVoorVraag,
  bepaalBronIntent,
} from "./vraagtype";

let geslaagd = 0;
const check = (naam: string, cond: boolean) => {
  assert.ok(cond, `FAAL: ${naam}`);
  geslaagd++;
  console.log(`  ✓ ${naam}`);
};

// ── (a) Fail-safe resolutie ─────────────────────────────────────────────────
console.log("bronkeuze-modus — (a) resolutie/fail-safe:\n");

// Geldige fonds-flag wint.
for (const m of ["blokkerend", "antwoord_eerst", "uit"] as BronkeuzeModus[]) {
  check(`geldige flag "${m}" wordt overgenomen`, resolveBronkeuzeModus(m, undefined) === m);
}
// Env-default wanneer de flag ontbreekt/ongeldig is.
check("ontbrekende flag → env-default", resolveBronkeuzeModus(undefined, "antwoord_eerst") === "antwoord_eerst");
check("ongeldige flag → env-default", resolveBronkeuzeModus("waar", "uit") === "uit");
// Fonds-flag heeft voorrang op env.
check("fonds-flag wint van env", resolveBronkeuzeModus("uit", "antwoord_eerst") === "uit");
// Fail-safe naar 'blokkerend' bij elke ongeldige/afwezige combinatie.
const ongeldig: unknown[] = [undefined, null, "", "waar", "aan", "ANTWOORD_EERST", "true", 1, 0, {}, [], true];
for (const v of ongeldig) {
  check(
    `ongeldige waarde ${JSON.stringify(v)} (flag+env) → blokkerend`,
    resolveBronkeuzeModus(v, v) === "blokkerend"
  );
}
// Geen env gezet → default blokkerend (zolang de flag niet expliciet is gezet,
// verandert er niets).
check("geen flag, geen env → blokkerend", resolveBronkeuzeModus(undefined, undefined) === "blokkerend");

// ── (b) Retrieval is intent-invariant (dempende eigenschap 2) ───────────────
// De werkopdracht vraagt te borgen dat de bron-INTENTIE de retrieval niet stuurt:
// een antwoord bij 'antwoord_eerst' (fonds/onzeker) doorzoekt dezelfde bronnen als
// ná een klik "Voor mijn fonds" (fonds/zeker). De route bereikt dat door de retrieval-
// bepalende functies UITSLUITEND uit vraag/antwoordmodus/fondsrestrictie te voeden —
// niet uit de intentie. Dat is een eigenschap van de SIGNATUUR (geen intent-parameter),
// niet van een runtime-vergelijking. We toetsen die eigenschap daarom structureel
// (arity) + we tonen dat de uitkomst wél door de wél-toegestane inputs varieert (zodat
// de arity-check niet alleen een dode constante bewaakt). De route-laag zelf — dat
// bronIntent enkel promptModus/meta/audit voedt — is door de code-review gedekt, niet
// door deze pure suite.
console.log("\nbronkeuze-modus — (b) retrieval intent-invariant (structureel):\n");

// STRUCTUREEL: de retrieval-bepalende functies kennen géén intent-parameter. Zou
// iemand er intent in laten lekken (extra parameter), dan kantelt de arity en faalt
// deze test — precies de regressie die dempende eigenschap 2 zou breken.
check("bepaalAutoBronModus neemt alleen de fondsrestrictie (arity 1, geen intent)", bepaalAutoBronModus.length === 1);
check("retrievalModusVoorVraag neemt alleen antwoordmodus + vraag (arity 2, geen intent)", retrievalModusVoorVraag.length === 2);

// De bronmodus hangt ALLEEN van de fondsrestrictie af (niet van intent): combineren-
// vloer tenzij expliciet tot fondsdocumenten beperkt (besluit 0014, Design A).
check("bronmodus zonder fondsrestrictie = combineren", bepaalAutoBronModus(false) === "combineren");
check("bronmodus mét fondsrestrictie = documenten", bepaalAutoBronModus(true) === "documenten");

// GEDRAG: de retrievalmodus varieert wél met vraag/antwoordmodus — bewijs dat de
// arity-check geen constante bewaakt. Historisch → historisch; voorstel-/conceptvraag
// → besluitvorming; een gewone ankerloze vraag → actueel.
check(
  "historische vraag → retrievalmodus historisch",
  retrievalModusVoorVraag(bepaalAntwoordmodus("Wat was destijds besloten?"), "Wat was destijds besloten?") === "historisch"
);
check(
  "voorstel-/conceptvraag → retrievalmodus besluitvorming",
  retrievalModusVoorVraag("feitelijk", "Welk voorstel ligt er ter besluitvorming?") === "besluitvorming"
);

// De ankerloze twijfelbak-vragen: bij 'antwoord_eerst' loopt de beurt dóór met
// fonds/ONZEKER, en een chipklik verandert ALLEEN de intentie — niet de vraag, de
// antwoordmodus of de fondsrestrictie, de enige inputs die de retrieval consumeert.
// De retrievalmodus is dus per constructie dezelfde vóór en ná de klik. We tonen hier
// dat deze vragen daadwerkelijk in de twijfelbak vallen (anders test het scenario niets)
// en dat hun retrievalmodus uit de wél-toegestane inputs volgt.
const ankerloos = [
  "Hoe zit het met de solidariteitsreserve?",
  "Wat is het beleggingsbeleid?",
  "Hoe werkt de klachtenregeling?",
  "Wat vind je van de dekkingsgraad?",
  "Hoe staat het met het transitieplan?",
];
for (const v of ankerloos) {
  const intent = bepaalBronIntent(v);
  check(`"${v}" valt in de twijfelbak (fonds/onzeker)`, intent.intent === "fonds" && intent.vertrouwen === "onzeker");
  // De retrievalmodus is bepaald uit (antwoordmodus, vraag) — zonder intent. Een
  // chipklik (fonds- óf algemeen-override) laat die inputs ongemoeid; de bronmodus
  // blijft de combineren-vloer (geen harde scope). Deze vraag valt op 'actueel'.
  check(
    `"${v}" — retrievalmodus volgt uit vraag/antwoordmodus (actueel), niet uit intent`,
    retrievalModusVoorVraag(bepaalAntwoordmodus(v), v) === "actueel" && bepaalAutoBronModus(false) === "combineren"
  );
}

console.log(`\n${geslaagd} sanity-checks geslaagd (bronkeuze-modus).`);
