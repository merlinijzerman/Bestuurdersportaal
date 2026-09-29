-- ============================================================================
-- #493 V-1 — juridische rol per zijde in het vergelijkingsauditspoor.
-- ----------------------------------------------------------------------------
-- OPSLAGKLOOF (bewezen, niet aangenomen). fn_schrijf_vergelijking (#369)
-- projecteert p_retrieval_meta en p_bronnen ALLOWLIST-gebaseerd: alleen
-- correlation_id/pogingen/toelating resp. de elf vaste bronsleutels komen in
-- comparison_run. Elke extra sleutel — ook een juridische rol, dossier,
-- normgewicht of rechtsregime — wordt stil weggeprojecteerd. De losse route
-- /api/vergelijk schrijft géén governance_log; comparison_run is daar het enige
-- duurzame spoor. Zonder deze wijziging is de juridische rol dus niet
-- herleidbaar voor die route.
--
-- WIJZIGING. Uitsluitend de projectie en validatie van één nieuwe, optionele
-- sleutel `retrieval_meta.juridische_duiding` = { verhouding, zijden[] }. Geen
-- nieuwe tabel, kolom, functie, policy of grant; dezelfde signatuur (ACL blijft
-- bij create or replace behouden en wordt hieronder idempotent herbevestigd).
-- Ontbreekt de sleutel — elke niet-juridische vergelijking — dan is het
-- geschreven spoor bytegelijk aan #369. Code die de sleutel stuurt vóór deze
-- migratie is veilig: de oude projectie laat haar weg (terugwaarts compatibel).
--
-- UNFORGEABLE. Een zijde met een rol ≠ onbekend moet via de opaque
-- documentidentiteit (#367) aan een zichtbaar document van het eigen fonds of
-- een echte generieke bron binden, exact diens documenttype/subtype/dossier/
-- normgewicht/regime/documentdatum dragen, en een rol die bij het documenttype
-- past. Geen titel, geen database-id.
-- ============================================================================

begin;

create or replace function public.fn_schrijf_vergelijking(
  p_mode               text,
  p_model              text,
  p_prompt_version     text,
  p_comparator_version text,
  p_findings           jsonb,
  p_correlation_id     text,
  p_retrieval_meta     jsonb,
  p_bronnen            jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_fonds     uuid;
  v_run_id    uuid;
  v_vreemd    int;
  v_meta      jsonb;
  v_bronnen   jsonb;
  v_jur       jsonb;
  v_jur_zijden jsonb;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;
  if p_mode not in ('symmetrisch','coverage') then
    raise exception 'fn_schrijf_vergelijking: ongeldige mode %', p_mode using errcode = '22023';
  end if;
  if nullif(btrim(p_correlation_id), '') is null or length(p_correlation_id) > 200 then
    raise exception 'fn_schrijf_vergelijking: ongeldige correlation_id' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_findings, 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_bronnen, 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_retrieval_meta, 'null'::jsonb)) <> 'object' then
    raise exception 'fn_schrijf_vergelijking: ongeldige auditvorm' using errcode = '22023';
  end if;

  select p.fonds_id into v_fonds
    from public.profielen p
   where p.id = v_uid;
  if v_fonds is null then
    raise exception 'geen_fonds_voor_gebruiker' using errcode = 'P0002';
  end if;

  -- Elke finding en bronverwijzing moet naar een document van het eigen fonds
  -- of naar een ECHTE globale generieke bron wijzen. De DEFINER-functie omzeilt
  -- RLS en doet deze toets daarom zelf; een fondsloos fonds-/notulenstuk valt dicht.
  select count(*) into v_vreemd
    from jsonb_array_elements(p_findings) as f
   where not exists (
           select 1 from public.documenten d
            where d.id = (f->>'bron_document_id')::uuid
              and (d.fonds_id = v_fonds or (d.fonds_id is null and d.bibliotheek = 'generiek')))
      or not exists (
           select 1 from public.documenten d
            where d.id = (f->>'doel_document_id')::uuid
              and (d.fonds_id = v_fonds or (d.fonds_id is null and d.bibliotheek = 'generiek')));
  if v_vreemd > 0 then
    raise exception 'vergelijking_vreemd_document' using errcode = '42501';
  end if;

  -- Ook de inhoudsvrije pogingen dragen sinds #367 uitsluitend opaque
  -- documentidentiteiten. Bind ze aan een echt, zichtbaar document voordat ze
  -- in het append-only spoor komen; een directe RPC-aanroeper mag geen vrij
  -- auditlabel kunnen planten.
  select count(*) into v_vreemd
    from jsonb_array_elements(coalesce(p_retrieval_meta->'pogingen', '[]'::jsonb)) as p
   where not exists (
           select 1 from public.documenten d
            where (d.fonds_id = v_fonds or (d.fonds_id is null and d.bibliotheek = 'generiek'))
              and p->>'document_id' = 'doc_v1_' || encode(extensions.digest(
                octet_length('bestuurdersportaal:doc:v1')::text || ':bestuurdersportaal:doc:v1|' ||
                octet_length(case when d.fonds_id is null then 'generiek' else 'fonds:' || d.fonds_id::text end)::text || ':' ||
                  case when d.fonds_id is null then 'generiek' else 'fonds:' || d.fonds_id::text end || '|' ||
                octet_length(d.id::text)::text || ':' || d.id::text,
                'sha256'
              ), 'hex'));
  if v_vreemd > 0 then
    raise exception 'vergelijking_vreemde_retrievalpoging' using errcode = '42501';
  end if;

  -- V-1 (#493) — juridische duiding per zijde. Optioneel: een niet-juridische
  -- vergelijking stuurt haar niet en krijgt exact het bestaande spoor. Is zij
  -- er wel, dan moet elke niet-onbekende zijde aan een echt, zichtbaar document
  -- binden én exact diens R-1-metadata dragen; de rol moet bij het documenttype
  -- passen. Een directe RPC-aanroeper kan zo geen normstatus verzinnen.
  v_jur := p_retrieval_meta->'juridische_duiding';
  if v_jur is not null then
    if jsonb_typeof(v_jur) <> 'object'
       or coalesce(v_jur->>'verhouding', '') not in (
            'norm_tegenover_toelichting', 'norm_tegenover_norm',
            'toelichting_tegenover_toelichting', 'juridisch_tegenover_overig', 'onbepaald')
       or jsonb_typeof(v_jur->'zijden') is distinct from 'array'
       or jsonb_array_length(v_jur->'zijden') not between 1 and 2
       or exists (select 1 from jsonb_array_elements(v_jur->'zijden') as z where jsonb_typeof(z) <> 'object')
       or (select count(distinct z->>'zijde') from jsonb_array_elements(v_jur->'zijden') as z)
            <> jsonb_array_length(v_jur->'zijden') then
      raise exception 'vergelijking_ongeldige_juridische_duiding' using errcode = '22023';
    end if;

    select count(*) into v_vreemd
      from jsonb_array_elements(v_jur->'zijden') as z
     where coalesce(z->>'zijde', '') not in ('bron', 'doel')
        or coalesce(z->>'rol', '') not in (
             'geldend_recht', 'wetgeving_niet_geldend', 'wetgeving_status_onbekend',
             'wetsgeschiedenis', 'niet_juridisch', 'onbekend')
        -- `onbekend` beweert niets: geen documentbinding en geen metadata.
        or (z->>'rol' = 'onbekend' and (z - 'zijde' - 'rol') <> '{}'::jsonb)
        or (z->>'rol' <> 'onbekend' and not exists (
             select 1 from public.documenten d
              where (d.fonds_id = v_fonds or (d.fonds_id is null and d.bibliotheek = 'generiek'))
                and z->>'document_id' = 'doc_v1_' || encode(extensions.digest(
                   octet_length('bestuurdersportaal:doc:v1')::text || ':bestuurdersportaal:doc:v1|' ||
                   octet_length(case when d.fonds_id is null then 'generiek' else 'fonds:' || d.fonds_id::text end)::text || ':' ||
                     case when d.fonds_id is null then 'generiek' else 'fonds:' || d.fonds_id::text end || '|' ||
                   octet_length(d.id::text)::text || ':' || d.id::text,
                   'sha256'
                 ), 'hex')
                and (z->>'documenttype') is not distinct from d.documenttype
                and (z->>'wetsgeschiedenis_subtype') is not distinct from d.wetsgeschiedenis_subtype
                and (z->>'dossiernummer') is not distinct from d.dossiernummer
                and (z->>'normgewicht') is not distinct from d.normgewicht
                and (z->>'wettelijk_regime') is not distinct from d.wettelijk_regime
                and (z->>'documentdatum') is not distinct from d.documentdatum::text
                and case d.documenttype
                      when 'wetgeving' then z->>'rol' in (
                        'geldend_recht', 'wetgeving_niet_geldend', 'wetgeving_status_onbekend')
                      when 'wetsgeschiedenis' then z->>'rol' = 'wetsgeschiedenis'
                      else z->>'rol' = 'niet_juridisch'
                    end));
    if v_vreemd > 0 then
      raise exception 'vergelijking_vreemde_juridische_duiding' using errcode = '42501';
    end if;
  end if;

  select count(*) into v_vreemd
    from jsonb_array_elements(p_bronnen) as b
   where not exists (
           select 1 from public.documenten d
            where (
                (
                  d.fonds_id = v_fonds
                  and b->>'bronsoort' in ('fonds', 'notulen')
                  and coalesce(b->>'bibliotheek', 'fonds') <> 'generiek'
                )
                or (
                  d.fonds_id is null
                  and d.bibliotheek = 'generiek'
                  and b->>'bronsoort' = 'generiek'
                  and b->>'bibliotheek' = 'generiek'
                )
              )
              -- #367: de duurzame/publieke bron draagt geen database-UUID.
              -- Herleid dezelfde opaque documentidentiteit uit de echte,
              -- tenantgecontroleerde rij; zo blijft de DEFINER-check streng
              -- zonder een providerprivate locator in het auditspoor op te slaan.
              and b->>'document_id' = 'doc_v1_' || encode(extensions.digest(
                octet_length('bestuurdersportaal:doc:v1')::text || ':bestuurdersportaal:doc:v1|' ||
                octet_length(case when d.fonds_id is null then 'generiek' else 'fonds:' || d.fonds_id::text end)::text || ':' ||
                  case when d.fonds_id is null then 'generiek' else 'fonds:' || d.fonds_id::text end || '|' ||
                octet_length(d.id::text)::text || ':' || d.id::text,
                'sha256'
              ), 'hex')
              -- Bind de opaque citation-identiteit ook cryptografisch aan
              -- precies deze bron, passage en versie. Zo kan een directe
              -- RPC-aanroeper geen lokaal ordinaal of vrij auditlabel planten.
              and b->>'citation_id' = 'citation_v1_' || encode(extensions.digest(
                octet_length('bestuurdersportaal:citation:v1')::text || ':bestuurdersportaal:citation:v1|' ||
                octet_length(b->>'document_id')::text || ':' || (b->>'document_id') || '|' ||
                octet_length(b->>'passage_ref')::text || ':' || (b->>'passage_ref') || '|' ||
                octet_length(b->'versie'->>'soort')::text || ':' || (b->'versie'->>'soort') || '|' ||
                octet_length(b->'versie'->>'waarde')::text || ':' || (b->'versie'->>'waarde'),
                'sha256'
              ), 'hex')
              and jsonb_typeof(b->'actueel') = 'boolean');
  if v_vreemd > 0 then
    raise exception 'vergelijking_vreemde_bron' using errcode = '42501';
  end if;

  -- Projecteer allowlist-gebaseerd: een directe RPC-aanroeper kan geen vrije
  -- tekst of extra sleutels in het append-only spoor planten.
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'document_id', b->'document_id',
    'dimensie', b->'dimensie',
    'methode', b->'methode',
    'opgehaald', b->'opgehaald',
    'geselecteerd', b->'geselecteerd',
    'fout', b->'fout',
    'toelating', b->'toelating'
  ))), '[]'::jsonb)
    into v_meta
    from jsonb_array_elements(coalesce(p_retrieval_meta->'pogingen', '[]'::jsonb)) as b;
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'correlation_id', p_correlation_id,
    'pogingen', v_meta,
    'toelating', p_retrieval_meta->'toelating'
  ));

  -- V-1 (#493): allowlist-projectie; zonder duiding blijft v_meta bytegelijk.
  if v_jur is not null then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'zijde', z->'zijde',
      'document_id', z->'document_id',
      'rol', z->'rol',
      'documenttype', z->'documenttype',
      'wetsgeschiedenis_subtype', z->'wetsgeschiedenis_subtype',
      'dossiernummer', z->'dossiernummer',
      'normgewicht', z->'normgewicht',
      'wettelijk_regime', z->'wettelijk_regime',
      'documentdatum', z->'documentdatum'
    )) order by z->>'zijde'), '[]'::jsonb)
      into v_jur_zijden
      from jsonb_array_elements(v_jur->'zijden') as z;
    v_meta := v_meta || jsonb_build_object('juridische_duiding', jsonb_build_object(
      'verhouding', v_jur->'verhouding',
      'zijden', v_jur_zijden
    ));
  end if;

  -- Statusnulls zijn betekenisvol bewijs ("niet gezet"), geen afwezig veld.
  -- Bewaar daarom voor bronnen de volledige vaste allowlist-vorm.
  select coalesce(jsonb_agg(jsonb_build_object(
    'citation_id', b->'citation_id',
    'passage_ref', b->'passage_ref',
    'document_id', b->'document_id',
    'pagina', b->'pagina',
    'bibliotheek', b->'bibliotheek',
    'bronsoort', b->'bronsoort',
    'documentstatus', b->'documentstatus',
    'bronstatus', b->'bronstatus',
    'geldig_tot', b->'geldig_tot',
    'actueel', b->'actueel',
    'versie', b->'versie'
  )), '[]'::jsonb)
    into v_bronnen
    from jsonb_array_elements(p_bronnen) as b;

  insert into public.comparison_run
    (fonds_id, mode, model, prompt_version, comparator_version,
     correlation_id, retrieval_meta, bronnen)
  values
    (v_fonds, p_mode, p_model, p_prompt_version, p_comparator_version,
     p_correlation_id, v_meta, v_bronnen)
  returning id into v_run_id;

  insert into public.comparison_results
    (comparison_run_id, fonds_id, finding_key, dimensie, concept_id,
     bron_document_id, bron_value, bron_evidence, bron_page, bron_passage_ref,
     doel_document_id, doel_value, doel_evidence, doel_page, doel_passage_ref,
     verschil_type_ruw, method)
  select
    v_run_id, v_fonds, f->>'finding_key', f->>'dimensie',
    nullif(f->>'concept_id','')::uuid,
    (f->>'bron_document_id')::uuid, nullif(f->>'bron_value','')::text,
    nullif(f->>'bron_evidence','')::text, nullif(f->>'bron_page','')::int,
    nullif(f->>'bron_passage_ref','')::text,
    (f->>'doel_document_id')::uuid, nullif(f->>'doel_value','')::text,
    nullif(f->>'doel_evidence','')::text, nullif(f->>'doel_page','')::int,
    nullif(f->>'doel_passage_ref','')::text,
    f->>'verschil_type_ruw', f->>'method'
  from jsonb_array_elements(p_findings) as f;

  return v_run_id;
end $$;

comment on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb) is
  '#369 + #493: atomische append-only vergelijking met serverfonds, inhoudsvrije retrievalprovenance, correlation en gevalideerde juridische duiding per zijde.';

revoke all on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)
  from public, anon;
grant execute on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)
  to authenticated, service_role;

commit;
