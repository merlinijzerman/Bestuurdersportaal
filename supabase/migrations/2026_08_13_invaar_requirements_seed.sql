-- ============================================================
--  Migratie 2026-08-13 — Invaarprocedure: requirements-seed
--  Seedt procedure_requirements voor template_code 'pf_wtp_invaarbesluit'
--  (SPH-variant, versie 2.0.0). De readiness-functie leest deze live per
--  template_code.
--
--  BRON = de canonieke JSON-definitie
--  definities/pensioenfondsen/pf_wtp_invaarbesluit@2.0.0.json. Het blok tussen
--  de GEGENEREERD-markers is DETERMINISTISCH afgeleid door
--  core/lib/procedure-requirements-seed.ts::genereerRequirementsSeed(). De
--  sanity core/lib/procedure-requirements-seed.sanity.ts bewaakt dat dit blok
--  exact overeenkomt met de definitie (drift-check). Wijzig requirements in de
--  JSON, regenereer, en vervang het blok — bewerk het niet met de hand.
--
--  Vereist dat d7a (enum-uitbreiding external_submission/consultation) al is
--  toegepast. Idempotent (delete + insert per template_code).
-- ============================================================

begin;

-- <<GEGENEREERD_UIT_DEFINITIE>>
delete from public.procedure_requirements
 where template_code = 'pf_wtp_invaarbesluit';

insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label, documenttype,
   veld_pad, verplicht, blokkerend, min_aantal, vereist_validatie_domein)
values
  ('pf_wtp_invaarbesluit', 1, 'document', 'Transitieplan', 'transitieplan', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 1, 'document', '(Gewijzigde) beroepspensioenregeling', 'beroepspensioenregeling', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 1, 'field', 'Besluitvraag opdrachtaanvaarding', null, 'decision.besluitvraag', true, true, 1, null),
  ('pf_wtp_invaarbesluit', 1, 'approval', 'Voorgenomen opdrachtaanvaarding', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 1, 'consultation', 'Afstemming beroepspensioenvereniging', 'afstemming_vereniging', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 2, 'document', 'Beoordelingskader/evenwichtigheidsraamwerk', 'beoordelingskader', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 2, 'document', 'Risicohouding + RPO-rapport', 'risicohouding_rpo', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 2, 'field', 'Maatstaven, bandbreedtes en voorrangsregels', null, 'decision.scope', true, false, 1, null),
  ('pf_wtp_invaarbesluit', 2, 'approval', 'Vaststelling beoordelingskader', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 3, 'document', 'Implementatieplan', 'implementatieplan', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 3, 'risk', 'Integrale risicoanalyse', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 3, 'document', 'Teststrategie/QA-plan', 'teststrategie', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 3, 'assumption', 'Kernaannames uitvoerbaarheid (min. 3)', null, null, true, false, 3, null),
  ('pf_wtp_invaarbesluit', 3, 'dissent_review', 'Afwijkende inzichten sleutelfuncties', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 4, 'document', 'Datakwaliteitsrapport accountant/IT-auditor', 'datakwaliteitsrapport', null, true, true, 1, 'risk'),
  ('pf_wtp_invaarbesluit', 4, 'assumption', 'Gevalideerde kernaannames data/model', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 4, 'risk', 'Restrisico datakwaliteit', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 5, 'document', 'Transitie-effect-/evenwichtigheidsrapportage', 'transitie_effectrapportage', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 5, 'kpi', 'Netto-profijt per cohort', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 5, 'assumption', 'Scenario-/modelaannames', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 5, 'risk', 'Herverdelingsrisico', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 5, 'evaluation', 'Evenwichtigheidsoordeel', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 6, 'document', 'Communicatieplan (AFM)', 'communicatieplan', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 6, 'document', 'Keuzebegeleidingsontwerp (zorgplicht FPR)', 'keuzebegeleidingsontwerp', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 6, 'evaluation', 'Deelnemertesten begrijpelijkheid en keuzes', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 7, 'field', 'Besluitvraag/motivering', null, 'decision.besluitvraag', true, true, 1, null),
  ('pf_wtp_invaarbesluit', 7, 'document', 'Voorgenomen invaarbesluit + beslisnota', 'voorgenomen_invaarbesluit', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 7, 'approval', 'Voorgenomen besluit', null, null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 7, 'dissent_review', 'Afwijkende inzichten', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 7, 'mandate_check', 'Bevoegdheid/mandaat', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 8, 'consultation', 'Hoorrecht uitgevoerd (VO/gewezen deelnemers/gepensioneerden)', 'hoorrecht_verslag', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 8, 'consultation', 'Advies VO/BO', 'advies_vo_bo', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 8, 'approval', 'Goedkeuring intern toezicht', null, null, false, false, 1, null),
  ('pf_wtp_invaarbesluit', 8, 'dissent_review', 'Verwerking kritische vragen intern toezicht', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 9, 'external_submission', 'Invaarmelding DNB', 'invaarmelding_dnb', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 9, 'external_submission', 'AFM-aanlevering communicatieplan', 'afm_aanlevering', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 9, 'document', 'Ingevuld invaarsjabloon', 'invaarsjabloon', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 9, 'approval', 'DNB-goedkeuring/beschikking', null, null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 9, 'dissent_review', 'Opvolging toezichtbevindingen', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 10, 'external_submission', 'Verstrekking prognose-transitieoverzicht', 'prognose_transitieoverzicht', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 10, 'document', 'Klantcontact-readiness (scripts/training/klachtenproces)', 'klantcontact_readiness', null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 10, 'evaluation', 'Kwaliteitscontrole communicatie', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 11, 'document', 'Go/no-go-dossier', 'go_no_go_dossier', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 11, 'kpi', 'Readiness-criteria (IT/administratie/keten/financieel)', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 11, 'risk', 'Actuele restrisico''s + fallback/uitstel', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 11, 'approval', 'Go/no-go-besluit', null, null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 11, 'mandate_check', 'Bevoegdheid go/no-go-besluit', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 12, 'document', 'Controle-na-invaren/reconciliatierapport', 'controle_na_invaren', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 12, 'external_submission', 'Definitief transitieoverzicht', 'definitief_transitieoverzicht', null, true, true, 1, null),
  ('pf_wtp_invaarbesluit', 12, 'kpi', 'Klachten-/keuzemonitoring', null, null, true, false, 1, null),
  ('pf_wtp_invaarbesluit', 12, 'evaluation', 'Bestuursevaluatie + verbeteracties', null, null, true, false, 1, null);
-- <</GEGENEREERD_UIT_DEFINITIE>>

commit;

-- ============================================================
--  Verificatie:
--    select stap_volgorde, requirement_type, blokkerend
--      from public.procedure_requirements
--     where template_code='pf_wtp_invaarbesluit' order by stap_volgorde;
--    -- 52 rijen; readiness leest deze samen met de actieve instantie-items.
-- ============================================================
