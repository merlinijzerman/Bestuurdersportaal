// ============================================================
//  Sanity-tests voor lib/generatie-kern.ts (AQL-2 / spike 1).
//
//  PARITY-BEWIJS: de generatiekern (toon-systeemprompt, per-modus regels,
//  system-prompt-builders) is uit app/api/chat/route.ts geëxtraheerd zonder de
//  wóórdinhoud of de assemblage te veranderen. Deze test bevriest de kern met
//  sha256-snapshots: elke onbedoelde wijziging aan TOON_BLOK, de bestuurlijke/
//  sparring-varianten of de builder-assemblage laat een hash kantelen en dwingt
//  een bewuste keuze af (CLAUDE.md: toon-prompt niet zomaar herschrijven).
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/generatie-kern.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  TOON_BLOK,
  NIEUW_ROL_GEDRAG,
  NIEUW_STRUCTUUR,
  NIEUW_TOON,
  SP_SPARRING_REGELS,
  VERVOLGVRAGEN_INSTRUCTIE,
  VERVOLGVRAGEN_MARKER,
  SP_COMBINEREN_REGELS,
  splitsVervolgvragen,
  bouwStatischeInstructies,
  bouwDynamischeContext,
  bouwSysteemBlokken,
  AI_MODEL,
  MAX_TOKENS,
  MAX_TOKENS_BESTUURLIJK,
  type BestuurderContext,
} from "./generatie-kern";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("generatie-kern sanity-tests:");

// ── Gepinde snapshots — GEVROREN toon-/instructieblokken ────────────────────
// Wijzigt een van deze hashes, dan is de kostbare toon-prompt of de assemblage
// veranderd. Verifieer dat dit BEWUST is en werk pas dan de pin bij.
const PIN = {
  TOON_BLOK: "241d3f36844ce4a52b7f0c0bc0c6b0fc1a6b669474b6df3e86e5ce1fbb33af83",
  NIEUW_ROL_GEDRAG: "7bc8d97c2b004ee75eef4f7b3c1f92189888444227127566e458da9768ab0fe4",
  NIEUW_STRUCTUUR: "c85e5a9ded79ce1b4f1cb6290c539dc311aa4e8f570f85858c089d460f3d0c53",
  NIEUW_TOON: "132afe916deebd1341fd496a41bcb60221fac6b26f2834bb51cedc4a1bc1564a",
  SP_SPARRING_REGELS: "e6aded3c2e569cc83fcfd8b5e63ab6b185f4eb7ad9e0bc0deeb7b84a751c709d",
  VERVOLGVRAGEN_INSTRUCTIE: "c3fc6188b01a6c7c4f9067cbbe64785f6e1fe24ed9260b0766c5fe3ecfb1352b",
  static_feitelijk_combineren: "720677da5a653ce08bbe08e051dad1c065a8246c7fa9964ef23d1b16e004cb6e",
  static_sparring_combineren: "bf11b83970b44857951fa520b51022b92968f6d59875e975a5665e5120c14118",
  dyn_block: "d6e01afa0bc092b7efbc8701fad58af73808ae3e3ee0c719de20366630f5c4d7",
} as const;

const CTX: BestuurderContext = {
  voornaam: "Jan",
  volledigeNaam: "Jan de Vries",
  rolLabel: "voorzitter van het bestuur",
  fondsnaam: "Stichting Pensioenfonds Horizon",
};

test("toon-/instructieblokken byte-identiek aan gepinde snapshot", () => {
  assert.equal(sha(TOON_BLOK), PIN.TOON_BLOK, "TOON_BLOK is gewijzigd");
  assert.equal(sha(NIEUW_ROL_GEDRAG), PIN.NIEUW_ROL_GEDRAG);
  assert.equal(sha(NIEUW_STRUCTUUR), PIN.NIEUW_STRUCTUUR);
  assert.equal(sha(NIEUW_TOON), PIN.NIEUW_TOON);
  assert.equal(sha(SP_SPARRING_REGELS), PIN.SP_SPARRING_REGELS);
  assert.equal(sha(VERVOLGVRAGEN_INSTRUCTIE), PIN.VERVOLGVRAGEN_INSTRUCTIE);
});

test("bouwStatischeInstructies-assemblage byte-identiek (feitelijk + sparring)", () => {
  assert.equal(
    sha(bouwStatischeInstructies(SP_COMBINEREN_REGELS, "feitelijk")),
    PIN.static_feitelijk_combineren
  );
  assert.equal(
    sha(bouwStatischeInstructies(SP_COMBINEREN_REGELS, "sparring")),
    PIN.static_sparring_combineren
  );
  // Default-modus (geen arg) = feitelijk.
  assert.equal(
    bouwStatischeInstructies(SP_COMBINEREN_REGELS),
    bouwStatischeInstructies(SP_COMBINEREN_REGELS, "feitelijk")
  );
});

test("feitelijke modus eindigt exact op TOON_BLOK (regels + \\n\\n + toon)", () => {
  const statisch = bouwStatischeInstructies(SP_COMBINEREN_REGELS, "feitelijk");
  assert.equal(statisch, `${SP_COMBINEREN_REGELS}\n\n${TOON_BLOK}`);
});

test("bouwSysteemBlokken: 2 blokken, statisch gecachet (ephemeral) + dynamisch ongecachet", () => {
  const blokken = bouwSysteemBlokken(SP_COMBINEREN_REGELS, CTX, "feitelijk");
  assert.equal(blokken.length, 2);
  assert.equal(blokken[0].type, "text");
  assert.deepEqual(blokken[0].cache_control, { type: "ephemeral" });
  // Het dynamische blok draagt GEEN cache-breakpoint (blijft ongecachet).
  assert.equal(blokken[1].cache_control, undefined);
  // Statisch blok == de bouwStatischeInstructies-uitvoer.
  assert.equal(blokken[0].text, bouwStatischeInstructies(SP_COMBINEREN_REGELS, "feitelijk"));
  assert.equal(sha(blokken[1].text), PIN.dyn_block);
});

test("dynamisch blok bevat naam/rol/fondsnaam en géén profiel/organisatie zonder opgave", () => {
  const dyn = bouwDynamischeContext(CTX);
  assert.match(dyn, /Jan de Vries/);
  assert.match(dyn, /voorzitter van het bestuur/);
  assert.match(dyn, /Stichting Pensioenfonds Horizon/);
  assert.equal(dyn.includes("undefined"), false);
});

test("dynamisch blok voegt organisatieprofiel + profielsturing toe wanneer aanwezig", () => {
  const dyn = bouwDynamischeContext({
    ...CTX,
    organisatieprofiel: "ORGBLOK",
    profielsturing: "STURINGBLOK",
  });
  assert.match(dyn, /ORGBLOK/);
  assert.match(dyn, /STURINGBLOK/);
  // Volgorde: basis → organisatieprofiel → profielsturing.
  assert.ok(dyn.indexOf("ORGBLOK") < dyn.indexOf("STURINGBLOK"));
});

test("splitsVervolgvragen: knipt marker-tail, parset maximaal 3 vragen", () => {
  const geen = splitsVervolgvragen("Alleen een antwoord, geen marker.");
  assert.equal(geen.vervolgvragen.length, 0);
  assert.equal(geen.zichtbaar, "Alleen een antwoord, geen marker.");

  const met = splitsVervolgvragen(
    `Zichtbaar antwoord.\n${VERVOLGVRAGEN_MARKER}\n- Vraag een?\n- Vraag twee?\n- Vraag drie?\n- Vraag vier?`
  );
  assert.equal(met.zichtbaar, "Zichtbaar antwoord.");
  assert.equal(met.vervolgvragen.length, 3);
  assert.equal(met.vervolgvragen[0], "Vraag een?");
  // De marker mag nooit in het zichtbare antwoord lekken.
  assert.equal(met.zichtbaar.includes(VERVOLGVRAGEN_MARKER), false);
});

test("model-/budgetconstanten zijn de productiewaarden (parity)", () => {
  assert.equal(AI_MODEL, "claude-sonnet-4-6");
  assert.equal(MAX_TOKENS, 3200);
  assert.equal(MAX_TOKENS_BESTUURLIJK, 4500);
});

console.log(`\n${n} sanity-tests geslaagd.`);
