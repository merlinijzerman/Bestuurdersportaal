-- ============================================================================
-- V3 — GRANTS-GATE over ALLE objectklassen (tabellen, views, matviews, foreign/
--      partitioned tables, functies, storage-buckets, storage-policies).
-- ----------------------------------------------------------------------------
-- Aanleiding (REVIEW-API-SECURITY-EN-ARCHITECTUUR-2026-08-20 §12 G-2, ticket V3).
-- De structurele gates A–H redeneren over TABELLEN en FUNCTIES, nooit over
-- VIEWS. Dat is precies de blinde vlek waarin C-01 viel: een view kreeg via de
-- Supabase-default-ACL schrijfrechten die geen controle zag. Deze gate sluit die
-- klasse met één volledigheidsredenering: hij vergelijkt de FEITELIJKE rechten
-- op elke relatie en functie in `public` + `storage` met een expliciete
-- allowlist in de repo (`supabase/checks/allowlist-grants.tsv`) en faalt bij elk
-- verschil — in beide richtingen, én op elk onbekend object.
--
-- EIGENAARSCHAP (besluit V3). Deze gate is de ENIGE autoriteit voor GRANTS:
--   • hij absorbeert de V10-regel uit 2026_08_02_fondsleden_cross_tenant.sql
--     (geen view met I/U/D voor anon/authenticated) — expliciet hieronder;
--   • hij toetst GEEN prosecdef/proconfig (search_path-pinning). Dat is
--     functiehygiëne en blijft bij gate E in 2026_07_31_r1_structurele_gates.sql.
--   • privilegevocabulaire is volledig, INCLUSIEF MAINTAIN (Postgres 17): anon
--     en authenticated horen dat recht nergens te hebben (V3-remediatie-migratie
--     2026_08_20_v3_maintain_revoke.sql). service_role behoudt het, net als bij
--     gate F de vertrouwde backend-rol.
--
-- BASELINE. De allowlist is de PRODUCTIE-stand als uitgangspunt, geannoteerd naar
-- de migratiewaarheid: de vier platform-event-chain-objecten (in migratie, nog
-- niet in productie) staan erin, en fn_platform_event_hash staat gehard (geen
-- grants). Zie allowlist-grants.toelichting.md voor elke afwijking + reden.
--
-- WERKSTROOM (dwingende checklist, geen rapportage). Een nieuw databaseobject —
-- tabel, view, functie, bucket — vereist een regel in de allowlist; anders faalt
-- deze gate op "onbekend object". Dat is de forcing function: bij elk nieuw
-- object een BEWUSTE keuze over zijn grants.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand   (vanuit repo-root,
--             i.v.m. het relatieve \copy-pad). Draait in scripts/cross-tenant-ci.sh.
-- LET OP: dit bestand gebruikt \copy (psql-clientcommando) en is daarmee NIET
-- rechtstreeks in de Supabase SQL-editor plakbaar; dat is de prijs van een
-- file-gedreven allowlist. Voor editor-gebruik: laad de tsv handmatig in v3_allow.
-- ============================================================================

-- ── Allowlist inladen ───────────────────────────────────────────────────────
-- ----------------------------------------------------------------------------
-- ROL: postgres — en dat is hier een EIS, geen gemak. Deze gate vraagt met
--      has_table_privilege(<rol>, ...) NAAR de rechten van anon, authenticated
--      en service_role; hij meet dus niet ALS die rollen maar OVER hen, en
--      daarvoor is de volledige catalogus nodig. Een beperkte rol zou objecten
--      niet zien en het verschil zou als "geen afwijking" uitkomen. Genereer de
--      allowlist met dezelfde rol (scripts/gen/v3-allowlist-generate.sql);
--      genereren en toetsen met verschillende rollen laat de gate structureel
--      missen wat de allowlist wél bevat.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

drop table if exists v3_allow;
create temp table v3_allow (
  sectie text, sch text, obj text, klasse text, rol text, rechten text
);
\copy v3_allow from 'supabase/checks/allowlist-grants.tsv' with (format csv, delimiter E'\t', header true)

-- ── Feitelijke stand berekenen (IDENTIEKE logica als de generator) ──────────
drop table if exists v3_actual;
create temp table v3_actual (
  sectie text, sch text, obj text, klasse text, rol text, rechten text
);

insert into v3_actual
with rollen(rol) as (values ('anon'),('authenticated'),('service_role')),
privs(p, ord) as (values
  ('SELECT',1),('INSERT',2),('UPDATE',3),('DELETE',4),
  ('TRUNCATE',5),('REFERENCES',6),('TRIGGER',7),('MAINTAIN',8)),
rel as (
  select n.nspname::text sch, c.oid, c.relname::text obj,
         case c.relkind when 'r' then 'table' when 'p' then 'partitioned table'
              when 'v' then 'view' when 'm' then 'materialized view'
              when 'f' then 'foreign table' end klasse
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m','f')
),
rel_rows as (
  select 'REL' sectie, rel.sch, rel.obj, rel.klasse, r.rol,
         coalesce((select string_agg(privs.p, ',' order by privs.ord)
                     from privs where has_table_privilege(r.rol, rel.oid, privs.p)), '-') rechten
    from rel cross join rollen r
),
fn as (
  select n.nspname::text sch, p.oid,
         (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text obj
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','storage')
     and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
),
fn_rows as (
  select 'FUNC' sectie, fn.sch, fn.obj, 'function' klasse, r.rol,
         case when has_function_privilege(r.rol, fn.oid, 'EXECUTE') then 'EXECUTE' else '-' end rechten
    from fn cross join rollen r
),
bucket_rows as (
  select 'BUCKET' sectie, 'storage' sch, b.id obj, 'bucket' klasse, '-' rol,
         case when b.public then 'public=true' else 'public=false' end rechten
    from storage.buckets b
),
stgpol_rows as (
  select 'STGPOL' sectie, p.schemaname::text sch,
         (p.tablename || ' :: ' || p.policyname)::text obj, 'policy' klasse,
         array_to_string(p.roles, ',') rol, p.cmd rechten
    from pg_policies p
   where p.schemaname='storage'
     -- Alleen policies die één van de drie bewaakte app-rollen (of PUBLIC)
     -- raken. Operationele rollen zoals drift_lezer hebben een eigen gate.
     and p.roles && array['public','anon','authenticated','service_role']::name[]
)
select sectie, sch, obj, klasse, rol, rechten
  from (select * from rel_rows union all select * from fn_rows
        union all select * from bucket_rows union all select * from stgpol_rows) alles;

-- ── Vergelijken en falen bij elk verschil ───────────────────────────────────
do $$
declare
  lek text := '';
  r record;
  -- '-' (geen recht) → lege verzameling; anders splitsen op komma (zie hieronder).
begin
  -- 1. LEK: onbekend object — feitelijk object dat niet in de allowlist staat.
  --    DE belangrijkste regel: dwingt een bewuste keuze bij elk nieuw object.
  --    UITZONDERING (smal, expliciet): storage.iceberg_namespaces / iceberg_tables
  --    zijn de Supabase-Iceberg-catalogus — platform-beheerd en VERSIE-AFHANKELIJK
  --    aanwezig: afwezig op Productie/Preview (gemeten 27-08-2026), aanwezig op de
  --    ephemere CI-Supabase (nieuwere Supabase-CLI). Ze staan bewust NIET in de
  --    allowlist (zie toelichting §8); zonder deze uitzondering slaat de gate op de
  --    CI-DB vals-rood op hun *aanwezigheid*. Alleen deze twee, alleen hier — elk
  --    ander storage-object blijft exact gecontroleerd.
  for r in
    select distinct a.sch, a.obj, a.klasse
      from v3_actual a
     where not exists (select 1 from v3_allow w
                        where w.sch=a.sch and w.obj=a.obj)
       and not (a.sch = 'storage'
                and a.obj in ('iceberg_namespaces', 'iceberg_tables'))
     order by 1,2
  loop
    lek := lek || format('  LEK onbekend object: %s.%s (%s) staat niet in de allowlist%s',
                         r.sch, r.obj, r.klasse, chr(10));
  end loop;

  -- 2. LEK: ontbrekend object — allowlist verwacht een object dat er niet is.
  for r in
    select distinct w.sch, w.obj, w.klasse
      from v3_allow w
     where not exists (select 1 from v3_actual a
                        where a.sch=w.sch and a.obj=w.obj)
     order by 1,2
  loop
    lek := lek || format('  LEK ontbrekend object: allowlist verwacht %s.%s (%s), niet aanwezig%s',
                         r.sch, r.obj, r.klasse, chr(10));
  end loop;

  -- 3. Per (object, rol): rechten vergelijken. Onverwacht = feitelijk \ allowlist,
  --    ontbrekend = allowlist \ feitelijk. Alleen voor objecten die in BEIDE
  --    voorkomen (onbekende/ontbrekende objecten zijn hierboven al gemeld).
  for r in
    select a.sch, a.obj, a.klasse, a.rol,
           coalesce(a.rechten,'-') as feitelijk,
           coalesce(w.rechten,'-') as verwacht,
           case when coalesce(a.rechten,'-')='-' then '{}'::text[]
                else string_to_array(a.rechten,',') end as a_set,
           case when coalesce(w.rechten,'-')='-' then '{}'::text[]
                else string_to_array(w.rechten,',') end as w_set
      from v3_actual a
      join v3_allow w on w.sch=a.sch and w.obj=a.obj and w.rol=a.rol
     where coalesce(a.rechten,'-') <> coalesce(w.rechten,'-')
     order by a.sch, a.obj, a.rol
  loop
    if array_length(array(select unnest(r.a_set) except select unnest(r.w_set)),1) > 0 then
      lek := lek || format('  LEK onverwachte rechten: %s.%s [%s] heeft {%s}, allowlist staat {%s} toe%s',
                           r.sch, r.obj, r.rol,
                           array_to_string(array(select unnest(r.a_set) except select unnest(r.w_set)),','),
                           r.verwacht, chr(10));
    end if;
    if array_length(array(select unnest(r.w_set) except select unnest(r.a_set)),1) > 0 then
      lek := lek || format('  LEK ontbrekende rechten: %s.%s [%s] mist {%s} (allowlist verwacht {%s})%s',
                           r.sch, r.obj, r.rol,
                           array_to_string(array(select unnest(r.w_set) except select unnest(r.a_set)),','),
                           r.verwacht, chr(10));
    end if;
  end loop;

  -- 4. LEK: view met I/U/D voor anon of authenticated (absorbeert V10, de
  --    expliciete C-01-regel). Redundant met (3) zodra de allowlist klopt, maar
  --    bewust apart: dit is de regel die C-01 benoemt, los van de allowlist.
  for r in
    select c.relname, rr.rol,
           array_to_string(array(
             select pr from unnest(array['INSERT','UPDATE','DELETE']) pr
              where has_table_privilege(rr.rol, c.oid, pr)), ',') as schrijf
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
     cross join (values ('anon'),('authenticated')) rr(rol)
     where c.relkind in ('v','m')
       and exists (select 1 from unnest(array['INSERT','UPDATE','DELETE']) pr
                    where has_table_privilege(rr.rol, c.oid, pr))
     order by 1,2
  loop
    lek := lek || format('  LEK view-schrijfrecht (C-01): %s heeft {%s} voor %s%s',
                         r.relname, r.schrijf, r.rol, chr(10));
  end loop;

  if lek <> '' then
    raise exception E'V3 GRANTS-GATE FAALT — verschil tussen feitelijke rechten en allowlist:\n%\nHerstel de rechten, of — als de wijziging bewust is — pas supabase/checks/allowlist-grants.tsv aan (met reden in de toelichting).', lek;
  end if;
  raise notice 'V3 GRANTS-GATE OK: feitelijke rechten op alle relaties, functies, buckets en storage-policies komen exact overeen met de allowlist (incl. MAINTAIN-hygiëne en de C-01-view-regel).';
end $$;
