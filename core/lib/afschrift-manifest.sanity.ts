// ============================================================
//  Sanity-tests voor het afschrift-manifest (T6, C3).
//
//  Het manifest bewijst volledigheid + integriteit (AC 2). Deze tests borgen:
//  bestandsaantal == aantal bestanden, stabiele sha256, dat uitgesloten_items
//  en waarschuwingen verplicht meegaan, en dat de gezichtshoek-zin (RLS-lens)
//  in de exportcontext staat.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/afschrift-manifest.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import type { AfschriftContext } from "./afschrift-types";
import { bouwManifest, sha256Hex, MANIFEST_FORMAAT } from "./afschrift-manifest";
import type { ManifestBestand, UitgeslotenItem, ManifestWaarschuwing, SnapshotHash } from "./afschrift-manifest";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function context(): AfschriftContext {
  return {
    afschriftId: "afs-1", procescode: "B-2026-001", versie: "besluitmoment",
    aanleiding: "t.b.v. jaarrekeningcontrole 2026", aangemaaktOp: "2026-08-09T12:00:00.000Z",
    aangemaaktDoorNaam: "M. IJzerman", gebouwdOnderRol: "voorzitter", generatorVersie: "t6-1.0",
  };
}

console.log("afschrift-manifest sanity-tests:");

test("sha256Hex is stabiel en gelijk voor string en gelijke bytes", () => {
  const a = sha256Hex("hallo");
  const b = sha256Hex(Buffer.from("hallo", "utf8"));
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(sha256Hex("hallo"), sha256Hex("hallo2"));
});

test("bestandsaantal == aantal bestanden, en de bestandslijst gaat 1-op-1 mee (AC 2)", () => {
  const bestanden: ManifestBestand[] = [
    { pad: "MANIFEST.json", bytes: 10, sha256: "a".repeat(64) },
    { pad: "02_Tijdlijn.csv", bytes: 20, sha256: "b".repeat(64) },
    { pad: "04_Bijlagen/B01_beleid_ALM.pdf", bytes: 30, sha256: "c".repeat(64) },
  ];
  const { manifest } = bouwManifest({
    context: context(), bestanden, snapshotHashes: [], uitgeslotenItems: [],
    waarschuwingen: [], hoogsteVertrouwelijkheid: "vertrouwelijk", aantalBesluiten: 2, bevatStemgedrag: true, inhoudHash: "d".repeat(64),
  });
  // bestandsaantal telt óók MANIFEST.json zelf (dat niet in de lijst staat).
  assert.equal(manifest.integriteit.bestandsaantal, 4);
  assert.equal(manifest.integriteit.bestanden.length, 3);
  assert.equal(manifest.formaat, MANIFEST_FORMAAT);
  assert.equal(manifest.afschrift.bevat_stemgedrag, true);
});

test("uitgesloten_items en waarschuwingen zijn verplichte, meegedragen velden", () => {
  const uitgesloten: UitgeslotenItem[] = [
    { pad: null, type: "bewijs", titel: "Mondelinge toelichting", reden: "geen_bestand" },
    { pad: null, type: "bijlage", titel: "Oude notulen", reden: "ingetrokken", detail: "actief=false" },
  ];
  const waarschuwingen: ManifestWaarschuwing[] = [
    { pad: "04_Bijlagen/B02_notulen.pdf", melding: "Mogelijk een andere versie dan ten tijde van het besluit (vervangen_door_document_id gevuld)." },
  ];
  const { manifest } = bouwManifest({
    context: context(), bestanden: [], snapshotHashes: [], uitgeslotenItems: uitgesloten,
    waarschuwingen, hoogsteVertrouwelijkheid: "intern", aantalBesluiten: 1, bevatStemgedrag: false, inhoudHash: "d".repeat(64),
  });
  assert.equal(manifest.uitgesloten_items.length, 2);
  assert.ok(manifest.uitgesloten_items.some((u) => u.reden === "geen_bestand"));
  assert.ok(manifest.uitgesloten_items.some((u) => u.reden === "ingetrokken"));
  assert.equal(manifest.waarschuwingen.length, 1);
});

test("gezichtshoek-zin (RLS-lens) staat in de exportcontext, met rol en datum", () => {
  const { manifest } = bouwManifest({
    context: context(), bestanden: [], snapshotHashes: [], uitgeslotenItems: [],
    waarschuwingen: [], hoogsteVertrouwelijkheid: "intern", aantalBesluiten: 1, bevatStemgedrag: false, inhoudHash: "d".repeat(64),
  });
  assert.ok(manifest.export_context.gezichtshoek.includes("voorzitter"));
  assert.ok(manifest.export_context.gezichtshoek.includes("2026-08-09"));
  assert.ok(manifest.integriteit.opmerking_hashketen.includes("procedure_log"));
});

test("snapshot-hashes gaan mee (besluitmoment-integriteit)", () => {
  const snaps: SnapshotHash[] = [
    { besluit_code: "B-2026-001", trigger_status: "besloten", hash: "f".repeat(64) },
  ];
  const { manifest, json } = bouwManifest({
    context: context(), bestanden: [], snapshotHashes: snaps, uitgeslotenItems: [],
    waarschuwingen: [], hoogsteVertrouwelijkheid: "intern", aantalBesluiten: 1, bevatStemgedrag: false, inhoudHash: "d".repeat(64),
  });
  assert.equal(manifest.integriteit.snapshot_hashes.length, 1);
  // JSON round-trip
  const parsed = JSON.parse(json);
  assert.equal(parsed.integriteit.snapshot_hashes[0].besluit_code, "B-2026-001");
});

console.log(`\nafschrift-manifest: ${n} tests groen.`);
