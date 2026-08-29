-- ============================================================
--  Migratie 2026-05-08 — Decision Object MVP-1B
--  Template-seed: procedure_requirements voor
--  template_code = 'beleidswijziging_beleggingsbeleid'
--
--  Doel:
--   • Per stap (1..6) van de nieuwe beleidswijziging-beleggingsbeleid-
--     template de requirements registreren die de readiness-check
--     consumeert (zie fn_decision_readiness_check).
--   • Conditionele activatie via classificatie-dimensies (sectie 4.9).
--   • Idempotent: oude rijen voor deze template_code worden eerst
--     verwijderd zodat de seed deterministisch is.
--
--  Stappen-overzicht (zie ook lib/proces-templates.ts):
--   1. Concept & aanleiding
--   2. Onderbouwing
--   3. Validatie & risk review
--   4. Bestuursoverleg & agendering
--   5. Besluitvorming
--   6. Implementatie & evaluatie
--
--  Lopende procedures op de oude template-codes (`beleidswijziging`,
--  `uitbestedingsreview`, `incident_dnb`) blijven onaangetast — zij
--  hebben simpelweg geen requirements en draaien dus zonder gating.
--  Pas wanneer ook die templates worden geseed, krijgen ze readiness-
--  blokkering.
-- ============================================================

begin;

delete from public.procedure_requirements
 where template_code = 'beleidswijziging_beleggingsbeleid';

-- ── Stap 1: Concept & aanleiding ───────────────────────────
insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label, veld_pad,
   verplicht, blokkerend, validatieregel)
values
  ('beleidswijziging_beleggingsbeleid', 1, 'field', 'Besluitvraag ingevuld',
   'decision.besluitvraag', true, true, 'decision_objects.besluitvraag mag niet leeg zijn'),
  ('beleidswijziging_beleggingsbeleid', 1, 'field', 'Classificatie ingevuld',
   'decision.complexiteit+risiconiveau', true, true,
   'decision_objects.complexiteit en risiconiveau hebben non-default waarde of zijn bewust bevestigd');

-- ── Stap 2: Onderbouwing ───────────────────────────────────
insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label, documenttype,
   verplicht, blokkerend, triggert_bij_complexiteit, triggert_bij_risiconiveau)
values
  ('beleidswijziging_beleggingsbeleid', 2, 'document', 'ALM-analyse beschikbaar',
   'ALM_analyse', true, true, null, null),
  ('beleidswijziging_beleggingsbeleid', 2, 'document', 'Risicoanalyse beschikbaar',
   'risicoanalyse', true, true, null, null),
  ('beleidswijziging_beleggingsbeleid', 2, 'document', 'Liquiditeitsanalyse bij hoog risico',
   'liquiditeitsanalyse', true, true, null, array['hoog']);

insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label,
   verplicht, blokkerend, validatieregel,
   triggert_bij_complexiteit, triggert_bij_risiconiveau)
values
  ('beleidswijziging_beleggingsbeleid', 2, 'ai_validation',
   'AI-samenvatting onderbouwing gevalideerd',
   true, true,
   'minstens één decision_ai_interactions met validatiestatus in (gevalideerd, aangepast)',
   null, null),
  ('beleidswijziging_beleggingsbeleid', 2, 'assumption',
   '≥ 3 gevalideerde kernaannames bij complex/hoog',
   true, true,
   'minstens drie decision_assumptions met status in (gevalideerd, gewijzigd) — bij complexiteit complex of risiconiveau hoog',
   array['complex'], null),
  ('beleidswijziging_beleggingsbeleid', 2, 'assumption',
   '≥ 3 gevalideerde kernaannames bij hoog risiconiveau',
   true, true,
   'duplicaat van vorige rij maar met OR op risiconiveau, conform splits-pattern uit ontwerpdoc §4.9',
   null, array['hoog']);

-- ── Stap 3: Validatie & risk review ────────────────────────
insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label,
   verplicht, blokkerend, validatieregel,
   triggert_bij_mandaatgevoelig)
values
  ('beleidswijziging_beleggingsbeleid', 3, 'ai_validation',
   'Risk-validatie uitgevoerd door bevoegde rol',
   true, true,
   'decision_ai_interactions met validatie_domein=risk gevalideerd door voorzitter/beheerder',
   null),
  ('beleidswijziging_beleggingsbeleid', 3, 'ai_validation',
   'Compliance-validatie uitgevoerd door bevoegde rol',
   true, true,
   'decision_ai_interactions met validatie_domein=compliance gevalideerd door voorzitter/beheerder',
   null),
  ('beleidswijziging_beleggingsbeleid', 3, 'risk',
   'Risico''s geregistreerd in Decision Object',
   true, true,
   'minstens één rij in decision_risks',
   null),
  ('beleidswijziging_beleggingsbeleid', 3, 'mandate_check',
   'Mandaatcheck uitgevoerd',
   true, true,
   'governance_event met event_type=mandate_check_passed',
   true);

-- ── Stap 4: Bestuursoverleg & agendering ───────────────────
insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label, veld_pad,
   verplicht, blokkerend, validatieregel)
values
  ('beleidswijziging_beleggingsbeleid', 4, 'field',
   'Alternatieven en opties geformuleerd',
   'decision.scope',
   true, true,
   'beschrijving in decision_objects.scope of via aanvullende velden in MVP-1C');

-- ── Stap 5: Besluitvorming ─────────────────────────────────
insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label,
   verplicht, blokkerend, validatieregel)
values
  ('beleidswijziging_beleggingsbeleid', 5, 'approval',
   'Bestuursbesluit formeel vastgelegd',
   true, true,
   'decision_objects.status overgang naar besloten of voorwaardelijk_besloten'),
  ('beleidswijziging_beleggingsbeleid', 5, 'dissent_review',
   'Dissent behandeld of formeel vastgesteld',
   true, true,
   'geen openstaande decision_dissent met zichtbaarheid formele_dissent/minderheidsnotitie en formeel_vastgesteld=false');

-- ── Stap 6: Implementatie & evaluatie ──────────────────────
insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label,
   verplicht, blokkerend, validatieregel)
values
  ('beleidswijziging_beleggingsbeleid', 6, 'kpi',
   'KPI''s gedefinieerd voor monitoring',
   true, true,
   'minstens één decision_conditions met kpi is not null'),
  ('beleidswijziging_beleggingsbeleid', 6, 'evaluation',
   'Evaluatiemoment gepland',
   true, true,
   'minstens één decision_evaluations met geplande_datum');

commit;

-- ============================================================
--  Einde seed 2026-05-08.
--  Verificatie:
--    select stap_volgorde, requirement_type, label,
--           triggert_bij_complexiteit, triggert_bij_risiconiveau,
--           triggert_bij_mandaatgevoelig
--      from public.procedure_requirements
--     where template_code = 'beleidswijziging_beleggingsbeleid'
--     order by stap_volgorde, requirement_type, label;
-- ============================================================
