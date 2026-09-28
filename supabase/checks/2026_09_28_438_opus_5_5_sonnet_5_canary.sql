-- #438 PR3 — READ-ONLY postcheck voor de Preview-canary.
do $$
declare
  v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then raise exception '#438 PR3 verkeerde doelomgeving'; end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';

  if (select count(*) from public.ai_model_allowlist
       where provider = 'anthropic'
         and model in ('claude-opus-5-5','claude-sonnet-5') and actief) <> 2
  then raise exception '#438 PR3 nieuwe modellen niet actief toegestaan'; end if;

  if not exists (select 1 from ai_gateway_private.fonds_configuratie
                  where fonds_id = v_fonds and taakgroep = 'generatie'
                    and model = 'claude-opus-5-5' and actief)
     or (select count(*) from ai_gateway_private.fonds_configuratie
          where fonds_id = v_fonds and taakgroep in ('hulp_sterk','concept')
            and model = 'claude-sonnet-5' and actief) <> 2
     or not exists (select 1 from ai_gateway_private.fonds_configuratie
                     where fonds_id = v_fonds and taakgroep = 'hulp_snel'
                       and model = 'claude-haiku-4-5-20251001' and actief)
  then raise exception '#438 PR3 canaryconfiguratie wijkt af'; end if;

  if exists (select 1 from public.fondsen f
              join ai_gateway_private.fonds_configuratie c on c.fonds_id = f.id
             where f.slug <> 'm365-demo'
               and c.model in ('claude-opus-5-5','claude-sonnet-5'))
  then raise exception '#438 PR3 nieuw model is buiten m365-demo geactiveerd'; end if;
end $$;
