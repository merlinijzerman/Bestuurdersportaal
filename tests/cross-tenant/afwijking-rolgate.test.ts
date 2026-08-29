// tests/cross-tenant/afwijking-rolgate.test.ts
// -----------------------------------------------------------------------------
// P3/PR-C (#168): de inner rolgate van de afwijking-route, in BEIDE richtingen.
//
// De karakteriseringssnapshot van deze gate (het negatieve 403-contract, tegen een
// draaiende server opgenomen) is uitgesteld tot de stack-run (besluit 0192,
// contractwaarde-regel; zie uitgestelde-opnames.json). Uitgesteld is de OPNAME,
// niet het bewijs: deze gedragstest draait vandaag zonder stack en toont dat
// beheerder + bestuursbureau een 403 krijgen en voorzitter + bestuurder erdoor
// komen. De rolgate zit vóór elke DB-aanroep, dus een stub-ctx volstaat.
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { afrondenMetAfwijkingHandler } from "../../app/api/procedures/[id]/stappen/[stapId]/afwijking/handler";

// Minimale FondsContext: alleen `rol` stuurt de rolgate; de gate keert terug vóór
// `supabase` wordt aangeraakt. Leeg body → voorzitter/bestuurder vallen ná de gate
// op de motivering-eis (400), wat 403 (gate) van 400 (doorgekomen) onderscheidt.
const ctxMet = (rol: string) =>
  ({ rol, supabase: {}, gebruikerId: "u", naam: null, email: null, fondsId: "f", requestId: "r" }) as never;
const reqLeeg = { json: async () => ({}) } as never;
const params = { id: "p1", stapId: "s1" };

test("AFW-1 — beheerder en bestuursbureau stranden op de rolgate (403)", async () => {
  for (const rol of ["beheerder", "bestuursbureau"]) {
    const res = await afrondenMetAfwijkingHandler(ctxMet(rol), reqLeeg, params);
    assert.equal(res.status, 403, `${rol} hoort 403 te krijgen op de afwijking-rolgate`);
  }
});

test("AFW-2 — voorzitter en bestuurder komen door de rolgate (geen 403)", async () => {
  for (const rol of ["voorzitter", "bestuurder"]) {
    const res = await afrondenMetAfwijkingHandler(ctxMet(rol), reqLeeg, params);
    assert.notEqual(res.status, 403, `${rol} mag niet op de rolgate stranden`);
    assert.equal(res.status, 400, `${rol} valt na de gate op de motivering-eis (leeg body)`);
  }
});

test("AFW-3 — een ontbrekende rol krijgt 403 (fail-closed)", async () => {
  const res = await afrondenMetAfwijkingHandler(ctxMet(""), reqLeeg, params);
  assert.equal(res.status, 403);
});
