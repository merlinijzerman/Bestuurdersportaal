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

test("#353-prototype is statisch onbereikbaar vanuit productiehandlers en productiekern", () => {
  const overtredingen = [];
  for (const bestand of [...bronbestanden("app"), ...bronbestanden("core"), ...bronbestanden("platform"), ...bronbestanden("fondsen")]) {
    const inhoud = readFileSync(resolve(root, bestand), "utf8");
    if (inhoud.includes(spikePad) || inhoud.includes("sharepoint-retrieval/prototype") || inhoud.includes("voerSharePointRetrievalSpikeUit")) overtredingen.push(bestand);
  }
  assert.deepEqual(overtredingen, [], `spike is bereikbaar vanuit productiecode: ${overtredingen.join(", ")}`);
});

test("#353-runner is alleen een expliciet lokaal npm-script en hangt niet onder build, start, gates of test", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(pkg.scripts["spike:m365-retrieval"], /M365_RETRIEVAL_SPIKE=local/);
  assert.match(pkg.scripts["spike:m365-retrieval"], /scripts\/spike\/sharepoint-retrieval\/run\.ts/);
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
