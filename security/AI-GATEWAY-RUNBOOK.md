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

### #438 — Opus 5.5/Sonnet 5-contract (PR1)

`supabase/migrations/2026_09_27_ai_gateway_opus_5_5_contract.sql` voegt uitsluitend
`tokens_thinking` en de stopredenen `contextvenster`, `pauze` en `weigering` toe. De migratie
wijzigt geen model, allowlist of fondsconfiguratie. Controleer na toepassing:

```sql
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'ai_gateway_private'
   and table_name = 'gateway_log'
   and column_name = 'tokens_thinking';

select has_function_privilege(
  'ai_gateway', 'ai_gateway_private.schrijf_log(jsonb)', 'execute'
);
```

Thinking-tokens zijn een subset van `tokens_out`; tel ze nooit nogmaals op bij
`tokens_totaal`. De bijbehorende handmatige rollback weigert zolang een logregel een nieuwe
stopreden of een aanwezige thinkingtelling bevat. Exporteer/behoud het append-only spoor; maak
het niet leeg om een rollback af te dwingen. Rol eerst de code terug, daarna pas het SQL-contract.

### #438 — effortobservability en prompt caching (PR2)

`supabase/migrations/2026_09_28_ai_gateway_effort_observability.sql` voegt alleen de
nullable kolom `effort` toe en vervangt `schrijf_log(jsonb)` zodat het werkelijk toegepaste
niveau inhoudsvrij wordt vastgelegd. Er wijzigen geen modellen, allowlistregels,
fondsconfiguraties, rollen, grants of RLS-policies. De transactionele CI-controle staat in
`supabase/checks/2026_09_28_ai_gateway_effort_observability.sql`. Controleer na toepassing:

```sql
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'ai_gateway_private'
   and table_name = 'gateway_log'
   and column_name = 'effort';

select has_function_privilege(
  'ai_gateway', 'ai_gateway_private.schrijf_log(jsonb)', 'execute'
);

select effort, count(*)
  from ai_gateway_private.gateway_log
 group by effort
 order by effort nulls first;
```

Verwacht bij actieve 4.x-modellen `effort is null`: de gateway logt niet de aanvraag, maar
wat de adapter daadwerkelijk heeft toegepast. Na een Preview-canary met een effortmodel
moeten de gekozen niveaus zichtbaar zijn zonder prompt- of antwoordinhoud.

Controleer prompt caching over minimaal twee opeenvolgende berichten in hetzelfde gesprek:

```sql
select taaktype, model, effort,
       sum(tokens_cache_lezen) as cache_lezen,
       sum(tokens_cache_creatie) as cache_creatie,
       avg(latency_ms)::integer as gemiddelde_latency_ms
  from ai_gateway_private.gateway_log
 where aangemaakt >= now() - interval '1 hour'
 group by taaktype, model, effort
 order by taaktype, model, effort;
```

Het cachebereik is server-side HMAC-afgeleid uit fonds, gebruiker en gesprek; het staat niet
in de gatewaylog. Zonder geldige gesprek-id of `AUDIT_HMAC_SLEUTEL` wordt alleen de statische
systeemprompt gecachet en blijven dynamische bronsentinels per request wisselen. Prompt-,
tool- of effortwijzigingen kunnen een cachemiss veroorzaken en zijn daarom onderdeel van de
Preview-meting.

De handmatige rollback
`supabase/rollbacks/2026_09_28_ai_gateway_effort_observability_ROLLBACK.sql` weigert zodra
een logregel een effortwaarde bevat. Rol eerst de code terug. Behoud/exporteer het append-only
auditspoor en verwijder geen logregels om de rollback te forceren.

### Klant-eigen Azure OpenAI — inert contract

`2026_10_02_azure_openai_klantprovider.sql` opent `azure_openai` als aparte provider en
maakt de providerswitch aan op `gestopt`. De migratie registreert bewust geen model, profiel,
endpoint of fondsconfiguratie. De code accepteert uitsluitend de secretreferenties
`AZURE_OPENAI_API_KEY` en `AZURE_OPENAI_BASE_URL`; de URL moet eindigen op `/openai/v1` en op
een ondersteunde Azure AI-host staan. De Responses-aanroep gebruikt `store: false`.

Voor een klantpilot zijn daarna afzonderlijk en in deze volgorde nodig:

1. Leg fonds-id, Azure resource/region, exacte deploymentnaam, modelversie en ondersteunde
   reasoning-efforts vast. Gebruik geen vrije URL of sleutel in SQL.
2. Zet `AZURE_OPENAI_API_KEY` en `AZURE_OPENAI_BASE_URL` als afgeschermde Preview-secrets.
3. Voeg de deploymentnaam toe aan `ai_model_allowlist`, maak één fonds-eigen
   `provider_profiel` met beide referentienamen en wijs alle vier taakgroepen expliciet toe.
4. Houd `azure_openai` nog gestopt en voer eerst een hermetische configuratiecheck uit.
5. Activeer de switch via de vier-ogenprocedure en smoke minimaal gewone documentchat,
   streaming, vraagrouter/toolcall, vergelijking en conceptgeneratie. Een model dat een gevraagd
   effortniveau niet ondersteunt is een mislukte smoke; pas dit niet stil in code aan.
6. Controleer het inhoudsvrije `gateway_log` op provider, deployment, taaktype, effort, tokens en
   resultaat. Controleer tevens dat prompt, bronpassages, antwoord, endpoint en key nergens in
   audit of foutlogging staan.

Webzoek via een providertool is in deze eerste fase niet gecontracteerd en faalt gesloten. De
gewone document-/SharePointcontext wordt door het portaal samengesteld en kan wel met de
klantprovider worden getest. De rollback weigert zodra Azure OpenAI-configuratie of auditdata
bestaat; exporteer en ontkoppel die gecontroleerd voordat het contract wordt teruggenomen.

### #438 — Preview-canary Opus 5.5/Sonnet 5 (PR3)

Volgorde voor `portal_preview`:

1. Pas eerst `2026_09_27_ai_gateway_opus_5_5_contract.sql` en
   `2026_09_28_ai_gateway_effort_observability.sql` toe en draai hun checks.
2. Pas `2026_09_28_438_opus_5_5_sonnet_5_register.sql` toe. Dit registreert de
   modellen en wijzigt alleen defaults voor nieuwe fondsen.
3. Draai daarna uitsluitend op Preview
   `supabase/seeds/preview/2026_09_28_438_opus_5_5_sonnet_5_canary.sql`. De seed
   bevestigt eerst de Preview-fingerprint en wijzigt alleen `m365-demo`.
4. Draai de read-only postcheck
   `supabase/checks/2026_09_28_438_opus_5_5_sonnet_5_canary.sql`.
5. Deploy de code en rooktest chat, Grondige analyse en documentvergelijking.
   Controleer in `gateway_log` het effectieve model, effort, stopreden,
   thinking-/cachetokens en resultaat; log geen prompt of antwoordinhoud.

Rollback: eerst
`2026_09_28_438_opus_5_5_sonnet_5_canary_ROLLBACK.sql`, zodat `m365-demo` weer
op 4.x staat. De generieke registerrollback mag pas daarna en weigert zolang een
fonds nog een 5.x-model gebruikt. Productie is geen onderdeel van deze procedure.

## Lokaal / CI

`scripts/testdb-apply-migrations.sh` maakt in de wegwerp-DB een wachtwoordloze `ai_gateway`-fixture met dezelfde flags (zoals voor `microsoft_vault`), zodat de migratie en de suite in `scripts/cross-tenant-ci.sh` ongewijzigd draaien. Preview en Productie vereisen een echt, beheerd wachtwoord.

## T4/T5 — volledige call-sitecutover

T4 brengt samenvatting, context-prefix, semantische extractie, afschrift-/besluitconcept en
AQLab generatie/judge onder dezelfde gateway. Voer per omgeving in deze volgorde uit:

1. Controleer dat T2/T3 actief zijn en een gewone chatcall een regel in
   `ai_gateway_private.gateway_log` schrijft.
2. Pas `supabase/migrations/2026_09_04_t4_ai_actietype_semantische_extractie.sql` toe. Draai
   daarna `supabase/checks/2026_08_16_ai_begrenzing.sql`; het nieuwe actietype moet alleen als
   systeemactie mét fonds kunnen reserveren.
3. Pas `supabase/seeds/schema/2026_09_04_ai_gateway_monitoring_seed.sql` toe. Controleer dat
   precies één actieve configrij `gateway_log_fouten` bestaat.
4. Deploy daarna pas de T4/T5-code. Zonder stap 2 faalt semantische extractie gesloten; zonder
   stap 3 gebruikt monitoring tijdelijk de codefallback, maar dat is geen geldige eindtoestand.
5. Smoke op één Preview-fonds: chat met bron, afschriftconcept, besluitconcept, één document-ingest
   inclusief prefix/samenvatting, semantische extractie en één synthetische AQLab-run. Controleer
   voor elke uitgevoerde taak `taaktype`, fonds/platformscope, effectief model, `actie_id`,
   correlatie-id en resultaat; controleer expliciet dat prompt, antwoord, documentinhoud en secrets
   niet in `gateway_log` of `app_errors` staan.
6. Laat de monitoringssnapshot draaien en controleer dat `gateway_log_fouten = 0`. Een gecontroleerd
   veroorzaakte logschrijffout is alleen in een geïsoleerde testomgeving toegestaan.

### Rollback T4/T5

Rol eerst de code terug. Draai daarna
`supabase/rollbacks/2026_09_04_ai_gateway_monitoring_seed_ROLLBACK.sql` en pas uitsluitend wanneer
geen lopende semantische-extractiejob bestaat
`supabase/rollbacks/2026_09_04_t4_ai_actietype_semantische_extractie_ROLLBACK.sql` toe. De T2/T3-
gatewaytabellen en auditregels blijven staan; gebruik hun destructieve rollback alleen bij een
volledige terugname van fase 2B.
