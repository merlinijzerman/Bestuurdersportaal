-- ============================================================================
-- #322 PR-C — auditprojectie: `toelating` (en de al langer ontbrekende `gateway`)
-- ----------------------------------------------------------------------------
-- De app schrijft sinds PR-C `retrieval_meta.toelating`: een inhoudsvrije
-- samenvatting van de toelatingspoort — aantallen per genormaliseerde categorie
-- (`toestemming_geweigerd`, `configuratiefout`, `providerfout`) en per grond.
-- Geen referenties: dat zijn identifiers van stukken die de gebruiker juist
-- níét mocht zien.
--
-- WAAROM EEN MIGRATIE. De sleutel stond alleen in de TypeScript-allowlist
-- (core/lib/audit-meta.ts, META_BASIS). `meta_projectie()` hanteert een EIGEN
-- allowlist, dus de samenvatting werd wél opgeslagen maar verdween bij het
-- lezen via `meta_basisniveau()` en `meta_bronniveau()`. Een auditspoor dat je
-- niet kunt lezen is geen auditspoor.
--
-- DEZELFDE FOUT, AL LANGER AANWEZIG. Een pariteitscontrole tussen beide
-- allowlists vond ook `gateway` (#311 T3): sinds 766bbe6 als basis
-- geclassificeerd in TypeScript, nooit toegevoegd aan de projectie. Hier in
-- dezelfde cumulatieve herdefinitie meegenomen; de pariteitsgate in
-- tests/cross-tenant/retrieval-toelatingspoort.test.ts voorkomt herhaling.
--
-- Cumulatieve herdefinitie van 2026_08_17_vraagrouter_documentdekking.sql: de
-- body is letterlijk overgenomen, alleen `c_basis` groeit met twee sleutels.
-- Beide zijn basisniveau — geen bronidentiteit, dus niets om voor het
-- basisniveau weg te filteren. Signatuur, privileges en RLS blijven gelijk;
-- `create or replace` maakt de migratie idempotent.
-- ============================================================================

create or replace function public.meta_projectie(p_meta jsonb, p_bron boolean)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  c_basis constant text[] := array[
    'correlation_id','methode','opgehaald','geselecteerd','embedding_query_success','fallback_reason',
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
    'documentdekking','volledige_analyse',
    -- #311 T3 — effectieve gateway-configuratie (provider, model, profiel-id,
    -- configuratieversie). Sinds 766bbe6 als basis geclassificeerd in
    -- core/lib/audit-meta.ts, maar hier nooit toegevoegd: opgeslagen en bij
    -- het lezen weggefilterd. Gevonden door de pariteitsgate van PR-C.
    'gateway',
    -- #322 PR-C — toelatingspoort: uitsluitend tellingen per categorie en
    -- grond, geen referenties.
    'toelating'
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

-- Structurele zelfcontrole: beide sleutels overleven BEIDE leesniveaus.
do $$
declare
  v_meta jsonb := jsonb_build_object(
    'toelating', jsonb_build_object(
      'geweigerd', 3,
      'categorieen', jsonb_build_object('toestemming_geweigerd', 2, 'providerfout', 1),
      'gronden', jsonb_build_object('geen_bewijs', 2, 'v5_hook_fout', 1)
    ),
    'gateway', jsonb_build_object('provider','anthropic','model','m','profiel_id','p','config_versie',1)
  );
  v_basis jsonb := public.meta_basisniveau(v_meta);
  v_bron  jsonb := public.meta_bronniveau(v_meta);
begin
  if not (v_basis ? 'toelating') or not (v_bron ? 'toelating') then
    raise exception 'toelating-migratie: toelating verdwijnt bij het lezen';
  end if;
  if (v_basis->'toelating'->>'geweigerd')::int <> 3 then
    raise exception 'toelating-migratie: telling niet intact op basisniveau';
  end if;
  if not (v_basis ? 'gateway') then
    raise exception 'toelating-migratie: gateway verdwijnt bij het lezen';
  end if;
end;
$$;
