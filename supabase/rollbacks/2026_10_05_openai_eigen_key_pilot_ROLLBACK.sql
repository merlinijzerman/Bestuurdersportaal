-- #524 — PREVIEW ONLY: zet uitsluitend m365-demo terug naar de vorige Claude-configuratie.
-- Laat allowlist en auditspoor intact; de vier-ogen-killswitch is een apart besluit.

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
    raise exception '#524 rollback: verkeerde doelomgeving; uitsluitend portal_preview';
  end if;

  select id into strict v_fonds
    from public.fondsen
   where slug = 'm365-demo' and naam = 'Bestuurdersportaal M365 Demo';

  if (select count(*) from ai_gateway_private.fonds_configuratie
       where fonds_id = v_fonds and actief and profiel_id = 'platform-openai'
         and provider = 'openai' and model = 'gpt-6-luna') <> 4
  then
    raise exception '#524 rollback: pilotconfiguratie wijkt af; niets gewijzigd';
  end if;

  update ai_gateway_private.fonds_configuratie
     set profiel_id = 'platform-anthropic', provider = 'anthropic',
         model = case taakgroep
                   when 'generatie' then 'claude-opus-5-5'
                   when 'hulp_snel' then 'claude-haiku-4-5-20251001'
                   else 'claude-sonnet-5'
                 end,
         bijgewerkt_door = null,
         reden = '#524 Preview-pilot teruggedraaid; Claude-configuratie hersteld.'
   where fonds_id = v_fonds;
end $$;

commit;
