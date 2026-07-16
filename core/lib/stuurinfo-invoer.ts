// ============================================================================
//  Stuurinformatie beheer-invoerlaag — PURE validatie-/opbouwlogica (T14).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle invoerlogica sanity-testbaar is
//  (stuurinfo-invoer.sanity.ts) en de client dezelfde definities kan gebruiken
//  voor de live berekende velden. De server (route handler + RPC) blijft de
//  security-laag; de UI rekent alleen cosmetisch mee.
//
//  Kernbesluiten (decisions/0075, werkopdracht Beheer-invoerlaag):
//  - EXHAUSTIEVE key-allowlist: de payload bevat exact de leaf-posten;
//    subtotalen (toetsvermogen, eigen vermogen, totalen) bestaan niet in de
//    payload-vorm en zijn dus per definitie read-only.
//  - Balansevenwicht is een HARDE validatie (422): hergebruikt leidBalansAf()
//    uit stuurinfo-balans.ts — één definitie, zelfde tolerantie (0.005).
//  - Eén bron per bedrag: de gedeelde standen (soli/mvev/oper/comp) worden bij
//    Balans ingevoerd; bouwReserveRijen() leidt de reserve-rijen daaruit af.
//  - pct_waarde (= stand / technische voorziening × 100, 1 decimaal) wordt
//    hier berekend voor ALLE reserves — de leeslaag leest pct_waarde voor het
//    stoplicht, dus de definitie moet één plek hebben.
// ============================================================================

import {
  leidBalansAf,
  type BalansBronRij,
  type BalansEvenwicht,
} from "./stuurinfo-balans";

// ── Taxonomie (labels/volgorde = T13-seed; de RPC draagt dezelfde lijst) ─────

export const ACTIVA_DEFINITIES = [
  { key: "belegd", label: "Belegd vermogen", volgorde: 1 },
  { key: "overig", label: "Overige activa, vorderingen en liquiditeiten", volgorde: 2 },
] as const;

export const PASSIVA_DEFINITIES = [
  { key: "ev_toets_mvev", label: "MVEV-reserve", volgorde: 1 },
  { key: "ev_toets_oper", label: "Operationele reserve", volgorde: 2 },
  { key: "ev_toets_overig", label: "Overig", volgorde: 3 },
  { key: "ev_soli", label: "Solidariteitsreserve", volgorde: 4 },
  { key: "ev_comp", label: "Compensatiedepot", volgorde: 5 },
  { key: "tv", label: "Technische voorziening", volgorde: 6 },
  { key: "vuk", label: "Voorziening uitvoeringskosten", volgorde: 7 },
  { key: "overig", label: "Overige voorzieningen en passiva", volgorde: 8 },
] as const;

export type ActivaKey = (typeof ACTIVA_DEFINITIES)[number]["key"];
export type PassivaKey = (typeof PASSIVA_DEFINITIES)[number]["key"];

export const ACTIVA_KEYS = ACTIVA_DEFINITIES.map((d) => d.key) as ActivaKey[];
export const PASSIVA_KEYS = PASSIVA_DEFINITIES.map((d) => d.key) as PassivaKey[];

/** Reserve-taxonomie (T13-seed: keys, labels, volgorde 1–8). */
export const RESERVE_DEFINITIES = [
  { key: "solidariteitsreserve", label: "Solidariteitsreserve", volgorde: 1 },
  { key: "mvev_reserve", label: "MVEV-reserve", volgorde: 2 },
  { key: "operationele_reserve", label: "Operationele reserve", volgorde: 3 },
  { key: "kostenreserve", label: "Kostenreserve", volgorde: 4 },
  { key: "ao_reserve", label: "AO-reserve", volgorde: 5 },
  { key: "ppwzp_reserve", label: "PP/Wzp-reserve", volgorde: 6 },
  { key: "ppwzp_reserve_eerbiedigend", label: "PP/Wzp-reserve eerbiedigend", volgorde: 7 },
  { key: "compensatiedepot", label: "Compensatiedepot", volgorde: 8 },
] as const;

export type ReserveKey = (typeof RESERVE_DEFINITIES)[number]["key"];

/** Gedeelde standen: reserve-stand = balanswaarde (één bron per bedrag). */
export const GEKOPPELDE_RESERVES: ReadonlyArray<{
  reserveKey: ReserveKey;
  passivaKey: PassivaKey;
}> = [
  { reserveKey: "solidariteitsreserve", passivaKey: "ev_soli" },
  { reserveKey: "mvev_reserve", passivaKey: "ev_toets_mvev" },
  { reserveKey: "operationele_reserve", passivaKey: "ev_toets_oper" },
  { reserveKey: "compensatiedepot", passivaKey: "ev_comp" },
];

/** Vrij invoerbare reserves (sectie Reserves; niet aan de balans gekoppeld). */
export const VRIJE_RESERVE_KEYS = [
  "kostenreserve",
  "ao_reserve",
  "ppwzp_reserve",
  "ppwzp_reserve_eerbiedigend",
] as const;

export type VrijeReserveKey = (typeof VRIJE_RESERVE_KEYS)[number];

/** Herkomst van de rapportageperiode-cijfers (registry-kolom `bron`). */
export const PERIODE_BRONNEN = [
  { key: "uitvoerder_kwartaal", label: "Uitvoerder — kwartaalrapportage" },
  { key: "uitvoerder_maand", label: "Uitvoerder — maandscan" },
  { key: "handmatig", label: "Handmatige opgave" },
] as const;

export type PeriodeBron = (typeof PERIODE_BRONNEN)[number]["key"];

export type InvoerBron = "handmatig" | "upload";

// ── Payload-vormen ───────────────────────────────────────────────────────────

export type SoliGrenzen = { ondergrens: number | null; bovengrens: number | null };

export type BalansReservesInvoer = {
  periode: string;
  peildatum: string; // ISO ('2026-06-30')
  bron: PeriodeBron;
  invoerBron: InvoerBron;
  activa: Record<ActivaKey, number>;
  passiva: Record<PassivaKey, number>;
  reserves: Record<VrijeReserveKey, number>;
  /** Band solidariteitsreserve (% van TV); null = geen grens. Verplicht veld —
   *  de UI/upload levert altijd de actuele waarden mee (voorgevuld uit GET). */
  grenzen: { solidariteitsreserve: SoliGrenzen };
  financieringsgraad: number;
};

export type PeriodeInvoer = {
  periode: string;
  peildatum: string;
  bron: PeriodeBron;
};

/** Rij voor fonds_stuurinfo_reserve zoals de RPC hem verwacht. */
export type ReserveRijInvoer = {
  reserve_key: ReserveKey;
  label: string;
  stand: number;
  pct_waarde: number;
  ondergrens: number | null;
  bovengrens: number | null;
  volgorde: number;
};

export type InvoerValidatie =
  | { ok: true; invoer: BalansReservesInvoer; evenwicht: BalansEvenwicht }
  | { ok: false; status: 400 | 422; fout: string };

export type PeriodeValidatie =
  | { ok: true; invoer: PeriodeInvoer }
  | { ok: false; fout: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERIODE_REGEX = /^\d{4}Q[1-4]$/;
const ISO_DATUM_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isGetal = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Afronden op 1 decimaal (pct_waarde-conventie van de T13-seed). */
export const rondAf1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Deterministische sorteerwaarde: jaar*4 + kwartaal ('2026Q2' → 8106).
 * Zo sorteert een later ingevoerde historische periode altijd correct.
 * De RPC rekent dezelfde formule in SQL — één definitie per laag, sanity-getest.
 */
export function periodeVolgorde(periode: string): number {
  const m = PERIODE_REGEX.exec(periode);
  if (!m) return 0;
  return Number(periode.slice(0, 4)) * 4 + Number(periode.slice(5, 6));
}

/**
 * Valideert exact de verwachte keys op een object: elke key aanwezig én een
 * finite number, geen enkele key te veel. Subtotalen/afgeleide velden bestaan
 * niet in de allowlist en worden dus altijd geweigerd.
 */
function leesExacteGetallen<K extends string>(
  waarde: unknown,
  keys: readonly K[],
  veldnaam: string
): { ok: true; record: Record<K, number> } | { ok: false; fout: string } {
  if (!isRecord(waarde)) return { ok: false, fout: `Veld '${veldnaam}' ontbreekt of is geen object.` };
  const onbekend = Object.keys(waarde).filter((k) => !(keys as readonly string[]).includes(k));
  if (onbekend.length > 0) {
    return { ok: false, fout: `Onbekend of afgeleid veld in '${veldnaam}': ${onbekend.join(", ")}.` };
  }
  const record = {} as Record<K, number>;
  for (const k of keys) {
    const v = waarde[k];
    if (!isGetal(v)) return { ok: false, fout: `Veld '${veldnaam}.${k}' ontbreekt of is geen getal.` };
    record[k] = v;
  }
  return { ok: true, record };
}

function valideerPeriodeVelden(
  body: Record<string, unknown>
): { ok: true; invoer: PeriodeInvoer } | { ok: false; fout: string } {
  const { periode, peildatum, bron } = body;
  if (typeof periode !== "string" || !PERIODE_REGEX.test(periode)) {
    return { ok: false, fout: "Ongeldige periode — verwacht kwartaalvorm zoals '2026Q2'." };
  }
  if (
    typeof peildatum !== "string" ||
    !ISO_DATUM_REGEX.test(peildatum) ||
    Number.isNaN(Date.parse(peildatum))
  ) {
    return { ok: false, fout: "Ongeldige peildatum — verwacht een datum zoals '2026-06-30'." };
  }
  if (typeof bron !== "string" || !PERIODE_BRONNEN.some((b) => b.key === bron)) {
    return { ok: false, fout: "Ongeldige bron — kies uit de vaste bronnenlijst." };
  }
  return { ok: true, invoer: { periode, peildatum, bron: bron as PeriodeBron } };
}

// ── Validatie: nieuwe periode ────────────────────────────────────────────────

export function valideerPeriodeInvoer(body: unknown): PeriodeValidatie {
  if (!isRecord(body)) return { ok: false, fout: "Ongeldige aanvraag." };
  return valideerPeriodeVelden(body);
}

// ── Validatie: balans + reserves (de kern van de invoerlaag) ────────────────

/**
 * Valideert de volledige save-payload: periodevelden, invoerbron, exhaustieve
 * key-allowlists, grenzen en het balansevenwicht (via leidBalansAf — zelfde
 * definitie en tolerantie als het dashboard). 400 = vormfout; 422 = balans
 * sluit niet of TV onbruikbaar. Bij ok is de payload veilig voor de RPC.
 */
export function valideerBalansInvoer(body: unknown): InvoerValidatie {
  if (!isRecord(body)) return { ok: false, status: 400, fout: "Ongeldige aanvraag." };

  const periodeCheck = valideerPeriodeVelden(body);
  if (!periodeCheck.ok) return { ok: false, status: 400, fout: periodeCheck.fout };

  const invoerBron = body.invoer_bron;
  if (invoerBron !== "handmatig" && invoerBron !== "upload") {
    return { ok: false, status: 400, fout: "Ongeldige invoerbron (handmatig/upload)." };
  }

  const activa = leesExacteGetallen(body.activa, ACTIVA_KEYS, "activa");
  if (!activa.ok) return { ok: false, status: 400, fout: activa.fout };
  const passiva = leesExacteGetallen(body.passiva, PASSIVA_KEYS, "passiva");
  if (!passiva.ok) return { ok: false, status: 400, fout: passiva.fout };
  const reserves = leesExacteGetallen(body.reserves, VRIJE_RESERVE_KEYS, "reserves");
  if (!reserves.ok) return { ok: false, status: 400, fout: reserves.fout };

  if (!isGetal(body.financieringsgraad) || body.financieringsgraad < 0 || body.financieringsgraad > 1000) {
    return { ok: false, status: 400, fout: "Ongeldige financieringsgraad (0–1000%)." };
  }

  // Grenzen (band solidariteitsreserve, % van TV). Verplicht aanwezig; waarden
  // nullable (null = geen grens).
  const grenzenVeld = isRecord(body.grenzen) ? body.grenzen.solidariteitsreserve : undefined;
  if (!isRecord(grenzenVeld)) {
    return { ok: false, status: 400, fout: "Veld 'grenzen.solidariteitsreserve' ontbreekt." };
  }
  const leesGrens = (v: unknown, naam: string): { ok: true; waarde: number | null } | { ok: false; fout: string } => {
    if (v === null) return { ok: true, waarde: null };
    if (!isGetal(v) || v < 0 || v > 100) return { ok: false, fout: `Ongeldige ${naam} (0–100% of leeg).` };
    return { ok: true, waarde: v };
  };
  const onder = leesGrens(grenzenVeld.ondergrens, "ondergrens");
  if (!onder.ok) return { ok: false, status: 400, fout: onder.fout };
  const boven = leesGrens(grenzenVeld.bovengrens, "bovengrens");
  if (!boven.ok) return { ok: false, status: 400, fout: boven.fout };
  if (onder.waarde !== null && boven.waarde !== null && onder.waarde > boven.waarde) {
    return { ok: false, status: 400, fout: "De ondergrens ligt boven de bovengrens." };
  }

  // Technische voorziening draagt de pct-noemer: zonder positieve TV geen
  // betekenisvolle reservepercentages (en geen realistische balans).
  if (passiva.record.tv <= 0) {
    return { ok: false, status: 422, fout: "Technische voorziening moet groter dan nul zijn." };
  }

  const invoer: BalansReservesInvoer = {
    ...periodeCheck.invoer,
    invoerBron,
    activa: activa.record,
    passiva: passiva.record,
    reserves: reserves.record,
    grenzen: { solidariteitsreserve: { ondergrens: onder.waarde, bovengrens: boven.waarde } },
    financieringsgraad: body.financieringsgraad,
  };

  // Balansevenwicht — dezelfde afleiding en tolerantie als het dashboard.
  const evenwicht = berekenEvenwicht(invoer.activa, invoer.passiva);
  if (!evenwicht.sluit) {
    return {
      ok: false,
      status: 422,
      fout: `Balans sluit niet — verschil € ${formatteerVerschil(evenwicht.verschil)} mln (activa − passiva).`,
    };
  }

  return { ok: true, invoer, evenwicht };
}

/** Evenwicht van een leaves-set via leidBalansAf (één definitie, T13). */
export function berekenEvenwicht(
  activa: Record<ActivaKey, number>,
  passiva: Record<PassivaKey, number>
): BalansEvenwicht {
  const naarRijen = (
    record: Record<string, number>,
    definities: ReadonlyArray<{ key: string; label: string; volgorde: number }>
  ): BalansBronRij[] =>
    definities.map((d) => ({
      puntKey: d.key,
      label: d.label,
      volgorde: d.volgorde,
      waarde: record[d.key] ?? 0,
    }));
  return leidBalansAf(
    naarRijen(activa, ACTIVA_DEFINITIES),
    naarRijen(passiva, PASSIVA_DEFINITIES),
    null,
    null
  ).evenwicht;
}

const formatteerVerschil = (verschil: number): string =>
  (Math.round(Math.abs(verschil) * 10) / 10).toLocaleString("nl-NL");

// ── Reserve-rijen opbouwen (gekoppelde standen + pct-berekening) ─────────────

/**
 * Bouwt de 8 reserve-rijen voor de RPC. Gedeelde standen komen uit de balans-
 * passiva (één bron per bedrag); vrije reserves uit de Reserves-sectie.
 * pct_waarde = stand / TV × 100 op 1 decimaal, voor alle rijen. Alleen de
 * solidariteitsreserve draagt de band; de overige reserves zijn bandloos
 * (→ "monitoring" in de leeslaag, T13-besluit).
 */
export function bouwReserveRijen(invoer: BalansReservesInvoer): ReserveRijInvoer[] {
  const tv = invoer.passiva.tv;
  const standVan = (key: ReserveKey): number => {
    const gekoppeld = GEKOPPELDE_RESERVES.find((g) => g.reserveKey === key);
    if (gekoppeld) return invoer.passiva[gekoppeld.passivaKey];
    return invoer.reserves[key as VrijeReserveKey];
  };
  return RESERVE_DEFINITIES.map((d) => ({
    reserve_key: d.key,
    label: d.label,
    stand: standVan(d.key),
    pct_waarde: rondAf1((standVan(d.key) / tv) * 100),
    ondergrens: d.key === "solidariteitsreserve" ? invoer.grenzen.solidariteitsreserve.ondergrens : null,
    bovengrens: d.key === "solidariteitsreserve" ? invoer.grenzen.solidariteitsreserve.bovengrens : null,
    volgorde: d.volgorde,
  }));
}
