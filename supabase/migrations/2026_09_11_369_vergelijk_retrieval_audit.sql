-- ============================================================================
-- #369 — duurzame retrievalprovenance bij een vergelijking.
-- ----------------------------------------------------------------------------
-- comparison_run is de append-only runheader. Tot nu toe verdwenen de centraal
-- gevormde bronverwijzingen, status/versie, toelatingssamenvatting en correlation
-- na de HTTP-respons; de chat schreef zelfs letterlijk p_bronnen=[]. Deze
-- migratie bewaart een inhoudsvrije bronprojectie en uitvoeringstelemetrie in
-- dezelfde atomaire transactie als run + findings. Fragment/evidence staat hier
-- bewust NIET; evidence leeft al in comparison_results en chatbronnen in de
-- verwijderbare governance_log_inhoud.
-- ============================================================================

begin;

alter table public.comparison_run
  add column if not exists correlation_id text,
  add column if not exists retrieval_meta jsonb not null default '{}'::jsonb,
  add column if not exists bronnen jsonb not null default '[]'::jsonb;

alter table public.comparison_results
  add column if not exists bron_passage_ref text,
  add column if not exists doel_passage_ref text;

comment on column public.comparison_run.correlation_id is
  '#369: servercorrelation van de volledige vergelijkrequest; geen clientwaarde.';
comment on column public.comparison_run.retrieval_meta is
  '#369: inhoudsvrije poging-/toelatingstelemetrie van de centrale retrievalorkestratie.';
comment on column public.comparison_run.bronnen is
  '#369: providerneutrale bronprovenance zonder passage/fragment; status, versie en locator.';
comment on column public.comparison_results.bron_passage_ref is
  '#369: providerneutrale koppeling van de bron-evidence aan comparison_run.bronnen.passage_ref.';
comment on column public.comparison_results.doel_passage_ref is
  '#369: providerneutrale koppeling van de doel-evidence aan comparison_run.bronnen.passage_ref.';

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

  select count(*) into v_vreemd
    from jsonb_array_elements(p_bronnen) as b
   where not exists (
           select 1 from public.documenten d
            where d.id = (b->>'document_id')::uuid
              and (
                d.fonds_id = v_fonds
                or (
                  d.fonds_id is null
                  and d.bibliotheek = 'generiek'
                  and b->>'bronsoort' = 'generiek'
                  and b->>'bibliotheek' = 'generiek'
                )
              ));
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

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'citation_id', b->'citation_id',
    'passage_ref', b->'passage_ref',
    'document_id', b->'document_id',
    'pagina', b->'pagina',
    'bibliotheek', b->'bibliotheek',
    'bronsoort', b->'bronsoort',
    'documentstatus', b->'documentstatus',
    'bronstatus', b->'bronstatus',
    'geldig_tot', b->'geldig_tot',
    'versie', b->'versie'
  ))), '[]'::jsonb)
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
  '#369: atomische append-only vergelijking met serverfonds, inhoudsvrije retrievalprovenance en correlation.';

-- De vijf-argumentvariant kan de verplichte provenance niet ontvangen en is
-- daarom niet langer een publiek schrijfpad. Hij blijft bestaan voor rollback.
revoke all on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)
  from public, anon;
grant execute on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)
  to authenticated, service_role;

commit;
