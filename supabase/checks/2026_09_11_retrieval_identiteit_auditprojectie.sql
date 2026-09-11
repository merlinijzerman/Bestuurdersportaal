-- #367 — additieve correlation-projectie na alle forward-migraties.
-- Read-only gedragstoets; draait als de werkelijke auditreader. Dit is bewust
-- GEEN rollback→forward-replay: daarvoor is een aparte wegwerp-DB-run nodig.
-- ROL: authenticated — dit is de rol die execute op beide auditprojecties
-- krijgt; zo toetst de check naast de JSON-vorm ook het werkelijke leesbereik.
\set ON_ERROR_STOP on

begin;
set local role authenticated;

do $$
declare
  v_meta jsonb := jsonb_build_object(
    'correlation_id', 'corr-367',
    'methode', 'fts_dutch_ranked',
    'bronversie_audit', jsonb_build_array(jsonb_build_object(
      'document_identiteit', 'doc_v1_' || repeat('a', 64),
      'passage_identiteit', 'passage_v1_' || repeat('b', 64),
      'citation_id', 'citation_v1_' || repeat('c', 64),
      'versie', jsonb_build_object('soort', 'hash', 'waarde', 'version_v1_' || repeat('d', 64))
    )),
    'zoekvraag', 'Naam Persoon',
    'sources', jsonb_build_array(jsonb_build_object('fragment', 'Naam Persoon'))
  );
  v_basis jsonb := public.meta_basisniveau(v_meta);
  v_bron jsonb := public.meta_bronniveau(v_meta);
begin
  if v_basis->>'correlation_id' <> 'corr-367'
     or v_bron->>'correlation_id' <> 'corr-367' then
    raise exception '#367: correlation_id ontbreekt of wijzigde';
  end if;
  if v_basis ? 'bronversie_audit' then
    raise exception '#367: bronidentiteit lekt naar basisniveau';
  end if;
  if not (v_bron ? 'bronversie_audit') then
    raise exception '#367: bron-/versie-identiteit ontbreekt op bronniveau';
  end if;
  if v_basis ? 'zoekvraag' or v_bron ? 'zoekvraag'
     or v_basis ? 'sources' or v_bron ? 'sources' then
    raise exception '#367: inhoud lekt naar operationeel auditniveau';
  end if;
  if public.meta_basisniveau('{}'::jsonb) ? 'correlation_id'
     or public.meta_basisniveau('{"correlation_id":""}'::jsonb) ? 'correlation_id'
     or public.meta_basisniveau('{"correlation_id":42}'::jsonb) ? 'correlation_id' then
    raise exception '#367: ontbrekende, lege of niet-string correlation_id wordt geprojecteerd';
  end if;
end;
$$;

rollback;
