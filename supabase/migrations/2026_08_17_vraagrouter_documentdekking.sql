-- ============================================================================
-- Vraagrouter v2 + aantoonbare documentdekking — auditprojectie
-- ----------------------------------------------------------------------------
-- De app schrijft drie nieuwe, gesloten retrieval_meta-objecten:
--   vraagrouter        — taak/scope/dekking/bewijsniveau/vertrouwen/signalen;
--   vraagrouter_uitvoering/analyseplan — gesloten meting en criterium-ids;
--   documentdekking    — aantallen, batchdekking en gesloten afkapredenen;
--   volledige_analyse — aangeboden/uitgevoerd plus twee bronreferenties.
--
-- De eerste twee zijn operationele telemetrie (basisniveau). Bij
-- volledige_analyse blijven de statussen basis; vorige_log_id en document_id
-- zijn bronidentiteit en zijn alleen zichtbaar op bronniveau. Er wordt geen
-- gebruikersvraag of documenttekst aan het append-only spoor toegevoegd.
--
-- Deze cumulatieve herdefinitie neemt ook de reeds in de app gebruikte
-- ttft_ms/module_scope-allowlist mee. Signatuur, privileges en RLS blijven
-- ongewijzigd. create or replace maakt de migratie idempotent.
-- ============================================================================

create or replace function public.meta_projectie(p_meta jsonb, p_bron boolean)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  c_basis constant text[] := array[
    'methode','opgehaald','geselecteerd','embedding_query_success','fallback_reason',
    'rerank','drempel','zwakke_bronbasis','parent',
    'toegepaste_fonds_filter','namespace_conventie','fondsdiscipline_gedropt',
    'body_fonds_id_genegeerd',
    'antwoordmodus','transformatie','bronbasis','inline_meldingen','citaties',
    'source_summary',
    'bron_intent','bron_vertrouwen','bron_modus_auto','alleen_fondsdocumenten',
    'bron_intent_override','bron_intent_bron','bron_intent_herkomst',
    'portaalstand_gebruikt',
    'profielsturing','profielsturing_aspecten','organisatieprofiel',
    'organisatieprofiel_aspecten',
    'startvraag_bron','niet_vastgesteld','verduidelijking','geen_modelcall',
    'context_geneutraliseerd','gereformuleerd',
    'duur_ms','duur_model_ms','tokens','tokendekking','ttft_ms',
    'selectie',
    'scope','invoer','filters','web','markeringen','module_scope',
    'vraagrouter','vraagrouter_uitvoering','analyseplan',
    'documentdekking','volledige_analyse'
  ];
  c_bron constant text[] := array[
    'chunks','bronversie_audit','besluitbronnen','mogelijk_gerelateerd',
    'doorgrond','bureau','herkomst','selectie_kandidaten'
  ];
  v_toegestaan text[];
  v_uit jsonb;
  v_deel jsonb;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    return '{}'::jsonb;
  end if;

  v_toegestaan := case when p_bron then c_basis || c_bron else c_basis end;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_uit
    from jsonb_each(p_meta) e
   where e.key = any(v_toegestaan);

  if v_uit ? 'scope' and jsonb_typeof(v_uit->'scope') = 'object' then
    v_deel := (v_uit->'scope') - 'titels';
    if not p_bron then v_deel := v_deel - 'document_ids'; end if;
    v_uit := jsonb_set(v_uit, '{scope}', v_deel);
  end if;

  if v_uit ? 'module_scope' and jsonb_typeof(v_uit->'module_scope') = 'object' then
    v_deel := v_uit->'module_scope';
    if not p_bron then
      v_deel := v_deel - 'procedure_id' - 'risico_id' - 'bron_ids';
    end if;
    v_uit := jsonb_set(v_uit, '{module_scope}', v_deel);
  end if;

  if v_uit ? 'volledige_analyse' and jsonb_typeof(v_uit->'volledige_analyse') = 'object' then
    v_deel := v_uit->'volledige_analyse';
    if not p_bron then
      v_deel := v_deel - 'vorige_log_id' - 'document_id';
    end if;
    v_uit := jsonb_set(v_uit, '{volledige_analyse}', v_deel);
  end if;

  if v_uit ? 'invoer' and jsonb_typeof(v_uit->'invoer') = 'object' then
    v_uit := jsonb_set(v_uit, '{invoer}', (v_uit->'invoer') - 'historie_hash');
  end if;

  if v_uit ? 'filters' and jsonb_typeof(v_uit->'filters') = 'object' then
    v_deel := v_uit->'filters';
    if not p_bron then v_deel := v_deel - 'procesinstantie_ids'; end if;
    v_uit := jsonb_set(v_uit, '{filters}', v_deel);
  end if;

  if v_uit ? 'web' and jsonb_typeof(v_uit->'web') = 'object' then
    v_deel := v_uit->'web';
    if not p_bron then
      v_deel := v_deel - 'gebruikte_bronnen' - 'bevraagde_domeinen';
    end if;
    v_uit := jsonb_set(v_uit, '{web}', v_deel);
  end if;

  if v_uit ? 'markeringen' and jsonb_typeof(v_uit->'markeringen') = 'object' then
    v_deel := v_uit->'markeringen';
    if not p_bron then v_deel := v_deel - 'instanties'; end if;
    v_uit := jsonb_set(v_uit, '{markeringen}', v_deel);
  end if;

  return v_uit;
end;
$$;

revoke all on function public.meta_projectie(jsonb, boolean) from public, anon;
grant execute on function public.meta_projectie(jsonb, boolean) to authenticated;

-- Structurele zelfcontrole: gesloten telemetrie blijft zichtbaar; ids lekken
-- niet naar het basisniveau en blijven wel beschikbaar voor bronauditors.
do $$
declare
  v_meta jsonb := jsonb_build_object(
    'vraagrouter', jsonb_build_object('taak','volledigheidstoets','dekking','volledig_document'),
    'vraagrouter_uitvoering', jsonb_build_object(
      'router_ms',14,'modelrouter',jsonb_build_object('toegepast',false,'uitkomst','overgeslagen')
    ),
    'analyseplan', jsonb_build_object(
      'kader','algemeen_controleplan_niet_juridisch_volledig',
      'criteria',jsonb_build_array(jsonb_build_object('id','effecten','herkomst','standaard_analyseplan'))
    ),
    'documentdekking', jsonb_build_object('volledig',true,'verwerkte_passages',40),
    'volledige_analyse', jsonb_build_object(
      'aangeboden',true,'uitgevoerd',false,'vorige_log_id','00000000-0000-0000-0000-000000000001',
      'document_id','00000000-0000-0000-0000-000000000002'
    )
  );
  v_basis jsonb;
  v_bron jsonb;
begin
  v_basis := public.meta_projectie(v_meta, false);
  v_bron := public.meta_projectie(v_meta, true);

  if not (v_basis ? 'vraagrouter')
     or not (v_basis ? 'vraagrouter_uitvoering')
     or not (v_basis ? 'analyseplan')
     or not (v_basis ? 'documentdekking') then
    raise exception 'vraagrouter-migratie: basisprojectie mist router/dekking';
  end if;
  if (v_basis->'volledige_analyse') ? 'vorige_log_id'
     or (v_basis->'volledige_analyse') ? 'document_id' then
    raise exception 'vraagrouter-migratie: bron-id zichtbaar op basisniveau';
  end if;
  if not ((v_bron->'volledige_analyse') ? 'vorige_log_id')
     or not ((v_bron->'volledige_analyse') ? 'document_id') then
    raise exception 'vraagrouter-migratie: bronprojectie mist analyse-id';
  end if;
end;
$$;
