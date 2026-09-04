// ============================================================
//  Sanity-tests voor platform/lib/monitoring-signalen.ts (P5).
//
//  Drie dingen worden hier geborgd, en het zijn precies de drie waar een
//  monitoringlaag stil kan falen:
//
//   1. STATUSBEPALING op de drempelranden — een off-by-one maakt het verschil
//      tussen "rood" en "we hebben niets gezien".
//   2. VEROUDERING — een stilgevallen snapshot-job moet GRIJS opleveren, nooit
//      groen. Dat is de les uit bevinding T-01, en de enige manier om te weten
//      dat hij werkt is hem programmatisch na te rekenen.
//   3. N-DREMPEL — onder n<10 (besluit 0055) mag er geen waarde naar buiten.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx platform/lib/monitoring-signalen.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPRESSIE_DREMPEL } from "@/core/lib/suppressie";
import {
  DOMEIN_VOLGORDE,
  SIGNAAL_REGISTRY,
  SIGNAAL_VOLGORDE,
  VEROUDERINGSFACTOR,
  aggregeerStatus,
  bepaalStatus,
  clientVeiligeWaarde,
  combineerConfig,
  dunTrendUit,
  ingestDuren,
  isOnderdruktDoorNDrempel,
  isSignaalId,
  isVerouderd,
  kiesSlechtsteMeting,
  maskeerTrendwaarde,
  moetDraaien,
  p95,
  percentiel,
  piekEnMediaan,
  samenvattingPerDomein,
  scrubMeta,
  statusVoorWeergave,
  toonPiekInPeriode,
  trendPercentage,
  vatPeriodeSamen,
  type Domein,
  type SignaalConfig,
  type SignaalId,
  type SignaalStatus,
} from "./monitoring-signalen";
import { beschrijfDrempels, formatteerTijdsduur } from "./monitoring-format";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const NU = new Date("2026-08-03T12:00:00.000Z");
const minutenGeleden = (m: number) => new Date(NU.getTime() - m * 60_000);

console.log("monitoring-signalen sanity-tests:");

// ── Registry ────────────────────────────────────────────────────────────────

test("registry bevat precies twaalf signalen (elf bestaand + gateway-audit)", () => {
  const ids = Object.keys(SIGNAAL_REGISTRY);
  assert.equal(ids.length, 12, `verwacht 12 signalen, kreeg ${ids.length}`);
});

test("de dashboardvolgorde dekt elk signaal precies één keer", () => {
  assert.equal(SIGNAAL_VOLGORDE.length, 12);
  assert.equal(new Set(SIGNAAL_VOLGORDE).size, 12, "dubbele entry in de volgorde");
  for (const id of SIGNAAL_VOLGORDE) {
    assert.ok(SIGNAAL_REGISTRY[id], `${id} staat niet in de registry`);
  }
});

test("elke registryrij is intern consistent (interval > 0, drempels gevuld)", () => {
  for (const [id, cfg] of Object.entries(SIGNAAL_REGISTRY)) {
    assert.equal(cfg.signaal, id, `sleutel ${id} matcht cfg.signaal niet`);
    assert.ok(cfg.intervalMinuten > 0, `${id}: interval moet positief zijn`);
    assert.ok(cfg.vensterMinuten >= 0, `${id}: venster mag niet negatief zijn`);
    assert.ok(cfg.drempelOranje !== null, `${id}: drempelOranje ontbreekt`);
    assert.ok(cfg.drempelRood !== null, `${id}: drempelRood ontbreekt`);
  }
});

test("uptime en gateway-audit zijn platformbreed; de rest telt per fonds", () => {
  const breed = Object.values(SIGNAAL_REGISTRY).filter((c) => c.platformbreed);
  assert.deepEqual(
    breed.map((c) => c.signaal),
    ["uptime_kern", "gateway_log_fouten"]
  );
});

test("de n-drempel is die van besluit 0055 — geen zelfverzonnen waarde", () => {
  const metDrempel = Object.values(SIGNAAL_REGISTRY).filter((c) => c.nDrempel !== null);
  assert.deepEqual(
    metDrempel.map((c) => c.signaal).sort(),
    ["ai_latency_p95", "lege_antwoord_ratio", "tokenverbruik"]
  );
  for (const cfg of metDrempel) {
    assert.equal(
      cfg.nDrempel,
      SUPPRESSIE_DREMPEL,
      `${cfg.signaal} wijkt af van de projectbrede suppressiedrempel`
    );
  }
});

test("isSignaalId herkent alleen bekende id's", () => {
  assert.equal(isSignaalId("uptime_kern"), true);
  assert.equal(isSignaalId("verzonnen_signaal"), false);
  // Prototype-sleutels mogen niet als signaal doorgaan.
  assert.equal(isSignaalId("toString"), false);
});

// ── Statusbepaling op de randen ─────────────────────────────────────────────

const hoger: SignaalConfig = {
  ...SIGNAAL_REGISTRY.embedding_indexering_fouten,
  drempelOranje: 2,
  drempelRood: 5,
};

test("hoger_is_slechter: onder de drempel groen, op de drempel oranje", () => {
  assert.equal(bepaalStatus(1.9, null, hoger), "groen");
  assert.equal(bepaalStatus(2, null, hoger), "oranje", "drempel is INCLUSIEF");
  assert.equal(bepaalStatus(4.9, null, hoger), "oranje");
});

test("hoger_is_slechter: op en boven de rooddrempel rood", () => {
  assert.equal(bepaalStatus(5, null, hoger), "rood");
  assert.equal(bepaalStatus(99, null, hoger), "rood");
});

test("lager_is_slechter (uptime): 100% groen, 99,5% oranje, 99% rood", () => {
  const uptime = SIGNAAL_REGISTRY.uptime_kern;
  assert.equal(bepaalStatus(100, null, uptime), "groen");
  assert.equal(bepaalStatus(99.6, null, uptime), "groen");
  assert.equal(bepaalStatus(99.5, null, uptime), "oranje");
  assert.equal(bepaalStatus(99.0, null, uptime), "rood");
  assert.equal(bepaalStatus(0, null, uptime), "rood");
});

test("audit-volledigheid: één onvolledig paar is al oranje, vijf is rood", () => {
  const cfg = SIGNAAL_REGISTRY.audit_volledigheid;
  assert.equal(bepaalStatus(0, null, cfg), "groen");
  assert.equal(bepaalStatus(1, null, cfg), "oranje");
  assert.equal(bepaalStatus(4, null, cfg), "oranje");
  assert.equal(bepaalStatus(5, null, cfg), "rood");
});

test("een ontbrekende of onbruikbare waarde geeft onbekend, nooit groen", () => {
  assert.equal(bepaalStatus(null, 100, hoger), "onbekend");
  assert.equal(bepaalStatus(Number.NaN, 100, hoger), "onbekend");
  assert.equal(bepaalStatus(Number.POSITIVE_INFINITY, 100, hoger), "onbekend");
});

// ── n-drempel ───────────────────────────────────────────────────────────────

test("n-drempel: onder de drempel onbekend, óók als de waarde prima is", () => {
  const cfg = SIGNAAL_REGISTRY.ai_latency_p95;
  assert.equal(bepaalStatus(120, SUPPRESSIE_DREMPEL - 1, cfg), "onbekend");
  assert.equal(bepaalStatus(120, SUPPRESSIE_DREMPEL, cfg), "groen");
});

test("n-drempel: ontbrekende teller onderdrukt ook", () => {
  assert.equal(bepaalStatus(120, null, SIGNAAL_REGISTRY.ai_latency_p95), "onbekend");
});

test("n-drempel: signalen zonder drempel worden niet onderdrukt", () => {
  assert.equal(isOnderdruktDoorNDrempel(0, SIGNAAL_REGISTRY.uptime_kern), false);
  assert.equal(isOnderdruktDoorNDrempel(null, SIGNAAL_REGISTRY.uptime_kern), false);
});

test("n-drempel: isOnderdruktDoorNDrempel volgt bepaalStatus", () => {
  const cfg = SIGNAAL_REGISTRY.lege_antwoord_ratio;
  assert.equal(isOnderdruktDoorNDrempel(SUPPRESSIE_DREMPEL - 1, cfg), true);
  assert.equal(isOnderdruktDoorNDrempel(SUPPRESSIE_DREMPEL, cfg), false);
});

test("n-drempel — de TRENDLIJN mag een onderdrukte waarde niet alsnog tonen", () => {
  // De kaart toont "onderdrukt" op basis van de laatste meting, maar de
  // trendlijn krijgt álle historische punten mee — inclusief punten met n<10, en
  // het aria-label van de grafiek spreekt de waarde letterlijk uit. Zonder deze
  // maskering breekt de pagina haar eigen privacybelofte in dezelfde component.
  const cfg = SIGNAAL_REGISTRY.tokenverbruik;
  assert.equal(maskeerTrendwaarde(1234, SUPPRESSIE_DREMPEL - 1, cfg), null);
  assert.equal(maskeerTrendwaarde(1234, 0, cfg), null);
  assert.equal(maskeerTrendwaarde(1234, null, cfg), null);
  // Op en boven de drempel mag hij wél getoond worden.
  assert.equal(maskeerTrendwaarde(1234, SUPPRESSIE_DREMPEL, cfg), 1234);
});

test("n-drempel — signalen zonder drempel houden hun volledige trend", () => {
  assert.equal(maskeerTrendwaarde(99.9, 1, SIGNAAL_REGISTRY.uptime_kern), 99.9);
});

// ── Veroudering: de zelfmonitoring ──────────────────────────────────────────

test("veroudering — een verse snapshot is niet verouderd", () => {
  const cfg = SIGNAAL_REGISTRY.uptime_kern; // interval 5 min
  assert.equal(isVerouderd(minutenGeleden(1), cfg, NU), false);
});

test("veroudering — randgeval: net binnen de factor is nog geldig", () => {
  const cfg = SIGNAAL_REGISTRY.uptime_kern;
  const grensMinuten = cfg.intervalMinuten * VEROUDERINGSFACTOR; // 12,5
  assert.equal(isVerouderd(minutenGeleden(grensMinuten - 0.1), cfg, NU), false);
  assert.equal(isVerouderd(minutenGeleden(grensMinuten + 0.1), cfg, NU), true);
});

test("veroudering — een ontbrekende snapshot telt als verouderd", () => {
  assert.equal(isVerouderd(null, SIGNAAL_REGISTRY.uptime_kern, NU), true);
});

test("veroudering — een onparseerbaar tijdstip telt als verouderd", () => {
  assert.equal(isVerouderd("geen datum", SIGNAAL_REGISTRY.uptime_kern, NU), true);
});

test("ZELFMONITORING — een stilgevallen cron maakt een GROENE meting grijs", () => {
  const cfg = SIGNAAL_REGISTRY.uptime_kern;
  // De laatst opgeslagen status was groen; de job draait al een uur niet meer.
  assert.equal(statusVoorWeergave("groen", minutenGeleden(60), cfg, NU), "onbekend");
  // En zolang hij wél draait, blijft groen gewoon groen.
  assert.equal(statusVoorWeergave("groen", minutenGeleden(2), cfg, NU), "groen");
});

test("ZELFMONITORING — ook een rode meting wordt grijs als hij te oud is", () => {
  // Een verouderde rode meting is géén bewijs dat het NU rood is; het is bewijs
  // dat we het niet weten. Anders blijft een opgelost incident eeuwig rood staan.
  const cfg = SIGNAAL_REGISTRY.uptime_kern;
  assert.equal(statusVoorWeergave("rood", minutenGeleden(60), cfg, NU), "onbekend");
});

// ── Planning van de snapshot-run ────────────────────────────────────────────

test("moetDraaien — nooit gemeten betekent nu meten", () => {
  assert.equal(moetDraaien(null, SIGNAAL_REGISTRY.tokenverbruik, NU), true);
});

test("moetDraaien — binnen het interval niet, op het interval wel", () => {
  const cfg = SIGNAAL_REGISTRY.ai_latency_p95; // 60 min
  assert.equal(moetDraaien(minutenGeleden(59), cfg, NU), false);
  assert.equal(moetDraaien(minutenGeleden(60), cfg, NU), true);
  assert.equal(moetDraaien(minutenGeleden(180), cfg, NU), true);
});

test("moetDraaien — zelfherstellend: een gemiste run wordt de volgende keer ingehaald", () => {
  const cfg = SIGNAAL_REGISTRY.uptime_kern; // 5 min
  // Cron heeft 40 minuten stilgelegen; de eerstvolgende run pakt het signaal op.
  assert.equal(moetDraaien(minutenGeleden(40), cfg, NU), true);
});

test("moetDraaien — een gedeactiveerd signaal draait niet", () => {
  const uit: SignaalConfig = { ...SIGNAAL_REGISTRY.uptime_kern, actief: false };
  assert.equal(moetDraaien(null, uit, NU), false);
});

// ── Configuratie uit de database wint van de registry ───────────────────────

test("combineerConfig — zonder databaserij blijft de registry gelden", () => {
  const cfg = combineerConfig("uptime_kern", null);
  assert.deepEqual(cfg, SIGNAAL_REGISTRY.uptime_kern);
});

test("combineerConfig — de databasewaarde WINT van de registry", () => {
  const cfg = combineerConfig("embedding_indexering_fouten", {
    signaal: "embedding_indexering_fouten",
    drempel_oranje: 0.5,
    drempel_rood: 1,
    interval_minuten: 30,
  });
  assert.equal(cfg.drempelOranje, 0.5);
  assert.equal(cfg.drempelRood, 1);
  assert.equal(cfg.intervalMinuten, 30);
});

test("combineerConfig — numeric als string (PostgREST) wordt netjes omgezet", () => {
  const cfg = combineerConfig("uptime_kern", {
    signaal: "uptime_kern",
    drempel_oranje: "99.9",
    drempel_rood: "99.8",
  });
  assert.equal(cfg.drempelOranje, 99.9);
  assert.equal(cfg.drempelRood, 99.8);
});

test("combineerConfig — een kapotte rij sloopt de configuratie niet", () => {
  const cfg = combineerConfig("uptime_kern", {
    signaal: "uptime_kern",
    interval_minuten: -5,
    richting: "zijwaarts",
    eenheid: "bananen",
    label: "   ",
  });
  assert.equal(cfg.intervalMinuten, SIGNAAL_REGISTRY.uptime_kern.intervalMinuten);
  assert.equal(cfg.richting, "lager_is_slechter");
  assert.equal(cfg.eenheid, "percentage");
  assert.equal(cfg.label, SIGNAAL_REGISTRY.uptime_kern.label);
});

test("combineerConfig — platformbreed komt ALTIJD uit de code, niet uit de database", () => {
  // Of een signaal per fonds telt is een meetdefinitie, geen instelling; het
  // mag niet met een SQL-update omgezet kunnen worden.
  const rij = { signaal: "tokenverbruik", platformbreed: true } as unknown as {
    signaal: string;
  };
  assert.equal(combineerConfig("tokenverbruik", rij).platformbreed, false);
});

test("combineerConfig — de n-drempel is via de database NIET uit te zetten (besluit 0055)", () => {
  // Zou dit wel kunnen, dan is de privacywaarborg met één SQL-update weg voor
  // precies de signalen waar hij voor bedoeld is, terwijl het dashboard blijft
  // beweren dat hij geldt.
  for (const poging of [null, 0, -1, 3] as Array<number | null>) {
    const cfg = combineerConfig("ai_latency_p95", {
      signaal: "ai_latency_p95",
      n_drempel: poging,
    });
    assert.equal(
      cfg.nDrempel,
      SUPPRESSIE_DREMPEL,
      `n_drempel=${poging} mag de drempel niet verlagen`
    );
  }
});

test("combineerConfig — de n-drempel mag wél worden VERHOOGD", () => {
  const cfg = combineerConfig("ai_latency_p95", {
    signaal: "ai_latency_p95",
    n_drempel: 25,
  });
  assert.equal(cfg.nDrempel, 25);
});

test("combineerConfig — dekkingsvoorbehoud komt uit de code, niet uit de database", () => {
  // Een SQL-update mag de disclaimer niet kunnen laten verdwijnen.
  const rij = {
    signaal: "tokenverbruik",
    dekkingsvoorbehoud: null,
    toelichting: "Tokenverbruik per fonds.",
  } as unknown as { signaal: string };
  const cfg = combineerConfig("tokenverbruik", rij);
  assert.equal(cfg.dekkingsvoorbehoud, SIGNAAL_REGISTRY.tokenverbruik.dekkingsvoorbehoud);
  assert.ok(
    cfg.dekkingsvoorbehoud && cfg.dekkingsvoorbehoud.length > 0,
    "tokenverbruik moet een dekkingsvoorbehoud dragen"
  );
});

test("elk signaal met een onvolledige dekking draagt een voorbehoud", () => {
  // Deze meten aantoonbaar niet alles; dat mag nooit stilzwijgend zijn. De twee
  // ingest-signalen dragen sinds het single-job-model (F4/F6) een voorbehoud: één
  // job draagt de hele keten, dus per-fase-uitsplitsing kan niet.
  for (const id of [
    "tokenverbruik",
    "ai_latency_p95",
    "audit_volledigheid",
    "embedding_indexering_fouten",
    "extractie_achterstand",
  ] as SignaalId[]) {
    const v = SIGNAAL_REGISTRY[id].dekkingsvoorbehoud;
    assert.ok(v && v.length > 20, `${id} mist een dekkingsvoorbehoud`);
  }
});

// ── Rekenwerk ───────────────────────────────────────────────────────────────

test("p95 — zelfde methode als de AQLab-runaggregatie", () => {
  const waarden = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(p95(waarden), 96); // floor(0,95 * 100) = index 95 → waarde 96
});

test("p95 — oneven reeks en eenling", () => {
  assert.equal(p95([10, 20, 30]), 30);
  assert.equal(p95([42]), 42);
});

test("p95 — sorteert numeriek, niet lexicografisch", () => {
  // Een JS-default sort zou hier 9 boven 100 zetten.
  assert.equal(p95([100, 9, 80, 7, 60, 5, 40, 3, 20, 1]), 100);
});

test("p95 — lege of ongeldige invoer geeft null, geen 0", () => {
  assert.equal(p95([]), null);
  assert.equal(p95([Number.NaN, Number.POSITIVE_INFINITY]), null);
});

test("percentiel — mediaan als controle op de indexberekening", () => {
  assert.equal(percentiel([1, 2, 3, 4, 5], 0.5), 3);
});

test("trendPercentage — stijging, daling en gelijk", () => {
  assert.equal(trendPercentage(150, 100), 50);
  assert.equal(trendPercentage(200, 100), 100);
  assert.equal(trendPercentage(50, 100), -50);
  assert.equal(trendPercentage(100, 100), 0);
});

test("trendPercentage — basis 0 geeft null, geen oneindig of 0", () => {
  // "Oneindig procent meer dan niets" is geen bruikbaar signaal, en 0 zou
  // suggereren dat er niets aan de hand is.
  assert.equal(trendPercentage(500, 0), null);
  assert.equal(trendPercentage(500, -1), null);
  assert.equal(trendPercentage(Number.NaN, 100), null);
});

test("trend + status: een verdubbeling t.o.v. het weekgemiddelde is rood", () => {
  const cfg = SIGNAAL_REGISTRY.tokenverbruik;
  const stijging = trendPercentage(2000, 1000);
  assert.equal(stijging, 100);
  assert.equal(bepaalStatus(stijging, 50, cfg), "rood");
});

// ── Drift tussen de registry en de seed in de migratie ──────────────────────
//  De kop van monitoring-signalen.ts belooft dat deze waarden IDENTIEK zijn aan
//  de seed. Zo'n belofte hoort afgedwongen te worden, anders is het een wens:
//  bij de reviewronde bleek precies deze drift al te zijn ontstaan.

test("registry en migratie-seed dekken dezelfde twaalf signalen met dezelfde drempels", () => {
  // De seed is over TWEE migraties verdeeld: de acht basissignalen in de P5-migratie
  // en de drie uit blok B/C in de P4b-seed. Zonder beide mee te lezen zou deze check
  // breken op precies de drie signalen die deze tranche toevoegt.
  const migraties = [
    "../../supabase/migrations/2026_08_03_p5_monitoring.sql",
    "../../supabase/seeds/schema/2026_08_08_p4b_signalen_seed.sql",
    "../../supabase/seeds/schema/2026_09_04_ai_gateway_monitoring_seed.sql",
  ];
  let blok = "";
  for (const rel of migraties) {
    const sql = readFileSync(new URL(rel, import.meta.url), "utf8");
    const start = sql.indexOf("insert into public.platform_signaal_config");
    assert.ok(start > 0, `seed-blok niet gevonden in ${rel}`);
    blok += sql.slice(start, sql.indexOf("on conflict (signaal)", start)) + "\n";
  }

  for (const cfg of Object.values(SIGNAAL_REGISTRY)) {
    const regel = new RegExp(
      `\\('${cfg.signaal}',\\s*'[^']*',\\s*'([a-z_]+)',\\s*(\\d+),\\s*(\\d+),\\s*\\n?\\s*([\\d.]+|null),\\s*([\\d.]+|null),\\s*'([a-z_]+)',\\s*(\\d+|null),`
    ).exec(blok);
    assert.ok(regel, `signaal ${cfg.signaal} ontbreekt in de seed of heeft een andere vorm`);

    const [, eenheid, interval, venster, oranje, rood, richting, nDrempel] = regel;
    assert.equal(eenheid, cfg.eenheid, `${cfg.signaal}: eenheid wijkt af`);
    assert.equal(Number(interval), cfg.intervalMinuten, `${cfg.signaal}: interval wijkt af`);
    assert.equal(Number(venster), cfg.vensterMinuten, `${cfg.signaal}: venster wijkt af`);
    assert.equal(Number(oranje), cfg.drempelOranje, `${cfg.signaal}: drempelOranje wijkt af`);
    assert.equal(Number(rood), cfg.drempelRood, `${cfg.signaal}: drempelRood wijkt af`);
    assert.equal(richting, cfg.richting, `${cfg.signaal}: richting wijkt af`);
    assert.equal(
      nDrempel === "null" ? null : Number(nDrempel),
      cfg.nDrempel,
      `${cfg.signaal}: n_drempel wijkt af`
    );
  }
});

// ── Code-only velden (blok B1/B2, acceptatie 12) ────────────────────────────

test("elk signaal draagt de vijf code-only velden, niet-leeg", () => {
  const niveaus = ["volledig", "gedeeltelijk", "indicatief", "niet_in_werking"];
  for (const [id, cfg] of Object.entries(SIGNAAL_REGISTRY)) {
    assert.ok(DOMEIN_VOLGORDE.includes(cfg.domein), `${id}: onbekend domein`);
    assert.ok(cfg.betekenis.length > 10, `${id}: betekenisregel ontbreekt/te kort`);
    assert.ok(cfg.eigenaar.length > 0, `${id}: eigenaar leeg`);
    assert.ok(cfg.opvolgactie.length > 20, `${id}: opvolgactie leeg/te kort`);
    assert.ok(niveaus.includes(cfg.dekkingsniveau), `${id}: ongeldig dekkingsniveau`);
  }
});

test("NEGATIEVE CONTROLE (acceptatie 12): code-only velden komen ALTIJD uit de code", () => {
  // Een configrij die probeert domein/eigenaar/opvolgactie/dekkingsniveau te
  // overschrijven, wordt genegeerd: combineerConfig leest die sleutels niet.
  const indringer = {
    signaal: "uptime_kern",
    domein: "verwerking",
    betekenis: "iets heel anders",
    eigenaar: "Indringer",
    opvolgactie: "doe maar niks",
    dekkingsniveau: "niet_in_werking",
  } as unknown as Parameters<typeof combineerConfig>[1];
  const cfg = combineerConfig("uptime_kern", indringer);
  const basis = SIGNAAL_REGISTRY.uptime_kern;
  assert.equal(cfg.domein, basis.domein, "domein moet uit de code komen");
  assert.equal(cfg.betekenis, basis.betekenis, "betekenis moet uit de code komen");
  assert.equal(cfg.eigenaar, basis.eigenaar, "eigenaar moet uit de code komen");
  assert.equal(cfg.opvolgactie, basis.opvolgactie, "opvolgactie moet uit de code komen");
  assert.equal(cfg.dekkingsniveau, basis.dekkingsniveau, "dekkingsniveau moet uit de code komen");
});

// ── Aggregatie over statussen (architectuurpunt 3 en 4) ─────────────────────

test("aggregeerStatus — slechtste wint, lege lijst is onbekend", () => {
  assert.equal(aggregeerStatus([]), "onbekend");
  assert.equal(aggregeerStatus(["groen", "groen", "groen"]), "groen");
  assert.equal(aggregeerStatus(["groen", "oranje"]), "oranje");
  assert.equal(aggregeerStatus(["oranje", "rood"]), "rood");
  // rood > oranje > onbekend > groen
  assert.equal(aggregeerStatus(["rood", "onbekend", "oranje", "groen"]), "rood");
});

test("aggregeerStatus — onbekend maakt nooit groener (architectuurpunt 4)", () => {
  assert.equal(aggregeerStatus(["groen", "groen", "onbekend"]), "onbekend");
  assert.equal(aggregeerStatus(["onbekend", "oranje"]), "oranje");
});

test("NEGATIEVE CONTROLE (acceptatie 11): aggregatie is status-only, nooit over waarden", () => {
  // aggregeerStatus en samenvattingPerDomein nemen UITSLUITEND SignaalStatus in;
  // er is geen parameter waarlangs een getal de aggregatie in kan. Zou er ergens
  // een waarde-optelling zijn, dan zou n=6 + n=6 → n=12 de n-drempel omzeilen.
  // Twee onderdrukte (onbekend) metingen leveren onbekend, niet plots een getal.
  assert.equal(aggregeerStatus(["onbekend", "onbekend"]), "onbekend");
  const metingen = [
    { domein: "verwerking" as Domein, status: "groen" as SignaalStatus },
    { domein: "verwerking" as Domein, status: "groen" as SignaalStatus },
  ];
  const sam = samenvattingPerDomein(metingen);
  assert.equal(sam.verwerking.slechtste, "groen");
  assert.equal(sam.verwerking.afwijkend, 0);
  assert.equal(sam.verwerking.totaal, 2);
});

test("samenvattingPerDomein — afwijkend en onbekend apart geteld", () => {
  const metingen = [
    { domein: "verwerking" as Domein, status: "rood" as SignaalStatus },
    { domein: "verwerking" as Domein, status: "oranje" as SignaalStatus },
    { domein: "verwerking" as Domein, status: "onbekend" as SignaalStatus },
    { domein: "verwerking" as Domein, status: "groen" as SignaalStatus },
  ];
  const sam = samenvattingPerDomein(metingen);
  assert.equal(sam.verwerking.slechtste, "rood");
  assert.equal(sam.verwerking.afwijkend, 2, "rood + oranje");
  assert.equal(sam.verwerking.onbekend, 1);
  assert.equal(sam.verwerking.totaal, 4);
  for (const d of DOMEIN_VOLGORDE) assert.ok(sam[d], `domein ${d} ontbreekt in het resultaat`);
  assert.equal(sam.beschikbaarheid.totaal, 0, "leeg domein bestaat met totaal 0");
});

// ── Drempeltekst (acceptatie 13) ─────────────────────────────────────────────

test("beschrijfDrempels — 'onder' bij lager_is_slechter, 'vanaf' bij hoger", () => {
  const uptime = beschrijfDrempels(99.5, 99, "lager_is_slechter", "percentage");
  assert.ok(uptime.includes("aandacht onder 99,5%"), `kreeg: ${uptime}`);
  assert.ok(!uptime.includes("vanaf"), "lager_is_slechter mag geen 'vanaf' tonen");
  const fouten = beschrijfDrempels(2, 5, "hoger_is_slechter", "percentage");
  assert.ok(fouten.includes("aandacht vanaf 2%"), `kreeg: ${fouten}`);
  assert.ok(fouten.includes("verstoord vanaf 5%"), `kreeg: ${fouten}`);
  assert.equal(beschrijfDrempels(null, null, "hoger_is_slechter", "aantal"), "niet ingesteld");
});

// ── Periodesamenvatting (blok D2, architectuurpunt 13) ──────────────────────

test("vatPeriodeSamen — NEGATIEVE CONTROLE: maskeren verhoogt aandeel-in-orde niet", () => {
  const cfg = SIGNAAL_REGISTRY.embedding_indexering_fouten; // oranje ≥2, rood ≥5
  const vol = [0, 0, 0, 0, 6, 6, 6, 6].map((w) => ({ waarde: w }));
  const s1 = vatPeriodeSamen(vol, cfg);
  assert.equal(s1.aandeelInOrde, 0.5);
  assert.equal(s1.overschrijdingen, 4);
  // Maskeer de vier verstoorde punten → onbekend, niet in orde; noemer blijft 8.
  const gemaskeerd = [0, 0, 0, 0, null, null, null, null].map((w) => ({ waarde: w as number | null }));
  const s2 = vatPeriodeSamen(gemaskeerd, cfg);
  assert.ok(
    (s2.aandeelInOrde ?? 0) <= (s1.aandeelInOrde ?? 0),
    `maskeren mag de score niet verhogen: ${s2.aandeelInOrde} > ${s1.aandeelInOrde}`
  );
  assert.equal(s2.aandeelInOrde, 0.5, "4 groen / 8 totaal — onbekend blijft in de noemer");
  assert.equal(s2.onbekend, 4);
  assert.equal(s2.overschrijdingen, 0);
});

test("vatPeriodeSamen — langste aaneengesloten afwijking, onbekend breekt de reeks", () => {
  const cfg = SIGNAAL_REGISTRY.embedding_indexering_fouten;
  const reeks = [6, 6, 0, 6, 6, 6, 0].map((w) => ({ waarde: w }));
  const s = vatPeriodeSamen(reeks, cfg);
  assert.equal(s.langsteAfwijking, 3);
  assert.equal(s.overschrijdingen, 5);
  const metGat = [6, 6, null, 6].map((w) => ({ waarde: w as number | null }));
  assert.equal(vatPeriodeSamen(metGat, cfg).langsteAfwijking, 2, "onbekend breekt de reeks");
  assert.equal(vatPeriodeSamen([], cfg).aandeelInOrde, null, "lege periode → null");
});

// ── Uitdunning en piek/mediaan (blok D3 en acceptatie 29) ───────────────────

test("dunTrendUit — ten hoogste één punt per uur, het laatste, chronologisch", () => {
  const punten = [
    { tijdstip: "2026-08-08T10:00:00.000Z", waarde: 1 },
    { tijdstip: "2026-08-08T10:15:00.000Z", waarde: 2 },
    { tijdstip: "2026-08-08T10:45:00.000Z", waarde: 3 },
    { tijdstip: "2026-08-08T11:05:00.000Z", waarde: 4 },
    { tijdstip: "2026-08-08T11:59:00.000Z", waarde: 5 },
  ];
  const uit = dunTrendUit(punten);
  assert.equal(uit.length, 2, "twee klokuren → twee punten");
  assert.equal(uit[0]?.waarde, 3, "laatste van het 10-uur");
  assert.equal(uit[1]?.waarde, 5, "laatste van het 11-uur");
  assert.equal(uit[uit.length - 1]?.tijdstip, "2026-08-08T11:59:00.000Z", "recentste punt blijft behouden");
});

test("piekEnMediaan / toonPiekInPeriode — hoogste + mediane snapshot, geen periode-percentiel", () => {
  assert.deepEqual(piekEnMediaan([]), { hoogste: null, mediaan: null });
  assert.deepEqual(piekEnMediaan([null, null]), { hoogste: null, mediaan: null });
  const pm = piekEnMediaan([30, 10, 20]);
  assert.equal(pm.hoogste, 30);
  assert.equal(pm.mediaan, 20);
  assert.equal(toonPiekInPeriode(SIGNAAL_REGISTRY.ai_latency_p95), true, "p95 → piek+mediaan");
  assert.equal(toonPiekInPeriode(SIGNAAL_REGISTRY.tokenverbruik), true, "trendpercentage → piek+mediaan");
  assert.equal(toonPiekInPeriode(SIGNAAL_REGISTRY.uptime_kern), false);
  assert.equal(toonPiekInPeriode(SIGNAAL_REGISTRY.extractie_achterstand), false);
});

test("kiesSlechtsteMeting — slechtste wint, tie-break op fondsnaam (acceptatie 6)", () => {
  assert.equal(kiesSlechtsteMeting([]), null);
  const groep = [
    { status: "groen" as SignaalStatus, fondsNaam: "Zephyr" },
    { status: "rood" as SignaalStatus, fondsNaam: "Beta" },
    { status: "rood" as SignaalStatus, fondsNaam: "Alfa" },
  ];
  // Twee keer rood → laagste naam (Alfa) wint, deterministisch.
  assert.equal(kiesSlechtsteMeting(groep)?.fondsNaam, "Alfa");
  // Volgorde van de invoer mag niets uitmaken.
  assert.equal(kiesSlechtsteMeting([...groep].reverse())?.fondsNaam, "Alfa");
});

test("clientVeiligeWaarde — onderdrukt maskeert de laatste stand naar null (client-veiligheid)", () => {
  // Borgt dat een refactor de maskering vóór serialisatie niet stil terugdraait:
  // een onderdrukt signaal mag nooit met een ruwe waarde de client-payload halen.
  assert.equal(clientVeiligeWaarde(3.4, true), null);
  assert.equal(clientVeiligeWaarde(0, true), null);
  assert.equal(clientVeiligeWaarde(3.4, false), 3.4);
  assert.equal(clientVeiligeWaarde(null, false), null);
});

// ── Tijdsduurformatter (blok C, acceptatie 26) ──────────────────────────────

test("formatteerTijdsduur — leesbaar op de grenzen, opslag blijft in ms", () => {
  assert.equal(formatteerTijdsduur(999), "999 ms");
  assert.equal(formatteerTijdsduur(1000), "1 s");
  assert.equal(formatteerTijdsduur(90_000), "1 min 30 s");
  assert.equal(formatteerTijdsduur(3_600_000), "1 u"); // 60 min
  assert.equal(formatteerTijdsduur(7_500_000), "2 u 5 min"); // 125 min
  // Drempels van de nieuwe signalen, opgeslagen in ms:
  assert.equal(formatteerTijdsduur(1_800_000), "30 min");
  assert.equal(formatteerTijdsduur(7_200_000), "2 u");
});

// ── Ingest-doorlooptijd: eind − aangemaakt, met randgevallen (acceptatie 23/24) ─

test("ingestDuren — doorlooptijd volgt de WACHTTIJD, niet alleen de rekentijd (acceptatie 23)", () => {
  // Lange wachttijd (aangemaakt 10:00, start 11:00), korte rekentijd (eind 11:05).
  const { doorloop, rekentijd } = ingestDuren([
    {
      aangemaakt: "2026-08-08T10:00:00.000Z",
      start: "2026-08-08T11:00:00.000Z",
      eind: "2026-08-08T11:05:00.000Z",
    },
  ]);
  assert.equal(doorloop[0], 65 * 60_000, "doorlooptijd = eind − aangemaakt = 65 min");
  assert.equal(rekentijd[0], 5 * 60_000, "rekentijd = eind − start = 5 min");
});

test("ingestDuren — NEGATIEVE CONTROLE: overgeslagen, geen start en null-tijden tellen niet (acceptatie 24)", () => {
  const { doorloop } = ingestDuren([
    // geldig
    { aangemaakt: "2026-08-08T10:00:00.000Z", start: "2026-08-08T10:01:00.000Z", eind: "2026-08-08T10:10:00.000Z" },
    // overgeslagen → uit
    { aangemaakt: "2026-08-08T10:00:00.000Z", start: "2026-08-08T10:01:00.000Z", eind: "2026-08-08T10:10:00.000Z", status: "overgeslagen" },
    // geen start → uit (Number(null)===0-faalvorm)
    { aangemaakt: "2026-08-08T10:00:00.000Z", start: null, eind: "2026-08-08T10:10:00.000Z" },
    // geen eind → uit
    { aangemaakt: "2026-08-08T10:00:00.000Z", start: "2026-08-08T10:01:00.000Z", eind: null },
    // negatieve duur (klok-anomalie) → uit
    { aangemaakt: "2026-08-08T10:10:00.000Z", start: "2026-08-08T10:01:00.000Z", eind: "2026-08-08T10:00:00.000Z" },
  ]);
  assert.equal(doorloop.length, 1, "alleen de ene geldige job telt mee");
  assert.equal(doorloop[0], 10 * 60_000);
});

test("scrubMeta — verwijdert herleidbare sleutels, houdt de aggregaten (audit-evidence R1)", () => {
  assert.equal(scrubMeta(null), null);
  const vervuild = {
    afgeronde_jobs: 3,
    document_id: "abc-123",
    titel: "Notulen bestuur maart",
    gebruiker_naam: "J. Jansen",
    email: "j@fonds.nl",
    correlatie_id: "x",
    geslaagd: 5,
  };
  assert.deepEqual(Object.keys(scrubMeta(vervuild)!).sort(), ["afgeronde_jobs", "geslaagd"]);

  // NEGATIEVE CONTROLE: elke meta-sleutel die de meetfuncties vandaag écht
  // schrijven moet de scrub overleven — anders breekt de weergave stil.
  const echteSleutels = {
    beschikbaar: true,
    componenten_onbekend: 0,
    waargenomen_runs: 1,
    verwachte_runs: 288,
    componenten: [],
    definitie: "x",
    definitie_versie: 2,
    tokens_laatste_24u: 1000,
    daggemiddelde_basisperiode: 900,
    basisdagen: 7,
    reden: "te weinig waarnemingen voor een percentiel",
    geslaagd: 5,
    mislukt: 2,
    overgeslagen: 1,
    met_retry: 0,
    verwerkt_in_venster: 7,
    doorvoer_24u: 58,
    openstaande_jobs: 3,
    afgeronde_jobs: 12,
    rekentijd_p95_ms: 1234,
    limietchecks_mislukt: 0,
  };
  assert.equal(
    Object.keys(scrubMeta(echteSleutels)!).length,
    Object.keys(echteSleutels).length,
    "een bestaande aggregaat-sleutel mag niet worden weggefilterd"
  );
});

console.log(`\n${n} monitoring-signalen sanity-tests geslaagd (incl. driftcheck op de seed).`);
