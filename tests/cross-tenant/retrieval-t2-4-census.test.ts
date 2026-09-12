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

function binnenReader(node: ts.Node): boolean {
  let ouder: ts.Node | undefined = node;
  while (ouder) {
    if (ts.isCallExpression(ouder) && ts.isIdentifier(ouder.expression)
      && ouder.expression.text === "leesModelcontext") return true;
    ouder = ouder.parent;
  }
  return false;
}

function heeftVoorouderAanroep(node: ts.Node, naam: string): boolean {
  let ouder: ts.Node | undefined = node.parent;
  while (ouder) {
    if (ts.isCallExpression(ouder) && ts.isIdentifier(ouder.expression)
      && ouder.expression.text === naam) return true;
    ouder = ouder.parent;
  }
  return false;
}

function heeftVoorouderMethodeAanroep(node: ts.Node, naam: string, argument: string): boolean {
  let ouder: ts.Node | undefined = node.parent;
  while (ouder) {
    if (ts.isCallExpression(ouder) && ts.isPropertyAccessExpression(ouder.expression)
      && ouder.expression.name.text === naam && ouder.arguments.length === 1
      && ts.isIdentifier(ouder.arguments[0]) && ouder.arguments[0].text === argument) return true;
    ouder = ouder.parent;
  }
  return false;
}

function functienaam(node: ts.Node): string | null {
  let ouder: ts.Node | undefined = node;
  while (ouder) {
    if (ts.isFunctionDeclaration(ouder) && ouder.name) return ouder.name.text;
    if ((ts.isArrowFunction(ouder) || ts.isFunctionExpression(ouder))
      && ts.isVariableDeclaration(ouder.parent) && ts.isIdentifier(ouder.parent.name)) {
      return ouder.parent.name.text;
    }
    ouder = ouder.parent;
  }
  return null;
}

/** AST + lokale callgraph: een query is begrensd als zij lexicaal in de reader
 * staat, of in een helper die uitsluitend vanuit een readercallback wordt
 * aangeroepen. Comments, strings en functienamen tellen niet als bewijs. */
function analyseerModelcontextQueries(bron: string): Map<string, { begrensd: number; buiten: number }> {
  const bestand = ts.createSourceFile("modelcontext.tsx", bron, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functies = new Map<string, ts.Node>();
  const helperCallsBinnenReader = new Set<string>();
  const registreer = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) functies.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      functies.set(node.name.text, node.initializer);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && binnenReader(node)) {
      helperCallsBinnenReader.add(node.expression.text);
    }
    ts.forEachChild(node, registreer);
  };
  registreer(bestand);

  // Ondersteun een kleine lokale helperketen zonder op naamconventies te
  // vertrouwen: alleen echte calls vanuit reeds bewezen begrensde functies.
  let gewijzigd = true;
  while (gewijzigd) {
    gewijzigd = false;
    for (const [naam, functie] of functies) {
      if (!helperCallsBinnenReader.has(naam)) continue;
      const bezoek = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && functies.has(node.expression.text) && !helperCallsBinnenReader.has(node.expression.text)) {
          helperCallsBinnenReader.add(node.expression.text);
          gewijzigd = true;
        }
        ts.forEachChild(node, bezoek);
      };
      bezoek(functie);
    }
  }

  const uit = new Map<string, { begrensd: number; buiten: number }>();
  const bezoekQuery = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "from" && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])) {
      const tabel = node.arguments[0].text;
      const huidig = uit.get(tabel) ?? { begrensd: 0, buiten: 0 };
      const helper = functienaam(node);
      if (binnenReader(node) || (helper !== null && helperCallsBinnenReader.has(helper))) huidig.begrensd++;
      else huidig.buiten++;
      uit.set(tabel, huidig);
    }
    ts.forEachChild(node, bezoekQuery);
  };
  bezoekQuery(bestand);
  return uit;
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

test("#368 modelcontextboundary — alle 26 lezingen lopen uitvoerend door de typed grens", () => {
  const entries = context.lezingen_per_klasse.modelcontext.map((lezing) => {
    const [bestand, tabel] = lezing.split("::");
    return { bestand, tabel };
  });
  assert.equal(entries.length, 26);
  const perBestand = new Map<string, Map<string, { begrensd: number; buiten: number }>>();
  for (const { bestand } of entries) {
    if (!perBestand.has(bestand)) perBestand.set(bestand, analyseerModelcontextQueries(lees(bestand)));
  }
  for (const { bestand, tabel } of entries) {
    const resultaat = perBestand.get(bestand)?.get(tabel) ?? { begrensd: 0, buiten: 0 };
    assert.ok(resultaat.begrensd > 0, `${bestand}::${tabel} mist een uitvoerende readergrens`);
    const toegestaneConfiglezingen = bestand === "app/api/chat/route.ts" && tabel === "profielen" ? 1 : 0;
    assert.equal(resultaat.buiten, toegestaneConfiglezingen, `${bestand}::${tabel} heeft een modelcontextbypass`);
  }
});

test("#368 modelcontextboundary — tabelgedreven mutaties van ieder brontype worden gedetecteerd", () => {
  for (const lezing of context.lezingen_per_klasse.modelcontext) {
    const [bestand, tabel] = lezing.split("::");
    const bron = lees(bestand);
    const voor = analyseerModelcontextQueries(bron).get(tabel)?.buiten ?? 0;
    const mutatie = `${bron}\nconst directeBypass = supabase.from(${JSON.stringify(tabel)}).select("*");\n`;
    const na = analyseerModelcontextQueries(mutatie).get(tabel)?.buiten ?? 0;
    assert.equal(na, voor + 1, `${bestand}::${tabel} mutatie moet de boundaryassertie raken`);
  }
});

test("#368 render-/persistboundary — vrije seedtekst kent één rendergrens en writes starten niet na abort", () => {
  const route = ts.createSourceFile(
    "route.tsx", lees("app/api/chat/route.ts"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX
  );
  let toelichtingCalls = 0;
  let duurzameWrites = 0;
  const bezoek = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === "bouwToelichtingBlok") {
      toelichtingCalls++;
      assert.equal(heeftVoorouderAanroep(node, "bouwModelcontextBlok"), true);
    }
    const isRpcWrite = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "rpc" && ts.isStringLiteralLike(node.arguments[0])
      && node.arguments[0].text === "schrijf_ai_interactie";
    const isUpsert = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "upsert";
    if (isRpcWrite || isUpsert) {
      duurzameWrites++;
      assert.equal(
        heeftVoorouderAanroep(node, "voerDuurzameSchrijfBinnenDeadlineUit"), true,
        "inhoudsschrijf staat buiten de samengestelde requestdeadline"
      );
      assert.equal(
        heeftVoorouderMethodeAanroep(node, "abortSignal", "contextSignal"), true,
        "inhoudsschrijf draagt het samengestelde requestsignaal niet tot in provider-I/O"
      );
    }
    ts.forEachChild(node, bezoek);
  };
  bezoek(route);
  assert.equal(toelichtingCalls, 1);
  assert.equal(duurzameWrites, 5);
});

test("#368 — typed evidence hergebruikt centrale poort en lekt geen opslag-idvelden", () => {
  const contract = lees("core/lib/retrieval/evidence-contract.ts");
  const adapter = lees("core/lib/retrieval/supabase-evidence.ts");
  assert.match(adapter, /verifieerToelating/);
  assert.match(adapter, /maakCitationId/);
  assert.doesNotMatch(contract, /decision_id|document_id|chunk_id|drive_id|item_id/i);
});
