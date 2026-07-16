// ============================================================
//  Sanity-tests voor de beheer-invoerlaag stuurinformatie (T14, decisions/0075).
//
//  Borgt de risicovolle invoerlogica: exhaustieve key-allowlist (afgeleide
//  velden per definitie geweigerd), het harde balansevenwicht (422, zelfde
//  tolerantie als de leeslaag), de pct-berekening en de gekoppelde reserve-
//  standen (één bron per bedrag), grenzen-validatie en het deterministische
//  periodevolgorde-schema (jaar*4 + kwartaal).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-invoer.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  valideerBalansInvoer,
  valideerPeriodeInvoer,
  bouwReserveRijen,
  berekenEvenwicht,
  periodeVolgorde,
  rondAf1,
  RESERVE_DEFINITIES,
  type BalansReservesInvoer,
} from "./stuurinfo-invoer";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Prototypebedragen Horizon 2026Q2 (T13-seed) — balans sluit exact:
// activa 2400+80 = 2480 = passiva 10+9+2+78+41+2328+8+4.
const geldigeBody = () => ({
  periode: "2026Q2",
  peildatum: "2026-06-30",
  bron: "uitvoerder_kwartaal",
  invoer_bron: "handmatig",
  activa: { belegd: 2400, overig: 80 },
  passiva: {
    ev_toets_mvev: 10, ev_toets_oper: 9, ev_toets_overig: 2,
    ev_soli: 78, ev_comp: 41, tv: 2328, vuk: 8, overig: 4,
  },
  reserves: { kostenreserve: 40, ao_reserve: 19, ppwzp_reserve: 7, ppwzp_reserve_eerbiedigend: 0.1 },
  grenzen: { solidariteitsreserve: { ondergrens: 1.5, bovengrens: 5.0 } },
  financieringsgraad: 106.0,
});

console.log("stuurinfo-invoer sanity-tests:");

// ── Geldige payload ──────────────────────────────────────────────────────────

test("geldige payload (Horizon Q2) wordt geaccepteerd met sluitend evenwicht", () => {
  const r = valideerBalansInvoer(geldigeBody());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.evenwicht.sluit, true);
    assert.equal(r.evenwicht.totaalActiva, 2480);
    assert.equal(r.evenwicht.totaalPassiva, 2480);
    assert.equal(r.invoer.invoerBron, "handmatig");
  }
});

// ── Allowlist: afgeleide/onbekende velden worden geweigerd (400) ─────────────

test("afgeleid veld 'toetsvermogen' in passiva → 400", () => {
  const body = geldigeBody() as Record<string, unknown>;
  body.passiva = { ...(geldigeBody().passiva as object), toetsvermogen: 21 };
  const r = valideerBalansInvoer(body);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.match(r.fout, /toetsvermogen/);
  }
});

test("onbekend veld in activa → 400; ontbrekend veld → 400", () => {
  const metExtra = geldigeBody() as Record<string, unknown>;
  metExtra.activa = { belegd: 2400, overig: 80, totaal_activa: 2480 };
  const r1 = valideerBalansInvoer(metExtra);
  assert.equal(r1.ok, false);

  const zonderVeld = geldigeBody() as Record<string, unknown>;
  zonderVeld.activa = { belegd: 2400 };
  const r2 = valideerBalansInvoer(zonderVeld);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.status, 400);
});

test("niet-finite waarde (NaN/string) → 400", () => {
  const body = geldigeBody() as Record<string, unknown>;
  body.passiva = { ...geldigeBody().passiva, tv: "2328" };
  assert.equal(valideerBalansInvoer(body).ok, false);
  const body2 = geldigeBody() as Record<string, unknown>;
  body2.financieringsgraad = Number.NaN;
  assert.equal(valideerBalansInvoer(body2).ok, false);
});

// ── Balansevenwicht hard (422) ───────────────────────────────────────────────

test("balans die € 1 mln niet sluit → 422 met verschil in de melding", () => {
  const body = geldigeBody();
  body.activa.belegd = 2401; // activa 2481 vs passiva 2480
  const r = valideerBalansInvoer(body);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 422);
    assert.match(r.fout, /Balans sluit niet/);
  }
});

test("tolerantie-rand: verschil 0.004 sluit nog, 0.01 niet (leeslaag-definitie)", () => {
  const bijna = berekenEvenwicht(
    { belegd: 2400.004, overig: 80 },
    geldigeBody().passiva
  );
  assert.equal(bijna.sluit, true);
  const netNiet = berekenEvenwicht(
    { belegd: 2400.01, overig: 80 },
    geldigeBody().passiva
  );
  assert.equal(netNiet.sluit, false);
});

test("technische voorziening 0 → 422 (pct-noemer onbruikbaar)", () => {
  const body = geldigeBody();
  // Houd de balans sluitend zodat specifiek de TV-check triggert.
  body.passiva.tv = 0;
  body.passiva.overig = 4 + 2328;
  const r = valideerBalansInvoer(body);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 422);
});

// ── Gekoppelde reserves + pct-berekening (één bron per bedrag) ──────────────

test("gekoppelde standen komen uit de balans-passiva (soli 78, mvev 10, oper 9, comp 41)", () => {
  const r = valideerBalansInvoer(geldigeBody());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rijen = bouwReserveRijen(r.invoer);
  const stand = (key: string) => rijen.find((x) => x.reserve_key === key)?.stand;
  assert.equal(stand("solidariteitsreserve"), 78);
  assert.equal(stand("mvev_reserve"), 10);
  assert.equal(stand("operationele_reserve"), 9);
  assert.equal(stand("compensatiedepot"), 41);
  assert.equal(stand("kostenreserve"), 40);
  assert.equal(stand("ppwzp_reserve_eerbiedigend"), 0.1);
});

test("pct_waarde = stand/TV×100 op 1 decimaal (78/2328 → 3.4; 0.1/2328 → 0)", () => {
  const r = valideerBalansInvoer(geldigeBody());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rijen = bouwReserveRijen(r.invoer);
  const pct = (key: string) => rijen.find((x) => x.reserve_key === key)?.pct_waarde;
  assert.equal(pct("solidariteitsreserve"), 3.4); // NB: seed had handafgerond 3.3
  assert.equal(pct("kostenreserve"), 1.7);
  assert.equal(pct("ppwzp_reserve_eerbiedigend"), 0);
});

test("alleen de solidariteitsreserve draagt de band; volgorde = T13-seed (1–8)", () => {
  const r = valideerBalansInvoer(geldigeBody());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rijen = bouwReserveRijen(r.invoer);
  assert.equal(rijen.length, RESERVE_DEFINITIES.length);
  const soli = rijen.find((x) => x.reserve_key === "solidariteitsreserve");
  assert.equal(soli?.ondergrens, 1.5);
  assert.equal(soli?.bovengrens, 5.0);
  assert.equal(soli?.volgorde, 1);
  for (const rij of rijen) {
    if (rij.reserve_key !== "solidariteitsreserve") {
      assert.equal(rij.ondergrens, null);
      assert.equal(rij.bovengrens, null);
    }
  }
});

// ── Grenzen-validatie ────────────────────────────────────────────────────────

test("ondergrens boven bovengrens → 400; null-grenzen (geen band) zijn geldig", () => {
  const fout = geldigeBody();
  fout.grenzen = { solidariteitsreserve: { ondergrens: 6, bovengrens: 5 } };
  assert.equal(valideerBalansInvoer(fout).ok, false);

  const zonderBand = geldigeBody() as Record<string, unknown>;
  zonderBand.grenzen = { solidariteitsreserve: { ondergrens: null, bovengrens: null } };
  const r = valideerBalansInvoer(zonderBand);
  assert.equal(r.ok, true);
  if (r.ok) {
    const soli = bouwReserveRijen(r.invoer).find((x) => x.reserve_key === "solidariteitsreserve");
    assert.equal(soli?.ondergrens, null);
  }
});

// ── Periode-invoer + volgorde ────────────────────────────────────────────────

test("periode-invoer: geldig kwartaal + datum + bron-allowlist", () => {
  const ok = valideerPeriodeInvoer({ periode: "2026Q3", peildatum: "2026-09-30", bron: "handmatig" });
  assert.equal(ok.ok, true);
  assert.equal(valideerPeriodeInvoer({ periode: "2026-Q3", peildatum: "2026-09-30", bron: "handmatig" }).ok, false);
  assert.equal(valideerPeriodeInvoer({ periode: "2026Q5", peildatum: "2026-09-30", bron: "handmatig" }).ok, false);
  assert.equal(valideerPeriodeInvoer({ periode: "2026Q3", peildatum: "morgen", bron: "handmatig" }).ok, false);
  assert.equal(valideerPeriodeInvoer({ periode: "2026Q3", peildatum: "2026-09-30", bron: "seed_synthetisch" }).ok, false);
});

test("kwaadaardige periode-strings falen op de vormvalidatie (geen tenant-vector)", () => {
  for (const kwaad of ["'; drop table x; --", "2026Q1' or '1'='1", "../2026Q1", ""]) {
    assert.equal(valideerPeriodeInvoer({ periode: kwaad, peildatum: "2026-09-30", bron: "handmatig" }).ok, false);
  }
});

test("periodeVolgorde deterministisch: 2026Q1→8105, 2026Q2→8106, 2025Q4→8104 (historisch sorteert goed)", () => {
  assert.equal(periodeVolgorde("2026Q1"), 8105);
  assert.equal(periodeVolgorde("2026Q2"), 8106);
  assert.equal(periodeVolgorde("2025Q4"), 8104);
  assert.ok(periodeVolgorde("2025Q4") < periodeVolgorde("2026Q1"));
  assert.equal(periodeVolgorde("rommel"), 0);
});

test("rondAf1: 3.3505→3.4 (half-up), 1.717→1.7, 0.004→0", () => {
  assert.equal(rondAf1(3.3505), 3.4);
  assert.equal(rondAf1(1.717), 1.7);
  assert.equal(rondAf1(0.004), 0);
});

// ── Vorm-/bronvalidatie ──────────────────────────────────────────────────────

test("ongeldige invoerbron of niet-object body → 400", () => {
  const body = geldigeBody() as Record<string, unknown>;
  body.invoer_bron = "seed";
  assert.equal(valideerBalansInvoer(body).ok, false);
  assert.equal(valideerBalansInvoer(null).ok, false);
  assert.equal(valideerBalansInvoer("tekst").ok, false);
});

console.log(`\nstuurinfo-invoer: ${n} sanity-tests geslaagd.`);

// Type-anker: BalansReservesInvoer blijft de vorm die de RPC verwacht.
const _type: BalansReservesInvoer | null = null;
void _type;
