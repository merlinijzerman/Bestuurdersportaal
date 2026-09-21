import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bepaalFondsContext, type TenantDomain } from "../../core/lib/tenant-host";
import { bepaalSurface } from "../../core/lib/platform-host";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lees = (pad: string) => readFileSync(resolve(ROOT, pad), "utf8");
const migratie = lees("supabase/migrations/2026_09_22_428_app365_demo_fonds_config.sql");
const preview = lees("supabase/seeds/preview/2026_09_22_428_app365_preview_provision.sql");
const productie = lees("supabase/seeds/production/2026_09_22_428_app365_production_provision.sql");
const previewRollback = lees("supabase/rollbacks/2026_09_22_428_app365_preview_ROLLBACK.sql");
const productieRollback = lees("supabase/rollbacks/2026_09_22_428_app365_production_ROLLBACK.sql");

test("gedeelde migratie is host- en omgevingsvrij en bevat de volledige veilige matrix", () => {
  for (const verboden of ["app365.bestuurdersportaal.com", "app365.preview.bestuurdersportaal.com", "swviwoytzvaqypieqgji", "aebwiufuegsiwhwpdrfb", "tenant_domains"])
    assert.doesNotMatch(migratie, new RegExp(verboden.replaceAll(".", "\\.")), verboden);
  assert.match(migratie, /'m365-demo'/);
  assert.match(migratie, /'generatie_timeout_ms', '120000'::jsonb/);
  assert.match(migratie, /'microsoft_copilot_retrieval', 'false'::jsonb/);
  assert.match(migratie, /modus = 'uit' and actief = false and entra_tenant_id is null/);
  assert.match(migratie, /<> 13/);
  assert.match(migratie, /<> 17/);
});

test("environmentpakketten bevatten uitsluitend hun eigen app365-host", () => {
  assert.match(preview, /app365\.preview\.bestuurdersportaal\.com/);
  assert.match(productie, /app365\.bestuurdersportaal\.com/);
  assert.match(preview, /values \('app365\.preview\.bestuurdersportaal\.com', v_fonds, true\)/);
  assert.match(productie, /values \('app365\.bestuurdersportaal\.com', v_fonds, true\)/);
  assert.match(previewRollback, /delete from public\.tenant_domains where host='app365\.preview\.bestuurdersportaal\.com'/);
  assert.match(productieRollback, /delete from public\.tenant_domains where host='app365\.bestuurdersportaal\.com'/);
});

test("exacte app365-host resolveert; www en verkeerde tenant falen gesloten", () => {
  const fonds = "11111111-1111-1111-1111-111111111111";
  const domains: TenantDomain[] = [{ host: "app365.bestuurdersportaal.com", fondsId: fonds, actief: true }];
  assert.deepEqual(bepaalFondsContext({ host: "app365.bestuurdersportaal.com", domains }), { type: "gevonden", fondsId: fonds });
  assert.deepEqual(bepaalFondsContext({ host: "www.app365.bestuurdersportaal.com", domains }), { type: "onbekend" });
  assert.deepEqual(bepaalFondsContext({ host: "app365.bestuurdersportaal.com:443@evil.test", domains }), { type: "onbekend" });
  assert.equal(bepaalSurface({ host: "www.app365.bestuurdersportaal.com", appHost: "app365.bestuurdersportaal.com" }), "app", "geldige onbekende host blijft achter de app-authgate maar krijgt geen tenantcontext");
});

test("providerrollback verwijdert DNS aantoonbaar vóór Vercel-domain", () => {
  const runbook = lees("security/M365-APP365-428-FASE1-RUNBOOK.md");
  for (const kop of ["Providerrollback Preview", "Providerrollback Productie"]) {
    const blok = runbook.slice(runbook.indexOf(kop), runbook.indexOf("## ", runbook.indexOf(kop) + kop.length));
    assert.ok(blok.indexOf("DNS-record") < blok.indexOf("domain"), kop);
  }
});
