// ============================================================
//  Sanity-tests voor core/lib/procedure-definitie.ts.
//
//  Geen testframework; standalone met assert. Draait onder `npm run sanity`
//  (glob core/lib/*.sanity.ts). Uitvoeren: npx tsx core/lib/procedure-definitie.sanity.ts
//
//  Kernbewijs:
//   1. De canonieke invaardefinitie (pf_wtp_invaarbesluit@2.0.1) is geldig
//      volgens de eigen lichte validator (schema + fase-refs + DAG).
//   2. De invaardefinitie heeft — bewust — GEEN blokkerende afhankelijkheden
//      (parallel-by-default; zie PROCEDURE-ENGINE-V2-ONTWERP §3).
//   3. De validator vangt de fouten die hij hoort te vangen (negatieve
//      tests): cyclus, onbekende fase_code, onbekend requirement_type,
//      zelf-verwijzing en dubbele volgorde.
//   4. Mapping naar het ProcessTemplate-contract levert 12 stappen met
//      fase_code en (lege) afhankelijkheden.
// ============================================================

import assert from "node:assert/strict";
import invaarJson from "../../definities/pensioenfondsen/pf_wtp_invaarbesluit@2.0.1.json";
import {
  valideerDefinitie,
  valideerDAG,
  definitieNaarProcessTemplate,
  REQUIREMENT_TYPES,
  type ProcedureDefinitie,
  type DefinitieStap,
} from "./procedure-definitie";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const invaar = invaarJson as unknown as ProcedureDefinitie;

// 1. Canonieke definitie is geldig.
check("invaardefinitie valideert zonder fouten", () => {
  const fouten = valideerDefinitie(invaar);
  assert.deepEqual(fouten, [], `verwachtte 0 fouten, kreeg:\n${fouten.join("\n")}`);
});

check("invaardefinitie heeft 12 stappen en 6 fasen", () => {
  assert.equal(invaar.stappen.length, 12);
  assert.equal(invaar.fasen.length, 6);
});

// 2. Invaar = parallel-by-default: geen enkele blokkerende afhankelijkheid.
check("invaardefinitie heeft geen blokkerende afhankelijkheden", () => {
  for (const s of invaar.stappen) {
    assert.deepEqual(
      s.blokkerende_afhankelijkheden,
      [],
      `stap ${s.volgorde} zou geen afhankelijkheden mogen hebben`
    );
  }
});

check("elke stap-fase_code bestaat in fasen[]", () => {
  const codes = new Set(invaar.fasen.map((f) => f.fase_code));
  for (const s of invaar.stappen) {
    assert.ok(codes.has(s.fase_code), `stap ${s.volgorde}: fase_code ${s.fase_code}`);
  }
});

check("gebruikte requirement-types zijn geldig (incl. external_submission)", () => {
  const types = new Set(
    invaar.stappen.flatMap((s) => s.requirements.map((r) => r.requirement_type))
  );
  // OB-E10: de bewijslast volgt sinds 2026-08-14 de standaardset. Die gebruikt
  // wél `external_submission` (DNB/AFM-indiening), maar modelleert hoorrecht/
  // afstemming via de CHECKLIST i.p.v. een `consultation`-requirement — dat type
  // blijft een geldige enum-waarde (o.a. voor instantie-requirements), maar komt
  // in deze definitie niet meer voor.
  assert.ok(types.has("external_submission"), "external_submission ontbreekt");
  // en alle gebruikte types zitten in de toegestane set
  for (const t of types) {
    assert.ok(
      (REQUIREMENT_TYPES as readonly string[]).includes(t),
      `onbekend type ${t}`
    );
  }
});

// 3. Negatieve tests — de validator moet fouten vangen.
function kloon(): ProcedureDefinitie {
  return JSON.parse(JSON.stringify(invaar));
}

check("cyclus in afhankelijkheden wordt gedetecteerd", () => {
  const d = kloon();
  d.stappen[0].blokkerende_afhankelijkheden = [2];
  d.stappen[1].blokkerende_afhankelijkheden = [1];
  const fouten = valideerDefinitie(d);
  assert.ok(
    fouten.some((f) => f.includes("cyclus")),
    `verwachtte een cyclus-fout, kreeg:\n${fouten.join("\n")}`
  );
});

check("directe DAG-cyclus op stapniveau", () => {
  const stappen: DefinitieStap[] = [
    { volgorde: 1, naam: "a", beschrijving: "a", fase_code: "I", vereist_besluit: false, geschatte_dagen: 1, blokkerende_afhankelijkheden: [2], checklist: [], requirements: [] },
    { volgorde: 2, naam: "b", beschrijving: "b", fase_code: "I", vereist_besluit: false, geschatte_dagen: 1, blokkerende_afhankelijkheden: [1], checklist: [], requirements: [] },
  ];
  assert.ok(valideerDAG(stappen).length > 0);
  // acyclisch = geen fouten
  stappen[1].blokkerende_afhankelijkheden = [];
  assert.deepEqual(valideerDAG(stappen), []);
});

check("onbekende fase_code wordt gedetecteerd", () => {
  const d = kloon();
  d.stappen[0].fase_code = "ZZZ";
  const fouten = valideerDefinitie(d);
  assert.ok(fouten.some((f) => f.includes("ZZZ")));
});

check("onbekend requirement_type wordt gedetecteerd", () => {
  const d = kloon();
  // @ts-expect-error — bewust een ongeldige waarde voor de negatieve test
  d.stappen[0].requirements[0].requirement_type = "verzonnen_type";
  const fouten = valideerDefinitie(d);
  assert.ok(fouten.some((f) => f.includes("verzonnen_type")));
});

check("zelf-verwijzende afhankelijkheid wordt gedetecteerd", () => {
  const d = kloon();
  d.stappen[2].blokkerende_afhankelijkheden = [3];
  const fouten = valideerDefinitie(d);
  assert.ok(fouten.some((f) => f.includes("zichzelf")));
});

check("afhankelijkheid naar niet-bestaande stap wordt gedetecteerd", () => {
  const d = kloon();
  d.stappen[0].blokkerende_afhankelijkheden = [99];
  const fouten = valideerDefinitie(d);
  assert.ok(fouten.some((f) => f.includes("niet-bestaande")));
});

check("field zonder veld_pad wordt gedetecteerd", () => {
  const d = kloon();
  // OB-E10: de standaardset-definitie gebruikt zelf geen field-requirements
  // meer; injecteer er een (zonder veld_pad) om de validatorregel te toetsen.
  d.stappen[0].requirements.push({
    requirement_type: "field",
    label: "Testveld",
    veld_pad: null,
    verplicht: true,
    blokkerend: false,
  });
  const fouten = valideerDefinitie(d);
  assert.ok(fouten.some((f) => f.includes("veld_pad")));
});

check("vereist_besluit zonder approval is een niet-wegklikbare importfout", () => {
  const d = kloon();
  d.stappen[0].requirements = d.stappen[0].requirements.filter(
    (r) => r.requirement_type !== "approval"
  );
  const fouten = valideerDefinitie(d);
  assert.ok(
    fouten.some((f) => f.includes("vereist_besluit zonder gebonden approval-vereiste")),
    `verwachtte een approval-fout, kreeg:\n${fouten.join("\n")}`
  );
});

// 4. Mapping naar ProcessTemplate.
check("mapping levert 12 stappen met fase_code + lege afhankelijkheden", () => {
  const t = definitieNaarProcessTemplate(invaar);
  assert.equal(t.code, "pf_wtp_invaarbesluit");
  assert.equal(t.stappen.length, 12);
  for (const s of t.stappen) {
    assert.ok(typeof s.fase_code === "string" && s.fase_code.length > 0);
    assert.deepEqual(s.blokkerende_afhankelijkheden, []);
    assert.ok(s.checklist.length > 0);
    // checklist-volgordes zijn 1..n
    s.checklist.forEach((c, i) => assert.equal(c.volgorde, i + 1));
  }
  // stappen gesorteerd op volgorde
  const volg = t.stappen.map((s) => s.volgorde);
  assert.deepEqual(volg, [...volg].sort((a, b) => a - b));
});

console.log(`\nprocedure-definitie.sanity: ${n} checks groen.`);
