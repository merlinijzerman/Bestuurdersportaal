import assert from "node:assert/strict";
import test from "node:test";
import { amrUitAccessToken, beoordeelBindingGuard, sessieIsOAuth } from "./microsoft-login-sessieguard-core";
import {
  clientIpUitHeaders,
  maakVensterLimiter,
  MICROSOFT_LOGIN_START_LIMIET,
  startSleutel,
} from "./microsoft-login-ratelimit-core";
import {
  LOGIN_MICROSOFT_MELDING,
  MICROSOFT_LOGIN_FOUTCATEGORIEEN,
  MicrosoftLoginError,
  microsoftLoginFoutcategorie,
  PROFIEL_MICROSOFT_LOGIN_MELDINGEN,
  profielCodeVoor,
  supportcode,
  VERBODEN_MELDINGWOORDEN,
} from "./microsoft-login-error-core";

// De echte MicrosoftLoginGatewayError leeft in de server-only gateway (T1) en is
// hier niet importeerbaar; de categorisering kijkt uitsluitend naar `.categorie`.
const gatewayFout = (categorie: string) => Object.assign(new Error(categorie), { categorie });

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (payload: unknown) => `${b64u({ alg: "HS256" })}.${b64u(payload)}.sig`;

// ── sessieguard ─────────────────────────────────────────────────────────────

test("amr: objectvorm en stringvorm; onleesbaar → leeg", () => {
  assert.deepEqual(amrUitAccessToken(token({ amr: [{ method: "password", timestamp: 1 }] })), ["password"]);
  assert.deepEqual(amrUitAccessToken(token({ amr: ["oauth", { method: "totp" }] })), ["oauth", "totp"]);
  assert.deepEqual(amrUitAccessToken(token({})), []);
  assert.deepEqual(amrUitAccessToken("kapot"), []);
  assert.deepEqual(amrUitAccessToken(null), []);
});

test("sessieIsOAuth: alleen bij amr ∋ oauth (ook na refresh, ook naast andere methodes)", () => {
  assert.equal(sessieIsOAuth(token({ amr: [{ method: "password" }] })), false);
  assert.equal(sessieIsOAuth(token({ amr: [{ method: "oauth" }] })), true);
  assert.equal(sessieIsOAuth(token({ amr: [{ method: "oauth" }, { method: "totp" }] })), true);
  assert.equal(sessieIsOAuth(undefined), false);
});

test("guard: wachtwoordsessie passeert zonder binding; oauth eist exact active; gatewayfout fail-closed", () => {
  assert.deepEqual(beoordeelBindingGuard({ isOAuth: false, binding: null }), { toegestaan: true, reden: "geen-oauth" });
  assert.deepEqual(beoordeelBindingGuard({ isOAuth: false, binding: null, gatewayFout: true }), { toegestaan: true, reden: "geen-oauth" });
  assert.deepEqual(beoordeelBindingGuard({ isOAuth: true, binding: { status: "active" } }), { toegestaan: true, reden: "actieve-binding" });
  assert.deepEqual(beoordeelBindingGuard({ isOAuth: true, binding: null }), { toegestaan: false, reden: "geen-binding" });
  for (const status of ["pending", "revoking", "revoked", "failed"] as const) {
    assert.deepEqual(beoordeelBindingGuard({ isOAuth: true, binding: { status } }), { toegestaan: false, reden: "binding-niet-actief" }, status);
  }
  assert.deepEqual(beoordeelBindingGuard({ isOAuth: true, binding: { status: "active" }, gatewayFout: true }), { toegestaan: false, reden: "gateway-fout" });
});

// ── startlimiter (V9) ───────────────────────────────────────────────────────

test("startlimiter: 20 per 10 minuten per sleutel, glijdend venster, sleutel is een hash zonder ruw IP", () => {
  assert.deepEqual(MICROSOFT_LOGIN_START_LIMIET, { limiet: 20, vensterMs: 600_000 });
  const l = maakVensterLimiter();
  const s = startSleutel("203.0.113.9", "pgb.example");
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(s, /203\.0\.113/);
  const t0 = 1_000_000;
  for (let i = 0; i < 20; i++) assert.equal(l.beoordeel(s, t0 + i).toegestaan, true, `poging ${i + 1}`);
  const geweigerd = l.beoordeel(s, t0 + 30);
  assert.equal(geweigerd.toegestaan, false);
  assert.equal(geweigerd.resetAtMs, t0 + 600_000);
  assert.equal(l.beoordeel(startSleutel("203.0.113.9", "ander.example"), t0 + 31).toegestaan, true, "andere host = andere teller");
  assert.equal(l.beoordeel(s, t0 + 600_000).toegestaan, true, "na het venster weer ruimte");
});

test("startlimiter: opruiming laat geen dode sleutels achter", () => {
  const l = maakVensterLimiter({ limiet: 1, vensterMs: 100 });
  l.beoordeel("a", 0);
  l.beoordeel("b", 0);
  assert.equal(l._aantalSleutels(), 2);
  l.beoordeel("c", 1_000);
  assert.equal(l._aantalSleutels(), 1);
});

test("client-IP: eerste x-forwarded-for, anders x-real-ip, anders null", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  assert.equal(clientIpUitHeaders(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIpUitHeaders(h({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIpUitHeaders(h({})), null);
});

// ── foutcategorieën en neutrale meldingen ───────────────────────────────────

test("foutcategorie: MicrosoftLoginError → categorie; gatewayfout → 1-op-1; rest → onverwachte_fout; nooit inhoud", () => {
  assert.equal(microsoftLoginFoutcategorie(new MicrosoftLoginError("claim_tid")), "claim_tid");
  assert.equal(microsoftLoginFoutcategorie(gatewayFout("binding_conflict")), "binding_conflict");
  assert.equal(microsoftLoginFoutcategorie(gatewayFout("login_uit")), "login_uit");
  assert.equal(microsoftLoginFoutcategorie(new Error("AADSTS50011: geheime providertekst")), "onverwachte_fout");
  assert.equal(microsoftLoginFoutcategorie({ categorie: "iets-anders" }), "onverwachte_fout");
  const e = new MicrosoftLoginError("token_exchange", new Error("ruwe providerfout met token=abc"));
  assert.doesNotMatch(e.message, /abc|provider/);
});

test("externe meldingen: één logintekst, drie profielteksten, geen verboden woorden, geen orakel", () => {
  const alle = [LOGIN_MICROSOFT_MELDING, ...Object.values(PROFIEL_MICROSOFT_LOGIN_MELDINGEN)];
  assert.equal(alle.length, 4);
  for (const tekst of alle) {
    for (const woord of VERBODEN_MELDINGWOORDEN) {
      assert.doesNotMatch(tekst.toLowerCase(), new RegExp(woord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase()), `${woord} in "${tekst}"`);
    }
  }
  // Elke interne categorie beeldt af op een van de drie profielcodes; alleen verval
  // en unlink onderscheiden zich — de rest is één grove 'koppelen'-melding.
  for (const c of MICROSOFT_LOGIN_FOUTCATEGORIEEN) {
    const code = profielCodeVoor(c);
    assert.equal(code, c === "pending_verlopen" ? "verlopen" : c === "unlink_mislukt" ? "ontkoppelen" : "koppelen", c);
  }
});

test("supportcode: acht tekens uit de correlatie-id, geen streepjes", () => {
  assert.equal(supportcode("0f0f0f0f-1111-2222-3333-444444444444"), "0F0F0F0F");
  assert.equal(supportcode("abcdefgh12345678").length, 8);
});
