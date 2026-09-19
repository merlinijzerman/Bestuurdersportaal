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
    // #407 — de Copilot-meetarm heeft GEEN serverbrug en mag dus door geen
    // enkel app-, core-, platform- of fondsenbestand worden geïmporteerd.
    if (
      inhoud.includes("sharepoint-retrieval/copilot-retrieval")
      || inhoud.includes("sharepoint-retrieval/vergelijking")
      || inhoud.includes("voerCopilotRetrievalSpikeUit")
      || inhoud.includes("copilot/retrieval")
    ) directeImports.push(bestand);
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

test("#407-Copilot-meetarm heeft geen serverbrug en is nergens vanuit de app bereikbaar", () => {
  const spikeBestanden = [
    "scripts/spike/sharepoint-retrieval/copilot-retrieval.ts",
    "scripts/spike/sharepoint-retrieval/vergelijking.ts",
    "scripts/spike/sharepoint-retrieval/vergelijking-scenarios.ts",
    "scripts/spike/sharepoint-retrieval/run-vergelijking.ts",
  ];
  for (const bestand of spikeBestanden) {
    assert.ok(readFileSync(resolve(root, bestand), "utf8").length > 0, `${bestand} ontbreekt`);
  }

  // #407 — /shares/{token}/driveItem vereist volgens Microsoft minimaal
  // delegated Files.ReadWrite. De spike moet read-only blijven, dus die route
  // mag nergens in het harnas terugkeren.
  for (const bestand of spikeBestanden) {
    const inhoud = readFileSync(resolve(root, bestand), "utf8");
    assert.doesNotMatch(inhoud, /v1\.0\/shares\//, `${bestand} gebruikt /shares (schrijfpermission)`);
    assert.doesNotMatch(inhoud, /sharingToken/, `${bestand} bouwt nog een sharing-token`);
  }

  // De enige bestaande serverbrug (#353) mag de Copilot-arm niet binnenhalen.
  const brug = readFileSync(resolve(root, "core/lib/microsoft-sharepoint-retrieval-smoke.ts"), "utf8");
  assert.doesNotMatch(brug, /copilot/i);

  // En de browserveilige kern van de Preview-smoke kent de vierde route niet.
  const kern = readFileSync(resolve(root, "core/lib/microsoft-sharepoint-retrieval-smoke-core.ts"), "utf8");
  assert.doesNotMatch(kern, /copilot/i);
  assert.doesNotMatch(kern, /lokalisatie/i, "de auditprojectie blijft op de acht vaste afwijzingsvelden");
});

test("#407-vergelijkingsrunner is een expliciet lokaal npm-script buiten build, start, gates en test", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(pkg.scripts["spike:m365-copilot-vergelijking"], /M365_RETRIEVAL_SPIKE=local/);
  assert.match(pkg.scripts["spike:m365-copilot-vergelijking"], /sharepoint-retrieval\/run-vergelijking\.ts/);
  for (const naam of ["dev", "prebuild", "build", "start", "gates", "test", "test:unit", "test:component"]) {
    assert.doesNotMatch(pkg.scripts[naam] ?? "", /spike:m365-copilot-vergelijking|sharepoint-retrieval\/run-vergelijking/);
  }
  // De hermetische Copilot-suite hangt wél aan de spike-testingang.
  assert.match(pkg.scripts["test:spike:m365-retrieval"], /copilot-retrieval\.test\.ts/);
});

test("#407-fixturecontract is blokkerend in CI en draait via hetzelfde script als de spikesuite", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

  // Eén script als enige ingang, zodat CI-dekking en lokale dekking niet uiteen
  // kunnen lopen. Dit is de C-01-les: een geschreven controle die niet in de
  // gate is aangesloten, draait niet.
  assert.match(
    pkg.scripts["test:spike-fixture-contract"],
    /sharepoint-retrieval\/fixturestatus\.test\.ts/,
    "het fixturecontract wijst niet naar fixturestatus.test.ts",
  );
  assert.match(
    pkg.scripts["test:contract"],
    /npm run test:spike-fixture-contract/,
    "het fixturecontract is niet aangesloten op test:contract",
  );

  // En dit is wat het écht blokkerend maakt. Geen enkele CI-job roept
  // `test:contract` als geheel aan: de workflow somt de subscripts los op.
  // Aansluiten op test:contract alléén levert dus GEEN CI-dekking — dat gold
  // ook voor test:spike-boundary, dat hier jarenlang buiten viel. De gate
  // toetst daarom de workflow zelf, niet alleen de package.json-keten.
  const workflow = readFileSync(resolve(root, ".github/workflows/security-baseline.yml"), "utf8");
  assert.match(workflow, /name: Security baseline \(Sprint 1\)/, "de required jobnaam is gewijzigd");
  for (const script of ["test:spike-boundary", "test:spike-fixture-contract"]) {
    assert.match(
      workflow,
      new RegExp(`npm run ${script.replace(":", ":")}(?![\\w:-])`),
      `${script} draait niet in de required CI-job en is dus niet blokkerend`,
    );
  }
  assert.match(
    pkg.scripts["test:spike:m365-retrieval"],
    /npm run test:spike-fixture-contract/,
    "de spikesuite draait het fixturecontract niet via hetzelfde script",
  );
  // Niet rechtstreeks óók nog als bestand meegeven: dan kan de ene ingang
  // stilletjes een andere set draaien dan de andere.
  assert.doesNotMatch(
    pkg.scripts["test:spike:m365-retrieval"],
    /--test[^"]*fixturestatus\.test\.ts/,
    "fixturestatus.test.ts wordt zowel los als via het script gedraaid",
  );

  // De python-afhankelijke CLI-regressie hoort NIET in de CI-runtime.
  for (const naam of ["test:contract", "test:ci", "test", "test:unit", "test:component", "gates"]) {
    assert.doesNotMatch(
      pkg.scripts[naam] ?? "",
      /generator-cli/,
      `${naam} trekt de python-docx-afhankelijke generator-cli-suite de CI in`,
    );
  }
  assert.match(pkg.scripts["test:spike:m365-retrieval"], /generator-cli\.test\.ts/);
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
    assert.doesNotMatch(inhoud, /sharepoint-retrieval\/copilot-retrieval|sharepoint-retrieval\/vergelijking|copilot\/retrieval/);
  }
});
