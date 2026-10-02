-- ============================================================================
--  Klant-eigen Azure OpenAI als afzonderlijke AI-gatewayprovider
-- ----------------------------------------------------------------------------
--  Alleen het contract wordt geopend. Er wordt GEEN klantprofiel, endpoint,
--  secret of model geactiveerd. De nieuwe kill switch staat standaard dicht;
--  activering vereist later een expliciete allowlistregel, fonds-eigen profiel,
--  vier taakgroepconfiguraties en de bestaande vier-ogenprocedure.
-- ============================================================================

begin;

alter table public.ai_model_allowlist
  drop constraint if exists ai_model_allowlist_provider_check;
alter table public.ai_model_allowlist
  add constraint ai_model_allowlist_provider_check
  check (provider in ('anthropic','mistral','openai','azure_openai'));

alter table public.ai_kill_switch
  drop constraint if exists ai_kill_switch_sleutel_check;
alter table public.ai_kill_switch
  add constraint ai_kill_switch_sleutel_check
  check (sleutel in ('globaal','anthropic','mistral','openai','azure_openai'));

alter table ai_gateway_private.provider_profiel
  drop constraint if exists provider_profiel_provider_check;
alter table ai_gateway_private.provider_profiel
  add constraint provider_profiel_provider_check
  check (provider in ('anthropic','openai','mistral','azure_openai'));
alter table ai_gateway_private.provider_profiel
  drop constraint if exists provider_profiel_azure_fondsgebonden_check;
alter table ai_gateway_private.provider_profiel
  add constraint provider_profiel_azure_fondsgebonden_check
  check (
    provider <> 'azure_openai'
    or (
      eigenaar_fonds_id is not null
      and secret_ref = 'AZURE_OPENAI_API_KEY'
      and endpoint_ref = 'AZURE_OPENAI_BASE_URL'
    )
  );

alter table ai_gateway_private.gateway_log
  drop constraint if exists gateway_log_provider_check;
alter table ai_gateway_private.gateway_log
  add constraint gateway_log_provider_check
  check (provider in ('anthropic','openai','mistral','azure_openai'));

insert into public.ai_kill_switch (sleutel, status, reden)
values (
  'azure_openai',
  'gestopt',
  'Klant-eigen Azure OpenAI blijft dicht tot endpoint, deployment, smoke en vier-ogenactivatie zijn goedgekeurd.'
)
on conflict (sleutel) do nothing;

create or replace function public.fn_ai_allowlist_wijzigen(
  p_provider      text,
  p_model         text,
  p_actief        boolean,
  p_venster_start timestamptz default null,
  p_venster_eind  timestamptz default null,
  p_reden         text default null,
  p_actor         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_versie bigint;
begin
  if p_provider not in ('anthropic','mistral','openai','azure_openai') then
    raise exception 'onbekende provider %', p_provider using errcode = '22023';
  end if;
  if p_model is null or length(btrim(p_model)) = 0 then
    raise exception 'model ontbreekt' using errcode = '22023';
  end if;
  if (p_venster_start is null) <> (p_venster_eind is null) then
    raise exception 'een tijdelijk venster vereist zowel een begin- als een eindtijd'
      using errcode = '22023';
  end if;
  if p_venster_start is not null and p_venster_eind <= p_venster_start then
    raise exception 'de eindtijd van het venster moet na de begintijd liggen' using errcode = '22023';
  end if;
  if p_venster_start is not null and length(btrim(coalesce(p_reden,''))) < 10 then
    raise exception 'een tijdelijk venster vereist een reden van minimaal 10 tekens'
      using errcode = '22023';
  end if;

  insert into public.ai_model_allowlist
    (provider, model, actief, venster_start, venster_eind, reden, bijgewerkt, bijgewerkt_door)
  values (p_provider, p_model, p_actief, p_venster_start, p_venster_eind, p_reden, now(), p_actor)
  on conflict (provider, model) do update
    set actief = excluded.actief,
        venster_start = excluded.venster_start,
        venster_eind = excluded.venster_eind,
        reden = excluded.reden,
        bijgewerkt = now(),
        bijgewerkt_door = excluded.bijgewerkt_door;

  v_versie := public.fn_ai_bump_config_versie();
  return jsonb_build_object('provider',p_provider,'model',p_model,'actief',p_actief,
    'config_versie',v_versie);
end;
$$;

comment on constraint ai_model_allowlist_provider_check on public.ai_model_allowlist is
  'Gesloten providercontract; azure_openai is de klant-eigen Azure OpenAI-baan en geen alias van platform-openai.';
comment on constraint provider_profiel_provider_check on ai_gateway_private.provider_profiel is
  'Klant-eigen Azure OpenAI-profielen zijn fondsgebonden; activering blijft via fonds_configuratie en de AI-poort lopen.';
comment on constraint provider_profiel_azure_fondsgebonden_check on ai_gateway_private.provider_profiel is
  'Azure OpenAI is uitsluitend fonds-eigen en gebruikt alleen de vaste klantsecret- en endpointreferentie.';

commit;
