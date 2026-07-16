// ============================================================================
//  Stuurinformatie Balans-tab — PURE afleidingslogica (T13).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle rekenlogica sanity-testbaar is
//  (stuurinfo-balans.sanity.ts). De server-leeslaag (stuurinfo-bron.ts) haalt
//  de rijen onder fonds-RLS op en roept deze functies aan.
//
//  Kernbesluiten (decisions/0074, werkopdracht Balans-tab):
//  - Alleen LEAF-posten staan in de data; subtotalen (toetsvermogen, eigen
//    vermogen, totalen) worden hier AFGELEID — geen dubbele waarheid.
//  - Balansevenwicht (totaal activa = totaal passiva) is een afgeleide
//    validatie, nooit een invoerveld.
//  - Eén stoplichtdefinitie voor reserves: status = stand t.o.v. de band.
//    Geen band → "monitoring" (neutraal); binnen band → "ok"; onder de
//    ondergrens → "onder" (rood); boven de bovengrens → "boven" (oranje —
//    te veel buffer is een aandachtspunt, geen acuut tekort).
//  - Richting per balanspost wordt afgeleid uit de twee periodewaarden
//    (huidig vs. voorgaand kwartaal) — geen delta-kolom.
// ============================================================================

// ── Vormen ──────────────────────────────────────────────────────────────────

/** Eén leaf-rij uit fonds_stuurinfo_reeks (balans_activa / balans_passiva). */
export type BalansBronRij = {
  puntKey: string;
  label: string | null;
  volgorde: number;
  waarde: number | null;
};

export type Richting = "op" | "neer" | "gelijk";

export type BalansRegel = {
  key: string;
  label: string;
  /** Inspringniveau conform prototype: 0 = hoofdpost, 1 = onder eigen vermogen, 2 = onder toetsvermogen. */
  niveau: 0 | 1 | 2;
  /** true = afgeleide (sub)totaalrij (vet in de UI, niet uit de data). */
  subtotaal: boolean;
  huidig: number;
  vorig: number | null;
  richting: Richting | null;
};

export type BalansEvenwicht = {
  totaalActiva: number;
  totaalPassiva: number;
  verschil: number;
  sluit: boolean;
};

export type BalansOverzicht = {
  activa: BalansRegel[];
  passiva: BalansRegel[];
  evenwicht: BalansEvenwicht;
  /** Evenwicht van het voorgaande kwartaal; null zonder vergelijkingsperiode. */
  evenwichtVorig: BalansEvenwicht | null;
};

export type ReserveStatus = "ok" | "onder" | "boven" | "monitoring";

export type PeriodeRij = { periode: string; peildatum: string; volgorde: number };

// ── Periode-helpers ─────────────────────────────────────────────────────────

/** '2026Q2' → 'Q2 2026' (onbekende vorm valt terug op de ruwe waarde). */
export function formatteerPeriode(periode: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(periode);
  return m ? `Q${m[2]} ${m[1]}` : periode;
}

/** ISO-datum ('2026-06-30') → NL-notatie ('30-06-2026'). */
export function formatteerPeildatum(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/**
 * Kiest de weergegeven periode + de voorgaande uit de registry-lijst
 * (gesorteerd op volgorde, hoog = recentst). Ongeldige of ontbrekende
 * parameter → nieuwste periode (fail-safe, geen error).
 */
export function kiesPeriode(
  periodes: PeriodeRij[],
  gevraagd: string | undefined
): { gekozen: PeriodeRij | null; vorige: PeriodeRij | null } {
  const gesorteerd = periodes.slice().sort((a, b) => b.volgorde - a.volgorde);
  if (gesorteerd.length === 0) return { gekozen: null, vorige: null };
  const idx = gevraagd ? gesorteerd.findIndex((p) => p.periode === gevraagd) : 0;
  const gekozenIdx = idx >= 0 ? idx : 0;
  return {
    gekozen: gesorteerd[gekozenIdx],
    vorige: gesorteerd[gekozenIdx + 1] ?? null,
  };
}

// ── Balans-afleiding ────────────────────────────────────────────────────────

const richtingVan = (huidig: number, vorig: number | null): Richting | null =>
  vorig === null ? null : huidig > vorig ? "op" : huidig < vorig ? "neer" : "gelijk";

/** Passiva-structuur (AZL-lijn): leaf-keys → inspringniveau + volgorde. */
const PASSIVA_LEAVES: Array<{ key: string; niveau: 0 | 1 | 2; fallbackLabel: string }> = [
  { key: "ev_toets_mvev", niveau: 2, fallbackLabel: "MVEV-reserve" },
  { key: "ev_toets_oper", niveau: 2, fallbackLabel: "Operationele reserve" },
  { key: "ev_toets_overig", niveau: 2, fallbackLabel: "Overig" },
  { key: "ev_soli", niveau: 1, fallbackLabel: "Solidariteitsreserve" },
  { key: "ev_comp", niveau: 1, fallbackLabel: "Compensatiedepot" },
  { key: "tv", niveau: 0, fallbackLabel: "Technische voorziening" },
  { key: "vuk", niveau: 0, fallbackLabel: "Voorziening uitvoeringskosten" },
  { key: "overig", niveau: 0, fallbackLabel: "Overige voorzieningen en passiva" },
];

const TOETS_KEYS = new Set(["ev_toets_mvev", "ev_toets_oper", "ev_toets_overig"]);
const EV_KEYS = new Set([...TOETS_KEYS, "ev_soli", "ev_comp"]);

type Kolommen = { huidig: Map<string, BalansBronRij>; vorig: Map<string, BalansBronRij> | null };

const naarMap = (rijen: BalansBronRij[]): Map<string, BalansBronRij> =>
  new Map(rijen.map((r) => [r.puntKey, r]));

// Vorig-kolom: een rij die bestaat maar géén waarde draagt (bv. defensief
// onderdrukt) levert null → de UI toont "—" en géén richtingpijl, in plaats
// van een misleidende 0 met ▲.
const waardeVan = (map: Map<string, BalansBronRij> | null, key: string): number | null => {
  if (!map) return null;
  const rij = map.get(key);
  if (!rij || rij.waarde === null) return null;
  return Number(rij.waarde);
};

const somVan = (map: Map<string, BalansBronRij> | null, filter?: (key: string) => boolean): number | null => {
  if (!map) return null;
  let som = 0;
  for (const [key, rij] of map) {
    if (!filter || filter(key)) som += Number(rij.waarde ?? 0);
  }
  return som;
};

function regel(
  key: string,
  label: string,
  niveau: 0 | 1 | 2,
  subtotaal: boolean,
  huidig: number,
  vorig: number | null
): BalansRegel {
  return { key, label, niveau, subtotaal, huidig, vorig, richting: richtingVan(huidig, vorig) };
}

/**
 * Leidt de volledige balansweergave af uit de leaf-rijen van de gekozen en de
 * voorgaande periode. Onbekende punt_keys tellen mee in de totalen (het
 * evenwicht blijft eerlijk) en verschijnen als extra hoofdpost onderaan de
 * betreffende zijde — geen stille weglating.
 */
export function leidBalansAf(
  activaHuidig: BalansBronRij[],
  passivaHuidig: BalansBronRij[],
  activaVorig: BalansBronRij[] | null,
  passivaVorig: BalansBronRij[] | null
): BalansOverzicht {
  const act: Kolommen = { huidig: naarMap(activaHuidig), vorig: activaVorig ? naarMap(activaVorig) : null };
  const pas: Kolommen = { huidig: naarMap(passivaHuidig), vorig: passivaVorig ? naarMap(passivaVorig) : null };

  // ── Activa: alle leaf-rijen in data-volgorde + afgeleide totaalrij ──
  const activaRijen = activaHuidig
    .slice()
    .sort((a, b) => a.volgorde - b.volgorde)
    .map((r) =>
      regel(r.puntKey, r.label ?? r.puntKey, 0, false, Number(r.waarde ?? 0), waardeVan(act.vorig, r.puntKey))
    );
  const totaalActiva = somVan(act.huidig) ?? 0;
  const totaalActivaVorig = somVan(act.vorig);
  const activa = [...activaRijen, regel("totaal_activa", "Totaal activa", 0, true, totaalActiva, totaalActivaVorig)];

  // ── Passiva: hiërarchie eigen vermogen → toetsvermogen + soli + comp ──
  const leaf = (key: string) => Number(pas.huidig.get(key)?.waarde ?? 0);
  const leafVorig = (key: string) => waardeVan(pas.vorig, key);
  const label = (key: string, fallback: string) => pas.huidig.get(key)?.label ?? fallback;

  const toets = leaf("ev_toets_mvev") + leaf("ev_toets_oper") + leaf("ev_toets_overig");
  const toetsVorig = pas.vorig ? somVan(pas.vorig, (k) => TOETS_KEYS.has(k)) : null;
  const ev = toets + leaf("ev_soli") + leaf("ev_comp");
  const evVorig = pas.vorig ? somVan(pas.vorig, (k) => EV_KEYS.has(k)) : null;

  const passiva: BalansRegel[] = [
    regel("eigen_vermogen", "Eigen vermogen", 0, true, ev, evVorig),
    regel("toetsvermogen", "Toetsvermogen", 1, true, toets, toetsVorig),
  ];
  for (const l of PASSIVA_LEAVES) {
    if (TOETS_KEYS.has(l.key) || pas.huidig.has(l.key)) {
      passiva.push(regel(l.key, label(l.key, l.fallbackLabel), l.niveau, false, leaf(l.key), leafVorig(l.key)));
    }
  }
  // Onbekende punt_keys: zichtbaar als extra hoofdpost (geen stille weglating).
  const bekend = new Set(PASSIVA_LEAVES.map((l) => l.key));
  for (const r of passivaHuidig) {
    if (!bekend.has(r.puntKey)) {
      passiva.push(
        regel(r.puntKey, r.label ?? r.puntKey, 0, false, Number(r.waarde ?? 0), waardeVan(pas.vorig, r.puntKey))
      );
    }
  }
  const totaalPassiva = somVan(pas.huidig) ?? 0;
  const totaalPassivaVorig = somVan(pas.vorig);
  passiva.push(regel("totaal_passiva", "Totaal passiva", 0, true, totaalPassiva, totaalPassivaVorig));

  const evenwichtVan = (a: number, p: number): BalansEvenwicht => ({
    totaalActiva: a,
    totaalPassiva: p,
    verschil: a - p,
    // Kleine numerieke tolerantie (numeric → JS-float); bedragen zijn € mln.
    sluit: Math.abs(a - p) < 0.005,
  });

  return {
    activa,
    passiva,
    evenwicht: evenwichtVan(totaalActiva, totaalPassiva),
    evenwichtVorig:
      totaalActivaVorig !== null && totaalPassivaVorig !== null
        ? evenwichtVan(totaalActivaVorig, totaalPassivaVorig)
        : null,
  };
}

// ── Reserve-stoplicht ───────────────────────────────────────────────────────

/**
 * Eén stoplichtdefinitie (decisions/0074): status = stand (pct) t.o.v. de band.
 *  - geen band (beide grenzen null)      → "monitoring" (neutraal, geen kleur)
 *  - pct onbekend terwijl er een band is → "monitoring" (geen schijnzekerheid)
 *  - onder de ondergrens                 → "onder"  (rood)
 *  - boven de bovengrens                 → "boven"  (oranje)
 *  - anders                              → "ok"     (groen, binnen band)
 */
export function leidReserveStatusAf(
  ondergrens: number | null,
  bovengrens: number | null,
  pctWaarde: number | null
): ReserveStatus {
  if (ondergrens === null && bovengrens === null) return "monitoring";
  if (pctWaarde === null) return "monitoring";
  if (ondergrens !== null && pctWaarde < ondergrens) return "onder";
  if (bovengrens !== null && pctWaarde > bovengrens) return "boven";
  return "ok";
}

// ── Mutatie-helpers (KPI-tegels) ────────────────────────────────────────────

/** Procentuele mutatie t.o.v. het voorgaande kwartaal; null zonder bruikbare basis. */
export function mutatiePct(huidig: number | null, vorig: number | null): number | null {
  if (huidig === null || vorig === null || vorig === 0) return null;
  return ((huidig - vorig) / Math.abs(vorig)) * 100;
}

/** Mutatie in procentpunten (voor de financieringsgraad); null zonder beide waarden. */
export function mutatiePt(huidig: number | null, vorig: number | null): number | null {
  if (huidig === null || vorig === null) return null;
  return huidig - vorig;
}
