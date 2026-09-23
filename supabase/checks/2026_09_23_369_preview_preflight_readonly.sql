-- #369 Preview-reparatie: alleen cataloguslezingen en tellingen, geen mutatie.
-- Bevestig buiten SQL het Supabase-projectref swviwoytzvaqypieqgji.
-- Deze controle past bij de op 23-09-2026 gemeten, nog niet gemigreerde stand.

do $$
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com') then
    raise exception '369_verkeerde_doelomgeving' using errcode = '23514';
  end if;

  if to_regprocedure('public.fn_schrijf_vergelijking(text,text,text,text,jsonb)') is null
     or to_regprocedure('public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)') is not null then
    raise exception '369_onverwachte_functiestand' using errcode = '23514';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'comparison_run'
              and column_name in ('correlation_id','retrieval_meta','bronnen'))
          or (table_name = 'comparison_results'
              and column_name in ('bron_passage_ref','doel_passage_ref')))) <> 0 then
    raise exception '369_onverwachte_kolomstand' using errcode = '23514';
  end if;

  if exists (select 1 from public.comparison_run)
     or exists (select 1 from public.comparison_results) then
    raise exception '369_bestaande_vergelijkdata_vereist_aparte_review' using errcode = '23514';
  end if;

  if to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('auth.uid()') is null
     or not exists (select 1 from pg_proc
                     where oid = to_regprocedure('public.fn_schrijf_vergelijking(text,text,text,text,jsonb)')
                       and prosecdef
                       and proconfig @> array['search_path=public, pg_temp']) then
    raise exception '369_afhankelijkheid_ontbreekt' using errcode = '23514';
  end if;

  if has_function_privilege('anon',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.fn_schrijf_vergelijking(text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception '369_onverwachte_oude_grants' using errcode = '23514';
  end if;
end $$;

select '369_PRECHECK_GROEN' as uitkomst,
       (select count(*) from public.comparison_run) as bestaande_runs,
       (select count(*) from public.comparison_results) as bestaande_resultaten;
