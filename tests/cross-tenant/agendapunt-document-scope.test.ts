import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const root = join(hier, "..", "..");
const lees = (...pad: string[]) => readFileSync(join(root, ...pad), "utf8");

const route = lees("app", "api", "chat", "route.ts");
const helper = lees("core", "lib", "agendapunt-documenten.ts");
const previewSeed = lees(
  "supabase",
  "seeds",
  "preview",
  "2026_09_26_428_app365_preview_demo_fixtures.sql"
);

test("#462 karakterisering — Preview bevat de secundaire koppeling …0102 → …0211", () => {
  assert.match(
    previewSeed,
    /'42800000-0000-0000-0000-000000000102'[\s\S]*?'42800000-0000-0000-0000-000000000211'/,
    "de bestaande App365-fixture moet het regressiegeval met een non-destructieve koppeling behouden"
  );
});

test("B-1 — de chatroute lost agendapuntstukken server-side op en geeft clientscope geen gezag", () => {
  assert.match(route, /haalAgendapuntDocumenten\([\s\S]*?supabase as unknown as AgendapuntDocumentLezer/);
  assert.match(route, /bepaalGevraagdeDocumentIds\(\{[\s\S]*?actueleAgendapuntDocumentIds:[\s\S]*?clientDocumentIds:/);
  assert.match(
    helper,
    /const actueel = \[\.\.\.new Set\(input\.actueleAgendapuntDocumentIds[\s\S]*?if \(input\.agendapuntModusActief\) return \{ ok: true, ids: actueel \}/,
    "in agendapuntmodus moet de return uitsluitend de actuele server-set gebruiken"
  );
});

test("B-1 — volledige analyse wint alleen bij een nog gekoppeld stuk, anders 400", () => {
  assert.match(
    helper,
    /if \(input\.volledigeAnalyseDocumentId\) \{[\s\S]*?input\.agendapuntModusActief && !actueel\.includes\(input\.volledigeAnalyseDocumentId\)[\s\S]*?ok: false/,
    "een ontkoppeld analysestuk mag de agendapuntscope niet stil vervangen"
  );
  assert.match(
    route,
    /if \(!gevraagdeScope\.ok\) \{\s*return NextResponse\.json\(\{ error: gevraagdeScope\.melding \}, \{ status: 400 \}\);/,
    "de route moet een geweigerde scope direct met 400 beantwoorden"
  );
});

test("B-2 — primaire en secundaire stukken delen actief/index/chunk-toelating", () => {
  assert.match(helper, /from\("documenten"\)[\s\S]*?eq\("actief", true\)/);
  assert.match(helper, /from\("document_agendapunten"\)/);
  assert.match(
    route,
    /if \(agendapuntModusActief\)[\s\S]*?d\.actief && d\.geindexeerd && d\.heeft_chunks/,
    "na het verenigen moet de bestaande AI-toelating op de hele set worden toegepast"
  );
});

test("B-2 — geen nieuwe status- of bronstatusfilter in de agendapunttoelating", () => {
  const tak = route.match(
    /if \(agendapuntModusActief\) \{([\s\S]*?)\n      \} else \{/
  )?.[1];
  assert.ok(tak, "agendapunttoelating niet gevonden");
  assert.doesNotMatch(tak, /\.status|bronstatus/);
});
