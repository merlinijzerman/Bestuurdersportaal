-- Actie-eigenaar → profielkoppeling.
--
-- Een decision_action droeg de eigenaar alleen als vrije tekst. Nieuwe acties
-- verwijzen nu naar een bestaand profiel (`eigenaar_id`) uit hetzelfde fonds.
-- `eigenaar_naam` blijft een historische snapshot voor bestaande rijen en als
-- terugval na het verwijderen van een profiel. De trigger sluit ook directe
-- tabelschrijvers af: een cross-tenant of vrije-tekst eigenaar komt niet door.
--
-- HAND-APPLIED vóór de code-deploy. Rollback:
-- supabase/rollbacks/2026_08_30_actie_eigenaar_profiel_ROLLBACK.sql

begin;

alter table public.decision_actions
  add column if not exists eigenaar_id uuid
  references public.profielen(id) on delete set null;

create index if not exists idx_decision_actions_eigenaar_id
  on public.decision_actions(eigenaar_id)
  where eigenaar_id is not null;

create or replace function public.fn_guard_decision_action_eigenaar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eigenaar_naam text;
begin
  -- Geen vrije tekst meer op NIEUWE actiepunten. Oude snapshots blijven bij
  -- bestaande rijen staan en mogen ongewijzigd door statusupdates heen.
  if new.eigenaar_id is null then
    if tg_op = 'INSERT' and new.eigenaar_naam is not null then
      raise exception 'actie-eigenaar moet een profiel zijn'
        using errcode = '23514';
    end if;
    if tg_op = 'UPDATE'
       and old.eigenaar_id is null
       and new.eigenaar_naam is distinct from old.eigenaar_naam then
      raise exception 'actie-eigenaar moet een profiel zijn'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select p.naam
    into v_eigenaar_naam
    from public.decision_objects d
    join public.profielen p
      on p.id = new.eigenaar_id
     and p.fonds_id = d.fonds_id
   where d.id = new.decision_id;

  if not found then
    raise exception 'actie-eigenaar hoort niet bij hetzelfde fonds'
      using errcode = '23514';
  end if;

  -- De snapshot is alleen een afgeleide van het profiel. Een directe writer
  -- mag hem niet los van dat profiel overschrijven.
  if tg_op = 'UPDATE'
     and new.eigenaar_id is not distinct from old.eigenaar_id
     and new.eigenaar_naam is distinct from old.eigenaar_naam then
    raise exception 'actie-eigenaarnaam volgt uitsluitend uit het profiel'
      using errcode = '23514';
  end if;

  -- Alleen bij toekennen/wijzigen leggen we de naam-snapshot vast. Een latere
  -- profielnaamswijziging maakt een gewone actie-statuswijziging dus niet stuk;
  -- de UI geeft dan de live profielnaam weer.
  if tg_op = 'INSERT' or new.eigenaar_id is distinct from old.eigenaar_id then
    if new.eigenaar_naam is distinct from nullif(btrim(v_eigenaar_naam), '') then
      raise exception 'actie-eigenaarnaam moet de profielnaam volgen'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_guard_decision_action_eigenaar() from public;

drop trigger if exists trg_guard_decision_action_eigenaar on public.decision_actions;
create trigger trg_guard_decision_action_eigenaar
  before insert or update of decision_id, eigenaar_id, eigenaar_naam
  on public.decision_actions
  for each row execute function public.fn_guard_decision_action_eigenaar();

comment on column public.decision_actions.eigenaar_id is
  'Profiel van de actie-eigenaar. Moet bij hetzelfde fonds horen als het besluit; bewaakt door trg_guard_decision_action_eigenaar.';

commit;
