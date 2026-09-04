# AI-gateway — runbook databaselaag (M365 fase 2B, #311, tranche T2)

Hoort bij `supabase/migrations/2026_09_04_ai_gateway_configuratie.sql`, de suite
`supabase/checks/2026_09_04_ai_gateway.sql` en het ontwerp `AI-GATEWAY-ONTWERP.md` (§3.3a/§3.3b).
Patroon: identiek aan de Microsoft-kluisrol uit fase 1 (`MICROSOFT-365-F1-RUNBOOK.md`).

## Wat deze laag is

- Een privaat schema `ai_gateway_private` met per fonds × taakgroep de goedgekeurde provider/modelconfiguratie, platform- of fondsgebonden providerprofielen (alleen **sleutelnamen**, nooit keys of URL's), een append-only wijzigingslog en een append-only, inhoudsvrije auditregel per providercall.
- Eén aparte, minimale loginrol `ai_gateway` die uitsluitend vier functies mag uitvoeren: `lees_config`, `schrijf_log`, `lees_log_platform`, `lees_platform_profiel`. `anon`, `authenticated` én `service_role` hebben nul rechten in dit schema; tenantroutes blijven op de RLS-client.
- Backfill: elk bestaand fonds krijgt vier rijen op `platform-anthropic` met het huidige model per taakgroep (`generatie` opus-4-8, `hulp_sterk` sonnet-4-6, `concept` sonnet-4-5, `hulp_snel` haiku-4-5). Geen gedragswijziging; Vercel heeft geen `AI_MODEL`-override (gecontroleerd 2026-09-04).

## Vooraf (per omgeving: Preview, daarna Productie)

1. Breng de branch via PR naar `preview`; wacht op groene gates. De migratie is additief; de code (T3) raakt de tabellen nog niet.
2. Maak vóór de migratie de loginrol `ai_gateway`. Genereer een lang willekeurig wachtwoord interactief; zet het niet in een script of commit. Flags: `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5`. De migratie faalt gesloten als de rol ontbreekt en geeft daarna alleen `USAGE` op `ai_gateway_private` en `EXECUTE` op de vier benoemde functies. Geen tabelrechten, geen service-rolekey.

   Controle vóór de migratie (zonder wachtwoord in het script):

   ```sql
   select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
          rolcreaterole, rolreplication, rolbypassrls, rolconnlimit
   from pg_roles
   where rolname = 'ai_gateway';
   ```

   Verwacht: één rij, `rolcanlogin=true`, alle andere bevoegdheidsvelden `false`, `rolinherit=false`, connection limit ≤ 5.
3. Controleer dat de vier backfillmodellen op de allowlist staan (anders faalt de FK van de backfill, bewust):

   ```sql
   select provider, model, actief from public.ai_model_allowlist
   where provider = 'anthropic'
     and model in ('claude-opus-4-8','claude-sonnet-4-6','claude-sonnet-4-5','claude-haiku-4-5-20251001');
   ```

4. Pas de migratie toe (Supabase SQL Editor, één transactie; het `DO`-eindblok rolt terug bij elke afwijking). Draai daarna als database-eigenaar:
   - `supabase/checks/2026_09_04_ai_gateway.sql` (DEEL 2 draait in een transactie die eindigt op `rollback`; er blijft niets achter);
   - `supabase/checks/2026_07_31_r1_structurele_gates.sql` (A–H) en `2026_08_20_v3_grants_volledig.sql` — de publieke triggerfunctie `fn_fonds_ai_configuratie_standaard()` staat zonder enige execute-grant in `allowlist-grants.tsv`.
5. Zet pas bij T3 de omgevingsvariabelen in Vercel (`Secret`): `AI_GATEWAY_DATABASE_URL` (Supavisor transaction pooler, poort 6543, gebruikersnaam `ai_gateway.<project-ref>`, gepercent-encodeerd wachtwoord) en `AI_GATEWAY_CA_CERT_BASE64` (het actuele Supabase CA-certificaat uit **Database Settings → SSL configuration**, volledige PEM base64). De adapter (T3) verwijdert conflicterende `sslmode`-parameters en bouwt TLS uitsluitend met deze CA en `rejectUnauthorized=true`. Zonder deze variabelen faalt de gateway gesloten (`gateway_db_onbereikbaar`); dat is correct gedrag tot T3 is uitgerold.
6. Leg de handmatige stappen (rolcreatie, migratie, suite-uitkomst) vast in het operationele changebewijs.

## Beheer in 2B (geen UI — reviewbesluit R4)

Een wijziging van de fondsconfiguratie gebeurt uitsluitend via een gecontroleerde migratie/beheerprocedure als database-eigenaar, altijd mét `reden` (≥ 10 tekens; de trigger weigert anders), bijvoorbeeld:

```sql
update ai_gateway_private.fonds_configuratie
   set model = 'claude-sonnet-4-6',
       bijgewerkt_door = '<platform_identity_id>',
       reden = 'Ticket #… — pilotfonds X op sonnet voor de generatie'
 where fonds_id = '<fonds_id>' and taakgroep = 'generatie'
returning fonds_id, taakgroep, profiel_id, provider, model, versie;
```

De trigger dwingt af dat het profiel bestaat en actief is, dat de provider bij het profiel past en dat een fonds alleen een platformprofiel of zijn **eigen** profiel (`eigenaar_fonds_id`) kan kiezen. Elke wijziging landt append-only in `fonds_configuratie_log`. Het beheerscherm komt in een vervolg ([#317](https://github.com/merlinijzerman/Bestuurdersportaal/issues/317)).

## Rollback

`supabase/rollbacks/2026_09_04_ai_gateway_configuratie_ROLLBACK.sql` — eerst de T3-code terugrollen, dan dit bestand. Het script **weigert** zolang `gateway_log` of `fonds_configuratie_log` regels bevat; exporteer eerst en zet dan in dezelfde sessie `set ai_gateway.rollback_met_dataverlies = 'ja'`. De loginrol wordt op `NOLOGIN` gezet en blijft bestaan; verwijder haar apart nadat is vastgesteld dat geen deployment of secretstore haar nog gebruikt.

## Lokaal / CI

`scripts/testdb-apply-migrations.sh` maakt in de wegwerp-DB een wachtwoordloze `ai_gateway`-fixture met dezelfde flags (zoals voor `microsoft_vault`), zodat de migratie en de suite in `scripts/cross-tenant-ci.sh` ongewijzigd draaien. Preview en Productie vereisen een echt, beheerd wachtwoord.
