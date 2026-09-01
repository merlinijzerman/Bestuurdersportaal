# EPIC P → Productie: migratiedraaiboek

**Status: CORRECTIEVE STAP 36 NOG NIET UITVOEREN.** Stap 36 mag uitsluitend via
de correctieve gang hieronder, na nieuw Preview-bewijs en een afzonderlijke
productiego/no-go.

Dit draaiboek is geen vervanging voor
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
- [ ] De uitvoerder heeft de rollbackbestanden voor alle rollbackbare SQL-stappen
  geopend en een herstelpad is afgesproken. Dit betreft stappen 2–32 en 34;
  stappen 33, 35 en 36 hebben bewust geen database-rollback na commit.
  Zie ook
  [`security/RUNBOOK-MIGRATIES.md`](./security/RUNBOOK-MIGRATIES.md).
- [ ] Een herleidbaar productieherstelpad (backup/PITR) is bevestigd voor het
  uitrolvenster. Ontbreekt dit, dan geen niet-transactionele of destructieve
  uitbreiding van deze release.
- [ ] Het Preview-bewijs voor bevinding 2a/2b is volledig groen en vastgelegd in
  [`RELEASEBEWIJS-228-2A-2B-PREVIEW-2026-08-31.md`](./RELEASEBEWIJS-228-2A-2B-PREVIEW-2026-08-31.md).
  De applicatiecode is gevalideerd op `d8821cfd87a61ebc3c573f82d99b71d9c89aad54`.
  Leg de uiteindelijke Preview-head inclusief uitsluitend gereviewde
  baseline-/runbookcommits vlak voor de productie-PR exact vast; neem geen
  latere commit mee zonder een nieuwe Preview-waarneming.
- [ ] Vlak vóór stap 35 is de handmatige 2.0.1-productiemigratie nogmaals expliciet
  door de opdrachtgever goedgekeurd.
- [ ] Vlak vóór stap 36 is de nieuwe forward-migratie byte-identiek op Preview
  toegepast, zijn `2026_08_28_p214a1_schrijfpoort.sql` en de gedragstoets groen,
  en heeft de opdrachtgever de productiemigratie opnieuw expliciet goedgekeurd.
- [ ] Productie staat aantoonbaar ná stap 34: `procedure_requirements` heeft
  `template_versie`, `procedure_definitie_publicatie` bestaat en de 2.0.0-set
  telt exact 63 requirements. Ontbreekt één van deze voorwaarden, dan is stap 35
  **geen zelfstandige migratie**: stop en voer eerst de volledige, gevalideerde
  reeks 2–34 met alle tussenijkpunten uit.

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
| 3 | `2026_08_24_p2a_01_bewijsindex_nietuniek.sql` | Bewijsindex voor expliciete requirementbinding. De #263-preflight matcht versie-vast op de volledige requirementsleutel; een hoge drempel van een andere requirement op dezelfde stap telt niet mee. | DB vóór code. | `2026_08_24_p2a_01_bewijsindex_nietuniek_ROLLBACK.sql` |
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
| 33 | `2026_08_31_contact_notificatie_status_herstel.sql` | Herstelt de begrensde publieke contactstatus-RPC die per abuis niet in de Preview-baseline zat: maximaal 1 uur, alleen nog niet gemarkeerde rij en fouttekst op 500 tekens. | DB vóór code; bestaande route blijft compatibel. | Geen veilige DB-rollback: behoud de reparatie en herstel zo nodig uitsluitend code/deploy. |
| 34 | `2026_08_31_p5d_procedure_beeindigen_bediening.sql` | Maakt beëindigen/heropenen auditinhoudelijk compleet: snapshot en herstel van stappen, open-vereistentelling en verplichte getypeerde heropenreden. | DB vóór P5d-code. | `2026_08_31_p5d_procedure_beeindigen_bediening_ROLLBACK.sql` |
| 35 | `2026_08_31_zz_pf_wtp_invaarbesluit_201_approval.sql` | Publiceert I7-conform `pf_wtp_invaarbesluit@2.0.1`: kopieert de bevroren 63 requirements van 2.0.0, voegt op stap 1 exact één approval toe en publiceert pas als laatste. | **DB vóór code.** Pas na de groene controlequery mag `preview` naar `main`. | Geen database-rollback na commit: het publicatieregister is append-only. Bij een deployprobleem code terug naar de vorige release; 2.0.1 blijft ongebruikt gepubliceerd. Bij iedere fout vóór commit rolt de transactie volledig terug en stopt de uitrol. |
| 36 | `2026_09_01_p214a1_05_stap_insert_guard_herbevestiging.sql` | Herbevestigt deterministisch `fn_guard_stap_insert()` en `trg_guard_stap_insert`; als beide al aanwezig zijn blijft het contract gelijk, bij een incomplete omgeving worden uitsluitend deze objecten aangevuld. | **DB vóór code.** Compatibel met de vorige én de opnieuw te promoveren code. Code pas promoveren nadat eindcontrole en P214a1-gates groen zijn. | Geen veilige DB-rollback: verwijderen heropent de INSERT-omzeiling. Fout vóór commit rolt volledig terug en stopt de uitrol; fout na commit laat de guard actief en rolt uitsluitend code terug. |

## Verplichte tussenijkpunten

**Na stap 2, vóór stap 3:** de exacte, versievaste toets moet `0` geven. Een
andere uitkomst is een stop; corrigeer geen dossier en schakel de guard niet uit.

```sql
select count(*) as exact_gebonden_op_hoge_drempel
  from public.procedure_bewijs pb
  join public.procedure_stappen ps on ps.id = pb.stap_id
  join public.procedures p on p.id = ps.procedure_id
  join public.procedure_requirements r
    on r.template_code = p.template_code
   and r.template_versie = p.template_versie
   and r.stap_volgorde = ps.volgorde
   and pb.requirement_sleutel =
         r.stap_volgorde::text || '|' || r.requirement_type || '|' ||
         coalesce(r.documenttype, r.label)
 where pb.requirement_sleutel is not null
   and coalesce(r.min_aantal, 1) > 1;
```

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
  exists (select 1 from pg_trigger where tgname = 'trg_decision_insert_status_slot' and not tgisinternal) as status_insert_slot;
```

> **Verwacht onderbroken venster na stap 19.** De oude productiecode gebruikt
> dan nog het ingetrokken directe schrijfpad. Voer daarom geen browsertest uit
> tussen stap 19 en de code-deploy; rond de SQL-reeks eerst af. Dit venster moet
> zo kort mogelijk zijn en valt binnen het afgesproken onderhoudsvenster.

**Na stap 34:** de P5d-signaturen en browserrechten moeten exact kloppen; draai
`supabase/checks/2026_08_31_p5d_procedure_beeindigen_gedrag.sql` vóór stap 35.

## Tussenijkpunt bevinding 2a/2b — direct na stap 35

Vóór stap 35 moet eerst de schemagate volledig `true` zijn. Deze query blijft ook
veilig uitvoerbaar op een oudere productiebaseline.

```sql
select
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'procedure_requirements'
       and column_name = 'template_versie'
  ) as requirements_versievast,
  to_regclass('public.procedure_definitie_publicatie') is not null
    as publicatieregister_aanwezig;
```

Pas wanneer beide waarden `true` zijn, moet de inhoudscontrole hieronder exact
`63 / 0 / false` opleveren. Een ontbrekende kolom of tabel, of een andere
inhoudsuitkomst, is een stop: geen losse inserts, geen guards uitschakelen en
geen reeds gepubliceerde versie aanpassen.

```sql
select
  count(*) filter (where template_versie = '2.0.0') as versie_200_requirements,
  count(*) filter (where template_versie = '2.0.1') as versie_201_requirements,
  exists (
    select 1
      from public.procedure_definitie_publicatie
     where template_code = 'pf_wtp_invaarbesluit'
       and template_versie = '2.0.1'
  ) as versie_201_gepubliceerd
from public.procedure_requirements
where template_code = 'pf_wtp_invaarbesluit';
```

Direct na stap 35 moet de volgende query exact `63 / 64 / 1 / true` opleveren.
Pas daarna mag de codepromotie beginnen.

```sql
select
  count(*) filter (where template_versie = '2.0.0') as versie_200_requirements,
  count(*) filter (where template_versie = '2.0.1') as versie_201_requirements,
  count(*) filter (
    where template_versie = '2.0.1'
      and stap_volgorde = 1
      and requirement_type = 'approval'
      and label = 'Vaststellingsbesluit opdrachtontvangst en duiding'
  ) as juiste_approval,
  exists (
    select 1
      from public.procedure_definitie_publicatie
     where template_code = 'pf_wtp_invaarbesluit'
       and template_versie = '2.0.1'
  ) as versie_201_gepubliceerd
from public.procedure_requirements
where template_code = 'pf_wtp_invaarbesluit';
```

**Stopactie voor stap 35.** Fout vóór `commit`: de transactie heeft niets
gepubliceerd; noteer de letterlijke fout en stop. Fout ná een geslaagde commit:
verwijder of wijzig 2.0.1 niet. Laat de vorige productiecode actief of herstel die
deploy, en start geen nieuw 2.0.1-proces totdat een nieuwe codepromotie groen is.

## Correctieve hervatting — stap 36

De hervatting is een nieuwe migratie-eerst-release en geen voortzetting in
dezelfde uitvoersessie:

1. Open de correctie-PR naar `preview` en wacht op alle PR-, CI- en beide
   Vercel-previewchecks, maar merge nog niet.
2. Pas daarna, vóór de codemerge,
   `2026_09_01_p214a1_05_stap_insert_guard_herbevestiging.sql` byte-identiek
   toe op de echte Preview-database.
3. Draai daar direct de structurele P214a1-gate én
   `2026_09_01_p214a1_05_stap_insert_guard_herbevestiging.sql` en daarna de volledige
   `2026_08_28_p214a1_gedrag.sql`; alle drie moeten groen zijn.
4. Merge alleen bij groen naar `preview`, wacht op de beide `preview-stable`
   deployments en leg het nieuwe Preview-bewijs vast. Vraag daarna vlak vóór
   Productie opnieuw expliciete gebruikersgoedkeuring.
5. Pas uitsluitend stap 36 op Productie toe. Stop bij iedere fout; geen losse
   `CREATE FUNCTION`, `CREATE TRIGGER`, grants of uitgeschakelde guards.
6. Draai direct de controlequery hieronder, gevolgd door de volledige statische
   en gedragsmatige P214a1-gates, inclusief de smalle hersteltoets.
7. Alleen bij groen: promoveer exact de Preview-gevalideerde commit naar `main`,
   verwijder daarmee de Vercel-rollback en doorloop opnieuw alle productiepoorten,
   smoketests en driftcontrole.

De directe controlequery moet exact `true / true / true / true` geven:

```sql
select
  to_regprocedure('public.fn_guard_stap_insert()') is not null
    as insert_guard_functie,
  exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'procedure_stappen'
       and t.tgname = 'trg_guard_stap_insert'
       and not t.tgisinternal
       and t.tgenabled = 'O'
  ) as insert_guard_trigger,
  not has_function_privilege(
    'authenticated', 'public.fn_guard_stap_insert()', 'execute'
  ) as geen_directe_authenticated_execute,
  not has_function_privilege(
    'anon', 'public.fn_guard_stap_insert()', 'execute'
  ) as geen_directe_anon_execute;
```

**Stopactie voor stap 36.** Fout vóór `commit`: de transactie heeft niets
gewijzigd; leg de letterlijke fout vast en stop. Fout na commit of bij een
latere code-/gatecontrole: laat functie en trigger actief, herstel uitsluitend
de code-deploy en registreer een nieuwe bevinding. De geblokkeerde rollbackfile
maakt deze grens uitvoerbaar zichtbaar.

## Code, gates en waarneming

1. Voer voor stap 36 eerst de correctieve stappen hierboven uit. Merge pas
   daarna de groene PR `preview` → `main`; de
   Vercel-productiedeploy volgt automatisch en heft de Instant Rollback op.
   Wijzig geen enforce-vlag tijdens deze deploy.
2. Draai direct tegen de productiedatabase, met `ON_ERROR_STOP=1`, ten minste:
   - `supabase/checks/2026_07_31_r1_structurele_gates.sql`
   - `supabase/checks/2026_08_20_v3_grants_volledig.sql`
   - `supabase/checks/2026_08_28_p214a1_schrijfpoort.sql`
   - `supabase/checks/2026_09_01_p214a1_05_stap_insert_guard_herbevestiging.sql`
   - `supabase/checks/2026_08_29_p214a2_afwijkingskolommen_schrijfpoort.sql`
   - `supabase/checks/2026_08_28_p3d_besluit_omslag.sql`
   - `supabase/checks/2026_08_29_p4_04_status_feitenmatrix.sql`
   - `supabase/checks/2026_08_29_p4_i5_composite_fk.sql`
   - `supabase/checks/2026_08_29_zz_0195_vervullingspad.sql`
   - `supabase/checks/2026_08_31_p2c_ongebonden_besluit.sql`
   - `supabase/checks/2026_08_31_p5d_procedure_beeindigen_gedrag.sql`
   - `supabase/checks/2026_08_31_secdef_self_gate.sql`
3. Doe op productie als bevoegde testrol: processtap afronden, besluit
   vastleggen, beëindigen en heropenen. Noteer deployment-id, rol, tijd en
   uitkomst in het releaselog.
4. Draai na de release de driftcontrole. Alleen een groene driftcontrole, gates
   en productiewaarneming sluiten de release af.

## Afbreken en rollback

**Vóór de code-deploy:** code terugzetten is een no-op. Rol uitsluitend de al
toegepaste rollbackbare SQL-stappen terug, strikt in omgekeerde volgorde, en
draai daarna de structurele en V3-grantgates. Sla geen afhankelijke rollback
over. Stappen 33, 35 en 36 blijven staan volgens hun expliciete stopactie.

**Ná de code-deploy:** herstel eerst de vorige `main`-deploy zodat code en
databasevorm weer passen. Rol daarna uitsluitend de werkelijk toegepaste
migraties terug in omgekeerde volgorde. Een gedeeltelijk mislukte rollback is
stop en onderzoek, geen aanleiding om door te gaan met een volgende stap.

Leg bij elke uitkomst vast: commit-SHA, omgeving, bestanden, tijdstippen,
uitvoerder, tussenijkpunten, gate-uitvoer, Vercel-deployment en rollbackbesluit.
