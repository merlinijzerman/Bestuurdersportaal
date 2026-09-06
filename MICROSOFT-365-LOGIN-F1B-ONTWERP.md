# Microsoft 365 — fase 1B: Inloggen met Microsoft voor bestaande portaalaccounts

- **Ticket:** [#335](https://github.com/merlinijzerman/Bestuurdersportaal/issues/335)
- **Besluit:** `decisions/0211-microsoft-login-expliciete-koppeling-tid-oid.md` (voorgesteld, tweede herziening)
- **Status van dit document:** ontwerp ter akkoord; nog géén productiecode; eerst spike T0.5
- **Branch/worktree:** `feat/335-microsoft-login` vanaf `origin/preview` `259ba44` (merge #324)
- **Datum:** 2026-09-05 (tweemaal herzien dezelfde dag na review van de opdrachtgever)

Dit document legt vast (1) wat Supabase Auth werkelijk doet met een Azure-identiteit,
(2) welke dreigingen daaruit volgen, (3) de gekozen route en invarianten, (4) het
implementatieplan in tranches, inclusief de spike T0.5. §1–§3 zijn de "eerst te nemen
ontwerpbeslissing" uit het ticket; §4–§9 zijn het plan dat pas na akkoord en een groene spike
wordt uitgevoerd. De stand van de keuzes staat in §10.

---

## 1. Uitgangspunten (uit het ticket, hier niet ter discussie)

- Supabase Auth blijft eigenaar van de portaalsessie; `profielen.id`, fonds en rol wijzigen niet.
- Microsoft-login en Microsoft Graph zijn gescheiden vertrouwensdomeinen: login vraagt alleen
  authenticatiescopes; login-tokens verlaten de server niet en worden niet voor Graph gebruikt.
- Geen JIT-provisioning: een Microsoft-identiteit maakt nooit een gebruiker, profiel, fonds of rol.
- Autorisatie op de server-side fonds-/profielrelatie plus een duurzame binding `tid + oid`;
  e-mail en `preferred_username` zijn geen autorisatiesleutel.
- Fondsgebonden, standaard uit; pilot op onze eigen single-tenant Entra-omgeving; PGB in Preview.

---

## 2. Karakterisering van Supabase Azure-OAuth (bron: GoTrue `master`, 2026-09-05)

### 2.1 Bestaand wachtwoordaccount + nieuwe Azure-identiteit

`models.DetermineAccountLinking` (`internal/models/linking.go`) beslist per binnenkomende
identiteit:

| Situatie | Beslissing | Effect |
|---|---|---|
| Identiteit (`provider` + `sub`) bestaat al | `AccountExists` | inloggen als die gebruiker |
| Geen identiteit, **geverifieerd** e-mailadres matcht één gebruiker in hetzelfde "linking domain" | `LinkAccount` | identiteit wordt **automatisch** aan die gebruiker gehangen; dezelfde user-UUID |
| Geen identiteit, geen geverifieerd e-mailadres of geen match | `CreateAccount` | nieuwe gebruiker |
| Match op meerdere gebruikers | `MultipleAccounts` | fout |

Deze beslissing zit in `createAccountFromExternalIdentity` en wordt door **beide** ingangen
gebruikt: de hosted redirectflow én de directe id-token-grant (`token_oidc.go`, wanneer
`link_identity` niet is gezet). Automatische koppeling is dus geen eigenschap van de hosted flow
alleen. Alle OAuth-providers zitten standaard in het linking domain `default`, samen met
e-mail/wachtwoord.

**Geïsoleerd linking domain.** `GetAccountLinkingDomain` leest
`config.Experimental.ProviderLinkingDomains` (env `GOTRUE_EXPERIMENTAL_PROVIDER_LINKING_DOMAINS`,
formaat `azure=microsoft_login`). Voor een provider in een eigen domein slaat de code de
zoektocht naar `similarUsers` in de default pool over
(`if candidateLinkingDomain == "default" { … }`); automatische koppeling aan een
wachtwoordaccount is dan **per constructie** onmogelijk. Experimenteel en env-gebonden;
beschikbaarheid op het hosted platform is te bevestigen (S9).

### 2.2 Wat "geverifieerd" betekent voor Azure

`internal/api/provider/oidc.go`:

```go
func (c *AzureIDTokenClaims) IsEmailVerified() bool {
	emailVerified := false
	edov := c.XMicrosoftEmailDomainOwnerVerified   // claim "xms_edov"
	if edov == nil {
		emailVerified = c.Email != ""               // ← ontbreekt xms_edov: e-mail geldt als geverifieerd
	} else {
		... emailVerified = c.Email != "" && edovBool
	}
	return emailVerified
}
```

- Zonder `xms_edov` geldt elke `email`-claim als geverifieerd. Zonder `email`-claim is er niets
  te verifiëren en valt de beslissing op `CreateAccount` (→ `signup_disabled`).
- Microsoft: `xms_edov` wordt **alleen** uitgegeven als de `email`-claim aanwezig is; gasten
  dragen `email` standaard, leden alleen via scope of optionele claim. In onze flow zonder
  `email`-scope is `xms_edov` dus geen bruikbare eis; wij autoriseren op `tid + oid` met
  `acct = 0`.
- `parseAzureIDToken` bewaart `iss`, `sub` (= `provider_id`), `preferred_username`, `name` en
  overige claims in `custom_claims` (ongedocumenteerd). Wij lezen `oid`/`tid` uit het door ons
  geverifieerde ID-token.

### 2.3 Uitgeschakelde nieuwe registraties

`DisableSignup` blokkeert **alleen** `CreateAccount` (`422 signup_disabled`); `LinkAccount` en
`AccountExists` lopen door. Nodig tegen JIT-gebruikers, geen bescherming tegen koppeling op
e-mail. `public.maak_profiel()` maakt bovendien alleen een profiel bij gezet
`raw_app_meta_data.fonds_id` (tweede vangnet).

### 2.4 Manual linking, id-token-grant en tokenuitgifte

- `linkIdentity()` met ID-token: `POST /token?grant_type=id_token` met `link_identity: true` en
  de sessie-JWT. GoTrue eist een geldige sessie (`requireAuthentication`), roept
  `linkIdentityToUser` aan (bestaande identiteit → `identity_already_exists`) en geeft **in
  dezelfde databasetransactie** een nieuwe sessie uit: `issueRefreshToken(..., models.OAuth)`.
  Een e-mail-eis geldt alleen als de doelgebruiker nog geen e-mailadres heeft.
- `signInWithIdToken()`: `aud` moet de geconfigureerde Azure-client-id zijn; issuer uit het token,
  alleen prefix-toets; `nonce`-parameter wordt als `sha256(nonce)` (hex) vergeleken; daarna
  `DetermineAccountLinking`; sessie met `amr`-methode `oauth`.
- `unlinkIdentity()` vereist ≥ 2 identiteiten.
- **Custom Access Token Hook** (Supabase docs; `v0hooks.CustomAccessTokenInput`): input
  `user_id`, `claims`, `authentication_method` (`oauth`, `password`, `token_refresh`, …); draait
  vóór elke tokenuitgifte inclusief refresh; kan weigeren met
  `{ "error": { "http_code": 403, "message": "…" } }`. Omdat `issueRefreshToken` binnen de
  transactie van `linkIdentityToUser` loopt, maakt een weigering van de hook ook de identiteit
  ongedaan. Bij `token_refresh` zegt `authentication_method` niets over de oorsprong, maar
  `claims.amr` bevat nog steeds `oauth`.
- **Advisory GHSA-v36f-qvww-8w8m** (2026-03-11, medium): gotrue `< 2.185.0` liet via de
  Azure/Apple id-token-grant sessies voor willekeurige gebruikers uitgeven (issuer-manipulatie).
  Gepatcht in **2.185.0**. Versie meetbaar via `GET /auth/v1/health`.

### 2.5 Supabase geeft sessies uit zonder onze bindingstabel; de datalaag vertrouwt `auth.uid()`

1. **Hosted redirectflow** `…/auth/v1/authorize?provider=azure`: GoTrue stuurt naar Entra met
   `redirect_uri = https://<project>.supabase.co/auth/v1/callback`. Staat die niet in App L, dan
   weigert Entra (AADSTS50011) vóór code, identiteit of sessie.
2. **Directe id-token-grant**: geeft op elk geldig App L-ID-token een sessie, met de gewone
   linkinglogica (§2.1). Alleen wie de code met het clientsecret kan inwisselen (E6/E7) krijgt
   zo'n token — dus alleen onze server. Toch moet de binding op tokenniveau worden afgedwongen:
   een ingetrokken binding, een achtergebleven identiteit of een hergebruikt ID-token mag geen
   bruikbaar token opleveren.
3. **Directe datalaagtoegang**: het portaal gebruikt een browserclient (`core/lib/supabase.ts`,
   bv. `useAssistent.ts`) en RLS werkt op `auth.uid()`. Een sessie die eenmaal bestaat, kan
   PostgREST, Storage en Realtime rechtstreeks benaderen. Een controle die alleen in de
   Next.js-app zit, is daarom te omzeilen — de afdwinging moet vóór tokenuitgifte liggen.

### 2.6 Microsoft-claims (claimreferenties, 2026-06/07)

| Claim | Gebruik |
|---|---|
| `oid` | onveranderlijke gebruikers-id binnen tenant; **bindingssleutel** |
| `tid` | tenant-id; `9188040d-6c67-4c5b-b112-36a304b66dad` = persoonlijk account; **bindingssleutel + allowlist** |
| `sub` | pairwise per app; Supabase `provider_id`; **kruiscontrole** |
| `iss` | exact `https://login.microsoftonline.com/{tid}/v2.0` |
| `aud`, `exp`, `ver`, `nonce` | exact toetsen (`ver` = `2.0`, `nonce` = sha256(N)) |
| `idp` | aanwezig en ≠ `iss` → weigeren (gast/federatie) |
| `acct` (optionele claim) | **verplicht aanwezig én `0`**; `1` = gast; ontbreken = weigeren |
| `xms_edov`, `email`, `preferred_username`, `name` | niet aangevraagd/niet geëist; niet loggen; alleen relevant als de hosted flow ooit wordt toegestaan |

---

## 3. Dreigingsafweging, route en invarianten

### 3.1 Route B (bevestigd)

Eigen directe OIDC-flow (PKCE, `state`, `nonce`, cryptografische handtekening- en exacte
claimvalidatie), daarna
`linkIdentity`/`signInWithIdToken` met het geverifieerde ID-token. Vergelijking met de hosted
redirectflow: zie vorige versie, ongewijzigd; doorslaggevend blijft dat onze code de identiteit
toetst vóór Supabase iets aanmaakt, en dat de Supabase-callback niet in Entra hoeft te staan.
De directe uitwisseling is ook nodig voor E2: MSAL-node 6.0 voegt in dit pad automatisch de
OIDC-defaultscope `offline_access` toe, ook als de aanroep alleen `openid profile` opgeeft.
Productiecode bouwt daarom zelf de authorize- en tokenrequest, gebruikt geen tokencache en
weigert een tokenresponse met een `refresh_token`. Discovery en JWKS worden uitsluitend via
`https://login.microsoftonline.com` geladen; alleen RS256 en exact één passende `kid` zijn
toegestaan.

**Consent-UX.** In de pilot gebruiken we persoonlijke consent; een beheerder laat daarbij
`Toestemming namens uw organisatie` uitgevinkt. Microsoft toont die keuze alleen aan voldoende
bevoegde beheerders en wij kunnen haar niet vanuit de applicatie verbergen. Na persoonlijke
consent verschijnt de prompt voor die gebruiker niet opnieuw zolang scopes en consent gelijk
blijven. Voor productie is de voorkeursroute een expliciete, geaudite klant-onboarding waarin
de klantbeheerder eenmalig tenantbrede consent geeft voor uitsluitend `openid profile`.
Eindgebruikers zien daarna geen consentprompt. De App L-registratie krijgt vóór productie ook
herkenbare branding, een geverifieerd domein en waar van toepassing publisher verification.

### 3.2 Gelaagde afdwinging

| Laag | Mechanisme | Dekt | Dekt niet |
|---|---|---|---|
| **L0 Entra** | E1–E7: single-tenant, alleen `openid profile`, geen Supabase-callback, geen public client/implicit/hybrid | wie überhaupt een App L-ID-token kan verkrijgen; hosted flow | een token dat onze server zelf heeft verkregen |
| **L1 Auth-hook (primair)** | `public.fn_access_token_hook`: `oauth`-uitgifte (incl. refresh via `amr`) → precies één OAuth-identiteit, provider `azure`, en `sub`/`tid`/`oid` van die identiteit exact gelijk aan de `active`/geldige `pending` binding; anders 403, geen token | elke sessie-uitgifte, elke ingang, elke identiteit (A ≠ B), andere OAuth-providers, directe PostgREST/Storage/Realtime/RPC (geen token = geen toegang) | al uitgegeven access-tokens tot `exp` (venster, P8) |
| **L2 Callback** | inlogpad toetst binding vóór `signInWithIdToken`; koppelpad reserveert vóór `linkIdentity` | onze eigen flows, neutrale meldingen, audit | — |
| **L3 Applicatieguard** | `amr ∋ oauth` ⇒ `actieve_binding` via gateway, **zonder cache**, in layout/`haalFondsSessie`/`withFondsRoute`/login-layout/platform-layout | directe portaalbeëindiging binnen het venster | directe datalaagtoegang buiten de app |
| **L4 `/auth/callback`** | `azure`-identiteit zonder binding → unlink + signOut | hosted-flow-restanten | — |

De hook is de primaire beveiliging omdat zij de enige laag is die geldt voor elke ingang en voor
directe toegang. Ontwerpregels voor de hook:

De hook toetst de **exacte identiteit**, niet alleen het account. `oauth` is in Supabase de
generieke methode voor élke social/OAuth-login en de hook krijgt niet mee welke identiteit is
gebruikt; zij leest daarom `auth.identities` van de gebruiker — binnen de GoTrue-transactie,
zodat een zojuist via `link_identity` aangemaakte identiteit zichtbaar is — en eist: precies één
OAuth-identiteit (alles behalve `email`/`phone`), provider `azure`, en `provider_id` (= `sub`)
plus `identity_data.custom_claims.tid`/`oid` exact gelijk aan de binding. Zo kan een `pending`
voor identiteit A geen identiteit B binden, staat een actieve binding voor A geen token voor B
toe, en wordt een andere OAuth-provider geweigerd.

Rechtenmodel conform het Supabase-advies (Auth-hooks niet als `SECURITY DEFINER` onder een breed
bevoegde eigenaar): de publieke hook is `SECURITY INVOKER` en draait als `supabase_auth_admin`,
die `auth.identities` sowieso mag lezen; alleen de kleine helper heeft verhoogde rechten.

```sql
-- Skelet (T1). Helper: SECURITY DEFINER, eigenaar = minimale NOLOGIN-rol login_hook_owner met
-- uitsluitend SELECT op login_private.microsoft_identiteiten; lege search_path; execute alleen supabase_auth_admin.
create function login_private.identiteit_toegestaan(p_user uuid, p_sub text, p_tid text, p_oid text)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from login_private.microsoft_identiteiten b
                  where b.user_id = p_user and b.sub = p_sub and b.tid = p_tid and b.oid = p_oid
                    and (b.status = 'active' or (b.status = 'pending' and b.pending_verloopt_op > pg_catalog.now())));
$$;
-- Supabase `postgres` heeft CREATEROLE maar is geen superuser; voor de eigendomsoverdracht
-- zijn tijdelijk SET ROLE-recht en CREATE op het doelschema nodig. Trek beide direct weer in.
grant create on schema login_private to login_hook_owner;
grant login_hook_owner to postgres;
alter function login_private.identiteit_toegestaan(uuid,text,text,text) owner to login_hook_owner;
revoke login_hook_owner from postgres;
revoke create on schema login_private from login_hook_owner;
-- RLS staat aan op de bindingstabel; login_hook_owner is geen eigenaar en heeft geen BYPASSRLS,
-- dus zonder policy ziet de helper nul rijen en wordt óók de juiste binding geweigerd.
create policy "hook owner leest bindingen" on login_private.microsoft_identiteiten
  for select to login_hook_owner using (true);
grant usage on schema public to supabase_auth_admin;   -- vereist voor een Postgres Auth-hook

-- Hook: SECURITY INVOKER (supabase_auth_admin); snel; fail-closed voor oauth; onaangeroerd voor de rest.
create function public.fn_access_token_hook(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_user uuid; v_oauth boolean; v_n int; v_provider text; v_sub text; v_tid text; v_oid text;
begin
  v_oauth := (event->>'authentication_method') = 'oauth'
          or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(event->'claims'->'amr','[]'::jsonb)) e
                     where coalesce(e->>'method', e #>> '{}') = 'oauth');
  if not v_oauth then return event; end if;           -- wachtwoord, magic link, herstel, totp
  v_user := (event->>'user_id')::uuid;
  select count(*), min(i.provider), min(i.provider_id),
         min(i.identity_data->'custom_claims'->>'tid'), min(i.identity_data->'custom_claims'->>'oid')
    into v_n, v_provider, v_sub, v_tid, v_oid
    from auth.identities i where i.user_id = v_user and i.provider not in ('email','phone');
  if v_n <> 1 or v_provider <> 'azure' or v_sub is null or v_tid is null or v_oid is null
     or not login_private.identiteit_toegestaan(v_user, v_sub, v_tid, v_oid) then
    return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object('http_code', 403,
      'message', 'Microsoft-login is niet gekoppeld aan dit account.'));
  end if;
  return event;
exception when others then
  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object('http_code', 403,
    'message', 'Microsoft-login kan nu niet worden gecontroleerd.'));
end $$;
revoke execute on function public.fn_access_token_hook(jsonb) from public, anon, authenticated;
grant  execute on function public.fn_access_token_hook(jsonb) to supabase_auth_admin;
```

De `pending`-toets is het koppelvenster (nodig omdat `link_identity` zelf een `oauth`-sessie
uitgeeft vóór wij kunnen activeren); de reservering bevat al `sub`/`tid`/`oid` uit het door ons
geverifieerde ID-token, dus alleen precies die identiteit kan tijdens het venster binden. De hook
leunt op `identity_data.custom_claims.tid/oid` (door GoTrue uit het geverifieerde ID-token
bewaard); spike S3c toetst dat hard — ontbreekt het, dan faalt de hook gesloten en moet het
ontwerp worden herzien vóór T1.

**Intrekkingsvenster (P8).** Al uitgegeven access-tokens blijven geldig tot `exp`. Voor de pilot
staat `jwt_expiry` op **600 s**; de hook weigert bij de eerstvolgende refresh. Expliciet
geaccepteerd: maximaal tien minuten directe datalaagtoegang na intrekking. De applicatieguard
beëindigt de portaalsessie eerder, maar dekt directe toegang niet.

### 3.3 Invarianten (Entra, Supabase, omgeving)

| # | Invariant | Waarom | Bewijs |
|---|---|---|---|
| E1 | App L: *Accounts in this organizational directory only* | andere tenants/persoonlijke accounts komen niet langs Entra | manifest `signInAudience`; smoke |
| E2 | App L: alleen delegated `openid`, `profile`; geen `email`, `offline_access`, Graph, application permissions | ticketeis; geen refreshtoken; geen e-mailclaim voor leden → geen e-mailkoppeling mogelijk | manifest; contracttest scopes |
| E3 | App L: optionele ID-token-claim `acct` | expliciete gastuitsluiting | manifest `optionalClaims`; S1 |
| E4 | App L: redirect-URI's exact `https://<fondshost>/auth/microsoft-login/callback` (spike: `http://localhost:3999/callback`) | geen open redirect | manifest |
| **E5** | **App L bevat nooit `https://<project>.supabase.co/auth/v1/callback`** | hosted flow strandt bij Entra vóór creatie | manifest; S6 (handmatig, browser) |
| **E6** | *Allow public client flows* = No | ID-tokens alleen met clientsecret | manifest `isFallbackPublicClient=false` |
| **E7** | implicit grant (access/ID) en hybrid flow uit | geen ID-token via de browser | manifest `implicitGrantSettings` |
| P1 | Supabase: Azure-provider aan met App L; tenant-URL `https://login.microsoftonline.com/<tid>` | `aud`-controle in GoTrue | smoke |
| P2 | *Allow new users to sign up* uit | geen `CreateAccount` | S2 |
| P3 | *Manual linking* aan | `unlinkIdentity` | S5 |
| P4 | redirect-allowlist minimaal | landingsdoel hosted flow | dashboard |
| **P5** | **Auth ≥ 2.185.0** | GHSA-v36f-qvww-8w8m | `/auth/v1/health` (S8); harde uitrolvoorwaarde |
| P6 | linking domain `azure=microsoft_login` indien beschikbaar | e-mailkoppeling per constructie uit | S9 |
| **P7** | **Custom Access Token Hook ingeschakeld op `public.fn_access_token_hook`** | primaire afdwinging | S10; smoke |
| **P8** | **`jwt_expiry` = 600 s** | intrekkingsvenster ≤ 10 min | S10b; dashboard |
| **P9** | **Azure is de enige ingeschakelde OAuth-provider**; een nieuwe provider vereist eerst een hookwijziging | `oauth` is generiek; de hook weigert elke andere provider, maar de invariant maakt dat expliciet en toetsbaar | S9 (`external_*_enabled`, allowlist); runbook |
| O1 | env `LOGIN_GATEWAY_*`, `MICROSOFT_LOGIN_*`, `MICROSOFT_LOGIN_ENCRYPTION_KEY` alleen in `preview-stable` | fail-closed | config gooit; knop verborgen; callback weigert |

Alle E- en P-invarianten zijn dashboard-/portaalinstellingen; het runbook schrijft ze voor, de
smoke meet ze, het runbook bevat een periodieke hercontrole (drift = resterend risico).

### 3.4 Dreigingen (uitbreiding dreigingsmodel; nummering definitief bij PR)

| Nr | Dreiging | Maatregel |
|---|---|---|
| R-28 | Automatische e-mailkoppeling (hosted flow óf directe id-token-grant) | E2 (geen `email`-claim voor leden), E5 (hosted flow strandt), P2, P6 indien beschikbaar; L1 weigert bovendien elk token voor een ongebonden identiteit. S7 test dit negatief |
| R-29 | Gast, persoonlijk account of andere tenant | E1; claimvalidatie `tid`/`iss`/`idp`/`acct = 0` |
| R-30 | Juist e-mailadres, afwijkende `tid`/`oid` | e-mail nergens sleutel en niet aangevraagd; binding op `tid + oid` |
| R-31 | Callback-replay, CSRF, `state`-hergebruik, open redirect | eenmalige transactie; PKCE/nonce alleen versleuteld server-side (eigen sleutel); GoTrue-nonce sha256; `veiligVervolgpad`; E4 |
| R-32 | Dubbele of cross-tenant binding | unieke levende-bindingsindexen; `profielen.fonds_id = p_fonds`; host↔fonds |
| R-33 | Token/claims/e-mail lekken | server-geheugen; `sha256(tid:oid)` in audit; vaste categorieën; `no-store`; contracttest |
| R-34 | Platformaccount of profiel-loos account | callback én guard eisen profiel met host-fonds; platform-layout weigert `oauth`-sessies |
| R-35 | Beheerder omzeilt rol-/fondsgrens via koppelen | alleen eigen account; binding wijzigt rol/fonds niet |
| R-36 | Configuratiefout | fail-closed in config, migratie-preflight, hook (403 bij fout) |
| **R-37** | **Ongebonden `oauth`-sessie benadert PostgREST/Storage/Realtime/RPC rechtstreeks** (achtergebleven identiteit, ingetrokken binding, hergebruikt ID-token) | **L1**: geen token zonder binding, ook bij refresh; L0 beperkt wie tokens kan verkrijgen; venster ≤ 600 s expliciet (P8). S10 meet dit |
| R-38 | Half-afgeronde koppeling | toestandsmodel; `linkIdentity` + hook in één transactie → geen identiteit zonder reservering; idempotente herstelroute; `pending` verloopt |
| R-39 | Kwetsbare Auth-versie | P5 + eigen `iss`/`tid`/`aud`-validatie |
| **R-40** | Hook-fout of -uitschakeling schakelt de controle uit, of raakt wachtwoordlogin | hook fail-closed voor `oauth`, onaangeroerd voor de rest; P7 gemeten in smoke (ongebonden `oauth` → 403; wachtwoordlogin → 200); guard L3 als tweede signaal |
| **R-41** | Binding voor identiteit A wordt gebruikt voor identiteit B (pending A → link B; active A → token B), of een andere OAuth-provider gebruikt de generieke `oauth`-poort | hook toetst precies één OAuth-identiteit = `azure` én `sub`/`tid`/`oid` exact gelijk aan de binding, binnen de GoTrue-transactie (S3a'); P9; reservering bevat `sub`/`tid`/`oid` uit ons geverifieerde token |

---

## 4. Doelarchitectuur

### 4.1 Componenten

```
browser ──► /login (knop als fonds.actief) ──► GET /auth/microsoft-login/start?next=…  (host→fonds, flag, tx inloggen)
        ──► Entra (App L, openid profile, PKCE, state, nonce=sha256(N))
        ──► GET /auth/microsoft-login/callback?code&state
              consumeer tx → acquireTokenByCode → valideer claims → zoek_identiteit(tid,oid)=active
              → signInWithIdToken(azure, idToken, N)   [hook L1: active → token]
              → user.id == binding.user_id, profiel, fonds == host-fonds → markeer_gebruikt → next

ingelogd ──► profielkaart ──► GET /api/microsoft-login/koppelen/start (withFondsRoute, profile.manage.own)
              → tx koppelen(user) ──► Entra ──► callback:
              user.id == tx.user_id, profiel/fonds/host ok, geen levende binding
              → reserveer_identiteit → pending (10 min)
              → linkIdentity(azure, idToken, N)        [hook L1: pending → token; identiteit + sessie in één tx]
              → verifieer user.id en provider_id == sub → activeer_identiteit → active
              → bij falen: markeer_mislukt (identiteit bestaat dan niet: tx teruggerold)
         ──► DELETE /api/microsoft-login/koppeling → start_intrekking (revoking; hook weigert vanaf nu)
              → unlinkIdentity → voltooi_intrekking (revoked)

elke tokenuitgifte ──► hook L1 (oauth ⇒ active|pending) ; elke app-request ──► guard L3 (oauth ⇒ active)
```

### 4.2 Datamodel (migratie `2026_09_0X_microsoft_login_fase1b.sql`, additief)

Publiek: `public.fonds_microsoft_login` (ongewijzigd t.o.v. vorige versie: `fonds_id`, `actief`
default `false`, `entra_tenant_id`, `pilotstatus`, `bijgewerkt`; select eigen fonds; geen
schrijfpolicies; config-audittrigger).

Privé `login_private`:

```sql
create table login_private.microsoft_identiteiten (
  id uuid primary key default gen_random_uuid(),
  fonds_id uuid not null references public.fondsen(id),
  user_id  uuid not null references auth.users(id),
  tid text not null, oid text not null, sub text not null,
  status text not null check (status in ('pending','active','revoking','revoked','failed')),
  pending_verloopt_op timestamptz,
  gekoppeld_door uuid not null, gereserveerd_op timestamptz not null default now(),
  geactiveerd_op timestamptz, laatst_gebruikt_op timestamptz,
  intrekking_gestart_op timestamptz, ingetrokken_op timestamptz, ingetrokken_door uuid,
  foutcategorie text, correlatie_id text not null
);
create unique index microsoft_identiteiten_levend_per_identiteit
  on login_private.microsoft_identiteiten (tid, oid) where status in ('pending','active','revoking');
create unique index microsoft_identiteiten_levend_per_account
  on login_private.microsoft_identiteiten (user_id)  where status in ('pending','active','revoking');
-- verlopen pending-rijen worden bij elke reservering eerst naar failed ('pending_verlopen') gezet,
-- zodat het predicaat zonder now() kan.
```

`oauth_transacties` en `audit_log` zoals in de vorige versie. Toestandsovergangen (alleen via
gatewayfuncties, execute `login_gateway`):

| Van | Naar | Functie | Voorwaarde |
|---|---|---|---|
| — | `pending` | `reserveer_identiteit(fonds, user, tid, oid, sub, correlatie)` | `profielen.fonds_id = fonds`; geen levende binding; verlopen pendings → `failed` |
| `pending` | `active` | `activeer_identiteit(id, user)` | `linkIdentity` geverifieerd |
| `pending` | `failed` | `markeer_mislukt(id, categorie)` | fout of verval |
| `active` | `revoking` | `start_intrekking(fonds, user, door, correlatie)` | eigen account |
| `revoking` | `revoked` | `voltooi_intrekking(id)` | `unlinkIdentity` geslaagd of identiteit al weg |
| `pending` + identiteit met zelfde `sub` bestaat | `active` | `herstel_koppeling(...)` | idempotente retry |

Hook-leespad: `login_private.identiteit_toegestaan(p_user uuid, p_sub text, p_tid text, p_oid text)
returns boolean` — `active` of niet-verlopen `pending` **met exact gelijke `sub`/`tid`/`oid`**;
`security definer`, eigenaar `login_hook_owner` (NOLOGIN, alleen `SELECT` op de bindingstabel),
`search_path = ''`, execute **uitsluitend** `supabase_auth_admin`; RLS-policy `for select to
login_hook_owner using (true)` op de bindingstabel (de rol is geen eigenaar en heeft geen
`BYPASSRLS`); `grant usage on schema public to supabase_auth_admin`; plus de
`SECURITY INVOKER`-hook `public.fn_access_token_hook(jsonb)` (§3.2). Rol-preflight in de migratie
omvat `login_gateway` én `login_hook_owner`. Overige leesfuncties: `lees_config`,
`zoek_identiteit` (alleen `active`), `actieve_binding(user_id)` (guard L3), `markeer_gebruikt`,
`maak_transactie`, `consumeer_transactie`, `registreer_gebeurtenis`.

### 4.3 Configuratie en omgevingsvariabelen

| Variabele | Doel |
|---|---|
| `MICROSOFT_LOGIN_TENANT_ID`, `MICROSOFT_LOGIN_CLIENT_ID`, `MICROSOFT_LOGIN_CLIENT_SECRET` | App L; client-id = Supabase-Azure-client-id |
| `MICROSOFT_LOGIN_ENCRYPTION_KEY`, `MICROSOFT_LOGIN_KEY_VERSION` | eigen sleutel transactie-blob; AAD-prefix `m365login:v1:` |
| `LOGIN_GATEWAY_DATABASE_URL`, `LOGIN_GATEWAY_CA_CERT_BASE64` | rol `login_gateway` |

Redirect-URI server-side afgeleid uit de genormaliseerde request-host met actieve
`tenant_domains`-rij. Geen hergebruik van `MICROSOFT_*`-connectorvariabelen of -sleutels.
Supabase-dashboard: P1–P8 (hook op `public.fn_access_token_hook`, `jwt_expiry` 600).

### 4.4 Code (nieuw)

| Bestand | Inhoud |
|---|---|
| `core/lib/microsoft-login-config.ts` | env, `MICROSOFT_LOGIN_SCOPES = ["openid","profile"]`, callback-URI-afleiding |
| `core/lib/microsoft-login-identity-core.ts` (puur) | claimvalidatie: `tid`, `iss` exact, `aud`, `exp`, `ver`, `nonce`=sha256, `oid`/`sub` niet-leeg, `idp`, `acct` verplicht `0`, MSA-tenant → `{ ok, categorie }`; `identiteitHash` |
| `core/lib/microsoft-login-error-core.ts` (puur) | categorieën incl. `binding_ontbreekt`, `pending_verlopen`, `hook_geweigerd` |
| `core/lib/microsoft-login-gateway.ts` | pg-Pool `login_gateway`; één functie per gatewayfunctie |
| `core/lib/microsoft-login.ts` | orchestratie (reserveer → link → verifieer → activeer; herstel; inloggen; ontkoppelen) |
| `core/lib/microsoft-login-sessieguard.ts` + `-core.ts` | L3, zonder cache |
| `app/auth/microsoft-login/start/route.ts`, `…/callback/route.ts` | OAuth-uitzondering, buiten `withFondsRoute` |
| `app/api/microsoft-login/koppelen/start/route.ts`, `…/koppeling/route.ts` (GET/DELETE/POST herstel) | `withFondsRoute`, `profile.manage.own`, audit |
| `app/(dashboard)/profiel/_components/MicrosoftLoginKaart.tsx`, `app/login/*` | UI |
| layout/fonds-sessie/route-wrapper/login-layout/platform-layout | aanroep guard L3 |
| `app/auth/callback/route.ts` | L4 |
| migratie + `supabase/checks/…microsoft_login_fase1b.sql` + rollback + allowlist | hook, `login_private`, config |

---

## 5. Flows (fail-closed volgorde)

Ongewijzigd ten opzichte van de vorige versie, met drie correcties:

- **Koppelen** stap 10–12: `reserveer_identiteit` (pending) → `linkIdentity` (hook staat toe op
  grond van de pending) → verifiëren → `activeer_identiteit`. Faalt `linkIdentity`, dan is er
  door de transactie geen identiteit; alleen `markeer_mislukt`. De sessie die `linkIdentity`
  teruggeeft (methode `oauth`) vervangt de wachtwoordsessie; vanaf dat moment gelden L1 en L3.
- **Inloggen**: geen `signInWithIdToken` zonder `active`; de hook is de tweede toets; daarna
  `user.id === binding.user_id`, profiel, host-fonds.
- **Ontkoppelen**: `start_intrekking` maakt de binding `revoking`; de hook weigert vanaf de
  eerstvolgende refresh, de guard direct; `unlinkIdentity` → `revoked`. Mislukt unlink, dan
  blijft `revoking` (geen toegang) en biedt de kaart **Opnieuw proberen**.

Foutafhandeling en neutrale meldingen ongewijzigd; correlatie-id als supportcode.

---

## 6. Beveiligingsinvarianten (worden tests)

1. Scopes exact `openid profile`; nergens `email`, `offline_access`, Graph-scopes. De authorize-
   én tokenrequest worden als contract getest; een tokenresponse met `refresh_token` faalt gesloten.
2. Geen `fetch` naar `graph.microsoft.com`; login-code importeert niets uit `microsoft-vault`/`-connector`/`-config`.
3. Geen `service_role`/`SUPABASE_SERVICE_ROLE_KEY`/`supabase-platform` in login-code; gateway en guard `server-only`.
4. Geen `accessToken|idToken|refreshToken|email` in log-/auditpaden; `no-store`.
5. `login_private`: RLS aan; geen tabelrechten voor `anon`, `authenticated`, `service_role`, `login_gateway`, `supabase_auth_admin`; alleen `login_hook_owner` heeft `SELECT` op de bindingstabel; gatewaydefiners op `pg_temp`, helper op `search_path = ''`; execute alleen `login_gateway`, behalve `identiteit_toegestaan` → alleen `supabase_auth_admin`.
6. `public.fn_access_token_hook`: **niet** `SECURITY DEFINER`; execute alleen `supabase_auth_admin`; retourneert `event` ongewijzigd zonder databaseraadpleging voor niet-`oauth`; 403 voor `oauth` bij ≠ 1 OAuth-identiteit, provider ≠ `azure`, ontbrekende `custom_claims.tid/oid`, of `sub`/`tid`/`oid` ≠ binding; 403 bij exceptie.
7. Unieke levende-bindingsindexen werken over fondsen heen; `reserveer_identiteit` weigert fondsmismatch; `activeer_identiteit` weigert andere user.
8. `audit_log` append-only.
9. Transactie eenmalig.
10. Claimvalidatie weigert: andere `tid`, MSA-tenant, `idp ≠ iss`, `acct` ontbreekt of `≠ 0`, `aud`, `iss`, `ver`, `nonce`, `exp`, lege `oid`/`sub`.
11. Guard L3: `amr ∋ oauth` zonder `active` → beëindigd in elk chokepoint; geen cache; wachtwoordsessies passeren zonder gateway-aanroep.
12. Toestandsmodel: geen overgang buiten §4.2; `pending` nooit als actief in `zoek_identiteit`/`actieve_binding`.
13. Wachtwoordlogin, refresh en `/auth/callback` voor niet-azure-sessies byte-identiek (W1-harnas waar beschikbaar) — ook mét hook ingeschakeld.

---

## 7. Testdekking

Zoals de vorige versie, plus:

| Eis | Test | Laag |
|---|---|---|
| hook weigert ongebonden `oauth`, laat wachtwoord door | `supabase/checks/…fase1b.sql`: hook aanroepen met synthetische events (`oauth` zonder binding → error-object; `oauth` met `active` → event; `password` → event zonder `login_private`-toegang; `token_refresh` met `amr oauth` en `revoking` → error) | DB-laag (cross-tenant-ci) |
| hook fail-closed bij fout | check-SQL: `identiteit_toegestaan` tijdelijk vervangen door raising stub in wegwerptransactie → error-object | DB-laag |
| hook toetst exacte identiteit | check-SQL met synthetische `auth.identities`-rijen in wegwerptransactie: binding A + identiteit B → error; binding A + identiteit A → event; twee OAuth-identiteiten → error; provider `google` → error; `custom_claims` zonder `oid` → error | DB-laag |
| P9 | contracttest op de hosted config-allowlist-uitvoer (alleen `azure` aan) in het runbook; check-SQL kan dit niet meten | Preview/S9 |
| directe datalaagtoegang | e2e/smoke §8: ongebonden `oauth` → geen token → `/rest/v1` 401; gebonden → 200; na intrekking → nog 200 tot `exp` (≤ 600 s), refresh → 403 | Preview |
| link + hook atomair | flowtest met mock; DB-laag: `linkIdentity` gesimuleerd als tx met hookweigering → geen identiteit | app + DB |

Registers: `route-mechanismen.expected.json`, `audit-handelingen.expected.json`, authz-matrix,
`allowlist-grants.tsv` (+ regel voor `supabase_auth_admin`-execute), `scripts/cross-tenant-ci.sh`.

---

## 8. Preview-uitrol en smoke

1. Spike T0.5 groen (§9.1). PR-A → `preview`; rol `login_gateway`, sleutel; migratie + check-SQL; allowlist.
2. Entra App L conform E1–E7 (manifest-export in runbook); Supabase P1–P8 (hook inschakelen, `jwt_expiry` 600); Vercel env; deployment.
3. PR-B → `preview`.
4. PGB-activering (id-gebonden update, exact één rij).
5. Smoke: P5-versie; koppelen (één `azure`-identiteit, één `active`-binding, `auth.users` ongewijzigd); uitloggen + Microsoft-login (zelfde `user_id`, `amr ∋ oauth`); wachtwoordfallback (geen gateway-aanroep, hook onaangeroerd); niet-gekoppeld account → neutrale melding, geen rij; **E5 (handmatig, browser):** hosted flow → AADSTS50011, geen rij; **R-37:** ontkoppelen → refresh → 403; met bewaard access-token direct `/rest/v1/profielen` → 200 tot `exp` (vastleggen, ≤ 600 s) → daarna 401; bewaard ID-token opnieuw aanbieden → identiteit weg → `signup_disabled`; scenario `revoking` kunstmatig → id-token-grant → 403 (hook); verlopen sessie; flag uit (nieuwe logins dicht; bestaande bindingen blijven — bewuste keuze in runbook).
6. Audit-/logcontrole zonder token-, code-, `state`-, `nonce`-, claim- of e-mailmateriaal.
7. Documentatie: runbook F1B (rollback, secret-/sleutelrotatie, support "koppeling herstellen", periodieke E/P-controle, hook-uitschakelprocedure = alle Microsoft-logins dicht), dreigingsmodel R-28…R-40, ASVS-subsectie, HANDOVER, 0211 → Geaccepteerd.

---

## 9. Tranches, spike T0.5 en PR-indeling

### 9.1 Spike T0.5 (vóór T1; geen productiecode; lokaal)

**Doel:** bewijzen dat route B werkt met E2/E5/E6/E7, dat de hook ongebonden `oauth`-sessies
tokenloos maakt (ook voor directe datalaagtoegang), en de negatieve e-mailkoppelingstest.

**Opzet:** lokale CLI-stack (CLI 2.114.0 via de `npx`-shim, pint `supabase/gotrue:v2.195.0`;
`/auth/v1/health` blijft het doorslaggevende versiebewijs, S8). Tijdelijk in
`supabase/config.toml` (niet committen):

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
url = "https://login.microsoftonline.com/<tid>"
```

`scripts/spike/spike-hook.sql` zet een wegwerp-prototype (`spike_private.bindingen`,
`spike_private.identiteit_toegestaan` onder NOLOGIN-rol `spike_hook_owner`, en de
`SECURITY INVOKER`-hook `public.spike_access_token_hook`) op de lokale stack;
`scripts/spike/microsoft-login-spike.mjs` (directe OIDC authorization-codeflow, callback op
`127.0.0.1:3999` met timeout, scopes exact `openid profile`, PKCE + nonce = sha256(N),
discovery/JWKS/RS256-validatie en weigering van een refresh-token) meet daarna tegen de lokale
GoTrue/PostgREST. **Let op:** de terminal toont de autorisatie-URL met tijdelijk `state`- en
noncemateriaal; alleen de markdown-uitvoer is daarvan vrij.

| # | Meting | Verwacht |
|---|---|---|
| S1-transport | Authorize- en tokenrequest exact `openid profile`; `offline_access` afwezig; tokenresponse bevat geen `refresh_token`; ID-tokenhandtekening valide | ✅ |
| S1 | ID-token: exact `iss`, `aud`, `exp` > nu, `ver` = 2.0, `nonce` = sha256(N), `tid` = tenant ≠ MSA, `oid`/`sub` niet-leeg, `acct` = 0, `idp` afwezig; `email`/`xms_edov` **informatief** (verwacht afwezig zonder scope) | ✅ |
| S2 | id-token-grant zonder sessie, identiteit onbekend | 422 `signup_disabled`; tellingen ongewijzigd |
| S3a | wachtwoordlogin → `link_identity` **zonder** reservering | 403 (hook) én **geen** identiteit (transactie teruggerold) |
| **S3a'** | reservering `pending` voor **identiteit A** (andere `sub`/`oid`) → `link_identity` met token **B** | 403 (hook: `sub`/`tid`/`oid` ≠ reservering) én geen identiteit; volledige rollback |
| S3b | reservering `pending` voor B → `link_identity` | 200; zelfde `user.id`; identiteit `provider_id = sub`; daarna activeren |
| **S3c** | `identity_data.custom_claims.tid`/`oid` van de nieuwe identiteit | exact gelijk aan de tokenclaims (harde eis; de hook leunt hierop) |
| S4 | uitloggen → id-token-grant | 200; zelfde `user.id`; `amr ∋ oauth` |
| S10a | binding → `revoked`; id-token-grant | 403 (hook, geen token) |
| S10b | bewaard access-token uit S4 → `GET /rest/v1/profielen?select=id` | 200 tot `exp` (venster; vastleggen), refresh → 403 |
| S10c | wachtwoordlogin testgebruiker terwijl binding `revoked` | 200 (hook raakt wachtwoord niet); refresh 200 |
| S10d | wachtwoordsessie → `GET /rest/v1/profielen` | 200 |
| S10e | `oauth`-sessie met `active` binding → `GET /rest/v1/profielen` | 200 (basislijn, vóór S10a) |
| S5 | binding `active` herstellen → unlink (`DELETE /user/identities/{id}`) → id-token-grant | unlink 200; daarna 422 `signup_disabled`; identiteiten terug op beginstand |
| S6 | **handmatig in de browser:** `…/auth/v1/authorize?provider=azure&redirect_to=http://localhost:3000/auth/callback` | Entra-foutpagina **AADSTS50011**; geen rij, geen sessie (script controleert alleen de `redirect_uri` in de 302 en print de URL) |
| S7 | **negatieve test, aparte run** `SPIKE_MODE=s7` met vooraf uitgesproken `SPIKE_S7_VERWACHT=auto_link\|signup_disabled` (hook uit in `config.toml`, `SPIKE_SCOPES="openid profile email"`, inloggen met tweede Entra-account met **hetzelfde e-mailadres** als het testaccount): id-token-grant zonder sessie; afwijking van de verwachting is rood | zonder linking domain: **automatische koppeling** (sessie + identiteit aan bestaand account) — bevestigt R-28 voor de id-token-ingang; met `GOTRUE_EXPERIMENTAL_PROVIDER_LINKING_DOMAINS="azure=microsoft_login"` lokaal: `signup_disabled`; zonder `email`-scope: `signup_disabled`. Script ruimt de identiteit op |
| S8 | `GET /auth/v1/health` | `version` ≥ 2.185.0 |
| S9 | `scripts/spike/management-auth-config.mjs`: read-only `GET /v1/projects/{ref}/config/auth`, verwerkt via vaste allowlist (P1–P4, P7, P8), lijst ingeschakelde OAuth-providers (P9) en aanwezigheid van een linking-domain-sleutel (P6); ruwe respons wordt niet opgeslagen | P9: alleen `azure`; P6: ja/nee vastleggen, anders navraag bij Supabase |

**S9-nulmeting Preview (2026-09-06):** `disable_signup=true` is reeds goed; manual linking,
Azure-provider en Custom Access Token Hook staan nog uit; `jwt_exp=3600`; er staat geen
OAuth-provider aan. Geen van de 243 ontvangen configuratiesleutels betreft linking domains.
Dit is een verwachte rode nulmeting vóór T1/T3 en maakt de provisioningvolgorde blokkerend:
eerst hook/migratie en App L-provider, dan `jwt_exp=600`, daarna pas de fondsfeatureflag.

Cleanup in `finally`: aangemaakte `azure`-identiteit verwijderen (met nog geldige sessie, anders
SQL-opruimregel printen), `spike_private.bindingen` leeg, databaseverbinding sluiten,
callbackserver sluiten.

**Benodigd van de opdrachtgever:** App L-registratie (E1–E3, E6, E7; redirect-URI
`http://localhost:3999/callback`), client-id/secret/tenant-id in `.env.spike`, één lid-testaccount,
één tweede account met gelijk e-mailadres (S7). Uitvoer → `SPIKE-335-T0.5.md`.

### 9.2 Tranches

| Tranche | Inhoud | Merge-regel |
|---|---|---|
| **T0** | karakterisering, 0211, dit ontwerp; na akkoord als voorgestelde ontwerpcommit op de branch | gebruiker akkoord op §10 |
| **T0.5** | spike §9.1 incl. S10; `SPIKE-335-T0.5.md`; D8/P6/P7 definitief | gebruiker beoordeelt; blokkerend voor T1 |
| **T1 / PR-A** | migratie (`login_private`, hook, toestandsmodel, config) + rollback + check-SQL (hook-events) + allowlist + gateway + runbook | migratie ⇒ gebruiker merget |
| **T2 / PR-B** | cores, orchestratie, routes, callback, guard L3, L4, UI, tests, registers | raakt sessieresolutie ⇒ gebruiker merget |
| **T3** | Entra/Supabase (P1–P8)/Vercel, PGB-activering, smoke, docs-PR | docs additief ⇒ zelf mergen bij groene gates |

---

## 10. Keuzes en stand (review 2 — 2026-09-05)

| # | Keuze | Stand |
|---|---|---|
| D1 | Route B | akkoord |
| D2 | Aparte App L | akkoord |
| D3 | Rol `login_gateway` + schema `login_private` | akkoord |
| D4 | Tabel `public.fonds_microsoft_login` | akkoord |
| D5 | Toestandsmodel; vervangen = ontkoppelen + koppelen | akkoord |
| D6 | ~~callbackverharding~~ → ~~applicatieguard~~ → **Custom Access Token Hook als primaire afdwinging, op de exacte identiteit** (precies één OAuth-identiteit = `azure`, `sub`/`tid`/`oid` = binding); hook `SECURITY INVOKER`, alleen de helper `SECURITY DEFINER` onder `login_hook_owner`; guard L3 en L4 secundair | **akkoord na review 3, mits S3a'/S3c groen** |
| D7 | Eigen sleutel | akkoord |
| D8 | `email`-scope **weglaten**; `xms_edov` **niet geëist** (vereist `email`) | **herzien conform review 2** |
| D9 | `acct` verplicht aanwezig én `0` | akkoord |
| D10 | Auth ≥ 2.185.0 | akkoord |
| D11 | Linking domain indien beschikbaar (S9) | onderzoeken |
| **D12** | `jwt_expiry` 600 s op Preview; intrekkingsvenster ≤ 10 min expliciet geaccepteerd | **akkoord voor Preview**; productie later opnieuw besluiten op belasting en gebruikerservaring |
| **D13** | Hook weigert (403) in plaats van rechteloze rol | **akkoord** |
| **D14** | P9: Azure is de enige ingeschakelde OAuth-provider; nieuwe provider ⇒ eerst hookwijziging; gecontroleerd via read-only Management API met vaste allowlist | **nieuw conform review 3** |

Na akkoord: documenten + spike als voorgestelde ontwerpcommit. T1 pas na groene spike inclusief S10.
