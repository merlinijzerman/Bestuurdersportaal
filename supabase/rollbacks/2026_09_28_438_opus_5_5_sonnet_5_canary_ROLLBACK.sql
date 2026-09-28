-- #438 PR3 — PREVIEW ONLY rollback van uitsluitend m365-demo.
begin;
do $$
declare v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then raise exception '#438 rollback verkeerde doelomgeving'; end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';

  update ai_gateway_private.fonds_configuratie
     set model = case taakgroep
                   when 'generatie' then 'claude-opus-4-8'
                   when 'hulp_sterk' then 'claude-sonnet-4-6'
                   when 'concept' then 'claude-sonnet-4-5'
                 end,
         bijgewerkt_door = null,
         reden = '#438 PR3 rollback Preview-canary: Claude 4.x hersteld.'
   where fonds_id = v_fonds
     and taakgroep in ('generatie','hulp_sterk','concept')
     and model in ('claude-opus-5-5','claude-sonnet-5');
end $$;
commit;
