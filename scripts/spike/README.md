# Spike T0.5 — #335 Microsoft-login (route B)

Geen productiecode. Bewijst lokaal dat `linkIdentity`/`signInWithIdToken` met een server-side
ID-token werken **zonder** Supabase-callbackregistratie in Entra en **zonder** `email`-scope,
dat een onbekende identiteit `signup_disabled` geeft zonder `auth.users`-rij, dat de hosted flow
bij Entra strandt, én dat de Custom Access Token Hook **de exacte identiteit** toetst: een
`oauth`-sessie zonder binding op precies deze `sub`/`tid`/`oid` krijgt geen token — dus ook geen
directe PostgREST-toegang. Zie `MICROSOFT-365-LOGIN-F1B-ONTWERP.md` §9.1.

De spike gebruikt bewust een directe OIDC authorization-codeflow. MSAL-node 6.0 voegt aan dit
pad automatisch `offline_access` toe; dat past niet bij de minimale login-app. De spike bouwt
daarom authorize- en tokenrequests zelf, valideert PKCE/state/nonce plus discovery, JWKS-host,
RS256-handtekening, issuer, audience en geldigheid, en faalt als Microsoft een refresh-token
uitgeeft.

## Vooraf (opdrachtgever)

1. Entra: app-registratie **Bestuurdersportaal Login (spike)** in onze tenant:
   - *Accounts in this organizational directory only*;
   - Web redirect-URI: `http://localhost:3999/callback` — en **niet** de Supabase-callback;
   - *Allow public client flows* = No; implicit grant (access + ID) uit;
   - API permissions: alleen delegated `openid`, `profile` (geen `email`, `offline_access`, `User.Read`);
   - Token configuration → optional claim (ID): `acct`;
   - clientsecret aanmaken.
2. Eén Microsoft-testaccount (lid van de tenant). Voor S7 een tweede account met hetzelfde
   e-mailadres als het lokale testaccount.

## Lokale stack

De CLI draait via de `npx`-shim op `supabase@2.114.0` (pint `supabase/gotrue:v2.195.0`); er is
geen `supabase`-dependency in de repo. `/auth/v1/health` (S8) is het doorslaggevende versiebewijs.

Zet tijdelijk (niet committen) in `supabase/config.toml`:

```toml
[auth]
enable_signup = false
enable_manual_linking = true
jwt_expiry = 600

[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/spike_access_token_hook"

[auth.external.azure]
enabled = true
client_id = "env(MICROSOFT_LOGIN_CLIENT_ID)"
secret = "env(MICROSOFT_LOGIN_CLIENT_SECRET)"
url = "https://login.microsoftonline.com/<tenant-id>"
```

Verse stack + hookprototype (shims: zie geheugen "lokale DB-testketen"):

```bash
supabase stop --no-backup && bash scripts/start-ephemeral-supabase.sh && bash scripts/testdb-apply-migrations.sh
```

```bash
psql "$TEST_DATABASE_URL" -f scripts/spike/spike-hook.sql
```

Het prototype maakt de NOLOGIN-rol `spike_hook_owner`, schema `spike_private` met de
bindingstabel (`user_id`, `status`, `sub`, `tid`, `oid`), de kleine `SECURITY DEFINER`-helper
`identiteit_toegestaan` (eigenaar `spike_hook_owner`, lege `search_path`) en de publieke hook
`spike_access_token_hook` (`SECURITY INVOKER`, draait als `supabase_auth_admin`, leest
`auth.identities` binnen de GoTrue-transactie).

Maak een lokaal wachtwoordaccount met profiel (bestaande seed/fixtures) en zet in `.env.spike`
(valt onder `.env*` in `.gitignore`):

```
SPIKE_SUPABASE_URL=http://127.0.0.1:54321
SPIKE_SUPABASE_ANON_KEY=<uit `supabase status`>
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
MICROSOFT_LOGIN_TENANT_ID=<tid>
MICROSOFT_LOGIN_CLIENT_ID=<client-id>
MICROSOFT_LOGIN_CLIENT_SECRET=<secret>
SPIKE_TEST_EMAIL=<lokaal testaccount>
SPIKE_TEST_PASSWORD=<wachtwoord>
```

## Hoofdmodus (hook aan)

Controleer eerst zonder browserlogin of de autorisatieparameters exact blijven:

```bash
SPIKE_PREFLIGHT_ONLY=1 node --env-file=.env.spike scripts/spike/microsoft-login-spike.mjs
```

```bash
node --env-file=.env.spike scripts/spike/microsoft-login-spike.mjs > SPIKE-335-T0.5.md
```

Het script print op stderr een Microsoft-login-URL (**bevat tijdelijk state-/noncemateriaal;
niet delen**); open die in de browser en log in met het testaccount. De callbackserver luistert
op `127.0.0.1:3999`, valideert `state`/`error`/`code` vóór hij sluit en stopt na vijf minuten.
Als een beheerder de consentprompt ziet, blijft **Toestemming namens uw organisatie** voor deze
gebruikersspike uitgevinkt. Na persoonlijke consent ziet hetzelfde account de prompt bij volgende
logins niet opnieuw, tenzij consent wordt ingetrokken of scopes wijzigen.
Metingen: S8, S1, S2, S3a (geen reservering → 403, geen identiteit), **S3a' (pending voor
identiteit A → link met token B → 403, volledige rollback)**, S3b, **S3c (custom_claims tid/oid
= tokenclaims)**, S4, S10e (basislijn oauth-REST), S10a, S10b (venster + refresh 403), S10c,
**S10d (wachtwoordsessie-REST)**, S5, S6 (alleen redirect-controle), S0. `finally` ruimt
identiteit en spike-bindingen op en sluit de databaseverbinding.

## S7-modus (negatieve e-mailkoppelingstest; hook UIT)

Zet in `config.toml` de hook op `enabled = false`, herstart de stack, en draai:

```bash
SPIKE_MODE=s7 SPIKE_S7_VERWACHT=auto_link SPIKE_SCOPES="openid profile email" node --env-file=.env.spike scripts/spike/microsoft-login-spike.mjs > SPIKE-335-T0.5-s7.md
```

Log in met het **tweede** account (zelfde e-mailadres als het lokale testaccount). De
verwachting wordt vooraf uitgesproken via `SPIKE_S7_VERWACHT`; een afwijkende uitkomst is rood:

| Run | Instelling | `SPIKE_S7_VERWACHT` |
|---|---|---|
| 1 | hook uit, `email`-scope, geen linking domain | `auto_link` — sessie uitgegeven en identiteit aan het bestaande account (R-28 via de id-token-ingang) |
| 2 | als 1, plus `GOTRUE_EXPERIMENTAL_PROVIDER_LINKING_DOMAINS="azure=microsoft_login"` op de lokale auth-container | `signup_disabled` |
| 3 | hook uit, zonder `email`-scope | `signup_disabled` |

Het script ruimt de identiteit op.

## Exitcode

Elke ❌ op een harde meting telt; het script eindigt dan met exitcode 1 en de laatste regel van het
rapport zegt hoeveel metingen rood zijn. Een groene commandorun betekent dus een groene spike.

## Handmatig

- **S6 (browser):** open de door het script geprinte `…/auth/v1/authorize?provider=azure&…`-URL.
  Verwacht: Entra-foutpagina **AADSTS50011**. Controleer daarna dat `auth.users` en
  `auth.identities` ongewijzigd zijn. Een server-side `fetch()` van de Entra-pagina is geen
  betrouwbaar bewijs; daarom handmatig.
- **S9 (hosted platform, read-only):**

  ```bash
  SPIKE_PROJECT_REF=<preview-ref> SUPABASE_MANAGEMENT_API_TOKEN=<token> node scripts/spike/management-auth-config.mjs
  ```

  Leest `GET /v1/projects/{ref}/config/auth` en toont uitsluitend een vaste allowlist
  (P1–P4, P7, P8), de lijst ingeschakelde OAuth-providers (P9: alleen `azure`) en of er een
  linking-domain-sleutel bestaat (P6). De ruwe respons wordt niet opgeslagen.

## Opruimen

Hook uit in `config.toml`, herstart, daarna:

```bash
psql "$TEST_DATABASE_URL" -f scripts/spike/spike-hook-ROLLBACK.sql
```
