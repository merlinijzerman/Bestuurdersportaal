# Microsoft 365 — fase 1 Preview-runbook

## Vooraf

0. Breng de featurebranch eerst via PR naar `preview`. Controleer dat Vercel de wijziging op de custom environment `preview-stable` heeft gebouwd. De databasewijziging is additief en de pilotflag blijft standaard uit.
1. Maak in onze eigen Entra-tenant een single-tenant webapp. Registreer voor de eerste smoke exact `https://pgb.preview.bestuurdersportaal.com/auth/microsoft/callback` als Web redirect URI. De callback moet dezelfde host gebruiken als de fondsapp: de Supabase-sessiecookie is hostgebonden en is op `app.preview.bestuurdersportaal.com` niet beschikbaar voor een koppeling die op de PGB-host begon. Voeg een lokale URI alleen toe wanneer lokaal interactief testen werkelijk wordt ingericht; voeg geen productie- of willekeurige Vercel-deployment-URL toe.
2. Voeg alleen delegated `User.Read` toe; OIDC-basisscopes worden door de flow aangevraagd. Voeg geen agenda-, SharePoint- of application permissions toe.
3. Maak vóór de migratie een aparte, minimale database-login `microsoft_vault`. Gebruik een willekeurig gegenereerd lang wachtwoord en voer het niet in via een vastgelegd script. De rol krijgt `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS` en een lage connection limit. De migratie faalt gesloten als de rol ontbreekt en geeft daarna alleen `USAGE` op `microsoft_private` en `EXECUTE` op de negen benoemde functies. Geef geen tabelrechten en geen service-rolekey.
4. Plaats de variabelen uitsluitend in Vercel custom environment `preview-stable`: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALLBACK_URL`, `MICROSOFT_VAULT_DATABASE_URL`, `MICROSOFT_VAULT_CA_CERT_BASE64`, `MICROSOFT_VAULT_ENCRYPTION_KEY` (32 bytes base64) en `MICROSOFT_VAULT_KEY_VERSION`. Gebruik exact de geregistreerde PGB-callback. Gebruik voor de vault-URL de Supavisor transaction pooler (poort 6543), de gebruikersnaam `microsoft_vault.<project-ref>` en een gepercent-encodeerd wachtwoord. Download het actuele Supabase CA-certificaat uit **Database Settings → SSL configuration**, controleer de getoonde certificaatgegevens en sla de volledige PEM base64-gecodeerd op. De adapter verwijdert conflicterende `sslmode`-/certificaatparameters uit de URL en bouwt de TLS-verbinding uitsluitend met deze CA en `rejectUnauthorized=true` op. Markeer clientsecret, database-URL, CA en encryptiesleutel als Vercel `Secret`; tenant-id, client-id, callback-URL en sleutelversie mogen `Config` zijn. Production en de generieke Preview-environment krijgen geen van deze waarden.
5. Pas de migratie toe en voer daarna `supabase/checks/2026_09_04_microsoft_fase1_connectorfundament.sql` uit als database-eigenaar. Zet pas na een groene controle uitsluitend voor `Stichting Pensioenfonds PGB` (`pgb`) `microsoft_koppeling_pilot=true`; laat `integratieprofiel='eigen'` staan. Leg de handmatige wijziging vast in het operationele changebewijs.
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
where f.slug = 'pgb';
```

Activeer alleen met een id-gebonden update nadat de getoonde rij is gecontroleerd. Gebruik geen brede update op slug zonder deze preflight.

Voor de Preview-pilot van 4 september 2026 is de gecontroleerde fonds-id `37fdca3b-e92b-4671-b6b7-ac2bb83e3b89`. Herhaal de preflight vóór uitvoering en gebruik daarna:

```sql
update public.fonds_integratie_profielen
set microsoft_koppeling_pilot = true,
    bijgewerkt = now()
where fonds_id = '37fdca3b-e92b-4671-b6b7-ac2bb83e3b89'
  and integratieprofiel = 'eigen'
  and microsoft_koppeling_pilot = false
returning fonds_id, integratieprofiel, microsoft_koppeling_pilot;
```

De verwachte uitkomst is exact één rij. Nul rijen betekent opnieuw controleren; voer dan geen bredere update uit.

## Uitrol- en configuratiemodel

Fase 1 gebruikt bewust twee lagen:

- **Omgevingsconfiguratie:** Entra-app, callback, vaultverbinding en encryptiesleutel staan server-side in Entra en Vercel. Deze waarden gelden voor de technische Preview-omgeving en zijn nooit fonds- of browser-schrijfbaar.
- **Fondsconfiguratie:** `public.fonds_integratie_profielen` bepaalt per fonds het productprofiel en de tijdelijke fase-1-pilotflag. Voor PGB blijft dit tijdens fase 1 `integratieprofiel='eigen'` plus `microsoft_koppeling_pilot=true`.

Na fase 1 hoort de fondsconfiguratie in één platformbeheerscherm **Integraties** te landen. Dat scherm schrijft alleen via geautoriseerde, geaudite server-acties en toont geen secrets. Het bevat uiteindelijk per fonds:

- productvariant `eigen` of `microsoft`;
- afzonderlijke activeringen voor accountkoppeling, Outlook, SharePoint en retrieval;
- gekozen mailbox/agenda en SharePoint-site, documentbibliotheek en hoofdmap;
- retrievalvariant `live` of `Azure AI Search`;
- AI-provider/model en uitsluitend een verwijzing naar het bijbehorende geheim.

Een productvariant mag pas naar `microsoft` wanneer alle ingeschakelde Microsoft-bronnen hun eigen acceptatietest hebben doorlopen. Tot die tijd blijven bestaande upload-, agenda- en AI-paden werken en worden Microsoft-functies additief per fonds aangezet.

## Roulatie en herstel

- Roteer eerst de Entra-clientsecret; deploy de nieuwe Preview-secret; test `/me`; trek daarna de oude secret in.
- Voor een cache-sleutelrotatie is een uitleesbare vorige sleutel nodig voordat een nieuwe sleutelversie actief wordt. Fase 1 weigert onbekende sleutelversies fail-closed; markeer betrokken koppelingen als herstel vereist en laat gebruikers opnieuw koppelen als een vorige sleutel niet meer beschikbaar is.
- Kill switch: zet de pilotflag uit. UI en routes sluiten dan; verwijder bij incidenten vervolgens de lokale koppeling met de databasefunctie `ontkoppel` en roteer zo nodig Entra-secret/sleutel.
- Lokaal ontkoppelen vernietigt alleen het cachemateriaal van het portaal. Microsoft-consent wordt afzonderlijk door de gebruiker/tenantbeheerder ingetrokken.

## Preview-smoke

Controleer op `https://pgb.preview.bestuurdersportaal.com` normale Supabase-login, start koppelen, exact vier scopes, veilige statusmetadata, server-side test, replay/weigering van state en lokaal ontkoppelen. Controleer daarnaast dat de kaart bij een fonds zonder pilotflag niet zichtbaar is. Leg geen authorization codes, state, tokens, cacheblobs, secrets of volledige tenant/accountnamen vast.

Bij een mislukte callback registreert de applicatie uitsluitend een vaste fasecode: `oauth_transactie`, `oauth_decryptie`, `token_exchange`, `identity_validation`, `graph_me`, `vault_save` of `onverwachte_fout`. Zoek in de Preview-runtime-log op `[MICROSOFT] OAuth-callback mislukt` en verifieer dezelfde categorie in `microsoft_private.audit_log`. Neem de onderliggende providerfout niet over in logs of auditvelden. De tokenuitwisseling krijgt de oorspronkelijke nonce mee, zodat MSAL de ID-tokennonce vóór verdere verwerking controleert.

De verbindingstest gebruikt dezelfde aanpak met de prefix `test_`: `cache_read`, `cache_decryptie`, `account_lookup`, `silent_token`, `graph_me`, `cache_save`, `status_save` of `onverwachte_fout`. De runtime-log bevat alleen deze vaste categorie; de private auditrij krijgt dezelfde categorie.

De vault-adapter vertaalt databasekolom `sleutel_versie` expliciet naar applicatieveld `sleutelVersie` voordat decryptie plaatsvindt. Gebruik de ruwe PostgreSQL-rij niet rechtstreeks als `VersleuteldBlob`; dat omzeilt de compile-timecontrole door het verschil tussen snake_case en camelCase.

Rol eerst uit naar `preview-stable`, activeer daarna de PGB-flag en voer de smoke uit. Bij een blokkerende fout gaat eerst de PGB-flag terug naar `false`; pas daarna wordt de deployment teruggezet. Productie blijft in fase 1 ongewijzigd.

## Lokaal databasebewijs 2026-09-04

De forwardmigratie en rollback zijn in een schone PostgreSQL 17-wegwerpdatabase uitgevoerd. Daarbij zijn aanvullend bewezen:

- de structurele check voor de minimale loginrol en negen private functies is groen;
- een nieuw fonds krijgt automatisch `integratieprofiel='eigen'` en pilotflag `false`;
- de loginrol kan de benoemde OAuth-functie uitvoeren;
- dezelfde rol krijgt bij directe leestoegang tot `microsoft_private.oauth_transacties` `permission denied`;
- de rollback schakelt de login uit en verwijdert het publieke profielobject en private schema.

Dit lokale bewijs vervangt niet de Preview-check na migratie; het voorkomt dat Preview als eerste SQL-parser en privilegeproef wordt gebruikt.
