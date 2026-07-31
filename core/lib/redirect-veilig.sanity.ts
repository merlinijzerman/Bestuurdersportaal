// ============================================================
//  Sanity-tests voor veiligVervolgpad (reviewbevinding H-03).
//
//  Naast de vormcheck verifiëren we het ECHTE gedrag: `${origin}${next}`
//  door de WHATWG-URL-parser halen (dezelfde die NextResponse.redirect
//  gebruikt) en vaststellen dat de host onveranderd blijft. Zo bewijst deze
//  suite niet alleen dat de filter werkt, maar ook waaróm hij nodig was.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/redirect-veilig.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { veiligVervolgpad } from "./redirect-veilig";

const ORIGIN = "https://portaal.fonds.nl";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

/** Host van de URL die de route feitelijk zou opbouwen. */
function hostNa(next: string | null): string {
  return new URL(`${ORIGIN}${veiligVervolgpad(next)}`).host;
}

console.log("redirect-veilig sanity-tests:");

// ── Aanvalsvarianten uit de bevinding ──────────────────────────────────────
test("userinfo-truc @evil.com wordt geweigerd", () => {
  assert.equal(veiligVervolgpad("@evil.com/pad"), "/");
  assert.equal(hostNa("@evil.com/pad"), "portaal.fonds.nl");
});

test("suffix-truc .evil.com wordt geweigerd", () => {
  assert.equal(veiligVervolgpad(".evil.com"), "/");
  assert.equal(hostNa(".evil.com"), "portaal.fonds.nl");
});

test("protocol-relatief //evil.com wordt geweigerd", () => {
  assert.equal(veiligVervolgpad("//evil.com"), "/");
  assert.equal(hostNa("//evil.com"), "portaal.fonds.nl");
});

test("backslash-variant /\\evil.com wordt geweigerd", () => {
  assert.equal(veiligVervolgpad("/\\evil.com"), "/");
  assert.equal(hostNa("/\\evil.com"), "portaal.fonds.nl");
});

test("absolute URL wordt geweigerd", () => {
  assert.equal(veiligVervolgpad("https://evil.com"), "/");
  assert.equal(veiligVervolgpad("http://evil.com"), "/");
});

test("javascript:-schema wordt geweigerd", () => {
  assert.equal(veiligVervolgpad("javascript:alert(1)"), "/");
});

test("CR/LF (headerinjectie) wordt geweigerd", () => {
  assert.equal(veiligVervolgpad("/pad\r\nLocation: https://evil.com"), "/");
  assert.equal(veiligVervolgpad("/pad\nX: 1"), "/");
});

test("leeg, null en undefined vallen terug op /", () => {
  assert.equal(veiligVervolgpad(null), "/");
  assert.equal(veiligVervolgpad(undefined), "/");
  assert.equal(veiligVervolgpad(""), "/");
});

// ── Regressie: legitieme paden blijven werken ──────────────────────────────
test("gewoon pad blijft behouden", () => {
  assert.equal(veiligVervolgpad("/procedures/123"), "/procedures/123");
  assert.equal(hostNa("/procedures/123"), "portaal.fonds.nl");
});

test("pad met querystring en fragment blijft behouden", () => {
  assert.equal(
    veiligVervolgpad("/vergaderingen/abc?tab=agenda#punt-2"),
    "/vergaderingen/abc?tab=agenda#punt-2"
  );
});

test("root blijft root", () => {
  assert.equal(veiligVervolgpad("/"), "/");
});

console.log(`\n${n} sanity-tests geslaagd (redirect-veilig).`);
