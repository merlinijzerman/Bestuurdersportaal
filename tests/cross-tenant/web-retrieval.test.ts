// ============================================================================
//  §15-matrix — Scenario A live web-retrieval (besluit 0072). App-laag (pure
//  functies + bron-inspectie). De DB-kant (RLS: tenant leest alleen actieve
//  entries, schrijven deny-by-default; log append-only) staat in de migratie
//  2026_07_15_bron_whitelist.sql en wordt hier via bron-inspectie geborgd.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/web-retrieval.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matchWhitelist, allowedDomeinenUit, type WhitelistEntry } from "../../core/lib/web-whitelist";
import { beoordeelWebGate, bouwWebbronnen } from "../../core/lib/web-retrieval";
import { bevatPersoonsgegevens } from "../../core/lib/pii-gate";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

function entry(p: Partial<WhitelistEntry>): WhitelistEntry {
  return {
    id: "x", domein: "dnb.nl", matchtype: "domein_subdomeinen", pad: null,
    normgewicht: "bindend", categorie: null, tier: "1", status: "actief", toelichting: "t",
    ...p,
  };
}

// ── (1) FR-1 / anti-fabricage: niet-whitelist wordt geweigerd ───────────────
test("0072 — niet-whitelist-URL matcht niet en wordt geen bron", () => {
  const wl = [entry({ domein: "dnb.nl" })];
  assert.equal(matchWhitelist("https://kwaadaardig.example/x", wl), null);
  const bronnen = bouwWebbronnen(
    [{ url: "https://kwaadaardig.example/x", titel: "nep", paginaDatum: null }],
    wl,
    "2026-07-15T10:00:00.000Z"
  );
  assert.equal(bronnen.length, 0);
});

// ── (2) FR-9 / AC-10: PII blokkeert web-retrieval ───────────────────────────
test("0072 — vraag met persoonsgegevens blokkeert de web-gate", () => {
  const pii = bevatPersoonsgegevens("Zoek iets op voor deelnemer 123456782");
  assert.equal(pii.bevatPii, true);
  const gate = beoordeelWebGate({
    vlagAan: true, aantalActieveEntries: 5, scopeActief: false,
    bronsoortprofiel: "generiek", bevatPii: pii.bevatPii,
  });
  assert.equal(gate.mag, false);
  assert.equal(gate.reden, "pii_geblokkeerd");
});

// ── (3) FR-1: allowed_domains alleen uit actieve entries ────────────────────
test("0072 — allowed_domains bevat geen inactieve entries", () => {
  const wl = [entry({ domein: "dnb.nl", status: "actief" }), entry({ domein: "afm.nl", status: "inactief" })];
  const ad = allowedDomeinenUit(wl);
  assert.ok(ad.includes("dnb.nl"));
  assert.ok(!ad.includes("afm.nl"));
});

// ── (4) Bron-inspectie: de chat-route roept de gate + PII + whitelist aan ────
test("0072 — chat-route bevat de web-gate, PII-gate en whitelist-fetch", () => {
  const route = lees("app", "api", "chat", "route.ts");
  assert.match(route, /beoordeelWebGate/, "web-gate moet server-side worden aangeroepen");
  assert.match(route, /bevatPersoonsgegevens/, "PII-gate moet server-side worden aangeroepen");
  assert.match(route, /haalActieveWhitelist/, "whitelist moet server-side worden gelezen");
  assert.match(route, /WEB_RETRIEVAL_ACTIEF/, "web-retrieval moet achter de env-vlag hangen");
  // Herverificatie van citaties tegen de whitelist (defense-in-depth).
  assert.match(route, /bouwWebbronnen/, "citaties moeten worden herverifieerd tegen de whitelist");
});

// ── (5) Bron-inspectie: RLS-invarianten in de migratie ──────────────────────
test("0072 — migratie: whitelist RLS aan, tenant leest alleen actief, geen write-policy", () => {
  const mig = lees("supabase", "migrations", "2026_07_15_bron_whitelist.sql");
  assert.match(mig, /alter table public\.bron_whitelist\s+enable row level security/i);
  // Leespolicy uitsluitend op status='actief'.
  assert.match(mig, /for select using \(status = 'actief'/i);
  // Geen insert/update/delete-policy op bron_whitelist (deny-by-default).
  assert.equal(/create policy[^;]*on public\.bron_whitelist[^;]*for (insert|update|delete)/i.test(mig), false);
  // Log is append-only.
  assert.match(mig, /bron_whitelist_log is append-only/);
});

// ── (6) Bron-inspectie: beheerscherm-mutaties achter withPlatform ───────────
test("0072 — whitelist-beheeracties lopen via withPlatform (platform.config.manage)", () => {
  const acties = lees("app", "(platform)", "platform", "(beveiligd)", "bronnen-whitelist", "acties.ts");
  assert.match(acties, /withPlatform/);
  assert.match(acties, /platform\.config\.manage/);
  // Elke mutatie schrijft een append-only domeinlog.
  assert.match(acties, /bron_whitelist_log/);
});
