# EPIC P → Preview: migratiedraaiboek

**Doelomgeving:** uitsluitend Supabase Preview.  Pas ieder bestand hieronder in
deze volgorde, volledig en één voor één toe in de SQL-editor. Stop bij de eerste
fout. De code-deploy volgt pas nadat alle 29 stappen groen zijn.

> Dit is de operationele `preview...epic/proceduremodule-v2`-delta, plus de
> expliciete 0195-datacorrectie aan het eind. De bestandsnamen zijn bewust geen
> Supabase-CLI-timestamps: handmatig toepassen, niet via `supabase db push`.
> De historische migratie van 2026-05-08 wordt **niet opnieuw uitgevoerd** en is
> ongewijzigd hersteld; opnieuw toepassen zou op Preview niets repareren en
> veroorzaakt migratiedrift.

> **0195-voorwaarde en gemeten uitzondering.** P1b moet op de doel-DB al
> aanwezig zijn voor de versiequery hieronder. Ontbreekt
> `procedures.template_versie` nog, gebruik dan tijdelijk de pre-P1b-projectie op
> alleen `template_code`; P1b backfillt deze dossiers anders naar `1.0.0`.
> Gemeten op 29-08-2026: Preview = 0; productie = 3, door de opdrachtgever
> bevestigd als niet in gebruik. Besluit 0195 staat daarom uitsluitend deze twee
> aantallen toe. Elk ander aantal breekt in de migratie én rollback fail-closed
> af. Leg vóór uitvoering de aantallen, het meettijdstip en de gebruikte query
> vast in besluit 0195; zonder die vastlegging is dit geen toegestane uitzondering
> op I7.

```sql
select count(*) as gepinde_dossiers
  from public.procedures p
 where p.template_code = 'beleidswijziging_beleggingsbeleid'
   and p.template_versie = '1.0.0';

-- Alleen zolang P1b nog niet is toegepast:
select count(*) as dossiers_die_naar_1_0_0_worden_gebackfilld
  from public.procedures p
 where p.template_code = 'beleidswijziging_beleggingsbeleid';
```

| # | Migratie | Wat doet hij | Code | Rollback bij afbreken |
|---:|---|---|---|---|
| 1 | Geen SQL uitvoeren: `2026_05_08_phase_1b_template_requirements.sql` | Historische seed is al in mei toegepast en blijft byte-inhoudelijk ongewijzigd. Verifieer alleen dat dit bestand niet in de SQL-editor wordt geplakt. | Geen. | Niet van toepassing. |
| 2 | `2026_08_24_p1b_versievastheid.sql` | Publicatie- en requirementversies append-only/bevroren. | DB vóór code. | `2026_08_24_p1b_versievastheid_ROLLBACK.sql` |
| 3 | `2026_08_24_p2a_01_bewijsindex_nietuniek.sql` | Maakt de bewijsindex geschikt voor expliciete requirementbinding. | DB vóór code. | `2026_08_24_p2a_01_bewijsindex_nietuniek_ROLLBACK.sql` |
| 4 | `2026_08_24_p2a_02_gedeelde_bindingsmachinerie.sql` | Installeert de gedeelde, fail-closed bindingstoets en het auditspoor. | DB vóór code. | `2026_08_24_p2a_02_gedeelde_bindingsmachinerie_ROLLBACK.sql` |
| 5 | `2026_08_24_p2a_03_risk_binding.sql` | Bindt risico-feiten aan de gedeelde P2-machinerie. | DB vóór code. | `2026_08_24_p2a_03_risk_binding_ROLLBACK.sql` |
| 6 | `2026_08_24_p2a_04_assumption_binding.sql` | Bindt aanname-feiten aan de gedeelde P2-machinerie. | DB vóór code. | `2026_08_24_p2a_04_assumption_binding_ROLLBACK.sql` |
| 7 | `2026_08_24_p2a_05_kpi_binding.sql` | Bindt voorwaarde/KPI-feiten aan de gedeelde P2-machinerie. | DB vóór code. | `2026_08_24_p2a_05_kpi_binding_ROLLBACK.sql` |
| 8 | `2026_08_24_p2a_06_evaluation_binding.sql` | Bindt evaluatie-feiten aan de gedeelde P2-machinerie. | DB vóór code. | `2026_08_24_p2a_06_evaluation_binding_ROLLBACK.sql` |
| 9 | `2026_08_24_p2a_07_aivalidation_binding.sql` | Bindt AI-validatie-feiten aan de gedeelde P2-machinerie. | DB vóór code. | `2026_08_24_p2a_07_aivalidation_binding_ROLLBACK.sql` |
| 10 | `2026_08_24_p2a_08_approval_binding.sql` | Bindt formele besluiten/approvals aan de gedeelde P2-machinerie. | DB vóór code. | `2026_08_24_p2a_08_approval_binding_ROLLBACK.sql` |
| 11 | `2026_08_24_p2a_09_procedure_vaststelling.sql` | Voegt procedure-vaststelling toe met binding, RLS en audit. | DB vóór de P2-vaststellingscode. | `2026_08_24_p2a_09_procedure_vaststelling_ROLLBACK.sql` |
| 12 | `2026_08_25_p2b_01_i1_ontkoppelslot.sql` | Borgt I1 bij ontkoppelen: triggers voorkomen een los feit buiten het geldige pad. Draai direct hierna het P2-tussenijkpunt hieronder. | DB vóór code. | `2026_08_25_p2b_01_i1_ontkoppelslot_ROLLBACK.sql` |
| 13 | `2026_08_27_p3b_01_zwaarte.sql` | Maakt requirement-zwaarte expliciet en verplicht. | DB vóór P3-code. | `2026_08_27_p3b_01_zwaarte_ROLLBACK.sql` |
| 14 | `2026_08_27_p3b_02_booleans_generated.sql` | Voegt de afgeleide P3-booleans toe. | DB vóór P3-code. | `2026_08_27_p3b_02_booleans_generated_ROLLBACK.sql` |
| 15 | `2026_08_27_p3c_01_afwijking_kolommen.sql` | Voegt de vier afwijkingskolommen en hun constraints toe. | DB vóór stap 16 en vóór deploy; de browser krijgt geen directe schrijfroute. | `2026_08_27_p3c_01_afwijking_kolommen_ROLLBACK.sql` |
| 16 | `2026_08_27_p3c_02_fn_afronden_afwijking.sql` | Installeert de atomaire RPC voor afronden-met-afwijking. | DB vóór de afwijkingsroute. | `2026_08_27_p3c_02_fn_afronden_afwijking_ROLLBACK.sql` |
| 17 | `2026_08_28_p3d_01_readiness_drop.sql` | Vervangt de oude readiness-constructie als voorbereiding op de besluitomslag. | DB vóór stappen 18–21. | `2026_08_28_p3d_01_readiness_drop_ROLLBACK.sql` |
| 18 | `2026_08_28_p3d_02_fn_besluit_status_omslag.sql` | Levert de bewaakte statusomslag-RPC. | DB vóór de statusroute. | `2026_08_28_p3d_02_fn_besluit_status_omslag_ROLLBACK.sql` |
| 19 | `2026_08_28_p3d_03_status_kolomrevoke.sql` | Ontneemt browserrollen directe schrijfrechten op besluitstatus. **Verwacht onderbroken venster:** tot de deploy gebruikt de oude Preview-code nog het ingetrokken schrijfpad. Preview is in dit venster stuk; dat is verwacht en onschadelijk. Ga door met de resterende migraties, niet met browsertesten. | DB vóór deploy; code gebruikt de RPC uit stap 18. | `2026_08_28_p3d_03_status_kolomrevoke_ROLLBACK.sql` |
| 20 | `2026_08_28_p3d_04_open_per_decision.sql` | Maakt open vereisten decision-scoped voor de omslagtoets. | DB vóór de statusroute. | `2026_08_28_p3d_04_open_per_decision_ROLLBACK.sql` |
| 21 | `2026_08_28_p3d_05_insert_besluitstatus_slot.sql` | Sluit directe INSERT met een besluitstatus. Draai direct hierna het P3-tussenijkpunt hieronder. | DB vóór deploy. | `2026_08_28_p3d_05_insert_besluitstatus_slot_ROLLBACK.sql` |
| 22 | `2026_08_29_p4_01_statusdragers.sql` | Breidt besluit- en stapstatussen uit, inclusief `beeindigd`, `niet_begonnen` en `vervallen`. | DB vóór P4-code. | `2026_08_29_p4_01_statusdragers_ROLLBACK.sql` |
| 23 | `2026_08_29_p4_03_niet_begonnen_actief_trigger.sql` | Levert P4-activeringstriggers en bewaakt de eerste inhoudelijke handeling. `p4_02` ontbreekt bewust: tranche 2 was alleen TypeScript/domeincode en heeft geen SQL-bestand. | DB vóór P4-code. | `2026_08_29_p4_03_niet_begonnen_actief_trigger_ROLLBACK.sql` |
| 24 | `2026_08_29_p4_04_status_feitenmatrix.sql` | Maakt `besluitstatus_vereist_feit` en de uitgestelde I1-constraint-trigger op besluitstatussen. | DB vóór stappen 25–27 en vóór P4-code. | `2026_08_29_p4_04_status_feitenmatrix_ROLLBACK.sql` |
| 25 | `2026_08_29_p4_05_besluitmoment_arm.sql` | Voegt de besluitmoment-arm toe aan `fn_stap_open_per_zwaarte` (niet aan de ontmantelde readiness). | DB vóór de P4-statusomslagen. | `2026_08_29_p4_05_besluitmoment_arm_ROLLBACK.sql` |
| 26 | `2026_08_29_p4_06_procedure_beeindigen_heropenen.sql` | Levert procedure beëindigen/heropenen en legt het vereiste beëindigingsfeit atomair vast. | DB vóór de bijbehorende API-routes. | `2026_08_29_p4_06_procedure_beeindigen_heropenen_ROLLBACK.sql` |
| 27 | `2026_08_29_p4_07_besluit_heropenen_correctie.sql` | Schrijft de statusfeiten atomair in `fn_besluit_status_omslag`; de uitgestelde matrix-trigger toetst ze bij commit. Corrigeert ook heropenen. | DB vóór de besluitstatusroute. | `2026_08_29_p4_07_besluit_heropenen_correctie_ROLLBACK.sql` |
| 28 | `2026_08_29_p4_08_i5_composite_fk.sql` | Legt P4/I5 cross-fondsreferenties declaratief vast met composite foreign keys. | DB vóór deploy. | `2026_08_29_p4_08_i5_composite_fk_ROLLBACK.sql` |
| 29 | `2026_08_29_zz_0195_verwijder_onvervulbare_templatevereisten.sql` | Eenmalige, gemeten 0195-correctie: verwijdert de onvervulbare `evaluation` uit stap 6 van `beleidswijziging_beleggingsbeleid@1.0.0` bij uitsluitend 0 gepinde dossiers op Preview of de expliciet bevestigde 3 niet-gebruikte dossiers op productie (#228). Elk ander aantal faalt luid. De I7-trigger staat alleen binnen de transactie tijdelijk uit, nooit via `session_replication_role`, en de migratie verifieert vóór commit dat hij weer actief is. | DB vóór deploy, uitsluitend na vastlegging van de 0195-meting. | `2026_08_29_zz_0195_verwijder_onvervulbare_templatevereisten_ROLLBACK.sql` |

## Tussenijkpunten tijdens de reeks

**Direct na stap 12 (einde P2):** deze query moet één rij met alle waarden
`true` opleveren. Anders stoppen vóór P3.

```sql
select
  to_regclass('public.procedure_vaststelling') is not null as procedure_vaststelling,
  to_regprocedure('public.fn_assert_gebonden_feit(uuid,uuid,text,text)') is not null as bindingspoort,
  exists (
    select 1 from pg_trigger
     where tgname = 'trg_vaststelling_i1' and not tgisinternal
  ) as i1_ontkoppelslot;
```

**Direct na stap 21 (einde P3):** deze query moet eveneens uitsluitend `true`
opleveren. De `status`-kolom is dan expres niet meer direct schrijfbaar voor
`authenticated`.

```sql
select
  to_regprocedure('public.fn_besluit_status_omslag(uuid,text,text,text,jsonb)') is not null as statusomslag_rpc,
  not has_column_privilege('authenticated', 'public.decision_objects', 'status', 'UPDATE') as status_direct_dicht,
  exists (
    select 1 from pg_trigger
     where tgname = 'trg_decision_status_insert_guard' and not tgisinternal
  ) as status_insert_slot;
```

## a1/a2: afbakening voor deze uitrol

`#214-a1` is al een voorouder van de huidige `preview`-branch en zit daarom niet
in deze delta. De vier a1-revokes zijn `HAND-APPLIED`: verifieer vóór stap 2 met
`supabase/checks/2026_08_28_p214a1_schrijfpoort.sql` dat ze ook werkelijk in de
Preview-database aanwezig zijn. Faalt die controle, stop dan; dat is een aparte
a1-herstelactie, geen ontbrekende stap in deze lijst.

`#214-a2` (commit `d7d9d37`) heeft **geen migratiebestand**. Hij bevat naast de
gate ook route-/domeincode en wordt met de epic-code gedeployd. De a2-gate hoort
dus pas in de controles na de deploy; hij is geen SQL-stap die tussen 28 en 29
ontbreekt.

## Daarna: code en controles

1. Deploy de commit van PR #233 pas nadat stap 29 succesvol is toegepast.
2. Laat `ENFORCE_CAPABILITY` ongewijzigd; deze release bevat **geen** vlagflip.
3. Draai tegen Preview, in deze volgorde:
   - `supabase/checks/2026_08_28_p214a1_schrijfpoort.sql`
   - `supabase/checks/2026_08_29_p214a2_afwijkingskolommen_schrijfpoort.sql`
   - `supabase/checks/2026_08_28_p3d_besluit_omslag.sql`
   - `supabase/checks/2026_08_29_p4_04_status_feitenmatrix.sql`
   - `supabase/checks/2026_08_29_p4_i5_composite_fk.sql`
   - `supabase/checks/2026_08_29_zz_0195_vervullingspad.sql`
   - `supabase/checks/2026_08_20_v3_grants_volledig.sql`
4. Daarna de preview-smokes en uitgestelde karakteriseringsscenario's. #207 blijft
   productie-werk en hoort niet in deze preview-release.

## Rollbackvolgorde

**Afbreken vóór de deploy.** Er is nog geen nieuwe code actief; een code-rollback
is dan een no-op. Voer uitsluitend de rollbacks van de **al toegepaste**
migraties uit, in omgekeerde volgorde (29 → 2; stap 1 heeft geen rollback).
Draai daarna de V3-grantgate en de structurele gates. Bij een gedeeltelijke
rollback: stop en onderzoek; sla geen afhankelijk rollbackbestand over.

**Terugdraaien ná de deploy.** Deploy eerst de huidige `preview`-commit terug,
zodat die code niet tegen de nieuwe databasevorm draait. Voer daarna uitsluitend
de rollbacks van de werkelijk toegepaste migraties in omgekeerde volgorde uit
(29 → 2; stap 1 heeft geen rollback), gevolgd door de V3-grantgate en de
structurele gates.
