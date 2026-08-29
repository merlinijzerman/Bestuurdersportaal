-- P4 tranche 3 (#169) — niet_begonnen + de actief-trigger (§4.1, r159/169/550).
-- ---------------------------------------------------------------------------
-- Nieuw model: een activeerbare stap start als 'niet_begonnen' (was 'actief').
-- Hij wordt 'actief' bij de EERSTE INHOUDELIJKE HANDELING — een afgevinkt
-- checklistpunt, een gekoppeld bewijsstuk of een vastgelegd besluit — via een
-- AFTER-trigger die EXACT ÉÉN overgang doet: niet_begonnen → actief (nooit een
-- geblokkeerde/afgeronde/vervallen stap reactiveren; die statusvoorwaarde staat
-- in de WHERE). `actief_sinds`/`gestart_door` worden bij die overgang gezet.
-- (Expliciet "stap starten" via de route blijft een aparte handeling; dat pad
-- reist met het #214-a1-schrijfpad — hier niet aangeraakt.)
--
-- SECURITY DEFINER: de trigger schrijft procedure_stappen.status, dus hij moet
-- als owner draaien — óók ná de #214-a1-kolomrevoke die `authenticated` UPDATE op
-- status ontneemt. Forward-compatibel gebouwd.
--
-- Verbreding van de CHECK (niet_begonnen/vervallen) staat in p4_01.
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_29_p4_03_niet_begonnen_actief_trigger_ROLLBACK.sql

begin;

-- 1. Nieuwe kolommen: wanneer en door wie de stap actief werd.
alter table public.procedure_stappen
  add column if not exists actief_sinds timestamptz,
  add column if not exists gestart_door uuid references auth.users(id) on delete set null;

comment on column public.procedure_stappen.actief_sinds is
  'P4 (#169): tijdstip van de eerste inhoudelijke handeling (niet_begonnen → actief). Wordt niet gewist bij heropening.';
comment on column public.procedure_stappen.gestart_door is
  'P4 (#169): wie de stap met de eerste handeling activeerde.';

-- 2. Afgeleide cascade-overgang: geblokkeerd → niet_begonnen.
--    Na #214-a1 mag authenticated status niet direct bijwerken. Deze RPC
--    controleert daarom zelf fondsgrens én afhankelijkheden; een directe caller
--    kan geen stap voortijdig vrijgeven.
create or replace function public.fn_stap_activeerbaar_maken(
  p_stap_id      uuid,
  p_procedure_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_actorfonds uuid;
  v_procfonds  uuid;
  v_stap       record;
  v_onvervuld  boolean;
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;

  select pr.fonds_id into v_actorfonds
    from public.profielen pr
   where pr.id = v_actor;
  select p.fonds_id into v_procfonds
    from public.procedures p
   where p.id = p_procedure_id;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_actorfonds is distinct from v_procfonds then
    raise exception 'Fondsgrens: activeerbaarheid niet in het eigen fonds.' using errcode = '42501';
  end if;

  select ps.id, ps.status, ps.blokkerende_afhankelijkheden
    into v_stap
    from public.procedure_stappen ps
   where ps.id = p_stap_id
     and ps.procedure_id = p_procedure_id
   for update;
  if not found then
    raise exception 'Stap niet gevonden bij deze procedure.' using errcode = 'PC002';
  end if;
  if v_stap.status = 'niet_begonnen' then
    return jsonb_build_object('ok', true, 'onveranderd', true);
  end if;
  if v_stap.status is distinct from 'geblokkeerd' then
    raise exception 'Alleen een geblokkeerde stap kan activeerbaar worden.' using errcode = 'PC002';
  end if;

  select exists (
    select 1
      from unnest(coalesce(v_stap.blokkerende_afhankelijkheden, '{}'::int[])) dep(volgorde)
      left join public.procedure_stappen voorganger
        on voorganger.procedure_id = p_procedure_id
       and voorganger.volgorde = dep.volgorde
     where voorganger.id is null
        or voorganger.status is distinct from 'afgerond'
  ) into v_onvervuld;
  if v_onvervuld then
    raise exception 'Stap heeft nog onvervulde afhankelijkheden.' using errcode = 'PC002';
  end if;

  update public.procedure_stappen
     set status = 'niet_begonnen'
   where id = p_stap_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_stap_activeerbaar_maken(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.fn_stap_activeerbaar_maken(uuid, uuid)
  to authenticated;

-- 3. Trigger-functie: één overgang, niet_begonnen → actief.
create or replace function public.fn_stap_actief_bij_handeling()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stap_id uuid;
begin
  if tg_table_name = 'procedure_checklist' then
    -- Alleen een AFGEVINKT checklistpunt is een handeling.
    if not coalesce(new.voldaan, false) then
      return new;
    end if;
    v_stap_id := new.stap_id;
  elsif tg_table_name = 'procedure_bewijs' then
    v_stap_id := new.stap_id;
  elsif tg_table_name = 'procedure_besluiten' then
    v_stap_id := new.stap_id;   -- kan NULL zijn: een besluit hoeft niet aan een stap te hangen
  end if;

  if v_stap_id is null then
    return new;
  end if;

  update public.procedure_stappen
     set status = 'actief',
         actief_sinds = coalesce(actief_sinds, now()),
         gestart_door = coalesce(gestart_door, auth.uid())
   where id = v_stap_id
     and status = 'niet_begonnen';   -- exact één overgang; nooit reactiveren

  return new;
end $$;

revoke all on function public.fn_stap_actief_bij_handeling()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_stap_actief_checklist on public.procedure_checklist;
create trigger trg_stap_actief_checklist
  after insert or update of voldaan on public.procedure_checklist
  for each row execute function public.fn_stap_actief_bij_handeling();

drop trigger if exists trg_stap_actief_bewijs on public.procedure_bewijs;
create trigger trg_stap_actief_bewijs
  after insert on public.procedure_bewijs
  for each row execute function public.fn_stap_actief_bij_handeling();

drop trigger if exists trg_stap_actief_besluit on public.procedure_besluiten;
create trigger trg_stap_actief_besluit
  after insert on public.procedure_besluiten
  for each row execute function public.fn_stap_actief_bij_handeling();

-- 4. Herclassificatie lopende processen (§4.1 r171), deterministisch en idempotent:
--    een 'actief' stap ZONDER inhoudelijke handeling wordt niet_begonnen; met
--    handeling blijft hij actief en krijgt een actief_sinds (bij benadering now();
--    de vroegste procedure_log-gebeurtenis is een latere verfijning).
update public.procedure_stappen ps
   set status = 'niet_begonnen'
 where ps.status = 'actief'
   and not exists (select 1 from public.procedure_checklist c where c.stap_id = ps.id and coalesce(c.voldaan, false))
   and not exists (select 1 from public.procedure_bewijs b where b.stap_id = ps.id)
   and not exists (select 1 from public.procedure_besluiten bl where bl.stap_id = ps.id);

update public.procedure_stappen ps
   set actief_sinds = now()
 where ps.status = 'actief' and ps.actief_sinds is null;

commit;
