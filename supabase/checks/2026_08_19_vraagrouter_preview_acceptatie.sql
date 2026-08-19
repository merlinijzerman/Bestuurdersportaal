-- ============================================================================
-- Vraagrouter/documentdekking — read-only Preview-acceptatiebewijs
-- Datum: 2026-08-19 · besluit 0184
--
-- Doel: na de migratie en gecontroleerde Preview-runs aantonen welke route,
-- dekking, kostenindicatoren en vervolgacties werkelijk zijn vastgelegd.
-- Deze file bevat uitsluitend SELECTs en verandert geen data.
--
-- Gebruik:
--   1. voer eerst 2026_08_17_vraagrouter_documentdekking.sql uit;
--   2. draai de structurele gates A–H;
--   3. voer minimaal vijf RQ-01-runs uit voor één synthetisch Previewfonds;
--   4. draai dit bestand in de Supabase SQL Editor en bewaar het resultaat.
-- ============================================================================

-- A. Is de cumulatieve auditprojectie aanwezig en bevat zij de nieuwe sleutels?
select
  to_regprocedure('public.meta_projectie(jsonb,boolean)') is not null as functie_aanwezig,
  public.meta_projectie(
    jsonb_build_object(
      'vraagrouter', jsonb_build_object('versie', 'vraagrouter-v2.0'),
      'vraagrouter_uitvoering', jsonb_build_object('router_ms', 1),
      'documentdekking', jsonb_build_object('modus', 'targeted'),
      'volledige_analyse', jsonb_build_object(
        'aangeboden', false,
        'uitgevoerd', false,
        'document_id', '00000000-0000-0000-0000-000000000001'
      )
    ),
    false
  ) ?& array[
    'vraagrouter',
    'vraagrouter_uitvoering',
    'documentdekking',
    'volledige_analyse'
  ] as nieuwe_sleutels_aanwezig,
  not (
    public.meta_projectie(
      jsonb_build_object(
        'volledige_analyse', jsonb_build_object(
          'aangeboden', false,
          'uitgevoerd', false,
          'document_id', '00000000-0000-0000-0000-000000000001'
        )
      ),
      false
    )->'volledige_analyse' ? 'document_id'
  ) as document_id_afgeschermd_op_basisniveau;

-- B. Effectieve fondsconfiguratie. Verwacht in Preview A uitsluitend
-- vraagrouter_v2=true; de andere twee blijven false of afwezig.
select
  f.naam as fonds,
  ff.flag_key,
  ff.waarde,
  ff.versie,
  ff.bijgewerkt
from public.fonds_feature_flags ff
join public.fondsen f on f.id = ff.fonds_id
where ff.flag_key in (
  'vraagrouter_v2',
  'volledige_analyse_vervolg',
  'vraagrouter_model'
)
order by f.naam, ff.flag_key;

-- C. Recente routerruns en hun feitelijke bewijsgrens.
select
  gl.aangemaakt,
  f.naam as fonds,
  gl.id as audit_id,
  left(gli.vraag, 140) as vraag,
  gl.retrieval_meta #>> '{vraagrouter,taak}' as taak,
  gl.retrieval_meta #>> '{vraagrouter,scope}' as scope,
  gl.retrieval_meta #>> '{vraagrouter,dekking}' as gevraagde_dekking,
  gl.retrieval_meta #>> '{vraagrouter,bewijsniveau}' as bewijsniveau,
  gl.retrieval_meta #>> '{vraagrouter,bron}' as routerbron,
  gl.retrieval_meta #>> '{documentdekking,modus}' as feitelijke_dekking,
  gl.retrieval_meta #>> '{documentdekking,verwerkte_passages}' as verwerkte_passages,
  gl.retrieval_meta #>> '{documentdekking,totaal_passages}' as totaal_passages,
  gl.retrieval_meta #>> '{documentdekking,verwerkte_batches}' as verwerkte_batches,
  gl.retrieval_meta #>> '{documentdekking,totaal_batches}' as totaal_batches,
  gl.retrieval_meta #>  '{documentdekking,afkapredenen}' as afkapredenen,
  gl.retrieval_meta #>> '{vraagrouter_uitvoering,router_ms}' as router_ms,
  gl.retrieval_meta #>> '{vraagrouter_uitvoering,modelrouter,uitkomst}' as modelrouter_uitkomst,
  gl.retrieval_meta ->> 'ttft_ms' as ttft_ms,
  gl.retrieval_meta ->> 'duur_model_ms' as duur_model_ms,
  gl.retrieval_meta #>> '{tokens,in}' as tokens_in,
  gl.retrieval_meta #>> '{tokens,out}' as tokens_out,
  gl.retrieval_meta #>> '{volledige_analyse,aangeboden}' as vervolg_aangeboden,
  gl.retrieval_meta #>> '{volledige_analyse,uitgevoerd}' as vervolg_uitgevoerd
from public.governance_log gl
join public.governance_log_inhoud gli on gli.log_id = gl.id
left join public.fondsen f on f.id = gl.fonds_id
where gl.aangemaakt >= now() - interval '48 hours'
  and gl.retrieval_meta ? 'vraagrouter'
order by gl.aangemaakt desc;

-- D. Operationele samenvatting van dezelfde periode. `duur_model_ms` is
-- modeltijd (map + eindgeneratie), niet de volledige requestdoorlooptijd.
select
  count(*) as routerruns,
  round(avg((gl.retrieval_meta #>> '{vraagrouter_uitvoering,router_ms}')::numeric), 1)
    as gem_router_ms,
  round(
    avg((gl.retrieval_meta ->> 'ttft_ms')::numeric)
      filter (where gl.retrieval_meta ? 'ttft_ms'),
    1
  ) as gem_ttft_ms,
  round(
    avg((gl.retrieval_meta ->> 'duur_model_ms')::numeric)
      filter (where gl.retrieval_meta ? 'duur_model_ms'),
    1
  ) as gem_modeltijd_ms,
  round(
    avg((gl.retrieval_meta #>> '{tokens,in}')::numeric)
      filter (where gl.retrieval_meta ? 'tokens'),
    1
  ) as gem_tokens_in,
  round(
    avg((gl.retrieval_meta #>> '{tokens,out}')::numeric)
      filter (where gl.retrieval_meta ? 'tokens'),
    1
  ) as gem_tokens_out,
  count(*) filter (
    where gl.retrieval_meta #>> '{documentdekking,modus}' = 'gedeeltelijk'
  ) as gedeeltelijke_analyses,
  count(*) filter (
    where gl.retrieval_meta #>> '{vraagrouter,bron}' = 'model'
  ) as modelrouter_routes,
  count(*) filter (
    where gl.retrieval_meta #>> '{vraagrouter_uitvoering,modelrouter,uitkomst}'
      in ('schema_terugval', 'provider_terugval')
  ) as router_terugvallen,
  count(*) filter (
    where (gl.retrieval_meta #>> '{volledige_analyse,aangeboden}')::boolean
  ) as vervolg_aangeboden,
  count(*) filter (
    where (gl.retrieval_meta #>> '{volledige_analyse,uitgevoerd}')::boolean
  ) as vervolg_uitgevoerd
from public.governance_log gl
where gl.aangemaakt >= now() - interval '48 hours'
  and gl.retrieval_meta ? 'vraagrouter';

-- E. RQ-01: verwacht na de acceptatieronde exact vijf recente rijen. De vijf
-- thema-indicatoren zijn een hulpmiddel; menselijke beoordeling van betekenis,
-- bronnen en afwezigheidsclaims blijft verplicht.
with rq01 as (
  select
    gl.aangemaakt,
    gl.id,
    gl.retrieval_meta,
    coalesce(gli.antwoord, '') as antwoord
  from public.governance_log gl
  join public.governance_log_inhoud gli on gli.log_id = gl.id
  where gl.aangemaakt >= now() - interval '48 hours'
    and lower(trim(gli.vraag)) = lower(
      'Controleer het volledige synthetische transitieplan integraal op effecten, compensatie, evenwichtigheid, opgebouwde aanspraken en uitvoerbaarheid.'
    )
  order by gl.aangemaakt desc
  limit 5
)
select
  aangemaakt,
  id as audit_id,
  retrieval_meta #>> '{vraagrouter,dekking}' as route_dekking,
  retrieval_meta #>> '{documentdekking,modus}' as feitelijke_dekking,
  retrieval_meta #>> '{documentdekking,volledig}' as volledig,
  retrieval_meta #>  '{documentdekking,afkapredenen}' as afkapredenen,
  antwoord ilike '%effect%' as thema_effecten,
  antwoord ilike '%compens%' as thema_compensatie,
  antwoord ilike '%evenwichtig%' as thema_evenwichtigheid,
  (antwoord ilike '%opgebouwd%' or antwoord ilike '%aanspraak%')
    as thema_opgebouwde_aanspraken,
  (antwoord ilike '%uitvoer%' or antwoord ilike '%planning%')
    as thema_uitvoerbaarheid,
  lower(antwoord) ~
    '(staat niet in|ontbreekt in|komt niet voor in) (het|dit|deze) (document|plan)'
    as verboden_documentbrede_afwezigheidsclaim
from rq01
order by aangemaakt;

-- F. Bewijs dat flagmutaties via het bestaande append-only auditspoor liepen.
select
  l.aangemaakt,
  f.naam as fonds,
  l.config_sleutel,
  l.oude_waarde,
  l.nieuwe_waarde,
  l.versie,
  l.gebruiker_naam
from public.fonds_config_log l
join public.fondsen f on f.id = l.fonds_id
where l.config_type = 'flag'
  and l.config_sleutel in (
    'vraagrouter_v2',
    'volledige_analyse_vervolg',
    'vraagrouter_model'
  )
  and l.aangemaakt >= now() - interval '7 days'
order by l.aangemaakt desc;
