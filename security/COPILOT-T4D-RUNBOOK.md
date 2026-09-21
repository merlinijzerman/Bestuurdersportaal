# T4-D runbook — Copilot-rolloutpoorten (#423)

Niets in dit runbook is uitgevoerd. Het beschrijft wat een mens moet doen; de
code en de migraties staan klaar en zijn inert.

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

Uitsluitend na het licentie-, kosten- en consentbesluit uit
`COPILOT-RETRIEVAL-407-LICENTIE-EN-CONSENT.md`.

1. **Herconsent** voor de PGB-testidentiteit via de bestaande koppelflow. Zonder
   dat blijft `client_id` leeg en is readiness `configuratie_ongeldig`. Er wordt
   niets gebackfilled: een bestaande rij kan onder een andere appregistratie zijn
   ontstaan.
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

Elke operatoraanroep legt actor, reden **en** `session_user` vast in
`microsoft_private.copilot_operator_log`. Die laatste zet de functie zelf: binnen
een `SECURITY DEFINER` wijst `current_user` naar de eigenaar en is dus waardeloos
voor attributie, en een parameter zou vervalsbaar zijn.

## 3. Herstel

```sql
select microsoft_private.copilot_zet_rollout(false, '<actor>', '<reden>');
```

### Vensterblokkade

Een weigering of een 429 zet de arm voor een venster stil. De applicatierol
registreert dat zelf:

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

De volledige terugbouw (fasen B tot en met D) staat in
`supabase/rollbacks/2026_09_21_423_t4d_copilot_rollout_ROLLBACK.sql`. Fase C
**voert** het herstel van de twaalf-parametersignatuur uit — het is geen
aanwijzing in commentaar. Draai fase C vóórdat de oude applicatiecode terugkomt:
andersom roept de teruggezette code een functie aan die niet meer bestaat.

Fase C bouwt de body op de kolommen zoals ze op dát moment zijn, en fase D
verandert die. Daarom roept fase D de generator nog één keer aan voordat zij hem
opruimt. Sla die stap niet over: zonder de tweede aanroep verwijst de herstelde
functie naar `client_id`, die dan net is gedropt, en breekt de eerste
koppelpoging. Een slotcontrole in hetzelfde bestand weigert stil te slagen.

## 4. Wat deze poorten niet doen

- geen consent verlenen of scopes toevoegen — `Sites.Read.All` bestaat in de code
  uitsluitend als declaratieve constante voor claimcontrole en staat bewust niet
  in `MICROSOFT_TOEGESTANE_SCOPES`, zodat geen consentroute hem kan aanvragen;
- geen billing of licentie regelen — het billingbewijs legt alleen vast dát het
  geregeld is;
- geen Retrieval-call doen — `beoordeelToelating` levert hooguit een toegelaten
  token op; wat daarmee gebeurt is aan de adapter;
- geen blokkade opheffen — `copilot_registreer_blokkade` kan alleen verlengen.
