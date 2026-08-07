// ============================================================
//  Sanity-tests voor de bijzonderheden-afleiding (besluit 0140).
//
//  Wat hier bevroren wordt:
//   • Een document dat in orde is levert een LEGE lijst — dat is het
//     uitgangspunt van 0140 en de enige reden dat de rest opvalt.
//   • De onderlinge uitsluitingen (inactief sluit alles uit; in verwerking
//     sluit "niet doorzoekbaar" uit) — precies waar de oude inline-booleans
//     stil verkeerd konden gaan.
//   • "Type ontbreekt" en "Metadata onvolledig" zijn ONDERSCHEIDEN meldingen.
//   • De auditmarkering "Tekstherkenning" verdwijnt nooit (besluit 0020/0134).
//   • De traag-drempel verandert de TOELICHTING, niet het label.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/document-bijzonderheden.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  bepaalBijzonderheden,
  telBijzonderheden,
  VERWERKING_TRAAG_MS,
  type DocumentToestand,
} from "./document-bijzonderheden";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-bijzonderheden sanity-tests:");

// Vast referentiemoment — geen Date.now() in de tests zelf.
const NU = Date.parse("2026-08-07T12:00:00.000Z");
const RECENT = new Date(NU - 60_000).toISOString();
const LANG_GELEDEN = new Date(NU - VERWERKING_TRAAG_MS - 60_000).toISOString();

/** Een document dat volledig in orde is. Elke test wijkt hier gericht van af. */
function doc(over: Partial<DocumentToestand> = {}): DocumentToestand {
  return {
    actief: true,
    geindexeerd: true,
    bibliotheek: "fonds",
    bestandstype: "pdf",
    verwerkingsstatus: "beschikbaar",
    ocr_toegepast: false,
    opslag_pad: "fonds/abc.pdf",
    documenttype: "beleid",
    metadata_review_status: "gecontroleerd",
    deactivatie_reden: null,
    aangemaakt: RECENT,
    ...over,
  };
}

const sleutels = (d: DocumentToestand) => bepaalBijzonderheden(d, NU).map((b) => b.sleutel);

// ── Het uitgangspunt ─────────────────────────────────────────────────────────

test("een document dat in orde is levert GEEN bijzonderheden", () => {
  assert.deepEqual(sleutels(doc()), []);
});

test("een geïndexeerd document meldt niet dát het geïndexeerd is", () => {
  // Regressiepin op de aanleiding van 0140: "✓ Geïndexeerd" stond bij ~95% van
  // de documenten en verdrong daarmee de uitzonderingen.
  const b = bepaalBijzonderheden(doc(), NU);
  assert.equal(
    b.some((x) => /geïndexeerd/i.test(x.label)),
    false
  );
});

// ── Onderlinge uitsluitingen ────────────────────────────────────────────────

test("inactief sluit alle andere bijzonderheden uit", () => {
  const s = sleutels(
    doc({
      actief: false,
      geindexeerd: false,
      verwerkingsstatus: "mislukt",
      documenttype: null,
      ocr_toegepast: true,
      deactivatie_reden: "vervangen door versie 2026",
    })
  );
  assert.deepEqual(s, ["inactief"]);
});

test("de deactivatiereden landt in de toelichting, niet in het label", () => {
  const [b] = bepaalBijzonderheden(
    doc({ actief: false, deactivatie_reden: "vervangen door versie 2026" }),
    NU
  );
  assert.equal(b.label, "Inactief");
  assert.match(b.toelichting, /vervangen door versie 2026/);
});

test("een document in verwerking is niet óók 'niet doorzoekbaar'", () => {
  const s = sleutels(doc({ geindexeerd: false, verwerkingsstatus: "embedding" }));
  assert.deepEqual(s, ["in_verwerking"]);
});

test("een mislukt document is niet óók 'niet doorzoekbaar'", () => {
  const s = sleutels(doc({ geindexeerd: false, verwerkingsstatus: "mislukt" }));
  assert.deepEqual(s, ["niet_verwerkt"]);
});

// ── Niet-doorzoekbaar: twee gedaanten ───────────────────────────────────────

test("PDF zonder tekstlaag met beschikbaar origineel → 'Geen tekstlaag'", () => {
  const s = sleutels(doc({ geindexeerd: false, verwerkingsstatus: null }));
  assert.deepEqual(s, ["geen_tekstlaag"]);
});

test("zonder beschikbaar origineel suggereren we geen oorzaak", () => {
  const s = sleutels(
    doc({ geindexeerd: false, verwerkingsstatus: null, opslag_pad: null })
  );
  assert.deepEqual(s, ["niet_doorzoekbaar"]);
});

test("een Word-document zonder index krijgt geen OCR-aanwijzing", () => {
  const s = sleutels(
    doc({ geindexeerd: false, verwerkingsstatus: null, bestandstype: "docx" })
  );
  assert.deepEqual(s, ["niet_doorzoekbaar"]);
});

test("generieke documenten krijgen geen niet-doorzoekbaar-melding (B13: read-only)", () => {
  const s = sleutels(
    doc({ bibliotheek: "generiek", geindexeerd: false, verwerkingsstatus: null })
  );
  assert.deepEqual(s, []);
});

// ── Type vs. metadata: bewust onderscheiden ─────────────────────────────────

test("ontbrekend documenttype meldt 'Type ontbreekt', niet 'Metadata onvolledig'", () => {
  const s = sleutels(doc({ documenttype: null, metadata_review_status: "te_controleren" }));
  assert.deepEqual(s, ["type_ontbreekt"]);
});

test("een document mét type maar met openstaande review meldt 'Metadata onvolledig'", () => {
  const s = sleutels(doc({ metadata_review_status: "te_controleren" }));
  assert.deepEqual(s, ["metadata_onvolledig"]);
});

test("generieke documenten krijgen geen 'Type ontbreekt' (centraal gecureerd)", () => {
  const s = sleutels(doc({ bibliotheek: "generiek", documenttype: null }));
  assert.deepEqual(s, []);
});

// ── Auditmarkering ──────────────────────────────────────────────────────────

test("tekstherkenning blijft zichtbaar bij een verder gaaf document (besluit 0020/0134)", () => {
  const b = bepaalBijzonderheden(doc({ ocr_toegepast: true }), NU);
  assert.deepEqual(
    b.map((x) => x.sleutel),
    ["tekstherkenning"]
  );
  assert.equal(b[0].soort, "audit");
});

test("de auditmarkering staat achteraan, ná wat een handeling vraagt", () => {
  const s = sleutels(doc({ ocr_toegepast: true, metadata_review_status: "te_controleren" }));
  assert.deepEqual(s, ["metadata_onvolledig", "tekstherkenning"]);
});

// ── Traag-drempel ───────────────────────────────────────────────────────────

test("de traag-drempel verandert de toelichting, niet het label", () => {
  const snel = bepaalBijzonderheden(
    doc({ geindexeerd: false, verwerkingsstatus: "extractie", aangemaakt: RECENT }),
    NU
  )[0];
  const traag = bepaalBijzonderheden(
    doc({ geindexeerd: false, verwerkingsstatus: "extractie", aangemaakt: LANG_GELEDEN }),
    NU
  )[0];
  assert.equal(snel.label, traag.label);
  assert.equal(snel.label, "Nog in verwerking");
  assert.notEqual(snel.toelichting, traag.toelichting);
  assert.match(traag.toelichting, /langer dan verwacht/);
});

// ── Formuleringsafspraak (besluit 0140) ─────────────────────────────────────

test("geen enkel label bevat een oordeel of datamodel-jargon", () => {
  // Bevriest de drie formuleringsregels. Kantelt dit, dan is de afspraak
  // bewust of onbewust losgelaten en hoort daar een besluit bij.
  const verboden = /mislukt|geweigerd|verrijk|nog niet/i;
  const alle: DocumentToestand[] = [
    doc({ actief: false }),
    doc({ verwerkingsstatus: "geweigerd" }),
    doc({ geindexeerd: false, verwerkingsstatus: "mislukt" }),
    doc({ geindexeerd: false, verwerkingsstatus: "embedding" }),
    doc({ geindexeerd: false, verwerkingsstatus: null }),
    doc({ geindexeerd: false, verwerkingsstatus: null, opslag_pad: null }),
    doc({ documenttype: null }),
    doc({ metadata_review_status: "te_controleren" }),
    doc({ ocr_toegepast: true }),
  ];
  for (const d of alle) {
    for (const b of bepaalBijzonderheden(d, NU)) {
      assert.equal(
        verboden.test(b.label),
        false,
        `label "${b.label}" bevat een oordeel of jargon`
      );
    }
  }
});

// ── Groepssamenvatting ──────────────────────────────────────────────────────

test("telBijzonderheden telt documenten, niet meldingen", () => {
  const r = telBijzonderheden(
    [
      doc(),
      doc({ documenttype: null, ocr_toegepast: true }), // twee meldingen, één document
      doc(),
    ],
    NU
  );
  assert.equal(r.met, 1);
});

test("de zwaarste soort wint in de samenvatting", () => {
  const r = telBijzonderheden(
    [doc({ ocr_toegepast: true }), doc({ geindexeerd: false, verwerkingsstatus: "mislukt" })],
    NU
  );
  assert.equal(r.met, 2);
  assert.equal(r.zwaarste, "fout");
});

test("een groep zonder bijzonderheden geeft zwaarste = null", () => {
  const r = telBijzonderheden([doc(), doc()], NU);
  assert.deepEqual(r, { met: 0, zwaarste: null });
});

console.log(`\n${n} sanity-tests geslaagd.\n`);
