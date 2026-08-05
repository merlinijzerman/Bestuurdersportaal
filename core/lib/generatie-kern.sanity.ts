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
  TOON_BLOK_BUREAU,
  NIEUW_ROL_GEDRAG,
  NIEUW_STRUCTUUR,
  NIEUW_TOON,
  SP_SPARRING_REGELS,
  SP_REFLECTIE_REGELS,
  SP_REFLECTIE_CONCEPT_REGELS,
  SP_DOCUMENTEN_REGELS,
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
//
// BIJGEWERKT 31-07-2026 (reviewronde R1). Deze test stond sinds 15-07-2026 rood
// zonder dat iemand het zag, en omdat `npm run sanity` bij de eerste rode stopt
// (`|| exit 1`) hebben ALLE suites na deze — 45 stuks, waaronder pii-gate,
// rate-limit, tenant-enforce, rag-fondsdiscipline en platform-wrapper — twee
// weken lang niet gedraaid. Twee oorzaken, beide legitieme wijzigingen waarvan
// alleen de pin niet is bijgewerkt:
//
//   1. commit 00b8d68 "Opus 4.8 assistent" (15-07-2026) verving in
//      NIEUW_STRUCTUUR het verplichte "Antwoordstatus: <X>"-label door lopende
//      tekst. Bewuste inhoudelijke keuze → hash bijgewerkt.
//   2. dezelfde en latere commits verhoogden AI_MODEL/MAX_TOKENS. Zie de
//      parity-test onderaan; ook daar zijn de waarden bijgewerkt.
//
// De R1-wijziging aan generatie-kern.ts (SP_BRON_VERTROUWEN, H-10) raakt géén
// van deze hashes: dat blok wordt pas aan `regels` geplakt wanneer er bronnen in
// de prompt zitten, en de gepinde assemblages roepen bouwStatischeInstructies
// rechtstreeks aan. Gecontroleerd: alleen NIEUW_STRUCTUUR kantelt.
const PIN = {
  TOON_BLOK: "241d3f36844ce4a52b7f0c0bc0c6b0fc1a6b669474b6df3e86e5ce1fbb33af83",
  NIEUW_ROL_GEDRAG: "7bc8d97c2b004ee75eef4f7b3c1f92189888444227127566e458da9768ab0fe4",
  NIEUW_STRUCTUUR: "9ae243d9ac6f4609bcf399b704875d9f207510f7382640fda413b52cb42aff0f",
  NIEUW_TOON: "132afe916deebd1341fd496a41bcb60221fac6b26f2834bb51cedc4a1bc1564a",
  SP_SPARRING_REGELS: "e6aded3c2e569cc83fcfd8b5e63ab6b185f4eb7ad9e0bc0deeb7b84a751c709d",
  VERVOLGVRAGEN_INSTRUCTIE: "c3fc6188b01a6c7c4f9067cbbe64785f6e1fe24ed9260b0766c5fe3ecfb1352b",
  // Plateau B (05-08-2026) — nieuw, additief. Deze twee blokken bepalen of de
  // reflectiefunctie de twijfel van de bestuurder scherper maakt of juist
  // overneemt; ze horen daarom net zo hard vastgepind als de toon-prompt. Ze
  // raken géén van de bestaande hashes: SP_REFLECTIE_* wordt als `regels`
  // meegegeven aan bouwSysteemBlokken en vervangt niets.
  SP_REFLECTIE_REGELS: "b4823c89991bbc49d0e238a58430e3bbfa018bc03b89bd263f52b72dd462593a",
  SP_REFLECTIE_CONCEPT_REGELS: "d39b574a9edb4603ff87d82f17c29549649b2f608e4ad53d1f8fcad2b0c7efbc",
  static_feitelijk_combineren: "720677da5a653ce08bbe08e051dad1c065a8246c7fa9964ef23d1b16e004cb6e",
  static_sparring_combineren: "bf11b83970b44857951fa520b51022b92968f6d59875e975a5665e5120c14118",
  dyn_block: "d6e01afa0bc092b7efbc8701fad58af73808ae3e3ee0c719de20366630f5c4d7",
  // T2 (05-08-2026) — nieuw, additief. De bureau-toonfamilie en haar assemblage.
  // Deze pins raken GEEN van de bestaande hashes: TOON_BLOK_BUREAU is een nieuwe
  // constante en de bureau-assemblage wordt alleen bereikt met bureauToon=true,
  // dat geen enkele bestaande call-site meegeeft. Dat de zeven pins hierboven
  // groen blijven, is exact het nulgrens-bewijs G23/FR-9a.
  TOON_BLOK_BUREAU: "338b8984da6e80f66cdb702887add05256729765c4dc4df6884102a8be32962e",
  static_bureau_documenten: "b5224895a0cd3e4353f7a24417b38c28e213aa429c1892bf04266f543c894beb",
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
  assert.equal(sha(SP_REFLECTIE_REGELS), PIN.SP_REFLECTIE_REGELS);
  assert.equal(sha(SP_REFLECTIE_CONCEPT_REGELS), PIN.SP_REFLECTIE_CONCEPT_REGELS);
});

test("plateau B: de reflectieprompt stuurt niet en diagnosticeert niet", () => {
  // Inhoudelijke vangrails bovenop de hash. De hash zegt "er is iets veranderd";
  // deze test zegt wát er niet mag veranderen. Zonder dit zou een herformulering
  // die de pin netjes bijwerkt de kern stilzwijgend kunnen verschuiven.
  const reflectie = SP_REFLECTIE_REGELS.toLowerCase();

  // Het expliciete verbod op duiden van de twijfel (v1.0 §9.5) staat erin.
  assert.ok(reflectie.includes("diagnosticeert niet"));
  assert.ok(reflectie.includes("u adviseert niet"));
  assert.ok(reflectie.includes("één verdiepingsvraag per beurt"));
  // De drie-deling uit FR-34 staat er letterlijk in.
  assert.ok(reflectie.includes("wat u inbrengt"));
  assert.ok(reflectie.includes("wat al vaststond"));
  assert.ok(reflectie.includes("mogelijke onderzoeksvraag"));
  // FR-55: zonder bronnen geen verzonnen dossiercontext.
  assert.ok(reflectie.includes("verzint geen dossiercontext"));
  // Besluit 0112: het model benoemt de reflectie niet als proces en meet niets.
  assert.ok(reflectie.includes("hoe vaak of hoe goed"));

  // FR-21: het concept voegt geen oordeel of interpretatie toe.
  const concept = SP_REFLECTIE_CONCEPT_REGELS.toLowerCase();
  assert.ok(concept.includes("geen nieuwe interpretatie"));
  assert.ok(concept.includes("geen oordeel"));
  assert.ok(concept.includes("uw reflectie, in concept"));
  // AC-26: de vaste slotzin, die expliciet zegt dat er GEEN aparte notitie komt.
  assert.ok(
    SP_REFLECTIE_CONCEPT_REGELS.includes(
      "Met deze keuze wordt geen afzonderlijke reflectienotitie aangemaakt."
    )
  );
  // En geen van de verboden labels uit besluit 0113 sluipt via de prompt binnen.
  for (const verboden of ["niet opslaan", "niets bewaren", "alleen voor mij bewaren"]) {
    assert.equal(reflectie.includes(verboden), false, verboden);
    assert.equal(concept.includes(verboden), false, verboden);
  }
});

test("T2 bureau-toon: TOON_BLOK_BUREAU + assemblage gepind, en nulgrens intact", () => {
  // De nieuwe toonfamilie is gepind ...
  assert.equal(sha(TOON_BLOK_BUREAU), PIN.TOON_BLOK_BUREAU, "TOON_BLOK_BUREAU is gewijzigd");
  assert.equal(
    sha(bouwStatischeInstructies(SP_DOCUMENTEN_REGELS, "feitelijk", true)),
    PIN.static_bureau_documenten
  );
  // ... en de bureau-assemblage eindigt op TOON_BLOK_BUREAU i.p.v. TOON_BLOK.
  assert.equal(
    bouwStatischeInstructies(SP_DOCUMENTEN_REGELS, "feitelijk", true),
    `${SP_DOCUMENTEN_REGELS}\n\n${TOON_BLOK_BUREAU}`
  );
  // NULGRENS (G23): met bureauToon weggelaten óf false is de uitvoer identiek aan
  // voorheen — TOON_BLOK, niet de bureau-variant. Zo kan de vlag het gedrag van
  // bestaande rollen niet raken.
  assert.equal(
    bouwStatischeInstructies(SP_DOCUMENTEN_REGELS, "feitelijk", false),
    bouwStatischeInstructies(SP_DOCUMENTEN_REGELS, "feitelijk")
  );
  assert.equal(
    bouwStatischeInstructies(SP_DOCUMENTEN_REGELS, "feitelijk"),
    `${SP_DOCUMENTEN_REGELS}\n\n${TOON_BLOK}`
  );
  // bureauToon WINT van elke andere toon, ongeacht de modus én ongeacht de
  // globale BESTUURLIJKE_STIJL-vlag (die anders bovenaan zou kortsluiten en
  // TOON_BLOK_BUREAU stil zou verdringen). De bureau-taak forceert 'feitelijk',
  // maar het invariant moet hard zijn: bureauToon ⇒ regels + TOON_BLOK_BUREAU.
  for (const m of ["feitelijk", "sparring", "duiding"] as const) {
    assert.equal(
      bouwStatischeInstructies(SP_COMBINEREN_REGELS, m, true),
      `${SP_COMBINEREN_REGELS}\n\n${TOON_BLOK_BUREAU}`,
      `bureauToon=true moet TOON_BLOK_BUREAU geven, ook bij modus ${m}`
    );
  }
});

test("T2 bureau-toon: register gelijk, maar koppen-norm + expliciete slotafsluiting", () => {
  const b = TOON_BLOK_BUREAU;
  const lower = b.toLowerCase();
  // Register ongewijzigd: u-vorm, geen ambtelijke floskels.
  assert.ok(lower.includes('spreek met "u"'));
  assert.ok(lower.includes("hierbij delen wij u mede"));
  // De drie afwijkingen van de bestuurdersstand (ontwerp §6.1).
  assert.ok(lower.includes("koppen is hier de norm"));
  assert.ok(lower.includes("concept"));
  assert.ok(lower.includes("aannames en open punten"));
  // De verruiming: voorstel van het bureau, nooit als besluit/eigen oordeel.
  assert.ok(lower.includes("voorstel ván het bureau áán het bestuur"));
  assert.ok(lower.includes("nooit als besluit"));
  // Anti-fabricage blijft expliciet.
  assert.ok(lower.includes("verzin niets"));
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
  // Bijgewerkt 31-07-2026. De oude pins (claude-sonnet-4-6 / 3200 / 4500) waren
  // achterhaald sinds commit 00b8d68 (15-07-2026) en latere budgetverhogingen.
  // Ze zijn nooit gevallen omdat de test al eerder in het bestand afbrak.
  //
  // AI_MODEL is sinds 00b8d68 overschrijfbaar via een env-var (A/B-testen en
  // terugschakelen). De pin toetst daarom de INGEBOUWDE standaard; staat de
  // env-var, dan zegt deze test niets over productie en melden we dat expliciet
  // in plaats van stilzwijgend te slagen.
  if (process.env.AI_MODEL) {
    console.log(
      `    ⚠ AI_MODEL is overschreven via env (${process.env.AI_MODEL}) — modelpin niet getoetst.`
    );
  } else {
    assert.equal(AI_MODEL, "claude-opus-4-8");
  }
  assert.equal(MAX_TOKENS, 5000);
  assert.equal(MAX_TOKENS_BESTUURLIJK, 8000);
});

console.log(`\n${n} sanity-tests geslaagd.`);
