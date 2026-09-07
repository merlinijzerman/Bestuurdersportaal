import assert from "node:assert/strict";
import { test } from "node:test";


// ── #344 ronde 3: het MFA-verificatietijdstip uit het token ─────────────────
// De verhoging van een break-glasssessie hangt aan ÉÉN verificatie. Kan het
// tijdstip niet worden gelezen, dan is er niets om haar aan te hangen: null, en
// de aanroeper gaat dicht.
test("mfaVerificatieUitAccessToken: alleen een echte tweede-factor-timestamp telt", async () => {
  const { mfaVerificatieUitAccessToken } = await import("./microsoft-login-sessieguard-core");
  const token = (payload: unknown) =>
    ["x", Buffer.from(JSON.stringify(payload)).toString("base64url"), "y"].join(".");

  assert.equal(mfaVerificatieUitAccessToken(null), null);
  assert.equal(mfaVerificatieUitAccessToken("geen.jwt"), null);
  assert.equal(mfaVerificatieUitAccessToken(token({})), null, "geen amr");
  assert.equal(
    mfaVerificatieUitAccessToken(token({ amr: [{ method: "password", timestamp: 1788793498 }] })),
    null,
    "alleen wachtwoord telt niet als tweede factor",
  );
  const uit = mfaVerificatieUitAccessToken(
    token({ amr: [{ method: "password", timestamp: 1788793400 }, { method: "totp", timestamp: 1788793498 }] }),
  );
  assert.ok(uit instanceof Date);
  assert.equal(uit?.getTime(), 1788793498 * 1000, "de totp-timestamp, niet die van het wachtwoord");
  // Meerdere factoren: de meest recente verificatie telt.
  const laatste = mfaVerificatieUitAccessToken(
    token({ amr: [{ method: "totp", timestamp: 100 }, { method: "webauthn", timestamp: 200 }] }),
  );
  assert.equal(laatste?.getTime(), 200 * 1000);
  for (const stuk of [{ amr: "geen-array" }, { amr: [{ method: "totp" }] }, { amr: [{ method: "totp", timestamp: "abc" }] }]) {
    assert.equal(mfaVerificatieUitAccessToken(token(stuk)), null, JSON.stringify(stuk));
  }
});
