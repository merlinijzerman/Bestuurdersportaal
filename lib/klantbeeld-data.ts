// ============================================================
//  Klantbeeld — data-laag
//  Demo-data voor de Klantbeeld-module: cohorten 18-68 met
//  Wtp-mechaniek (premie, restposten, 4 rendements-componenten)
//  én werkgevers-totalen (PG, premie, salaris, segmentatie, inning).
//
//  Alle cijfers zijn fictief en deterministisch — geseed met de
//  eigenschappen van het cohort/de maand zodat output stabiel is
//  bij elke server-render. Voor productie vervangen door koppeling
//  met de uitvoerder.
// ============================================================

// ─── Maandlabels (mei 2024 — apr 2026) ─────────────────────────
export const MAANDLABELS = [
  "2024-05", "2024-06", "2024-07", "2024-08", "2024-09", "2024-10",
  "2024-11", "2024-12", "2025-01", "2025-02", "2025-03", "2025-04",
  "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10",
  "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
];

const MAAND_NAMEN = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
export const MAANDLABEL_KORT = MAANDLABELS.map((s) => {
  const [j, m] = s.split("-");
  return `${MAAND_NAMEN[parseInt(m, 10) - 1]} '${j.slice(2)}`;
});

// ─── Pseudo-random met seed (deterministisch) ─────────────────
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Markt-scenario per maand (% basis) ───────────────────────
interface MarktMaand {
  kas: number;        // kasrendement (% van saldo)
  renteMut: number;   // verandering lange rente (basispunten)
  aandelen: number;   // aandelenrendement (%)
  langleven: number;  // micro-langleven shock (%)
}

const MARKT: MarktMaand[] = [
  { kas: 0.30, renteMut: -10, aandelen:  1.20, langleven:  0.02 },
  { kas: 0.30, renteMut:  15, aandelen: -0.85, langleven:  0.00 },
  { kas: 0.31, renteMut:  -5, aandelen:  2.10, langleven: -0.01 },
  { kas: 0.31, renteMut:  -8, aandelen: -1.40, langleven:  0.01 },
  { kas: 0.30, renteMut:  20, aandelen:  0.40, langleven:  0.00 },
  { kas: 0.29, renteMut:  -3, aandelen:  1.55, langleven:  0.03 },
  { kas: 0.28, renteMut: -12, aandelen:  0.95, langleven: -0.02 },
  { kas: 0.27, renteMut:  -6, aandelen:  1.80, langleven:  0.01 },
  { kas: 0.26, renteMut:  25, aandelen: -2.20, langleven:  0.00 },
  { kas: 0.26, renteMut:   8, aandelen: -0.65, langleven:  0.00 },
  { kas: 0.25, renteMut:  -5, aandelen:  1.10, langleven:  0.02 },
  { kas: 0.25, renteMut: -15, aandelen:  2.45, langleven:  0.01 },
  { kas: 0.25, renteMut:  -8, aandelen:  0.85, langleven: -0.01 },
  { kas: 0.24, renteMut:   3, aandelen:  1.35, langleven:  0.00 },
  { kas: 0.24, renteMut:  10, aandelen: -0.95, langleven:  0.02 },
  { kas: 0.23, renteMut: -22, aandelen:  3.10, langleven:  0.01 },
  { kas: 0.23, renteMut:  -7, aandelen:  0.60, langleven:  0.00 },
  { kas: 0.23, renteMut:   5, aandelen: -1.85, langleven: -0.02 },
  { kas: 0.22, renteMut: -10, aandelen:  1.95, langleven:  0.01 },
  { kas: 0.22, renteMut:  -3, aandelen:  0.45, langleven:  0.00 },
  { kas: 0.22, renteMut: -18, aandelen:  2.80, langleven:  0.02 },
  { kas: 0.21, renteMut:  12, aandelen: -1.40, langleven:  0.00 },
  { kas: 0.21, renteMut:  -5, aandelen:  1.65, langleven:  0.01 },
  { kas: 0.21, renteMut:   8, aandelen: -0.55, langleven:  0.00 },
];

// Neutraal scenario voor "verwachte" reeks → doel-nu per cohort
const VERWACHT_MARKT: MarktMaand[] = Array(24).fill({
  kas: 0.25,
  renteMut: 0,
  aandelen: 0.65,
  langleven: 0.005,
});

// ─── Types ───────────────────────────────────────────────────
export interface CashflowEvent {
  idx: number;
  toevoeging: number;
  onttrekking: number;
}

export interface MaandRij {
  idx: number;
  maand: string;
  maandKort: string;
  begin: number;
  premie: number;
  toevoeging: number;
  onttrekking: number;
  kas: number;
  beschermRTS: number;
  overRend: number;
  langleven: number;
  eind: number;
}

export interface Cohort {
  age: number;
  overWeight: number;
  beschermWeight: number;
  duration: number;
  uitvoeringMult: number;
  aantal: number;
  actiefP: number;
  slapendP: number;
  uitkerendP: number;
  salaris: number;
  maandPremie: number;
  maandUitkering: number;
  invaarKapitaal: number;
  doelKapitaal: number;
  doelOp67: number;
  cashflows: CashflowEvent[];
  reeks: MaandRij[];
  eindSaldo: number;
  spreiding: { p10: number; p50: number; p90: number };
  projectie: number;
  afwijking: number;
}

// ─── Cohort-config ───────────────────────────────────────────
function genereerCashflows(age: number): CashflowEvent[] {
  const seed = mulberry32(age * 47 + 13);
  const events: CashflowEvent[] = [];
  const nEvents = age >= 65 ? 0 + Math.floor(seed() * 2) : 1 + Math.floor(seed() * 3);
  const gebruikt = new Set<number>();
  for (let k = 0; k < nEvents; k++) {
    let idx = 0;
    let attempts = 0;
    do {
      idx = Math.floor(seed() * 24);
      attempts++;
    } while (gebruikt.has(idx) && attempts < 10);
    gebruikt.add(idx);
    const isToevoeging = seed() < (age < 45 ? 0.62 : age < 60 ? 0.45 : 0.30);
    const bedrag = Math.round(60 + seed() * 380);
    events.push({
      idx,
      toevoeging: isToevoeging ? bedrag : 0,
      onttrekking: !isToevoeging ? bedrag : 0,
    });
  }
  return events;
}

interface CohortConfig {
  age: number;
  overWeight: number;
  beschermWeight: number;
  duration: number;
  uitvoeringMult: number;
  aantal: number;
  actiefP: number;
  slapendP: number;
  uitkerendP: number;
  salaris: number;
  maandPremie: number;
  maandUitkering: number;
  invaarKapitaal: number;
  doelOp67: number;
  cashflows: CashflowEvent[];
}

function cohortConfig(age: number): CohortConfig {
  const t = Math.max(0, Math.min(1, (age - 18) / 50));
  const overWeight = 1 - t * 0.8;        // jong 100% → oud 20%
  const beschermWeight = 1 - overWeight;
  const duration = 8 + t * 12;            // 8 → 20 jaar

  const popPeak =
    age < 25 ? 600 :
    age < 35 ? 950 :
    age < 45 ? 1350 :
    age < 55 ? 1450 :
    age < 60 ? 1300 :
    age < 65 ? 950 :
    700;
  const aantal = popPeak + Math.round(mulberry32(age * 7 + 1)() * 200 - 100);

  let actiefP: number, slapendP: number, uitkerendP: number;
  if (age < 22) {
    actiefP = 0.85;
    slapendP = 0.15;
    uitkerendP = 0;
  } else if (age < 60) {
    const slapend = 0.2 + (age - 22) * 0.005;
    actiefP = 1 - slapend;
    slapendP = slapend;
    uitkerendP = 0;
  } else if (age < 67) {
    const tf = (age - 60) / 7;
    actiefP = (1 - tf) * 0.65;
    slapendP = 0.35;
    uitkerendP = tf * 0.65;
  } else {
    actiefP = 0;
    slapendP = 0.05;
    uitkerendP = 0.95;
  }

  const startWerkLeeftijd = 25;
  const dienstjaren = Math.max(0, Math.min(age - startWerkLeeftijd, 42));
  const salaris = 30000 + Math.min(age - startWerkLeeftijd, 30) * 1400;
  const maandPremie = age >= 67 ? 0 : Math.round((salaris * 0.3 * 0.2) / 12);
  const maandUitkering = age >= 65 ? Math.round((salaris * 0.65) / 12) : 0;

  const invaarBasis = dienstjaren * 5500 + Math.max(0, age - 25) * 2200;
  const invaarKapitaal = age < 22 ? Math.round(invaarBasis * 0.5) : Math.round(invaarBasis);

  const uitvoeringMult = 0.78 + mulberry32(age * 23 + 11)() * 0.44;

  const salarisFactor = Math.max(0.7, Math.min(1.4, salaris / 55000));
  const doelOp67 = Math.round(350000 * salarisFactor);

  return {
    age,
    overWeight,
    beschermWeight,
    duration,
    uitvoeringMult,
    aantal,
    actiefP,
    slapendP,
    uitkerendP,
    salaris,
    maandPremie,
    maandUitkering,
    invaarKapitaal,
    doelOp67,
    cashflows: genereerCashflows(age),
  };
}

// ─── Maandreeks per cohort ───────────────────────────────────
function maandReeks(cohort: CohortConfig, scenarioOverride?: MarktMaand[]): MaandRij[] {
  const scenario = scenarioOverride ?? MARKT;
  // Cohort-uitvoering alleen op werkelijke reeks, niet op neutraal verwachting
  const uitvoering = scenarioOverride ? 1.0 : cohort.uitvoeringMult;
  // Cashflows alleen op werkelijke reeks
  const cashflowMap: Record<number, { toev: number; ontt: number }> = {};
  if (!scenarioOverride) {
    cohort.cashflows.forEach((e) => {
      const cur = cashflowMap[e.idx] ?? { toev: 0, ontt: 0 };
      cashflowMap[e.idx] = {
        toev: cur.toev + e.toevoeging,
        ontt: cur.ontt + e.onttrekking,
      };
    });
  }

  const reeks: MaandRij[] = [];
  let saldo = cohort.invaarKapitaal;
  for (let i = 0; i < 24; i++) {
    const m = scenario[i];
    const begin = saldo;
    const premie = cohort.maandPremie * cohort.actiefP;
    const toevoeging = cashflowMap[i]?.toev ?? 0;
    const onttrekking = cashflowMap[i]?.ontt ?? 0;
    const kas = begin * (m.kas / 100);
    const beschermRTS = begin * (-cohort.duration * (m.renteMut / 10000)) * cohort.beschermWeight;
    const overRend = begin * ((m.aandelen / 100) - (m.kas / 100)) * cohort.overWeight * uitvoering;
    const langleven = begin * (m.langleven / 100);
    const eind =
      begin + premie + toevoeging - onttrekking + kas + beschermRTS + overRend + langleven;
    reeks.push({
      idx: i,
      maand: MAANDLABELS[i],
      maandKort: MAANDLABEL_KORT[i],
      begin,
      premie,
      toevoeging,
      onttrekking,
      kas,
      beschermRTS,
      overRend,
      langleven,
      eind,
    });
    saldo = eind;
  }
  return reeks;
}

function spreiding(age: number, eindSaldo: number) {
  const sigma = age < 30 ? 0.45 : age < 50 ? 0.35 : 0.28;
  return {
    p10: Math.round(eindSaldo * (1 - sigma)),
    p50: Math.round(eindSaldo),
    p90: Math.round(eindSaldo * (1 + sigma * 1.1)),
  };
}

// ─── Build alle 51 cohorten ──────────────────────────────────
function buildCohorten(): Cohort[] {
  const cohorten: Cohort[] = [];
  for (let age = 18; age <= 68; age++) {
    const cfg = cohortConfig(age);
    const reeks = maandReeks(cfg);
    const eindSaldo = reeks[reeks.length - 1].eind;
    const verwachteReeks = maandReeks(cfg, VERWACHT_MARKT);
    const doelKapitaal = Math.round(verwachteReeks[verwachteReeks.length - 1].eind);
    const jarenTot67 = Math.max(0, 67 - age);
    const projectie = Math.round(
      eindSaldo * Math.pow(1.04, jarenTot67) + cfg.maandPremie * 12 * jarenTot67 * 1.1
    );
    const afwijking = (eindSaldo - doelKapitaal) / doelKapitaal;
    cohorten.push({
      ...cfg,
      reeks,
      eindSaldo,
      doelKapitaal: Math.max(doelKapitaal, 3000),
      spreiding: spreiding(age, eindSaldo),
      projectie,
      afwijking,
    });
  }
  return cohorten;
}

export const COHORTEN = buildCohorten();

// ============================================================
//  Werkgevers — totalen-dashboard
// ============================================================
const FRANCHISE = 16500;
const PREMIEPCT_PG = 0.30;
const WG_DEEL = 2 / 3;
const WN_DEEL = 1 / 3;

export interface WerkgeversMaand {
  idx: number;
  maand: string;
  maandKort: string;
  werkgevers: number;
  werknemers: number;
  gemSalaris: number;
  pgPerWerknemer: number;
  pgTotaalJaar: number;
  pgTotaalMaand: number;
  premieTotaal: number;
  premieWg: number;
  premieWn: number;
}

function buildWerkgeversReeks(): WerkgeversMaand[] {
  const actiefTotaal = COHORTEN.reduce(
    (s, c) => s + Math.round(c.aantal * c.actiefP),
    0
  );
  const gemSalaris0 = 48500;
  const cao = [
    0.001, 0.001, 0.000, 0.001, 0.001, 0.020, 0.001, 0.001,
    0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.000, 0.001,
    0.001, 0.020, 0.001, 0.001, 0.001, 0.025, 0.001, 0.001,
  ];
  const reeks: WerkgeversMaand[] = [];
  let salaris = gemSalaris0;
  const werkgevers0 = 372;
  for (let i = 0; i < 24; i++) {
    salaris = salaris * (1 + cao[i]);
    const werkgevers = Math.round(
      werkgevers0 + i * 0.6 + (mulberry32(i * 7 + 1)() * 4 - 2)
    );
    const werknemers = Math.round(
      actiefTotaal * (0.985 + mulberry32(i * 11 + 5)() * 0.03)
    );
    const pgPerWerknemer = salaris - FRANCHISE;
    const pgTotaalJaar = werknemers * pgPerWerknemer;
    const pgTotaalMaand = pgTotaalJaar / 12;
    const premieTotaalMaand = pgTotaalMaand * PREMIEPCT_PG;
    reeks.push({
      idx: i,
      maand: MAANDLABELS[i],
      maandKort: MAANDLABEL_KORT[i],
      werkgevers,
      werknemers,
      gemSalaris: Math.round(salaris),
      pgPerWerknemer: Math.round(pgPerWerknemer),
      pgTotaalJaar: Math.round(pgTotaalJaar),
      pgTotaalMaand: Math.round(pgTotaalMaand),
      premieTotaal: Math.round(premieTotaalMaand),
      premieWg: Math.round(premieTotaalMaand * WG_DEEL),
      premieWn: Math.round(premieTotaalMaand * WN_DEEL),
    });
  }
  return reeks;
}

export const WERKGEVERS_REEKS = buildWerkgeversReeks();

// ─── Werkgever-grootte-segmentatie ───────────────────────────
export interface WgSegment {
  naam: string;
  toelichting: string;
  werkgeversAandeel: number;
  werknemersAandeel: number;
  premieAandeel: number;
  kleur: string;
  werkgeversAantal: number;
  werknemersAantal: number;
  premieAantal: number;
}

export const WG_SEGMENTEN: WgSegment[] = (() => {
  const last = WERKGEVERS_REEKS[WERKGEVERS_REEKS.length - 1];
  const def = [
    { naam: "Klein",  toelichting: "1–25 werknemers",  werkgeversAandeel: 0.66, werknemersAandeel: 0.18, premieAandeel: 0.16, kleur: "#94a3b8" },
    { naam: "Midden", toelichting: "25–200 werknemers", werkgeversAandeel: 0.27, werknemersAandeel: 0.38, premieAandeel: 0.39, kleur: "#0ea5e9" },
    { naam: "Groot",  toelichting: "> 200 werknemers",  werkgeversAandeel: 0.07, werknemersAandeel: 0.44, premieAandeel: 0.45, kleur: "#0F2744" },
  ];
  return def.map((s) => ({
    ...s,
    werkgeversAantal: Math.round(s.werkgeversAandeel * last.werkgevers),
    werknemersAantal: Math.round(s.werknemersAandeel * last.werknemers),
    premieAantal: Math.round(s.premieAandeel * last.premieTotaal),
  }));
})();

// ─── Premie-inning per maand ─────────────────────────────────
export interface InningMaand {
  idx: number;
  maand: string;
  maandKort: string;
  opTijd: number;
  teLaat: number;
  achterstand: number;
}

function buildInningReeks(): InningMaand[] {
  const reeks: InningMaand[] = [];
  let opTijd = 0.93;
  for (let i = 0; i < 24; i++) {
    const seed = mulberry32(i * 19 + 7);
    opTijd = Math.max(
      0.85,
      Math.min(0.97, opTijd + (seed() - 0.5) * 0.04 - (opTijd - 0.92) * 0.30)
    );
    if (i === 14) opTijd = 0.873;
    if (i === 21) opTijd = 0.881;
    const restpct = 1 - opTijd;
    const teLaatRatio = 0.72 + seed() * 0.18;
    const teLaat = restpct * teLaatRatio;
    const achterstand = Math.max(0.005, restpct - teLaat);
    reeks.push({
      idx: i,
      maand: MAANDLABELS[i],
      maandKort: MAANDLABEL_KORT[i],
      opTijd,
      teLaat,
      achterstand,
    });
  }
  return reeks;
}

export const INNING_REEKS = buildInningReeks();

export const INNING_AGGREGAAT = (() => {
  const last12 = INNING_REEKS.slice(-12);
  return {
    opTijd: last12.reduce((s, r) => s + r.opTijd, 0) / 12,
    teLaat: last12.reduce((s, r) => s + r.teLaat, 0) / 12,
    achterstand: last12.reduce((s, r) => s + r.achterstand, 0) / 12,
    maandenOnderNorm: last12.filter((r) => r.opTijd < 0.9).map((r) => r.maandKort),
  };
})();

// ─── Format-helpers ──────────────────────────────────────────
export function fmtEur(v: number): string {
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(Math.round(v));
  if (a >= 1_000_000) return `${sign}€${(a / 1_000_000).toFixed(2).replace(".", ",")} mln`;
  if (a >= 1_000) return `${sign}€${a.toLocaleString("nl-NL")}`;
  return `${sign}€${a}`;
}

export function fmtEurShort(v: number): string {
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(Math.round(v));
  if (a >= 1_000_000) return `${sign}€${(a / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (a >= 1_000) return `${sign}€${(a / 1_000).toFixed(0)}k`;
  return `${sign}€${a}`;
}

export function fmtPct(p: number, dec = 1): string {
  return `${(p * 100).toFixed(dec).replace(".", ",")}%`;
}

export function fmtPctSigned(p: number, dec = 1): string {
  return `${p >= 0 ? "+" : ""}${fmtPct(p, dec)}`;
}
