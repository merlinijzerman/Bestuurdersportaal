-- Rollback van 2026_08_30_p5a_02_actie_eigenaar_externe_houder.sql.
-- Herstelt uitsluitend de oorspronkelijke P5a-triggerlogica; daarna kan pas
-- de rollback van de profielkoppeling zelf volgen.
begin;
create or replace function public.fn_guard_decision_action_eigenaar()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_eigenaar_naam text;
begin
  if new.eigenaar_id is null then
    if tg_op = 'INSERT' and new.eigenaar_naam is not null then
      raise exception 'actie-eigenaar moet een profiel zijn' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and old.eigenaar_id is null and new.eigenaar_naam is distinct from old.eigenaar_naam then
      raise exception 'actie-eigenaar moet een profiel zijn' using errcode = '23514';
    end if;
    return new;
  end if;
  select p.naam into v_eigenaar_naam from public.decision_objects d join public.profielen p
    on p.id = new.eigenaar_id and p.fonds_id = d.fonds_id where d.id = new.decision_id;
  if not found then raise exception 'actie-eigenaar hoort niet bij hetzelfde fonds' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and new.eigenaar_id is not distinct from old.eigenaar_id and new.eigenaar_naam is distinct from old.eigenaar_naam then
    raise exception 'actie-eigenaarnaam volgt uitsluitend uit het profiel' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.eigenaar_id is distinct from old.eigenaar_id then
    if new.eigenaar_naam is distinct from nullif(btrim(v_eigenaar_naam), '') then
      raise exception 'actie-eigenaarnaam moet de profielnaam volgen' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fn_guard_decision_action_eigenaar() from public, authenticated, service_role;
commit;
