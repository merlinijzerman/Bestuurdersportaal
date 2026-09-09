import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  ACTIVERING_SCHEMA,
  BELEID_PATCH_SCHEMA,
  BREAKGLASS_SCHEMA,
  bouwBeheerBeleidRespons,
  bouwUitnodigingsLink,
  herkoppelTokenHash,
  INTREKKING_SCHEMA,
  maakHerkoppelToken,
  VERBODEN_RESPONSSLEUTELS,
} from "./microsoft-login-beheer-core";
import { BEHEER_TEKSTEN, tokenUitFragment, UITNODIGING_ONGELDIG_MELDING, VERBODEN_MELDINGWOORDEN } from "./microsoft-login-meldingen-core";
import { activeringWeigering, magActiveren } from "./microsoft-login-beleid-core";

const TOKEN = "a".repeat(43);

test("herkoppeltoken: 43 tekens base64url; hash is sha256-hex; ongeldige vorm gooit", () => {
  const t = maakHerkoppelToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(maakHerkoppelToken(), t);
  assert.equal(herkoppelTokenHash(TOKEN), createHash("sha256").update(TOKEN).digest("hex"));
  assert.throws(() => herkoppelTokenHash("kort"), /vorm/);
});

test("uitnodigingslink: token uitsluitend in het FRAGMENT van /koppelen; kale origin verplicht", () => {
  const link = bouwUitnodigingsLink("https://pgb.example", TOKEN);
  assert.equal(link, `https://pgb.example/koppelen#${TOKEN}`);
  const u = new URL(link);
  assert.equal(u.pathname, "/koppelen");
  assert.equal(u.search, "");
  assert.equal(u.hash, `#${TOKEN}`);
  assert.throws(() => bouwUitnodigingsLink("https://pgb.example/pad", TOKEN), /kale oorsprong/);
  assert.throws(() => bouwUitnodigingsLink("https://u:p@pgb.example", TOKEN), /kale oorsprong/);
  assert.throws(() => bouwUitnodigingsLink("https://pgb.example", "x"), /vorm/);
});

test("fragment lezen: alleen exact `#<token>`; alles anders is null", () => {
  assert.equal(tokenUitFragment(`#${TOKEN}`), TOKEN);
  assert.equal(tokenUitFragment(TOKEN), null, "zonder #");
  assert.equal(tokenUitFragment("#kort"), null);
  assert.equal(tokenUitFragment(`#${TOKEN}&x=1`), null);
  assert.equal(tokenUitFragment(""), null);
  assert.equal(tokenUitFragment(null), null);
});

test("bodycontracten: strikt; ongeldige modus, niet-uuid en extra sleutels worden geweigerd", () => {
  assert.equal(BELEID_PATCH_SCHEMA.safeParse({ modus: "verplicht" }).success, true);
  assert.equal(BELEID_PATCH_SCHEMA.safeParse({ modus: "aan" }).success, false);
  assert.equal(BELEID_PATCH_SCHEMA.safeParse({ modus: "uit", extra: 1 }).success, false);
  const uuid = "0f0f0f0f-1111-4222-8333-444444444444";
  assert.equal(INTREKKING_SCHEMA.safeParse({ doelUserId: uuid }).success, true);
  assert.equal(INTREKKING_SCHEMA.safeParse({ doelUserId: uuid, afronden: true }).success, true);
  assert.equal(INTREKKING_SCHEMA.safeParse({ doelUserId: "geen-uuid" }).success, false);
  assert.equal(BREAKGLASS_SCHEMA.safeParse({ doelUserId: uuid, reden: "entra_storing" }).success, true);
  assert.equal(BREAKGLASS_SCHEMA.safeParse({ doelUserId: uuid, reden: "omdat" }).success, false);
  assert.equal(BREAKGLASS_SCHEMA.safeParse({ doelUserId: uuid, reden: "migratie", herzienOverDagen: 3 }).success, false);
  assert.equal(ACTIVERING_SCHEMA.safeParse({ token: TOKEN }).success, true);
  assert.equal(ACTIVERING_SCHEMA.safeParse({ token: "kort" }).success, false);
  assert.equal(ACTIVERING_SCHEMA.safeParse({ token: TOKEN, extra: true }).success, false);
});

test("beheerrespons: geen tenant-id (alleen tenantGeconfigureerd), geen tid/oid/sub/e-mail; dekking afgeleid; ISO-tijdstippen", () => {
  const nu = new Date("2026-09-09T10:00:00.000Z");
  const r = bouwBeheerBeleidRespons({
    modus: "optioneel",
    entraTenantId: "11111111-2222-3333-4444-555555555555",
    preflight: { gereed: false, categorie: "dekking_onvolledig", ongedekteAccounts: 2, breakglassAccounts: 1, breakglassHerzieningVerlopen: 0 },
    dekking: [
      { userId: "u1", naam: "A", rol: "bestuurder", bindingStatus: "active", laatstGebruiktOp: nu, breakGlass: false, uitnodigingOpen: false },
      { userId: "u2", naam: "B", rol: "beheerder", bindingStatus: null, laatstGebruiktOp: null, breakGlass: true, uitnodigingOpen: true },
      { userId: "u3", naam: null, rol: null, bindingStatus: "revoking", laatstGebruiktOp: null, breakGlass: false, uitnodigingOpen: false },
    ],
    breakglass: [{ id: "b1", userId: "u2", naam: "B", redenCategorie: "beheerherstel", uitgegevenOp: nu, herzienVoor: nu, herzieningVerlopen: true, laatstGebruiktOp: null }],
    magActiveren,
    activeringWeigering,
  });
  assert.equal(r.tenantGeconfigureerd, true);
  assert.equal(r.magActiveren, false);
  assert.equal(r.activeringWeigering, "2 accounts hebben nog geen actieve Microsoft-koppeling.");
  assert.deepEqual(r.dekking.map((d) => d.gedekt), [true, true, false]);
  assert.equal(r.dekking[0]!.laatstGebruiktOp, nu.toISOString());
  assert.equal(r.breakglass[0]!.herzieningVerlopen, true);
  const dump = JSON.stringify(r);
  for (const s of VERBODEN_RESPONSSLEUTELS) assert.doesNotMatch(dump, new RegExp(`"${s}"`), s);
  assert.doesNotMatch(dump, /11111111-2222/, "tenant-id lekt niet");
  assert.equal(bouwBeheerBeleidRespons({ modus: "uit", entraTenantId: null, preflight: r.preflight, dekking: [], breakglass: [], magActiveren, activeringWeigering }).tenantGeconfigureerd, false);
});

test("teksten: ongeldig/verlopen/gebruikt delen één neutrale melding; afronden noemt de achterblijvende identiteit; geen verboden woorden op het loginoppervlak", () => {
  assert.match(UITNODIGING_ONGELDIG_MELDING, /niet \(meer\) geldig/);
  for (const w of VERBODEN_MELDINGWOORDEN) assert.doesNotMatch(UITNODIGING_ONGELDIG_MELDING.toLowerCase(), new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase()), w);
  assert.match(BEHEER_TEKSTEN.afrondenBevestiging, /Microsoft-identiteit blijft in Supabase Auth achter/);
  assert.match(BEHEER_TEKSTEN.afrondenBevestiging, /hergebruik/);
  assert.equal(BEHEER_TEKSTEN.afrondenBevestigingswoord, "AFRONDEN");
  assert.match(BEHEER_TEKSTEN.uitnodigingEenmalig, /één keer getoond/);
});
