# Microsoft 365 — fase 1 Preview-runbook

## Vooraf

0. Breng de featurebranch eerst via PR naar `preview`. Controleer dat Vercel de wijziging op de custom environment `preview-stable` heeft gebouwd. De databasewijziging is additief en de pilotflag blijft standaard uit.
1. Maak in onze eigen Entra-tenant een single-tenant webapp. Registreer voor de eerste smoke exact `https://app.preview.bestuurdersportaal.com/auth/microsoft/callback` als Web redirect URI. Voeg een lokale URI alleen toe wanneer lokaal interactief testen werkelijk wordt ingericht; voeg geen productie- of willekeurige Vercel-deployment-URL toe.
2. Voeg alleen delegated `User.Read` toe; OIDC-basisscopes worden door de flow aangevraagd. Voeg geen agenda-, SharePoint- of application permissions toe.
3. Maak vóór de migratie een aparte, minimale database-login `microsoft_vault`. Gebruik een willekeurig gegenereerd lang wachtwoord en voer het niet in via een vastgelegd script. De rol krijgt `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS` en een lage connection limit. De migratie faalt gesloten als de rol ontbreekt en geeft daarna alleen `USAGE` op `microsoft_private` en `EXECUTE` op de negen benoemde functies. Geef geen tabelrechten en geen service-rolekey.
4. Plaats de variabelen uitsluitend in Vercel custom environment `preview-stable`: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALLBACK_URL`, `MICROSOFT_VAULT_DATABASE_URL`, `MICROSOFT_VAULT_ENCRYPTION_KEY` (32 bytes base64) en `MICROSOFT_VAULT_KEY_VERSION`. Gebruik exact de geregistreerde `app.preview`-callback. Gebruik voor de vault-URL de Supavisor transaction pooler (poort 6543), de gebruikersnaam `microsoft_vault.<project-ref>`, een gepercent-encodeerd wachtwoord en `sslmode=require`. Markeer wachtwoord, client secret, database-URL en encryptiesleutel als sensitive. Production en de generieke Preview-environment krijgen geen van deze waarden.
5. Pas de migratie toe en voer daarna `supabase/checks/2026_09_04_microsoft_fase1_connectorfundament.sql` uit als database-eigenaar. Zet pas na een groene controle uitsluitend voor het sandboxfonds achter `app.preview.bestuurdersportaal.com` (`meridiaan`) `microsoft_koppeling_pilot=true`; laat `integratieprofiel='eigen'` staan. Leg de handmatige wijziging vast in het operationele changebewijs.
6. Maak na iedere wijziging van Vercel-variabelen een nieuwe `preview-stable`-deployment; bestaande deployments nemen gewijzigde variabelen niet over.

Controleer vóór de migratie zonder wachtwoord in het script:

```sql
select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication, rolbypassrls, rolconnlimit
from pg_roles
where rolname = 'microsoft_vault';
```

De verwachte uitkomst is één loginrol met alle bevoegdheidsvelden behalve `rolcanlogin` op `false`, `rolinherit=false` en een connection limit van maximaal 5. Maak of roteer het wachtwoord interactief; bewaar het uitsluitend in de Preview-secretstore.

Controleer vóór activering expliciet de doelrij:

```sql
select f.id, f.slug, i.integratieprofiel, i.microsoft_koppeling_pilot
from public.fondsen f
join public.fonds_integratie_profielen i on i.fonds_id = f.id
where f.slug = 'meridiaan';
```

Activeer alleen met een id-gebonden update nadat de getoonde rij is gecontroleerd. Gebruik geen brede update op slug zonder deze preflight.

## Roulatie en herstel

- Roteer eerst de Entra-clientsecret; deploy de nieuwe Preview-secret; test `/me`; trek daarna de oude secret in.
- Voor een cache-sleutelrotatie is een uitleesbare vorige sleutel nodig voordat een nieuwe sleutelversie actief wordt. Fase 1 weigert onbekende sleutelversies fail-closed; markeer betrokken koppelingen als herstel vereist en laat gebruikers opnieuw koppelen als een vorige sleutel niet meer beschikbaar is.
- Kill switch: zet de pilotflag uit. UI en routes sluiten dan; verwijder bij incidenten vervolgens de lokale koppeling met de databasefunctie `ontkoppel` en roteer zo nodig Entra-secret/sleutel.
- Lokaal ontkoppelen vernietigt alleen het cachemateriaal van het portaal. Microsoft-consent wordt afzonderlijk door de gebruiker/tenantbeheerder ingetrokken.

## Preview-smoke

Controleer normale Supabase-login, start koppelen, exact vier scopes, veilige statusmetadata, server-side test, replay/weigering van state en lokaal ontkoppelen. Leg geen authorization codes, state, tokens, cacheblobs, secrets of volledige tenant/accountnamen vast.

## Lokaal databasebewijs 2026-09-04

De forwardmigratie en rollback zijn in een schone PostgreSQL 17-wegwerpdatabase uitgevoerd. Daarbij zijn aanvullend bewezen:

- de structurele check voor de minimale loginrol en negen private functies is groen;
- een nieuw fonds krijgt automatisch `integratieprofiel='eigen'` en pilotflag `false`;
- de loginrol kan de benoemde OAuth-functie uitvoeren;
- dezelfde rol krijgt bij directe leestoegang tot `microsoft_private.oauth_transacties` `permission denied`;
- de rollback schakelt de login uit en verwijdert het publieke profielobject en private schema.

Dit lokale bewijs vervangt niet de Preview-check na migratie; het voorkomt dat Preview als eerste SQL-parser en privilegeproef wordt gebruikt.
