-- ============================================================================
-- Migratie 2026-07-10 (AQLab-5 / assurance-release-audit) — AQL-4.
-- ----------------------------------------------------------------------------
-- WAAROM:
--   AQL-4 sluit de MVP-keten (vrijgavebesluit → assurance → audit). De doel-
--   tabellen (aqlab_release_decisions, aqlab_audit_exports) zijn al gelegd in
--   aqlab_3 (governance), inclusief de append-only triggers en de harde
--   beslisregel-CHECK. Deze migratie voegt alléén de twee ontbrekende
--   infrastructuur-stukken toe die AQL-4 nodig heeft:
--
--     1. Een PRIVATE storage-bucket 'aqlab-audit' voor het bevroren auditrapport
--        (HTML) waarvan aqlab_audit_exports.opslag_ref de referentie is.
--        Deny-by-default, GEEN policies: identiek aan de quarantaine-bucket
--        (2026_06_24_storage_quarantaine.sql). De read-only fonds-download loopt
--        server-gemedieerd via de service-role (assurance-endpoint), NIET via een
--        storage-policy — conform de aqlab_3-ontwerpcomment (deny-by-default,
--        gecureerd server-side endpoint). Er is dus bewust geen tenant-policy.
--
--     2. De platform-capability 'platform.aqlab.govern' — het FORMELE
--        vrijgavebesluit is een apart mensbesluit door de AI Governance Owner
--        (functioneel §6.2, human-in-the-loop), strikt gescheiden van
--        .operate (runs draaien) en .review (aftekenen). Spiegelt de code-union
--        in lib/platform-capabilities.ts (CI-sanity faalt bij divergentie).
--
-- GEEN nieuwe tabellen, GEEN fonds_id, GEEN service-role in client. De aqlab_-
--   tabellen blijven provider-globaal/deny-by-default. Assurance is server-
--   gemedieerd; tenant-isolatie ongewijzigd (T3-dekkingsgate blijft groen).
--
-- Idempotent (on conflict do nothing / insert-where-not-exists). Eerst in
-- Supabase draaien, DÁN code-deploy. ROLLBACK: ..._aqlab_5_assurance_ROLLBACK.sql
-- VOLGORDE: draait NA aqlab_3 (governance) en aqlab_4 (run-jobs, capability-seed).
-- TENANT-IMPACT: geen (provider-globaal, geen fonds_id).
-- ============================================================================

begin;

-- ── 1. Private storage-bucket voor bevroren auditrapporten ──────────────────
--    public=false → geen publieke URL's; toegang uitsluitend via de service-role
--    (de assurance-download-route streamt de HTML na auth+scope-controle).
insert into storage.buckets (id, name, public)
values ('aqlab-audit', 'aqlab-audit', false)
on conflict (id) do nothing;

-- Deny-by-default: bewust GEEN storage-policy op deze bucket. Zonder permissive
-- policy weigert RLS elke anon-/authenticated-rol; alleen de service-role (RLS-
-- bypass) schrijft (audit-export) en leest (server-gemedieerde fonds-download).
-- Defensief: verwijder eventueel eerder (per ongeluk) aangemaakte policies.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       -- qual (USING) is NULL voor INSERT-only policies → ook with_check checken.
       and (qual like '%aqlab-audit%' or with_check like '%aqlab-audit%')
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- ── 2. Capability-seed (spiegelt lib/platform-capabilities.ts) ──────────────
insert into public.platform_capabilities (capability, omschrijving) values
  ('platform.aqlab.govern', 'AI Quality Lab: formeel vrijgavebesluit (go/no-go) door de AI Governance Owner — human-in-the-loop, gescheiden van operate/review')
on conflict (capability) do nothing;

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Bucket private + deny-by-default (0 policies):
--      select id, public from storage.buckets where id = 'aqlab-audit';        -- public=false
--      select count(*) from pg_policies
--        where schemaname='storage' and tablename='objects' and qual like '%aqlab-audit%';  -- 0
-- 2. Govern-capability geseed:
--      select capability from public.platform_capabilities
--        where capability = 'platform.aqlab.govern';                           -- 1 rij
-- 3. Doeltabellen (uit aqlab_3) dragen nog steeds append-only-triggers:
--      select event_object_table, trigger_name from information_schema.triggers
--        where trigger_name like 'trg_aqlab_%_no_%' order by 1,2;
