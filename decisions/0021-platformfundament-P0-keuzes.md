# 0021 — Increment P0: platformfundament — bouwkeuzes

- **Status:** Geaccepteerd
- **Datum:** 2026-06-23
- **Betrokkenen:** platform-track (back-office), opdrachtgever (werkopdracht Increment P0)

## Context

[`decisions/0006`](./0006-doorontwikkeling-v2-beslispunten-B1-B10.md) (B14, Optie A) besloot tot een **aparte back-office-surface met een eigen platform-identiteit**, cross-tenant via een gecontroleerd service-role-pad, MFA + least privilege, `platform.*`-capabilities en audit-on-audit. P0 is de **dragende, niet-functionele laag** die dat afdwingt vóór er één functionele platformmodule (P1–P10) op gebouwd wordt. De randvoorwaarden uit `CLAUDE.md` blijven hard: tenant-isolatie via RLS per `fonds_id` mag nooit verzwakken, de service-role-key mag nooit in client-/tenant-code, audit is append-only met hash-keten, en governance/autorisatie hoort server-side (niet alleen in de UI). P0 is **additief**: geen wijziging aan tenant-RLS of `profielen`.

Deze notitie legt de concrete bouwkeuzes vast die binnen de B14-kadernotitie nog open stonden.

## Besluit

1. **Auth-context 3b** — platform-identiteiten leven in **hetzelfde** Supabase-auth-project als de tenants, maar krijgen **géén `profielen`-rij**. De aan- of afwezigheid van een `profielen`-rij is de wederzijdse scheidslijn: de tenant-layout weert een sessie zónder profiel, de platform-auth weigert een sessie **mét** profiel. Geen tweede Supabase-project.
2. **Hosting-variant B** — de platform-surface is een route-group `app/(platform)/platform/…` binnen hetzelfde Next.js/Vercel-project, met een **hostname-middleware** als defense-in-depth-scheiding tussen de platform-host en de tenant-host. Isolatie verder via `import "server-only"`, een afgesplitste service-role-client, een service-role-lek-CI-check en een import-discipline.
3. **Globale hash-keten met advisory lock** — `platform_event_log` voert één globale hash-keten; `fn_platform_event_hash` neemt vóór het bepalen van `prev_hash` een `pg_advisory_xact_lock(hashtext('platform_event_log_chain'))`, zodat twee gelijktijdige inserts nooit hetzelfde `prev_hash` kunnen krijgen.
4. **`digest(...,'sha256')`** (pgcrypto) i.p.v. de letterlijke TO-formulering `sha256(convert_to(...))`, voor consistentie met het bestaande `fn_doc_meta_log_hash`-patroon; de canonieke hash-input volgt exact de veldvolgorde uit TO §6 en sluit bewust `id` (surrogaat) en `bron_ip` (operationeel/PII) uit. De exacte spiegel van deze string is de read-only herberekening in [`scripts/platform_checks.sql`](../scripts/platform_checks.sql) (Deel B, TO §12 test 11).
5. **Twee-fasen audit, fail-closed attempt** — elke platformhandeling logt een `attempt`-event vóór uitvoering (kan de attempt niet weggeschreven worden → 503, handeling gaat niet door) en een **gegarandeerd** `result`-event erna (idempotent + retry; bij definitief falen een `[HIAAT]`-console-fallback). De businessactie draait in een **gescheiden** transactie van de auditregels.
6. **Concrete `PLATFORM_HOST` + deploy-volgorde** — geen hostnaam in code; uitsluitend `process.env.PLATFORM_HOST` (productie `beheer.bestuurdersportaal.com`, lokaal `beheer.localhost:3000`). Ontbrekende/lege env is **fail-closed**: elke host wordt dan als tenant-host behandeld → `/platform/*` overal 404, nooit stilzwijgend open. `app/(platform)/*` mag **nooit** naar productie zonder dat de hostname-middleware in **dezelfde, atomaire** deploy actief is.

## Overwogen alternatieven

- **Apart Supabase-project voor platform-auth (i.p.v. 3b)** — schoner gescheiden, maar dubbele auth-infrastructuur, een tweede gebruikerspool en meer operationele last; niet nodig zolang de profiel-aanwezigheid een harde, server-afgedwongen scheidslijn geeft. Verworpen.
- **Apart Vercel-project / eigen domein nu al (variant C i.p.v. B)** — uiteindelijk denkbaar (FO §5.5), maar zwaarder op te zetten en niet vereist voor P0; variant B met route-group + middleware levert dezelfde externe URL's en houdt de latere C-splitsing open. Uitgesteld.
- **Per-identiteit of per-capability hash-ketens (i.p.v. één globale)** — zou de advisory-lock-contentie verkleinen, maar maakt een integriteitscheck over "het hele auditspoor" complexer en is bij P0-volume onnodig. Verworpen.
- **Hash-keten zonder lock (alleen `order by … limit 1`)** — race-gevoelig: twee gelijktijdige inserts lezen hetzelfde `prev_hash` en vertakken de keten. Verworpen ten gunste van het advisory lock (TO §12 test 11b).
- **`sha256(convert_to(...))` letterlijk uit TO** — functioneel gelijkwaardig, maar wijkt af van het bestaande codebase-patroon; consistentie weegt zwaarder. Verworpen.
- **MFA als boolean-cache (`mfa_enrolled`) als poort** — onveilig: een cache zegt niets over de huidige sessie. De bindende check is een **live AAL2**-hercheck; `mfa_enrolled` is hooguit een hint. Verworpen als poort.

## Gevolgen

- **RLS/tenant-isolatie:** ongemoeid. De vier nieuwe tabellen krijgen RLS met **deny-by-default** voor de anon-key (enige uitzondering: zelf-lezen van de eigen identiteit). Cross-tenant toegang loopt uitsluitend via de service-role **achter** `withPlatform`, niet via policies. Tenant-RLS en `profielen` veranderen niet. De tenant-layout krijgt een extra redirect (sessie zonder profiel → login), wat de wederzijdse 3b-blokkade sluit.
- **Audit/reproduceerbaarheid:** een nieuw append-only, immutable, hash-geketend `platform_event_log` (audit-on-audit). Twee-fasen + fail-closed attempt + gegarandeerd result borgen dat een handeling niet ongelogd kan plaatsvinden; immutability-triggers blokkeren UPDATE/DELETE voor álle rollen.
- **Datamodel/migraties:** [`2026_06_23_platform_fundament.sql`](../supabase/migrations/2026_06_23_platform_fundament.sql) (idempotent, + `_ROLLBACK` voor pré-productie). De seed van `platform_capabilities` is exact de 11-cap-union; de bron-van-waarheid blijft de code-union (CI-consistentiecheck, TO §12 test 17). Anti-privilege-escalatie is op DB-niveau verankerd (self-grant/self-approval-CHECKs) én in code (actor-capability-afhankelijke regels in `valideerGrant`/`valideerRevoke`). Een `unique(correlatie_id, fase)`-index (`ux_pel_correlatie_fase`) hardt de result-idempotentie van `logResultGegarandeerd` van "best effort" naar een DB-garantie: maximaal één attempt + één result per correlatie; de select-first-retry-lus vangt een unique-violation op zonder fail-closed-regressie.
- **Gebruikers-/beheerervaring:** platformbeheerders loggen in op een eigen, MFA-verplichte surface, los van de bestuurders-tenant. P0 toont nog geen functie; het bewijst dat de gate werkt en welke capabilities een identiteit heeft.
- **Bewust geaccepteerde schuld:** `platform_event_log.identity_id` is nullable voor sessieloze security-events (een aparte security/auth-tabel is P9-scope); de TOTP-enroll toont het secret als tekst (geen QR-dependency in P0); 11b (concurrency) is niet pure-SQL automatiseerbaar en blijft een handmatige twee-sessie-verificatie.

## Referenties

- Migratie: [`supabase/migrations/2026_06_23_platform_fundament.sql`](../supabase/migrations/2026_06_23_platform_fundament.sql) (+ `_ROLLBACK`)
- Code: [`lib/supabase-platform.ts`](../lib/supabase-platform.ts), [`lib/platform-auth.ts`](../lib/platform-auth.ts), [`lib/platform-audit.ts`](../lib/platform-audit.ts), [`lib/platform-wrapper.ts`](../lib/platform-wrapper.ts), [`lib/platform-grant-regels.ts`](../lib/platform-grant-regels.ts), [`lib/platform-capabilities.ts`](../lib/platform-capabilities.ts), [`lib/platform-host.ts`](../lib/platform-host.ts), [`middleware.ts`](../middleware.ts)
- Surface: [`app/(platform)/platform/(beveiligd)/layout.tsx`](../app/(platform)/platform/(beveiligd)/layout.tsx), `…/login/page.tsx`; tegenpoort [`app/(dashboard)/layout.tsx`](../app/(dashboard)/layout.tsx)
- Verificatie: [`scripts/platform_checks.sql`](../scripts/platform_checks.sql), [`scripts/check-service-role-leak.sh`](../scripts/check-service-role-leak.sh)
- Eerder besluit: [`decisions/0006`](./0006-doorontwikkeling-v2-beslispunten-B1-B10.md) (B14, Optie A)
