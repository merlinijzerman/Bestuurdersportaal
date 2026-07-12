-- ============================================================================
-- Migratie 2026-07-12 — D1b: assurance-routes van de service-role af.
-- ----------------------------------------------------------------------------
-- Laatste gedeelde-surface-consument van de service-role (werkopdracht C1,
-- Fase B criterium 2). De twee TENANT-facing aqlab-routes
--   GET /api/aqlab/assurance                       (de assurance-view)
--   GET /api/aqlab/assurance/audit/[exportId]       (read-only auditrapport)
-- lazen tot nu toe de deny-by-default aqlab_-tabellen via de service-role. Deze
-- migratie geeft de sessie-client (anon-key + JWT, rol `authenticated`) precies
-- de curatie-grens terug via SECURITY DEFINER-RPC's + één storage-policy.
-- Herzien na de RLS/storage-review (B1/K1/O1/O2/O3).
--
--   1. aqlab_assurance_meetwaarden(p_codes[]) — per feature de GECUREERDE,
--        geaggregeerde meetwaarden (status/controle/kritiek + de afgeleide
--        tellingen/ratio's). De curatie gebeurt IN SQL: het rauwe aggregatie-blob
--        (performance/kosten/vrije tekst) verlaat de DB niet; alleen de velden die
--        AssuranceMeetwaarden nodig heeft. TS is een dunne mapper.
--   2. aqlab_audit_export_bron(p_export_id) — feature-code + opslag_ref van een
--        VRIJGEGEVEN export (embargo-exports geven null → geen pad-/feature-lek).
--        TS toetst "gebruikt dit fonds die feature" via het manifest.
--   3. aqlab_log_download(p_export_id) — append-only downloadspoor (sessie-actor),
--        alleen voor een vrijgegeven export. Insert-only.
--   + storage-policy op bucket aqlab-audit: `authenticated` mag een object lezen
--     MITS het bij een vrijgegeven export hoort → de sessie-client streamt direct.
--
-- Het fonds-manifest wordt NIET via een RPC ontsloten: fonds_module_manifest
-- heeft al een RLS-SELECT-policy voor het sessie-fonds (2026_07_09_t8), dus de
-- sessie-client leest het rechtstreeks (least-privilege, O1).
--
-- ISOLATIE/EXPOSURE (bewust): aqlab-data is PRODUCTBREED (geen fonds_id, geen
-- tenant-data; fixtures synthetisch). Fonds-scoping die WEL isolatie raakt (het
-- manifest) komt uit de sessie via RLS/auth.uid(). De RPC's ontsluiten voor
-- `authenticated` uitsluitend geaggregeerde, gecureerde product-QA-metadata;
-- ruwe output/prompt/context (aqlab_run_outputs) én het rauwe aggregatie-blob
-- blijven dicht. RLS op de tabellen blijft deny-by-default. search_path gepind.
--
-- BEWUSTE KEUZE (K2): de storage-policy + RPC's laten élke ingelogde bestuurder
-- élk VRIJGEGEVEN (productbreed) rapport lezen, ook van een feature die het eigen
-- fonds niet gebruikt. Dat is geen tenant-lek (rapporten zijn identiek voor elk
-- fonds); de route houdt de fonds-gebruikt-feature-check als relevantie-/defense-
-- in-depth-poort. Mocht een rapport ooit feature-gevoelig worden dat NIET over
-- fondsen mag, dan moet deze policy fonds-scoped worden.
--
-- Conventies: idempotent (drop function/policy if exists + create); ROLLBACK
-- apart; migratie-eerst-dan-deploy (standalone veilig — de code-switch volgt).
-- ============================================================================

begin;

-- ── 1. Gecureerde assurance-meetwaarden per feature-code (curatie IN SQL) ────
drop function if exists public.aqlab_assurance_meetwaarden(text[]);
create function public.aqlab_assurance_meetwaarden(p_codes text[])
returns table (
  feature_code                text,
  release_status              text,
  laatste_controle            timestamptz,
  kritieke_bevindingen        integer,
  aantal_functioneel          integer,
  aantal_blokkerend           integer,
  openstaande_review          integer,
  regressie_status            text,
  brongebondenheid_ratio      numeric,
  format_compliance_ratio     numeric,
  vrijgegeven_audit_export_id uuid,
  inhoud_hash                 text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with feat as (
    select c.code, f.id as feature_id
    from unnest(p_codes) as c(code)
    join public.aqlab_ai_features f on f.code = c.code
  ),
  lb as (  -- laatste besluitregel per feature (ongeacht status)
    select ft.code, ft.feature_id,
           d.release_status, d.besluit_op, d.aangemaakt_op,
           d.kritieke_bevindingen_count, d.run_id
    from feat ft
    left join lateral (
      select d.release_status, d.besluit_op, d.aangemaakt_op,
             d.kritieke_bevindingen_count, d.run_id
      from public.aqlab_release_decisions d
      where d.feature_id = ft.feature_id
      order by d.aangemaakt_op desc
      limit 1
    ) d on true
  ),
  vg as (  -- laatst-vrijgegeven besluitregel per feature (downloadbaar rapport)
    select ft.feature_id, d.audit_export_id
    from feat ft
    left join lateral (
      select d.audit_export_id
      from public.aqlab_release_decisions d
      where d.feature_id = ft.feature_id and d.release_status = 'vrijgegeven'
      order by d.aangemaakt_op desc
      limit 1
    ) d on true
  )
  select
    lb.code,
    lb.release_status,
    coalesce(lb.besluit_op, lb.aangemaakt_op),
    coalesce(lb.kritieke_bevindingen_count, 0),
    -- per_testcase-tellingen: null als per_testcase ontbreekt (matcht de TS).
    case when jsonb_typeof(r.aggregatie->'regressie'->'per_testcase') = 'array'
      then (select count(*)::int from jsonb_array_elements(r.aggregatie->'regressie'->'per_testcase') e
            where e->>'soort' = 'functioneel')
      else null end,
    case when jsonb_typeof(r.aggregatie->'regressie'->'per_testcase') = 'array'
      then (select count(*)::int from jsonb_array_elements(r.aggregatie->'regressie'->'per_testcase') e
            where e->>'soort' = 'security_blocking')
      else null end,
    coalesce((r.aggregatie->'regressie'->'tellingen'->>'openstaande_reviews')::int, 0),
    case
      when r.aggregatie->'regressie'->'tellingen' is null then null
      when coalesce((r.aggregatie->'regressie'->'tellingen'->>'regressies')::int, 0) > 0
        or coalesce((r.aggregatie->'regressie'->'tellingen'->>'nieuwe_blokkades')::int, 0) > 0 then 'regressie'
      when coalesce((r.aggregatie->'regressie'->'tellingen'->>'verbeteringen')::int, 0) > 0 then 'verbeterd'
      else 'gelijk'
    end,
    case when jsonb_typeof(r.aggregatie->'consistency') = 'object'
      then (select avg((v->>'source_correctness_rate')::numeric)
            from jsonb_each(r.aggregatie->'consistency') as x(k, v)
            where jsonb_typeof(v) = 'object' and (v->>'source_correctness_rate') ~ '^-?[0-9.]+$')
      else null end,
    case when jsonb_typeof(r.aggregatie->'consistency') = 'object'
      then (select avg((v->>'format_pass_rate')::numeric)
            from jsonb_each(r.aggregatie->'consistency') as x(k, v)
            where jsonb_typeof(v) = 'object' and (v->>'format_pass_rate') ~ '^-?[0-9.]+$')
      else null end,
    vg.audit_export_id,
    ae.inhoud_hash
  from lb
  left join public.aqlab_runs r on r.id = lb.run_id
  left join vg on vg.feature_id = lb.feature_id
  left join public.aqlab_audit_exports ae on ae.id = vg.audit_export_id;
$$;

comment on function public.aqlab_assurance_meetwaarden(text[]) is
  'D1b: gecureerde, geaggregeerde assurance-meetwaarden per feature-code (curatie in SQL; het rauwe aggregatie-blob verlaat de DB niet). Productbreed.';

-- ── 2. Autorisatie-bron voor de fonds-download van een VRIJGEGEVEN rapport ───
-- Embargo-exports (niet-vrijgegeven) geven feature_code + opslag_ref = null →
-- geen pad-/feature-lek (K1).
drop function if exists public.aqlab_audit_export_bron(uuid);
create function public.aqlab_audit_export_bron(p_export_id uuid)
returns table (feature_code text, opslag_ref text, is_vrijgegeven boolean)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    case when v.is_vrijgegeven then f.code else null end,
    case when v.is_vrijgegeven
      then coalesce(ae.opslag_ref, ae.run_id::text || '/' || ae.id::text || '.html')
      else null end,
    v.is_vrijgegeven
  from public.aqlab_audit_exports ae
  left join public.aqlab_ai_features f on f.id = ae.feature_id
  cross join lateral (
    select exists (
      select 1 from public.aqlab_release_decisions d
      where d.audit_export_id = ae.id and d.release_status = 'vrijgegeven'
    ) as is_vrijgegeven
  ) v
  where ae.id = p_export_id;
$$;

comment on function public.aqlab_audit_export_bron(uuid) is
  'D1b: feature-code + opslag_ref van een VRIJGEGEVEN auditexport (embargo → null). TS toetst fonds-gebruikt-feature via het manifest.';

-- ── 3. Append-only downloadspoor (sessie-actor), alleen voor vrijgegeven ─────
drop function if exists public.aqlab_log_download(uuid);
create function public.aqlab_log_download(p_export_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.aqlab_log (gebruiker_id, actie, object_type, object_id, nieuwe_waarde)
  select
    auth.uid(),
    'audit_export_gedownload_fonds',
    'aqlab_audit_exports',
    p_export_id,
    jsonb_build_object('fonds_id', (select p.fonds_id from public.profielen p where p.id = auth.uid()))
  where exists (
    select 1 from public.aqlab_release_decisions d
    where d.audit_export_id = p_export_id and d.release_status = 'vrijgegeven'
  );
$$;

comment on function public.aqlab_log_download(uuid) is
  'D1b: append-only downloadspoor in aqlab_log (sessie-actor), alleen voor een vrijgegeven export. Insert-only; append-only-trigger blijft gelden.';

-- ── Grants: alleen authenticated (ingelogde bestuurders); nooit anon ────────
revoke all on function public.aqlab_assurance_meetwaarden(text[]) from public;
revoke all on function public.aqlab_audit_export_bron(uuid)       from public;
revoke all on function public.aqlab_log_download(uuid)            from public;

grant execute on function public.aqlab_assurance_meetwaarden(text[]) to authenticated;
grant execute on function public.aqlab_audit_export_bron(uuid)       to authenticated;
grant execute on function public.aqlab_log_download(uuid)            to authenticated;

-- ── Storage-policy: authenticated mag een VRIJGEGEVEN auditrapport lezen ────
-- De aqlab-audit-bucket is deny-by-default (aqlab_5 verwijderde alle policies).
-- Alleen vrijgegeven exports zijn leesbaar; zie de K2-notitie bovenaan.
drop policy if exists "aqlab-audit fonds-download vrijgegeven" on storage.objects;
create policy "aqlab-audit fonds-download vrijgegeven"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'aqlab-audit'
  and exists (
    select 1
    from public.aqlab_audit_exports ae
    join public.aqlab_release_decisions rd on rd.audit_export_id = ae.id
    where rd.release_status = 'vrijgegeven'
      and coalesce(ae.opslag_ref, ae.run_id::text || '/' || ae.id::text || '.html') = storage.objects.name
  )
);

commit;
