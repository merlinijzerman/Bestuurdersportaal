// ============================================================
//  Sanity-tests voor lib/wetsgeschiedenis.ts + valideerGeneriekeCuratie
//  (lib/generiek-curatie-juridisch.ts) — wetsgeschiedenis A-light.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/wetsgeschiedenis.sanity.ts
//  Verifieert: dossiernummernormalisatie, geldige/ongeldige type-/subtype-
//  combinaties, aangenomen amendement = informatief (nooit bindend),
//  regimeplicht, DB-spiegel van de CHECK-lijsten, en non-regressie voor
//  bestaande documenttypen en de fondsflows.
// ============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DOSSIERNUMMER_PATROON,
  JURIDISCHE_DOCUMENTTYPEN,
  WETSGESCHIEDENIS_SUBTYPEN,
  formatteerDossiernummer,
  juridischeDuiding,
  juridischeDocumentstatusLabel,
  juridischStatusveldLabel,
  normaliseerDossiernummer,
  titelBevatDossiernummer,
  titelBevatStaatsblad,
  isDossiernummerVerplicht,
  valideerJuridischeMetadata,
} from "./wetsgeschiedenis";
import { isStandaardZichtbaarInRag } from "./generiek-curatie";
import {
  valideerGeneriekeCuratie as valideerCuratie,
  type JuridischeCuratieInvoer as CuratieInvoer,
} from "./generiek-curatie-juridisch";
import { DOCUMENTTYPEN } from "./document-metadata";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("wetsgeschiedenis sanity-tests:");

const MVT: CuratieInvoer = {
  titel: "Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3",
  documenttype: "wetsgeschiedenis",
  wetsgeschiedenis_subtype: "memorie_van_toelichting",
  dossiernummer: "36 067",
  wettelijk_regime: "beide",
  extern_url: "https://zoek.officielebekendmakingen.nl/kst-36067-3.html",
  documentdatum: "2022-03-30",
  bronorganisatie: "Tweede Kamer der Staten-Generaal",
};

const AMENDEMENT: CuratieInvoer = {
  ...MVT,
  titel: "Amendement — Kamerstukken II 2022/23, 36 067, nr. 97",
  wetsgeschiedenis_subtype: "aangenomen_amendement",
  extern_url: "https://zoek.officielebekendmakingen.nl/kst-36067-97.html",
};

const WET: CuratieInvoer = {
  titel: "Pensioenwet — geconsolideerde tekst (BWBR0020809), geldend vanaf 2025-01-01",
  documenttype: "wetgeving",
  wettelijk_regime: "pw",
  normgewicht: "bindend",
  extern_url: "https://wetten.overheid.nl/BWBR0020809",
  documentdatum: "2025-01-01",
};

// ── Dossiernummernormalisatie ───────────────────────────────────────────────
check("dossiernummer: gangbare notaties → canonieke opslagvorm", () => {
  const gevallen: [string, string][] = [
    ["36 067", "36067"],
    ["36067", "36067"],
    ["36.067", "36067"],
    ["  36 067 ", "36067"], // harde spatie
    ["36 067", "36067"], // smalle spatie
    ["36 200-XV", "36200-XV"],
    ["36200 xv", "36200-XV"],
    ["36 200 – XV", "36200-XV"],
    ["123", "123"],
  ];
  for (const [invoer, verwacht] of gevallen) {
    const r = normaliseerDossiernummer(invoer);
    assert.deepEqual(r, { ok: true, waarde: verwacht }, invoer);
    assert.ok(DOSSIERNUMMER_PATROON.test(verwacht), `DB-patroon accepteert ${verwacht}`);
  }
});

check("dossiernummer: leeg → null, onherkenbaar → fout", () => {
  assert.deepEqual(normaliseerDossiernummer(""), { ok: true, waarde: null });
  assert.deepEqual(normaliseerDossiernummer("   "), { ok: true, waarde: null });
  assert.deepEqual(normaliseerDossiernummer(null), { ok: true, waarde: null });
  for (const fout of ["12", "abc", "36 067, nr. 3", "1234567", "36-067-3", "kst-36067-3"]) {
    assert.equal(normaliseerDossiernummer(fout).ok, false, fout);
  }
});

check("dossiernummer: weergave groepeert per duizendtal", () => {
  assert.equal(formatteerDossiernummer("36067"), "36 067");
  assert.equal(formatteerDossiernummer("36200-XV"), "36 200-XV");
  assert.equal(formatteerDossiernummer("123"), "123");
  assert.equal(formatteerDossiernummer(null), "");
});

check("titel moet het dossiernummer bevatten (spatie-ongevoelig)", () => {
  assert.equal(titelBevatDossiernummer(MVT.titel as string, "36067"), true);
  assert.equal(titelBevatDossiernummer("Kamerstukken II, 36067, nr. 3", "36067"), true);
  assert.equal(titelBevatDossiernummer("Memorie van toelichting Wtp", "36067"), false);
});

// ── Geldige combinaties ─────────────────────────────────────────────────────
check("MvT met volledige metadata → geldig, genormaliseerd, informatief", () => {
  const r = valideerCuratie({ ...MVT });
  assert.equal(r.ok, true, JSON.stringify(!r.ok && r.fouten));
  if (r.ok) {
    assert.equal(r.waarde.documenttype, "wetsgeschiedenis");
    assert.equal(r.waarde.wetsgeschiedenis_subtype, "memorie_van_toelichting");
    assert.equal(r.waarde.dossiernummer, "36067");
    assert.equal(r.waarde.wettelijk_regime, "beide");
    assert.equal(r.waarde.normgewicht, "informatief");
    assert.equal(r.waarde.bibliotheek, "generiek");
  }
});

check("elk subtype is geldig bij wetsgeschiedenis", () => {
  for (const st of WETSGESCHIEDENIS_SUBTYPEN) {
    // Een nota van toelichting vereist een Staatsbladverwijzing in de titel.
    const titel =
      st === "nota_van_toelichting"
        ? "Nota van toelichting — Besluit transitietermijnen, Stb. 2025, 423 (Kamerstukken 36 067)"
        : MVT.titel;
    const r = valideerCuratie({ ...MVT, titel, wetsgeschiedenis_subtype: st });
    assert.equal(r.ok, true, `${st}: ${JSON.stringify(!r.ok && r.fouten)}`);
  }
});

check("actuele wetgeving kan als bindende bron worden gecureerd", () => {
  const r = valideerCuratie({ ...WET });
  assert.equal(r.ok, true, JSON.stringify(!r.ok && r.fouten));
  if (r.ok) {
    assert.equal(r.waarde.documenttype, "wetgeving");
    assert.equal(r.waarde.normgewicht, "bindend");
    assert.equal(r.waarde.wetsgeschiedenis_subtype, null);
    assert.equal(r.waarde.dossiernummer, null);
  }
});

check("statusweergave onderscheidt geldende norm van gepubliceerde wetsgeschiedenis", () => {
  assert.equal(juridischStatusveldLabel("wetgeving"), "Geldigheidsstatus");
  assert.equal(juridischStatusveldLabel("wetsgeschiedenis"), "Publicatiestatus");
  assert.equal(juridischStatusveldLabel("memo"), null);
  assert.equal(
    juridischeDocumentstatusLabel("wetgeving", "van_kracht"),
    "Van kracht (actuele norm)"
  );
  assert.equal(
    juridischeDocumentstatusLabel("wetsgeschiedenis", "van_kracht"),
    "Gepubliceerd (actieve, informatieve bron)"
  );
  assert.doesNotMatch(
    juridischeDocumentstatusLabel("wetsgeschiedenis", "van_kracht") ?? "",
    /van kracht/i
  );
});

// ── Memorie van antwoord en nota van toelichting ───────────────────────────
const NVT: CuratieInvoer = {
  titel: "Nota van toelichting — Besluit toekomst pensioenen, Stb. 2023, 217",
  documenttype: "wetsgeschiedenis",
  wetsgeschiedenis_subtype: "nota_van_toelichting",
  wettelijk_regime: "beide",
  extern_url: "https://zoek.officielebekendmakingen.nl/stb-2023-217.html",
  documentdatum: "2023-06-22",
};

check("dossiernummer alleen optioneel bij nota van toelichting", () => {
  assert.equal(isDossiernummerVerplicht("nota_van_toelichting"), false);
  for (const st of WETSGESCHIEDENIS_SUBTYPEN.filter((s) => s !== "nota_van_toelichting")) {
    assert.equal(isDossiernummerVerplicht(st), true, st);
  }
});

check("nadere memorie van antwoord (EK) → subtype memorie_van_antwoord, dossier verplicht", () => {
  const mva: CuratieInvoer = {
    ...MVT,
    titel: "Nadere memorie van antwoord — Kamerstukken I 2022/23, 36 067, K",
    wetsgeschiedenis_subtype: "memorie_van_antwoord",
    extern_url: "https://zoek.officielebekendmakingen.nl/kst-36067-K.html",
  };
  const r = valideerCuratie(mva);
  assert.equal(r.ok, true, JSON.stringify(!r.ok && r.fouten));
  if (r.ok) {
    assert.equal(r.waarde.wetsgeschiedenis_subtype, "memorie_van_antwoord");
    assert.equal(r.waarde.dossiernummer, "36067");
    assert.equal(r.waarde.normgewicht, "informatief");
  }
  const zonder = valideerCuratie({ ...mva, dossiernummer: "" });
  assert.equal(zonder.ok, false);
  if (!zonder.ok) assert.match(zonder.fouten.dossiernummer, /verplicht/);
});

check("nota van toelichting zonder dossier, met Staatsblad in titel → geldig, informatief", () => {
  const r = valideerCuratie({ ...NVT });
  assert.equal(r.ok, true, JSON.stringify(!r.ok && r.fouten));
  if (r.ok) {
    assert.equal(r.waarde.dossiernummer, null);
    assert.equal(r.waarde.normgewicht, "informatief");
    assert.equal(r.waarde.extern_url, NVT.extern_url);
  }
});

check("nota van toelichting zonder Staatsbladnummer in titel → fout op titel", () => {
  const r = valideerCuratie({ ...NVT, titel: "Nota van toelichting Besluit toekomst pensioenen" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.fouten.titel, /Staatsbladnummer/);
});

check("nota van toelichting: bindend geweigerd, URL verplicht", () => {
  const b = valideerCuratie({ ...NVT, normgewicht: "bindend" });
  assert.equal(b.ok, false);
  if (!b.ok) assert.ok(b.fouten.normgewicht);
  const u = valideerCuratie({ ...NVT, extern_url: "" });
  assert.equal(u.ok, false);
  if (!u.ok) assert.ok(u.fouten.extern_url);
});

check("Staatsbladherkenning", () => {
  for (const t of ["Stb. 2023, 217", "Stb 2025, 423", "Staatsblad 2023, nr. 217", "x — stb. 2023,217"]) {
    assert.equal(titelBevatStaatsblad(t), true, t);
  }
  for (const t of ["Besluit toekomst pensioenen", "Kamerstukken II 2021/22, 36 067, nr. 3", "Stb. 23"]) {
    assert.equal(titelBevatStaatsblad(t), false, t);
  }
});

check("duiding MvA en NvT: wetsgeschiedenis, geen norm", () => {
  assert.equal(
    juridischeDuiding("wetsgeschiedenis", "memorie_van_antwoord")?.label,
    "Memorie van antwoord — wetsgeschiedenis, geen norm"
  );
  assert.equal(juridischeDuiding("wetsgeschiedenis", "nota_van_toelichting")?.magNormDragen, false);
});

// ── Aangenomen amendement: informatief, nooit bindend ──────────────────────
check("aangenomen amendement zonder normgewicht → afgedwongen 'informatief'", () => {
  const r = valideerCuratie({ ...AMENDEMENT });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.waarde.normgewicht, "informatief");
    // Informatief = wél standaard vindbaar, maar geen norm.
    assert.equal(isStandaardZichtbaarInRag(r.waarde.normgewicht), true);
  }
});

check("aangenomen amendement met 'bindend' (of ander gewicht) → validatiefout", () => {
  for (const ng of ["bindend", "toezichtverwachting", "sector_guidance", "onbekend"]) {
    const r = valideerCuratie({ ...AMENDEMENT, normgewicht: ng });
    assert.equal(r.ok, false, ng);
    if (!r.ok) assert.match(r.fouten.normgewicht, /geen zelfstandige norm/);
  }
});

check("aangenomen amendement met expliciet 'informatief' → geldig", () => {
  const r = valideerCuratie({ ...AMENDEMENT, normgewicht: "informatief" });
  assert.equal(r.ok, true);
});

check("duiding: wetsgeschiedenis draagt nooit een norm; wet wel", () => {
  const am = juridischeDuiding("wetsgeschiedenis", "aangenomen_amendement");
  assert.deepEqual(am, {
    rol: "wetsgeschiedenis",
    magNormDragen: false,
    label: "Aangenomen amendement — wetsgeschiedenis, geen zelfstandige norm",
  });
  assert.equal(
    juridischeDuiding("wetsgeschiedenis", "memorie_van_toelichting")?.label,
    "Memorie van toelichting — wetsgeschiedenis, geen norm"
  );
  assert.equal(juridischeDuiding("wetgeving", null)?.magNormDragen, true);
  assert.equal(juridischeDuiding("beleid", null), null);
  assert.equal(juridischeDuiding(null, null), null);
});

// ── Ongeldige combinaties → begrijpelijke fouten ────────────────────────────
check("wetsgeschiedenis zonder subtype → fout op subtype", () => {
  const r = valideerCuratie({ ...MVT, wetsgeschiedenis_subtype: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.fouten.wetsgeschiedenis_subtype, /soort parlementair stuk/);
});

check("wetsgeschiedenis met onbekend subtype (bv. verworpen amendement) → fout", () => {
  for (const st of ["amendement", "verworpen_amendement", "ingetrokken_amendement"]) {
    const r = valideerCuratie({ ...MVT, wetsgeschiedenis_subtype: st });
    assert.equal(r.ok, false, st);
    if (!r.ok) assert.ok(r.fouten.wetsgeschiedenis_subtype);
  }
});

check("wetsgeschiedenis zonder of met ongeldig dossiernummer → fout", () => {
  const leeg = valideerCuratie({ ...MVT, dossiernummer: "" });
  assert.equal(leeg.ok, false);
  if (!leeg.ok) assert.match(leeg.fouten.dossiernummer, /verplicht/);
  const fout = valideerCuratie({ ...MVT, dossiernummer: "nr. 3" });
  assert.equal(fout.ok, false);
  if (!fout.ok) assert.match(fout.fouten.dossiernummer, /Ongeldig dossiernummer/);
});

check("titel zonder dossierverwijzing → fout op titel", () => {
  const r = valideerCuratie({ ...MVT, titel: "Memorie van toelichting Wtp" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.fouten.titel, /volledige officiële verwijzing/);
});

check("wetsgeschiedenis zonder documentdatum → fout", () => {
  const r = valideerCuratie({ ...MVT, documentdatum: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.documentdatum);
});

check("juridisch type zonder concreet regime (leeg of 'algemeen') → fout", () => {
  for (const regime of ["", "algemeen"]) {
    for (const basis of [MVT, WET]) {
      const r = valideerCuratie({ ...basis, wettelijk_regime: regime });
      assert.equal(r.ok, false, `${basis.documenttype}/${regime}`);
      if (!r.ok) assert.match(r.fouten.wettelijk_regime, /Pensioenwet, Wvb of beide/);
    }
  }
});

check("juridisch type zonder officiële URL → fout", () => {
  for (const basis of [MVT, WET]) {
    const r = valideerCuratie({ ...basis, extern_url: "" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.fouten.extern_url);
  }
});

check("subtype of dossiernummer bij ander type dan wetsgeschiedenis → fout", () => {
  const a = valideerCuratie({ ...WET, wetsgeschiedenis_subtype: "memorie_van_toelichting" });
  assert.equal(a.ok, false);
  if (!a.ok) assert.ok(a.fouten.wetsgeschiedenis_subtype);
  const b = valideerCuratie({ ...WET, dossiernummer: "36 067" });
  assert.equal(b.ok, false);
  if (!b.ok) assert.ok(b.fouten.dossiernummer);
  const c = valideerCuratie({ titel: "DNB Beleidsregel", dossiernummer: "36067" });
  assert.equal(c.ok, false);
});

check("onbekend documenttype of regime → fout", () => {
  const t = valideerCuratie({ titel: "x", documenttype: "staatsblad" });
  assert.equal(t.ok, false);
  if (!t.ok) assert.ok(t.fouten.documenttype);
  const r = valideerCuratie({ titel: "x", wettelijk_regime: "ftk" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.wettelijk_regime);
});

// ── Non-regressie bestaande generieke documenten ────────────────────────────
check("zonder juridische velden: gedrag ongewijzigd (nieuwe velden null)", () => {
  const r = valideerCuratie({ titel: "DNB Beleidsregel", normgewicht: "toezichtverwachting" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.waarde.normgewicht, "toezichtverwachting");
    assert.equal(r.waarde.documenttype, null);
    assert.equal(r.waarde.wetsgeschiedenis_subtype, null);
    assert.equal(r.waarde.dossiernummer, null);
    assert.equal(r.waarde.wettelijk_regime, null);
  }
});

check("bestaand generiek document met historisch fondstype blijft bewerkbaar", () => {
  for (const t of DOCUMENTTYPEN) {
    const r = valideerCuratie({ titel: "x", documenttype: t });
    assert.equal(r.ok, true, t);
    if (r.ok) assert.equal(r.waarde.documenttype, t);
  }
});

check("regime is optioneel en geldig voor niet-juridische generieke documenten", () => {
  for (const regime of ["pw", "wvb", "beide", "algemeen"]) {
    const r = valideerCuratie({ titel: "x", wettelijk_regime: regime });
    assert.equal(r.ok, true, regime);
  }
});

check("fondsflow: juridische typen zitten NIET in DOCUMENTTYPEN", () => {
  for (const t of JURIDISCHE_DOCUMENTTYPEN) {
    assert.equal((DOCUMENTTYPEN as string[]).includes(t), false, t);
  }
});

check("directe aanroep: niet-juridisch type levert geen afgedwongen normgewicht", () => {
  const u = valideerJuridischeMetadata({
    documenttype: "beleid",
    wetsgeschiedenis_subtype: null,
    dossiernummer: null,
    normgewicht: "bindend",
    wettelijk_regime: null,
    titel: "x",
    extern_url: null,
    documentdatum: null,
  });
  assert.deepEqual(u.fouten, {});
  assert.equal(u.normgewichtAfgedwongen, null);
});

// ── DB-spiegel: de migratie accepteert exact dezelfde waarden ───────────────
check("migratie spiegelt subtype-lijst, documenttypen en dossierpatroon", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/2026_09_23_wetsgeschiedenis_a_light_foundation.sql"),
    "utf8"
  );
  for (const st of WETSGESCHIEDENIS_SUBTYPEN) assert.ok(sql.includes(`'${st}'`), st);
  for (const t of [...DOCUMENTTYPEN, ...JURIDISCHE_DOCUMENTTYPEN]) {
    assert.ok(sql.includes(`'${t}'`), t);
  }
  assert.ok(sql.includes(`'^[0-9]{3,6}(-[A-Z0-9]{1,8})?$'`), "dossierpatroon");
  assert.equal(DOSSIERNUMMER_PATROON.source, "^[0-9]{3,6}(-[A-Z0-9]{1,8})?$");
  assert.ok(/coalesce\(normgewicht, ''\) = 'informatief'/.test(sql), "informatief-plicht");
  // Dossier-uitzondering in de DB exact gelijk aan SUBTYPEN_DOSSIER_OPTIONEEL.
  assert.ok(/or wetsgeschiedenis_subtype = 'nota_van_toelichting'\)/.test(sql), "NvT-uitzondering");
});

console.log(`\n${n} sanity-tests geslaagd.`);
