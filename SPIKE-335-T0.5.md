# Spike T0.5 — #335 Microsoft-login (route B, hookprototype)

## Stand

De hoofdmodus en S6 zijn op 6 september 2026 groen uitgevoerd tegen de lokale
wegwerp-Supabase-stack. S7 is op 7 september 2026 in drie afzonderlijke runs groen uitgevoerd
met een niet-gekoppelde Microsoft-identiteit en een lokaal wegwerp-wachtwoordaccount met exact
hetzelfde e-mailadres. S9 is op 6 september als read-only nulmeting tegen Preview uitgevoerd en
is, zoals vóór uitrol te verwachten, rood.

- Supabase Auth: v2.195.0
- Scopes: exact `openid profile`
- Redirect-URI: `http://localhost:3999/callback`
- De directe OIDC-uitwisseling gaf geen refresh-token uit.
- Per ongeluk verleende tenantbrede consent voor `openid profile` is daarna ingetrokken.
- Alleen persoonlijke consent voor het testaccount is vastgelegd; een aansluitende heraanmelding
  sloeg het toestemmingsscherm over en bleef volledig groen.
- Geen tokens, codes, nonces of e-mailadressen zijn in dit rapport opgenomen.

## Resultaten

| # | Meting | Gemeten | Resultaat |
|---|---|---|---|
| S8 | Auth-versie minimaal 2.185.0 | v2.195.0 | ✅ |
| S1-transport | authorize- en tokenrequest exact `openid profile`; geen refresh-token | scopes exact; geen refresh-token | ✅ |
| S1a–h | `iss`, `aud`, `exp`, `ver`, `nonce`, `tid`, `oid`, `sub`, `acct`, `idp` | alle invarianten gelijk/aanwezig zoals verwacht | ✅ |
| S1i | `email` en `xms_edov` zonder e-mailscope | beide afwezig | ℹ️ |
| S2 | onbekende identiteit zonder sessie | 422 `signup_disabled`; tellingen gelijk | ✅ |
| S3a | koppelen zonder reservering | 403; geen identiteit; transactie teruggerold | ✅ |
| S3a' | reservering voor A, koppelpoging met B | 403; geen identiteit; volledige rollback | ✅ |
| S3b | geldige pending-reservering voor B | 200; zelfde user; `provider_id = sub`; één identiteit erbij | ✅ |
| S3c | `identity_data.custom_claims.tid/oid` | beide exact gelijk aan tokenclaims | ✅ |
| S4 | inloggen met actieve binding | 200; zelfde user; `amr` bevat `oauth` | ✅ |
| S10e | geldige OAuth-sessie naar PostgREST | 200 | ✅ |
| S10a | ingetrokken binding, nieuwe id-token-grant | 403; geen token | ✅ |
| S10b | bestaand token en refresh na intrekking | REST 200 tot expiratie; refresh 403 | ✅ |
| S10c–d | wachtwoordlogin/refresh/PostgREST bij ingetrokken Microsoft-binding | alle 200 | ✅ |
| S5 | unlink, daarna nieuwe id-token-grant | unlink 200; daarna 422 `signup_disabled`; tellingen gelijk | ✅ |
| S6 | generieke Supabase-hosted Azure-flow | Microsoft `AADSTS50011`; Supabase-callback niet geregistreerd; tellingen gelijk | ✅ |
| S7.1 | `email`-scope, geen linking domain | automatische koppeling aan bestaand account; geen nieuwe gebruiker; identiteit opgeruimd | ✅ |
| S7.2 | `email`-scope, `azure=microsoft_login` linking domain | 422 `signup_disabled`; geen identiteit of gebruiker aangemaakt | ✅ |
| S7.3 | geen `email`-scope, geen linking domain | 422 `signup_disabled`; geen identiteit of gebruiker aangemaakt | ✅ |
| S9 | hosted Preview-authconfiguratie | Microsoft-provider, manual linking, Auth-hook en JWT-verkorting nog niet geconfigureerd | ❌ nulmeting |
| S0 | begin- en eindtelling | 1 user en 0 Azure-identiteiten, zowel voor als na | ✅ |

## Conclusie hoofdmodus

De directe OIDC-route zonder `offline_access`, de exacte identiteitstoets in de Auth-hook en het
toestands-/rollbackmodel werken in de lokale databasespike zoals ontworpen. De harde afhankelijkheid
dat GoTrue `tid` en `oid` onder `identity_data.custom_claims` bewaart, is bevestigd.

De al uitgegeven OAuth-access-token bleef na intrekking nog maximaal de ingestelde JWT-levensduur
van 600 seconden bruikbaar; een refresh werd wel direct geweigerd. Dit bevestigt het in besluit 0211
expliciet geaccepteerde Preview-intrekkingsvenster.

## S7 — negatieve e-mailkoppeling

De drie vooraf uitgesproken verwachtingen zijn bevestigd. Met een e-mailclaim en zonder linking
domain koppelt GoTrue de onbekende Azure-identiteit automatisch aan het bestaande wachtwoordaccount
met hetzelfde e-mailadres. Met het linking domain wordt die koppeling voorkomen. Zonder
`email`-scope ontbreekt de e-mailclaim en volgt eveneens `signup_disabled`.

Voor S7 is geen tweede persoon of tweede Microsoft-account vereist: dezelfde, nog niet aan de
lokale gebruiker gekoppelde Microsoft-identiteit volstaat wanneer het wegwerp-wachtwoordaccount
exact hetzelfde e-mailadres heeft. De eerste configuratiepogingen met een uitgeschakelde lokale
provider en een niet exact overeenkomend testadres tellen niet als meting; zij veranderden geen
gebruiker of identiteit. Na elke geldige run stond de stack weer op één gebruiker en nul
Azure-identiteiten. Er zijn geen tokens, codes, nonces of e-mailadressen in dit rapport opgenomen.

## S9 — hosted Preview-nulmeting

De Management API is één keer read-only bevraagd met een tijdelijk persoonlijk token van één
uur. Alleen de vaste allowlist uit `management-auth-config.mjs` is getoond; de ruwe respons is
niet opgeslagen. Het token is na de call onmiddellijk bij Supabase ingetrokken en uit
`.env.spike` verwijderd.

| Invariant | Preview op 6 september 2026 | Vereist vóór Microsoft-loginpilot |
|---|---|---|
| Nieuwe Auth-gebruikers uit | `disable_signup = true` | ✅ reeds goed |
| Handmatig identity linking | `false` | `true` |
| Azure/App L-provider | uit; tenant-URL leeg | aan met App L en exacte tenant-URL |
| Access Token Hook | uit; URI leeg | aan met productiehook |
| JWT-levensduur | 3600 seconden | 600 seconden voor Preview-pilot |
| OAuth-providers | geen | uitsluitend `azure` |
| Linking-domaininstelling | geen sleutel in 243 ontvangen configuratiesleutels | niet via Management API beschikbaar; ontwerp mag hier niet primair van afhangen |
| Site-URL | Preview-platformhost | ✅ passend |

S9 bewijst daarmee de uitgangssituatie, niet een codefout. T1/T3 moeten deze instellingen
expliciet en in de juiste volgorde provisionen voordat Microsoft-login op PGB wordt geactiveerd.

## Nog af te ronden

S7 is afgerond. De resterende rode S9-stand is de verwachte Preview-nulmeting en wordt pas tijdens
de gecontroleerde T3-provisioning gewijzigd.
