import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const spikePad = "scripts/spike/sharepoint-retrieval";

function bronbestanden(map) {
  const resultaat = [];
  for (const entry of readdirSync(resolve(root, map), { withFileTypes: true })) {
    const relatief = join(map, entry.name);
    if (entry.isDirectory()) resultaat.push(...bronbestanden(relatief));
    else if ([".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(entry.name))) resultaat.push(relatief);
  }
  return resultaat;
}

test("#353-prototype is alleen bereikbaar via de ene Preview-only serverbrug", () => {
  const toegestaneBrug = "core/lib/microsoft-sharepoint-retrieval-smoke.ts";
  const directeImports = [];
  for (const bestand of [...bronbestanden("app"), ...bronbestanden("core"), ...bronbestanden("platform"), ...bronbestanden("fondsen")]) {
    const inhoud = readFileSync(resolve(root, bestand), "utf8");
    if (bestand === toegestaneBrug) continue;
    if (inhoud.includes(spikePad) || inhoud.includes("sharepoint-retrieval/prototype") || inhoud.includes("voerSharePointRetrievalSpikeUit")) directeImports.push(bestand);
  }
  assert.deepEqual(directeImports, [], `spike is buiten de serverbrug bereikbaar: ${directeImports.join(", ")}`);

  const brug = readFileSync(resolve(root, toegestaneBrug), "utf8");
  assert.match(brug, /import "server-only"/);
  assert.match(brug, /scripts\/spike\/sharepoint-retrieval\/prototype/);

  const brugImports = [];
  for (const bestand of [...bronbestanden("app"), ...bronbestanden("core"), ...bronbestanden("platform"), ...bronbestanden("fondsen")]) {
    if (bestand === toegestaneBrug) continue;
    const inhoud = readFileSync(resolve(root, bestand), "utf8");
    if (inhoud.includes("microsoft-sharepoint-retrieval-smoke\"")) brugImports.push(bestand);
  }
  assert.deepEqual(brugImports, ["app/api/microsoft/sharepoint/retrieval-smoke/route.ts"]);
});

test("#353-runner is alleen een expliciet lokaal npm-script en hangt niet onder build, start, gates of test", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(pkg.scripts["spike:m365-retrieval"], /M365_RETRIEVAL_SPIKE=local/);
  assert.match(pkg.scripts["spike:m365-retrieval"], /scripts\/spike\/sharepoint-retrieval\/run\.ts/);
  assert.match(pkg.scripts["spike:m365-permission-probe"], /M365_RETRIEVAL_SPIKE=local/);
  assert.match(pkg.scripts["spike:m365-permission-probe"], /--permission-probe/);
  for (const naam of ["dev", "prebuild", "build", "start", "gates", "test", "test:unit", "test:component"]) {
    assert.doesNotMatch(pkg.scripts[naam] ?? "", /spike:m365-retrieval|sharepoint-retrieval\/run/);
  }
});

test("#353-prototype wordt niet door Next of TypeScript naar een productie-entrypoint geëxporteerd", () => {
  for (const bestand of ["next.config.ts", "tsconfig.json", "middleware.ts"]) {
    const pad = resolve(root, bestand);
    let inhoud = "";
    try { inhoud = readFileSync(pad, "utf8"); } catch { continue; }
    assert.doesNotMatch(inhoud, /scripts\/spike\/sharepoint-retrieval/);
  }
});

test("#353-Previewbrug is niet bereikbaar vanuit chat, zoeken, vergelijken of de retrievalcompositie", () => {
  for (const bestand of [
    "app/api/chat/route.ts",
    "app/api/zoeken/route.ts",
    "app/api/vergelijk/route.ts",
    "core/lib/retrieval/adapter-factory.ts",
    "core/lib/retrieval/orchestratie.ts",
  ]) {
    let inhoud = "";
    try { inhoud = readFileSync(resolve(root, bestand), "utf8"); } catch { continue; }
    assert.doesNotMatch(inhoud, /microsoft-sharepoint-retrieval-smoke|sharepoint-retrieval\/prototype/);
  }
});
