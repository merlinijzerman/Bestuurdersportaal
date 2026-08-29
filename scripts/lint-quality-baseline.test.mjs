import assert from "node:assert/strict";
import test from "node:test";
import {
  maakBaseline,
  normaliseerLintResultaten,
  vergelijkMetBaseline,
} from "./lint-quality-lib.mjs";

const cwd = "/repo";

function resultaat(bestand, meldingen, severity = 1) {
  return {
    filePath: `${cwd}/${bestand}`,
    messages: meldingen.map((ruleId) => ({ ruleId, severity, line: 4 })),
  };
}

test("normaliseert alleen officiële qualityregels deterministisch", () => {
  const actueel = normaliseerLintResultaten([
    resultaat("app/b.tsx", ["react/jsx-key", "no-unreachable"]),
    resultaat("app/a.tsx", ["react-hooks/exhaustive-deps", "@next/next/no-img-element"]),
  ], cwd);

  assert.equal(actueel.totaal, 3);
  assert.deepEqual(Object.keys(actueel.bestanden), ["app/a.tsx", "app/b.tsx"]);
  assert.equal(actueel.perRegel["no-unreachable"], undefined);
  assert.deepEqual(actueel.fouten, []);
});

test("registreert parser- en configuratie-errors buiten de waarschuwingbaseline", () => {
  const actueel = normaliseerLintResultaten([
    resultaat("app/kapot.tsx", [null], 2),
  ], cwd);

  assert.equal(actueel.totaal, 0);
  assert.deepEqual(actueel.fouten, [
    { bestand: "app/kapot.tsx", regel: "parser/configuratie", regelnummer: 4 },
  ]);
});

test("accepteert bestaande schuld en verbeteringen", () => {
  const oud = normaliseerLintResultaten([
    resultaat("app/a.tsx", ["react/jsx-key", "react/jsx-key"]),
  ], cwd);
  const actueel = normaliseerLintResultaten([
    resultaat("app/a.tsx", ["react/jsx-key"]),
  ], cwd);

  assert.deepEqual(vergelijkMetBaseline(actueel, maakBaseline(oud)), []);
});

test("blokkeert een nieuwe bevinding in bestaand of nieuw bestand", () => {
  const baseline = maakBaseline(normaliseerLintResultaten([
    resultaat("app/a.tsx", ["react/jsx-key"]),
  ], cwd));
  const actueel = normaliseerLintResultaten([
    resultaat("app/a.tsx", ["react/jsx-key", "react/jsx-key"]),
    resultaat("app/nieuw.tsx", ["react-hooks/rules-of-hooks"]),
  ], cwd);

  assert.deepEqual(vergelijkMetBaseline(actueel, baseline), [
    { bestand: "app/a.tsx", regel: "react/jsx-key", toegestaan: 1, aantal: 2 },
    { bestand: "app/nieuw.tsx", regel: "react-hooks/rules-of-hooks", toegestaan: 0, aantal: 1 },
  ]);
});
