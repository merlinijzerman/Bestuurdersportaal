// ============================================================================
//  Sanity-tests #504 — formulier → validatie → diff van curatieBijwerken.
//  Uitvoeren: npx tsx platform/lib/generiek-curatie-diff.sanity.ts
//
//  Dekt het serverpad van de datumvelden precies zoals curatieBijwerken het
//  doorloopt: leesCuratieInvoer(FormData) → valideerGeneriekeCuratie →
//  bouwCuratieDiff(huidige rij, meta). De DB-kant (RPC + triggers, klein en
//  ~1.000 chunks) staat in supabase/checks/2026_09_30_504_curatie_datumvelden.sql.
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { valideerGeneriekeCuratie } from "../../core/lib/generiek-curatie-juridisch";
import {
  BEWERKBARE_CURATIEVELDEN,
  bouwCuratieDiff,
  leesCuratieInvoer,
} from "./generiek-curatie-diff";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}
console.log("generiek-curatie-diff sanity-tests (#504):");

// De Pensioenwet na de eerste (geslaagde) opslag van 29-09-2026: negen velden
// gezet, de drie datums nog NULL. Vorm = de select van curatieBijwerken.
const PENSIOENWET: Record<string, unknown> = {
  id: "a62e757b-9102-4ba3-ba6b-b33b21705fbd",
  titel: "Pensioenwet",
  bron: "Extern",
  bronorganisatie: "Overheid",
  extern_url: "https://wetten.overheid.nl/BWBR0020809",
  normgewicht: "bindend",
  documentdatum: null,
  geldig_vanaf: null,
  geldig_tot: null,
  status: "van_kracht",
  bronstatus: "actief",
  toepassingsgebied: "pensioenuitvoering",
  regelingstype: "algemeen",
  doelgroep: "bestuur",
  thema: "wetgeving",
  statusinterpretatie: "Actuele geconsolideerde tekst",
  eigenaar: "juridisch",
  volgende_review: null,
  versie: "2026-01-01",
  bibliotheek: "generiek",
  documenttype: "wetgeving",
  wetsgeschiedenis_subtype: null,
  dossiernummer: null,
  wettelijk_regime: "pw",
};

// Wat bouwFormData in de client verstuurt (alle FormState-sleutels als string).
function formulier(rij: Record<string, unknown>, over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const s = (k: string) => (rij[k] == null ? "" : String(rij[k]));
  for (const k of [
    "titel", "bron", "bronorganisatie", "extern_url", "normgewicht", "documentdatum",
    "geldig_vanaf", "geldig_tot", "bronstatus", "toepassingsgebied", "regelingstype",
    "doelgroep", "thema", "statusinterpretatie", "documenttype", "wetsgeschiedenis_subtype",
    "dossiernummer", "wettelijk_regime", "eigenaar", "volgende_review", "versie",
  ]) fd.set(k, s(k));
  fd.set("documentstatus", s("status"));
  fd.set("reden", "");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

function diffVan(rij: Record<string, unknown>, fd: FormData) {
  const v = valideerGeneriekeCuratie(leesCuratieInvoer(fd));
  assert.ok(v.ok, `validatie faalde: ${JSON.stringify(!v.ok && v.fouten)}`);
  return bouwCuratieDiff(rij, v.waarde);
}

const DATUMS = { documentdatum: "2026-01-01", geldig_vanaf: "2026-01-01", volgende_review: "2026-12-15" };

test("KERN: de drie Pensioenwet-datums geven precies drie wijzigingen + drie auditregels", () => {
  const { update, logRijen } = diffVan(PENSIOENWET, formulier(PENSIOENWET, DATUMS));
  assert.deepEqual(update, DATUMS);
  assert.deepEqual(
    logRijen.map((r) => [r.veld_naam, r.oude_waarde, r.nieuwe_waarde, r.wijzig_type]),
    [
      ["documentdatum", null, "2026-01-01", "metadata"],
      ["geldig_vanaf", null, "2026-01-01", "metadata"],
      ["volgende_review", null, "2026-12-15", "metadata"],
    ]
  );
});

test("auditset dekt exact de wijziging (RPC-eis: sleutels = veld_namen)", () => {
  const { update, logRijen } = diffVan(PENSIOENWET, formulier(PENSIOENWET, DATUMS));
  assert.deepEqual(Object.keys(update).sort(), logRijen.map((r) => r.veld_naam).sort());
});

test("documentdatum/geldig_vanaf zijn RAG-relevant (chunk-denorm), volgende_review ook (review-gate)", () => {
  const { logRijen } = diffVan(PENSIOENWET, formulier(PENSIOENWET, DATUMS));
  assert.ok(logRijen.every((r) => r.rag_impact));
  const { logRijen: thema } = diffVan(PENSIOENWET, formulier(PENSIOENWET, { thema: "anders" }));
  assert.equal(thema[0].rag_impact, false, "niet-denormveld blijft rag_impact=false");
});

test("tweede opslag met identieke waarden → lege diff ('Geen wijzigingen.')", () => {
  const na = { ...PENSIOENWET, ...DATUMS };
  const { update, logRijen } = diffVan(na, formulier(na));
  assert.deepEqual(update, {});
  assert.equal(logRijen.length, 0);
});

test("een tijdstempel uit de DB telt als dezelfde kalenderdag (geen schijnwijziging)", () => {
  const na = { ...PENSIOENWET, documentdatum: "2026-01-01T00:00:00+00:00", geldig_vanaf: "2026-01-01", volgende_review: "2026-12-15" };
  const { update } = diffVan(na, formulier(na, DATUMS));
  assert.deepEqual(update, {});
});

test("leegmaken is toegestaan: → NULL met auditregel (oud → null)", () => {
  const na = { ...PENSIOENWET, ...DATUMS };
  const { update, logRijen } = diffVan(na, formulier(na, { volgende_review: "", geldig_vanaf: "  " }));
  assert.deepEqual(update, { geldig_vanaf: null, volgende_review: null });
  assert.deepEqual(
    logRijen.map((r) => [r.veld_naam, r.oude_waarde, r.nieuwe_waarde]),
    [["geldig_vanaf", "2026-01-01", null], ["volgende_review", "2026-12-15", null]]
  );
});

test("leegmaken van documentdatum bij wetsgeschiedenis wordt gevalideerd geweigerd", () => {
  const mvt: Record<string, unknown> = {
    ...PENSIOENWET,
    titel: "Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3",
    documenttype: "wetsgeschiedenis",
    wetsgeschiedenis_subtype: "memorie_van_toelichting",
    dossiernummer: "36067",
    wettelijk_regime: "beide",
    normgewicht: "informatief",
    extern_url: "https://zoek.officielebekendmakingen.nl/kst-36067-3.html",
    documentdatum: "2022-03-30",
  };
  assert.ok(valideerGeneriekeCuratie(leesCuratieInvoer(formulier(mvt))).ok, "uitgangssituatie geldig");
  const v = valideerGeneriekeCuratie(leesCuratieInvoer(formulier(mvt, { documentdatum: "" })));
  assert.equal(v.ok, false);
  assert.match((!v.ok && v.fouten.documentdatum) || "", /verplicht/);
});

test("ongeldige datum wordt geweigerd (geen stille NULL)", () => {
  const v = valideerGeneriekeCuratie(leesCuratieInvoer(formulier(PENSIOENWET, { documentdatum: "01-01-2026" })));
  assert.equal(v.ok, false);
  assert.ok(!v.ok && v.fouten.documentdatum);
});

test("veldlijst van de app = §8.1-allowlist van de RPC (c_toegestaan)", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/2026_09_30_499_generieke_metadatawijziging_timeout.sql"),
    "utf8"
  );
  const blok = sql.match(/c_toegestaan constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(blok, "c_toegestaan niet gevonden");
  const rpc = [...blok[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...BEWERKBARE_CURATIEVELDEN].sort(), rpc);
  for (const d of ["documentdatum", "geldig_vanaf", "volgende_review"]) assert.ok(rpc.includes(d));
});

test("status-/normgewicht-/regimewijziging blijft ongewijzigd verwerkt", () => {
  const { logRijen } = diffVan(
    PENSIOENWET,
    formulier(PENSIOENWET, { bronstatus: "historisch", normgewicht: "toezichtverwachting", wettelijk_regime: "beide" })
  );
  assert.deepEqual(
    logRijen.map((r) => [r.veld_naam, r.wijzig_type, r.rag_impact]),
    [
      ["normgewicht", "metadata", true],
      ["bronstatus", "bronstatus", true],
      ["wettelijk_regime", "metadata", true],
    ]
  );
});

console.log(`\n${n} sanity-tests groen.`);
