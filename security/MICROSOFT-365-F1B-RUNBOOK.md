# Microsoft-login fase 1B — runbook (#335, besluit 0211)

Dit runbook hoort bij migratie `supabase/migrations/2026_09_06_microsoft_login_fase1b.sql`
(T1/PR-A) en beschrijft het provisionen van de databaserollen, de omgevingsvariabelen en de
Supabase-/Entra-configuratie die **later** (T3) nodig is. In T1 wordt niets extern
ingeschakeld: geen Azure-provider, geen Custom Access Token Hook, geen `jwt_expiry`-wijziging,
geen fondsactivering.

## Harde voorwaarden (blokkerend; zie besluit 0211 en ontwerp §3.3)

| # | Voorwaarde | Status |
|---|---|---|
| S7 | Negatieve e-mailkoppelingstest met een tweede Microsoft-account (drie runs, `SPIKE-335-T0.5.md`) | **open** — T1 mag worden gebouwd en gereviewd, maar **niet gemerged** en PGB **niet geactiveerd** vóór S7 groen is |
| S9 | Preview-authconfiguratie gemeten (read-only, allowlist) | rood als nulmeting (verwacht vóór T3); geen implementatiefout |
| P5 | Supabase Auth ≥ 2.185.0 (`GET /auth/v1/health`) | te meten vóór iedere activering |
| — | Besluit 0211 blijft *Voorgesteld* tot S7 én de Preview-uitrolvoorwaarden groen zijn | — |

## 1. Rollen provisionen (vóór de migratie; per omgeving)

Voer uit als `postgres` in de Supabase SQL-editor. Genereer het wachtwoord interactief en
bewaar het uitsluitend in de secretstore; zet het nooit in een script of commit.

```sql
-- 1a. Minimale loginrol voor de server-side gateway (patroon microsoft_vault / ai_gateway).
create role login_gateway
  login password '<interactief gegenereerd>'
  noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 5;

-- 1b. NOLOGIN-eigenaar van de hookhelper: geen login, geen bypassrls, geen create-rechten.
create role login_hook_owner
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
```

Controle (zonder wachtwoord):

```sql
select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolconnlimit
from pg_roles where rolname in ('login_gateway','login_hook_owner');
```

De migratie geeft `login_hook_owner` daarna uitsluitend: `SELECT` op
`login_private.microsoft_identiteiten`, kolom-`SELECT` op `public.profielen(id, fonds_id)` en
`public.fonds_microsoft_login(fonds_id, actief, entra_tenant_id)`, elk met een expliciete
tenantgebonden leespolicy, en `USAGE` (geen `CREATE`) op `public` en `login_private`.

Verwacht: `login_gateway` met `rolcanlogin=true`, alle andere bevoegdheidsvelden `false`,
`rolinherit=false`, connection limit ≤ 5; `login_hook_owner` met `rolcanlogin=false` en alle
bevoegdheidsvelden `false`. De migratie faalt gesloten als een van beide ontbreekt.

Opmerking: omdat `postgres` de rollen aanmaakt (CREATEROLE, geen superuser), krijgt hij een
permanent, impliciet ADMIN-lidmaatschap zonder INHERIT/SET. Dat is onschadelijk en wordt door
de check-suite onderscheiden van het tijdelijke migratielidmaatschap, dat wél weg moet zijn.

## 2. Migratie en bewijs

1. Pas `2026_09_06_microsoft_login_fase1b.sql` toe (één transactie). De migratie is
   idempotent; herhaald draaien is veilig.
2. Draai als database-eigenaar, in deze volgorde:
   - `supabase/checks/2026_09_06_microsoft_login_fase1b.sql` (DEEL 2 rolt volledig terug);
   - `supabase/checks/2026_07_31_r1_structurele_gates.sql` (A–H);
   - `supabase/checks/2026_08_20_v3_grants_volledig.sql` (de vier publieke objecten staan
     in `allowlist-grants.tsv`);
   - `supabase/checks/2026_08_31_secdef_self_gate.sql`.
3. Controleer dat geen enkel fonds actief is:

   ```sql
   select count(*) filter (where actief) as actief, count(*) as totaal from public.fonds_microsoft_login;
   ```

   Verwacht: `actief = 0`.

## 3. Omgevingsvariabelen (Vercel, uitsluitend `preview-stable`; T2 gebruikt ze)

| Variabele | Doel |
|---|---|
| `LOGIN_GATEWAY_DATABASE_URL` | connection string van `login_gateway` (pooler, TLS) |
| `LOGIN_GATEWAY_CA_CERT_BASE64` | base64 van de Supabase-CA; TLS is verplicht (`rejectUnauthorized`) |
| `LOGIN_GATEWAY_DB_SSL=uit` | **alleen** lokaal, samen met `SEED_DOELOMGEVING=local` (dubbele grendel) |
| `MICROSOFT_LOGIN_TENANT_ID`, `MICROSOFT_LOGIN_CLIENT_ID`, `MICROSOFT_LOGIN_CLIENT_SECRET` | App L (T2) |
| `MICROSOFT_LOGIN_ENCRYPTION_KEY`, `MICROSOFT_LOGIN_KEY_VERSION` | eigen sleutel voor de flowtransacties (T2; besluit 0211 D7) |

Lokale wegwerp-stack: `scripts/testdb-apply-migrations.sh` maakt beide rollen als fixture
(`login_gateway` met het niet-geheime wachtwoord `login_gateway_lokaal`).

## 4. Supabase-projectconfiguratie (T3 — NIET in T1)

Volgorde is blokkerend (S9-nulmeting: alles staat nog uit, `jwt_exp=3600`):

1. Auth-versie meten: `GET https://<project>.supabase.co/auth/v1/health` → `version ≥ 2.185.0`.
2. **Custom Access Token Hook** inschakelen: type Postgres, functie
   `public.fn_access_token_hook` (schema `public`). Vanaf dit moment weigert elke
   `oauth`-tokenuitgifte zonder exacte binding; wachtwoordsessies zijn onaangetast.
3. Azure-provider aan met client-id/secret van App L en tenant-URL
   `https://login.microsoftonline.com/<tid>`; *Allow new users to sign up* uit; *Manual
   linking* aan; redirect-allowlist ongewijzigd (alleen de bestaande `/auth/callback`).
4. `jwt_expiry = 600` (Preview; intrekkingsvenster ≤ 10 min, besluit 0211 D12).
5. Meet opnieuw met `scripts/spike/management-auth-config.mjs` (read-only, allowlist): P1–P4,
   P7, P8 groen en P9 = uitsluitend `azure`.
6. Pas dán, na groene S7 en de T2-code: één fonds activeren (id-gebonden, patroon fase 1):

   ```sql
   update public.fonds_microsoft_login
      set actief = true, entra_tenant_id = '<tid>', pilotstatus = 'pilot', bijgewerkt = now()
    where fonds_id = '<fonds-id>' and actief = false
   returning fonds_id, actief, pilotstatus;
   ```

   Verwacht exact één rij; de wijziging staat daarna in `login_private.audit_log`
   (`config.gewijzigd`, zonder tenant-id).

## 5. Entra App L (T3 — invarianten E1–E7)

Single-tenant; alleen delegated `openid profile`; optionele ID-token-claim `acct`; redirect-URI's
uitsluitend `https://<fondshost>/auth/microsoft-login/callback`; **nooit** de Supabase-callback;
*Allow public client flows* = No; implicit/hybrid uit. Periodieke hercontrole van het manifest is
onderdeel van de smoke.

## 6. Kill switch, rollback en herstel

- **Kill switch:** `update public.fonds_microsoft_login set actief = false where fonds_id = …`.
  De hook toetst bij elke uitgifte de actuele configuratie: vanaf dat moment weigert hij voor
  dit fonds élke nieuwe `oauth`-tokenuitgifte én refresh (403), ook bij een rechtstreekse
  `signInWithIdToken`. Bindingen blijven bestaan (herstel = flag weer aan). Al uitgegeven
  access-tokens blijven hooguit tot `exp` geldig (≤ 600 s op Preview, besluit 0211 D12).
  Hetzelfde geldt bij een tenantwijziging (`entra_tenant_id`) en bij een fondsverplaatsing
  van het profiel: de binding matcht niet meer met de actuele stand en wordt geweigerd.
- **Noodintrekking van één account:** als `postgres`
  `select login_private.start_intrekking(<fonds>, <user>, <beheerder>, 'incident-…');`
  daarna `unlinkIdentity` (T2) of verwijdering van de `azure`-identiteit via de Auth-admin, en
  `voltooi_intrekking`. Zonder `active` binding weigert de hook elke `oauth`-tokenuitgifte.
- **Rollback van de migratie:** `supabase/rollbacks/2026_09_06_microsoft_login_fase1b_ROLLBACK.sql`,
  in de volgorde uit de kop van dat bestand (flag uit → hook en provider uit → T2-code terug →
  rollback). Het script weigert zolang `login_private.audit_log` regels bevat; exporteer eerst.
  `login_gateway` gaat op NOLOGIN; beide rollen blijven bestaan.
- **Herstel van een half-afgeronde koppeling:** `pending` + bestaande identiteit →
  `herstel_koppeling` (T2-route); `pending` zonder identiteit verloopt na 10 minuten naar
  `failed` (`pending_verlopen`) en houdt het slot niet bezet.

## 7. Wat er nooit in logs of audit staat

Tokens, authorization codes, `state`/`nonce`, claims, e-mailadressen. De audit bewaart alleen
fonds, actor, `sha256(tid:oid)`, foutcategorie en correlatie-id; de hook logt niets.
