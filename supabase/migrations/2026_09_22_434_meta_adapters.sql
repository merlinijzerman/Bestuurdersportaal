-- ============================================================================
-- #434 T4-F — `adapters` in de leesprojectie, met een HARD FALENDE vormcontrole
-- ----------------------------------------------------------------------------
-- Bouwt cumulatief voort op de #367/#368-wrappers. De uitgebrachte
-- `meta_projectie()` blijft bytegelijk en wordt hier NIET aangeraakt; zij is
-- op sha256 vastgelegd en de conventie is dat uitbreidingen via de wrappers
-- lopen.
--
-- WAAROM DEZE SLEUTEL HARD FAALT EN DE VORIGE NIET.
-- `evidence_audit` en `contextbron_resolutie` vallen bij een ongeldige vorm
-- stil weg (`else '{}'`). Voor `adapters` mag dat niet: die sleutel draagt na
-- T4-F de zichtbare bronstatus. Stil weglaten zou een antwoord volledig ogend
-- maken terwijl juist de informatie over een NIET-GERAADPLEEGDE bron is
-- verdwenen — precies de stille degradatie die T4-E moest uitsluiten. Een
-- ongeldige vorm werpt daarom, met een vaste, inhoudsvrije melding.
--
-- DE MELDING BEVAT NOOIT DE AFGEWEZEN WAARDE. Een validator die logt wát hij
-- weigerde, lekt precies wat hij moest tegenhouden.
--
-- Historische rijen kunnen deze sleutel niet dragen — hij bestaat pas vanaf
-- T4-F — dus geen bestaande rij kan door deze controle onleesbaar worden.
-- ============================================================================

-- ── De vormcontrole. Afwezig = niets toevoegen; aanwezig = geldig of werpen ──
create or replace function public.meta_adapters_projectie(p_meta jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  v_adapters jsonb := p_meta -> 'adapters';
begin
  -- Sleutel afwezig is geen fout: niet elke beurt kent meer dan één adapter.
  if v_adapters is null then
    return '{}'::jsonb;
  end if;

  -- Rijgrens 8 = ADAPTERMETA_MAX_RIJEN in TypeScript. Beide lagen hanteren
  -- hem, zodat een te lange array al in de applicatie faalt met de eigen
  -- inhoudsvrije foutcategorie in plaats van hier met een databasefout.
  if jsonb_typeof(v_adapters) <> 'array' or jsonb_array_length(v_adapters) > 8 then
    raise exception 'adaptermetadata_ongeldig' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_adapters) e
     where jsonb_typeof(e) <> 'object'
        -- PLAT en EXACT: geen ontbrekend veld, geen extra veld, geen nesting.
        -- Een extra veld is de weg waarlangs een identifier hier zou binnenkomen.
        or (e - array['naam','methode','resultaat','netwerkpogingen','latency_ms','downloads','bytes','throttles','retries','kandidaten_voor_poort','kandidaten_na_poort','afwijzing_root','afwijzing_mapping','afwijzing_binding','afwijzing_rechten','afwijzing_versie','afwijzing_download','afwijzing_extractie','afwijzing_lokalisatie','afwijzing_grens','opgenomen_passages','opgenomen_documenten']) <> '{}'::jsonb
        or (select count(*) from jsonb_object_keys(e)) <> 22
        -- Gesloten enums.
        or jsonb_typeof(e->'naam') is distinct from 'string'
        or e->>'naam' not in ('supabase-rag','microsoft-sharepoint')
        or jsonb_typeof(e->'resultaat') is distinct from 'string'
        or e->>'resultaat' not in ('treffers','leeg','niet_geraadpleegd')
        or jsonb_typeof(e->'methode') is distinct from 'string'
        -- GESLOTEN, niet "een korte string". Een lengtegrens is geen vorm: elke
        -- tekst tot 40 tekens paste erin, en juist een korte tekst is een prima
        -- drager voor een identifier of een providerfoutmelding. Deze lijst is
        -- gelijk aan ADAPTERMETA_METHODEN in TypeScript; een pariteitsgate leest
        -- beide en gaat rood zodra ze uiteenlopen.
        or e->>'methode' not in (
             'hybride_rrf','fts_dutch_ranked','fts_dutch_terugval','fts_plain',
             'ilike','geen','sharepoint_live'
           )
        -- Tellers: niet-negatieve GEHELE getallen.
        or jsonb_typeof(e->'netwerkpogingen') is distinct from 'number'
        or (e->>'netwerkpogingen')::numeric < 0
        or floor((e->>'netwerkpogingen')::numeric) <> (e->>'netwerkpogingen')::numeric
        or jsonb_typeof(e->'latency_ms') is distinct from 'number'
        or (e->>'latency_ms')::numeric < 0
        or floor((e->>'latency_ms')::numeric) <> (e->>'latency_ms')::numeric
        or jsonb_typeof(e->'downloads') is distinct from 'number'
        or (e->>'downloads')::numeric < 0
        or floor((e->>'downloads')::numeric) <> (e->>'downloads')::numeric
        or jsonb_typeof(e->'bytes') is distinct from 'number'
        or (e->>'bytes')::numeric < 0
        or floor((e->>'bytes')::numeric) <> (e->>'bytes')::numeric
        or jsonb_typeof(e->'throttles') is distinct from 'number'
        or (e->>'throttles')::numeric < 0
        or floor((e->>'throttles')::numeric) <> (e->>'throttles')::numeric
        or jsonb_typeof(e->'retries') is distinct from 'number'
        or (e->>'retries')::numeric < 0
        or floor((e->>'retries')::numeric) <> (e->>'retries')::numeric
        or jsonb_typeof(e->'kandidaten_voor_poort') is distinct from 'number'
        or (e->>'kandidaten_voor_poort')::numeric < 0
        or floor((e->>'kandidaten_voor_poort')::numeric) <> (e->>'kandidaten_voor_poort')::numeric
        or jsonb_typeof(e->'kandidaten_na_poort') is distinct from 'number'
        or (e->>'kandidaten_na_poort')::numeric < 0
        or floor((e->>'kandidaten_na_poort')::numeric) <> (e->>'kandidaten_na_poort')::numeric
        or jsonb_typeof(e->'afwijzing_root') is distinct from 'number'
        or (e->>'afwijzing_root')::numeric < 0
        or floor((e->>'afwijzing_root')::numeric) <> (e->>'afwijzing_root')::numeric
        or jsonb_typeof(e->'afwijzing_mapping') is distinct from 'number'
        or (e->>'afwijzing_mapping')::numeric < 0
        or floor((e->>'afwijzing_mapping')::numeric) <> (e->>'afwijzing_mapping')::numeric
        or jsonb_typeof(e->'afwijzing_binding') is distinct from 'number'
        or (e->>'afwijzing_binding')::numeric < 0
        or floor((e->>'afwijzing_binding')::numeric) <> (e->>'afwijzing_binding')::numeric
        or jsonb_typeof(e->'afwijzing_rechten') is distinct from 'number'
        or (e->>'afwijzing_rechten')::numeric < 0
        or floor((e->>'afwijzing_rechten')::numeric) <> (e->>'afwijzing_rechten')::numeric
        or jsonb_typeof(e->'afwijzing_versie') is distinct from 'number'
        or (e->>'afwijzing_versie')::numeric < 0
        or floor((e->>'afwijzing_versie')::numeric) <> (e->>'afwijzing_versie')::numeric
        or jsonb_typeof(e->'afwijzing_download') is distinct from 'number'
        or (e->>'afwijzing_download')::numeric < 0
        or floor((e->>'afwijzing_download')::numeric) <> (e->>'afwijzing_download')::numeric
        or jsonb_typeof(e->'afwijzing_extractie') is distinct from 'number'
        or (e->>'afwijzing_extractie')::numeric < 0
        or floor((e->>'afwijzing_extractie')::numeric) <> (e->>'afwijzing_extractie')::numeric
        or jsonb_typeof(e->'afwijzing_lokalisatie') is distinct from 'number'
        or (e->>'afwijzing_lokalisatie')::numeric < 0
        or floor((e->>'afwijzing_lokalisatie')::numeric) <> (e->>'afwijzing_lokalisatie')::numeric
        or jsonb_typeof(e->'afwijzing_grens') is distinct from 'number'
        or (e->>'afwijzing_grens')::numeric < 0
        or floor((e->>'afwijzing_grens')::numeric) <> (e->>'afwijzing_grens')::numeric
        or jsonb_typeof(e->'opgenomen_passages') is distinct from 'number'
        or (e->>'opgenomen_passages')::numeric < 0
        or floor((e->>'opgenomen_passages')::numeric) <> (e->>'opgenomen_passages')::numeric
        or jsonb_typeof(e->'opgenomen_documenten') is distinct from 'number'
        or (e->>'opgenomen_documenten')::numeric < 0
        or floor((e->>'opgenomen_documenten')::numeric) <> (e->>'opgenomen_documenten')::numeric
  ) then
    raise exception 'adaptermetadata_ongeldig' using errcode = 'check_violation';
  end if;

  return jsonb_build_object('adapters', v_adapters);
end;
$fn$;

revoke all on function public.meta_adapters_projectie(jsonb) from public, anon;
grant execute on function public.meta_adapters_projectie(jsonb) to authenticated;

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
       end
    || public.meta_adapters_projectie(p_meta);
$$;

revoke all on function public.meta_basisniveau(jsonb) from public, anon;
revoke all on function public.meta_bronniveau(jsonb) from public, anon;
grant execute on function public.meta_basisniveau(jsonb) to authenticated;
grant execute on function public.meta_bronniveau(jsonb) to authenticated;
