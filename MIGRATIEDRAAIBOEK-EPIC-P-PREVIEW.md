# EPIC P → Preview: migratiedraaiboek

**Doelomgeving:** uitsluitend Supabase Preview.  Pas ieder bestand hieronder in
deze volgorde, volledig en één voor één toe in de SQL-editor. Stop bij de eerste
fout; ga niet verder en pas geen rollback toe zonder eerst de bijbehorende code
terug te zetten. De code-deploy volgt pas nadat alle 28 stappen groen zijn.

> De lijst is de exacte `preview...epic/proceduremodule-v2`-delta. De
> bestandsnamen zijn bewust geen Supabase-CLI-timestamps: handmatig toepassen,
> niet via `supabase db push`.

| # | Migratie | Wat doet hij | Code | Rollback bij afbreken |
|---:|---|---|---|---|
| 1 | `2026_05_08_phase_1b_template_requirements.sql` | Corrigeert de template-seed: verwijdert de onvervulbare `evaluation` uit stap 6 van `beleidswijziging_beleggingsbeleid` (#228). | Geen code-afhankelijkheid; vóór deploy. | Geen script. Niet terugzetten: `evaluation` krijgt pas terug een pad na een afzonderlijk definitiebesluit. |
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
| 12 | `2026_08_25_p2b_01_i1_ontkoppelslot.sql` | Borgt I1 bij ontkoppelen: triggers voorkomen een los feit buiten het geldige pad. | DB vóór code. | `2026_08_25_p2b_01_i1_ontkoppelslot_ROLLBACK.sql` |
| 13 | `2026_08_27_p3b_01_zwaarte.sql` | Maakt requirement-zwaarte expliciet en verplicht. | DB vóór P3-code. | `2026_08_27_p3b_01_zwaarte_ROLLBACK.sql` |
| 14 | `2026_08_27_p3b_02_booleans_generated.sql` | Voegt de afgeleide P3-booleans toe. | DB vóór P3-code. | `2026_08_27_p3b_02_booleans_generated_ROLLBACK.sql` |
| 15 | `2026_08_27_p3c_01_afwijking_kolommen.sql` | Voegt de vier afwijkingskolommen en hun constraints toe. | DB vóór stap 16 en vóór deploy; de browser krijgt geen directe schrijfroute. | `2026_08_27_p3c_01_afwijking_kolommen_ROLLBACK.sql` |
| 16 | `2026_08_27_p3c_02_fn_afronden_afwijking.sql` | Installeert de atomaire RPC voor afronden-met-afwijking. | DB vóór de afwijkingsroute. | `2026_08_27_p3c_02_fn_afronden_afwijking_ROLLBACK.sql` |
| 17 | `2026_08_28_p3d_01_readiness_drop.sql` | Vervangt de oude readiness-constructie als voorbereiding op de besluitomslag. | DB vóór stappen 18–21. | `2026_08_28_p3d_01_readiness_drop_ROLLBACK.sql` |
| 18 | `2026_08_28_p3d_02_fn_besluit_status_omslag.sql` | Levert de bewaakte statusomslag-RPC. | DB vóór de statusroute. | `2026_08_28_p3d_02_fn_besluit_status_omslag_ROLLBACK.sql` |
| 19 | `2026_08_28_p3d_03_status_kolomrevoke.sql` | Ontneemt browserrollen directe schrijfrechten op besluitstatus. | DB vóór deploy; code gebruikt de RPC uit stap 18. | `2026_08_28_p3d_03_status_kolomrevoke_ROLLBACK.sql` |
| 20 | `2026_08_28_p3d_04_open_per_decision.sql` | Maakt open vereisten decision-scoped voor de omslagtoets. | DB vóór de statusroute. | `2026_08_28_p3d_04_open_per_decision_ROLLBACK.sql` |
| 21 | `2026_08_28_p3d_05_insert_besluitstatus_slot.sql` | Sluit directe INSERT met een besluitstatus. | DB vóór deploy. | `2026_08_28_p3d_05_insert_besluitstatus_slot_ROLLBACK.sql` |
| 22 | `2026_08_29_p4_01_statusdragers.sql` | Breidt besluit- en stapstatussen uit, inclusief `beeindigd`, `niet_begonnen` en `vervallen`. | DB vóór P4-code. | `2026_08_29_p4_01_statusdragers_ROLLBACK.sql` |
| 23 | `2026_08_29_p4_03_niet_begonnen_actief_trigger.sql` | Levert P4-activeringstriggers en bewaakt de eerste inhoudelijke handeling. | DB vóór P4-code. | `2026_08_29_p4_03_niet_begonnen_actief_trigger_ROLLBACK.sql` |
| 24 | `2026_08_29_p4_04_status_feitenmatrix.sql` | Maakt `besluitstatus_vereist_feit`, de I1-toetser en de beperkte stap-vrijgave-RPC. | DB vóór stappen 25–27 en vóór P4-code. | `2026_08_29_p4_04_status_feitenmatrix_ROLLBACK.sql` |
| 25 | `2026_08_29_p4_05_besluitmoment_arm.sql` | Voegt de besluitmoment-arm aan readiness toe. | DB vóór de P4-statusomslagen. | `2026_08_29_p4_05_besluitmoment_arm_ROLLBACK.sql` |
| 26 | `2026_08_29_p4_06_procedure_beeindigen_heropenen.sql` | Levert procedure beëindigen/heropenen en legt het vereiste beëindigingsfeit atomair vast. | DB vóór de bijbehorende API-routes. | `2026_08_29_p4_06_procedure_beeindigen_heropenen_ROLLBACK.sql` |
| 27 | `2026_08_29_p4_07_besluit_heropenen_correctie.sql` | Bedraadt de feitenmatrix in `fn_besluit_status_omslag` en corrigeert heropenen. | DB vóór de besluitstatusroute. | `2026_08_29_p4_07_besluit_heropenen_correctie_ROLLBACK.sql` |
| 28 | `2026_08_29_p4_08_i5_composite_fk.sql` | Legt P4/I5 cross-fondsreferenties declaratief vast met composite foreign keys. | DB vóór deploy. | `2026_08_29_p4_08_i5_composite_fk_ROLLBACK.sql` |

## Daarna: code en controles

1. Deploy de commit van PR #233 pas nadat stap 28 succesvol is toegepast.
2. Laat `ENFORCE_CAPABILITY` ongewijzigd; deze release bevat **geen** vlagflip.
3. Draai tegen Preview, in deze volgorde:
   - `supabase/checks/2026_08_29_p214a2_afwijkingskolommen_schrijfpoort.sql`
   - `supabase/checks/2026_08_28_p3d_besluit_omslag.sql`
   - `supabase/checks/2026_08_29_p4_04_status_feitenmatrix.sql`
   - `supabase/checks/2026_08_29_p4_i5_composite_fk.sql`
   - `supabase/checks/2026_08_20_v3_grants_volledig.sql`
4. Daarna de preview-smokes en uitgestelde karakteriseringsscenario's. #207 blijft
   productie-werk en hoort niet in deze preview-release.

## Rollbackvolgorde

1. Zet eerst de code terug naar de huidige `preview`-commit.
2. Voer daarna uitsluitend de rollbacks van de **al toegepaste** stappen uit, in
   omgekeerde volgorde (28 → 2). Stap 1 wordt niet teruggedraaid.
3. Draai na de rollback de V3-grantgate en de structurele gates. Bij een
   gedeeltelijke rollback: stop en onderzoek; sla geen afhankelijk rollbackbestand over.
