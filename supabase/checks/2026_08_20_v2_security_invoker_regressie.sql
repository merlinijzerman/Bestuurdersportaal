-- ============================================================================
-- V2 — Regressiecheck: security_invoker op tenant-views.
-- ----------------------------------------------------------------------------
-- Achtergrond (ticket V2, na Bevinding B): de eigenaar `postgres` heeft
-- BYPASSRLS, dus FORCE ROW LEVEL SECURITY op tabellen is geen effectieve tweede
-- laag. De tweede laag voor de definer-view-klasse (C-01) is
-- `security_invoker = on`: dan wordt RLS als de AANROEPER geëvalueerd
-- (authenticated, géén bypassrls) i.p.v. als de view-eigenaar.
--
-- Deze check faalt zodra een view in `public` die (a) een fonds_id-tabel leest
-- én (b) leesbaar is voor een niet-bypassrls user-rol (anon/authenticated), NIET
-- op security_invoker staat. service_role (BYPASSRLS) omzeilt RLS toch, dus een
-- service_role-only view is geen C-01-blootstelling en wordt niet geëist.
-- Read-only. Overtreding → raise exception → psql exit <> 0 → CI faalt. Elke
-- "LEK:" markeert een user-leesbare tenant-view zonder de tweede laag.
--
-- Negatieve controle (besluit 0046 §E-patroon): zet op een wegwerp-DB één
-- tenant-view terug op security_invoker=off → deze check wordt ROOD.
-- ============================================================================

do $regressie$
declare
  -- Uitzonderingen: views die BEWUST definer mogen zijn (bv. een platform-brede
  -- aggregatie die juist over fondsen heen kijkt, met eigen rolgate). Leeg tot
  -- er een gemotiveerde uitzondering is; elke uitzondering krijgt een reden.
  v_uitzonderingen text[] := array[]::text[];
  r record;
  v_lekken text[] := '{}';
begin
  for r in
    with tenant_views as (
      select distinct c.relname, c.oid,
             coalesce((select option_value from pg_options_to_table(c.reloptions)
                       where option_name='security_invoker'),'off') as si
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
      join pg_rewrite rw on rw.ev_class=c.oid
      join pg_depend d on d.objid=rw.oid and d.classid='pg_rewrite'::regclass
      join pg_class dep on dep.oid=d.refobjid and dep.relkind in ('r','p')
      join pg_namespace dn on dn.oid=dep.relnamespace and dn.nspname='public'
      where c.relkind='v'
        and exists (select 1 from pg_attribute a
                    where a.attrelid=dep.oid and a.attname='fonds_id' and not a.attisdropped)
    )
    select relname from tenant_views
    where si not in ('true','on')
      -- Alleen relevant als een NIET-bypassrls user-rol (anon/authenticated) de
      -- view kan lezen. service_role heeft BYPASSRLS en omzeilt RLS toch, dus
      -- daar is security_invoker geen isolatielaag en geen C-01-blootstelling.
      and (has_table_privilege('anon', oid, 'SELECT')
        or has_table_privilege('authenticated', oid, 'SELECT'))
      and not (relname = any(v_uitzonderingen))
    order by relname
  loop
    v_lekken := v_lekken || r.relname;
    raise warning 'LEK: % is leesbaar voor een user-rol maar staat niet op security_invoker', r.relname;
  end loop;

  if cardinality(v_lekken) > 0 then
    raise exception 'V2-REGRESSIE: % tenant-view(s) zonder security_invoker en niet uitgezonderd: %',
      cardinality(v_lekken), array_to_string(v_lekken, ', ');
  end if;

  raise notice 'V2-REGRESSIE OK: elke tenant-view in public staat op security_invoker (of gemotiveerd uitgezonderd).';
end
$regressie$;
