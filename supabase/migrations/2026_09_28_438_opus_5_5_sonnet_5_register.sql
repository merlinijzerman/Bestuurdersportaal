-- #438 PR3 — inert modelregister + defaults voor Opus 5.5 / Sonnet 5.
--
-- Deze generieke migratie activeert GEEN bestaand fonds. Zij maakt de modellen
-- beschikbaar voor de centrale poort en zet alleen de defaults voor NIEUWE
-- fondsen. De Preview-canary staat in de apart gegrendelde Preview-seed.
-- ROLLBACK: ../rollbacks/2026_09_28_438_opus_5_5_sonnet_5_register_ROLLBACK.sql

begin;

insert into public.ai_model_allowlist
  (provider, model, actief, venster_start, venster_eind, reden)
values
  ('anthropic', 'claude-opus-5-5', true, null, null,
   '#438 PR3: goedgekeurd voor gefaseerde activatie via de AI-gateway.'),
  ('anthropic', 'claude-sonnet-5', true, null, null,
   '#438 PR3: goedgekeurd voor gefaseerde activatie via de AI-gateway.')
on conflict (provider, model) do nothing;

do $$
begin
  if exists (
    select 1
      from ai_gateway_private.taakgroep_default
     where (taakgroep = 'generatie' and model not in ('claude-opus-4-8', 'claude-opus-5-5'))
        or (taakgroep in ('hulp_sterk','concept') and model not in
            ('claude-sonnet-4-6','claude-sonnet-4-5','claude-sonnet-5'))
  ) then
    raise exception '#438 PR3: onverwachte taakgroepdefault; handmatige beoordeling vereist';
  end if;
end $$;

update ai_gateway_private.taakgroep_default
   set model = 'claude-opus-5-5',
       reden = '#438 PR3: standaard voor nieuwe fondsen; bestaande fondsen wijzigen niet.'
 where taakgroep = 'generatie'
   and model is distinct from 'claude-opus-5-5';

update ai_gateway_private.taakgroep_default
   set model = 'claude-sonnet-5',
       reden = '#438 PR3: standaard voor nieuwe fondsen; bestaande fondsen wijzigen niet.'
 where taakgroep in ('hulp_sterk','concept')
   and model is distinct from 'claude-sonnet-5';

do $$
begin
  if (select count(*) from public.ai_model_allowlist
       where provider = 'anthropic'
         and model in ('claude-opus-5-5','claude-sonnet-5')
         and actief and venster_start is null and venster_eind is null) <> 2
  then
    raise exception '#438 PR3: nieuwe modellen ontbreken in de actieve allowlist';
  end if;

  if not exists (select 1 from ai_gateway_private.taakgroep_default
                  where taakgroep = 'generatie' and model = 'claude-opus-5-5')
     or (select count(*) from ai_gateway_private.taakgroep_default
          where taakgroep in ('hulp_sterk','concept') and model = 'claude-sonnet-5') <> 2
  then
    raise exception '#438 PR3: taakgroepdefaults hebben niet de verwachte eindstand';
  end if;
end $$;

commit;
