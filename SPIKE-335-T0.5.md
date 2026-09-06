# Spike T0.5 — #335 Microsoft-login (route B, hookprototype)

## Stand

De hoofdmodus en S6 zijn op 6 september 2026 groen uitgevoerd tegen de lokale
wegwerp-Supabase-stack. S7 (negatieve e-mailkoppeling met tweede account) en S9 (read-only
hosted Supabase-configuratie) staan nog open en zijn geen onderdeel van onderstaande groene
hoofdmeting.

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
| S0 | begin- en eindtelling | 1 user en 0 Azure-identiteiten, zowel voor als na | ✅ |

## Conclusie hoofdmodus

De directe OIDC-route zonder `offline_access`, de exacte identiteitstoets in de Auth-hook en het
toestands-/rollbackmodel werken in de lokale databasespike zoals ontworpen. De harde afhankelijkheid
dat GoTrue `tid` en `oid` onder `identity_data.custom_claims` bewaart, is bevestigd.

De al uitgegeven OAuth-access-token bleef na intrekking nog maximaal de ingestelde JWT-levensduur
van 600 seconden bruikbaar; een refresh werd wel direct geweigerd. Dit bevestigt het in besluit 0211
expliciet geaccepteerde Preview-intrekkingsvenster.

## Nog af te ronden

1. S7: drie negatieve e-mailkoppelingruns met het tweede Microsoft-account. Uitgesteld totdat
   de eigenaar van dat account zelf de interactieve aanmelding kan afronden; er is nog geen
   accountidentifier naar Microsoft verstuurd in deze poging.
2. S9: read-only controle van de hosted Preview-authconfiguratie zodra een Management API-token
   lokaal beschikbaar is.
