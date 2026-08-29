-- #214-a1 (besluit 0194) — INSERT-poort op procedure_stappen (reviewbevinding).
-- ---------------------------------------------------------------------------
-- De kolom-revoke (02) sluit alleen UPDATE. `authenticated` houdt tabel-brede
-- INSERT, en de `for all`-fonds-only-policy toetst geen kolomwaarde — dus kan een
-- fondslid met één directe PostgREST-INSERT een NIEUWE stap aanmaken met
-- status='afgerond' en voltooid_door=<willekeurige uuid>: hetzelfde vervalste
-- verantwoordingsfeit, via INSERT i.p.v. UPDATE. (Zelfde klasse als de
-- INSERT-omzeiling die p3d_05 op decision_objects dichtte.)
--
-- Remedie: een BEFORE INSERT-trigger die voor het clientpad (current_user in
-- authenticated/anon) een besluit-/voltooiingstoestand bij het AANMAKEN weigert.
-- Een stap-status als afgerond/heropend is een OVERGANG, geen begintoestand; en
-- voltooiing hoort bij het afronden, niet bij het aanmaken. Owner/service_role
-- (migraties, seeds, de aanmaakroute draait als authenticated maar zet status
-- open/geblokkeerd/actief en geen voltooiing) blijven vrij resp. ongemoeid.
--
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_28_p214a1_04_stap_insert_guard_ROLLBACK.sql

begin;

create or replace function public.fn_guard_stap_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status in ('afgerond', 'heropend') then
      raise exception 'Een nieuwe stap mag niet als % worden aangemaakt (status is een overgang, geen begintoestand).', new.status
        using errcode = '42501';
    end if;
    if new.voltooid_op is not null or new.voltooid_door is not null then
      raise exception 'Voltooiing (voltooid_op/voltooid_door) mag niet bij het aanmaken van een stap worden gezet.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.fn_guard_stap_insert() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_stap_insert on public.procedure_stappen;
create trigger trg_guard_stap_insert
  before insert on public.procedure_stappen
  for each row execute function public.fn_guard_stap_insert();

commit;
