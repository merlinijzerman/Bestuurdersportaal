-- ============================================================================
-- V2 — security_invoker=on op de definer-views (herscopet uit "FORCE RLS").
-- ----------------------------------------------------------------------------
-- Achtergrond (ticket V2, Bevinding B): de eigenaar `postgres` heeft BYPASSRLS,
-- dus FORCE ROW LEVEL SECURITY op tabellen is geen effectieve tweede laag. De
-- tweede laag voor de definer-view-klasse (C-01) is `security_invoker = on`:
-- dan wordt RLS als de AANROEPER geëvalueerd (authenticated, géén bypassrls).
--
-- Muteert alleen view-reloptions + voegt één SELECT-policy toe. Geen data.
-- Reversibel via het _ROLLBACK-bestand. Idempotent.
--
-- Per view:
--   • vw_dossier_status   — staat al op security_invoker; hier niet aangeraakt.
--   • vw_governance_audit — service_role-only op productie (bypassrls omzeilt RLS
--       toch); flip is onschadelijke diepteverdediging voor als er ooit een
--       user-grant bijkomt.
--   • vw_fondsleden       — user-leesbaar. `profielen`.SELECT is eigen-rij
--       (`auth.uid()=id`), dus onder invoker zou de view alleen jezelf tonen.
--       Daarom eerst een fonds-scoped SELECT-policy via de definer-helper
--       fn_zelfde_fonds (geen RLS-recursie), dan de flip: ledenlijst intact,
--       cross-tenant geblokkeerd.
-- ============================================================================

begin;

drop policy if exists "profiel select eigen fonds" on public.profielen;
create policy "profiel select eigen fonds" on public.profielen
  for select using (public.fn_zelfde_fonds(id));

alter view public.vw_fondsleden       set (security_invoker = on);
alter view public.vw_governance_audit set (security_invoker = on);

do $verif$
declare r record;
begin
  for r in
    select c.relname,
           coalesce((select option_value from pg_options_to_table(c.reloptions)
                     where option_name='security_invoker'),'off') as si
    from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    where c.relkind='v' and c.relname in ('vw_fondsleden','vw_governance_audit')
  loop
    if r.si not in ('true','on') then
      raise exception 'V2-migratie: view % staat niet op security_invoker — teruggedraaid.', r.relname;
    end if;
  end loop;
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='profielen'
                   and policyname='profiel select eigen fonds') then
    raise exception 'V2-migratie: fonds-scoped leespolicy op profielen ontbreekt — teruggedraaid.';
  end if;
end
$verif$;

commit;
