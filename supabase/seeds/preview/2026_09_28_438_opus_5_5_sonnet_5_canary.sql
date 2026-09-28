-- #438 PR3 — PREVIEW ONLY: activeer Opus 5.5 / Sonnet 5 voor m365-demo.
-- De omgevingsfingerprint staat vóór iedere mutatie en weigert Production.
-- ROLLBACK: ../../rollbacks/2026_09_28_438_opus_5_5_sonnet_5_canary_ROLLBACK.sql

begin;

do $$
declare
  v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then
    raise exception '#438 PR3 verkeerde doelomgeving: uitsluitend portal_preview';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'ai_gateway_private'
                    and table_name = 'gateway_log' and column_name = 'tokens_thinking')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'ai_gateway_private'
                       and table_name = 'gateway_log' and column_name = 'effort')
  then
    raise exception '#438 PR3: observabilitymigraties PR1/PR2 ontbreken';
  end if;

  select id into strict v_fonds
    from public.fondsen
   where slug = 'm365-demo' and naam = 'Bestuurdersportaal M365 Demo';

  if (select count(*) from ai_gateway_private.fonds_configuratie
       where fonds_id = v_fonds and taakgroep in ('generatie','hulp_sterk','concept')) <> 3
     or exists (
       select 1 from ai_gateway_private.fonds_configuratie
        where fonds_id = v_fonds
          and ((taakgroep = 'generatie' and model not in ('claude-opus-4-8','claude-opus-5-5'))
            or (taakgroep = 'hulp_sterk' and model not in ('claude-sonnet-4-6','claude-sonnet-5'))
            or (taakgroep = 'concept' and model not in ('claude-sonnet-4-5','claude-sonnet-5')))
     )
  then
    raise exception '#438 PR3: onverwachte m365-demo-configuratie; canary niet gewijzigd';
  end if;

  update ai_gateway_private.fonds_configuratie
     set model = case taakgroep
                   when 'generatie' then 'claude-opus-5-5'
                   else 'claude-sonnet-5'
                 end,
         bijgewerkt_door = null,
         reden = '#438 PR3 Preview-canary m365-demo; rollback naar Claude 4.x beschikbaar.'
   where fonds_id = v_fonds
     and taakgroep in ('generatie','hulp_sterk','concept')
     and model is distinct from case taakgroep
                                  when 'generatie' then 'claude-opus-5-5'
                                  else 'claude-sonnet-5'
                                end;

  if not exists (select 1 from ai_gateway_private.fonds_configuratie
                  where fonds_id = v_fonds and taakgroep = 'generatie'
                    and model = 'claude-opus-5-5' and actief)
     or (select count(*) from ai_gateway_private.fonds_configuratie
          where fonds_id = v_fonds and taakgroep in ('hulp_sterk','concept')
            and model = 'claude-sonnet-5' and actief) <> 2
     or not exists (select 1 from ai_gateway_private.fonds_configuratie
                     where fonds_id = v_fonds and taakgroep = 'hulp_snel'
                       and model = 'claude-haiku-4-5-20251001' and actief)
  then
    raise exception '#438 PR3: Preview-canary heeft niet de verwachte eindstand';
  end if;
end $$;

commit;
