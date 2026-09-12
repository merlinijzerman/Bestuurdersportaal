-- #368 — inhoudsvrije evidence-/modelcontextaudit in de bestaande leesprojectie.
--
-- De uitgebrachte meta_projectie-migraties blijven bytegelijk. Deze forward
-- migratie bouwt cumulatief voort op de #367-wrappers en laat uitsluitend
-- arrays van gesloten auditobjecten door. Vrije tekst of onbekende velden
-- blijven daardoor ook voor historische/handmatig geschreven rijen gesloten.

create or replace function public.meta_basisniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_projectie(p_meta, false)
    || case
         when jsonb_typeof(p_meta) = 'object'
          and jsonb_typeof(p_meta->'correlation_id') = 'string'
          and length(p_meta->>'correlation_id') > 0
         then jsonb_build_object('correlation_id', p_meta->'correlation_id')
         else '{}'::jsonb
       end
    || case
         when jsonb_typeof(p_meta->'contextbron_resolutie') = 'object'
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'volledig') = 'boolean'
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'reden') = 'string'
          and p_meta->'contextbron_resolutie'->>'reden' in (
            'opgelost','kandidaatcap','ontbrekende_ref','ontbrekende_binding',
            'private_scope_ontbreekt','providerfout'
          )
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'kandidaatcap') = 'number'
          and p_meta->'contextbron_resolutie'->'kandidaatcap' = '2000'::jsonb
          and ((p_meta->'contextbron_resolutie') - 'volledig'::text - 'reden'::text - 'kandidaatcap'::text) = '{}'::jsonb
         then jsonb_build_object('contextbron_resolutie', p_meta->'contextbron_resolutie')
         else '{}'::jsonb
       end
    || case
         when jsonb_typeof(p_meta->'evidence_audit') = 'array'
          and not exists (
            select 1 from jsonb_array_elements(p_meta->'evidence_audit') e
             where jsonb_typeof(e) <> 'object'
                or (e - array['correlation_id','soort','gevraagd','toegelaten','gerenderde_tekens','limiet','afgekapt','geneutraliseerd','pii_gedetecteerd','pii_soorten','versies','fout']) <> '{}'::jsonb
                or jsonb_typeof(e->'correlation_id') is distinct from 'string'
                or length(e->>'correlation_id') not between 1 and 128
                or jsonb_typeof(e->'soort') is distinct from 'string'
                or e->>'soort' not in ('besluitregistratie','semantische_unit','chunk_presentie')
                or jsonb_typeof(e->'gevraagd') is distinct from 'number'
                or jsonb_typeof(e->'toegelaten') is distinct from 'number'
                or jsonb_typeof(e->'gerenderde_tekens') is distinct from 'number'
                or jsonb_typeof(e->'limiet') is distinct from 'number'
                or jsonb_typeof(e->'afgekapt') is distinct from 'boolean'
                or (e ? 'geneutraliseerd' and jsonb_typeof(e->'geneutraliseerd') is distinct from 'number')
                or (e ? 'pii_gedetecteerd' and jsonb_typeof(e->'pii_gedetecteerd') is distinct from 'boolean')
                or (e ? 'pii_soorten' and jsonb_typeof(e->'pii_soorten') is distinct from 'array')
                or (e ? 'pii_soorten' and exists (
                  select 1 from jsonb_array_elements(e->'pii_soorten') p
                   where jsonb_typeof(p) is distinct from 'string'
                      or p #>> '{}' not in ('bsn','email','iban','telefoon','persoonsaanduiding','fondsnaam')
                ))
                or (e ? 'versies' and (
                  jsonb_typeof(e->'versies') is distinct from 'object'
                  or ((e->'versies') - array['sterk','gedegradeerd']) <> '{}'::jsonb
                  or jsonb_typeof(e->'versies'->'sterk') is distinct from 'number'
                  or jsonb_typeof(e->'versies'->'gedegradeerd') is distinct from 'number'
                ))
                or (e ? 'fout' and (
                  jsonb_typeof(e->'fout') is distinct from 'string'
                  or e->>'fout' not in ('buiten_scope','providerfout','onvolledig','afgekapt')
                ))
          )
         then jsonb_build_object('evidence_audit', p_meta->'evidence_audit')
         else '{}'::jsonb
       end
    || case
         when jsonb_typeof(p_meta->'modelcontext_audit') = 'array'
          and not exists (
            select 1 from jsonb_array_elements(p_meta->'modelcontext_audit') e
             where jsonb_typeof(e) <> 'object'
                or (e - array['correlation_id','soort','pii','gerenderde_tekens','limiet','afgekapt','geneutraliseerd','pii_soorten','fout']) <> '{}'::jsonb
                or jsonb_typeof(e->'correlation_id') is distinct from 'string'
                or length(e->>'correlation_id') not between 1 and 128
                or jsonb_typeof(e->'soort') is distinct from 'string'
                or e->>'soort' not in (
                  'profielsturing','organisatieprofiel','regimekader','agendapunt',
                  'fondsmodules','portaalstand','module_scope','module_scope_risico',
                  'module_scope_risicomatrix','module_scope_proces','samengestelde_modelcontext'
                )
                or e->>'pii' not in ('geen','persoonsgebonden','bijzonder')
                or jsonb_typeof(e->'pii') is distinct from 'string'
                or jsonb_typeof(e->'gerenderde_tekens') is distinct from 'number'
                or jsonb_typeof(e->'limiet') is distinct from 'number'
                or jsonb_typeof(e->'afgekapt') is distinct from 'boolean'
                or (e ? 'geneutraliseerd' and jsonb_typeof(e->'geneutraliseerd') is distinct from 'number')
                or (e ? 'pii_soorten' and jsonb_typeof(e->'pii_soorten') is distinct from 'array')
                or (e ? 'pii_soorten' and exists (
                  select 1 from jsonb_array_elements(e->'pii_soorten') p
                   where jsonb_typeof(p) is distinct from 'string'
                      or p #>> '{}' not in ('bsn','email','iban','telefoon','persoonsaanduiding','fondsnaam')
                ))
                or (e ? 'fout' and (
                  jsonb_typeof(e->'fout') is distinct from 'string'
                  or e->>'fout' not in ('buiten_scope','providerfout','afgekapt')
                ))
          )
         then jsonb_build_object('modelcontext_audit', p_meta->'modelcontext_audit')
         else '{}'::jsonb
       end;
$$;

create or replace function public.meta_bronniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_basisniveau(p_meta)
    || public.meta_projectie(p_meta, true);
$$;

revoke all on function public.meta_basisniveau(jsonb) from public, anon;
revoke all on function public.meta_bronniveau(jsonb) from public, anon;
grant execute on function public.meta_basisniveau(jsonb) to authenticated;
grant execute on function public.meta_bronniveau(jsonb) to authenticated;

do $$
declare
  v_meta jsonb := '{"evidence_audit":[{"correlation_id":"corr-368","soort":"semantische_unit","gevraagd":2,"toegelaten":1,"gerenderde_tekens":120,"limiet":500,"afgekapt":false}],"modelcontext_audit":[{"correlation_id":"corr-368","soort":"portaalstand","pii":"geen","gerenderde_tekens":80,"limiet":500,"afgekapt":false}]}'::jsonb;
begin
  if public.meta_basisniveau(v_meta)->'evidence_audit' <> v_meta->'evidence_audit'
     or public.meta_basisniveau(v_meta)->'modelcontext_audit' <> v_meta->'modelcontext_audit'
     or public.meta_bronniveau(v_meta)->'evidence_audit' <> v_meta->'evidence_audit'
     or public.meta_bronniveau(v_meta)->'modelcontext_audit' <> v_meta->'modelcontext_audit' then
    raise exception '#368: inhoudsvrije audit verdwijnt uit de projectie';
  end if;
  if public.meta_basisniveau('{"evidence_audit":[{"correlation_id":"c","soort":"x","gevraagd":1,"toegelaten":1,"gerenderde_tekens":1,"limiet":1,"afgekapt":false,"tekst":"lek"}]}'::jsonb) ? 'evidence_audit' then
    raise exception '#368: onbekend evidenceveld lekt door de projectie';
  end if;
  if public.meta_basisniveau('{"evidence_audit":[{"soort":"semantische_unit","gevraagd":1,"toegelaten":1,"gerenderde_tekens":1,"limiet":1,"afgekapt":false}]}'::jsonb) ? 'evidence_audit' then
    raise exception '#368: onvolledig evidenceobject passeert de projectie';
  end if;
  if public.meta_basisniveau('{"evidence_audit":[{"correlation_id":"c","soort":"semantische_unit","gevraagd":1,"toegelaten":1,"gerenderde_tekens":1,"limiet":1,"afgekapt":false,"pii_soorten":["vrije-inhoud"]}]}'::jsonb) ? 'evidence_audit'
     or public.meta_basisniveau('{"modelcontext_audit":[{"correlation_id":"c","soort":"vrije-inhoud","pii":"geen","gerenderde_tekens":1,"limiet":1,"afgekapt":false}]}'::jsonb) ? 'modelcontext_audit' then
    raise exception '#368: vrije auditwaarde passeert de gesloten enum';
  end if;
end;
$$;
