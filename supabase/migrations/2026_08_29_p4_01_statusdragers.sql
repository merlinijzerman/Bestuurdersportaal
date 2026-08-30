-- P4 tranche 1 (#169, besluit 0193/0194) — statusdragers uitgebreid.
-- ---------------------------------------------------------------------------
-- Drie domeinverbredingen; de transitiematrix (fn_decision_status_check) en de
-- fase-/stapafleiding krijgen hun regels in latere P4-tranches (6/7 en 2/3). Deze
-- migratie verbreedt alléén het toegestane waardenbereik + de dossierafleiding.
--
--  • decision_objects.status: 17 → 18 (+ 'beeindigd', §5.2 — een procedure/besluit
--    dat vóór het einde wordt gestopt; niet 'afgesloten' (dat is een afgerond
--    dossier opruimen) en niet 'geannuleerd' (verborgen legacy)).
--  • procedure_stappen.status: + 'niet_begonnen' en 'vervallen' (§4.1). Legacy
--    'open' blijft in de superset (snapshot-integriteit van lopende procedures).
--  • fn_dossierstatus_van_decision: 'beeindigd' → dossierstatus 'beeindigd' (de
--    NEGENDE dossierstatus). De TS-spiegel core/lib/dossier.ts wordt gelijk bijgewerkt.
--
-- Idempotent (drop constraint if exists / create or replace).
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_29_p4_01_statusdragers_ROLLBACK.sql

begin;

-- 1. decision_objects.status — + beeindigd
alter table public.decision_objects drop constraint if exists decision_objects_status_check;
alter table public.decision_objects add constraint decision_objects_status_check
  check (status in (
    'concept','in_onderbouwing','in_validatie','in_review','geagendeerd','in_bespreking',
    'besloten','voorwaardelijk_besloten','afgewezen','aangehouden','geescaleerd','teruggezet',
    'in_uitvoering','in_evaluatie','afgesloten','heropend','geannuleerd','beeindigd'
  ));

-- 2. procedure_stappen.status — + niet_begonnen, + vervallen (legacy 'open' behouden)
alter table public.procedure_stappen drop constraint if exists procedure_stappen_status_check;
alter table public.procedure_stappen add constraint procedure_stappen_status_check
  check (status in (
    'open','niet_begonnen','geblokkeerd','actief','afgerond','heropend','vervallen'
  ));

-- 3. dossierafleiding — beeindigd → beeindigd (negende dossierstatus)
create or replace function public.fn_dossierstatus_van_decision(p_status text)
returns table(dossierstatus text, sublabel text)
language sql immutable as $$
  select
    case p_status
      when 'concept'                 then 'lopend'
      when 'in_onderbouwing'         then 'lopend'
      when 'in_validatie'            then 'lopend'
      when 'in_review'               then 'lopend'
      when 'teruggezet'              then 'lopend'
      when 'geescaleerd'             then 'lopend'
      when 'aangehouden'             then 'lopend'
      when 'geagendeerd'             then 'ter_besluitvorming'
      when 'in_bespreking'           then 'ter_besluitvorming'
      when 'besloten'                then 'besloten'
      when 'voorwaardelijk_besloten' then 'besloten'
      when 'in_uitvoering'           then 'in_implementatie'
      when 'in_evaluatie'            then 'in_implementatie'
      when 'afgesloten'              then 'afgerond'
      when 'afgewezen'               then 'afgerond'
      when 'geannuleerd'             then 'afgerond'
      when 'heropend'                then 'heropend'
      when 'beeindigd'               then 'beeindigd'
      else null   -- onbekende status → geen afleiding
    end as dossierstatus,
    case p_status
      when 'voorwaardelijk_besloten' then 'voorwaardelijk'
      when 'teruggezet'              then 'teruggezet'
      when 'geescaleerd'             then 'geëscaleerd'
      when 'aangehouden'             then 'aangehouden'
      when 'in_evaluatie'            then 'in evaluatie'
      when 'afgewezen'               then 'afgewezen'
      when 'geannuleerd'             then 'geannuleerd'
      when 'beeindigd'               then 'beëindigd'
      else null
    end as sublabel;
$$;

commit;
