# Microsoft 365 — fase 1B Preview-smokeplan PGB (Microsoft-login, #335 T3)

> Draaiboek, geen uitvoering. Dit document wijzigt niets aan Entra, Supabase of Vercel en
> activeert geen flag. Uitvoering pas na: T1/PR-A gemerged en op Preview gemigreerd,
> T2/PR-B gemerged en gedeployed op `preview-stable`, **spike S7 groen** (drie negatieve
> e-mailkoppelingruns, `SPIKE-335-T0.5.md`), en akkoord van de opdrachtgever.
> Ontwerp: `MICROSOFT-365-LOGIN-F1B-ONTWERP.md` §3.3 (invarianten E1–E7, P1–P9, O1), §8;
> T2-ontwerp: `MICROSOFT-365-LOGIN-F1B-T2-ONTWERP.md`. Patroon: `MICROSOFT-365-F1-RUNBOOK.md`.

Vaste gegevens (controleer ze vóór elke stap opnieuw, neem ze niet over uit dit document):

| Gegeven | Waarde/bron |
|---|---|
| Fondshost PGB Preview | `https://pgb.preview.bestuurdersportaal.com` (actieve `tenant_domains`-rij) |
| Platformhost Preview | `https://app.preview.bestuurdersportaal.com` (Site-URL; geen Microsoft-login) |
| PGB `fonds_id` | `37fdca3b-e92b-4671-b6b7-ac2bb83e3b89` (fase-1-runbook; **herhaal de preflight**) |
| Vercel-omgeving | custom environment `preview-stable` (uitsluitend) |
| Supabase-project | het Preview-project (eigen Supabase; S9-nulmeting 2026-09-06) |

Nooit vastleggen in dit runbook, in tickets, logs of chat: clientsecret, database-URL met wachtwoord, CA-inhoud, encryptiesleutel, tokens, codes, `state`/`nonce`, e-mailadressen van testaccounts, volledige tenant-/accountnamen.

---

## 1. Provisioningvolgorde (blokkerend, in deze volgorde)

De S9-nulmeting bewijst dat manual linking, de Azure-provider, de Auth-hook en `jwt_exp=600` op Preview nog **uit** staan. De volgorde is dwingend omdat de hook pas mag worden ingeschakeld als de functie bestaat, en de fondsflag pas als alles ervoor gemeten groen is.

| Stap | Wat | Wie | Bewijs |
|---|---|---|---|
| 1 | Databaserollen `login_gateway` (LOGIN, minimaal, connection limit ≤ 5) en `login_hook_owner` (NOLOGIN) aanmaken — interactief, wachtwoord alleen in de Preview-secretstore | opdrachtgever | `pg_roles`-query (§1.1) |
| 2 | T1-migratie `2026_09_06_microsoft_login_fase1b.sql` toepassen; daarna `supabase/checks/2026_09_06_microsoft_login_fase1b.sql` als database-eigenaar → DEEL 1 én DEEL 2 `OK` | opdrachtgever | psql exit 0, twee OK-notices; `2026_07_31_r1_structurele_gates.sql` en V3-grants-gate schoon |
| 3 | Entra App L conform §2 | opdrachtgever (Entra-beheerder) | manifest-export in het changebewijs (zonder secret) |
| 4 | Supabase Auth conform §3, **in de volgorde van §3** (P5 → P2/P3/P4 → P1 → P7 → P8) | opdrachtgever | `management-auth-config.mjs` read-only met vaste allowlist (S9-script) + `/auth/v1/health` |
| 5 | Vercel-geheimen conform §4; nieuwe `preview-stable`-deployment | opdrachtgever | deployment-id in changebewijs |
| 6 | Fondsactivering uitsluitend PGB conform §5 | opdrachtgever | `returning`-rij van de id-gebonden update (exact één rij) |
| 7 | Smoke §6 en §7 | opdrachtgever + Claude (analyse van de uitkomsten, geen configuratiewijziging) | ingevuld meetblad §8 |

### 1.1 Rolpreflight (zonder wachtwoord in het script)

```sql
select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolconnlimit
from pg_roles where rolname in ('login_gateway', 'login_hook_owner') order by 1;
```

Verwacht: `login_gateway` met `rolcanlogin=true`, alle andere bevoegdheidsvelden `false`, `rolinherit=false`, `rolconnlimit ≤ 5`; `login_hook_owner` met `rolcanlogin=false` en alle bevoegdheidsvelden `false`. Ontbreekt een rol, dan faalt de migratie gesloten (preflight in de migratie).

---

## 2. App L-configuratie (Entra, "Bestuurdersportaal Login")

Aparte registratie naast de Graph-connector-app; nooit dezelfde client-id.

| Invariant | Instelling | Controle |
|---|---|---|
| E1 | *Supported account types*: **Accounts in this organizational directory only** (single tenant) | manifest `signInAudience = AzureADMyOrg` |
| E2 | API permissions: uitsluitend delegated **`openid`**, **`profile`**. Géén `email`, `offline_access`, `User.Read`, Graph, application permissions | manifest `requiredResourceAccess` |
| E3 | Token configuration → optional claim (ID-token) **`acct`** | manifest `optionalClaims.idToken` bevat `acct` |
| E4 | Authentication → Web redirect URI's: exact `https://pgb.preview.bestuurdersportaal.com/auth/microsoft-login/callback`. Géén andere fondshost, géén Vercel-deployment-URL, géén productiehost | manifest `web.redirectUris` = exact één |
| **E5** | **Nooit** `https://<project-ref>.supabase.co/auth/v1/callback` | manifest; smoke §7 N5 |
| E6 | *Allow public client flows* = **No** | manifest `isFallbackPublicClient = false` |
| E7 | Implicit grant: *Access tokens* en *ID tokens* **uit**; geen hybrid flow | manifest `implicitGrantSettings.*` = false |
| — | Clientsecret aanmaken met beperkte looptijd; verloopdatum in de roulatiekalender | alleen in Vercel `preview-stable` |
| — | Consent: pilot met **persoonlijke** consent; een beheerder laat *Toestemming namens uw organisatie* uitgevinkt (ontwerp §3.1) | — |

Redirect-URI en `MICROSOFT_LOGIN_CLIENT_ID` moeten gelijk zijn aan de Azure-client-id die in Supabase (P1) wordt gezet; anders faalt `aud` bij `signInWithIdToken`.

---

## 3. Supabase Auth-configuratie (Preview-project, dashboard)

Volgorde is dwingend en volgt `MICROSOFT-365-F1B-RUNBOOK.md` §4 (T1): eerst de versie meten, dan de **hook** (zodat élke `oauth`-uitgifte al bewaakt is vóór er een provider bestaat), dan de provider met signup uit en manual linking aan, dan de JWT-verkorting, dan meten.

| Volg | Invariant | Instelling | Meting |
|---|---|---|---|
| 1 | **P5** | Auth-versie ≥ 2.185.0 (GHSA-v36f-qvww-8w8m) — **harde uitrolvoorwaarde**; bij lagere versie stoppen | `GET https://<ref>.supabase.co/auth/v1/health` → `version` |
| 2 | **P7** | Custom Access Token Hook **aan**, type Postgres, functie `public.fn_access_token_hook` (schema `public`; `supabase_auth_admin` heeft execute en usage op `public` en `login_private` via de migratie). Vanaf nu weigert elke `oauth`-uitgifte zonder exacte binding; wachtwoordsessies onaangetast | S9-script; **direct daarna** één wachtwoordlogin + één refresh op de PGB-host en op de platformhost (MFA) — R-40; rood ⇒ hook uit (§9) |
| 3 | P2 | *Allow new users to sign up* **uit** (S9: al goed) | S9-script `disable_signup=true` |
| 4 | P3 | *Manual linking* **aan** | S9-script |
| 5 | P4 | Redirect-allowlist **ongewijzigd** (alleen de bestaande `/auth/callback`-doelen; geen wildcards, geen Supabase-callback in Entra) | dashboard |
| 6 | **P9** | Geen andere OAuth-provider ingeschakeld; blijft zo (nieuwe provider ⇒ eerst hookwijziging) | S9-script: lijst = `[]` vóór stap 7, `["azure"]` erna |
| 7 | P1 | Azure-provider **aan**: client-id = App L, secret = App L-secret, *Azure Tenant URL* = `https://login.microsoftonline.com/<tenant-id>` (exact, geen `/v2.0`) | S9-script |
| 8 | **P8** | JWT expiry **600 s** (Preview-pilot; projectbreed; besluit 0211 D12) | S9-script `jwt_exp=600` |
| 9 | P6 | Linking domain `azure=microsoft_login`: **niet via Management API beschikbaar** (S9); navraag bij Supabase-support vastleggen; ontwerp hangt er niet primair van af | supportticketnummer in changebewijs |

Controle achteraf (read-only, tijdelijk persoonlijk Management-API-token van ≤ 1 uur, daarna intrekken):

```bash
SPIKE_PROJECT_REF=<preview-ref> SUPABASE_MANAGEMENT_API_TOKEN=<token> node scripts/spike/management-auth-config.mjs
```

Verwacht: alle allowlist-sleutels groen, providers exact `["azure"]`, ruwe respons niet opgeslagen.

---

## 4. Vercel-geheimen (uitsluitend `preview-stable`)

| Variabele | Type | Waarde/afleiding |
|---|---|---|
| `MICROSOFT_LOGIN_TENANT_ID` | Config | tenant-id van onze Entra-tenant |
| `MICROSOFT_LOGIN_CLIENT_ID` | Config | App L client-id (= Supabase-Azure-client-id) |
| `MICROSOFT_LOGIN_CLIENT_SECRET` | **Secret** | App L-secret |
| `MICROSOFT_LOGIN_ENCRYPTION_KEY` | **Secret** | 32 bytes, base64; **nieuw gegenereerd**, nooit `MICROSOFT_VAULT_ENCRYPTION_KEY` hergebruiken |
| `MICROSOFT_LOGIN_KEY_VERSION` | Config | `1` |
| `LOGIN_GATEWAY_DATABASE_URL` | **Secret** | Supavisor transaction pooler (6543), gebruiker `login_gateway.<project-ref>`, gepercent-encodeerd wachtwoord; geen `sslmode`-parameters (de adapter strip ze) |
| `LOGIN_GATEWAY_CA_CERT_BASE64` | **Secret** | actuele Supabase-CA (Database Settings → SSL configuration), volledige PEM base64 |

Niet zetten: `LOGIN_GATEWAY_DB_SSL` (alleen lokaal), niets in Production of de generieke Preview-omgeving. Na elke variabelewijziging een nieuwe `preview-stable`-deployment (bestaande deployments nemen wijzigingen niet over). Controle vóór §5: de loginpagina op de PGB-host toont **nog geen** Microsoft-knop (flag uit), `/auth/microsoft-login/start` geeft 404 neutraal; de runtime-log toont geen `config_ontbreekt`.

---

## 5. Activering van uitsluitend PGB

Preflight (lees de rij, controleer `slug` en `id`):

```sql
select f.id, f.slug, c.actief, c.entra_tenant_id, c.pilotstatus, c.bijgewerkt
from public.fondsen f
left join public.fonds_microsoft_login c on c.fonds_id = f.id
where f.slug = 'pgb';
```

Verwacht: één rij, `actief = false` (of nog geen configrij als de T1-trigger alleen bij nieuwe fondsen vult; dan eerst een id-gebonden `insert` met `actief=false`). Activeer id-gebonden, nooit op slug:

```sql
update public.fonds_microsoft_login
set actief = true,
    entra_tenant_id = '<tenant-id>',
    pilotstatus = 'pilot',
    bijgewerkt = now()
where fonds_id = '37fdca3b-e92b-4671-b6b7-ac2bb83e3b89'
  and actief = false
returning fonds_id, actief, pilotstatus;
```

(Zelfde statement als `MICROSOFT-365-F1B-RUNBOOK.md` §4 stap 6; `entra_tenant_id` niet in de `returning`, zodat het changebewijs de tenant-id niet draagt.) Verwacht: **exact één rij**; nul rijen ⇒ opnieuw controleren, geen bredere update. De configtrigger schrijft `config.gewijzigd` in `login_private.audit_log` (zonder tenant-id); controleer die regel. Alle andere fondsen blijven `actief=false` (query: `select count(*) from public.fonds_microsoft_login where actief` → `1`).

---

## 6. Positieve smoke (PGB-host, één lid-testaccount met bestaand wachtwoordaccount en profiel)

Leg per stap alleen vast: tijdstip, stapnummer, uitkomst (groen/rood), supportcode (correlatie-id) waar getoond. Geen URL's met `state`/`code`.

| # | Stap | Verwacht |
|---|---|---|
| P1 | `GET /auth/v1/health` (Preview) | `version` ≥ 2.185.0 |
| P2 | Loginpagina PGB-host, uitgelogd | wachtwoordformulier **én** knop *Inloggen met Microsoft*; op een tweede fondshost zonder flag: geen knop |
| P3 | Wachtwoordlogin met het testaccount | dashboard; `amr` zonder `oauth` |
| P4 | Wacht > 600 s of forceer een refresh; navigeer | sessie blijft; geen 403 in de browserconsole/netwerk (hook raakt wachtwoord niet, R-40) |
| P5 | Profiel → kaart *Microsoft-login* → **Koppel Microsoft-account** → Entra-login met het lid-testaccount → persoonlijke consent | terug op `/profiel?microsoft_login=gekoppeld`; kaart toont `active` + tijdstip; DB: precies één `azure`-identiteit voor de user, één `active`-binding, `auth.users` ongewijzigd (zelfde `id`, zelfde e-mail); audit `koppelen.gereserveerd` → `koppelen.geactiveerd` met dezelfde correlatie |
| P6 | Uitloggen; *Inloggen met Microsoft* | dashboard zonder consentprompt; **zelfde** `user.id`; `amr ∋ oauth`; audit `inloggen.geslaagd`; `laatst_gebruikt_op` gezet |
| P7 | In de `oauth`-sessie: navigeer, wacht > 600 s, navigeer opnieuw | refresh slaagt (hook: `active`); sessie blijft |
| P8 | Uitloggen; wachtwoordlogin (fallback) | werkt; geen gateway-aanroep in de runtime-log voor deze request; hook onaangeroerd |
| P9 | Profiel → **Ontkoppelen** (in een wachtwoordsessie) | kaart `geen`; DB: binding `revoked`, `azure`-identiteit weg; audit `ontkoppelen.gestart` → `ontkoppelen.voltooid` |
| P10 | Opnieuw koppelen (P5) en opnieuw Microsoft-login (P6) | groen — bewijs van herbruikbaarheid na intrekking |

---

## 7. Negatieve smoke

| # | Stap | Verwacht |
|---|---|---|
| N1 | Niet-gekoppeld lid van de tenant (tweede account, wél in Entra, geen binding) → *Inloggen met Microsoft* | `/login?fout=…` met de neutrale melding; **geen** rij in `auth.users`/`auth.identities`; audit `inloggen.geweigerd` met categorie `binding_ontbreekt`, `identiteit_hash` gevuld, geen e-mail |
| N2 | Callback-replay: herhaal de laatste callback-URL uit de browserhistorie | neutrale melding; geen tweede sessie; audit `transactie_ongeldig` |
| N3 | Start de flow, wacht > 10 min, rond af | neutrale melding (`state_verlopen`) |
| N4 | Gekoppeld account, binding kunstmatig op `revoking` gezet (id-gebonden update door de eigenaar, daarna terugzetten) → refresh in de `oauth`-sessie | portaal beëindigt de sessie bij de eerste request (guard L3); refresh → 403 (hook); wachtwoordlogin blijft werken (S10c) |
| **N5 (E5, handmatig, browser)** | `https://<ref>.supabase.co/auth/v1/authorize?provider=azure&redirect_to=https://pgb.preview.bestuurdersportaal.com/auth/callback` | Entra-foutpagina **AADSTS50011** (redirect-URI niet geregistreerd); geen rij, geen sessie |
| **N6 (R-37, intrekkingsvenster)** | In een `oauth`-sessie het access-token uit de cookie bewaren; ontkoppelen; direct `GET /rest/v1/profielen?select=id` met dat token | 200 tot `exp` (vastleggen: ≤ 600 s), daarna 401; refresh met het bijbehorende refresh-token → 403 |
| N7 | Bewaard ID-token uit een eerdere flow opnieuw aanbieden via `POST /auth/v1/token?grant_type=id_token` (na ontkoppelen) | 422 `signup_disabled` (identiteit weg, signup uit) |
| N8 | Flag uit voor PGB (§9 stap 1) terwijl een binding `active` is | knop weg; `/auth/microsoft-login/start` 404; bestaande `oauth`-sessie blijft tot de guard/hook haar beëindigt? **Nee:** de guard toetst de flag niet, de binding wel — bestaande bindingen blijven geldig (bewuste keuze, ontwerp §8 stap 5). Vastleggen als waargenomen gedrag |
| N9 | Platformaccount (geen `profielen`-rij) probeert *Inloggen met Microsoft* op de PGB-host (als het ooit gekoppeld zou raken: reservering weigert al met `fonds_mismatch`) | neutrale melding; geen binding; platformhost toont nooit een Microsoft-knop |
| N10 | Fondshost B met een PGB-gekoppeld account (`tid+oid` van PGB) | `/login?fout=…` (binding.fondsId ≠ host-fonds); geen sessie |
| N11 | Log-/auditcontrole over §6–§7 | geen `access_token`, `id_token`, `refresh_token`, `code=`, `state=`, `nonce=`, e-mailadres of claim in Vercel-runtime-log, `login_private.audit_log`, `handelingen_log`, `app_errors` |

---

## 8. Meetblad (in het changebewijs, niet in de repo)

Per stap P1–P10 en N1–N11: datum/tijd, uitvoerder, uitkomst, supportcode, afwijking. Plus: gemeten Auth-versie, gemeten `jwt_exp`, S9-allowlist-uitvoer (geen ruwe respons), N6-venster in seconden, providerlijst (`["azure"]`).

---

## 9. Rollback (in deze volgorde; stop zodra het incident is weggenomen)

1. **Fondsflag uit** (id-gebonden `update … set actief = false … returning`; exact één rij). Effect: geen nieuwe Microsoft-logins of koppelingen; bestaande bindingen blijven bestaan maar de knop en de startroutes zijn dicht.
2. **Bindingen intrekken** voor de pilotaccounts via de portaalkaart (**Ontkoppelen**) of, bij een onbruikbare app, via de gatewayfuncties als eigenaar (`start_intrekking` + `unlinkIdentity`/`voltooi_intrekking`); daarna refresh → 403 door de hook.
3. **Hook uitschakelen** in het dashboard (P7 terug) ⇒ élke Microsoft-login is dicht; wachtwoordlogin blijft. Alleen bij een hookincident dat wachtwoordlogin raakt (mag niet kunnen, R-40; dan is dit stap 1).
4. **Azure-provider uit** (P1 terug) en/of clientsecret roteren/intrekken in Entra.
5. **Deployment terugzetten** naar de vorige `preview-stable`-build (T2-code weg); de migratie blijft additief staan.
6. **Migratie terugdraaien** alleen met `supabase/rollbacks/2026_09_06_microsoft_login_fase1b_ROLLBACK.sql` na expliciet besluit (verwijdert `login_private` en de configtabel; audit gaat verloren — eerst exporteren).
7. `jwt_exp` terug naar 3600 als de pilot definitief stopt (anders blijft 600 s tijdens de pilot staan).

Elke rollbackstap wordt met tijdstip en uitvoerder in het changebewijs vastgelegd; de S9-controle (§3) wordt na een rollback herhaald.

---

## 10. Periodieke hercontrole (driftbewaking, na de smoke)

Maandelijks en na elke Entra-/Supabase-platformwijziging: manifest-export App L vergelijken met §2 (E1–E7), S9-script draaien tegen §3 (P1–P5, P7–P9), `2026_09_06_microsoft_login_fase1b.sql` DEEL 1 tegen Preview, en `select count(*) from public.fonds_microsoft_login where actief` = aantal bewust geactiveerde fondsen. Drift = incident volgens §9.
