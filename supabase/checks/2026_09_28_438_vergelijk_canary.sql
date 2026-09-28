-- #438 — READ-ONLY postcheck voor de Preview-vergelijkcanary.
do $$
declare
  v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then raise exception '#438 vergelijkcheck: verkeerde doelomgeving'; end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';

  if not exists (select 1 from public.fonds_feature_flags
                  where fonds_id = v_fonds
                    and flag_key = 'vergelijkmodus'
                    and waarde = 'true'::jsonb)
  then raise exception '#438 vergelijkcheck: m365-demo staat niet exact aan'; end if;

  if exists (select 1 from public.fondsen f
              join public.fonds_feature_flags ff on ff.fonds_id = f.id
             where f.slug <> 'm365-demo'
               and ff.flag_key = 'vergelijkmodus'
               and ff.waarde = 'true'::jsonb)
  then raise exception '#438 vergelijkcheck: vergelijkmodus staat buiten m365-demo aan'; end if;

  if to_regclass('public.comparison_results') is null
     or not exists (select 1 from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public'
                      and p.proname = 'fn_schrijf_vergelijking')
  then raise exception '#438 vergelijkcheck: vergelijkservicebasis ontbreekt'; end if;
end $$;
