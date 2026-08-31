# EPIC P → Productie: migratiedraaiboek

**Status: NOG NIET UITVOEREN.** Dit is de productiereeks ná een waargenomen en
stabiele Preview-release. Hij is geen vervanging voor
[`MIGRATIEDRAAIBOEK-EPIC-P-PREVIEW.md`](./MIGRATIEDRAAIBOEK-EPIC-P-PREVIEW.md):
die geldt uitsluitend voor Preview.

**Doelomgeving:** uitsluitend Supabase Productie. Pas de bestanden één voor één,
byte-identiek en in deze volgorde toe in de SQL Editor. Gebruik niet
`supabase db push`: deze reeks bevat bewust handmatige, niet-hernummerde
migraties. Stop bij de eerste fout.

> **Vaste grenzen.** `ENFORCE_CAPABILITY` (#210/0186) blijft ongewijzigd en
> buiten dit uitrolvenster. #207 is een productie-afschriftcontrole, geen reden
> om historische afschriften te herschrijven. Oude backup- of WIP-branches zijn
> geen integratiebron.

## Go/no-go vóór de eerste SQL-stap

Alleen doorgaan als elke regel aantoonbaar groen is en in het releaselog staat.

- [ ] `preview` bevat de actuele EPIC P-versie en de Preview-waarnemingen zijn
  vastgelegd: processtap afronden, besluit vastleggen, beëindigen en heropenen.
- [ ] De PR `preview` → `main` is de enige productiekandidaat en alle verplichte
  checks én beide `preview-stable` Vercel-deployments zijn groen. Zie
  [`security/RELEASEWEG-PREVIEW-EERST.md`](./security/RELEASEWEG-PREVIEW-EERST.md).
- [ ] De twee uitgestelde karakteriseringsopnames zijn niet meer uitgesteld:
  `POST /procedures/[id]/stappen/[stapId]/afwijking` en
  `GET /procedures/[id]/vereisten/kandidaten`. De uitstellijst is leeg.
- [ ] De nachtelijke Preview-fidelityrun is groen op de huidige Preview-head.
- [ ] De productiemeting voor besluit 0195 is op dezelfde dag vastgelegd. De
  query hieronder geeft exact **0** of **3** terug; 3 is uitsluitend toegestaan
  omdat de drie bestaande dossiers aantoonbaar niet in gebruik zijn. Elke andere
  uitkomst is een stop: dan wordt niet uit versie 1.0.0 verwijderd maar volgt
  eerst een nieuw definitiebesluit.
- [ ] De uitvoerder heeft de rollbackbestanden voor alle 31 SQL-stappen geopend
  en een herstelpad is afgesproken. Zie ook
  [`security/RUNBOOK-MIGRATIES.md`](./security/RUNBOOK-MIGRATIES.md).
- [ ] Een herleidbaar productieherstelpad (backup/PITR) is bevestigd voor het
  uitrolvenster. Ontbreekt dit, dan geen niet-transactionele of destructieve
  uitbreiding van deze release.

```sql
select count(*) as gepinde_dossiers
  from public.procedures p
 where p.template_code = 'beleidswijziging_beleggingsbeleid'
   and p.template_versie = '1.0.0';
```

## Uitvoervolgorde

| # | Bestand | Doet | Code | Rollback bij afbreken |
|---:|---|---|---|---|
| 1 | Geen SQL: `2026_05_08_phase_1b_template_requirements.sql` | Historische seed blijft ongewijzigd en wordt niet opnieuw toegepast. | Geen. | n.v.t. |
| 2 | `2026_08_24_p1b_versievastheid.sql` | Bevroren publicatie- en requirementversies. | DB vóór code. | `2026_08_24_p1b_versievastheid_ROLLBACK.sql` |
| 3 | `2026_08_24_p2a_01_bewijsindex_nietuniek.sql` | Bewijsindex voor expliciete requirementbinding. | DB vóór code. | `2026_08_24_p2a_01_bewijsindex_nietuniek_ROLLBACK.sql` |
| 4 | `2026_08_24_p2a_02_gedeelde_bindingsmachinerie.sql` | Gedeelde fail-closed bindingstoets en auditspoor. | DB vóór code. | `2026_08_24_p2a_02_gedeelde_bindingsmachinerie_ROLLBACK.sql` |
| 5 | `2026_08_24_p2a_03_risk_binding.sql` | Risicofeitbinding. | DB vóór code. | `2026_08_24_p2a_03_risk_binding_ROLLBACK.sql` |
| 6 | `2026_08_24_p2a_04_assumption_binding.sql` | Aannemefeitbinding. | DB vóór code. | `2026_08_24_p2a_04_assumption_binding_ROLLBACK.sql` |
| 7 | `2026_08_24_p2a_05_kpi_binding.sql` | Voorwaarde/KPI-feitbinding. | DB vóór code. | `2026_08_24_p2a_05_kpi_binding_ROLLBACK.sql` |
| 8 | `2026_08_24_p2a_06_evaluation_binding.sql` | Evaluatiefeitbinding. | DB vóór code. | `2026_08_24_p2a_06_evaluation_binding_ROLLBACK.sql` |
| 9 | `2026_08_24_p2a_07_aivalidation_binding.sql` | AI-validatiefeitbinding. | DB vóór code. | `2026_08_24_p2a_07_aivalidation_binding_ROLLBACK.sql` |
| 10 | `2026_08_24_p2a_08_approval_binding.sql` | Formele-besluitbinding. | DB vóór code. | `2026_08_24_p2a_08_approval_binding_ROLLBACK.sql` |
| 11 | `2026_08_24_p2a_09_procedure_vaststelling.sql` | Procedure-vaststelling met binding, RLS en audit. | DB vóór P2-code. | `2026_08_24_p2a_09_procedure_vaststelling_ROLLBACK.sql` |
| 12 | `2026_08_25_p2b_01_i1_ontkoppelslot.sql` | I1-slot bij ontkoppelen. | DB vóór code. | `2026_08_25_p2b_01_i1_ontkoppelslot_ROLLBACK.sql` |
| 13 | `2026_08_27_p3b_01_zwaarte.sql` | Expliciete requirement-zwaarte. | DB vóór P3-code. | `2026_08_27_p3b_01_zwaarte_ROLLBACK.sql` |
| 14 | `2026_08_27_p3b_02_booleans_generated.sql` | Afgeleide P3-booleans. | DB vóór P3-code. | `2026_08_27_p3b_02_booleans_generated_ROLLBACK.sql` |
| 15 | `2026_08_27_p3c_01_afwijking_kolommen.sql` | Vier afwijkingskolommen en constraints. | DB vóór code. | `2026_08_27_p3c_01_afwijking_kolommen_ROLLBACK.sql` |
| 16 | `2026_08_27_p3c_02_fn_afronden_afwijking.sql` | Atomaire afwijkings-RPC. | DB vóór route. | `2026_08_27_p3c_02_fn_afronden_afwijking_ROLLBACK.sql` |
| 17 | `2026_08_28_p3d_01_readiness_drop.sql` | Bereidt besluitomslag voor. | DB vóór 18–21. | `2026_08_28_p3d_01_readiness_drop_ROLLBACK.sql` |
| 18 | `2026_08_28_p3d_02_fn_besluit_status_omslag.sql` | Bewaakte statusomslag-RPC. | DB vóór route. | `2026_08_28_p3d_02_fn_besluit_status_omslag_ROLLBACK.sql` |
| 19 | `2026_08_28_p3d_03_status_kolomrevoke.sql` | Neemt directe browserwrite op besluitstatus weg. | DB vóór code. | `2026_08_28_p3d_03_status_kolomrevoke_ROLLBACK.sql` |
| 20 | `2026_08_28_p3d_04_open_per_decision.sql` | Open vereisten decision-scoped. | DB vóór route. | `2026_08_28_p3d_04_open_per_decision_ROLLBACK.sql` |
| 21 | `2026_08_28_p3d_05_insert_besluitstatus_slot.sql` | Sluit directe besluitstatus-insert. | DB vóór code. | `2026_08_28_p3d_05_insert_besluitstatus_slot_ROLLBACK.sql` |
| 22 | `2026_08_29_p4_01_statusdragers.sql` | P4-statusdragers. | DB vóór P4-code. | `2026_08_29_p4_01_statusdragers_ROLLBACK.sql` |
| 23 | `2026_08_29_p4_03_niet_begonnen_actief_trigger.sql` | P4-activeringstriggers. `p4_02` ontbreekt bewust: tranche 2 was uitsluitend TypeScript. | DB vóór P4-code. | `2026_08_29_p4_03_niet_begonnen_actief_trigger_ROLLBACK.sql` |
| 24 | `2026_08_29_p4_04_status_feitenmatrix.sql` | Status-feitenmatrix en I1-trigger. | DB vóór 25–27. | `2026_08_29_p4_04_status_feitenmatrix_ROLLBACK.sql` |
| 25 | `2026_08_29_p4_05_besluitmoment_arm.sql` | Besluitmoment-arm in `fn_stap_open_per_zwaarte`. | DB vóór P4-statusomslagen. | `2026_08_29_p4_05_besluitmoment_arm_ROLLBACK.sql` |
| 26 | `2026_08_29_p4_06_procedure_beeindigen_heropenen.sql` | Procedure beëindigen/heropenen met feit. | DB vóór routes. | `2026_08_29_p4_06_procedure_beeindigen_heropenen_ROLLBACK.sql` |
| 27 | `2026_08_29_p4_07_besluit_heropenen_correctie.sql` | Atomaire statusfeiten en heropenen. | DB vóór route. | `2026_08_29_p4_07_besluit_heropenen_correctie_ROLLBACK.sql` |
| 28 | `2026_08_29_p4_08_i5_composite_fk.sql` | I5-fondsgrens via composite foreign keys. | DB vóór code. | `2026_08_29_p4_08_i5_composite_fk_ROLLBACK.sql` |
| 29 | `2026_08_29_zz_0195_verwijder_onvervulbare_templatevereisten.sql` | Eenmalige gemeten 0195-correctie. Fout bij elk aantal anders dan 0 of de bevestigde 3; I7-trigger alleen transactioneel tijdelijk uit en vóór commit weer geverifieerd actief. | DB vóór code, pas na de meting hierboven. | `2026_08_29_zz_0195_verwijder_onvervulbare_templatevereisten_ROLLBACK.sql` |
| 30 | `2026_08_30_actie_eigenaar_profiel.sql` | Interne actiehouder aan profiel in hetzelfde fonds. | DB vóór P5-code. | `2026_08_30_actie_eigenaar_profiel_ROLLBACK.sql` |
| 31 | `2026_08_30_p5a_02_actie_eigenaar_externe_houder.sql` | Externe houder: geen profiel, wel niet-lege naam. | Direct na 30. | `2026_08_30_p5a_02_actie_eigenaar_externe_houder_ROLLBACK.sql` |
| 32 | `2026_08_30_p5c_procedure_stap_notitie.sql` | Gedeelde stap-aantekeningen met I5, RLS en statusneutraliteit. | DB vóór P5c-code. | `2026_08_30_p5c_procedure_stap_notitie_ROLLBACK.sql` |

## Verplichte tussenijkpunten

**Na stap 12:** alle drie waarden moeten `true` zijn.

```sql
select
  to_regclass('public.procedure_vaststelling') is not null as procedure_vaststelling,
  to_regprocedure('public.fn_assert_gebonden_feit(uuid,uuid,text,text)') is not null as bindingspoort,
  exists (select 1 from pg_trigger where tgname = 'trg_vaststelling_i1' and not tgisinternal) as i1_ontkoppelslot;
```

**Na stap 21:** alle drie waarden moeten `true` zijn.

```sql
select
  to_regprocedure('public.fn_besluit_status_omslag(uuid,text,text,text,jsonb)') is not null as statusomslag_rpc,
  not has_column_privilege('authenticated', 'public.decision_objects', 'status', 'UPDATE') as status_direct_dicht,
  exists (select 1 from pg_trigger where tgname = 'trg_decision_status_insert_guard' and not tgisinternal) as status_insert_slot;
```

> **Verwacht onderbroken venster na stap 19.** De oude productiecode gebruikt
> dan nog het ingetrokken directe schrijfpad. Voer daarom geen browsertest uit
> tussen stap 19 en de code-deploy; rond de SQL-reeks eerst af. Dit venster moet
> zo kort mogelijk zijn en valt binnen het afgesproken onderhoudsvenster.

## Code, gates en waarneming

1. Merge pas de groene PR `preview` → `main`; de Vercel-productiedeploy volgt
   daarna automatisch. Wijzig geen enforce-vlag tijdens deze deploy.
2. Draai direct tegen de productiedatabase, met `ON_ERROR_STOP=1`, ten minste:
   - `supabase/checks/2026_07_31_r1_structurele_gates.sql`
   - `supabase/checks/2026_08_20_v3_grants_volledig.sql`
   - `supabase/checks/2026_08_28_p214a1_schrijfpoort.sql`
   - `supabase/checks/2026_08_29_p214a2_afwijkingskolommen_schrijfpoort.sql`
   - `supabase/checks/2026_08_28_p3d_besluit_omslag.sql`
   - `supabase/checks/2026_08_29_p4_04_status_feitenmatrix.sql`
   - `supabase/checks/2026_08_29_p4_i5_composite_fk.sql`
   - `supabase/checks/2026_08_29_zz_0195_vervullingspad.sql`
   - `supabase/checks/2026_08_31_secdef_self_gate.sql`
3. Doe op productie als bevoegde testrol: processtap afronden, besluit
   vastleggen, beëindigen en heropenen. Noteer deployment-id, rol, tijd en
   uitkomst in het releaselog.
4. Draai na de release de driftcontrole. Alleen een groene driftcontrole, gates
   en productiewaarneming sluiten de release af.

## Afbreken en rollback

**Vóór de code-deploy:** code terugzetten is een no-op. Rol uitsluitend de al
toegepaste SQL-stappen terug, strikt in omgekeerde volgorde, en draai daarna de
structurele en V3-grantgates. Sla geen afhankelijke rollback over.

**Ná de code-deploy:** herstel eerst de vorige `main`-deploy zodat code en
databasevorm weer passen. Rol daarna uitsluitend de werkelijk toegepaste
migraties terug in omgekeerde volgorde. Een gedeeltelijk mislukte rollback is
stop en onderzoek, geen aanleiding om door te gaan met een volgende stap.

Leg bij elke uitkomst vast: commit-SHA, omgeving, bestanden, tijdstippen,
uitvoerder, tussenijkpunten, gate-uitvoer, Vercel-deployment en rollbackbesluit.
