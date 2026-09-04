import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const migratie = lees("supabase/migrations/2026_09_04_microsoft_sharepoint_fase3.sql");
const config = lees("core/lib/microsoft-config.ts");
const connector = lees("core/lib/microsoft-connector.ts");
const sharepoint = lees("core/lib/microsoft-sharepoint.ts");
const graphCore = lees("core/lib/microsoft-sharepoint-graph-core.ts");
const vault = lees("core/lib/microsoft-vault.ts");

test("SharePoint fase 3 gebruikt uitsluitend delegated Sites.Selected en de driedubbele fonds-poort", () => {
  assert.match(config, /MICROSOFT_SHAREPOINT_SCOPES = \[\.\.\.MICROSOFT_SCOPES, "Sites\.Selected"\] as const/);
  assert.doesNotMatch(config, /Files\.|Sites\.Read|Sites\.ReadWrite|Sites\.FullControl|Sites\.Manage|AllSites/);
  assert.match(connector, /microsoft_sharepoint_fase3/);
  assert.match(connector, /gedelegeerdToken\(ctx, "Sites\.Selected"\)/);
  assert.match(connector, /scopesMetUitbreiding/);
  assert.match(lees("app/api/microsoft/sharepoint/status/route.ts"), /capability: "profile\.view\.own"/);
  assert.match(lees("app/api/microsoft/sharepoint/toestemming/route.ts"), /capability: "profile\.manage\.own"/);
  for (const route of ["kandidaten", "drives", "mappen", "bron", "bron/controle"]) assert.match(lees(`app/api/microsoft/sharepoint/${route}/route.ts`), /capability: "fonds\.config\.manage"/);
  assert.match(lees("app/auth/microsoft/callback/route.ts"), /microsoftSharePointActief/);
});

test("bronselectie accepteert alleen server-geverifieerde kandidaten, drives en mapketens", () => {
  assert.match(sharepoint, /leesSharePointKandidaten\(ctx\.fondsId\)/);
  assert.match(sharepoint, /normaliseerDrives\(items\)\.find\(\(x\) => x\.driveId === driveId\)/);
  assert.match(sharepoint, /verifieerMapketen/);
  assert.match(sharepoint, /SHAREPOINT_MAX_ROOTMAP_DIEPTE/);
  assert.match(graphCore, /veiligeVervolgLink/);
  assert.match(graphCore, /redirect: "error"/);
  assert.match(graphCore, /AbortSignal\.timeout/);
  assert.match(graphCore, /retryNa\(response\)/);
  assert.doesNotMatch(graphCore, /\/content|@microsoft\.graph\.downloadUrl/);
  assert.doesNotMatch(sharepoint, /\/content|@microsoft\.graph\.downloadUrl/);
});

test("private SharePoint-bron is browserdicht, fondsgebonden en zonder kandidaat-schrijfpad", () => {
  assert.match(migratie, /create table if not exists microsoft_private\.sharepoint_kandidaatsites/);
  assert.match(migratie, /create table if not exists microsoft_private\.sharepoint_bronnen/);
  assert.match(migratie, /fonds_id uuid not null unique references public\.fondsen/);
  assert.match(migratie, /'Sites\.Selected' = any\(scopes\)/);
  assert.match(migratie, /v_kandidaat\.hostnaam <> lower\(p_site_host\)/);
  assert.match(migratie, /configuratieversie=sharepoint_bronnen\.configuratieversie\+1/);
  assert.equal(migratie.match(/security definer set search_path = microsoft_private, public, pg_temp/gi)?.length, 5);
  assert.doesNotMatch(migratie, /sharepoint_(maak|schrijf|registreer)_kandidaat/);
  assert.match(migratie, /revoke all on all functions in schema microsoft_private from public, anon, authenticated/);
  for (const naam of ["sharepoint_lees_kandidaten", "sharepoint_lees_bron", "sharepoint_configureer_bron", "sharepoint_registreer_controle", "sharepoint_ontkoppel_bron"]) {
    assert.match(migratie, new RegExp(`grant execute on function microsoft_private\\.${naam}\\([^)]*\\) to microsoft_vault`));
  }
  assert.doesNotMatch(vault, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.match(lees("scripts/cross-tenant-ci.sh"), /2026_09_04_microsoft_sharepoint_fase3\.sql/);
});

test("audit en status blijven inhoudsarm: geen externe identifiers in audit, geen id's in de statusprojectie", () => {
  assert.match(migratie, /jsonb_build_object\('bron_id',v_id/);
  assert.doesNotMatch(migratie, /jsonb_build_object\([^)]*(site_id|drive_id|root_item_id)/);
  const statusBlok = sharepoint.slice(sharepoint.indexOf("export async function sharepointStatus"), sharepoint.indexOf("export async function sharepointKandidaten"));
  assert.doesNotMatch(statusBlok, /site_id|drive_id|root_item_id|tenant_id/);
  assert.match(lees("app/(dashboard)/profiel/_components/SharePointBronKaart.tsx"), /Alleen een fondsbeheerder kan de SharePoint-bron kiezen/);
});

test("rollback verwijdert de fase-3A-objecten en laat fase 1 en 2A staan", () => {
  const rollback = lees("supabase/rollbacks/2026_09_04_microsoft_sharepoint_fase3_ROLLBACK.sql");
  assert.match(rollback, /drop table if exists microsoft_private\.sharepoint_bronnen/);
  assert.match(rollback, /drop table if exists microsoft_private\.sharepoint_kandidaatsites/);
  assert.doesNotMatch(rollback, /drop schema|verbindingen|outlook_/);
});

// ── Deel B: documentenlijst, preview, bibliotheek en CSP ─────────────────────
const migratieB = lees("supabase/migrations/2026_09_04_microsoft_sharepoint_fase3b_documenten.sql");
const previewRoute = lees("app/api/microsoft/sharepoint/documenten/[ref]/preview/route.ts");
const lijstRoute = lees("app/api/microsoft/sharepoint/documenten/route.ts");
const previewPagina = lees("app/(dashboard)/bibliotheek/sharepoint/[ref]/page.tsx");
const nextConfig = lees("next.config.ts");

test("lijst en preview lopen met het token van de gebruiker, zonder content-call en met vaste plafonds", () => {
  assert.match(lijstRoute, /capability: "documents\.view"/);
  assert.match(previewRoute, /capability: "documents\.view"/);
  assert.match(previewRoute, /audit: \{ handeling: "microsoft\.sharepoint\.documenten\.previewen" \}/);
  assert.match(sharepoint, /deltaUrl\(driveId, rootItemId\)/);
  assert.match(sharepoint, /SHAREPOINT_MAX_DOCUMENTEN/);
  assert.match(sharepoint, /SHAREPOINT_MAX_KINDDIEPTE/);
  assert.match(sharepoint, /itemOnderRoot\(item, document\.drive_id, rootPadVanItem\(root, document\.drive_id\)\)/);
  assert.match(sharepoint, /previewActieUrl\(document\.drive_id, document\.item_id\)/);
  assert.match(sharepoint, /veiligeSharePointUrl\(preview\.getUrl\)/);
  assert.doesNotMatch(sharepoint, /\/content|downloadUrl|createLink/);
});

test("de preview-URL wordt nergens bewaard, gelogd of geaudit", () => {
  const previewBlok = sharepoint.slice(sharepoint.indexOf("export async function sharepointPreview"));
  assert.doesNotMatch(previewBlok, /console\.(log|error|warn)/);
  assert.doesNotMatch(previewBlok, /details: \{[^}]*url/i);
  assert.match(previewBlok, /details: \{ document_ref: ref, latency_ms/);
  assert.match(previewRoute, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(migratieB, /preview_url|get_url|getUrl/);
  assert.match(migratieB, /p_details::text ~\* '\(https\?:\/\/\|sharepoint\\\.com\|bearer\|token\|drive_id\|item_id\)'/);
  assert.doesNotMatch(vault, /console\./);
});

test("de previewpagina is de enige route met frame-src naar SharePoint en gebruikt een strikte iframe", () => {
  assert.match(nextConfig, /source: "\/bibliotheek\/sharepoint\/:ref"/);
  assert.match(nextConfig, /frame-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/\*\.sharepoint\.com/);
  // De algemene CSP houdt de oude frame-src; alleen de afgeleide previewvariant voegt SharePoint toe.
  assert.equal(nextConfig.match(/https:\/\/\*\.sharepoint\.com/g)?.length, 1);
  assert.match(nextConfig, /const cspDirectivesSharePointPreview = cspDirectives\.replace\(/);
  assert.match(nextConfig, /"frame-src 'self' https:\/\/challenges\.cloudflare\.com",/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(previewPagina, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups"/);
  assert.match(previewPagina, /referrerPolicy="no-referrer"/);
  assert.match(previewPagina, /method: "POST", cache: "no-store"/);
  assert.doesNotMatch(previewPagina, /localStorage|sessionStorage|router\.push\(.*url|history\./);
});

test("documentregister bewaart geen inhoud en is fondsgebonden; bibliotheek blijft gelijk zonder vlag", () => {
  assert.match(migratieB, /create table if not exists microsoft_private\.sharepoint_documenten/);
  assert.match(migratieB, /unique \(bron_id, item_id\)/);
  assert.match(migratieB, /where d\.fonds_id = p_fonds and b\.fonds_id = p_fonds and d\.id = p_ref/);
  const tabelBlok = migratieB.slice(migratieB.indexOf("create table if not exists microsoft_private.sharepoint_documenten"), migratieB.indexOf("create index if not exists sharepoint_documenten_fonds_idx"));
  assert.doesNotMatch(tabelBlok, /bytea|vector\(|inhoud|tekst|chunk|embedding|preview/);
  assert.equal(migratieB.match(/security definer set search_path = microsoft_private, public, pg_temp/gi)?.length, 4);
  assert.match(lees("scripts/cross-tenant-ci.sh"), /2026_09_04_microsoft_sharepoint_fase3b_documenten\.sql/);
  const bibliotheek = lees("app/(dashboard)/bibliotheek/page.tsx");
  assert.match(bibliotheek, /\{actieveTab === "fonds" && <SharePointDocumentenSectie \/>\}/);
  const sectie = lees("app/(dashboard)/bibliotheek/_components/SharePointDocumentenSectie.tsx");
  assert.match(sectie, /if \(!antwoord\?\.beschikbaar\) return null;/);
  assert.match(sectie, /Openen in Microsoft 365/);
  assert.match(sectie, /rel="noopener noreferrer"/);
  assert.match(lijstRoute, /beschikbaar: false/);
});
