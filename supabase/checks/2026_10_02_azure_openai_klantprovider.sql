-- Azure OpenAI-klantprovider: gesloten providercontract, standaard dicht,
-- fonds-eigendom en minimale gatewayrol. Zelf-seedend en terugdraaiend.
-- ROL: postgres voor catalogus, seed en afbraak; profielresolutie wordt met
-- `set local role ai_gateway` onder de werkelijke minimale gatewayrol gemeten.

begin;

-- Lokale/CI-fixture: postgres is bewust geen lid van de minimale NOINHERIT-rol.
-- Het tijdelijke lidmaatschap valt aan het einde met de transactie terug.
grant ai_gateway to postgres;

do $$
declare
  v_def text;
  v jsonb;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.ai_model_allowlist'::regclass
     and conname = 'ai_model_allowlist_provider_check';
  if v_def not like '%azure_openai%' then
    raise exception 'FAALT Azure OpenAI: provider ontbreekt in modelallowlistcontract';
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'ai_gateway_private.provider_profiel'::regclass
     and conname = 'provider_profiel_provider_check';
  if v_def not like '%azure_openai%' then
    raise exception 'FAALT Azure OpenAI: provider ontbreekt in profielcontract';
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'ai_gateway_private.provider_profiel'::regclass
     and conname = 'provider_profiel_azure_fondsgebonden_check';
  if v_def not like '%eigenaar_fonds_id IS NOT NULL%'
     or v_def not like '%AZURE_OPENAI_API_KEY%'
     or v_def not like '%AZURE_OPENAI_BASE_URL%' then
    raise exception 'FAALT Azure OpenAI: fonds- en secretreferentiegrens ontbreekt';
  end if;

  if (select status from public.ai_kill_switch where sleutel = 'azure_openai') is distinct from 'gestopt' then
    raise exception 'FAALT Azure OpenAI: nieuwe provider staat niet standaard gestopt';
  end if;

  set local role ai_gateway;
  v := ai_gateway_private.lees_platform_profiel('azure_openai');
  if v->>'reden' <> 'provider_onbekend' then
    raise exception 'FAALT Azure OpenAI: klantprovider werd platformbreed bereikbaar: %', v;
  end if;
  reset role;
end;
$$;

do $$
begin
  begin
    insert into ai_gateway_private.provider_profiel
      (id, eigenaar_fonds_id, provider, secret_ref, endpoint_ref, reden)
    values
      ('xgw-azure-platform', null, 'azure_openai',
       'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_BASE_URL', 'Moet door fondsgrens worden geweigerd');
    raise exception 'FAALT Azure OpenAI: platformprofiel werd geaccepteerd';
  exception
    when check_violation then null;
  end;
end;
$$;

select public.fn_ai_allowlist_wijzigen(
  'azure_openai',
  'klant-gpt-testdeployment',
  true,
  null,
  null,
  'Hermetische contracttest Azure OpenAI',
  null
);

insert into public.fondsen (id, naam, slug)
values ('a4444444-4444-4444-4444-4444444444a4', 'Azure OpenAI contractfonds', 'xgw-azure-openai');

do $$
begin
  begin
    insert into ai_gateway_private.provider_profiel
      (id, eigenaar_fonds_id, provider, secret_ref, endpoint_ref, reden)
    values
      ('xgw-azure-verkeerd', 'a4444444-4444-4444-4444-4444444444a4', 'azure_openai',
       'OPENAI_API_KEY', 'AZURE_OPENAI_BASE_URL', 'Moet door referentiegrens worden geweigerd');
    raise exception 'FAALT Azure OpenAI: verkeerde secretreferentie werd geaccepteerd';
  exception
    when check_violation then null;
  end;
end;
$$;

insert into ai_gateway_private.provider_profiel
  (id, eigenaar_fonds_id, provider, secret_ref, endpoint_ref, reden)
values
  ('xgw-azure-klant', 'a4444444-4444-4444-4444-4444444444a4', 'azure_openai',
   'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_BASE_URL', 'Hermetische contracttest klantprofiel');

update ai_gateway_private.fonds_configuratie
   set profiel_id = 'xgw-azure-klant',
       provider = 'azure_openai',
       model = 'klant-gpt-testdeployment',
       reden = 'Hermetische contracttest fondsconfiguratie'
 where fonds_id = 'a4444444-4444-4444-4444-4444444444a4'
   and taakgroep = 'generatie';

do $$
declare
  v jsonb;
begin
  set local role ai_gateway;
  v := ai_gateway_private.lees_config('a4444444-4444-4444-4444-4444444444a4', 'generatie');
  if (v->>'ok')::boolean is not true
     or v->>'provider' <> 'azure_openai'
     or v->>'profiel_id' <> 'xgw-azure-klant'
     or v->>'secret_ref' <> 'AZURE_OPENAI_API_KEY'
     or v->>'endpoint_ref' <> 'AZURE_OPENAI_BASE_URL' then
    raise exception 'FAALT Azure OpenAI: fondsprofiel resolveert niet correct: %', v;
  end if;
  reset role;

  v := public.fn_ai_poort_check('azure_openai', 'klant-gpt-testdeployment');
  if v->>'reden' <> 'provider_gestopt' then
    raise exception 'FAALT Azure OpenAI: standaard-dichte poort gaf onverwachte uitkomst: %', v;
  end if;
end;
$$;

rollback;

\echo '== Azure OpenAI-klantprovider contract groen =='
