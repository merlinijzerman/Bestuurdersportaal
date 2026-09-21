-- #428 Fase 1 — gedeelde, additieve configuratie voor de logische app365-tenant.
-- BEWUST HOST- EN OMGEVINGSVRIJ: geen domain, projectref, account, callback of
-- Microsoft-object. Environmentbindings staan uitsluitend onder seeds/<env>/.
-- ROLLBACK: ../rollbacks/2026_09_22_428_app365_demo_fonds_config_ROLLBACK.sql
begin;

insert into public.fondsen (naam, slug)
values ('Bestuurdersportaal M365 Demo', 'm365-demo')
on conflict (slug) do nothing;

do $$
begin
  if not exists (
    select 1 from public.fondsen
    where slug = 'm365-demo' and naam = 'Bestuurdersportaal M365 Demo'
  ) then
    raise exception '#428: slug m365-demo bestaat met onverwachte fondsnaam';
  end if;
end $$;

insert into public.fonds_theming (fonds_id, tokens, versie)
select id, '{"logo-letter":"D"}'::jsonb, 1
from public.fondsen where slug = 'm365-demo'
on conflict (fonds_id) do nothing;

insert into public.fonds_module_manifest (fonds_id, module_key, actief, config, versie)
select f.id, m.module_key, m.actief, '{}'::jsonb, 1
from public.fondsen f
cross join (values
  ('home', true),
  ('stuurinformatie', false),
  ('klantbeeld', false),
  ('ai', false),
  ('bibliotheek', false),
  ('vergaderingen', false),
  ('notulen', false),
  ('stemmingen', false),
  ('procedures', false),
  ('risicomatrix', false),
  ('beheer', true),
  ('governance', true),
  ('assurance', true)
) as m(module_key, actief)
where f.slug = 'm365-demo'
on conflict (fonds_id, module_key) do nothing;

insert into public.fonds_feature_flags (fonds_id, flag_key, waarde, versie)
select f.id, v.flag_key, v.waarde, 1
from public.fondsen f
cross join (values
  ('microsoft_copilot_retrieval', 'false'::jsonb),
  ('microsoft_sharepoint_retrieval_spike', 'false'::jsonb),
  ('microsoft_sharepoint_fase3', 'false'::jsonb),
  ('microsoft_outlook_fase2a', 'false'::jsonb),
  ('hybride_zoeken', 'false'::jsonb),
  ('rerank', 'false'::jsonb),
  ('relevantie_drempel', 'false'::jsonb),
  ('relevantie_drempel_waarde', '20'::jsonb),
  ('jargon_expansie', 'false'::jsonb),
  ('parent_retrieval', 'false'::jsonb),
  ('representatie_constraints', 'true'::jsonb),
  ('regime_weging', 'true'::jsonb),
  ('vraagrouter_v2', 'false'::jsonb),
  ('vraagrouter_model', 'false'::jsonb),
  ('volledige_analyse_vervolg', 'false'::jsonb),
  ('retrieval_timeout_ms', '20000'::jsonb),
  ('generatie_timeout_ms', '120000'::jsonb)
) as v(flag_key, waarde)
where f.slug = 'm365-demo'
on conflict (fonds_id, flag_key) do nothing;

do $$
declare v_fonds uuid;
begin
  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';

  if not exists (
    select 1 from public.fonds_theming
    where fonds_id = v_fonds and tokens = '{"logo-letter":"D"}'::jsonb and versie = 1
  ) then raise exception '#428: theming ontbreekt of wijkt af'; end if;

  if (select count(*) from public.fonds_module_manifest where fonds_id = v_fonds) <> 13
     or exists (
       select 1 from public.fonds_module_manifest
       where fonds_id = v_fonds and actief is distinct from
         (module_key in ('home','beheer','governance','assurance'))
     )
  then raise exception '#428: modulemanifest ontbreekt of wijkt af'; end if;

  if (select count(*) from public.fonds_feature_flags where fonds_id = v_fonds) <> 17
     or exists (
       select 1
       from (values
         ('microsoft_copilot_retrieval', 'false'::jsonb),
         ('microsoft_sharepoint_retrieval_spike', 'false'::jsonb),
         ('microsoft_sharepoint_fase3', 'false'::jsonb),
         ('microsoft_outlook_fase2a', 'false'::jsonb),
         ('hybride_zoeken', 'false'::jsonb), ('rerank', 'false'::jsonb),
         ('relevantie_drempel', 'false'::jsonb), ('relevantie_drempel_waarde', '20'::jsonb),
         ('jargon_expansie', 'false'::jsonb), ('parent_retrieval', 'false'::jsonb),
         ('representatie_constraints', 'true'::jsonb), ('regime_weging', 'true'::jsonb),
         ('vraagrouter_v2', 'false'::jsonb), ('vraagrouter_model', 'false'::jsonb),
         ('volledige_analyse_vervolg', 'false'::jsonb),
         ('retrieval_timeout_ms', '20000'::jsonb), ('generatie_timeout_ms', '120000'::jsonb)
       ) as verwacht(flag_key, waarde)
       left join public.fonds_feature_flags f
         on f.fonds_id = v_fonds and f.flag_key = verwacht.flag_key
       where f.flag_key is null or f.waarde is distinct from verwacht.waarde
     )
  then raise exception '#428: expliciete flagmatrix ontbreekt of wijkt af'; end if;

  if exists (
    select 1 from public.fonds_feature_flags
    where fonds_id = v_fonds
      and flag_key in ('microsoft_copilot_retrieval','microsoft_sharepoint_retrieval_spike',
        'microsoft_sharepoint_fase3','microsoft_outlook_fase2a','hybride_zoeken','rerank',
        'relevantie_drempel','jargon_expansie','parent_retrieval','representatie_constraints',
        'regime_weging','vraagrouter_v2','vraagrouter_model','volledige_analyse_vervolg')
      and jsonb_typeof(waarde) <> 'boolean'
  ) then raise exception '#428: booleanflag heeft niet het JSON-booleantype'; end if;

  if not exists (
    select 1 from public.fonds_microsoft_login
    where fonds_id = v_fonds and modus = 'uit' and actief = false and entra_tenant_id is null
  ) then raise exception '#428: Microsoft-login staat niet expliciet uit'; end if;

  if not exists (
    select 1 from public.fonds_integratie_profielen
    where fonds_id = v_fonds and integratieprofiel = 'eigen' and microsoft_koppeling_pilot = false
  ) then raise exception '#428: integratieprofiel is niet inert'; end if;
end $$;

commit;
