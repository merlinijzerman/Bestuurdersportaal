-- ============================================================================
--  ROLLBACK van 2026_08_05_t2_bureau_stukvoorbereiding.sql
-- ----------------------------------------------------------------------------
--  ⚠ NIET draaien zolang de T2-code live is: de route logt via log_word_export()
--     en leest retrieval_meta.bureau op bronniveau. Eerst code terugrollen.
--
--  Weigert zolang er nog export-regels bestaan: die zijn append-only en mogen niet
--  stilzwijgend met de tabel verdwijnen (auditintegriteit).
-- ============================================================================

begin;

do $$
begin
  if exists (select 1 from public.governance_export_log limit 1) then
    raise exception
      'ROLLBACK geweigerd: governance_export_log bevat regels (append-only auditspoor).';
  end if;
end $$;

drop function if exists public.log_word_export(uuid, text, text, jsonb);

drop trigger if exists trg_export_log_no_update on public.governance_export_log;
drop trigger if exists trg_export_log_no_delete on public.governance_export_log;
drop function if exists public.fn_export_log_immutable();
drop policy  if exists "export log select" on public.governance_export_log;
drop table   if exists public.governance_export_log;

-- meta_projectie terug naar de A2-definitie (bureau uit c_bron). Volledige
-- herdefinitie identiek aan 2026_08_04_a2, ZONDER 'bureau'.
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
    'duur_ms','duur_model_ms','tokens','tokendekking',
    'scope','invoer','filters','web','markeringen'
  ];
  c_bron constant text[] := array[
    'chunks','bronversie_audit','besluitbronnen','mogelijk_gerelateerd',
    'doorgrond','herkomst'
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
    into v_uit from jsonb_each(p_meta) e where e.key = any(v_toegestaan);
  if v_uit ? 'scope' and jsonb_typeof(v_uit->'scope') = 'object' then
    v_deel := (v_uit->'scope') - 'titels';
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
    if not p_bron then v_deel := v_deel - 'gebruikte_bronnen' - 'bevraagde_domeinen'; end if;
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

-- De B-6-kolom blijft bewust staan: hij draagt mogelijk markeringen die het
-- bestuur heeft gezet. Verwijderen kan handmatig na controle:
--   alter table public.documenten drop column if exists ai_ondersteund_voorbereid;

commit;
