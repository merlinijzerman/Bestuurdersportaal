import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

type Entry = {
  id: string;
  lezing: string;
  tabel: string;
  volledigeVersieIdentiteit: boolean;
  centraleCitatieketen: boolean;
  abortSignal: boolean;
  fysiekeQueries: number;
  doel: string;
  callSites: string[];
  scope: string;
  rechten: string;
  pii: string;
  limiet: string;
  versie: string;
  citatie: string;
  audit: string;
  timeout: string;
  foutgedrag: string;
  migratie: string;
};

const registerPad = resolve(process.cwd(), "tests/cross-tenant/retrieval-t2-4-census.expected.json");
const contextPad = resolve(process.cwd(), "tests/cross-tenant/retrieval-contextbronnen.expected.json");
const register = JSON.parse(readFileSync(registerPad, "utf8")) as { basis: string; entries: Entry[] };
const context = JSON.parse(readFileSync(contextPad, "utf8")) as {
  lezingen_per_klasse: { evidence: string[]; modelcontext: string[] };
};

const isCentraleRetrievallezing = (lezing: string) =>
  lezing.startsWith("core/lib/rag.ts::") || lezing.startsWith("core/lib/retrieval/");

const buitenKern = () => context.lezingen_per_klasse.evidence
  .filter((lezing) => !isCentraleRetrievallezing(lezing))
  .sort();

function telFysiekeQueries(bron: string, tabel: string): number {
  const bestand = ts.createSourceFile(
    "retrieval-t2-4-census.tsx",
    bron,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let aantal = 0;
  const bezoek = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === tabel
    ) {
      aantal++;
    }
    ts.forEachChild(node, bezoek);
  };
  bezoek(bestand);
  return aantal;
}

function toetsFysiekeQuerytelling(entry: Entry, bron: string): void {
  assert.equal(
    telFysiekeQueries(bron, entry.tabel),
    entry.fysiekeQueries,
    `${entry.lezing}: aantal fysieke .from(${entry.tabel})-queryexpressies gewijzigd`
  );
}

test("#368 census — exact vijf evidencelezingen buiten de retrievalkern zijn gekarakteriseerd", () => {
  assert.equal(register.basis, "afd0efb45583");
  assert.deepEqual(
    register.entries.map((entry) => entry.lezing).sort(),
    buitenKern(),
    "nieuw, verdwenen of ongekarakteriseerd evidencepad: planreview vereist"
  );
  assert.equal(register.entries.length, 5);
});

test("#368 census — gemergde #367-versieherlezing blijft onderdeel van de centrale retrievalimplementatie", () => {
  assert.deepEqual(
    context.lezingen_per_klasse.evidence.filter(isCentraleRetrievallezing).sort(),
    [
      "core/lib/rag.ts::document_chunks",
      "core/lib/rag.ts::documenten",
      "core/lib/retrieval/supabase-versie.ts::document_chunks",
    ],
    "een centrale evidencelezing is verplaatst of toegevoegd: herbeoordeel de #368-grens"
  );
});

test("#368 census — iedere lezing legt alle acceptatiedimensies expliciet vast", () => {
  const velden = [
    "doel", "scope", "rechten", "pii", "limiet", "versie", "citatie",
    "audit", "timeout", "foutgedrag", "migratie",
  ] as const;
  for (const entry of register.entries) {
    assert.ok(entry.id.length > 0, `${entry.lezing}: id ontbreekt`);
    assert.ok(entry.callSites.length > 0, `${entry.lezing}: call-sites ontbreken`);
    for (const veld of velden) {
      assert.ok(entry[veld].trim().length > 0, `${entry.lezing}: ${veld} ontbreekt`);
    }
  }
});

test("#368 census — de bevroren call-sites bestaan nog in hun productiebron", () => {
  for (const entry of register.entries) {
    const bestand = entry.lezing.split("::")[0];
    const bron = readFileSync(resolve(process.cwd(), bestand), "utf8");
    for (const fragment of entry.callSites) {
      assert.ok(bron.includes(fragment), `${entry.lezing}: call-site verdwenen of gewijzigd: ${fragment}`);
    }
  }
});

test("#368 census — exact zeven fysieke queryexpressies zijn per bestand en tabel bevroren", () => {
  assert.equal(
    register.entries.reduce((totaal, entry) => totaal + entry.fysiekeQueries, 0),
    7,
    "de vijf logische lezingen moeten samen exact zeven fysieke queryexpressies houden"
  );
  for (const entry of register.entries) {
    const bestand = entry.lezing.split("::")[0];
    toetsFysiekeQuerytelling(entry, readFileSync(resolve(process.cwd(), bestand), "utf8"));
  }
});

test("#368 census — negatieve controle: een vierde chat-document_chunks-query maakt de telling rood", () => {
  const entry = register.entries.find((item) => item.id === "chat-chunkpresentie");
  assert.ok(entry, "chat-chunkpresentie ontbreekt uit het register");
  const bestand = entry.lezing.split("::")[0];
  const bron = readFileSync(resolve(process.cwd(), bestand), "utf8");
  const metExtraQuery = `${bron}\nconst extra = supabase.from(\"document_chunks\").select(\"id\");\n`;
  assert.equal(telFysiekeQueries(metExtraQuery, entry.tabel), 4);
  assert.throws(
    () => toetsFysiekeQuerytelling(entry, metExtraQuery),
    /aantal fysieke \.from\(document_chunks\)-queryexpressies gewijzigd/
  );
});

test("#368 census — queryparser telt code, geen commentaar of stringinhoud", () => {
  const bron = `
    // supabase.from("document_chunks")
    const tekst = '.from("document_chunks")';
    const query = supabase.from("document_chunks").select("id");
  `;
  assert.equal(telFysiekeQueries(bron, "document_chunks"), 1);
});

test("#368 census — het overige modelcontextoppervlak blijft op 26 lezingen bevroren", () => {
  assert.equal(
    context.lezingen_per_klasse.modelcontext.length,
    26,
    "modelcontextcensus gewijzigd: beoordeel typed contract, grenzen en audit vóór acceptatie"
  );
});

test("#368 census — risicogaten worden niet per ongeluk als garanties beschreven", () => {
  assert.equal(
    register.entries.filter((entry) => !entry.volledigeVersieIdentiteit).length,
    5,
    "alle vijf lezingen missen nog volledige versie-identiteit"
  );
  assert.deepEqual(
    register.entries.filter((entry) => entry.abortSignal).map((entry) => entry.id),
    ["parent-siblings", "vergelijk-semantic-units"],
    "alleen parent-context en de door #369 verharde vergelijking dragen nu een AbortSignal"
  );
  assert.equal(
    register.entries.filter((entry) => !entry.centraleCitatieketen).length,
    5,
    "alle vijf lezingen staan nog buiten de volledige centrale citaatketen"
  );
});
