// ============================================================================
//  verbruik-bundel-core.ts — pure rekenkern voor "Verbruik & bundel" (monitoring)
// ----------------------------------------------------------------------------
//  Repliceert de client-logica uit MOCKUP-monitoring-verbruik-bundel-v0.2.html
//  (`bereken()` / `berekenMaand()`) server-side, als PURE functies zonder IO.
//  De guardrail "governance-logica hoort niet uitsluitend in de frontend" en de
//  eis "reken berekeningen programmatisch na" (CLAUDE.md §Tests) landen hier:
//  verbruik-bundel-core.sanity.ts pint de mockup-uitkomsten voor de vier
//  fictieve fondsen, inclusief de 90/100/110-grensomslag.
//
//  BEGRIPPEN
//   * bundel      = jaarbundel in euro (per fonds, uit fonds_licentie), PRO RATA
//                   vanaf de contract-ingangsdatum: bundel = jaarbundel*actief/12.
//   * actief      = aantal contractmaanden in het peiljaar (12 - startmaandindex).
//   * verstreken  = aantal contractmaanden t/m de peilmaand.
//   * prognose    = annualisering: ytd / verstreken * actief.
//   * aandeel     = ytd / bundel (pro rata).
//   * doorbelast  = max(0, ytd - bundel). ALLEEN WEERGAVE/SIGNAAL (besluit 0178,
//                   B-5): geen factureerbaar bedrag, geen facturatiepad.
//
//  ONDERGRENS (B-4). De euro's leunen op governance_log.retrieval_meta.tokens,
//  een ONDERGRENS: de routes `voorbereiding` en `besluit-concept` schrijven geen
//  governance_log-regel, en reranker/query-reformulatie/web_search tellen niet
//  mee. Deze kern rekent exact; het "indicatief"-voorbehoud hoort in de weergave.
//
//  CACHE (B-3). tokens.in bevat cache_creation + cache_read (chat/route.ts): cache
//  is NIET apart uitsplitsbaar en wordt tegen het input-tarief beprijsd, net als
//  in de mockup. Dat is afgedwongen door het datacontract, geen keuze van de kern.
// ============================================================================

/** Tarief- en bundelconfiguratie per fonds (uit public.fonds_licentie). */
export type LicentieConfig = {
  /** Jaarbundel in euro (vóór pro rata). */
  bundelEurJaar: number;
  /** Tarief per miljoen input-tokens, in euro. */
  tariefInEurMln: number;
  /** Tarief per miljoen output-tokens, in euro. */
  tariefUitEurMln: number;
  /** Contract-ingangsdatum (ISO `YYYY-MM-DD`); bron voor de pro-rata. */
  contractStart: string;
};

/** Cumulatief tokenverbruik van één fonds t/m de peilmaand, in miljoenen. */
export type VerbruikInvoer = {
  /** Input-tokens year-to-date, in miljoenen (som van tokens.in / 1e6). */
  inMln: number;
  /** Output-tokens year-to-date, in miljoenen (som van tokens.out / 1e6). */
  uitMln: number;
};

/** Uitkomst van de cumulatieve jaarberekening voor één fonds. */
export type JaarBerekening = {
  kostIn: number;
  kostUit: number;
  ytd: number;
  bundel: number;
  prognose: number;
  aandeel: number;
  prognosePct: number;
  doorbelast: number;
  status: Status;
  actief: number;
  verstreken: number;
  tokIn: number;
  tokUit: number;
  tokTot: number;
};

export type Status = "groen" | "oranje" | "rood";

/** Aantal maanden in een jaar; de bundel is hierop pro rata. */
export const MAANDEN_PER_JAAR = 12;

/**
 * Maandindex (0 = januari) van de contract-ingangsdatum in het peiljaar.
 * Een contract uit een eerder jaar is in het hele peiljaar actief (index 0);
 * een contract uit een later jaar krijgt sentinel 12 (geen actieve maand).
 * Spiegelt `startIdx` uit de mockup (`parseInt(start.slice(3,5),10) - 1`), maar
 * dan vanuit een ISO-datum in plaats van `dd-mm-jjjj`.
 */
export function startMaandIndex(contractStart: string, peilJaar?: number): number {
  const datum = new Date(contractStart + "T00:00:00Z");
  const maand = datum.getUTCMonth();
  const startJaar = datum.getUTCFullYear();
  if (Number.isNaN(maand) || Number.isNaN(startJaar)) return 0;

  // Zonder expliciet peiljaar blijft de functie bruikbaar voor de mockup- en
  // unitcases: het contractjaar zelf is dan het peiljaar.
  const jaar = peilJaar ?? startJaar;
  if (startJaar < jaar) return 0;
  if (startJaar > jaar) return MAANDEN_PER_JAAR;
  return Math.min(11, Math.max(0, maand));
}

/**
 * Cumulatieve jaarberekening — exact het `bereken()` uit de mockup.
 *
 * @param peilIdx  Maandindex van de peilmaand (0 = januari). In productie de
 *                 huidige maand; bij een afgesloten jaar 11 (december).
 */
export function berekenJaar(
  verbruik: VerbruikInvoer,
  cfg: LicentieConfig,
  peilIdx: number,
  peilJaar?: number
): JaarBerekening {
  const kostIn = verbruik.inMln * cfg.tariefInEurMln;
  const kostUit = verbruik.uitMln * cfg.tariefUitEurMln;
  const ytd = kostIn + kostUit;

  const si = startMaandIndex(cfg.contractStart, peilJaar);
  // Contractmaanden in dit jaar.
  const actief = Math.max(0, MAANDEN_PER_JAAR - si);
  // Contractmaanden t/m de peilmaand. Een nog niet gestart contract heeft 0
  // verstreken maanden; prognose blijft dan 0 in plaats van door nul te delen.
  const verstreken = Math.max(0, Math.min(actief, peilIdx - si + 1));
  const bundel = (cfg.bundelEurJaar * actief) / MAANDEN_PER_JAAR;
  const prognose = verstreken > 0 ? (ytd / verstreken) * actief : 0;
  const aandeel = bundel > 0 ? ytd / bundel : 0;
  const prognosePct = bundel > 0 ? prognose / bundel : 0;
  const doorbelast = Math.max(0, ytd - bundel);

  let status: Status = "groen";
  if (aandeel >= 1 || prognosePct > 1.1) status = "rood";
  else if (prognosePct >= 0.9) status = "oranje";

  return {
    kostIn,
    kostUit,
    ytd,
    bundel,
    prognose,
    aandeel,
    prognosePct,
    doorbelast,
    status,
    actief,
    verstreken,
    tokIn: verbruik.inMln,
    tokUit: verbruik.uitMln,
    tokTot: verbruik.inMln + verbruik.uitMln,
  };
}

/** Uitkomst van de maandberekening; `null` = vóór ingangsdatum of geen data. */
export type MaandBerekening = {
  maandKost: number;
  kostIn: number;
  kostUit: number;
  tokIn: number;
  tokUit: number;
  tokTot: number;
  /** Aandeel van het (pro-rata-neutrale) maandbudget = jaarbundel / 12. */
  aandeel: number;
  status: Status;
  /** Cumulatief euro t/m deze maand. */
  cum: number;
  /** Cumulatief als aandeel van de pro-rata jaarbundel. */
  cumPct: number;
};

/** Eén maand aan verbruik, in euro reeds omgerekend (input en output apart). */
export type MaandInvoer = {
  /** Euro input-tokens in deze maand, of `null` vóór ingangsdatum / geen data. */
  kostIn: number | null;
  /** Euro output-tokens in deze maand. */
  kostUit: number | null;
};

/**
 * Maandberekening — spiegelt `berekenMaand()` uit de mockup, maar gevoed met de
 * ECHTE maand-in/out (de mockup benaderde die via de jaarratio omdat de
 * dummydata alleen maandtotalen had).
 *
 * @param maanden   Euro per maand (0 = januari), input en output apart. `null`
 *                  vóór de ingangsdatum of zonder waarneming → status n.v.t.
 * @param m         De op te vragen maandindex.
 * @param cfg       Licentieconfiguratie (voor bundel/maandbudget + startmaand).
 */
export function berekenMaand(
  maanden: MaandInvoer[],
  m: number,
  cfg: LicentieConfig,
  jaar: JaarBerekening,
  peilJaar?: number
): MaandBerekening | null {
  const si = startMaandIndex(cfg.contractStart, peilJaar);
  const rij = maanden[m];
  if (m < si || !rij || rij.kostIn === null || rij.kostUit === null) return null;

  const kostIn = rij.kostIn;
  const kostUit = rij.kostUit;
  const maandKost = kostIn + kostUit;

  const maandBudget = cfg.bundelEurJaar / MAANDEN_PER_JAAR;
  const aandeel = maandBudget > 0 ? maandKost / maandBudget : 0;

  let status: Status = "groen";
  if (aandeel > 1.1) status = "rood";
  else if (aandeel >= 0.9) status = "oranje";

  // Cumulatief t/m maand m — sluit maanden vóór de ingangsdatum (null) uit.
  let cum = 0;
  for (let i = 0; i <= m; i++) {
    const r = maanden[i];
    if (r && r.kostIn !== null && r.kostUit !== null) cum += r.kostIn + r.kostUit;
  }
  const cumPct = jaar.bundel > 0 ? cum / jaar.bundel : 0;

  // tokIn/tokUit terugrekenen naar miljoenen tokens tegen het geldende tarief,
  // zodat de weergave "x mln tokens" kan tonen zoals de mockup.
  const tokIn = cfg.tariefInEurMln > 0 ? kostIn / cfg.tariefInEurMln : 0;
  const tokUit = cfg.tariefUitEurMln > 0 ? kostUit / cfg.tariefUitEurMln : 0;

  return {
    maandKost,
    kostIn,
    kostUit,
    tokIn,
    tokUit,
    tokTot: tokIn + tokUit,
    aandeel,
    status,
    cum,
    cumPct,
  };
}

// ── Weergavewoorden en formatters (gedeeld door UI en tests) ─────────────────

export const WOORDEN_JAAR: Record<Status, string> = {
  groen: "Binnen bundel",
  oranje: "Nadert bundel",
  rood: "Boven bundel",
};

export const WOORDEN_MAAND: Record<Status, string> = {
  groen: "Op schema",
  oranje: "Boven maandpace",
  rood: "Ruim boven pace",
};

/** "€ 1.234" — hele euro's, Nederlandse notatie (spiegelt `euro` uit de mockup). */
export function euro(n: number): string {
  return "€ " + Math.round(n).toLocaleString("nl-NL");
}

/** "€ 5,32" — twee decimalen (spiegelt `euroC` uit de mockup, voor tarieven). */
export function euroCent(n: number): string {
  return (
    "€ " +
    n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** "1,2 mln" — miljoenen tokens (spiegelt `mln` uit de mockup). */
export function mln(n: number): string {
  return n.toLocaleString("nl-NL", { maximumFractionDigits: 1 }) + " mln";
}
