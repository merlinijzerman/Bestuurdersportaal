-- ============================================================================
-- ROLLBACK 2026-08-10 — Documentstatus vijf → acht (schema-only)
-- ----------------------------------------------------------------------------
-- LET OP: de DATAMIGRATIE is ONOMKEERBAAR. Rijen die naar `concept` of
-- `historisch` zijn gemapt dragen niet langer of ze oorspronkelijk
-- ter_bespreking/ter_besluitvorming resp. vervangen/alleen_historisch waren —
-- die informatie is samengevoegd en niet te reconstrueren. Deze rollback
-- herstelt alleen het SCHEMA (CHECK + de twee SQL-spiegels), zodat de oude code
-- weer draait; de reeds gemapte statuswaarden (`concept`/`historisch`) blijven
-- geldig onder de oude 8-waarden-CHECK.
-- ============================================================================

begin;

-- 1. CHECK terug naar acht waarden.
alter table public.documenten drop constraint if exists documenten_status_check;
alter table public.documenten add  constraint documenten_status_check
  check (status is null or status in (
    'concept','ter_bespreking','ter_besluitvorming','vastgesteld',
    'van_kracht','vervangen','alleen_historisch','gearchiveerd'));

-- 2. fn_document_status_transitie terug naar de 8-waarden-tabel
--    (zoals 2026_08_06_status_bij_ingest.sql die achterliet).
drop function if exists public.fn_document_status_transitie(text, text);
create function public.fn_document_status_transitie(
  p_van text, p_naar text
)
returns table (
  toegestaan boolean,
  redenplicht boolean,
  vereist_vervangen_door boolean,
  herindexering boolean,
  bruikbaar_actueel boolean
)
language sql immutable as $$
  select t.toegestaan::boolean,
         t.redenplicht::boolean,
         t.vereist_vervangen_door::boolean,
         t.herindexering::boolean,
         t.bruikbaar_actueel::boolean
  from (values
    ('upload',            'vastgesteld',        true,  true,  false, true,  true ),
    ('upload',            'van_kracht',         true,  true,  false, true,  true ),
    ('concept',           'ter_bespreking',     true,  false, false, true,  false),
    ('ter_bespreking',    'ter_besluitvorming', true,  false, false, true,  false),
    ('ter_besluitvorming','vastgesteld',        true,  true,  false, true,  true ),
    ('vastgesteld',       'van_kracht',         true,  false, false, true,  true ),
    ('van_kracht',        'vervangen',          true,  true,  true,  true,  false),
    ('van_kracht',        'alleen_historisch',  true,  true,  false, true,  false),
    ('concept',           'gearchiveerd',       true,  true,  false, true,  false),
    ('ter_bespreking',    'gearchiveerd',       true,  true,  false, true,  false),
    ('ter_besluitvorming','gearchiveerd',       true,  true,  false, true,  false),
    ('vastgesteld',       'gearchiveerd',       true,  true,  false, true,  false),
    ('van_kracht',        'gearchiveerd',       true,  true,  false, true,  false),
    ('vervangen',         'gearchiveerd',       true,  true,  false, true,  false),
    ('alleen_historisch', 'gearchiveerd',       true,  true,  false, true,  false)
  ) as t(van, naar, toegestaan, redenplicht, vereist_vervangen_door, herindexering, bruikbaar_actueel)
  where t.van = p_van and t.naar = p_naar;
$$;

-- 3. fn_generiek_geldigheidsstatus terug (vervangen/alleen_historisch-tak).
create or replace function public.fn_generiek_geldigheidsstatus(
  p_status text, p_bronstatus text
)
returns text language sql immutable as $$
  select case
    when p_status = 'van_kracht'
         and coalesce(p_bronstatus, 'actief') = 'actief'      then 'published'
    when p_status = 'gearchiveerd'
         or coalesce(p_bronstatus, 'actief') = 'uitgesloten'  then 'withdrawn'
    when p_status in ('vervangen', 'alleen_historisch')
         or coalesce(p_bronstatus, 'actief') = 'historisch'   then 'deprecated'
    else 'draft'
  end;
$$;

commit;
