// ============================================================================
//  §15-matrix — host→fonds-resolutie + fail-closed enforce (T1–T4).
// ----------------------------------------------------------------------------
//  Benoemde, 1-op-1 op de testmatrix (beslisnotitie v0.4 §15) herleidbare tests.
//  Toetst de PURE isolatielaag T1 (bepaalFondsContext + beoordeelToegang) — de
//  host-resolver en de fail-closed toegangsbeoordeling — via het echte
//  productiepad, met enforce=true (de fonds-2-stand). Bouwt of hardt niets:
//  importeert de bestaande functies (geen duplicatie van lib/*.sanity.ts).
//
//  Draaien:  node --import tsx --test tests/cross-tenant/host-enforce.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { bepaalFondsContext, type TenantDomain } from "../../core/lib/tenant-host";
import { beoordeelToegang } from "../../core/lib/tenant-enforce";

const FONDS_A = "11111111-1111-1111-1111-111111111111";
const FONDS_B = "22222222-2222-2222-2222-222222222222";

// Genormaliseerde mapping zoals opgeslagen in public.tenant_domains.
const domains: ReadonlyArray<TenantDomain> = [
  { host: "horizon.nl", fondsId: FONDS_A, actief: true },
  { host: "fonds-b.nl", fondsId: FONDS_B, actief: true },
];

/** Volledig productiepad: resolveer host → beoordeel toegang met de sessie-fonds. */
function poort(host: string | null, sessieFondsId: string | null) {
  const resolutie = bepaalFondsContext({ host, domains });
  return beoordeelToegang({ resolutie, sessieFondsId, enforce: true });
}

test("T1 — gebruiker fonds A op host fonds A → toegestaan", () => {
  assert.deepEqual(poort("horizon.nl", FONDS_A), { toegestaan: true });
});

test("T2 — gebruiker fonds A op host fonds B → geweigerd (fonds-mismatch)", () => {
  assert.deepEqual(poort("fonds-b.nl", FONDS_A), {
    toegestaan: false,
    reden: "fonds-mismatch",
  });
});

test("T3 — gebruiker zonder fonds op fonds-host → geweigerd (fonds-mismatch)", () => {
  assert.deepEqual(poort("horizon.nl", null), {
    toegestaan: false,
    reden: "fonds-mismatch",
  });
});

test("T4 — onbekende host → geweigerd (fail-closed, onbekende-host)", () => {
  assert.deepEqual(poort("onbekend.example", FONDS_A), {
    toegestaan: false,
    reden: "onbekende-host",
  });
  // Ook een bewust inactieve host is fail-closed onbekend.
  assert.deepEqual(poort(null, FONDS_A), {
    toegestaan: false,
    reden: "onbekende-host",
  });
});
