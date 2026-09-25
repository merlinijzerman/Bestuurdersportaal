# T4-D runbook — Copilot-rolloutpoorten (#423)

Op `portal_preview` zijn stap 0 t/m 5 op 21 september 2026 uitgevoerd. De
rollout- en fondsflag bleven dicht; de Retrieval-arm is inert. Voor Productie
beschrijft dit document nog steeds wat een mens moet doen.

## 0. Vooraf: `copilot_operator` provisionen

De expand-migratie **weigert te draaien** zonder deze rol, zodat zij niet half
landt en de rol niet stilzwijgend met onbedoelde rechten ontstaat.

```sql
create role copilot_operator
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
```

Geen wachtwoord, geen login. Een DBA neemt hem aan met `set role` wanneer hij de
rem moet bedienen. De applicatierol `microsoft_vault` krijgt hier **geen**
lidmaatschap van.

## 1. Uitrol (expand → deploy → contract)

| Stap | Handeling | Voorwaarde om door te gaan |
|---|---|---|
| 1 | `supabase/migrations/2026_09_21_423a_t4d_copilot_rollout_expand.sql` | — |
| 2 | applicatiedeploy | migratie A is toegepast |
| 3 | deploy waarnemen | — |
| 4 | verifiëren dat het oude pad niet meer schrijft | zie query hieronder |
| 5 | `supabase/migrations/2026_09_21_423b_t4d_copilot_rollout_contract.sql` | stap 4 is aangetoond |

Tussen stap 1 en 2 hoort de **eenmalige read-only pre-mergecontrole** groen te
zijn:
`supabase/checks/2026_09_21_423_t4d_premerge_readonly.sql`. Plakbaar in de
Supabase SQL Editor, en strikt read-only: geen insert, update, delete of DDL. Zij
stelt vast dat 423a correct is geland — kolommen aanwezig en nullable, geen
backfill, poorten dicht, readiness levert één volledig dichte rij, het auditslot
staat met de juiste configuratie, en de rolscheiding en bevinding H-18 zijn in
orde. Zij verwacht exact het expand-venster met de twaalf- én
dertien-parametersignatuur en géén gevulde `client_id`. Na een verse koppeling
of 423b is dat laatste geen geldige invariant meer en mag deze controle niet
opnieuw worden gebruikt.

Na stap 5 hoort de herhaalbare **read-only post-contractcontrole** groen te zijn:
`supabase/checks/2026_09_21_423_t4d_postcontract_readonly.sql`. Zij verwacht
exact één dertien-parametersignatuur en accepteert legitiem gevulde
`client_id`-waarden. Alle overige waarborgen blijven gelijk: kolommen nullable,
poorten dicht, volledig dichte readiness voor een onbekend fonds, het exacte
auditslot, rolscheiding en H-18. Dit is voortaan de operationele standcontrole
voor een omgeving waarop 423b is toegepast.

Gebruik daarvoor **niet** de DB-gedragssuite
`2026_09_21_423_t4d_copilot_rollout.sql`: die bewijst gedrag door te schrijven
binnen een transactie die terugrolt, en gebruikt een psql-metacommando. Prima
voor een wegwerp-DB en voor CI, niet voor een echte omgeving.

Verificatie bij stap 4 — een verse koppeling moet een client-id opleveren:

```sql
select count(*) filter (where client_id is null)  as zonder_client_id,
       count(*) filter (where client_id is not null) as met_client_id
  from microsoft_private.verbindingen
 where gekoppeld_op > now() - interval '1 hour';
```

Zolang `zonder_client_id` boven nul blijft voor verse koppelingen, draait er nog
een instantie op de oude signatuur. Die is veilig — zij schrijft `client_id` op
`NULL` en is dus fail-closed voor de Copilot-arm — maar de contract-stap mag dan
nog niet.

## 2. Activatie

> **GEBLOKKEERD.** Activering wacht op twee dingen, niet op één.
>
> 1. Het licentie-, kosten- en consentbesluit uit
>    `COPILOT-RETRIEVAL-407-LICENTIE-EN-CONSENT.md`.
> 2. **#428.** De eerste structurele demoactivering verhuist naar
>    `app365.bestuurdersportaal.com`. Activeren mag pas wanneer die omgeving is
>    ingericht **én** het profiel `app365_m365_demo_copilot` werkelijk in de
>    registry bestaat — niet wanneer het is aangekondigd of gepland.
>
> Het bestaande **PGB-profiel mag hiervoor niet als vervanger worden gebruikt.**
> Het is ingericht voor de PGB-retrievalacceptatieset (#385 onder #354), met een
> eigen doel, eigen testidentiteiten en een eigen rechtenopzet. Het omhangen aan
> een Copilot-demoactivering zou twee proeven met verschillende grenzen in één
> identiteit laten samenvallen, en dan is achteraf niet meer vast te stellen
> onder welke afspraak een retrievalresultaat tot stand kwam.
>
> De T4-D-**code** is en blijft fondsneutraal: zij kent geen PGB, geen app365 en
> geen enkel specifiek fonds. Deze blokkade is operationeel en hoort in dit
> runbook, niet in een `if` in de readinesspoort.

Zodra beide voorwaarden zijn vervuld:

1. **Herconsent** voor de identiteit van het onder #428 ingerichte profiel, via
   de bestaande koppelflow. Zonder dat blijft `client_id` leeg en is readiness
   `configuratie_ongeldig`. Er wordt niets gebackfilled: een bestaande rij kan
   onder een andere appregistratie zijn ontstaan — en dat is hier geen
   theoretisch geval, want de verhuizing naar `app365` brengt juist een andere
   appregistratie mee.
2. **Billingbewijs**:
   ```sql
   select microsoft_private.copilot_zet_billingbewijs('<fonds-uuid>', true, '<actor>', '<reden>');
   ```
3. **Fondsflag** `microsoft_copilot_retrieval` openzetten via de bestaande
   configlaag (`fonds.config.manage`). De readinesspoort telt **uitsluitend de
   jsonb-waarde `true`**, niet de string `"true"` en niet `1`. De generieke
   `flagAlsBoolean` van de applicatie is ruimer; voor deze poort is dat te ruim,
   want een vlag die niet eenduidig aan staat hoort dicht te blijven. Controleer
   dus na het zetten:
   ```sql
   select waarde, jsonb_typeof(waarde) from public.fonds_feature_flags
    where fonds_id = '<fonds-uuid>' and flag_key = 'microsoft_copilot_retrieval';
   ```
   `jsonb_typeof` moet `boolean` geven, niet `string`.
4. **Globale kill switch**:
   ```sql
   select microsoft_private.copilot_zet_rollout(true, '<actor>', '<reden>');
   ```
5. **Readiness aantonen** — pas wanneer die `gereed` oplevert, inclusief
   tokenbevestiging, mag er één geautoriseerde Retrieval-call volgen.

Controleer vóór stap 1 dat het profiel er werkelijk is. Een aangekondigd profiel
is geen profiel:

```sql
-- Het fonds waaronder #428 is ingericht moet bestaan én de flag moet DAAR staan.
select id, naam, slug from public.fondsen where slug = '<app365-demofonds-slug>';
```

Levert dit niets op, dan is #428 niet ingericht en stopt de activering hier.

Elke operatoraanroep legt actor, reden **en** `session_user` vast in
`microsoft_private.copilot_operator_log`. Die laatste zet de functie zelf: binnen
een `SECURITY DEFINER` wijst `current_user` naar de eigenaar en is dus waardeloos
voor attributie, en een parameter zou vervalsbaar zijn.

## 3. Herstel

```sql
select microsoft_private.copilot_zet_rollout(false, '<actor>', '<reden>');
```

### Vensterblokkade

Een weigering of een 429 zet de arm voor een venster stil. **Het schrijven van
`copilot_blokkade` is belegd bij T4-E (#426)**, voor de 429 en de daarvoor
aangewezen toegangsweigering; tot die adapter er is blijft
`tijdelijk_geblokkeerd` altijd `false` en is dit pad alleen handmatig te
gebruiken. De applicatierol mag het zelf registreren:

```sql
select microsoft_private.copilot_registreer_blokkade(
  '<fonds-uuid>', '<gebruiker-uuid of null>', now() + interval '15 minutes', '<reden>');
```

`gebruiker_id = null` blokkeert het hele fonds — passend bij een 429, die de
appregistratie treft en dus iedereen raakt. De functie kan een blokkade alleen
**verlengen**, nooit inkorten: de arm mag zijn eigen rem niet losdraaien. Er is
bewust geen applicatiepad om een blokkade eerder op te heffen; zij verloopt
vanzelf.

Dat is het hele herstelpad voor een incident. Daarna is de arm inert, ongeacht
fondsflag, billing of consent — daarom staat de kill switch vooraan in de
evaluatievolgorde en niet achteraan.

### De vier rollbackfasen

Elke fase is een **apart bestand** met een eigen preflight en eindcontrole, draait
in **één transactie**, en weigert tot haar voorwaarde aantoonbaar is vervuld. Dat
is geen formaliteit: één plakbaar bestand zou alle fasen binnen een seconde
achter elkaar uitvoeren, en dan veroorzaakt de rollback precies de storing die de
fasering moet voorkomen.

| Fase | Bestand (`supabase/rollbacks/2026_09_21_423_t4d_copilot_…`) | Voorwaarde | Wat erna moet gebeuren |
|---|---|---|---|
| 1 | `fase1_killswitch_ROLLBACK.sql` | geen | — hier stopt een incident |
| 2 | `fase2_signatuur_ROLLBACK.sql` | kill switch staat uit | **oude code deployen en waarnemen** |
| 3 | `fase3_poorten_ROLLBACK.sql` | fase 2 gedraaid, deploy bevestigd | — |
| 4 | `fase4_kolommen_ROLLBACK.sql` | fase 3 gedraaid, deploy bevestigd | — |

**De poorten verdwijnen pas in fase 3, ná de deploy.** Dat is een correctie na de
review op PR #425. Zou fase 3 vóór de deploy draaien, dan verdwijnt
`copilot_lees_readiness` onder draaiende nieuwe code — juist de functie waarmee
die code vaststelt dat de kill switch uit staat. Elke retrievalbeurt zou dan
falen op een ontbrekend leespad in plaats van netjes inert te zijn. Dezelfde
redenering geldt voor `copilot_rollout`: readiness leest die tabel, dus haar
eerder droppen breekt readiness net zo goed.

De cijfers, niet letters, maken de uitvoervolgorde alfabetisch zichtbaar.

#### Uitvoeren

De bestanden zijn **SQL-editorvast**: geen psql-metacommando's, dus ze zijn te
plakken in de Supabase SQL Editor én te draaien met `psql`. Parameters gaan via
`set_config` met een in te vullen placeholder. Vervang bovenaan het bestand
`VUL_IN` door de echte waarde:

```sql
select set_config('t4d.actor', 'jouw-naam', true),
       set_config('t4d.reden', 'waarom je dit doet', true);
```

Een onbewerkt bestand weigert zichzelf — `VUL_IN` is geen geldige waarde.

Fase 3 en 4 vragen **twee** waarden, geen één:

```sql
select set_config('t4d.oude_code_gedeployd', 'ja', true),
       set_config('t4d.deploy_moment', '2026-09-21T14:05:00+02:00', true);
```

#### Fase 3 en 4 vragen twee bewijzen

Beide fasen zijn in de praktijk onomkeerbaar (fase 4 letterlijk: de kolomwaarden
zijn erna weg). Daarom is één bewijs er één te weinig:

1. **Gegevens** — geen koppeling met een gevulde `client_id` **ná het opgegeven
   deploymoment**. Schrijft er nog iets, dan draait de nieuwe code nog.
2. **Verklaring** — `t4d.oude_code_gedeployd` op `'ja'`.

Het eerste is stil groen op een omgeving waar toevallig niemand koppelt; het
tweede dwingt af dat iemand heeft gekeken. Andersom vangt het eerste een
verklaring die te goeder trouw maar onjuist is.

`t4d.deploy_moment` is het **waargenomen** moment van de terugdraai-deploy, als
tijdstempel met tijdzone. Het is bewust geen vast venster: koppelingen van vóór
die deploy zijn terecht geschreven door code die toen nog draaide, en zouden een
correcte rollback anders onnodig tegenhouden. Alleen writes ná dat moment zeggen
iets over de huidige stand.

Twee wachten op die waarde:

- een moment **in de toekomst** wordt geweigerd — dan meet de controle een leeg
  venster en stelt zij niets vast;
- een moment van **minder dan twee minuten geleden** geeft een waarschuwing: neem
  de deploy eerst werkelijk waar, anders meet de controle nog niets.

#### De generator

Fase 2 **voert** het herstel van de twaalf-parametersignatuur uit — het is geen
aanwijzing in commentaar. Zij bouwt de body op de kolommen zoals ze op dát moment
zijn. Fase 4 verandert die en roept de generator daarom nog één keer aan voordat
zij hem opruimt; zonder die tweede aanroep verwijst de herstelde functie naar
`client_id` die dan net is gedropt, en breekt de eerste koppelpoging.

De generator krijgt, als elke nieuwe functie, standaard `EXECUTE` voor `PUBLIC`
(bevinding H-18). Fase 2 trekt dat expliciet in voor `public`, `anon`,
`authenticated` en `service_role`, en haar eindcontrole faalt als dat niet is
gelukt.

#### Het auditspoor blijft

`microsoft_private.copilot_operator_log` blijft in **alle** fasen staan, met zijn
append-only trigger. Dat is auditdata — wie de rem wanneer en waarom bediende —
en append-only audit is niet-onderhandelbaar. Wil je die tabel tóch kwijt, dan is
dat een aparte bewuste handeling: eerst exporteren, dan expliciet akkoord op het
auditverlies, dan handmatig droppen. Geen rollbackbestand doet het voor je.

Elke fase toetst dat slot ook werkelijk, niet alleen "er staat een trigger":
naam `trg_copilot_operator_log_append_only`, de functie
`microsoft_private.copilot_log_append_only` eronder, de enabled-status, en dekking
op zowel `UPDATE` als `DELETE` (`BEFORE ... FOR EACH ROW`). Daarna volgt één echte
mutatiepoging, want metadata kan kloppen terwijl de functie eronder niets doet.
Faalt een van die controles, dan rolt de hele fase terug — inclusief wat zij al
had gedaan. Breng het slot dan eerst in orde; zie de noodroute bij fase 1 als de
arm intussen écht uit moet.

## 4. Wat deze poorten niet doen

- geen consent verlenen of scopes toevoegen — `Sites.Read.All` bestaat in de code
  uitsluitend als declaratieve constante voor claimcontrole en staat bewust niet
  in `MICROSOFT_TOEGESTANE_SCOPES`, zodat geen consentroute hem kan aanvragen;
- geen billing of licentie regelen — het billingbewijs legt alleen vast dát het
  geregeld is;
- geen Retrieval-call doen — `beoordeelToelating` levert hooguit een toegelaten
  token op; wat daarmee gebeurt is aan de adapter;
- geen blokkade opheffen — `copilot_registreer_blokkade` kan alleen verlengen.
