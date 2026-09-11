import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const migratie = lees("supabase/migrations/2026_09_04_microsoft_fase1_connectorfundament.sql");
const connector = lees("core/lib/microsoft-connector.ts");
const vault = lees("core/lib/microsoft-vault.ts");
const callback = lees("app/auth/microsoft/callback/route.ts");
const connectorFouten = lees("core/lib/microsoft-connector-error-core.ts");
const vaultRij = lees("core/lib/microsoft-vault-row-core.ts");

test("Microsoft F1 houdt de basisset klein; 2A voegt alleen Calendars.Read.Shared toe en 3 alleen Sites.Selected", () => {
  const config = lees("core/lib/microsoft-config.ts");
  assert.match(config, /MICROSOFT_SCOPES = \["openid", "profile", "offline_access", "User\.Read"\] as const/);
  assert.match(config, /MICROSOFT_OUTLOOK_SCOPES = \[\.\.\.MICROSOFT_SCOPES, "Calendars\.Read\.Shared"\] as const/);
  assert.match(config, /MICROSOFT_SHAREPOINT_SCOPES = \[\.\.\.MICROSOFT_SCOPES, "Sites\.Selected"\] as const/);
  // Bewust verruimd in #321: uitsluitend de Selected-scope; brede lees- of schrijfscopes blijven verboden.
  assert.doesNotMatch(config, /Files\.|Sites\.Read|Sites\.ReadWrite|Sites\.FullControl|Mail\.|Calendars\.ReadWrite/);
});

test("Microsoft F1 gebruikt geen Supabase service-role in het tenantpad", () => {
  for (const [naam, bron] of [["connector", connector], ["vault", vault], ["callback", callback]] as const) {
    assert.doesNotMatch(bron, /SUPABASE_SERVICE_ROLE_KEY|supabase-platform|service_role/i, naam);
  }
  assert.match(vault, /^import "server-only";/);
});

test("private vault is browserdicht en alle definers eindigen op pg_temp", () => {
  assert.match(migratie, /revoke all on schema microsoft_private from public, anon, authenticated/);
  assert.match(migratie, /revoke all on all tables in schema microsoft_private from public, anon, authenticated/);
  assert.match(migratie, /revoke all on all functions in schema microsoft_private from public, anon, authenticated/);
  assert.equal(
    migratie.match(/security definer set search_path = microsoft_private, public, pg_temp/gi)?.length,
    9,
  );
  assert.match(migratie, /raise exception 'microsoft_vault-login ontbreekt/);
  assert.match(vaultRij, /sleutelVersie: rij\.sleutel_versie/);
});

test("nieuwe fondsen starten eigen en de connector blijft bruikbaar na bewuste bronwissel", () => {
  assert.match(migratie, /trg_fonds_integratieprofiel_standaard/);
  assert.match(migratie, /values \(new\.id, 'eigen', false\)/);
  assert.match(connector, /integratieprofiel === "eigen" \|\| data\?\.integratieprofiel === "microsoft"/);
  assert.match(connector, /microsoft_koppeling_pilot === true/);
});

test("callback valideert bestaande sessie en registreert veilige fouten", () => {
  assert.match(callback, /supabase\.auth\.getUser\(\)/);
  assert.match(callback, /microsoftPilotActief/);
  assert.match(callback, /microsoftKoppelfoutcategorie\(fout\)/);
  assert.match(callback, /registreerKoppelfout\(auditContext, categorie\)/);
  assert.match(callback, /Cache-Control": "no-store"/);
  assert.doesNotMatch(callback, /accessToken|idToken|refreshToken/);
  assert.match(connectorFouten, /"token_exchange"/);
  assert.match(connectorFouten, /"identity_validation"/);
  assert.match(connectorFouten, /"graph_me"/);
  assert.match(connectorFouten, /"vault_save"/);
  assert.match(connector, /nonce: geheim\.nonce/);
  assert.match(connectorFouten, /"test_silent_token"/);
  assert.match(connectorFouten, /"test_graph_me"/);
  assert.match(connectorFouten, /"test_cache_save"/);
  assert.match(connector, /Verbindingstest mislukt: \$\{categorie\}/);
});

test("rollback schakelt vaultlogin uit en verwijdert beide schemaonderdelen", () => {
  const rollback = lees("supabase/rollbacks/2026_09_04_microsoft_fase1_connectorfundament_ROLLBACK.sql");
  assert.match(rollback, /alter role microsoft_vault nologin/);
  assert.match(rollback, /drop schema if exists microsoft_private cascade/);
  assert.match(rollback, /drop table if exists public\.fonds_integratie_profielen/);
});
