-- #524 — PREVIEW ONLY, handmatig na deploy, Secret-configuratie en modeltoegang.
-- Schakelt uitsluitend het m365-demo-fonds naar het bestaande platform-openai-profiel.
-- De openai-killswitch blijft onaangeroerd: activeren vereist twee verschillende
-- platformidentiteiten via de bestaande vier-ogenprocedure.
-- Rollback: ../../rollbacks/2026_10_05_openai_eigen_key_pilot_ROLLBACK.sql

begin;

do $$
declare
  v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app365.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then
    raise exception '#524: verkeerde doelomgeving; uitsluitend portal_preview';
  end if;

  select id into strict v_fonds
    from public.fondsen
   where slug = 'm365-demo' and naam = 'Bestuurdersportaal M365 Demo';

  if not exists (select 1 from ai_gateway_private.provider_profiel
                  where id = 'platform-openai' and provider = 'openai'
                    and eigenaar_fonds_id is null and actief
                    and secret_ref = 'OPENAI_API_KEY'
                    and endpoint_ref = 'OPENAI_BASE_URL')
  then
    raise exception '#524: verwacht platform-openai-profiel ontbreekt';
  end if;

  if (select count(*) from ai_gateway_private.fonds_configuratie
       where fonds_id = v_fonds and actief) <> 4
     or exists (
       select 1 from ai_gateway_private.fonds_configuratie
        where fonds_id = v_fonds
          and (provider <> 'anthropic' or profiel_id <> 'platform-anthropic'
            or (taakgroep = 'generatie' and model <> 'claude-opus-5-5')
            or (taakgroep in ('hulp_sterk','concept') and model <> 'claude-sonnet-5')
            or (taakgroep = 'hulp_snel' and model <> 'claude-haiku-4-5-20251001'))
     )
  then
    raise exception '#524: m365-demo wijkt af van de verwachte uitgangsconfiguratie';
  end if;

  perform public.fn_ai_allowlist_wijzigen(
    'openai', 'gpt-6-luna', true, null, null,
    '#524 Preview-pilot met eigen OpenAI-key; alleen m365-demo.', null
  );

  update ai_gateway_private.fonds_configuratie
     set profiel_id = 'platform-openai', provider = 'openai', model = 'gpt-6-luna',
         bijgewerkt_door = null,
         reden = '#524 Preview-pilot met eigen OpenAI-key; rollback naar Claude beschikbaar.'
   where fonds_id = v_fonds;

  if (select count(*) from ai_gateway_private.fonds_configuratie
       where fonds_id = v_fonds and actief and profiel_id = 'platform-openai'
         and provider = 'openai' and model = 'gpt-6-luna') <> 4
  then
    raise exception '#524: onvolledige OpenAI-pilotconfiguratie';
  end if;
end $$;

commit;
