-- ============================================================
--  Migratie 2026-06-18b — Increment B: Procesinstantie/dossier
--  + Decision Object → dossierstatus-mapping
--
--  Promoveert `procedures` van platte workflow tot procesinstantie
--  (dossier) met periode + rijke statusset, en leidt de effectieve
--  dossierstatus af uit het primaire Decision Object via een view.
--
--  Leidend: FO v1.2 §5 (Module 3), TO v1.2 §3.2 (17→8-mapping, O2),
--  decisions/0006 (B2, O2), decisions/0007 (fondsconsistentie).
--
--  Strategie:
--   • Additief + idempotent: opnieuw draaien is veilig.
--   • Statusmapping oud→nieuw is verliesvrij en draait VÓÓR de
--     nieuwe check-constraint wordt gezet; een pre-flight-check
--     stopt de migratie als een rij buiten de nieuwe set zou vallen.
--   • De mapping 17→8 leeft in een IMMUTABLE functie
--     (fn_dossierstatus_van_decision) zodat ze los van de
--     status-overgang-trigger getest kan worden over alle 17 statussen.
--   • vw_dossier_status is een PURE projectie (security_invoker) —
--     geen schrijfactie op het Decision Object; audit blijft intact.
--   • Documentkoppeling: primaire `documenten.procesinstantie_id`
--     (max. één, want één kolom) + fondsconsistentie-trigger.
--     De secundaire `document_procesinstanties`-join-tabel +
--     context/status/metadata-velden blijven Increment C (TO §4).
--
--  Voor: Supabase Dashboard → SQL Editor → Run (EERST in Supabase,
--  daarna code-deploy — anders breken de nieuwe statuswaarden).
-- ============================================================

-- ── 1. Periode-velden op procedures (allemaal nullable, additief) ──
alter table public.procedures
  add column if not exists periode_type text
    check (periode_type in (
      'jaar','kwartaal','maand','projectperiode','ad_hoc','doorlopend','versiegedreven'
    )),
  add column if not exists periode_start date,
  add column if not exists periode_eind  date,
  add column if not exists periode_jaar  int;

-- ── 2. Statusmapping oud→nieuw + verbrede check-constraint ─────────
-- Volgorde is cruciaal: eerst oude check droppen, dan data mappen,
-- dan pre-flight verifiëren, pas dan de nieuwe check zetten.

-- 2a. Oude 3-waarden-check verwijderen (naam onbekend → dynamisch).
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.procedures'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.procedures drop constraint %I', c);
  end loop;
end $$;

-- 2b. Idempotente, verliesvrije mapping oud→nieuw.
update public.procedures set status = 'lopend'             where status = 'in_uitvoering';
update public.procedures set status = 'ter_besluitvorming' where status = 'wacht_op_besluit';
-- 'afgerond' blijft ongewijzigd.

-- 2c. Pre-flight: faal hard als een rij buiten de nieuwe set valt
--     (geen schijnzekerheid — liever stoppen dan een kapotte constraint).
do $$
declare
  v_aantal int;
begin
  select count(*) into v_aantal
    from public.procedures
   where status not in (
     'gepland','lopend','ter_besluitvorming','besloten',
     'in_implementatie','afgerond','heropend','gearchiveerd'
   );
  if v_aantal > 0 then
    raise exception
      'Migratie afgebroken: % procedure-rij(en) hebben een status buiten de nieuwe 8-waardenset. Controleer de mapping vóór het zetten van de constraint.',
      v_aantal;
  end if;
end $$;

-- 2d. Nieuwe 8-waarden-check + default.
alter table public.procedures
  add constraint procedures_status_check check (status in (
    'gepland','lopend','ter_besluitvorming','besloten',
    'in_implementatie','afgerond','heropend','gearchiveerd'
  ));

alter table public.procedures alter column status set default 'lopend';

-- ── 3. Mapping-functie 17 DO-statussen → 8 dossierstatussen ────────
-- IMMUTABLE + pure: geen tabeltoegang, dus testbaar over alle 17
-- statussen zonder rij-inserts en zonder de status-overgang-trigger.
-- Bron: TO v1.2 §3.2 (O2 besloten).
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
      else null
    end as sublabel;
$$;

-- ── 4. vw_dossier_status — effectieve dossierstatus + sublabel ─────
-- Pure projectie. security_invoker zodat RLS van procedures +
-- decision_objects leidend blijft (tenant-isolatie per fonds_id).
-- Prioriteit: primair Decision Object (is_primary_decision) → mapping;
-- geen Decision Object → handmatige procedures.status (fallback).
create or replace view public.vw_dossier_status
with (security_invoker = true) as
select
  p.id                              as procedure_id,
  p.fonds_id                        as fonds_id,
  d.id                              as decision_id,
  d.status                          as decision_status,
  (d.id is not null)                as afgeleid_van_decision,
  case when d.id is null then p.status   else m.dossierstatus end as dossierstatus,
  case when d.id is null then null::text else m.sublabel      end as sublabel
from public.procedures p
left join public.decision_objects d
       on d.procedure_id = p.id
      and d.is_primary_decision = true
left join lateral public.fn_dossierstatus_van_decision(d.status) m on true;

-- ── 5. Documentkoppeling: primaire procesinstantie ────────────────
-- Eén kolom = inherent "max. één primaire procesinstantie" (FO §6).
alter table public.documenten
  add column if not exists procesinstantie_id uuid
    references public.procedures(id) on delete set null;

create index if not exists idx_documenten_procesinstantie
  on public.documenten(procesinstantie_id)
  where procesinstantie_id is not null;

-- Fondsconsistentie via trigger (besluit 0007): documenten.fonds_id is
-- nullable (generieke bibliotheek), dus een composite-FK is hier niet
-- passend. De trigger eist: gekoppeld document en procesinstantie horen
-- bij hetzelfde fonds. Generieke documenten (fonds_id NULL) kunnen
-- daardoor niet aan een fonds-dossier koppelen — bewust, conform 0007.
create or replace function public.fn_document_procesinstantie_fonds_check()
returns trigger language plpgsql as $$
declare
  v_proc_fonds uuid;
begin
  if new.procesinstantie_id is null then
    return new;
  end if;
  select fonds_id into v_proc_fonds
    from public.procedures
   where id = new.procesinstantie_id;
  if v_proc_fonds is null then
    raise exception 'Procesinstantie % bestaat niet', new.procesinstantie_id;
  end if;
  if new.fonds_id is distinct from v_proc_fonds then
    raise exception
      'Fondsconsistentie geschonden: document-fonds % ≠ procesinstantie-fonds %',
      new.fonds_id, v_proc_fonds;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_procesinstantie_fonds on public.documenten;
create trigger trg_document_procesinstantie_fonds
  before insert or update of procesinstantie_id, fonds_id on public.documenten
  for each row execute procedure public.fn_document_procesinstantie_fonds_check();

-- ============================================================
--  Verificatie (handmatig na Run):
--
--  -- 5a. Mapping over alle 17 DO-statussen (viewtest-basis):
--  select s.status,
--         (public.fn_dossierstatus_van_decision(s.status)).dossierstatus,
--         (public.fn_dossierstatus_van_decision(s.status)).sublabel
--    from unnest(array[
--      'concept','in_onderbouwing','in_validatie','in_review','geagendeerd',
--      'in_bespreking','besloten','voorwaardelijk_besloten','afgewezen',
--      'aangehouden','geescaleerd','teruggezet','in_uitvoering','in_evaluatie',
--      'afgesloten','heropend','geannuleerd'
--    ]) as s(status);
--
--  -- 5b. Bestaande procedures behouden status + DO-koppeling:
--  select status, count(*) from public.procedures group by status;
--
--  -- 5c. Effectieve dossierstatus per procedure:
--  select procedure_id, dossierstatus, sublabel, afgeleid_van_decision
--    from public.vw_dossier_status;
--
--  -- 5d. Fondsconsistentie weigert cross-fonds koppeling:
--  --     (verwacht: exception bij update met afwijkend fonds)
-- ============================================================
