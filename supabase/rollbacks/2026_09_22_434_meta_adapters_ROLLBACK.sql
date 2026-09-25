-- ============================================================================
--  #434 T4-F — ROLLBACK van de adaptersprojectie.
-- ----------------------------------------------------------------------------
--  Zet beide wrappers terug op hun #368-vorm en verwijdert de vormcontrole.
--  De uitgebrachte `meta_projectie()` is ook bij deze rollback ONGEMOEID; zij
--  is byte-gepind en wordt door T4-F niet aangeraakt.
--
--  Volgorde is niet vrij: eerst de wrappers terugzetten, DAARNA pas de helper
--  droppen. Andersom verwijst een levende wrapper even naar een functie die er
--  niet meer is.
-- ============================================================================

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

drop function if exists public.meta_adapters_projectie(jsonb);

do $$
begin
  if public.meta_basisniveau('{"methode":"geen","adapters":[]}'::jsonb) ? 'adapters' then
    raise exception 'T4-F rollback: adapters zit nog in de projectie';
  end if;
  if public.meta_basisniveau('{"methode":"hybride_rrf"}'::jsonb) ->> 'methode' is distinct from 'hybride_rrf' then
    raise exception 'T4-F rollback: een bestaande basissleutel is verdwenen';
  end if;
end $$;
