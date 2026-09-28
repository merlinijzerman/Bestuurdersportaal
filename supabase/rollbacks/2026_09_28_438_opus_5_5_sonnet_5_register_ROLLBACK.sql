-- Eerst de Preview-canaryrollback uitvoeren; daarna maakt dit de generieke
-- defaults en allowlistwijziging ongedaan. Faalt gesloten bij nog actieve refs.
begin;

update ai_gateway_private.taakgroep_default
   set model = case taakgroep
                 when 'generatie' then 'claude-opus-4-8'
                 when 'hulp_sterk' then 'claude-sonnet-4-6'
                 when 'concept' then 'claude-sonnet-4-5'
               end,
       reden = '#438 PR3 rollback: vorige Claude 4.x-defaults hersteld.'
 where taakgroep in ('generatie','hulp_sterk','concept')
   and model in ('claude-opus-5-5','claude-sonnet-5');

do $$
begin
  if exists (select 1 from ai_gateway_private.fonds_configuratie
              where model in ('claude-opus-5-5','claude-sonnet-5'))
  then raise exception '#438 rollback geweigerd: een fonds gebruikt nog een 5.x-model'; end if;
end $$;

delete from public.ai_model_allowlist
 where provider = 'anthropic' and model in ('claude-opus-5-5','claude-sonnet-5');

commit;
