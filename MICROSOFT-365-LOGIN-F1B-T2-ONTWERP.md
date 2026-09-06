# Microsoft 365 — fase 1B, tranche T2 / PR-B: inventarisatie, karakterisering en uitvoerbaar ontwerp

- **Ticket:** [#335](https://github.com/merlinijzerman/Bestuurdersportaal/issues/335)
- **Bron:** `MICROSOFT-365-LOGIN-F1B-ONTWERP.md` en `decisions/0211-…` op `feat/335-microsoft-login` (commit `15b7f56`); spike `SPIKE-335-T0.5.md`; T1-stand `origin/feat/335-microsoft-login-t1` `a104af3` (draft-PR #338) plus de op 2026-09-06 nog ongepushte werkboom `mvp-335-t1` (alleen gelezen)
- **Branch:** `feat/335-t2-voorbereiding` vanaf `origin/preview` `56efa65` (merge #336)
- **Status:** voorbereiding; **geen productiecode, geen migraties, geen configuratie, geen featureflag**
- **Datum:** 2026-09-06
- **Blokkades vóór merge/activering van T2:** spike **S7** (negatieve e-mailkoppeling, drie runs) staat open en is blokkerend; T1/PR-A moet gereviewd en gemerged zijn; de T1↔T2-contracten in §4 zijn een **voorstel** tot de T1-uitvoerder ze bevestigt.

Dit document maakt T2 uitvoerbaar zodra T1 gereviewd is. §1 inventariseert de keten die T2 raakt, §2 legt het huidige gedrag vast (karakterisering vóór wijziging), §3 is het uitvoerbare T2-ontwerp, §4 de contractvoorstellen naar T1, §5 de testmatrix, §7 het stappenplan en §8 de contractvragen. Het Preview-smokeplan voor PGB staat apart in `security/MICROSOFT-365-F1B-PGB-SMOKEPLAN.md` (§6 verwijst).

---

## 1. Inventarisatie van de te raken keten (stand `origin/preview` 56efa65)

Alle paden relatief aan de repo-root. Regelnummers zijn van 2026-09-06.

### 1.1 Wachtwoordlogin

| Onderdeel | Pad | Gedrag |
|---|---|---|
| Tenant-loginpagina | `app/login/page.tsx` (client) | `signInWithPassword` rechtstreeks via de **browserclient** (`:17-20`); geen server action, geen API-route. Eén generieke melding `Inloggen mislukt. Controleer uw e-mailadres en wachtwoord.` (`:23`). Na succes `window.location.replace("/")` (`:29`): één volledige navigatie, **geen `next`-parameter**. Teksten: `Bestuurdersportaal`, `Log in op uw bestuurdersomgeving`, labels `E-mailadres`/`Wachtwoord`, knop `Inloggen`/`Inloggen...`. Leest `?error=auth_callback` **niet** uit. |
| Login-layout | `app/login/layout.tsx` | `robots: index false`; sessie **mét** `profielen`-rij → `redirect("/")`; platform-identiteit (geen rij) blijft op de login (voorkomt redirectlus). |
| Platform-login | `app/(platform)/platform/login/page.tsx` | Eigen wachtwoord→MFA-pad (`handleWachtwoord` `:72-93`); `?fout=geen_toegang` logt het account uit (`:46-47`); `?mfa=1` start de MFA-stap. Eigen meldingen (`Inloggen mislukt. Controleer e-mailadres en wachtwoord.` e.a.). |
| Veilig vervolgpad | `core/lib/redirect-veilig.ts:38-44` | `veiligVervolgpad(ruw)`: alleen een relatief pad met precies één leidende `/`; anders `"/"`. Getest in `core/lib/redirect-veilig.test.ts`. Enige aanroeper: `/auth/callback`. |

### 1.2 Auth-callbacks (`app/auth/**`, precies twee routes)

| Route | Gedrag |
|---|---|
| `app/auth/callback/route.ts` | `GET`: `code` → `exchangeCodeForSession` → `redirect(origin + veiligVervolgpad(next))`; anders `redirect(origin + "/login?error=auth_callback")`. Buiten de middleware-matcher. Doet **niets** met identiteiten (L4 is dus nieuw gedrag). |
| `app/auth/microsoft/callback/route.ts` | Graph-connector (fase 1): erkende OAuth-uitzondering buiten `withFondsRoute`; herleidt de gebruiker uit de bestaande sessie + eenmalige private transactie; fallback `/profiel?microsoft=fout`, `Cache-Control: no-store`; foutcategorieën via `microsoftKoppelfoutcategorie`. |

Niet aanwezig: signout-route, magic-link/OTP-route, wachtwoordreset, `app/(auth)`-groep.

### 1.3 Sessieopbouw en refresh

| Onderdeel | Pad | Gedrag |
|---|---|---|
| Server-client | `core/lib/supabase-server.ts` | `createServerClient` met `getAll`/`setAll`; `setAll` slikt schrijffouten in Server Components (`try/catch`). Gevolg: **een ververste sessie wordt server-side niet altijd teruggeschreven**. |
| Browserclient | `core/lib/supabase.ts` | `createBrowserClient` zonder opties: autoRefresh aan. **De refresh gebeurt in de browser**; de server leest de nieuwe cookie bij het volgende request. |
| Middleware | `middleware.ts` | Alleen host→surface-routing (`bepaalSurface`/`bepaalRoute`), **bewust geen sessie-/DB-check** (Edge). Matcher zondert `api` en `auth` uit; `/login` niet. Marketing `/login` → 307 naar app-login. |
| Anon-client | `core/lib/supabase-anon.ts` | cookieloos, alleen voor `resolve_tenant_host` en contact-RPC's. |

Voor T2 betekent dit: de Auth-hook (T1) draait bij élke tokenuitgifte, inclusief de browser-refresh; niet-`oauth`-uitgiftes moeten onaangeroerd blijven (hook keert terug vóór databaseraadpleging). De guard L3 mag niet op een refresh in de middleware leunen, want die is er niet.

### 1.4 `haalFondsSessie` en verwanten

| Functie | Pad | Contract |
|---|---|---|
| `haalFondsSessie(): Promise<FondsSessie>` | `core/lib/fonds-sessie.ts:25` | `FondsSessie = { userId; fondsId; rol: string \| null }`. Geen user → `redirect("/login")` (`:30`); geen `fonds_id` → `redirect("/login")` (`:38`). Aanroepers: `core/lib/module-gate-page.ts:34`, `core/lib/portaalcontext.ts:91`, `app/(dashboard)/ai/page.tsx:32`. |
| `haalProfiel(supabase, id)` | `core/lib/profiel.ts:30-48` | vier kolommen; elke fout → `null`. |
| Host→fonds | `core/lib/tenant-host.ts` (puur), `tenant-domains.ts` (RPC `resolve_tenant_host`, cache 60 s), `tenant-context.ts` (`haalFondsContext`, `tenantEnforceAan`, `beoordeelHostToegang`) | fail-closed; productie/preview altijd enforce (`tenant-enforce.ts:33-45`). |
| Route-hostguard | `core/lib/tenant-route-guard.ts:33-74` | `beoordeelRouteHostToegang` → `{toegestaan}`; anomalie-log `[TENANT-RESOLVE]`. |

Niet aanwezig: `haalSessie`.

### 1.5 `withFondsRoute` en `RouteSpecV1`

`core/lib/route-wrapper.ts`: `maakWithFondsRoute(deps)` (`:300`) → `withFondsRoute(spec, handler)`; productie-export `:533`. `WrapperDeps` (`:217-263`) is injecteerbaar (sanity zonder server); `echteDeps` laadt `tenant-route-guard`, `rate-limit` en `api-errors` **lazy**.

Volgorde en foutvormen: (1) auth → `{error:"Niet ingelogd"}` 401; (2) `haalProfiel`; (3) hostguard alleen bij `"afdwingen"` → `{error:"Dit webadres hoort niet bij uw fonds."}` 403; (3b) capability → `{error:"U heeft geen rechten voor deze actie."}` 403 onder `ENFORCE_CAPABILITY=on`; (3c) schema → `{error:"Ongeldige invoer."}` 400 onder `ENFORCE_SCHEMA=on`; (3d) ratelimit → 429; (4) handler, vangnet `{error:"Serverfout"}` 500; (3e) audit **na** de handler via `fn_schrijf_handeling` (`ENFORCE_AUDIT`, omgekeerde semantiek: uit = alleen observe).

`RouteSpecV1`-velden, alle verplicht: `capability`, `schema`, `hostGuard` (`"afdwingen" | "geen" | "route-eigen"`), `rateLimit`, `audit` (`{handeling}` | `"geen"`), optioneel `label`.

Erkende alternatieven en uitzonderingen: `tests/cross-tenant/route-mechanismen.expected.json` (12 uitzonderingen, 6 autorisatievormen, bevroren ontsnappingstellers). **De registergates scannen alleen `app/api`**; `app/auth/**` valt buiten élk register (zie §2.3, LK-10).

### 1.6 Layouts

| Layout | Pad | Sessiegedrag |
|---|---|---|
| Root | `app/layout.tsx` | geen sessiecontrole (fonts, preview-badge). |
| Tenant/dashboard | `app/(dashboard)/layout.tsx` | `!user` → `/login`; geen `profielen`-rij → `/login` (3b-blokkade); host↔fonds via `beoordeelToegang`; weigering = **inline pagina** `Geen toegang op dit adres` met twee vaste teksten (geen redirect: voorkomt lus). Daarna theming/manifest. |
| Login | `app/login/layout.tsx` | zie 1.1. |
| Platform (beveiligd) | `app/(platform)/platform/(beveiligd)/layout.tsx` | `!user` → `/platform/login`; geen actieve platformidentiteit → `/platform/login?fout=geen_toegang`; geen AAL2 → `/platform/login?mfa=1`. `huidigePlatformIdentiteit` weigert accounts **mét** `profielen`-rij. |
| Publiek | `app/(public)/layout.tsx` | geen sessiecontrole. |

### 1.7 Profielpagina

`app/(dashboard)/profiel/page.tsx` (client, 717 regels; strikt zelfbeheer `profile.manage.own` + RLS). Rendert `<MicrosoftKoppelingKaart/>` (`:288`) uit `_components/MicrosoftKoppelingKaart.tsx`, die `/api/microsoft/status` leest en **`null` rendert als `beschikbaar` false is** (fondsvlag verbergt de kaart). API: `app/api/profiel/route.ts` (`GET` `profile.view.own`, `PATCH` `profile.manage.own` + inline `requireCapability`, RPC `profiel_opslaan`, audit `profiel.eigen-wijzigen`). Capabilities `profile.view.own`/`profile.manage.own` gelden voor alle vier rollen (`core/lib/capabilities-map.ts`).

### 1.8 Uitloggen en foutafhandeling

- Tenant: `core/components/Sidebar.tsx:47-61` — `signOut()` **zonder scope** (Supabase-default `global`), `router.replace("/login")`, geen `refresh()`; wist de AI-sessiemarkering (besluit 0086).
- Platform: `app/(platform)/platform/_components/Uitloggen.tsx:11-17` — `signOut()` → `router.push("/platform/login")` + `router.refresh()`.
- Geen logout-route of -action.
- Foutgrenzen: alleen `app/(dashboard)/error.tsx`; geen `error.tsx` in login/platform/public, geen `not-found.tsx`, geen `global-error.tsx`. Middleware-404 is kaal.
- Centrale API-fouten: `core/lib/api-errors.ts` (`errorResponse`, `badRequest`, `rateLimited`, …); wrapper-teksten zijn het de-facto register (§1.5).

### 1.9 Centrale registers en gates

| Register | Pad | Gate |
|---|---|---|
| route-mechanismen | `tests/cross-tenant/route-mechanismen.expected.json` | `route-mechanismen.test.ts` (alleen `app/api`) |
| audit-handelingen | `tests/cross-tenant/audit-handelingen.expected.json` (99 labels) | `audit-handelingen.test.ts`; regenereren `node tests/karakterisering/w183-labels.mjs --apply` |
| authz-matrix | `tests/karakterisering/authz-matrix.expected.json` | `w7-autz-matrix.test.ts`, CI `run.mjs --authz` |
| audit-inventaris | `tests/karakterisering/audit-inventaris.json` | `audit-inventaris.test.ts` (vitest, titel-hash-pin in `scripts/verify-vitest-parity.mjs`) |
| allowlist-grants | `supabase/checks/allowlist-grants.tsv` (+ toelichting) | `2026_08_20_v3_grants_volledig.sql` in `scripts/cross-tenant-ci.sh` |
| snapshots W1 | `tests/karakterisering/__snapshots__/` (379) | `karakterisering.yml`, 3× `--verify`; alleen `/api/*` |
| uitgestelde opnames | `tests/karakterisering/uitgestelde-opnames.json` | `uitgestelde-opnames.test.ts` (besluit 0192: contractwaarde nooit voorspellen) |
| `npm run gates` | `scripts/gates.sh` | typecheck, sanity, lint:colors, migratie-mapindeling, `test:xtenant:ci` |

### 1.10 Te spiegelen patroon: Graph-connector (fase 1)

`core/lib/microsoft-connector.ts` bevat PKCE/state/nonce (`b64url`, `challenge` S256, `aad = m365:v1:<fonds>:<user>:<soort>`), de eenmalige versleutelde transactie (`vault.maakOAuthTransactie`/`consumeerOAuthTransactie`, 10 min), `koppelStap(categorie, …)` met vaste foutcategorieën en `voltooiKoppeling` (consumeer → ontsleutel → `acquireTokenByCode` → `microsoftIdentiteitGeldig` → `/me` → vault). Pure kernen: `microsoft-crypto-core.ts` (AES-256-GCM, injecteerbare sleutel), `microsoft-identity-core.ts`, `microsoft-config-core.ts`, `microsoft-connector-error-core.ts`, `microsoft-vault-config-core.ts`. **T2 importeert hier niets uit** (ontwerp §6.2), maar volgt exact deze structuur: één server-only orchestratiemodule met pure `-core`-modules ernaast.

Fondsvlag-patroon (drie lagen): server-side beschikbaarheidsfunctie → route antwoordt 404/`{beschikbaar:false}` zonder bestaan te lekken → UI rendert de knop niet.

Audit-patronen: wrapper-`fn_schrijf_handeling` (fonds/gebruiker uit `auth.uid()`), Microsoft-privé `registreerKoppelfout` (categorie, geen inhoud). `core/lib/audit-meta.ts` is fail-closed op onbekende sleutels maar kent geen expliciete "geen auth-tokens"-regel; T2 krijgt die als contracttest (§5, T2-C4).

### 1.11 Wat er vandaag NIET is (en T2 dus toevoegt of bewust laat liggen)

1. Geen sessie-refresh in de middleware; refresh is browsergedreven. (T2 laat dit zo.)
2. Geen `next`-afhandeling op de loginpagina; deeplink na login bestaat niet. (T2 voegt `next` alleen aan de Microsoft-start toe, via `veiligVervolgpad`; wachtwoordpad ongewijzigd.)
3. `/login?error=auth_callback` wordt niet getoond. (T2 voegt een neutrale meldingsblok toe voor `?fout=<categorie>`, en toont `error=auth_callback` daarbij **niet** anders dan vandaag; zie §3.9.)
4. Geen gate over `app/auth/**`. (T2-stap B0 dicht dit vóór de routes landen; §7.)
5. `login_gateway`-rol, `login_private`, hook: T1 (draft-PR #338, `origin/feat/335-microsoft-login-t1` `a104af3`; de werkboom `mvp-335-t1` liep op 2026-09-06 al vóór op die push, zie §4).
6. `security/MICROSOFT-365-F1B-RUNBOOK.md` bestaat op de T1-branch (`a104af3`): rollen, migratie, env, Supabase-volgorde (T3), App L, kill switch. T2 voegt daar het app-deel aan toe (routes, guard, herstelroute); het PGB-smokeplan in `security/MICROSOFT-365-F1B-PGB-SMOKEPLAN.md` volgt de volgorde van dat runbook §4.

---

## 2. Karakterisering vóór wijziging (in deze commit)

Doel: het gedrag dat T2 raakt is vastgelegd vóórdat er één regel wijzigt, in de harnassen die al draaien in de gates. Alles hieronder is groen op `56efa65`.

### 2.1 Toegevoegd

| Bestand | Harnas | Wat het pint |
|---|---|---|
| `tests/component/LoginPage.component.test.tsx` (4 tests) | vitest `component` (jsdom, RTL, axe) — draait in `security-baseline.yml` | Eén inlogmethode (geen Microsoft-knop/-link, precies één knop); labels/koppen; exacte generieke foutmelding en dat de ruwe Supabase-fout **niet** lekt; `signInWithPassword` met exact de ingevoerde waarden; laadtoestand `Inloggen...`; na succes precies één `window.location.replace("/")`; foutmelding wordt bij een nieuwe poging gewist; a11y (WCAG 2A/AA) van de kaart in rust en met fout. |
| `tests/cross-tenant/login-keten-karakterisering.test.ts` (20 tests, LK-1…LK-11) | `node:test` + tsx — draait in `test:xtenant`, `npm run gates`, `rls-cross-tenant.yml`, `g2-evidence.yml`, `nightly-fidelity.yml` | Bron-inspectie van login-pagina/-layout, `/auth/callback`, `haalFondsSessie`, server-client, middleware-matcher, dashboard- en platform-layout (exacte redirects en volgorde), uitloggen (scope-loos `signOut`), wrapper-401, **census van `app/auth/**` (precies twee routes)** en sha256-pins op zes kleine kernbestanden. Elke test is gelabeld **INVARIANT** (moet na T2 blijven gelden) of **BASISLIJN** (T2 wijzigt dit bewust en zet de assertie in dezelfde PR om). |
| `tests/karakterisering/uitgestelde-opnames.json` | W1-uitstelregister (besluit 0192) | Drie paginascenario's voor `/auth/callback` en `/login` die tegen een draaiende stack moeten worden **opgenomen, niet voorspeld** (zie 2.2). |

### 2.2 Dekking per gevraagd gedrag

| Gedrag | Bestaande dekking (vóór deze commit) | Toegevoegd | Nog open / waar |
|---|---|---|---|
| Wachtwoordlogin blijft werken | `tests/e2e/specs/tenantpoort.spec.ts:24-31` (echte UI-login) | Component: UI-contract + `signInWithPassword`-aanroep | — |
| Wachtwoordrefresh blijft werken | geen | LK-5/LK-5b leggen vast dat refresh browsergedreven is en de middleware geen sessie raakt | **Gedragstest** = T1-check-SQL (hook: `password`/`token_refresh` zonder `amr oauth` → event onaangeroerd) + smoke S10c; een klokgedreven refreshtest is bewust niet gebouwd (geen stabiele snapshot; §5 T2-E3 doet het in Playwright) |
| Redirects na login | e2e `tenantpoort` (UI → `/`), `redirect-veilig.test.ts` (pure filter) | LK-1 (`window.location.replace("/")`, geen `next`), LK-3 (callback-redirects) | W1-opname `/auth/callback` (uitgesteld, 2.3) |
| Gebruiker zonder fonds | `host-enforce.test.ts` T3, `platform-toegang.spec.ts:30-34`, `route-wrapper.sanity.ts:109-121` | LK-4 (`!profiel?.fonds_id` → `/login`), LK-6 (geen profiel → `/login`) | — |
| Verkeerd fonds / cross-tenant | `tenantpoort.spec.ts:43-56`, `host-enforce.test.ts`, `2026_07_08_t3_cross_tenant.sql` | LK-6 exacte mismatch-teksten en "inline, geen redirect" | — |
| Verlopen sessie | geen (127 anon-401-snapshots dekken *niet-ingelogd*, niet *verlopen*) | LK-5 (best-effort cookieschrijven) | Playwright T2-E3 (cookie afkappen → `/login`, API → 401) in de T2-PR |
| Uitloggen | `Sidebar.component.test.tsx:44-65`, `tenantpoort.spec.ts:33-37` | LK-8 (beide knoppen, scope-loos) | — |
| Login-UI en foutmeldingen | alleen labels via Playwright | Component (volledig), LK-1/LK-1b/LK-7b | — |

### 2.3 Uitgestelde W1-opnames (paginaroutes)

Het W1-harnas kent alleen `/api/*`-scenario's; `run.mjs` volgt geen redirects en heeft `verwacht: "redirect"` + `locatieVorm()` al klaar. De drie rijen hieronder zijn klaar om in `scenarios.mjs` te plakken en met `--record` op te nemen tegen de wegwerpstack (de lokale stack was op 2026-09-06 door een andere sessie bezet en is daarom niet gebruikt). Ze staan in `uitgestelde-opnames.json` onder `nog_op_te_nemen_bij_stackrun`, zodat de lacune machineleesbaar is.

```js
// T2-voorbereiding (#335): het wachtwoord-/callbackpad byte-identiek houden (ontwerp §6.13).
{ slug: "w335.auth-callback.get.anon.zonder-code",  method: "GET", path: "/auth/callback",                 rol: "anon", verwacht: "redirect" }, // → <origin>/login?error=<geredigeerd>
{ slug: "w335.auth-callback.get.anon.ongeldige-code", method: "GET", path: "/auth/callback?code=ongeldig&next=%2Fprofiel", rol: "anon", verwacht: "redirect" }, // exchange faalt → zelfde redirect
{ slug: "w335.login.get.anon",                      method: "GET", path: "/login",                         rol: "anon", verwacht: "vorm" },     // 200 text/html; body bewust niet gekarakteriseerd
```

Let op bij opname: `/login` met een **ingelogde** rol geeft een 307 naar `/` (login-layout); dat scenario is óók zinvol maar de harnasseed heeft geen "sessie zonder profiel"-gebruiker; die fixture is een kleine seed-uitbreiding (vijfde gebruiker zonder `profielen`-rij) en hoort bij dezelfde stack-run.

---

## 3. Uitvoerbaar T2-ontwerp

Uitgangspunten uit T0 (ongewijzigd): route B (eigen OIDC-flow), Supabase alleen sessie-uitgever, hook L1 primair (T1), guard L3 secundair zonder cache, L4 in `/auth/callback`, geen `email`-scope, `acct = 0` verplicht, binding op `tid + oid` met `sub`-kruiscontrole.

### 3.1 Componenten en bestanden (nieuw in T2)

| Bestand | Soort | Inhoud |
|---|---|---|
| `core/lib/microsoft-login-config.ts` | server-only | env `MICROSOFT_LOGIN_TENANT_ID/CLIENT_ID/CLIENT_SECRET`, `MICROSOFT_LOGIN_ENCRYPTION_KEY/KEY_VERSION`; `MICROSOFT_LOGIN_SCOPES = ["openid","profile"] as const`; `callbackUrlVoorHost(host)` (§3.3). Fail-closed: gooit bij ontbrekende env; **geen** import uit `microsoft-config*`. |
| `core/lib/microsoft-login-oidc-core.ts` | puur | `bouwAuthorizeUrl({tenantId, clientId, redirectUri, state, nonceHash, codeChallenge})` (exact `openid profile`, `response_type=code`, `response_mode=query`, `code_challenge_method=S256`, `prompt` afwezig), `bouwTokenRequestBody(...)`, `weigerRefreshToken(tokenResponse)`, `discoveryUrl(tid)`, `jwksHostToegestaan(url)`, `kiesJwk(jwks, kid)` (exact één `kid`, `alg` RS256). Getest met contracttests op de letterlijke querystring. |
| `core/lib/microsoft-login-identity-core.ts` | puur | `valideerIdToken(claims, {tenantId, clientId, nonce, nu}) → { ok: true, identiteit: {tid, oid, sub} } \| { ok: false, categorie }`: `iss` exact `https://login.microsoftonline.com/<tid>/v2.0`, `aud`, `exp > nu`, `ver === "2.0"`, `nonce === sha256(N)`, `tid === tenantId && tid !== MSA`, `oid`/`sub` niet-leeg en GUID-vorm (`isGeldigeIdentiteitsvorm` uit T1-core), `idp` afwezig of `=== iss`, `acct` aanwezig en `0`. MSA-tenant `9188040d-6c67-4c5b-b112-36a304b66dad` als constante. |
| `core/lib/microsoft-login-crypto-core.ts` | puur | AES-256-GCM met injecteerbare sleutel, AAD-prefix `m365login:v1:<fonds>:<user\|->:<intent>`; eigen module (geen hergebruik van de connector-kluis, D7). |
| `core/lib/microsoft-login-error-core.ts` | puur | `MICROSOFT_LOGIN_FOUTCATEGORIEEN` (§3.9) en `microsoftLoginFoutcategorie(fout)`; `class MicrosoftLoginError`. |
| `core/lib/microsoft-login.ts` | server-only | orchestratie: `startInloggen`, `startKoppelen`, `voltooiCallback` (dispatch op `intent`), `ontkoppel`, `herstelKoppeling`. Gebruikt uitsluitend de T1-gateway (§4). |
| `core/lib/microsoft-login-sessieguard-core.ts` | puur | `sessieIsOAuth(claims)` (`amr` bevat `{method:"oauth"}`), `beoordeelBindingGuard({isOAuth, binding}) → {toegestaan} \| {toegestaan:false, reden}`. |
| `core/lib/microsoft-login-sessieguard.ts` | server-only | `guardOAuthSessie(supabase, user) → Promise<GuardOordeel>`: leest `amr` uit het access-token van de sessie (`getSession().session.access_token`, decode zonder verificatie — de server heeft het token net van GoTrue), roept **alleen bij `oauth`** `levendeBinding(user.id)` via de gateway aan; `active` → toegestaan; anders `signOut({scope:"local"})` op de server-client en oordeel `beeindigd`. **Zonder cache.** |
| `app/auth/microsoft-login/start/route.ts` | route (OAuth-uitzondering) | `GET ?next=` → inlogflow (§3.4). |
| `app/auth/microsoft-login/callback/route.ts` | route (OAuth-uitzondering) | `GET ?code&state` (en `?error`) → §3.5/§3.6. |
| `app/api/microsoft-login/koppelen/start/route.ts` | `withFondsRoute` | `GET`, `capability: "profile.manage.own"`, `hostGuard: "afdwingen"`, `schema: "geen-body"`, `rateLimit: "nog-niet-beoordeeld"` (of nieuwe limiet, §8 V9), `audit: {handeling:"microsoft-login.koppeling.starten"}`. |
| `app/api/microsoft-login/koppeling/route.ts` | `withFondsRoute` | `GET` status (`profile.view.own`, `audit:"geen"`), `DELETE` ontkoppelen (`profile.manage.own`, `audit:{handeling:"microsoft-login.koppeling.intrekken"}`), `POST` herstel (`profile.manage.own`, `audit:{handeling:"microsoft-login.koppeling.herstellen"}`). Alle `hostGuard: "afdwingen"`, `Cache-Control: no-store`. |
| `app/(dashboard)/profiel/_components/MicrosoftLoginKaart.tsx` | UI | §3.8. |
| `app/login/page.tsx`, `app/login/_components/MicrosoftLoginKnop.tsx` | UI | §3.7. |
| Wijzigingen | `app/(dashboard)/layout.tsx`, `core/lib/fonds-sessie.ts`, `core/lib/route-wrapper.ts` (+ `WrapperDeps`), `app/login/layout.tsx`, `app/(platform)/platform/(beveiligd)/layout.tsx`, `app/auth/callback/route.ts` | guard L3 en L4 (§3.6, §3.10). |
| Registers | `route-mechanismen.expected.json`, `audit-handelingen.expected.json`, `authz-matrix`, `uitgestelde-opnames.json`, `allowlist-grants.tsv` (alleen als T2 iets aan grants zou wijzigen — niet voorzien) | §7 B0/B8. |

### 3.2 PKCE, `state` en `nonce`

- Per start: `state = b64url(32)`, `nonce N = b64url(32)`, `verifier = b64url(64)`, `code_challenge = base64url(sha256(verifier))`.
- Naar Entra gaat **`nonce = hex(sha256(N))`**, zodat het ID-token de sha256 draagt (GoTrue vergelijkt bij `signInWithIdToken({nonce: N})` met `sha256(N)`; onze eigen `valideerIdToken` doet dezelfde vergelijking).
- Server-side transactie via de gateway: `maakTransactie({ stateHash: sha256(state), fondsId, userId (koppelen) | null (inloggen), intent, verlooptOp: nu+10min, blob })`, met `blob = versleutel(JSON {N, verifier, next, host}, aad)`. **Geen cookie**, geen `state`/`nonce` in logs.
- Callback: `consumeerTransactie(sha256(state))` is atomair en eenmalig (`gebruikt_op`, `verloopt_op > now()`); `null` → categorie `transactie_ongeldig`. Replay is daarmee per constructie dood (R-31).
- `redirect_uri` in de tokenrequest is exact de waarde die in de transactie-blob staat (afgeleid uit de host bij start); mismatch → Entra weigert; wij toetsen daarnaast `host` van de callback tegen de blob (open-redirect via hostwissel uitgesloten).

### 3.3 Redirect-URI en fonds uit de host

`callbackUrlVoorHost(host)`: normaliseer host (`normaliseerHost`), eis een **actieve `tenant_domains`-rij** via `haalFondsContext(host)` (`gevonden`), bouw `https://<host>/auth/microsoft-login/callback`. Lokaal (`SEED_DOELOMGEVING=local` én loopback) mag `http://`. Het fonds van de flow is **altijd** het host-fonds; bij koppelen moet dat gelijk zijn aan `profiel.fonds_id` (anders `fonds_mismatch`, ook door `reserveer_identiteit` in de DB afgedwongen).

### 3.4 Inloggen (start → callback), fail-closed volgorde

Start `GET /auth/microsoft-login/start?next=`:
1. host → fonds (`gevonden`, anders 404 neutraal).
2. `microsoftLoginActief(fondsId)` (T1-gateway) → `{actief:false}` → 404 `{error:"Deze inlogmethode is niet beschikbaar."}` (bestaan niet lekken; zelfde vorm als de Graph-connector).
3. Bestaande sessie mét profiel? → `redirect("/")` (zelfde regel als de login-layout; geen dubbele login).
4. `veiligVervolgpad(next)`; transactie `intent:"inloggen"`, `userId:null`.
5. 302 naar Entra; `Cache-Control: no-store`.

Callback `GET /auth/microsoft-login/callback?code&state` (intent `inloggen`):
1. `error`-param aanwezig → `redirect(/login?fout=geweigerd)`; niets loggen behalve categorie.
2. `consumeerTransactie` → `null` → `/login?fout=ongeldig`.
3. Ontsleutel blob; hostcontrole.
4. Tokenrequest (fetch naar `https://login.microsoftonline.com/<tid>/oauth2/v2.0/token`, `client_secret`, `code_verifier`); response bevat `refresh_token` → **weigeren** (`token_response_ongeldig`); scopes anders dan `openid profile` → weigeren.
5. Discovery + JWKS (alleen `login.microsoftonline.com`), RS256, exact één `kid`; handtekening verifiëren (`jose` of `node:crypto` `verify`; §8 V10).
6. `valideerIdToken` → `{ok:false}` → `/login?fout=geweigerd` (categorie intern gedetailleerd, extern neutraal).
7. `zoekIdentiteit({tid, oid})` → `null` → `/login?fout=geen_koppeling` (**zonder** onderscheid tussen "onbekend", "pending", "revoked": alle drie `null`).
8. `binding.fondsId === hostFondsId`, anders `/login?fout=geen_koppeling`.
9. `signInWithIdToken({provider:"azure", token: idToken, nonce: N})` op de **server-client** (cookies via `setAll` in een Route Handler — dat kan wél, anders dan in een Server Component). Hook L1 weigert (403) → `/login?fout=geen_koppeling`.
10. `user.id === binding.userId` en `provider_id === sub` (uit `user.identities`), anders `signOut({scope:"local"})` + `/login?fout=geweigerd` + audit `inloggen.geweigerd/identiteit_mismatch`.
11. Profiel via RLS-client; `profiel.fonds_id === hostFondsId`, anders signOut + `/login?fout=geen_koppeling` (R-34: platformaccount of profiel-loos).
12. `markeerGebruikt(binding.id)`; audit `inloggen.geslaagd`; `redirect(origin + next)`.

### 3.5 Koppelen (start → callback), fail-closed volgorde

Start `GET /api/microsoft-login/koppelen/start` (`withFondsRoute`, `profile.manage.own`, hostguard afdwingen):
1. `ctx.fondsId` aanwezig; `microsoftLoginActief(ctx.fondsId)` anders 404 neutraal.
2. `levendeBinding(ctx.gebruikerId)`: `active`/`revoking` → 409 `{error:"Er is al een Microsoft-koppeling."}`; `pending` (niet verlopen) → 409 idem (de gebruiker kan de callback afmaken of wachten tot verval).
3. Transactie `intent:"koppelen"`, `userId: ctx.gebruikerId`, `next` vast `/profiel`.
4. 302 naar Entra.

Callback (intent `koppelen`):
1-6. als bij inloggen (fouten → `/profiel?microsoft_login=fout&c=<categorie>`; neutrale meldingen §3.9).
7. Sessie aanwezig en `user.id === tx.userId` (de koppelaar is nog ingelogd met wachtwoord), anders `sessie_mismatch`.
8. Profiel: `fonds_id === tx.fondsId === hostFondsId`.
9. `reserveerIdentiteit({fondsId, userId, identiteit:{tid,oid,sub}, correlatieId})` → `binding_conflict` (identiteit al gebonden aan een ander account of account heeft al levende binding) / `fonds_mismatch` → neutrale melding; audit door de DB.
10. `linkIdentity({provider:"azure", token: idToken, nonce: N})` op de server-client met de huidige sessie. Hook L1 staat toe op grond van de `pending` met exact deze `sub/tid/oid`. Faalt → `markeerMislukt({bindingId, userId, categorie:"link_geweigerd"})`; er is dan geen identiteit (transactie teruggerold, S3a/S3a').
11. Verifieer: nieuwe sessie `user.id === tx.userId`; `identities` bevat precies één `azure` met `provider_id === sub`. Anders `markeerMislukt(...,"identiteit_mismatch")` + `signOut({scope:"global"})` (de gelinkte sessie is `oauth`; zonder activering weigert de hook toch bij de volgende refresh).
12. `activeerIdentiteit({bindingId, userId, sub})`; redirect `/profiel?microsoft_login=gekoppeld`.
13. Crash tussen 10 en 12: de kaart toont bij `pending` met bestaande `azure`-identiteit de knop **Koppeling herstellen** → `POST /api/microsoft-login/koppeling` → `herstelKoppeling` (idempotent, §4.3).

Na 10 is de portaalsessie een `oauth`-sessie (`amr ∋ oauth`); L1 en L3 gelden vanaf dat moment.

### 3.6 Secundaire guards (L3) en L4

Eén pure beslisser (`beoordeelBindingGuard`) en één server-helper (`guardOAuthSessie`), aangeroepen op elk chokepoint **direct na `auth.getUser()` en vóór profiel/host-logica**:

| Chokepoint | Invoegpunt | Gedrag bij `oauth` zonder `active` |
|---|---|---|
| `app/(dashboard)/layout.tsx` | na regel 22 (`if (!user) redirect("/login")`) | `signOut` (server) → `redirect("/login?fout=geen_koppeling")` |
| `core/lib/fonds-sessie.ts` | na `if (!user) redirect("/login")` | idem |
| `core/lib/route-wrapper.ts` | nieuwe dep `beoordeelOAuthSessie` in `WrapperDeps`; na stap 1 (auth) en vóór `haalProfiel` | `NextResponse.json({error:"Niet ingelogd"}, {status:401})` — **dezelfde vorm als geen sessie**, zodat 127 anon-snapshots én het 401-contract onaangeroerd blijven; `Set-Cookie` voor uitloggen via de server-client |
| `app/login/layout.tsx` | na `getUser()` | `oauth` zonder `active` → **niet** naar `/` (blijf op login, sessie beëindigen); mét `active` en profiel → `/` |
| `app/(platform)/platform/(beveiligd)/layout.tsx` | na `if (!user)` | `oauth` → altijd `redirect("/platform/login?fout=geen_toegang")` (R-34: platformaccounts loggen nooit via Microsoft in) |
| `app/auth/callback/route.ts` (L4) | na succesvolle `exchangeCodeForSession` | `user.identities` bevat `azure` en `levendeBinding(user.id)` is niet `active` → `unlinkIdentity(azure)` + `signOut` + `redirect(/login?error=auth_callback)`; wachtwoordsessies passeren zonder gateway-aanroep |

Regels: wachtwoordsessies (`amr` zonder `oauth`) passeren **zonder** gateway-aanroep (§6.11 ontwerp; byte-identiek voor W1). De guard leest `amr` uit het access-token van de eigen sessie; hij verifieert de JWT niet zelf (GoTrue deed dat), maar gebruikt hem uitsluitend om te beslissen of de gateway moet worden geraadpleegd; de gateway is de bron. Een gateway-fout (`gateway_db_onbereikbaar`) bij een `oauth`-sessie is **fail-closed** (beëindigen), nooit fail-open.

### 3.7 Microsoft-knop op het loginscherm

- `app/login/layout.tsx` (server) leest host → fonds → `microsoftLoginActief(fondsId)` en geeft `microsoftLogin: {actief: boolean}` als prop door aan een server-gerenderde knop-slot; de client-`LoginPage` blijft ongewijzigd in gedrag voor het wachtwoordpad. Alternatief zonder prop-drilling: `app/login/page.tsx` wordt een server component die `LoginForm` (client, huidige code) en `MicrosoftLoginKnop` rendert. **Voorkeur:** dit alternatief; de componenttest verhuist dan mee naar `LoginForm` (BASISLIJN LK-1b omzetten).
- Knop: `<a href="/auth/microsoft-login/start">Inloggen met Microsoft</a>` (geen `next`, tenzij de layout er een veilig pad voor heeft), onder de wachtwoordkaart met een scheidingsregel "of". Bij `actief:false` wordt de knop **niet gerenderd** (geen verborgen element).
- Meldingsblok boven het formulier voor `?fout=` (§3.9); het bestaande `?error=auth_callback` blijft ongetoond zoals vandaag (BASISLIJN LK-1b), tenzij de opdrachtgever kiest voor één neutrale melding voor beide (§8 V11).

### 3.8 Koppel-/ontkoppelbediening op de profielpagina

`MicrosoftLoginKaart.tsx` (naast de bestaande Graph-`MicrosoftKoppelingKaart`, bewust gescheiden — twee vertrouwensdomeinen):

- `GET /api/microsoft-login/koppeling` → `{beschikbaar:false}` (kaart rendert `null`) of `{beschikbaar:true, status: "geen" | "pending" | "active" | "revoking", geactiveerdOp, laatstGebruiktOp, herstelMogelijk: boolean}`. Nooit `tid`/`oid`/`sub`/e-mail; alleen `identiteitReferentie: sha256(tid:oid).slice(0,8)` ter herkenning in support.
- `geen` → knop **Koppel Microsoft-account** (`GET …/koppelen/start`, volledige navigatie).
- `active` → **Ontkoppelen** met `confirm()`; `DELETE` → `startIntrekking` → `unlinkIdentity` → `voltooiIntrekking`. Tekst na succes: `Microsoft-login is ontkoppeld. U blijft ingelogd met uw wachtwoord.` Let op: zit de gebruiker in een `oauth`-sessie, dan beëindigt de guard die bij de volgende request; de kaart zegt dat vooraf ("U wordt uitgelogd als u nu met Microsoft bent ingelogd").
- `revoking` (unlink mislukt) → **Opnieuw proberen** (`DELETE` idempotent).
- `pending` + `herstelMogelijk` → **Koppeling herstellen** (`POST`); `pending` zonder identiteit → tekst "Koppelen is nog niet afgerond; probeer over tien minuten opnieuw".
- UX-principe: blokkers expliciet vooraf (fonds zonder Microsoft-login → kaart afwezig; account met platformrol → niet van toepassing).

### 3.9 Neutrale foutmeldingen (geen accountinformatie)

Interne categorieën (`microsoft-login-error-core.ts`), extern **maximaal drie** teksten op het loginscherm en drie op de profielkaart. Geen enkele tekst onderscheidt "account bestaat niet", "andere tenant", "gast", "ingetrokken" of "pending".

| Interne categorie | Waar | Externe melding |
|---|---|---|
| `config_ontbreekt`, `gateway_db_onbereikbaar`, `gateway_fout`, `discovery_fout`, `jwks_fout` | login | `Inloggen met Microsoft is tijdelijk niet beschikbaar. Probeer het later opnieuw of log in met uw wachtwoord.` |
| `transactie_ongeldig`, `state_verlopen`, `host_mismatch`, `token_exchange`, `token_response_ongeldig`, `handtekening_ongeldig`, `claim_iss`, `claim_aud`, `claim_exp`, `claim_ver`, `claim_nonce`, `claim_tid`, `claim_msa`, `claim_idp`, `claim_acct`, `claim_oid_sub`, `geweigerd_door_gebruiker`, `identiteit_mismatch`, `hook_geweigerd` | login | `Inloggen met Microsoft is niet gelukt. Log in met uw wachtwoord of neem contact op met uw beheerder.` |
| `binding_ontbreekt`, `fonds_mismatch`, `profiel_ontbreekt` | login | dezelfde tekst als hierboven (bewust: geen orakel) |
| `binding_conflict`, `login_uit`, `tenant_mismatch`, `fonds_mismatch`, `sessie_mismatch`, `link_geweigerd`, `identiteit_mismatch`, `activering_mislukt` | profiel | `Koppelen is niet gelukt. Controleer of dit Microsoft-account al aan een ander portaalaccount is gekoppeld, of neem contact op met uw beheerder.` — **let op:** de zinsnede over "ander portaalaccount" is de enige informatie die wordt gegeven en geldt voor élke categorie in deze rij, dus zij onthult niets over de werkelijke oorzaak |
| `pending_verlopen` | profiel | `De koppeling is verlopen. Start het koppelen opnieuw.` |
| `unlink_mislukt` | profiel | `Ontkoppelen is nog niet afgerond. Probeer het opnieuw.` |

De URL draagt alleen `?fout=<a|b|c>` (drie letters), niet de interne categorie; de interne categorie gaat naar de audit en de runtime-log als `[MICROSOFT-LOGIN] <fase> mislukt: <categorie>` met de correlatie-id, die de gebruiker als **supportcode** te zien krijgt (`Supportcode: <8 tekens>`).

### 3.10 Auditmomenten (inhoudsvrij)

Via `registreerGebeurtenis` (T1-gateway, tabel `login_private.audit_log`), plus de DB-eigen gebeurtenissen die de gatewayfuncties zelf schrijven. Velden: `fonds_id`, `user_id` (null als onbekend), `gebeurtenis`, `foutcategorie`, `identiteit_hash = sha256(tid:oid)`, `correlatie_id`. **Nooit** tokens, codes, `state`, `nonce`, claims, e-mail, `preferred_username`, `name`, ruwe providerfouten.

| Moment | `gebeurtenis` | Bron |
|---|---|---|
| start inloggen / koppelen | `inloggen.gestart` / `koppelen.gestart` | T2 |
| reservering, activering, herstel, mislukking | `koppelen.gereserveerd` / `.geactiveerd` / `.hersteld` / `.mislukt` | T1 (DB) |
| inlog geslaagd / geweigerd | `inloggen.geslaagd` / `inloggen.geweigerd` (+ categorie) | T2 |
| intrekking | `ontkoppelen.gestart` / `.voltooid` | T1 (DB); `ontkoppelen.unlink_mislukt` T2 |
| guard L3 beëindigt sessie | `sessie.beeindigd_zonder_binding` | T2 |
| L4 opschoning | `callback.identiteit_verwijderd` | T2 |
| configwijziging | `config.aangemaakt/gewijzigd/verwijderd` | T1 (trigger) |

Daarnaast het wrapper-handelingsspoor (`handelingen_log`) voor de drie `withFondsRoute`-routes met labels `microsoft-login.koppeling.starten`, `.intrekken`, `.herstellen` (register `audit-handelingen.expected.json`). De twee `app/auth/**`-routes hebben géén wrapper-audit; hun spoor is `login_private.audit_log` (§7 B0 legt dat in het register vast als erkende uitzondering met reden).

---

## 4. T1↔T2-contracten (voorstel; T1-branch niet aangepast)

Afgestemd op de **ongecommitte T1-werkstand van 2026-09-06** in `mvp-335-t1` (`core/lib/microsoft-login-gateway.ts`, `-binding-core.ts`, `-gateway-config-core.ts`, migratie `2026_09_06_microsoft_login_fase1b.sql`). Afwijkingen ten opzichte van T0 §4.2 zijn gemarkeerd; alles hier is een voorstel tot de T1-uitvoerder bevestigt (§8).

### 4.1 TypeScript-gateway (`core/lib/microsoft-login-gateway.ts`, server-only)

| Functie | Invoer | Uitvoer | Opmerking |
|---|---|---|---|
| `leesConfig(fondsId)` | `string` | `LoginConfig \| null` = `{actief, entraTenantId: string\|null, pilotstatus}` | |
| `microsoftLoginActief(fondsId)` | `string` | `{actief:true, entraTenantId} \| {actief:false}` | strikte poort; T2 gebruikt uitsluitend deze voor knop/route |
| `reserveerIdentiteit({fondsId, userId, identiteit:{tid,oid,sub}, correlatieId})` | | `Promise<string>` (bindingId) | gooit `MicrosoftLoginGatewayError` met `fonds_mismatch` / `binding_conflict`, en in de **T1-werkstand van 2026-09-06 (nog niet gepusht)** ook `login_uit` (fondsflag uit of configrij ontbreekt) en `tenant_mismatch` (`tid` ≠ `entra_tenant_id`, hoofdletterongevoelig) — de DB weigert dus zelf al een koppeling bij flag-uit of andere tenant; vormcontrole via `isGeldigeIdentiteitsvorm` |
| `activeerIdentiteit({bindingId, userId, sub})` | | `void` | **T0 zei `(id, user)`; T1 voegt `sub` toe** — T2 volgt T1 |
| `herstelKoppeling({bindingId, userId, sub})` | | `void` | idempotent (`active` → true) |
| `markeerMislukt({bindingId, userId, categorie})` | | `void` | alleen vanuit `pending` |
| `startIntrekking({fondsId, userId, doorUserId, correlatieId})` | | `Promise<string>` | idempotent bij `revoking` |
| `voltooiIntrekking({bindingId, userId, correlatieId})` | | `void` | idempotent bij `revoked` |
| `zoekIdentiteit({tid, oid})` | | `{id, userId, fondsId} \| null` | **alleen `active`** |
| `levendeBinding(userId)` | | `LevendeBinding \| null` (`status: pending\|active\|revoking`, tijdstippen) | **T0 noemde `actieve_binding`; T1 levert `levende_binding` met status** — T2's guard eist zelf `status === "active"` |
| `markeerGebruikt(bindingId)` | | `void` | alleen `active` |
| `maakTransactie({stateHash, fondsId, userId\|null, intent, verlooptOp, blob})` | | `void` | `blob = {sleutelVersie, iv, tag, ciphertext, aad}` |
| `consumeerTransactie(stateHash)` | | `Transactie \| null` | eenmalig, verlopen → `null` |
| `registreerGebeurtenis({fondsId, userId\|null, gebeurtenis, foutcategorie?, identiteitHash?, correlatieId})` | | `void` | append-only |

Fouttype: `MicrosoftLoginGatewayError { categorie: LoginGatewayFoutcategorie }` met categorieën `config_ontbreekt`, `fonds_mismatch`, `binding_conflict`, `ongeldige_overgang`, `onbekende_binding`, `pending_verlopen`, `gateway_db_onbereikbaar`, `gateway_fout`, plus (T1-werkstand, ongepusht) `login_uit` en `tenant_mismatch`. T2 mapt deze 1-op-1 naar §3.9.

Pure kern (`microsoft-login-binding-core.ts`): `BINDING_STATUSSEN`, `BINDING_OVERGANGEN`, `LEVENDE_STATUSSEN`, `isBindingStatus`, `magOvergang`, `isLevend`, `gatewayFoutcategorie`, `identiteitHash(tid, oid)`, `isGeldigeIdentiteitsvorm`. T2 importeert `identiteitHash` en `isGeldigeIdentiteitsvorm` uit deze module (geen duplicaat).

### 4.2 SQL-functies die `login_gateway` mag uitvoeren (exact 13, conform T1-check DEEL 1)

`lees_config(uuid)`, `reserveer_identiteit(uuid,uuid,text,text,text,text) → table(id, categorie)`, `activeer_identiteit(uuid,uuid,text) → boolean`, `herstel_koppeling(uuid,uuid,text) → boolean`, `markeer_mislukt(uuid,uuid,text)`, `start_intrekking(uuid,uuid,uuid,text) → uuid`, `voltooi_intrekking(uuid,uuid,text)`, `zoek_identiteit(text,text) → table(id,user_id,fonds_id)`, `levende_binding(uuid) → table(...)`, `markeer_gebruikt(uuid)`, `maak_transactie(text,uuid,uuid,text,timestamptz,integer,text,text,text,text)`, `consumeer_transactie(text) → table(...)`, `registreer_gebeurtenis(uuid,uuid,text,text,text,text)`.

Niet voor `login_gateway`: `identiteit_toegestaan` (alleen `supabase_auth_admin`), `verval_verlopen_reserveringen` (intern, via `reserveer_identiteit`), tabellen (geen enkel recht). T2 voegt **geen** SQL toe en vraagt geen extra execute.

### 4.3 Toegestane toestandsovergangen (DB is de autoriteit)

`pending → active` (activeer/herstel), `pending → failed` (markeer_mislukt, verval), `active → revoking` (start_intrekking), `revoking → revoked` (voltooi_intrekking). Eindtoestanden `revoked`/`failed` hebben geen uitgaande overgang; "vervangen" = ontkoppelen + opnieuw koppelen. `pending` verloopt na 10 minuten; verlopen pendings worden bij de volgende reservering naar `failed/pending_verlopen` gezet. Unieke levende binding per `(tid, oid)` en per `user_id`, over fondsen heen.

T2 raadpleegt `magOvergang` alleen als defence-in-depth vóór een databaseronde; de DB weigert met `ongeldige_overgang`/`onbekende_binding`.

### 4.4 Hook-contract (L1)

`public.fn_access_token_hook(event jsonb)`: niet-`oauth` → `event` ongewijzigd zonder databaseraadpleging; `oauth` (via `authentication_method` óf `claims.amr`) → precies één OAuth-identiteit, provider `azure`, `provider_id`/`custom_claims.tid`/`oid` exact gelijk aan een `active` of niet-verlopen `pending` binding, anders `{error:{http_code:403, message:"Microsoft-login is niet gekoppeld aan dit account."}}`; exceptie → 403 `"Microsoft-login kan nu niet worden gecontroleerd."`. T2 vertrouwt hierop voor `signInWithIdToken` en `linkIdentity` en vertaalt een 403 van GoTrue naar `hook_geweigerd`.

### 4.5 Omgevingsvariabelen (T2 leest, T3 zet)

`MICROSOFT_LOGIN_TENANT_ID`, `MICROSOFT_LOGIN_CLIENT_ID`, `MICROSOFT_LOGIN_CLIENT_SECRET`, `MICROSOFT_LOGIN_ENCRYPTION_KEY` (32 bytes base64), `MICROSOFT_LOGIN_KEY_VERSION`, `LOGIN_GATEWAY_DATABASE_URL`, `LOGIN_GATEWAY_CA_CERT_BASE64` (+ lokaal `LOGIN_GATEWAY_DB_SSL=uit` alleen met `SEED_DOELOMGEVING=local`). Ontbreekt iets → config gooit → knop verborgen, routes 404/503 neutraal.

---

## 5. Testmatrix T2

Kolommen: laag (**C** contract/bron-inspectie `node:test`; **S** sanity puur; **K** componenttest; **W** W1-snapshot; **E** Playwright; **D** DB-check-SQL T1; **P** Preview-smoke).

| # | Scenario | Verwacht | Laag |
|---|---|---|---|
| T2-1 | Gekoppelde gebruiker (`active`, juiste tenant, host-fonds = profiel-fonds) | login 200 → redirect `next`; `amr ∋ oauth`; `markeerGebruikt`; audit `inloggen.geslaagd` | E, P, S (flow met mock-gateway) |
| T2-2 | Niet-gekoppelde gebruiker (geldig ID-token, geen binding) | `zoekIdentiteit` null → `/login?fout=b`; **geen** `signInWithIdToken`-aanroep; audit `inloggen.geweigerd/binding_ontbreekt`; geen `auth.users`/`identities`-mutatie | S, E, P |
| T2-3 | Verkeerde tenant (`tid` ≠ env/fonds) of MSA-tenant | `valideerIdToken` → `claim_tid`/`claim_msa`; `/login?fout=b`; niets naar Supabase | S (`identity-core`), C (constante MSA) |
| T2-4 | Verkeerde identiteit: binding voor A, token voor B (zelfde tenant) | `zoekIdentiteit(B)` null → weigeren; en als een aanvaller toch `signInWithIdToken` zou bereiken: hook 403 (`D`) | S, D (T1 DEEL 2), P |
| T2-4b | `sub` ≠ `provider_id` na `signInWithIdToken` (kruiscontrole) | `signOut` + `/login?fout=b`; audit `identiteit_mismatch` | S |
| T2-5 | Ingetrokken binding (`revoking`/`revoked`) | `zoekIdentiteit` null; hook weigert refresh (403) binnen ≤ 600 s; guard L3 beëindigt bestaande portaalsessie direct | S, D, P (R-37) |
| T2-6 | Pending/herstel: crash tussen `linkIdentity` en `activeer` | kaart toont `Koppeling herstellen`; `POST` → `herstelKoppeling` → `active`; tweede `POST` idempotent | S, D (`herstel_koppeling`), E |
| T2-6b | Pending verlopen (> 10 min) zonder identiteit | `pending_verlopen` → `failed`; nieuwe reservering mogelijk | D, S |
| T2-7 | Callback replay (zelfde `code`+`state` tweemaal) | tweede `consumeerTransactie` null → `/login?fout=b`; geen tweede sessie; audit `transactie_ongeldig` | S, E |
| T2-8 | Verlopen `state` (> 10 min) / `nonce`-mismatch in ID-token | `state_verlopen` resp. `claim_nonce`; weigeren vóór Supabase | S |
| T2-9 | Microsoft-login **uit** voor het fonds (`actief=false` of `entra_tenant_id` leeg) | knop niet gerenderd; `/auth/microsoft-login/start` 404 neutraal; `/api/microsoft-login/*` 404 `{beschikbaar:false}`; bestaande bindingen blijven (bewust) | K, W (na opname), C |
| T2-10 | Wachtwoordfallback | wachtwoordlogin, refresh, `/auth/callback`, alle 127 anon-401's en het volledige W1-corpus **byte-identiek**; hook raakt `password`/`token_refresh` zonder `amr oauth` niet; guard doet **geen** gateway-aanroep | W (3× verify), D (S10c), C (LK-1…LK-9 INVARIANT), K |
| T2-11 | Directe routebenadering zonder geldige binding | `oauth`-sessie zonder `active`: dashboard → `/login?fout=b`; `haalFondsSessie` → idem; `withFondsRoute` → `{error:"Niet ingelogd"}` 401; login-layout → blijft op login; platform-layout → `?fout=geen_toegang`; PostgREST direct → 200 tot `exp`, refresh 403 | S (`sessieguard-core`), C, P |
| T2-C1 | Scopes exact `openid profile`; geen `offline_access`/`email`/Graph; `refresh_token` in response → weigeren | contracttest op `bouwAuthorizeUrl`/`bouwTokenRequestBody`/`weigerRefreshToken` | C, S |
| T2-C2 | Geen `fetch` naar `graph.microsoft.com`; geen import uit `microsoft-vault`/`-connector`/`-config`; geen `service_role`/`supabase-platform`; gateway en guard `server-only` | bron-inspectie over `core/lib/microsoft-login*` en `app/**/microsoft-login/**` | C |
| T2-C3 | JWKS/discovery alleen `https://login.microsoftonline.com`; RS256; exact één `kid` | S | S |
| T2-C4 | Geen `accessToken|idToken|refreshToken|email|preferred_username|state=|nonce=|code=` in log-/auditpaden; alle responses `Cache-Control: no-store` | bron-inspectie | C |
| T2-C5 | Registers: beide `app/auth/microsoft-login/*`-routes in `route-mechanismen.expected.json` als erkende OAuth-uitzondering met reden; drie handelingen in `audit-handelingen.expected.json`; LK-10-census bewust bijgewerkt; authz-matrix geregenereerd | gates | C |
| T2-C6 | Neutrale meldingen: exact drie login-teksten en drie profielteksten; geen tekst bevat `tenant`, `gast`, `ingetrokken`, `onbekend account`, e-mail | S over `error-core` + K | S, K |
| T2-E1 | Playwright: wachtwoordlogin + uitloggen ongewijzigd (bestaande `tenantpoort.spec.ts`) | groen | E |
| T2-E2 | Playwright: knop afwezig bij fonds zonder vlag; aanwezig met vlag (lokale stack met `fonds_microsoft_login`-seed) | | E |
| T2-E3 | Playwright: verlopen/afgekapte sessiecookie → `/` naar `/login`; `/api/profiel` → 401 | | E |

Ontbrekende testlaag vandaag: een Entra-stub voor E2E. Voorstel §8 V10: T2 levert een deterministische lokale OIDC-stub (patroon `tests/e2e/fixtures/ai-provider-stub.mjs`) die discovery/JWKS/token serveert met een testsleutel, zodat T2-1/2/4/7 lokaal in Playwright draaien zonder Entra.

---

## 6. Preview-smokeplan PGB

Zie `security/MICROSOFT-365-F1B-PGB-SMOKEPLAN.md` (provisioningvolgorde, App L, Supabase Auth, Vercel-geheimen, activering uitsluitend PGB, positieve/negatieve smoke, rollback). Dit document wijzigt geen configuratie; het is het draaiboek voor T3.

---

## 7. T2-uitvoeringsplan (kleine, reviewbare stappen)

Voorwaarden vóór B1: T1/PR-A gereviewd en gemerged naar `preview`; §4-contracten bevestigd (§8); deze branch gerebased op `origin/preview` **na** de T1-merge (`git fetch` eerst — zie geheugen "ververs origin vóór je vertakt").

| Stap | Inhoud | Gate | PR |
|---|---|---|---|
| **B0** | Registergat dichten: `route-mechanismen.test.ts` scant óók `app/auth/**`; `app/auth/callback` en `app/auth/microsoft/callback` als erkende `oauth-callback`-uitzondering met reden in `expected.json`; LK-10-census blijft. Geen productiecode. | `test:xtenant` groen; ontsnappingstellers ongewijzigd | PR-B0 (klein, apart mergebaar; kan vóór T1) |
| **B1** | Pure kernen: `oidc-core`, `identity-core`, `crypto-core`, `error-core`, `sessieguard-core` + sanity's (T2-3, T2-8, T2-C1, T2-C3, T2-C6) | `npm run sanity`, `tsc` | PR-B (commit 1) |
| **B2** | `microsoft-login-config.ts` + `microsoft-login.ts` (orchestratie met geïnjecteerde gateway/fetch voor testbaarheid) + flowtests met mock-gateway (T2-1, T2-2, T2-4b, T2-5, T2-6, T2-7) | sanity, `tsc`, contracttest T2-C2/C4 | commit 2 |
| **B3** | Routes `app/auth/microsoft-login/{start,callback}` + `app/api/microsoft-login/**` met `RouteSpecV1`; registers bijgewerkt (T2-C5); LK-10 en LK-3b/… bewust omgezet | `test:xtenant`, W1 `--verify` (bestaande snapshots byte-identiek), authz-matrix geregenereerd | commit 3 |
| **B4** | Guard L3 in wrapper (nieuwe `WrapperDeps`-dep, default = geen aanroep bij niet-`oauth`), `haalFondsSessie`, dashboard-, login-, platform-layout; L4 in `/auth/callback`. Sanity op `route-wrapper.sanity.ts` uitgebreid (wachtwoordsessie → geen gateway-aanroep) | W1 3× verify byte-identiek; LK-INVARIANTS groen; BASISLIJN-tests omgezet met motivering | commit 4 |
| **B5** | UI: `LoginForm` afsplitsen (gedrag ongewijzigd), `MicrosoftLoginKnop`, meldingsblok; `MicrosoftLoginKaart`; componenttests (K) | vitest component + axe | commit 5 |
| **B6** | Lokale OIDC-stub + Playwright T2-E1…E3 (+ T2-1/2/7 via stub) | `e2e-security.yml` lokaal | commit 6 |
| **B7** | W1: drie uitgestelde paginascenario's opnemen tegen de wegwerpstack, plus `/login` ingelogd (nieuwe seed-gebruiker zonder profiel) | `karakterisering.yml` | commit 7 |
| **B8** | Docs: ontwerp §4.4/§5 bijwerken, `security/MICROSOFT-365-F1B-RUNBOOK.md` (T2-deel), dreigingsmodel R-28…R-41, ASVS-register, HANDOVER | ontwerp-sync | commit 8 |
| **B9** | Reviewpakket: PR-B naar `preview` (**gebruiker merget**: raakt sessieresolutie); S7 groen als mergevoorwaarde | alle gates + `npm run gates` | PR-B |

Aansluittabel T0 §4.4 → dit plan: `microsoft-login-config.ts` → B2; `identity-core` → B1; `error-core` → B1; `gateway.ts` → **T1** (bestaat); `microsoft-login.ts` → B2; `sessieguard(-core)` → B1/B4; `app/auth/microsoft-login/*` → B3; `app/api/microsoft-login/*` → B3; `MicrosoftLoginKaart`, `app/login/*` → B5; layout/fonds-sessie/wrapper/login-layout/platform-layout → B4; `app/auth/callback` L4 → B4; migratie/check/rollback/allowlist → **T1**. Nieuw t.o.v. T0: B0 (registergat), `oidc-core`/`crypto-core` (afsplitsing uit "orchestratie"), OIDC-stub (B6), W1-paginascenario's (B7). Niets uit T0 §4.4 is vervallen.

---

## 8. Contractvragen voor de T1-uitvoerder

| # | Vraag | Waarom het T2 raakt | Voorstel |
|---|---|---|---|
| V1 | Blijft `activeerIdentiteit`/`herstelKoppeling` de `sub` eisen (T1) i.p.v. `(id, user)` (T0)? | T2 geeft `sub` uit het geverifieerde token mee; bij weglating verandert de kruiscontrole | ja, T1-vorm houden en T0 §4.2 bijwerken |
| V2 | `levende_binding` i.p.v. `actieve_binding`: is de bedoeling dat de guard zelf `status === 'active'` eist? | guard L3 mag `pending`/`revoking` nooit als toegang zien | ja; T2 pint dat in `sessieguard-core` |
| V3 | `reserveer_identiteit` retourneert `(id, categorie)` zonder raise; blijven de categorienamen `fonds_mismatch`/`binding_conflict`/`login_uit`/`tenant_mismatch` letterlijk (de laatste twee zitten in de werkstand, nog niet in `a104af3`)? Komt `login_uit`/`tenant_mismatch` ook in het **inlogpad** (`zoek_identiteit` toetst alleen `active`; T2 toetst flag en `tid` dan zelf via `microsoftLoginActief` + `valideerIdToken`)? | T2-mapping naar neutrale meldingen; dubbele toets vermijden of juist bewust dubbel | bevestigen; opnemen in check-SQL als contract; inlogpad: T2 toetst zelf, DB alleen bij koppelen |
| V4 | Wil T1 `inloggen.gestart/geslaagd/geweigerd`, `koppelen.gestart`, `sessie.beeindigd_zonder_binding`, `callback.identiteit_verwijderd` als toegestane `gebeurtenis`-waarden vastleggen (check-constraint of allowlist in check-SQL)? | anders is de vocabulaire vrij en driftgevoelig | allowlist in `binding-core.ts` (`LOGIN_GEBEURTENISSEN`) + check-SQL |
| V5 | Is `correlatie_id` `text` en mag T2 daar een `crypto.randomUUID()` in zetten die ook als supportcode (eerste 8 tekens) wordt getoond? | UX supportcode | ja |
| V6 | `consumeer_transactie` geeft geen onderscheid tussen "onbekend", "al gebruikt" en "verlopen" (alle `null`). Akkoord dat T2 dit als één categorie `transactie_ongeldig` behandelt? | replay-audit | ja; geen orakel nodig |
| V7 | `security/MICROSOFT-365-F1B-RUNBOOK.md` (T1, `a104af3`) beschrijft in §4 de Supabase-volgorde **hook vóór provider** en de kill switch in §6. Akkoord dat het PGB-smokeplan die volgorde overneemt en dat T2 alleen §3 (env), §6 (herstelroute/`unlinkIdentity`) en een nieuw app-deel aanvult, zonder de T1-secties te herschrijven? | één runbook, twee auteurs; mergeconflicten vermijden | ja; T2 voegt een sectie "8. Applicatielaag (T2)" toe, raakt §1–§7 niet |
| V8 | Vast lokaal wachtwoord `login_gateway_lokaal` in `testdb-apply-migrations.sh`: mag T2 in CI `LOGIN_GATEWAY_DATABASE_URL=postgresql://login_gateway:login_gateway_lokaal@127.0.0.1:54322/postgres` + `LOGIN_GATEWAY_DB_SSL=uit` zetten in `karakterisering.yml` en `e2e-security.yml` (patroon `ai_gateway`)? | anders kan de guard in CI niet draaien (fail-closed → alle `oauth`-paden dicht, wachtwoordpaden ongemoeid) | ja |
| V9 | Wenst T1/opdrachtgever een eigen `LimietNaam` voor `koppelen/start` en de `/auth/microsoft-login/start`-route (per host, ongeauthenticeerd)? | rate limit op een ongeauthenticeerde startroute is nieuw terrein buiten de wrapper | T2 stelt `microsoft_login_start` (per IP+host, 20/10 min) voor; besluit gevraagd |
| V10 | JWT-verificatie: `jose` (nieuwe dependency) of `node:crypto` `createPublicKey(jwk)` + `verify`? De spike gebruikte een eigen implementatie. | supply-chain vs. eigen crypto | `node:crypto`, gespiegeld aan de spike, met contracttest op RS256/`kid` |
| V11 | `?error=auth_callback` op `/login`: vandaag ongetoond. Eén neutrale melding voor beide faalpaden (`error=` en `fout=`)? | UX-consistentie; BASISLIJN LK-1b | opdrachtgever beslist; standaard: alleen `fout=` tonen |
| V12 | `jwt_expiry = 600` geldt projectbreed op Preview (P8): akkoord dat T2 geen extra client-side refreshlogica toevoegt en de browserclient-autorefresh volstaat? | §1.3: refresh is browsergedreven | ja, met smoke S10c |

---

## 9. Bestandsoverzicht van deze commit

- `MICROSOFT-365-LOGIN-F1B-T2-ONTWERP.md` (dit document)
- `security/MICROSOFT-365-F1B-PGB-SMOKEPLAN.md`
- `tests/component/LoginPage.component.test.tsx`
- `tests/cross-tenant/login-keten-karakterisering.test.ts`
- `tests/karakterisering/uitgestelde-opnames.json` (drie paginascenario's toegevoegd onder `nog_op_te_nemen_bij_stackrun`)

Geen productiecode, geen migraties, geen registerwijzigingen, geen configuratie.
