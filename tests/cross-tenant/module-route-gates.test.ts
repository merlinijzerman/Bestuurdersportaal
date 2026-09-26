import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lees = (...pad: string[]) => readFileSync(join(root, ...pad), "utf8");

const PAGINA_GATES = [
  ["bibliotheek", "documents.view"],
  ["vergaderingen", "vergaderingen.manage"],
  ["notulen", "documents.view"],
  ["procedures", "procedures.view"],
  ["risicomatrix", "risicos.manage"],
] as const;

function routeBestanden(map: string): string[] {
  const uit: string[] = [];
  const bezoek = (pad: string) => {
    for (const item of readdirSync(pad, { withFileTypes: true })) {
      const volledig = join(pad, item.name);
      if (item.isDirectory()) bezoek(volledig);
      else if (item.name === "route.ts") uit.push(volledig);
    }
  };
  bezoek(join(root, "app", "api", map));
  return uit;
}

test("uitgeschakelde demo-modules weigeren alle pagina's via een server-layout", () => {
  for (const [moduleKey, capability] of PAGINA_GATES) {
    const bron = lees("app", "(dashboard)", moduleKey, "layout.tsx");
    assert.match(
      bron,
      new RegExp(`vereisModuleToegang\\("${moduleKey}",\\s*"${capability}"\\)`),
      `${moduleKey} moet beschikbaarheid en capability server-side afdwingen`
    );
  }
});

for (const moduleKey of ["vergaderingen", "procedures"] as const) {
  test(`alle ${moduleKey}-API-handlers declareren hun modulepoort`, () => {
    for (const bestand of routeBestanden(moduleKey)) {
      const bron = readFileSync(bestand, "utf8");
      const handlers = bron.match(/withFondsRoute\s*\(/g)?.length ?? 0;
      const gates = bron.match(new RegExp(`module:\\s*"${moduleKey}"`, "g"))?.length ?? 0;
      assert.ok(handlers > 0, `${bestand} bevat geen withFondsRoute-handler`);
      assert.equal(gates, handlers, `${bestand} moet elke handler aan ${moduleKey} koppelen`);
    }
  });
}

test("de centrale wrapper stopt een uitgeschakelde module vóór de handler", () => {
  const bron = lees("core", "lib", "route-wrapper.ts");
  const modulepoort = bron.indexOf("if (spec.module)");
  const handler = bron.indexOf("respons = await handler(");
  assert.ok(modulepoort >= 0, "wrapper moet de moduledeclaratie afdwingen");
  assert.ok(bron.includes("deps.weigerAlsModuleUit(fondsId, spec.module)"));
  assert.ok(modulepoort < handler, "modulepoort moet vóór de routehandler staan");
});
