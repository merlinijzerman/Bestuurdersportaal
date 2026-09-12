import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const lees = (pad: string) => readFileSync(resolve(process.cwd(), pad), "utf8");
const register = JSON.parse(lees("tests/cross-tenant/retrieval-t2-4-census.expected.json")) as {
  basis: string;
  entries: unknown[];
};
const context = JSON.parse(lees("tests/cross-tenant/retrieval-contextbronnen.expected.json")) as {
  lezingen_per_klasse: { evidence: string[]; modelcontext: string[] };
};

const centraal = (lezing: string) =>
  lezing.startsWith("core/lib/rag.ts::") || lezing.startsWith("core/lib/retrieval/");

function telFysiekeQueries(bron: string, tabel: string): number {
  const bestand = ts.createSourceFile("census.tsx", bron, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let aantal = 0;
  const bezoek = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === tabel
    ) aantal++;
    ts.forEachChild(node, bezoek);
  };
  bezoek(bestand);
  return aantal;
}

function modelcontextQueriesBuitenReader(bron: string): string[] {
  const tabellen = new Set([
    "agendapunten", "risicos", "risico_log", "risico_maatregelen", "procedures",
    "procedure_stappen", "procedure_requirements", "procedure_bewijs", "documenten",
    "governance_log_inhoud",
  ]);
  const bestand = ts.createSourceFile("route.tsx", bron, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const buiten: string[] = [];
  const bezoek = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "from" && ts.isStringLiteralLike(node.arguments[0])
      && tabellen.has(node.arguments[0].text)) {
      let ouder: ts.Node | undefined = node;
      let begrensd = false;
      while (ouder) {
        if (ts.isCallExpression(ouder) && ts.isIdentifier(ouder.expression)
          && ouder.expression.text === "leesModelcontext") { begrensd = true; break; }
        ouder = ouder.parent;
      }
      if (!begrensd) buiten.push(node.arguments[0].text);
    }
    ts.forEachChild(node, bezoek);
  };
  bezoek(bestand);
  return buiten;
}

test("#368 — nul evidencelezingen buiten de retrievalkern", () => {
  assert.equal(register.basis, "50c54ed7093");
  assert.deepEqual(register.entries, []);
  assert.deepEqual(context.lezingen_per_klasse.evidence.filter((lezing) => !centraal(lezing)), []);
});
test("#368 — centrale readers omvatten versie, typed evidence/preflight en parenthook", () => {
  assert.deepEqual(context.lezingen_per_klasse.evidence.filter(centraal).sort(), [
    "core/lib/rag.ts::document_chunks",
    "core/lib/rag.ts::documenten",
    "core/lib/retrieval/supabase-evidence.ts::decision_objects",
    "core/lib/retrieval/supabase-evidence.ts::document_chunks",
    "core/lib/retrieval/supabase-evidence.ts::documenten",
    "core/lib/retrieval/supabase-evidence.ts::semantic_units",
    "core/lib/retrieval/supabase-parent.ts::document_chunks",
    "core/lib/retrieval/supabase-versie.ts::document_chunks",
  ]);
});

test("#368 boundary — productieconsumenten bevatten geen directe evidencequery", () => {
  for (const bestand of [
    "app/api/chat/route.ts",
    "core/lib/besluitvorming-bron.ts",
    "core/lib/parent-context.ts",
    "core/lib/vergelijk-productie.ts",
  ]) {
    assert.doesNotMatch(
      lees(bestand),
      /\.from\(\s*["'](?:decision_objects|document_chunks|semantic_units)["']\s*\)/,
      bestand
    );
  }
});

test("#368 boundary — providerprivate fysieke queries zijn exact bevroren", () => {
  const evidence = lees("core/lib/retrieval/supabase-evidence.ts");
  const parent = lees("core/lib/retrieval/supabase-parent.ts");
  assert.equal(telFysiekeQueries(evidence, "document_chunks"), 1);
  assert.equal(telFysiekeQueries(evidence, "decision_objects"), 2);
  assert.equal(telFysiekeQueries(evidence, "semantic_units"), 2);
  assert.equal(telFysiekeQueries(evidence, "documenten"), 2);
  assert.equal(telFysiekeQueries(parent, "document_chunks"), 1);
});

test("#368 boundary — negatieve query buiten retrieval wordt gedetecteerd", () => {
  const onveilig = `${lees("app/api/chat/route.ts")}\nconst extra = supabase.from("document_chunks").select("id");\n`;
  assert.equal(telFysiekeQueries(onveilig, "document_chunks"), 1);
});

test("#368 census — queryparser telt code, geen commentaar of stringinhoud", () => {
  const bron = `
    // supabase.from("document_chunks")
    const tekst = '.from("document_chunks")';
    const query = supabase.from("document_chunks").select("id");
  `;
  assert.equal(telFysiekeQueries(bron, "document_chunks"), 1);
});

test("#368 — alle 26 modelcontextlezingen blijven apart van evidence", () => {
  assert.equal(context.lezingen_per_klasse.modelcontext.length, 26);
  assert.match(lees("app/api/chat/route.ts"), /combineerModelcontext/);
  assert.match(lees("app/api/chat/route.ts"), /modelcontext_audit/);
});

test("#368 modelcontextboundary — chatcontextqueries staan uitvoerend binnen de typed reader", () => {
  const route = lees("app/api/chat/route.ts");
  assert.deepEqual(modelcontextQueriesBuitenReader(route), []);
  const mutatie = `${route}\nconst bypass = supabase.from("risicos").select("titel");\n`;
  assert.deepEqual(modelcontextQueriesBuitenReader(mutatie), ["risicos"]);
  for (const helper of ["core/lib/profielsturing.ts", "core/lib/organisatieprofiel.ts", "core/lib/portaalcontext.ts"]) {
    assert.match(lees(helper), /leesModelcontext\(/, `${helper} mist de uitvoerende readergrens`);
  }
});

test("#368 — typed evidence hergebruikt centrale poort en lekt geen opslag-idvelden", () => {
  const contract = lees("core/lib/retrieval/evidence-contract.ts");
  const adapter = lees("core/lib/retrieval/supabase-evidence.ts");
  assert.match(adapter, /verifieerToelating/);
  assert.match(adapter, /maakCitationId/);
  assert.doesNotMatch(contract, /decision_id|document_id|chunk_id|drive_id|item_id/i);
});
