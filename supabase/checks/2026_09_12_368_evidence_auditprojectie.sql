-- #368 — auditprojectie bewaart uitsluitend gesloten, inhoudsvrije auditvormen.
-- ROL: authenticated — dit is de rol die beide auditprojecties in productie
-- leest; de check bewijst zowel behoud van geldige telemetrie als fail-closed
-- verwijdering van vrije inhoud onder het werkelijke leesrecht.
\set ON_ERROR_STOP on

begin;
set local role authenticated;

do $$
declare
  v_ok jsonb := '{"evidence_audit":[{"correlation_id":"corr-368","soort":"semantische_unit","gevraagd":1,"toegelaten":1,"gerenderde_tekens":100,"limiet":500,"afgekapt":false,"pii_soorten":["email"]}],"modelcontext_audit":[{"correlation_id":"corr-368","soort":"portaalstand","pii":"geen","gerenderde_tekens":80,"limiet":500,"afgekapt":false}]}'::jsonb;
  v_lek jsonb := '{"evidence_audit":[{"correlation_id":"corr-368","soort":"semantische_unit","gevraagd":1,"toegelaten":1,"gerenderde_tekens":100,"limiet":500,"afgekapt":false,"tekst":"gevoelige inhoud"}]}'::jsonb;
begin
  if public.meta_basisniveau(v_ok)->'evidence_audit' <> v_ok->'evidence_audit'
     or public.meta_bronniveau(v_ok)->'modelcontext_audit' <> v_ok->'modelcontext_audit' then
    raise exception '#368: geldige audit ontbreekt';
  end if;
  if public.meta_basisniveau(v_lek) ? 'evidence_audit'
     or public.meta_bronniveau(v_lek) ? 'evidence_audit' then
    raise exception '#368: vrije inhoud lekt door evidence_audit';
  end if;
  if public.meta_basisniveau('{"modelcontext_audit":[{"correlation_id":"c","soort":"portaalstand","pii":"geen","gerenderde_tekens":1,"limiet":1,"afgekapt":false,"detail":"lek"}]}'::jsonb) ? 'modelcontext_audit' then
    raise exception '#368: onbekend modelcontextveld lekt door de projectie';
  end if;
  if public.meta_basisniveau('{"evidence_audit":[{"correlation_id":"c","soort":"semantische_unit","gevraagd":1,"toegelaten":1,"gerenderde_tekens":1,"limiet":1,"afgekapt":false,"pii_soorten":["geheime tekst"]}]}'::jsonb) ? 'evidence_audit'
     or public.meta_basisniveau('{"modelcontext_audit":[{"correlation_id":"c","soort":"geheime tekst","pii":"geen","gerenderde_tekens":1,"limiet":1,"afgekapt":false}]}'::jsonb) ? 'modelcontext_audit' then
    raise exception '#368: vrije auditwaarde passeert enum';
  end if;
end;
$$;

rollback;
