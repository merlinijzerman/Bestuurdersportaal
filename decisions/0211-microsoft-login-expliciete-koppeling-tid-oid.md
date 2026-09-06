# 0211 — Microsoft-login (fase 1B): expliciete koppeling aan een bestaand account, autorisatie op `tid + oid`, eigen OIDC-flow en afdwinging vóór tokenuitgifte

- **Status:** Voorgesteld (tweede herziening 2026-09-05 na review). Blijft *Voorgesteld* totdat spike S7 én de Preview-uitrolvoorwaarden (P1–P9) groen zijn. T1/PR-A (datamodel, rechtenmodel, Auth-hook, gateway) is op 2026-09-06 gebouwd en lokaal bewezen terwijl S7 openstaat; S7 blijft een harde merge- en activatievoorwaarde, S9 is een verwachte rode Preview-nulmeting.
- **Datum:** 2026-09-05
- **Betrokkenen:** Merlin (opdrachtgever/productowner, review), Claude (karakterisering en ontwerp)
- **Ticket:** [#335](https://github.com/merlinijzerman/Bestuurdersportaal/issues/335) — M365 fase 1B, Microsoft-login voor bestaande portaalaccounts (PGB Preview-pilot)
- **Ontwerp:** `MICROSOFT-365-LOGIN-F1B-ONTWERP.md`

## Context

Het portaal kent e-mail/wachtwoord-login (Supabase Auth) en, daarvan gescheiden, de
Microsoft 365 Graph-connector met eigen tokenkluis (fase 1, 2A, 3; besluiten 0208/0210).
Voor Microsoft-georiënteerde fondsen willen we **Inloggen met Microsoft** aanbieden voor
*bestaande* portaalaccounts. De harde eisen: Supabase Auth blijft sessie-eigenaar, de
Supabase-user-UUID en daarmee `profielen.id`, fonds en rol blijven ongewijzigd, er is
geen JIT-provisioning, en autorisatie steunt op een duurzame binding van Microsoft
`tid + oid` — nooit op e-mailadres of `preferred_username`.

Het ticket eist vóór productiecode een karakterisering van Supabase Azure-OAuth met een
bestaand wachtwoordaccount, uitgeschakelde registraties, automatische e-mailkoppeling en
manual identity linking. Die karakterisering is uitgevoerd op de Supabase Auth-broncode
(GoTrue `master`, 2026-09-05), de Supabase-hookdocumentatie en de Microsoft-claimreferenties;
de bevindingen staan in het ontwerpdocument §2. De bevindingen die dit besluit dragen:

1. **Automatische e-mailkoppeling staat standaard áán en geldt voor élke ingang.** GoTrue
   koppelt een nieuwe identiteit aan een bestaande gebruiker zodra het provider-e-mailadres
   als *geverifieerd* geldt. Dat gebeurt in `createAccountFromExternalIdentity`, die zowel de
   hosted redirectflow als de directe id-token-grant gebruiken. Voor Azure geldt een e-mail als
   geverifieerd wanneer de claim `xms_edov` **ontbreekt** en er een `email`-claim is.
   Gastaccounts dragen hun `email`-claim standaard, ook zonder `email`-scope.
2. **Uitgeschakelde registraties blokkeren alleen het aanmaken, niet het koppelen.**
   `DisableSignup` geeft `422 signup_disabled` op `CreateAccount`; `LinkAccount` loopt door.
3. **Supabase geeft sessies uit zonder onze bindingstabel te raadplegen, en de datalaag
   vertrouwt op `auth.uid()`.** Een sessie die via Supabase ontstaat, kan PostgREST, Storage en
   Realtime rechtstreeks benaderen (browserclient `core/lib/supabase.ts`). Een controle die
   alleen in de Next.js-app zit, is daarom nooit de primaire beveiliging.
4. **De Custom Access Token Hook draait vóór élke tokenuitgifte**, ook bij `token_refresh`,
   krijgt `user_id`, `claims` (incl. `amr`) en `authentication_method`, en kan de uitgifte
   weigeren met `{ "error": { "http_code": 403, … } }`. Zowel de id-token-sign-in als
   `link_identity` geven een sessie uit met methode `oauth` (`issueRefreshToken(..., models.OAuth)`).
5. **De hosted flow kan alleen slagen als Entra de Supabase-callback kent.** Registreren we
   `https://<project>.supabase.co/auth/v1/callback` bewust níét in de login-app, dan weigert
   Entra de `redirect_uri` vóór er een code, identiteit of sessie ontstaat.
6. **Een geïsoleerd linking domain bestaat in de bron** (`GOTRUE_EXPERIMENTAL_PROVIDER_LINKING_DOMAINS`,
   bijv. `azure=microsoft_login`) en sluit automatische koppeling aan de e-mail-pool per
   constructie uit; beschikbaarheid op het hosted platform is te bevestigen.
7. **Advisory GHSA-v36f-qvww-8w8m:** Azure-ID-token-authenticatie vóór Auth 2.185.0 was
   kwetsbaar voor issuer-manipulatie. De id-token-grant toetst de issuer alleen op prefix;
   onze eigen `tid`/`iss`-validatie is de tenantcontrole.
8. **`xms_edov` wordt alleen uitgegeven als de `email`-claim aanwezig is** (Microsoft optional
   claims reference). Zonder `email`-scope is `xms_edov` dus geen bruikbare eis; `acct` (`0` =
   lid, `1` = gast) wel.
9. **Manual linking met ID-token en id-token-sign-in stellen geen e-mail-eis** zodra de
   doelgebruiker al een e-mailadres heeft of de identiteit al bestaat.
10. **`oauth` is generiek.** De methode `oauth` in `authentication_method`/`amr` duidt élke
    social/OAuth-login aan, niet specifiek Azure. De hook krijgt niet mee wélke identiteit is
    gebruikt; zij moet dat zelf uit `auth.identities` afleiden, binnen de GoTrue-transactie
    (de hook draait op dezelfde `tx` als `linkIdentityToUser` en `issueRefreshToken`, zodat een
    zojuist aangemaakte identiteit zichtbaar is).

## Besluit

> Een Microsoft-identiteit wordt uitsluitend **expliciet**, door een reeds ingelogde en
> uitgenodigde gebruiker, aan diens bestaande Supabase-account gekoppeld; de Supabase-user-UUID
> blijft dezelfde. Autorisatie steunt op een privé, server-side binding
> `fonds_id + user_id + tid + oid`. Die binding wordt **in de Auth-laag afgedwongen vóór elke
> tokenuitgifte** (Custom Access Token Hook), zodat een Microsoft-sessie zonder actieve binding
> nooit een geldig access-token krijgt — ook niet bij refresh, en ook niet voor directe
> PostgREST-, Storage- of Realtime-toegang. Automatische e-mailkoppeling wordt technisch
> onmogelijk gemaakt, niet als restrisico geaccepteerd.

Concreet:

1. **Primaire afdwinging in de Auth-/datalaag, op de exacte identiteit.** Een Postgres Custom
   Access Token Hook (`public.fn_access_token_hook`, `SECURITY INVOKER`, uitgevoerd door
   `supabase_auth_admin`) toetst bij elke uitgifte waarvoor `authentication_method = 'oauth'` is
   óf `claims.amr` de methode `oauth` bevat, binnen dezelfde transactie:
   (a) de gebruiker heeft **precies één** OAuth-identiteit (alles behalve `email`/`phone`) en die
   is `azure`; (b) `provider_id` (= `sub`) én `identity_data.custom_claims.tid`/`oid` van die
   identiteit zijn **exact gelijk** aan de binding met status `active` — of, uitsluitend tijdens
   het koppelen, een niet-verlopen `pending` — voor deze `user_id`. Anders weigert de hook (403)
   en ontstaat er geen token; bij `link_identity` rolt daarmee ook de identiteit terug. Een
   `pending` voor identiteit A kan dus geen identiteit B binden, een actieve binding voor A staat
   geen token voor B toe, en een andere OAuth-provider wordt geweigerd. Niet-`oauth`-uitgiftes
   (wachtwoord, magic link, herstel, TOTP) keren terug vóór enige databaseraadpleging. Fouten
   in het `oauth`-pad zijn fail-closed (403). Alleen de kleine private helper
   `login_private.identiteit_toegestaan(user, sub, tid, oid)` heeft verhoogde rechten
   (`SECURITY DEFINER`, eigenaar = minimale NOLOGIN-rol `login_hook_owner` met uitsluitend
   `SELECT` op de bindingstabel, `search_path = ''`, execute alleen `supabase_auth_admin`),
   conform het Supabase-advies om Auth-hooks zelf niet als `SECURITY DEFINER` onder een breed
   bevoegde eigenaar te draaien.
2. **Intrekkingsvenster expliciet.** Een al uitgegeven access-token blijft geldig tot `exp`;
   intrekking werkt via de hook bij de eerstvolgende refresh. Voor de pilot wordt de
   JWT-geldigheid op het Preview-project op **600 seconden** gezet (P8); het geaccepteerde
   venster is dus maximaal tien minuten voor directe datalaagtoegang. De applicatieguard (punt 3)
   beëindigt de portaalsessie eerder, maar dekt de directe toegang niet — dat is de reden dat
   het venster wordt benoemd en niet weggeredeneerd.
3. **Eigen OIDC-flow, Supabase alleen als sessie-uitgever (route B).** Koppelen en inloggen
   lopen via onze eigen directe OIDC Authorization Code + PKCE + `state` + `nonce`-flow (single-tenant
   authority, scopes `openid profile`), gespiegeld aan het geharde fase-1-patroon. Hiervoor
   gebruiken we bewust een directe OIDC-uitwisseling en niet de standaard MSAL-aanvraag:
   MSAL-node 6.0 voegt in de gebruikte authorization-codeflow automatisch `offline_access`
   toe. Dat schendt de minimale-scope-invariant en kan een refresh-token opleveren. De eigen
   flow valideert discovery, JWKS-host, RS256-handtekening, issuer, audience, geldigheid en
   nonce fail-closed. Het
   geverifieerde ID-token gaat daarna naar `linkIdentity({ provider: "azure", token, nonce })` of
   `signInWithIdToken(...)`. Bij inloggen wordt de binding vóór die aanroep getoetst. Een
   secundaire applicatieguard (`amr ∋ oauth` ⇒ actieve binding, zonder cache) zit in de
   tenant-layout, `haalFondsSessie`, `withFondsRoute`, de login-layout en de platform-layout;
   de verharding van `/auth/callback` is eveneens defence-in-depth.
4. **Entra-invarianten die de hosted flow en losse tokens onmogelijk maken.** Aparte
   single-tenant app-registratie "Bestuurdersportaal Login" (App L): alleen delegated
   `openid profile` (geen `email`, `offline_access`, Graph of application permissions);
   optionele claim `acct`; **de Supabase-callback wordt nooit geregistreerd**; *Allow public
   client flows* uit; implicit en hybrid flows uit; uitsluitend onze eigen
   `/auth/microsoft-login/callback`-URI's per fondshost. Alleen onze server (met clientsecret)
   kan een ID-token voor App L verkrijgen.
5. **Runtime-claimvalidatie is strikt:** `tid` = fonds-`entra_tenant_id` = env-tenant en ≠
   MSA-tenant; `iss` exact `https://login.microsoftonline.com/<tid>/v2.0`; `aud` = App L;
   `exp` in de toekomst; `ver` = `2.0`; `nonce` = sha256 van onze nonce; `oid` en `sub`
   niet-leeg; `idp` afwezig of gelijk aan `iss`; **`acct` aanwezig én `0`** (ontbreken =
   weigeren). `xms_edov` en `email` spelen in onze flow geen rol en worden niet geëist; zij
   worden pas weer relevant als de hosted flow ooit wordt toegestaan.
6. **Supabase-projectinvarianten, gemeten in de smoke:** Azure-provider aan met App L, *Allow
   new users to sign up* uit, *Manual linking* aan, redirect-allowlist minimaal, Auth-versie
   ≥ 2.185.0 (`/auth/v1/health`) als **harde uitrolvoorwaarde**, Custom Access Token Hook
   ingeschakeld op de hookfunctie, JWT-geldigheid 600 s, **Azure als enige ingeschakelde
   OAuth-provider** (P9; wordt later een andere provider toegevoegd, dan moet de hook eerst
   worden aangepast), en — als het hosted platform het toestaat — linking domain
   `azure=microsoft_login`. Deze instellingen worden read-only via de Management API
   gecontroleerd met een vaste allowlist; de ruwe auth-config wordt nooit weggeschreven.
7. **Atomaire koppeling via toestandsmodel.** Binding-status `pending → active → revoking →
   revoked | failed`. Koppelen = reserveren (`pending`, 10 min) → `linkIdentity` → verifiëren
   (zelfde `user.id`, `identity.provider_id === sub`) → activeren. Omdat `linkIdentity` de
   identiteit en het token in één databasetransactie uitgeeft en de hook binnen die transactie
   weigert zonder reservering, kan er geen identiteit zonder reservering ontstaan. Callback en
   retry zijn idempotent; ontkoppelen = `revoking` → `unlinkIdentity` → `revoked`, en een
   `revoking`-binding wordt door de hook al geweigerd.
8. **Private loginidentiteitslaag achter een eigen minimale databaserol.** Schema
   `login_private` met bindingen (inclusief `sub`, `tid`, `oid`), eenmalige transacties en
   append-only audit, via `SECURITY DEFINER`-gatewayfuncties voor de aparte loginrol
   `login_gateway`; daarnaast uitsluitend de kleine helper
   `login_private.identiteit_toegestaan(uuid, text, text, text)` voor de hook (zie punt 1).
   Geen directe tabelrechten voor `anon`, `authenticated`, `service_role` of
   `supabase_auth_admin`. Unieke constraints over alle fondsen: één levende binding per `tid + oid` en
   per `user_id`. Eigen versleutelingssleutel `MICROSOFT_LOGIN_ENCRYPTION_KEY`.
9. **Fondsgebonden, standaard uit.** `public.fonds_microsoft_login` (per fonds: `actief`
   standaard `false`, toegestane `entra_tenant_id`, pilotstatus) is in deze tranche alleen via
   migratie/gecontroleerde SQL wijzigbaar; wijzigingen lopen door het bestaande
   config-audittrigger-patroon.
10. **Eerst een T0.5-spike, inclusief directe datalaagtoegang.** Vóór T1 bewijst een lokale
    spike (CLI-stack met gotrue v2.195.0, prototype-hook, App L, één testaccount) dat route B
    werkt zonder Supabase-callbackregistratie en zonder `email`-scope, dat een onbekende
    identiteit `signup_disabled` geeft, dat de hosted flow bij Entra strandt, dat automatische
    koppeling via de id-token-grant mét `email` en zonder linking domain wél kan optreden
    (negatieve test), en dat een `oauth`-sessie zonder actieve binding **geen token krijgt** en
    dus `/rest/v1`, Storage en RPC's niet kan bereiken — met meting van het intrekkingsvenster.

## Overwogen alternatieven

- **A — Supabase-hosted redirectflow.** Niet gekozen: GoTrue koppelt vóór onze code iets kan
  toetsen; `tid`/`oid` alleen uit ongedocumenteerde `identity_data.custom_claims`; browser
  initieert; vereist juist de Supabase-callback in Entra die we nu bewust weglaten.
- **B — Vertrouwen op automatische e-mailkoppeling.** Verworpen (ticket; onveilig zonder `xms_edov`).
- **C — Eigen sessie-uitgifte buiten Supabase.** Verworpen: service-role in het tenantpad of een
  tweede sessiemechanisme.
- **D — Binding in `public` onder RLS met self-gated definer-functies voor `authenticated`.**
  Verworpen voor de inlogtoets (geen `auth.uid()` vóór de sessie; enumeratie-orakel).
- **E — Hergebruik van rol `microsoft_vault`, schema `microsoft_private` en kluissleutel.**
  Niet gekozen: gescheiden vertrouwensdomeinen verdienen aparte rol, schema en sleutel.
- **F — Callbackverharding als primaire maatregel** (eerste versie). Verworpen: dekt de directe
  id-token-grant niet.
- **G — Applicatieguard (Next.js) als primaire maatregel** (tweede versie). Verworpen na review:
  de browserclient en RLS op `auth.uid()` laten directe PostgREST-/Storage-/Realtime-toegang
  toe buiten de app om. Vervangen door de Auth-hook; de guard blijft secundair.
- **H — Hook geeft een rechteloze databaserol in plaats van een fout.** Niet gekozen: een token
  weigeren is eenvoudiger te bewijzen dan een rol zonder rechten volledig dicht te houden
  (Storage, Realtime, RPC-grants), en het laat geen bruikbaar token ontstaan.
- **I — Per-klant SSO (SAML/OIDC) of multi-tenant Entra-app met `tid`-allowlist.** Buiten scope
  (vervolgarchitectuur); binding en `entra_tenant_id` per fonds zijn erop voorbereid.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd voor bestaande tabellen; de datalaag krijgt géén nieuwe
  claims of rollen. De hook voorkomt dat een ongebonden `oauth`-sessie een token krijgt; RLS
  hoeft daar niets van te weten. Fondsconsistentie wordt bij reservering (`profielen.fonds_id`)
  en in callback en guard afgedwongen. Geen service-role in het tenantpad.
- **Beschikbaarheid:** de hook is projectbreed. Ontwerpregel: niet-`oauth`-uitgiftes keren
  terug vóór enige databaseraadpleging; `oauth`-uitgiftes falen gesloten bij fouten, en élke
  andere OAuth-provider dan `azure` wordt geweigerd (P9 maakt dat expliciet; een nieuwe
  provider vereist eerst een hookwijziging). De Preview-smoke bewijst dat wachtwoordlogin en
  refresh onaangetast blijven.
- **Sessies:** JWT-geldigheid 600 s betekent frequentere, automatische refreshes voor alle
  gebruikers op Preview. Intrekking van een Microsoft-koppeling werkt binnen dat venster.
- **Audit:** reserveren, activeren, mislukken, intrekken, geslaagde en geweigerde Microsoft-login,
  hook-weigering (categorie, geen inhoud) en configuratiewijziging worden inhoudsvrij en
  append-only vastgelegd. Geen tokens, codes, `state`/`nonce`, claims of e-mailadressen.
- **Datamodel/migratie:** één additieve migratie (schema `login_private`, hookfunctie,
  `public.fonds_microsoft_login`, rol-preflight), met rollback, check-SQL en allowlist-regels.
  De hook wordt daarna in het dashboard ingeschakeld (P7) — een dashboardstap, dus gemeten.
- **Gebruik/beheer:** wachtwoordlogin blijft volledig werken. Koppelen op de profielpagina;
  vervangen is *ontkoppelen + opnieuw koppelen*. Eén neutrale melding bij elke weigering.
- **Uitrolvoorwaarden (blokkerend):** spike T0.5 groen inclusief directe-toegangstest; Auth
  ≥ 2.185.0; Entra-invarianten; hook ingeschakeld en gemeten; JWT 600 s.
- **Restrisico:** het intrekkingsvenster van maximaal 600 s voor directe datalaagtoegang met een
  al uitgegeven token, expliciet geaccepteerd. Drift in de Entra- of Supabase-configuratie;
  gedekt door periodieke controle in het runbook en hermeting bij wijziging. Het linking domain,
  indien beschikbaar, maakt de bescherming tegen e-mailkoppeling onafhankelijk van die drift.

## Referenties

- Karakterisering en ontwerp: `MICROSOFT-365-LOGIN-F1B-ONTWERP.md`
- Supabase Auth-bron (master, 2026-09-05): `internal/api/provider/oidc.go`, `internal/models/linking.go`,
  `internal/conf/configuration.go` (`ProviderLinkingDomains`), `internal/api/external.go`,
  `internal/api/identity.go` (`linkIdentityToUser`), `internal/api/token_oidc.go`
  (`IdTokenGrant`: `link_identity`, `issueRefreshToken(..., models.OAuth)`, issuer-prefix, nonce-sha256),
  `internal/hooks/v0hooks/v0hooks.go` (`CustomAccessTokenInput`)
- Supabase docs: Custom Access Token Hook (input, foutobject, `token_refresh`), CLI-config
  (`auth.hook.custom_access_token`, `auth.jwt_expiry`, `auth.enable_manual_linking`)
- Advisory: GHSA-v36f-qvww-8w8m (supabase/gotrue < 2.185.0, gepatcht 2.185.0)
- Microsoft: ID-token-claimreferentie; optional claims reference (`acct`, `xms_edov` vereist `email`)
- Eerdere besluiten: 0208, 0209, 0210; patroon `2026_09_04_microsoft_fase1_connectorfundament.sql`
