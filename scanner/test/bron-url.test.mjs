// ============================================================================
//  scanner/test/bron-url.test.mjs — SSRF-testcorpus voor de bron-URL-allowlist.
// ----------------------------------------------------------------------------
//  Draait met `node --test` (patroon van tests/cross-tenant in de hoofdrepo).
//  Elk geval hier hoort te falen VOORDAT er een socket opengaat; de module is
//  zuiver en synchroon, dus dat is per constructie zo.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { beoordeelBronUrl } from "../src/bron-url.mjs";

const CONFIG = {
  supabaseHost: "abc123xyz.supabase.co",
  bucket: "documenten-quarantaine",
};

const GELDIG =
  "https://abc123xyz.supabase.co/storage/v1/object/sign/documenten-quarantaine/" +
  "3f2504e0-4f89-41d3-9a0c-0305e82c3301/9c858901-8a57-4791-81fe-4c455b099bc9.pdf" +
  "?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";

// ── De gelukkige weg ────────────────────────────────────────────────────────

test("geldige signed URL van het juiste project en de juiste bucket wordt toegelaten", () => {
  const r = beoordeelBronUrl(GELDIG, CONFIG);
  assert.equal(r.ok, true);
  assert.equal(r.url.hostname, "abc123xyz.supabase.co");
});

test("hostname wordt hoofdletterongevoelig vergeleken", () => {
  const r = beoordeelBronUrl(GELDIG.replace("abc123xyz", "ABC123XYZ"), CONFIG);
  assert.equal(r.ok, true);
});

// ── Protocol ────────────────────────────────────────────────────────────────

test("http wordt geweigerd", () => {
  const r = beoordeelBronUrl(GELDIG.replace("https://", "http://"), CONFIG);
  assert.deepEqual(r, { ok: false, code: "protocol_niet_https" });
});

for (const schema of ["file:///etc/passwd", "gopher://x/", "ftp://x/", "data:text/plain,x"]) {
  test(`niet-http(s)-schema wordt geweigerd: ${schema}`, () => {
    const r = beoordeelBronUrl(schema, CONFIG);
    assert.equal(r.ok, false);
  });
}

// ── Lokale en interne adressen ──────────────────────────────────────────────

const INTERNE_DOELEN = [
  "https://localhost/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://127.0.0.1/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://[::1]/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://169.254.169.254/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://10.0.0.5/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://192.168.1.1/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://172.16.0.1/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://[fd00::1]/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  // Octale/decimale/hex-notaties van 127.0.0.1 — WHATWG-URL normaliseert deze,
  // waarna de hostname-toets ze vangt. Expliciet vastgelegd omdat juist deze
  // varianten naïeve stringchecks passeren.
  "https://0x7f.1/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://2130706433/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  "https://017700000001/storage/v1/object/sign/documenten-quarantaine/a.pdf",
];

for (const doel of INTERNE_DOELEN) {
  test(`intern/lokaal doel wordt geweigerd: ${doel.slice(0, 48)}`, () => {
    const r = beoordeelBronUrl(doel, CONFIG);
    assert.equal(r.ok, false, `verwachtte weigering voor ${doel}`);
    assert.ok(
      ["hostname_niet_toegestaan", "ip_literal", "url_onparseerbaar"].includes(r.code),
      `onverwachte foutcode ${r.code}`
    );
  });
}

// ── Hostname-verwarring ─────────────────────────────────────────────────────

const VERKEERDE_HOSTS = [
  // suffix-aanval: eigen domein als subdomein van de aanvaller
  "https://abc123xyz.supabase.co.aanvaller.nl/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  // prefix-aanval
  "https://kwaadaardig-abc123xyz.supabase.co/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  // ander Supabase-project
  "https://ander999.supabase.co/storage/v1/object/sign/documenten-quarantaine/a.pdf",
  // hoofddomein
  "https://supabase.co/storage/v1/object/sign/documenten-quarantaine/a.pdf",
];

for (const host of VERKEERDE_HOSTS) {
  test(`afwijkend hostname wordt geweigerd: ${new URL(host).hostname}`, () => {
    const r = beoordeelBronUrl(host, CONFIG);
    assert.deepEqual(r, { ok: false, code: "hostname_niet_toegestaan" });
  });
}

// ── Credentials, fragment, poort ────────────────────────────────────────────

test("username/password in de URL wordt geweigerd", () => {
  const r = beoordeelBronUrl(
    GELDIG.replace("https://", "https://gebruiker:geheim@"),
    CONFIG
  );
  assert.deepEqual(r, { ok: false, code: "credentials_in_url" });
});

test("fragment wordt geweigerd", () => {
  const r = beoordeelBronUrl(`${GELDIG}#deel`, CONFIG);
  assert.deepEqual(r, { ok: false, code: "fragment_in_url" });
});

test("afwijkende poort wordt geweigerd", () => {
  const r = beoordeelBronUrl(
    GELDIG.replace("supabase.co", "supabase.co:8443"),
    CONFIG
  );
  assert.deepEqual(r, { ok: false, code: "poort_niet_toegestaan" });
});

test("expliciete poort 443 is toegestaan (parser maakt hem leeg)", () => {
  const r = beoordeelBronUrl(GELDIG.replace("supabase.co", "supabase.co:443"), CONFIG);
  assert.equal(r.ok, true);
});

// ── Pad en bucket ───────────────────────────────────────────────────────────

const VERKEERDE_PADEN = [
  // andere bucket
  "https://abc123xyz.supabase.co/storage/v1/object/sign/documenten/a.pdf",
  // publieke in plaats van signed zone
  "https://abc123xyz.supabase.co/storage/v1/object/public/documenten-quarantaine/a.pdf",
  // authenticated zone
  "https://abc123xyz.supabase.co/storage/v1/object/authenticated/documenten-quarantaine/a.pdf",
  // heel andere API
  "https://abc123xyz.supabase.co/rest/v1/documenten?select=*",
  "https://abc123xyz.supabase.co/auth/v1/admin/users",
  // bucketnaam als prefix van een andere bucket
  "https://abc123xyz.supabase.co/storage/v1/object/sign/documenten-quarantaine-oud/a.pdf",
];

for (const pad of VERKEERDE_PADEN) {
  test(`afwijkend pad wordt geweigerd: ${new URL(pad).pathname.slice(0, 56)}`, () => {
    const r = beoordeelBronUrl(pad, CONFIG);
    assert.deepEqual(r, { ok: false, code: "pad_niet_toegestaan" });
  });
}

// ── Traversal in al zijn coderingen ─────────────────────────────────────────
//  Twee verschillende mechanismen vangen deze gevallen, en dat onderscheid is
//  bewust vastgelegd zodat een latere wijziging aan één van beide zichtbaar
//  wordt in de tests:
//   - vormen die de WHATWG-parser zelf collapst (`..`, `%2e%2e`, `.%2e`)
//     verlaten de vereiste prefix → `pad_niet_toegestaan`;
//   - vormen die de parser laat staan (`..%2f`, `%5c`, dubbel-encoded
//     `%252e%252e`) behouden de prefix maar sneuvelen op de vormtoets van de
//     objectsleutel → `objectsleutel_ongeldig`.

const PREFIX =
  "https://abc123xyz.supabase.co/storage/v1/object/sign/documenten-quarantaine/";

for (const [naam, staart, verwacht] of [
  ["kale traversal", "../../documenten/geheim.pdf", "pad_niet_toegestaan"],
  ["percent-encoded traversal", "%2e%2e/%2e%2e/documenten/geheim.pdf", "pad_niet_toegestaan"],
  ["gemengd gecodeerde punt", ".%2e/geheim.pdf", "pad_niet_toegestaan"],
  ["encoded slash", "..%2f..%2fdocumenten/geheim.pdf", "objectsleutel_ongeldig"],
  ["encoded backslash", "%5c..%5cdocumenten%5cgeheim.pdf", "objectsleutel_ongeldig"],
  ["dubbel-encoded traversal", "%252e%252e/geheim.pdf", "objectsleutel_ongeldig"],
]) {
  test(`traversal wordt geweigerd — ${naam}`, () => {
    const r = beoordeelBronUrl(PREFIX + staart, CONFIG);
    assert.deepEqual(r, { ok: false, code: verwacht });
  });
}

// ── Vormtoets op de objectsleutel ───────────────────────────────────────────

for (const [naam, sleutel] of [
  ["vrije bestandsnaam", "willekeurig.pdf"],
  ["geen extensie", "3f2504e0-4f89-41d3-9a0c-0305e82c3301/9c858901-8a57-4791-81fe-4c455b099bc9"],
  ["niet-toegestane extensie", "3f2504e0-4f89-41d3-9a0c-0305e82c3301/9c858901-8a57-4791-81fe-4c455b099bc9.docm"],
  ["te diep genest", "3f2504e0-4f89-41d3-9a0c-0305e82c3301/sub/9c858901-8a57-4791-81fe-4c455b099bc9.pdf"],
  ["geen uuid als map", "fonds-1/9c858901-8a57-4791-81fe-4c455b099bc9.pdf"],
  ["lege sleutel", ""],
]) {
  test(`objectsleutel buiten het vaste patroon wordt geweigerd — ${naam}`, () => {
    const r = beoordeelBronUrl(PREFIX + sleutel, CONFIG);
    assert.deepEqual(r, { ok: false, code: "objectsleutel_ongeldig" });
  });
}

test("generiek-pad van de platformcuratie is toegestaan", () => {
  const r = beoordeelBronUrl(
    `${PREFIX}generiek/9c858901-8a57-4791-81fe-4c455b099bc9.pptx?token=abc.def.ghi`,
    CONFIG
  );
  assert.equal(r.ok, true);
});

// ── Vormfouten ──────────────────────────────────────────────────────────────

for (const [naam, invoer] of [
  ["lege string", ""],
  ["null", null],
  ["getal", 42],
  ["object", {}],
  ["onzin", "niet eens een url"],
  ["alleen schema", "https://"],
]) {
  test(`onparseerbare invoer wordt geweigerd: ${naam}`, () => {
    const r = beoordeelBronUrl(invoer, CONFIG);
    assert.equal(r.ok, false);
    assert.equal(r.code, "url_onparseerbaar");
  });
}

test("absurd lange URL wordt geweigerd vóór ontleding", () => {
  const r = beoordeelBronUrl(`${GELDIG}${"a".repeat(4096)}`, CONFIG);
  assert.deepEqual(r, { ok: false, code: "url_te_lang" });
});
