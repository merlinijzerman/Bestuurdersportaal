-- ============================================================
--  Migratie 2026-05-08 — Decision Object MVP-1C
--  Schema-uitbreiding op `procedure_requirements`:
--    • vereist_validatie_domein  text (algemeen/risk/compliance/...)
--      → vervangt label-regex in buildEvidenceLijst
--    • min_aantal                int  (default 1)
--      → vervangt regex op "≥ 3" in label voor assumption-drempels
--
--  Idempotent: kolommen worden toegevoegd met IF NOT EXISTS;
--  bestaande seed-rijen voor template `beleidswijziging_beleggingsbeleid`
--  worden bijgewerkt naar de juiste waarden.
-- ============================================================

begin;

-- ── 1. Kolommen toevoegen ──────────────────────────────────
alter table public.procedure_requirements
  add column if not exists vereist_validatie_domein text
    check (vereist_validatie_domein in (
      'algemeen','risk','compliance','beleggingen','governance'
    ));

alter table public.procedure_requirements
  add column if not exists min_aantal int not null default 1
    check (min_aantal >= 1);

-- ── 2. Update bestaande seed-rijen voor onze template ──────
-- Risk-validatie: domein = risk
update public.procedure_requirements
   set vereist_validatie_domein = 'risk'
 where template_code = 'beleidswijziging_beleggingsbeleid'
   and stap_volgorde = 3
   and requirement_type = 'ai_validation'
   and label ilike '%risk%';

-- Compliance-validatie: domein = compliance
update public.procedure_requirements
   set vereist_validatie_domein = 'compliance'
 where template_code = 'beleidswijziging_beleggingsbeleid'
   and stap_volgorde = 3
   and requirement_type = 'ai_validation'
   and label ilike '%compliance%';

-- AI-samenvatting onderbouwing: algemeen
update public.procedure_requirements
   set vereist_validatie_domein = 'algemeen'
 where template_code = 'beleidswijziging_beleggingsbeleid'
   and stap_volgorde = 2
   and requirement_type = 'ai_validation'
   and label ilike '%samenvatting%';

-- Kernaannames-drempels: min_aantal = 3
update public.procedure_requirements
   set min_aantal = 3
 where template_code = 'beleidswijziging_beleggingsbeleid'
   and stap_volgorde = 2
   and requirement_type = 'assumption';

commit;

-- ============================================================
--  Verificatie:
--    select stap_volgorde, requirement_type, label,
--           vereist_validatie_domein, min_aantal
--      from public.procedure_requirements
--     where template_code = 'beleidswijziging_beleggingsbeleid'
--       and requirement_type in ('ai_validation','assumption')
--     order by stap_volgorde, label;
-- ============================================================
