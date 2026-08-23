import assert from "node:assert/strict";
import test from "node:test";
import {
  SEED_DOELOMGEVINGEN,
  bevestigVeiligeSeedDoelomgeving,
  projectrefUitSupabaseUrl,
} from "./seed-doelomgeving.mjs";

test("OMG-1: onbekende projectref wordt vóór databasegebruik geweigerd", () => {
  assert.throws(
    () => bevestigVeiligeSeedDoelomgeving({
      url: "https://aebwiufuegsiwhwpdrfb.supabase.co",
      doelomgeving: "preview",
    }),
    /SEED GEBLOKKEERD: gevonden projectref 'aebwiufuegsiwhwpdrfb' staat niet op de allowlist/
  );
});

test("OMG-1: seed zelf raakt een doorgegeven adminclient niet vóór de grendel", async () => {
  const oudeUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oudeDoelomgeving = process.env.SEED_DOELOMGEVING;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://aebwiufuegsiwhwpdrfb.supabase.co";
  process.env.SEED_DOELOMGEVING = "preview";
  try {
    const { seed } = await import("./seed.mjs");
    let queries = 0;
    const admin = {
      from() { queries += 1; throw new Error("database had niet aangeroepen mogen worden"); },
      auth: { admin: {} },
      storage: { from() { queries += 1; throw new Error("storage had niet aangeroepen mogen worden"); } },
    };
    await assert.rejects(seed(admin), /SEED GEBLOKKEERD: gevonden projectref/);
    assert.equal(queries, 0);
  } finally {
    if (oudeUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oudeUrl;
    if (oudeDoelomgeving === undefined) delete process.env.SEED_DOELOMGEVING;
    else process.env.SEED_DOELOMGEVING = oudeDoelomgeving;
  }
});

test("OMG-1: ontbrekende bevestiging faalt gesloten", () => {
  assert.throws(
    () => bevestigVeiligeSeedDoelomgeving({
      url: "https://swviwoytzvaqypieqgji.supabase.co",
      doelomgeving: "",
    }),
    /SEED GEBLOKKEERD: zet SEED_DOELOMGEVING expliciet/
  );
});

test("OMG-1: ontbrekende allowlist faalt gesloten", () => {
  assert.throws(
    () => bevestigVeiligeSeedDoelomgeving({
      url: "https://swviwoytzvaqypieqgji.supabase.co",
      doelomgeving: "preview",
      allowlist: {},
    }),
    /SEED GEBLOKKEERD: de projectref-allowlist ontbreekt/
  );
});

test("OMG-1: preview en lokale CLI-stack zijn alleen met passende bevestiging toegestaan", () => {
  assert.deepEqual(
    bevestigVeiligeSeedDoelomgeving({
      url: "https://swviwoytzvaqypieqgji.supabase.co",
      doelomgeving: "preview",
    }),
    { doelomgeving: "preview", projectRef: "swviwoytzvaqypieqgji" }
  );
  assert.deepEqual(
    bevestigVeiligeSeedDoelomgeving({ url: "http://127.0.0.1:54321", doelomgeving: "local" }),
    { doelomgeving: "local", projectRef: "127.0.0.1:54321" }
  );
  assert.deepEqual(SEED_DOELOMGEVINGEN.local, ["127.0.0.1:54321", "localhost:54321"]);
  assert.equal(projectrefUitSupabaseUrl("http://localhost:54321"), "localhost:54321");
});
