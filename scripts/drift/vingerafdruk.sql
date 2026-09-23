-- ============================================================================
--  #440 — DEFINITIEVINGERAFDRUK van de objecten die de V3-allowlist beheert.
-- ----------------------------------------------------------------------------
--  Eén query, identiek bruikbaar op de referentie-DB (opgebouwd uit
--  supabase/migrations/) en op een doelomgeving. Het verschil tussen beide
--  uitkomsten IS de drift.
--
--  Waarom een vingerafdruk van de DEFINITIE en niet alleen het bestaan: de
--  #367/#368-drift op Preview bestond uit een functie die er wél was, met de
--  juiste rechten, maar met een verouderde body. Aanwezigheid meten had daar
--  niets gevonden.
--
--  SCOPE: exact die van de V3-grants-gate — schema's public en storage,
--  relkind r/p/v/m/f, functies in beide schema's, plus storage-policies. Zo
--  kunnen "onbekend object" en "ontbrekend object" nooit iets anders betekenen
--  dan in die gate.
--
--  STRIKT READ-ONLY: alleen catalogus lezen.
-- ============================================================================
select sectie, sch, obj, md5(definitie) as vingerafdruk
from (
  -- ── Functies: de volledige definitie, inclusief body, volatility en search_path
  select 'FUNC'::text as sectie,
         n.nspname::text as sch,
         (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text as obj,
         pg_get_functiondef(p.oid)::text as definitie
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','storage')
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')

  union all
  -- ── Relaties: de kolomvorm. Naam, type, not-null en default, op volgorde.
  select 'REL', n.nspname::text, c.relname::text,
         coalesce(string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                             || case when a.attnotnull then ' NN' else '' end
                             || coalesce(' D=' || pg_get_expr(ad.adbin, ad.adrelid), ''),
                             E'\n' order by a.attnum), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
   where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m','f')
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
   group by n.nspname, c.relname

  union all
  -- ── Views/matviews: óók de querytekst; een view kan dezelfde kolommen
  --    houden terwijl de definitie eronder verandert.
  select 'VIEWDEF', n.nspname::text, c.relname::text, pg_get_viewdef(c.oid)::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','storage') and c.relkind in ('v','m')

  union all
  -- ── RLS-policies: predicaat, check, commando en rollen.
  select 'POL', pol.schemaname::text, (pol.tablename || '.' || pol.policyname)::text,
         coalesce(pol.cmd,'') || '|' || coalesce(pol.qual,'') || '|' ||
         coalesce(pol.with_check,'') || '|' || coalesce(array_to_string(pol.roles, ','),'')
    from pg_policies pol
   where pol.schemaname in ('public','storage')

  union all
  -- ── RLS aan/uit per tabel: een policy zegt niets als RLS uit staat.
  select 'RLS', n.nspname::text, c.relname::text,
         (case when c.relrowsecurity then 'aan' else 'uit' end) || '/' ||
         (case when c.relforcerowsecurity then 'force' else 'geen-force' end)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','storage') and c.relkind in ('r','p')

  union all
  -- ── Triggers: append-only-sloten en capture-triggers zijn hier de kern.
  select 'TRG', n.nspname::text, (c.relname || '.' || t.tgname)::text,
         pg_get_triggerdef(t.oid)::text
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','storage') and not t.tgisinternal

  union all
  -- ── Indexen: unieke indexen dragen invarianten (idempotentie, quota).
  select 'IDX', n.nspname::text, i.relname::text, pg_get_indexdef(i.oid)::text
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class c on c.oid = x.indrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','storage') and c.relkind in ('r','p')

  union all
  -- ── Constraints: CHECK-invarianten staan zelden in de allowlist maar
  --    dragen wel de helft van de fail-closed regels.
  select 'CON', n.nspname::text, (c.relname || '.' || con.conname)::text,
         pg_get_constraintdef(con.oid)::text
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','storage') and c.relkind in ('r','p')
) t
order by sectie, sch, obj;
