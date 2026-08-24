// ============================================================
//  Sanity-tests voor de bewijs↔vereiste-matching in core/lib/decision.ts.
//
//  Regressie die dit afdekt: één geüpload bewijsstuk vinkte álle
//  document-vereisten van dezelfde stap tegelijk af ("3 gevraagd · alle
//  opgevoerd" na één upload). Oorzaak was de wildcard
//  `if (!req.documenttype) return true` in buildEvidenceLijst, gecombineerd
//  met een `.find()` die het stuk niet "verbruikte". Dezelfde regel zat in
//  fn_decision_readiness_check, waardoor blokkerende bewijslast ten onrechte
//  als compleet kon gelden.
//
//  Vervulling loopt sinds 2026-08-18 uitsluitend via de expliciete binding
//  procedure_bewijs.requirement_sleutel. De DB-kant van hetzelfde gedrag
//  staat in supabase/checks/2026_08_18_bewijsbinding.sql — die check en deze
//  sanity gebruiken bewust dezelfde fixture.
// ============================================================

import assert from "node:assert/strict";
import { vervultDocumentRequirement } from "./decision";
import { requirementSleutel } from "./requirement-sleutel";
import { bewijsstukkenSamenvatting } from "./procedure-detail-weergave";
import { bewijslastDekking } from "./procedure-fase-status";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Fixture: stap 1 van pf_wtp_invaarbesluit — drie blokkerende
// document-vereisten, alle zónder documenttype (zoals in seed v2).
const VEREISTEN = [
  "Transitieplan",
  "Formeel invaarverzoek",
  "(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken",
].map((label) => ({
  stap_volgorde: 1,
  requirement_type: "document" as const,
  documenttype: null,
  label,
}));

const sleutelVan = (r: (typeof VEREISTEN)[number]) =>
  requirementSleutel(r.stap_volgorde, r.requirement_type, r.documenttype, r.label);

function bewijs(over: {
  id: string;
  titel?: string | null;
  requirement_sleutel?: string | null;
}) {
  return {
    id: over.id,
    titel: over.titel ?? "Geüpload stuk",
    requirement_sleutel: over.requirement_sleutel ?? null,
  };
}

check("één gebonden stuk vervult precies één van drie vereisten", () => {
  const bewijzen = [
    bewijs({ id: "b1", titel: "Transitieplan", requirement_sleutel: sleutelVan(VEREISTEN[0]) }),
  ];
  const uitkomst = VEREISTEN.map((r) => !!vervultDocumentRequirement(r, bewijzen));
  assert.deepEqual(uitkomst, [true, false, false]);
});

check("de kop toont 3 gevraagd · nog 2 op te voeren", () => {
  const bewijzen = [
    bewijs({ id: "b1", requirement_sleutel: sleutelVan(VEREISTEN[0]) }),
  ];
  const evidence = VEREISTEN.map((r) => ({
    vervuld: !!vervultDocumentRequirement(r, bewijzen),
  }));
  assert.equal(bewijsstukkenSamenvatting(evidence), "3 gevraagd · nog 2 op te voeren");
});

check("blokkerende dekking blijft onvolledig na één upload", () => {
  const bewijzen = [
    bewijs({ id: "b1", requirement_sleutel: sleutelVan(VEREISTEN[0]) }),
  ];
  const dekking = bewijslastDekking(
    VEREISTEN.map((r) => ({
      verplicht: true,
      vervuld: !!vervultDocumentRequirement(r, bewijzen),
    }))
  );
  assert.equal(dekking.verplicht, 3);
  assert.equal(dekking.sluitend, 1);
  assert.equal(dekking.pct, 33);
});

check("een ongebonden bewijsstuk vervult niets — ook niet met kloppende titel", () => {
  // Precies het oude gedrag dat we opruimen: titel-match alleen is niet genoeg.
  const bewijzen = [bewijs({ id: "b1", titel: "Transitieplan" })];
  const uitkomst = VEREISTEN.map((r) => !!vervultDocumentRequirement(r, bewijzen));
  assert.deepEqual(uitkomst, [false, false, false]);
});

check("één bewijsstuk kan nooit meer dan één vereiste vervullen", () => {
  const bewijzen = [
    bewijs({ id: "b1", requirement_sleutel: sleutelVan(VEREISTEN[1]) }),
  ];
  const vervullers = VEREISTEN.map((r) => vervultDocumentRequirement(r, bewijzen))
    .filter((m): m is { id: string; titel: string | null } => m !== null)
    .map((m) => m.id);
  assert.deepEqual(vervullers, ["b1"]);
  assert.equal(new Set(vervullers).size, vervullers.length);
});

check("alle drie gebonden ⇒ alle opgevoerd", () => {
  const bewijzen = VEREISTEN.map((r, i) =>
    bewijs({ id: `b${i}`, requirement_sleutel: sleutelVan(r) })
  );
  const evidence = VEREISTEN.map((r) => ({
    vervuld: !!vervultDocumentRequirement(r, bewijzen),
  }));
  assert.equal(bewijsstukkenSamenvatting(evidence), "3 gevraagd · alle opgevoerd");
});

check("bij meerdere gebonden stukken is de eerste in de lijst de bron", () => {
  // De aanroeper sorteert op (toegevoegd_op, id); deze functie mag dan niet
  // zelf nog een keuze maken, anders is bron_id niet reproduceerbaar.
  const s = sleutelVan(VEREISTEN[0]);
  const match = vervultDocumentRequirement(VEREISTEN[0], [
    bewijs({ id: "oudste", requirement_sleutel: s }),
    bewijs({ id: "nieuwer", requirement_sleutel: s }),
  ]);
  assert.equal(match?.id, "oudste");
});

check("external_submission en consultation binden op hun eigen type", () => {
  const extern = {
    stap_volgorde: 9,
    requirement_type: "external_submission" as const,
    documenttype: null,
    label: "DNB-indiening",
  };
  const gebondenAlsDocument = [
    bewijs({ id: "b1", requirement_sleutel: "9|document|DNB-indiening" }),
  ];
  assert.equal(vervultDocumentRequirement(extern, gebondenAlsDocument), null);
  const gebondenAlsExtern = [
    bewijs({ id: "b1", requirement_sleutel: "9|external_submission|DNB-indiening" }),
  ];
  assert.equal(vervultDocumentRequirement(extern, gebondenAlsExtern)?.id, "b1");
});

check("een dubbele vereistesleutel faalt gesloten", () => {
  const sleutel = sleutelVan(VEREISTEN[0]);
  const match = vervultDocumentRequirement(
    VEREISTEN[0],
    [bewijs({ id: "b1", requirement_sleutel: sleutel })],
    2
  );
  assert.equal(match, null);
});

console.log(`\ndecision.sanity: ${n} checks groen.`);
