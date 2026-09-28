import assert from "node:assert/strict";
import {
  selecteerSharePointMapDocumenten,
  SHAREPOINT_MAP_MAX_DOCUMENTEN,
  type MapDocumentKandidaat,
} from "./microsoft-sharepoint-map-ai-core";

const docs: MapDocumentKandidaat[] = Array.from({ length: 9 }, (_, i) => ({
  ref: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  naam: i === 8 ? "Zandloperbaken beleidsnotitie.docx" : `Stuk ${i}.docx`,
  bestandstype: "docx",
  grootte: 10_000,
  gewijzigdOp: `2026-09-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
  mappad: i === 7 ? "Andere map" : i === 6 ? "Bestuur/Submap" : "Bestuur",
}));

const selectie = selecteerSharePointMapDocumenten(docs, "Bestuur", "Wat zegt Zandloperbaken?");
assert.equal(selectie.documenten.length, SHAREPOINT_MAP_MAX_DOCUMENTEN);
assert.equal(selectie.documenten[0].naam, "Zandloperbaken beleidsnotitie.docx");
assert.equal(selectie.totaalOnderMap, 8);
assert.equal(selectie.ondersteundOnderMap, 8);
assert.equal(selectie.afgekapt, true);
assert.ok(!selectie.documenten.some((d) => d.mappad === "Andere map"));

const ongeschikt = selecteerSharePointMapDocumenten([
  { ...docs[0], bestandstype: "doc" },
  { ...docs[1], grootte: 26 * 1024 * 1024 },
], "Bestuur", "vraag");
assert.equal(ongeschikt.documenten.length, 0);
assert.equal(ongeschikt.totaalOnderMap, 2);
assert.equal(ongeschikt.ondersteundOnderMap, 0);

console.log("  ✓ SharePoint-mapselectie is vraaggestuurd, recursief en begrensd");
