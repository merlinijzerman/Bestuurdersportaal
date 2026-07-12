// ============================================================
//  Sanity-tests voor de rate-limit venster-/limietberekening (WP2).
//
//  De échte teller draait in Postgres (fn_rate_limit_check, security definer).
//  Die logica is niet pure-TS testbaar, dus we modelleren hier het sliding-
//  window-algoritme 1-op-1 en verifiëren het gedrag programmatisch — een
//  executable specificatie van wat de SQL moet doen. Wijkt de SQL af, dan
//  klopt dit model niet meer met de DB en moeten beide gelijk worden getrokken.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/rate-limit.sanity.ts
// ============================================================

import assert from "node:assert/strict";

type Beslissing = { toegestaan: boolean; resterend: number; resetAt: number | null };

// Referentie-implementatie van fn_rate_limit_check, zonder DB.
//   events  : timestamps (ms) van eerder geregistreerde requests
//   nu      : "now()" in ms
//   limiet  : max requests per venster
//   vensterMs: venstergrootte in ms
// Muteert `events` zoals de SQL de tabel muteert (prune + insert bij toestaan).
function check(
  events: number[],
  nu: number,
  limiet: number,
  vensterMs: number
): Beslissing {
  // 1. Snoei verlopen events (< nu - venster).
  const grens = nu - vensterMs;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i] < grens) events.splice(i, 1);
  }
  // 2. Tel resterende events; bepaal oudste.
  const aantal = events.length;
  const oudste = aantal > 0 ? Math.min(...events) : nu;
  // 3. Beslis.
  if (aantal >= limiet) {
    return { toegestaan: false, resterend: 0, resetAt: oudste + vensterMs };
  }
  events.push(nu); // registreer het toegestane request
  return { toegestaan: true, resterend: limiet - aantal - 1, resetAt: oudste + vensterMs };
}

const MIN = 60_000;
let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("rate-limit sanity-tests:");

test("eerste request binnen leeg venster is toegestaan", () => {
  const events: number[] = [];
  const r = check(events, 1000, 20, 5 * MIN);
  assert.equal(r.toegestaan, true);
  assert.equal(r.resterend, 19);
  assert.equal(events.length, 1);
});

test("21e request binnen 5 min wordt geweigerd (chat-limiet 20)", () => {
  let events: number[] = [];
  let t = 0;
  for (let i = 0; i < 20; i++) {
    t += 1000; // 20 requests verspreid over <5 min
    const r = check(events, t, 20, 5 * MIN);
    assert.equal(r.toegestaan, true, `request ${i + 1} hoort toegestaan`);
  }
  assert.equal(events.length, 20);
  const r21 = check(events, t + 1000, 20, 5 * MIN);
  assert.equal(r21.toegestaan, false);
  assert.equal(r21.resterend, 0);
  // Teller groeit niet bij een geweigerd request.
  assert.equal(events.length, 20);
});

test("resterend telt correct af", () => {
  const events: number[] = [];
  assert.equal(check(events, 1, 3, MIN).resterend, 2);
  assert.equal(check(events, 2, 3, MIN).resterend, 1);
  assert.equal(check(events, 3, 3, MIN).resterend, 0);
  assert.equal(check(events, 4, 3, MIN).toegestaan, false);
});

test("na verstrijken venster komt budget weer vrij (sliding window)", () => {
  const events: number[] = [];
  // Vul de limiet op t=0..2 (limiet 3, venster 1 min).
  check(events, 0, 3, MIN);
  check(events, 1000, 3, MIN);
  check(events, 2000, 3, MIN);
  // Net binnen het venster → geweigerd.
  assert.equal(check(events, 30_000, 3, MIN).toegestaan, false);
  // Ruim na het venster van het oudste event → eerste schuift eruit, weer ruimte.
  const r = check(events, 61_000, 3, MIN);
  assert.equal(r.toegestaan, true);
});

test("reset_at = oudste event in venster + venster", () => {
  const events: number[] = [];
  const start = 100_000;
  check(events, start, 2, 5 * MIN); // oudste = start
  check(events, start + 10_000, 2, 5 * MIN);
  const r = check(events, start + 20_000, 2, 5 * MIN); // geweigerd
  assert.equal(r.toegestaan, false);
  assert.equal(r.resetAt, start + 5 * MIN);
});

test("verlopen events worden gesnoeid zodat ze niet meetellen", () => {
  const events: number[] = [0, 1000, 2000]; // alle ruim ouder dan het venster
  const r = check(events, 10 * MIN, 3, MIN);
  // Alle drie verlopen → gesnoeid → nieuw request toegestaan, teller = 1.
  assert.equal(r.toegestaan, true);
  assert.equal(events.length, 1);
});

console.log(`\n${n} sanity-tests geslaagd.`);
