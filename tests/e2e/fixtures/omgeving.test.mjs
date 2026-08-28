import assert from "node:assert/strict";
import test from "node:test";
import { bevestigVeiligeE2eDoelomgeving } from "./omgeving.mjs";

const LOKAAL = {
  SEED_DOELOMGEVING: "local",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetische-lokale-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "synthetische-lokale-service-key",
};

test("WP3-grendel accepteert uitsluitend de lokale CLI-stack en lokale origins", () => {
  const uit = bevestigVeiligeE2eDoelomgeving(LOKAAL);
  assert.equal(uit.supabaseUrl, "http://127.0.0.1:54321");
  assert.equal(uit.origins.fondsA, "http://fonds-a.localhost:3000");
  assert.equal(uit.origins.platform, "http://beheer.localhost:3000");
});

test("WP3-grendel weigert de read-only Preview-ref voor muterende E2E", () => {
  assert.throws(
    () =>
      bevestigVeiligeE2eDoelomgeving({
        ...LOKAAL,
        SEED_DOELOMGEVING: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://swviwoytzvaqypieqgji.supabase.co",
      }),
    /E2E GEBLOKKEERD: SEED_DOELOMGEVING moet exact 'local'/
  );
});

test("WP3-grendel weigert een productieachtige Supabase-ref vóór databasegebruik", () => {
  assert.throws(
    () =>
      bevestigVeiligeE2eDoelomgeving({
        ...LOKAAL,
        NEXT_PUBLIC_SUPABASE_URL: "https://aebwiufuegsiwhwpdrfb.supabase.co",
      }),
    /SEED GEBLOKKEERD/
  );
});

test("WP3-grendel weigert niet-lokale, samenvallende en credential-origins", () => {
  assert.throws(
    () => bevestigVeiligeE2eDoelomgeving({ ...LOKAAL, E2E_FONDS_A_ORIGIN: "https://voorbeeld.nl" }),
    /lokale http-origin/
  );
  assert.throws(
    () => bevestigVeiligeE2eDoelomgeving({ ...LOKAAL, E2E_FONDS_A_ORIGIN: "http://user:pass@localhost:3000" }),
    /lokale http-origin/
  );
  assert.throws(
    () => bevestigVeiligeE2eDoelomgeving({ ...LOKAAL, E2E_FONDS_B_ORIGIN: "http://fonds-a.localhost:3000" }),
    /moeten van elkaar verschillen/
  );
});
