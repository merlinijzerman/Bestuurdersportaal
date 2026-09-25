-- #428 Preview self-check (read-only).
do $$
declare v_fonds uuid;
begin
  select id into strict v_fonds from public.fondsen where slug='m365-demo' and naam='Bestuurdersportaal M365 Demo';
  if not exists (select 1 from public.tenant_domains where host='app365.preview.bestuurdersportaal.com' and fonds_id=v_fonds and actief)
     or exists (select 1 from public.tenant_domains where host='app365.bestuurdersportaal.com')
  then raise exception '#428 Preview-hostisolatie faalt'; end if;
  if (select count(*) from public.fonds_module_manifest where fonds_id=v_fonds) <> 13
     or exists (select 1 from public.fonds_module_manifest where fonds_id=v_fonds and actief is distinct from (module_key in ('home','beheer','governance','assurance')))
  then raise exception '#428 Preview-modulematrix faalt'; end if;
  if exists (
    select flag_key, waarde from public.fonds_feature_flags where fonds_id=v_fonds
    except select * from (values
      ('microsoft_copilot_retrieval','false'::jsonb), ('microsoft_sharepoint_retrieval_spike','false'::jsonb),
      ('microsoft_sharepoint_fase3','false'::jsonb), ('microsoft_outlook_fase2a','false'::jsonb),
      ('hybride_zoeken','false'::jsonb), ('rerank','false'::jsonb), ('relevantie_drempel','false'::jsonb),
      ('relevantie_drempel_waarde','20'::jsonb), ('jargon_expansie','false'::jsonb),
      ('parent_retrieval','false'::jsonb), ('representatie_constraints','true'::jsonb),
      ('regime_weging','true'::jsonb), ('vraagrouter_v2','false'::jsonb),
      ('vraagrouter_model','false'::jsonb), ('volledige_analyse_vervolg','false'::jsonb),
      ('retrieval_timeout_ms','20000'::jsonb), ('generatie_timeout_ms','120000'::jsonb)
    ) as verwacht(flag_key, waarde)
  ) or exists (
    select * from (values
      ('microsoft_copilot_retrieval','false'::jsonb), ('microsoft_sharepoint_retrieval_spike','false'::jsonb),
      ('microsoft_sharepoint_fase3','false'::jsonb), ('microsoft_outlook_fase2a','false'::jsonb),
      ('hybride_zoeken','false'::jsonb), ('rerank','false'::jsonb), ('relevantie_drempel','false'::jsonb),
      ('relevantie_drempel_waarde','20'::jsonb), ('jargon_expansie','false'::jsonb),
      ('parent_retrieval','false'::jsonb), ('representatie_constraints','true'::jsonb),
      ('regime_weging','true'::jsonb), ('vraagrouter_v2','false'::jsonb),
      ('vraagrouter_model','false'::jsonb), ('volledige_analyse_vervolg','false'::jsonb),
      ('retrieval_timeout_ms','20000'::jsonb), ('generatie_timeout_ms','120000'::jsonb)
    ) as verwacht(flag_key, waarde)
    except select flag_key, waarde from public.fonds_feature_flags where fonds_id=v_fonds
  )
  then raise exception '#428 Preview-flagmatrix faalt'; end if;
  if not exists (select 1 from public.fonds_feature_flags where fonds_id=v_fonds and flag_key='generatie_timeout_ms' and waarde='120000'::jsonb)
     or not exists (select 1 from public.fonds_microsoft_login where fonds_id=v_fonds and modus='uit' and not actief and entra_tenant_id is null)
     or not exists (select 1 from public.fonds_integratie_profielen where fonds_id=v_fonds and integratieprofiel='eigen' and not microsoft_koppeling_pilot)
  then raise exception '#428 Preview-inerte beginstand faalt'; end if;
end $$;
