-- #369 Preview-reparatie: alleen cataloguslezingen en tellingen, geen mutatie.
-- Bevestig buiten SQL het Supabase-projectref swviwoytzvaqypieqgji.

do $$
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com') then
    raise exception '369_verkeerde_doelomgeving' using errcode = '23514';
  end if;

  if to_regprocedure('public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)') is null
     or to_regprocedure('public.fn_schrijf_vergelijking(text,text,text,text,jsonb)') is null then
    raise exception '369_functie_ontbreekt' using errcode = '23514';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'comparison_run' and column_name = 'correlation_id'
              and data_type = 'text')
          or (table_name = 'comparison_run' and column_name in ('retrieval_meta','bronnen')
              and data_type = 'jsonb' and is_nullable = 'NO')
          or (table_name = 'comparison_results' and column_name in ('bron_passage_ref','doel_passage_ref')
              and data_type = 'text'))) <> 5 then
    raise exception '369_kolomvorm_onjuist' using errcode = '23514';
  end if;

  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)')
                    and prosecdef
                    and proconfig @> array['search_path=public, pg_temp']) then
    raise exception '369_functiegrens_onjuist' using errcode = '23514';
  end if;

  if has_function_privilege('anon',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('service_role',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception '369_functiegrants_onjuist' using errcode = '23514';
  end if;

  if (select count(*) from pg_class
      where oid in ('public.comparison_run'::regclass,
                    'public.comparison_results'::regclass)
        and relrowsecurity) <> 2 then
    raise exception '369_rls_onjuist' using errcode = '23514';
  end if;
end $$;

select '369_POSTCHECK_GROEN' as uitkomst,
       (select count(*) from public.comparison_run) as runs,
       (select count(*) from public.comparison_results) as resultaten;
