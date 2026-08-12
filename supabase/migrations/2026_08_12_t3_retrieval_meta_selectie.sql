-- ============================================================================
--  T3 — Auditlog-uitbreiding retrieval_meta: selectie-diagnostiek
-- ----------------------------------------------------------------------------
--  WAAROM
--  retrieval_meta logde tot nu toe alleen de GESELECTEERDE chunks (chunks,
--  bronversie_audit) en de tellingen (opgehaald, geselecteerd). Daardoor was
--  "opgehaald maar gedemoveerd" niet te onderscheiden van "nooit opgehaald" —
--  de blinde vlek uit de oorspronkelijke diagnose. T3 voegt in de app-laag twee
--  additieve sleutels toe aan retrieval_meta:
--
--    • selectie            — de actieve constraints + intent/regime + tellingen
--                            (geselecteerd/afgevallen per reden). Operationele
--                            telemetrie, GEEN inhoud, GEEN bronidentiteit → BASIS.
--    • selectie_kandidaten — de kandidatenset vóór selectie: per kandidaat
--                            document_id + bibliotheek + rang + status + reden
--                            (weging/zwak_generiek/quotum/dedup/budget). Draagt
--                            bronIDENTITEIT (document_id/bibliotheek), net als
--                            `chunks`/`bronversie_audit` → BRON.
--
--  DIT BESTAND is de SQL-spiegel van de allowlist in core/lib/audit-meta.ts
--  (META_BASIS/META_BRON). meta_projectie() moet meebewegen, anders zou de
--  leesprojectie de twee nieuwe sleutels als niet-toegestaan (dus als inhoud)
--  wegprojecteren en zouden ze — ook op nieuwe rijen — nooit zichtbaar zijn voor
--  een auditor met governance_audit_read(_sources). Zie de LET OP-blokken in
--  audit-meta.ts en decisions/README.md.
--
--  APPEND-ONLY / NON-REGRESSIE. Dit wijzigt niets aan governance_log of aan
--  bestaande retrieval_meta-sleutels; het is uitsluitend een uitbreiding van de
--  lees-allowlist. Rijen van vóór T3 dragen de sleutels niet en veranderen niet.
--
--  IDEMPOTENT. create or replace + volledige herdefinitie (identiek aan
--  2026_08_05_t2, met 'selectie' toegevoegd aan c_basis en 'selectie_kandidaten'
--  aan c_bron). Meermaals draaien is veilig.
-- ============================================================================

create or replace function public.meta_projectie(p_meta jsonb, p_bron boolean)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  -- Operationele telemetrie: geen inhoud, geen bronidentiteit.
  -- T3: 'selectie' toegevoegd (intent/regime/constraints + geselecteerd- en
  -- afgevallen-tellingen — pure telemetrie, geen document-identiteit).
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
    'duur_ms','duur_model_ms','tokens','tokendekking',
    'selectie',
    'scope','invoer','filters','web','markeringen'
  ];
  -- BronIDENTITEIT (welk document, welke versie) — geen letterlijke tekst.
  -- T2: 'bureau' toegevoegd. T3: 'selectie_kandidaten' toegevoegd (per kandidaat
  -- document_id + bibliotheek + rang + status/reden — bronidentiteit, geen tekst).
  c_bron constant text[] := array[
    'chunks','bronversie_audit','besluitbronnen','mogelijk_gerelateerd',
    'doorgrond','bureau','herkomst',
    'selectie_kandidaten'
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

  -- Gemengde objecten: subsleutels van een hoger niveau alsnog verwijderen.
  -- Spiegel van SUB_NIVEAUS in core/lib/audit-meta.ts. T3 voegt géén gemengd
  -- object toe: 'selectie' is volledig basis en 'selectie_kandidaten' is een
  -- schone top-level bron-sleutel — geen extra strip-stap nodig.
  if v_uit ? 'scope' and jsonb_typeof(v_uit->'scope') = 'object' then
    v_deel := (v_uit->'scope') - 'titels';            -- titels = documenttitels
    if not p_bron then v_deel := v_deel - 'document_ids'; end if;
    v_uit := jsonb_set(v_uit, '{scope}', v_deel);
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
