# Microsoft-login fase 1B — runbook (#335, besluit 0211)

Dit runbook hoort bij migratie `supabase/migrations/2026_09_06_microsoft_login_fase1b.sql`
(T1/PR-A) en beschrijft het provisionen van de databaserollen, de omgevingsvariabelen en de
Supabase-/Entra-configuratie die **later** (T3) nodig is. In T1 wordt niets extern
ingeschakeld: geen Azure-provider, geen Custom Access Token Hook, geen `jwt_expiry`-wijziging,
geen fondsactivering.

## Harde voorwaarden (blokkerend; zie besluit 0211 en ontwerp §3.3)

| # | Voorwaarde | Status |
|---|---|---|
| S7 | Negatieve e-mailkoppelingstest met een niet-gekoppelde Microsoft-identiteit en een lokaal wachtwoordaccount met exact hetzelfde e-mailadres (drie runs, `SPIKE-335-T0.5.md`) | **groen op 7 september 2026** — automatische koppeling uitsluitend met `email` en zonder linking domain; beide beschermde varianten geven `signup_disabled` |
| S9 | Preview-authconfiguratie gemeten (read-only, allowlist) | rood als nulmeting (verwacht vóór T3); geen implementatiefout |
| P5 | Supabase Auth ≥ 2.185.0 (`GET /auth/v1/health`) | te meten vóór iedere activering |
| — | Besluit 0211 blijft *Voorgesteld* tot T1 is gemerged; de Preview-uitrolvoorwaarden worden in T3 afzonderlijk afgetekend | — |

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
`public.fonds_microsoft_login(fonds_id, actief, entra_tenant_id)`, elk met een eerlijke
`using (true)`-leespolicy, en `USAGE` (geen `CREATE`) op `public` en `login_private`. Die
policies zijn bewust niet tenantgebonden: de helper moet voor élke gebruiker kunnen vaststellen
of het profiel nog in het fonds van de binding zit en of dat fonds Microsoft-login aan heeft. De
beveiliging rust op het rolcontract — NOLOGIN, geen BYPASSRLS, geen leden, geen SET ROLE, geen
schrijfrecht, exact deze kolommen, geen andere functies — dat gates B/C (uitzondering) én de
F1B-suite afdwingen. Wijzig de rol nooit met de hand: elke afwijking maakt de gates rood.

Verwacht: `login_gateway` met `rolcanlogin=true`, alle andere bevoegdheidsvelden `false`,
`rolinherit=false`, connection limit ≤ 5; `login_hook_owner` met `rolcanlogin=false` en alle
bevoegdheidsvelden `false`. De migratie faalt gesloten als een van beide ontbreekt.

Opmerking: omdat `postgres` de rollen aanmaakt (CREATEROLE, geen superuser), krijgt hij een
permanent, impliciet ADMIN-lidmaatschap zonder INHERIT/SET. Dat is onschadelijk en wordt door
de check-suite onderscheiden van het tijdelijke migratielidmaatschap, dat wél weg moet zijn.

## 2. Migratie en bewijs

1. Pas `2026_09_06_microsoft_login_fase1b.sql` toe (één transactie) en daarna
   `2026_09_07_microsoft_login_startlimiet.sql` (T2/V9: tabel `start_pogingen` +
   veertiende gatewayfunctie `tel_startpoging`; eigen rollback). Beide zijn
   idempotent; herhaald draaien is veilig.
2. Draai als database-eigenaar, in deze volgorde:
   - `supabase/checks/2026_09_06_microsoft_login_fase1b.sql` (DEEL 2 rolt volledig terug; telt 14 executes);
   - `supabase/checks/2026_09_07_microsoft_login_startlimiet.sql` (startlimiet, rolt terug);
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

   **Sinds #344 (fase 1C) is `pilotstatus` vervallen en is `modus` de bron.** Zet de tenant
   id-gebonden en laat de modus door de gatewayfunctie zetten — een directe `update` op de
   configuratietabel slaat de activeringspreflight over en is daarom fout:

   ```sql
   -- 1. tenant vastleggen (id-gebonden, nooit op slug)
   update public.fonds_microsoft_login
      set entra_tenant_id = '<tid>', bijgewerkt = now()
    where fonds_id = '<fonds-id>'
   returning fonds_id, entra_tenant_id is not null as tenant_gezet;

   -- 2. modus zetten via het beleidspad (null = gelukt; anders de reden)
   grant login_gateway to postgres;
   begin;
     set local role login_gateway;
     select login_private.zet_modus('<fonds-id>', 'optioneel', '<actor-user-id>', 'runbook-<datum>');
   commit;
   revoke login_gateway from postgres;
   ```

   Verwacht exact één rij bij stap 1 en `null` bij stap 2; de wijziging staat daarna in
   `login_private.audit_log` (`config.gewijzigd` én `beleid.gewijzigd`, zonder tenant-id).

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
  `herstel_koppeling` (T2-route). Een nieuwe geldige koppelcallback herkent daarnaast dezelfde
  Azure-identiteit op het account, maakt een verse pending en herstelt die zonder opnieuw te
  linken; een afwijkende of extra OAuth-identiteit wordt geweigerd. `pending` zonder identiteit verloopt na 10 minuten naar
  `failed` (`pending_verlopen`) en houdt het slot niet bezet.

## 7. Wat er nooit in logs of audit staat

Tokens, authorization codes, `state`/`nonce`, claims, e-mailadressen. De audit bewaart alleen
fonds, actor, `sha256(tid:oid)`, foutcategorie en correlatie-id; de hook logt niets.

## 8. Applicatielaag (T2 — routes, guard, UI)

Bron: `MICROSOFT-365-LOGIN-F1B-T2-ONTWERP.md`. De code leest uitsluitend de variabelen uit §3;
ontbreekt er één, dan is de knop verborgen en antwoorden de routes neutraal (404/503).

| Onderdeel | Pad | Gedrag |
|---|---|---|
| Start inloggen | `GET /auth/microsoft-login/start[?next=]` | **canonieke fondshost** (`canoniekeFondsHost`: strikt, productie zonder poort; ongeldig → 404) → host→fonds, config, fondsflag, **atomische tempolimiet** `microsoft_login_start` (20 per 10 min per HMAC-SHA256(ip\|host) onder de loginsleutel; `login_private.tel_startpoging`, migratie `2026_09_07_microsoft_login_startlimiet.sql`; telling mislukt = weigeren), bestaande sessie → `/`, veilig vervolgpad, versleutelde eenmalige transactie, 302 naar Entra met exact `openid profile` + PKCE |
| Callback | `GET /auth/microsoft-login/callback` | canonieke fondshost (ongeldig/onbekend → neutrale 404, nooit een redirect uit `req.url`) → consumeer transactie (replay dood) → tokenwissel → RS256 → exacte claims → inloggen (`zoek_identiteit` active vóór `signInWithIdToken`, kruiscontrole, profiel in host-fonds, `markeer_gebruikt`) of koppelen (bestaande OAuth-identiteit controleren → reserveer → link of idempotent herstel → actuele GoTrue-gebruiker lezen → verifieer → activeer). Elke fout: één neutrale redirect met supportcode |
| Koppelen starten | `GET /api/microsoft-login/koppelen/start` | `withFondsRoute`, `profile.manage.own`, hostGuard afdwingen, DB-limiet `microsoft_login_start` per gebruiker; 409 bij bestaande levende binding |
| Status / ontkoppelen / herstel | `GET/DELETE/POST /api/microsoft-login/koppeling` | status zonder tid/oid/sub/e-mail, mét `sessieViaMicrosoft`; ontkoppelen = `start_intrekking` → `unlinkIdentity` → `voltooi_intrekking`, daarna **deterministisch**: was de sessie via Microsoft, dan wordt zij server-side beëindigd (`uitgelogd: true`, kaart → `/login`), anders blijft de wachtwoordsessie (`uitgelogd: false`); mislukt unlink: blijft `revoking`, kaart biedt "Opnieuw proberen"; herstel idempotent (`herstel_koppeling`) |
| Guard L3 | `withFondsRoute` (dep `beoordeelPortaalSessie`), `haalFondsSessie`, tenant-layout, login-layout, platform-layout | **fase 1C (#344):** élke sessie wordt tegen `login_private.sessiebeleid` gehouden (ongecachet). Oauth zonder `active` binding → sessie beëindigd (`/login?fout=microsoft`, wrapper: exact de bestaande 401; platform: `?fout=geen_toegang`, R-34). Gatewayfout = fail-closed |
| L4 | `/auth/callback` | `azure`-identiteit zonder actieve binding → `unlinkIdentity` + signOut + `/login?error=auth_callback` |
| UI | `/login` (server-pagina + `LoginForm`), `/profiel` (`MicrosoftLoginKaart`) | knop alleen als host-fonds de flag aan heeft én de config compleet is; één neutrale melding voor `?fout=microsoft` en `?error=auth_callback` met supportcode; kaart per toestand één handeling |

**Supportcode → categorie:** de supportcode is de eerste acht tekens van de correlatie-id. Zoek in
de Vercel-runtime-log op `[MICROSOFT-LOGIN]` met die code voor de interne categorie
(`claim_*`, `binding_ontbreekt`, `hook_geweigerd`, `transactie_ongeldig`, …) en in
`login_private.audit_log` op `correlatie_id like '<code-in-kleine-letters>%'`. Geen van beide
bevat tokens, codes, `state`/`nonce`, claims of e-mailadressen.

**Microsoft response-scopes:** de start- en tokenrequest vragen exact `openid profile` en een
`refresh_token` wordt altijd geweigerd. Het responseveld `scope` beschrijft echter het tegelijk
uitgegeven access-token en kan volgens [Microsofts OIDC-documentatie](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc#successful-token-response)
ook eerder verleende Graph-scopes bevatten.
Die extra scopes zijn daarom geen callbackfout: het access-token wordt direct verworpen en nooit
opgeslagen, gelogd of gebruikt. Controleer tijdens onboarding afzonderlijk dat App L zelf alleen
de twee bedoelde OIDC-permissies heeft.

**Lokaal/E2E:** `tests/e2e/fixtures/oidc-stub.mjs` speelt Entra na (dubbel gegrendeld via
`MICROSOFT_LOGIN_E2E_OIDC=local` + `SEED_DOELOMGEVING=local` + lokale Supabase-URL). De positieve
sign-in/link tegen GoTrue vereist de echte Microsoft-JWKS en is alleen met spike T0.5 en de
Preview-smoke te bewijzen.

---

# Fase 1C — organisatiebreed loginbeleid (#344, besluit 0212)

Bron: `MICROSOFT-365-LOGIN-F1C-ONTWERP.md`. Alles hieronder komt bovenop fase 1B; de
provisioning uit §2–§4 blijft ongewijzigd (dezelfde rollen, dezelfde variabelen, dezelfde hook).

## 1C.0 Rol provisionen (vóór de migratie)

Naast `login_gateway` en `login_hook_owner` kent fase 1C één extra rol: **`portaal_beperkt`**. De
Auth-hook schaalt een break-glass- of koppel-/herstelsessie daarheen af; PostgREST doet `set role`
op die claim, dus de rol moet bestaan én lid zijn van `authenticator` — anders weigert PostgREST het
token. De migratie controleert beide en stopt met een duidelijke melding als er iets ontbreekt.

```sql
create role portaal_beperkt nologin noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls;
grant portaal_beperkt to authenticator;
```

De rol krijgt haar rechten uit de migratie: `USAGE` op `public` en uitsluitend kolom-`SELECT` op
`public.profielen(id, fonds_id, rol, naam)` met een policy die haar tot de eigen rij beperkt. Geef
haar nooit iets anders — dat is precies de begrenzing waarop het beleid rust.

## 1C.1 Volgorde (blokkerend)

1. `supabase/migrations/2026_09_07_microsoft_login_beleidsmodus.sql` toepassen. Deterministisch:
   een actief fonds (de PGB-pilot) wordt `optioneel` — gedragsneutraal — en alle overige fondsen
   `uit`. De migratie zet **geen enkel** fonds op `verplicht`.
2. Beide suites draaien tegen de doeldatabase:
   `supabase/checks/2026_09_06_microsoft_login_fase1b.sql` en
   `supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql`, plus
   `supabase/checks/2026_07_31_r1_structurele_gates.sql` (de uitzondering voor
   `login_hook_owner` is verbreed met de kolom `modus` en de tweede helper).
3. Pas dán de code van PR-A deployen. Andersom crasht de guard op de ontbrekende
   `login_private.sessiebeleid` — fail-closed, maar het legt het portaal plat.
4. Moduswijzigingen lopen ná PR-B uitsluitend via het beheerpad (capability
   `login.beleid.manage`, alleen de rol `beheerder`). Tot die tijd via
   `login_private.zet_modus` als `login_gateway`; **nooit** met een directe `update` op
   `public.fonds_microsoft_login` — dan slaat de preflight over.

## 1C.2 Break-glass inrichten (vóór `verplicht`)

- Kies een account dat **niet** de beheerder is die de uitzondering verleent; de database
  weigert zelf toekennen (`zelf_toekennen`).
- Dat account moet een **geverifieerde** MFA-factor hebben (`auth.mfa_factors.status =
  'verified'`). Zonder die factor telt de aanwijzing niet mee en blijft de preflight rood
  met `breakglass_ontbreekt`.
- **De aanwijzing is duurzaam**: zij geldt tot intrekking. `herzien_over_dagen` (1–365) zet alleen
  de herzieningsdatum; die blokkeert niets maar verschijnt als
  `breakglass_herziening_verlopen` in de preflight en in `breakglass_overzicht`. Neem het herzien op
  in de reguliere beheercyclus. Reden is een vaste categorie: `entra_storing`, `beheerherstel` of
  `migratie`.
- **Zo werkt het gebruik.** Aanmelden met wachtwoord geeft eerst een AFGESCHAALDE sessie
  (`role = portaal_beperkt`): die kan niets behalve de eigen profielrij lezen en de MFA-stap doen op
  `/beperkte-toegang`. Ook ná de verificatie blijft de sessie beperkt totdat het
  activeringsvenster is geopend — dat doet de pagina met één aanroep van
  `POST /api/microsoft-login/verhoging`, wat precies één `breakglass.gebruikt` in
  `login_private.audit_log` oplevert. Daarna vernieuwt de client zijn token en volgt de normale rol.
  Loopt het venster (een uur) af, dan zakt de sessie terug en zijn een nieuwe MFA-verificatie én een
  nieuwe verhoging nodig: elke verhoging hangt aan één verificatie, die vers moet zijn (< 5 minuten)
  en maar één keer bruikbaar is. Dezelfde AAL2-sessie kan het venster dus niet heropenen zonder
  nieuwe code. Intrekken van de aanwijzing beëindigt lopende verhogingen onmiddellijk.
- **Monitoring:** meer dan een handvol `breakglass.gebruikt`-regels per maand, of een aanwijzing
  waarvan `herzien_voor` is verstreken, hoort een gesprek te zijn — niet een gewoonte.
- Controleer vooraf `login_private.activering_preflight(<fonds>)`: `gereed = true` en
  `breakglass_accounts >= 1`. Krijg je `breakglass_onverifieerbaar`, dan kan de
  functie-eigenaar `auth.mfa_factors` niet lezen — herstel dat recht, ga niet door op een
  aanname.

## 1C.3 Herkoppelen (beperkte koppel-/herstelsessie)

1. Beheer geeft een uitnodiging uit voor exact één account; de app stuurt uitsluitend
   `sha256(token)` naar de database. Het token zelf komt nergens in database, log of audit —
   dus **bewaar het niet**: is het kwijt, geef dan een nieuwe uit (de vorige vervalt).
2. De gebruiker opent de link, activeert daarmee het venster (eenmalig, standaard 15 min) en
   logt in **met zijn bestaande wachtwoord**. Het token authenticeert niet.
3. Binnen het venster maakt de gebruiker de oude identiteit los en koppelt hij de nieuwe.
   Zodra `tid + oid` actief is, sluit het venster onmiddellijk en logt hij voortaan met
   Microsoft in.
4. Heeft de gebruiker zijn wachtwoord ook niet meer, dan is aanvullende identiteitscontrole
   nodig. De uitnodigingslink mag nooit het enige authenticatiemiddel zijn.

**Laatste redmiddel (alleen als beide paden falen):** zet het fonds tijdelijk terug op
`optioneel`, laat de gebruiker koppelen, en zet het daarna weer op `verplicht` — de
activeringspreflight draait dan opnieuw. Dit verlaagt het beleid voor het hele fonds; leg
het vast in de audit en houd het venster kort.

## 1C.4 Smoke bij `verplicht` (Preview, PGB)

| # | Scenario | Verwacht |
|---|---|---|
| 1 | Microsoft-login met een gekoppeld account | sessie, `amr ∋ oauth` |
| 2 | Wachtwoordlogin met correcte credentials, gewone gebruiker | 403 van de hook; loginscherm toont "Voor deze omgeving logt u in met Microsoft" |
| 3 | Wachtwoordlogin met een fout wachtwoord | onveranderd de generieke melding (geen orakel) |
| 4 | Sessievernieuwing na `jwt_exp` | oauth-sessie leeft door; een wachtwoordsessie is uiterlijk na `jwt_exp` weg en al eerder door de guard beëindigd — **meet dit en leg de tijd vast** |
| 5 | `DELETE /api/microsoft-login/koppeling` via de profielpagina | de knop is er niet (de kaart toont "Uw organisatie beheert deze koppeling"); forceer je het verzoek toch, dan 403 met diezelfde tekst én `ontkoppelen.geweigerd` in `login_private.audit_log` |
| 5b | Hetzelfde verzoek rechtstreeks, buiten de browsersessie om | **Let op:** op Preview staat Vercel-SSO vóór het portaal, dus een kale `curl` strandt op het SSO-scherm en meet niets over het portaal. Gebruik de devtools-console van een ingelogde sessie (`fetch('/api/microsoft-login/koppeling', { method: 'DELETE' })`) of geef het bypasstoken mee (`x-vercel-protection-bypass`); zie §1C.7 |
| 6 | Beheerintrekking, daarna login | 403; binding `revoking` |
| 7 | Koppel-/herstelsessie: uitnodiging → venster → wachtwoordlogin → herkoppelen | sessie alleen binnen het venster, en dan uitsluitend met `role = portaal_beperkt` (portaal blijft dicht); venster gesloten (`voltooid_op`) na activering |
| 8a | Break-glassaccount, alleen wachtwoord | login lukt, maar het token draagt `role = portaal_beperkt`; een rechtstreekse `GET /rest/v1/documenten` met dat token geeft 403 en het portaal stuurt naar `/beperkte-toegang` |
| 8b | Break-glassaccount, ná MFA-verificatie én verhoging | normale rol; portaal bereikbaar; precies één `breakglass.gebruikt` in de audit |
| 8b' | Break-glassaccount, ná MFA maar **zonder** verhoging (bijv. rechtstreeks refreshen) | blijft `portaal_beperkt`; geen auditregel — dit is de regressie uit reviewbevinding P1 |
| 8c | Break-glassaccount ná afloop van het uur | sessie zakt terug naar de beperkte rol; een verhoging met dezelfde (oude) MFA-verificatie wordt geweigerd; pas een nieuwe verificatie opent een nieuw venster (nieuwe auditregel) |
| 9 | Break-glass ingetrokken of MFA-factor onverified | 403 |
| 10 | Platformbeheerder en een gebruiker van een ander fonds | ongewijzigd (modus is strikt per fonds) |

## 1C.5 Storingsscenario's

- **Entra/Microsoft plat, fonds op `verplicht`.** Gebruik het break-glassaccount. Is dat er
  niet, zet het fonds op `optioneel` (gateway of beheerpad) — dat werkt zonder Microsoft.
- **`login_private` onbereikbaar.** De hook weigert dan élke uitgifte (fail-closed) en de
  guard beëindigt bestaande sessies. Laatste redmiddel op platformniveau: schakel de Custom
  Access Token Hook uit in het Supabase-dashboard (§4); daarmee vervalt óók de afdwinging van
  fase 1B, dus alleen bewust, kort en met vastlegging.
- **Ontbrekende `LOGIN_GATEWAY_*`-configuratie.** Dan bestaat Microsoft-login in die omgeving
  niet en blijft het wachtwoordpad open zoals het altijd was (besluit 0212 D5); de knop is
  verborgen en de routes antwoorden neutraal.

## 1C.6 Terugdraaien

`supabase/rollbacks/2026_09_07_microsoft_login_beleidsmodus_ROLLBACK.sql` zet de F1B-vorm
terug (binaire `actief` + `pilotstatus`, hook laat niet-oauth onvoorwaardelijk door). **Rol
eerst de PR-A-code terug of zet elk fonds op `optioneel`/`uit`** — draai je de rollback
terwijl een fonds nog `verplicht` is, dan valt de afdwinging weg en kunnen die gebruikers
weer met wachtwoord inloggen. `login_private.audit_log` blijft ongemoeid (append-only).

## 1C.7 Rechtstreekse routeaanroepen meten op Preview

De smoke wil bewijzen dat een weigering óók geldt als de UI wordt omzeild. Op Preview zit Vercel-SSO
vóór de applicatie: een kale `curl` krijgt het SSO-scherm en raakt het portaal niet, dus zo'n test
meet niets — hij lijkt alleen te slagen. Twee bruikbare wegen:

1. **Devtools-console van een ingelogde sessie** (eenvoudigst, geen extra geheimen):
   ```js
   await fetch("/api/microsoft-login/koppeling", { method: "DELETE" }).then((r) => r.status);
   ```
   Verwacht `403`; controleer daarna `login_private.audit_log` op `ontkoppelen.geweigerd`.
2. **Protection Bypass for Automation**: zet in het Vercel-project een bypasstoken en stuur dat mee
   als header `x-vercel-protection-bypass`. Daarmee kan een script het portaal bereiken zonder SSO.
   Het token hoort in de omgeving van het testharnas, nooit in de repo — de secretscan slaat er
   terecht op aan.

Beide wegen laten de portaalpoorten volledig intact: SSO staat vóór de app, de wrapper en de
Auth-hook staan erachter. Wat je met bypass meet, is dus nog steeds het echte gedrag van de route.
