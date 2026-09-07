import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BELEID_FOUTCATEGORIEEN,
  HERKOPPEL_TOKEN_BYTES,
  HERKOPPEL_VENSTER_SECONDEN,
  LOGIN_MODI,
  activeringWeigering,
  beoordeelPortaalSessieKern,
  isBeleidFoutcategorie,
  isHerkoppelTokenVorm,
  isLoginModus,
  loginModus,
  magActiveren,
  magZelfKoppelen,
  magZelfOntkoppelen,
  microsoftLoginBeschikbaar,
  profielkaartStand,
  type LoginModus,
  type Sessiebeleid,
} from "./microsoft-login-beleid-core";

const beleid = (over: Partial<Sessiebeleid> = {}): Sessiebeleid => ({
  fondsId: "f-1",
  modus: "optioneel",
  bindingStatus: null,
  breakGlass: false,
  linkOnly: false,
  ...over,
});

test("modi: drie waarden; alles onbekend valt terug op uit", () => {
  assert.deepEqual([...LOGIN_MODI], ["uit", "optioneel", "verplicht"]);
  for (const m of LOGIN_MODI) assert.equal(isLoginModus(m), true);
  for (const v of ["pilot", "", null, undefined, 1, {}]) assert.equal(isLoginModus(v), false);
  assert.equal(loginModus("verplicht"), "verplicht");
  assert.equal(loginModus("pilot"), "uit", "een onbekende waarde is nooit een actieve modus");
  assert.equal(loginModus(undefined), "uit");
});

test("oauth-sessie: uitsluitend een actieve binding mag door (fase 1B, ongewijzigd)", () => {
  assert.equal(beoordeelPortaalSessieKern({ isOAuth: true, beleid: beleid({ bindingStatus: "active" }) }).toegestaan, true);
  for (const status of ["pending", "revoking", "revoked", "failed"] as const) {
    const o = beoordeelPortaalSessieKern({ isOAuth: true, beleid: beleid({ bindingStatus: status }) });
    assert.equal(o.toegestaan, false, status);
    assert.equal(o.toegestaan === false && o.reden, "binding-niet-actief");
  }
  assert.equal(beoordeelPortaalSessieKern({ isOAuth: true, beleid: beleid() }).toegestaan, false, "geen binding");
  assert.equal(beoordeelPortaalSessieKern({ isOAuth: true, beleid: null }).toegestaan, false, "geen beleidsrij");
});

test("wachtwoordsessie: alleen een expliciete `verplicht` sluit het pad", () => {
  for (const modus of ["uit", "optioneel"] as LoginModus[]) {
    assert.equal(beoordeelPortaalSessieKern({ isOAuth: false, beleid: beleid({ modus }) }).toegestaan, true, modus);
  }
  const dicht = beoordeelPortaalSessieKern({ isOAuth: false, beleid: beleid({ modus: "verplicht" }) });
  assert.equal(dicht.toegestaan, false);
  assert.equal(dicht.toegestaan === false && dicht.reden, "wachtwoord-geblokkeerd");
  // Geen fondsprofiel (platformidentiteit) → het wachtwoordpad blijft zoals het was.
  assert.equal(beoordeelPortaalSessieKern({ isOAuth: false, beleid: null }).toegestaan, true);
});

test("uitzonderingen in `verplicht`: break-glass en de koppel-/herstelsessie", () => {
  const bg = beoordeelPortaalSessieKern({ isOAuth: false, beleid: beleid({ modus: "verplicht", breakGlass: true }) });
  assert.equal(bg.toegestaan, true);
  assert.equal(bg.toegestaan === true && bg.reden, "break-glass");
  const link = beoordeelPortaalSessieKern({ isOAuth: false, beleid: beleid({ modus: "verplicht", linkOnly: true }) });
  assert.equal(link.toegestaan, true);
  assert.equal(link.toegestaan === true && link.reden, "koppelsessie");
});

test("gatewayuitval: een fout is fail-closed, een ontbrekende configuratie niet", () => {
  const fout = beoordeelPortaalSessieKern({ isOAuth: false, beleid: null, uitval: "fout" });
  assert.equal(fout.toegestaan, false);
  assert.equal(fout.toegestaan === false && fout.reden, "gateway-fout");
  // Zonder gateway kan geen enkel fonds op `verplicht` staan (de modus zetten
  // loopt langs diezelfde gateway). Wachtwoordsessies uitloggen zou dan een
  // omgeving zonder Microsoft-login platleggen.
  const geenConfig = beoordeelPortaalSessieKern({ isOAuth: false, beleid: null, uitval: "config" });
  assert.equal(geenConfig.toegestaan, true);
  assert.equal(geenConfig.toegestaan === true && geenConfig.reden, "gateway-niet-geconfigureerd");
  // Een oauth-sessie kán daar niet bestaan: die weigeren we wél.
  assert.equal(beoordeelPortaalSessieKern({ isOAuth: true, beleid: null, uitval: "config" }).toegestaan, false);
});

test("zichtbaarheid en persoonlijke acties per modus", () => {
  assert.equal(microsoftLoginBeschikbaar("uit"), false);
  assert.equal(microsoftLoginBeschikbaar("optioneel"), true);
  assert.equal(microsoftLoginBeschikbaar("verplicht"), true);

  assert.equal(magZelfKoppelen("uit"), false);
  assert.equal(magZelfKoppelen("optioneel"), true);
  assert.equal(magZelfKoppelen("verplicht"), false);
  assert.equal(magZelfKoppelen("verplicht", true), true, "binnen een koppel-/herstelsessie wél");

  assert.equal(magZelfOntkoppelen("uit"), true, "in `uit` blijft een bestaande koppeling zelf te verwijderen");
  assert.equal(magZelfOntkoppelen("optioneel"), true);
  assert.equal(magZelfOntkoppelen("verplicht"), false);
  assert.equal(magZelfOntkoppelen("verplicht", true), true);

  assert.equal(profielkaartStand("uit"), "verbergen");
  assert.equal(profielkaartStand("optioneel"), "beheerbaar");
  assert.equal(profielkaartStand("verplicht"), "alleen-status");
  assert.equal(profielkaartStand("verplicht", true), "beheerbaar");
});

test("activering: alleen groen bij volledige dekking én een aantoonbaar break-glasspad", () => {
  assert.equal(magActiveren({ gereed: true, categorie: null, ongedekteAccounts: 0, breakglassAccounts: 1 }), true);
  assert.equal(magActiveren({ gereed: false, categorie: "dekking_onvolledig", ongedekteAccounts: 2, breakglassAccounts: 1 }), false);
  assert.equal(magActiveren({ gereed: true, categorie: null, ongedekteAccounts: 0, breakglassAccounts: 0 }), false, "zonder noodtoegang nooit");
  assert.equal(magActiveren({ gereed: true, categorie: "breakglass_onverifieerbaar", ongedekteAccounts: 0, breakglassAccounts: 1 }), false);
});

test("weigeringsteksten zijn neutraal en noemen geen account", () => {
  assert.match(activeringWeigering("dekking_onvolledig", 1), /Eén account/);
  assert.match(activeringWeigering("dekking_onvolledig", 3), /^3 accounts/);
  for (const c of BELEID_FOUTCATEGORIEEN) {
    const tekst = activeringWeigering(c);
    assert.ok(tekst.length > 10, c);
    assert.doesNotMatch(tekst, /@|token|claim/i, c);
  }
  assert.ok(BELEID_FOUTCATEGORIEEN.every(isBeleidFoutcategorie));
  assert.equal(isBeleidFoutcategorie("van-alles"), false);
});

test("tokenvorm: 32 bytes base64url = 43 tekens, niets anders", () => {
  assert.equal(HERKOPPEL_TOKEN_BYTES, 32);
  assert.equal(HERKOPPEL_VENSTER_SECONDEN, 900);
  const geldig = "a".repeat(43);
  assert.equal(isHerkoppelTokenVorm(geldig), true);
  for (const v of ["a".repeat(42), "a".repeat(44), "a".repeat(43) + "=", "abc/def", "", null, 42]) {
    assert.equal(isHerkoppelTokenVorm(v), false, String(v));
  }
});
