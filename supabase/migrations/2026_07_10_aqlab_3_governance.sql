-- ============================================================================
-- Migratie 2026-07-10 (AQLab-3 / governance) — release, audit-export, append-only log
-- ----------------------------------------------------------------------------
-- WAAROM:
--   Derde en laatste fundament-migratie van AQL-1. Legt de governance-laag vast:
--   het vrijgavebesluit (bron van waarheid voor release), het onveranderlijke
--   auditdossier, en het append-only auditspoor aqlab_log — analoog aan
--   fonds_config_log (ADR 0051) met de bestaande fn_log_append_only-borging.
--
--   BESLISREGEL (hard, DB + service): een kritieke bevinding blokkeert vrijgave.
--   kritieke_bevindingen_count > 0  ⇒  besluit ≠ 'vrijgegeven' EN
--   release_advies ≠ 'accepteren'. Afgedwongen als CHECK-constraint (§2.13).
--
--   APPEND-ONLY: aqlab_log, aqlab_release_decisions en aqlab_audit_exports
--   worden nooit ge-UPDATE/-DELETE; de bestaande fn_log_append_only-trigger
--   blokkeert dit op DB-niveau. Een statuswijziging is een NIEUWE regel.
--
-- AUTORISATIE/RLS: deny-by-default, service-role via platform-wrapper
--   (decision 0058). Provider-globaal, geen fonds_id in MVP. De read-only
--   fonds-assurance (AQL-4) loopt via een gecureerd server-side endpoint, niet
--   via een tabel-policy.
--
-- Idempotent (create table if not exists / create or replace / drop ... if exists).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy.
-- ROLLBACK: 2026_07_10_aqlab_3_governance_ROLLBACK.sql
-- VOLGORDE: draait NA aqlab_1 en aqlab_2 (verwijst naar runs/features/prompt/model).
-- TENANT-IMPACT: geen (provider-globaal, geen fonds_id).
-- ============================================================================

begin;

-- ── 0. Append-only-borging: hergebruik de bestaande functie (create or replace
--       = idempotent en zelfstandig draaibaar), conform het t8-patroon. ───────
create or replace function public.fn_log_append_only()
returns trigger language plpgsql as $f$
begin
  raise exception '% is append-only (geen UPDATE/DELETE toegestaan)', tg_table_name;
end;
$f$;

-- ── 1. aqlab_release_decisions — bron van waarheid voor vrijgave (§2.13) ────
create table if not exists public.aqlab_release_decisions (
  id                        uuid primary key default uuid_generate_v4(),
  run_id                    uuid references public.aqlab_runs(id) on delete set null,
  feature_id                uuid references public.aqlab_ai_features(id) on delete set null,
  prompt_version_id         uuid references public.aqlab_prompt_versions(id) on delete set null,
  model_configuration_id    uuid references public.aqlab_model_configurations(id) on delete set null,
  release_status            text not null default 'concept'
                              check (release_status in
                                ('concept','getest','review_vereist','aangepast','vrijgegeven','geblokkeerd','gearchiveerd')),
  release_advies            text check (release_advies in ('accepteren','aanpassen','blokkeren')),
  besluit                   text check (besluit in ('vrijgegeven','geblokkeerd')),
  besluit_door              uuid references auth.users(id),
  besluit_op                timestamptz,
  motivatie                 text,                  -- verplicht bij afwijken van advies (service-laag)
  kritieke_bevindingen_count integer not null default 0,
  assurance_scope           text not null default 'productbreed'
                              check (assurance_scope in ('productbreed','fonds_specifiek')),
  audit_export_id           uuid,                  -- FK toegevoegd ná aqlab_audit_exports (zie punt 2)
  aangemaakt_op             timestamptz not null default now(),
  -- Beslisregel (hard): kritieke bevinding blokkeert vrijgave + accepteren.
  constraint aqlab_release_kritiek_blokkeert check (
    kritieke_bevindingen_count = 0
    or (besluit is distinct from 'vrijgegeven' and release_advies is distinct from 'accepteren')
  ),
  -- Vrijgegeven vereist een expliciet, herleidbaar besluit.
  constraint aqlab_release_vrijgegeven_volledig check (
    release_status <> 'vrijgegeven'
    or (besluit = 'vrijgegeven' and besluit_door is not null and besluit_op is not null)
  )
);
comment on table public.aqlab_release_decisions is
  'AQLab GLOBAAL, APPEND-ONLY. Bron van waarheid voor vrijgave; kritieke bevinding blokkeert (CHECK). Statuswijziging = nieuwe regel.';

-- ── 2. aqlab_audit_exports — onveranderlijk auditdossier per run/release (§2.10)
create table if not exists public.aqlab_audit_exports (
  id             uuid primary key default uuid_generate_v4(),
  run_id         uuid references public.aqlab_runs(id) on delete set null,
  feature_id     uuid references public.aqlab_ai_features(id) on delete set null,
  inhoud_hash    text not null,                    -- sha256 over het bevroren rapport
  formaat        text not null default 'html' check (formaat in ('html','pdf')),
  opslag_ref     text,
  besluit        text check (besluit in ('vrijgegeven','geblokkeerd')),
  besluit_door   uuid references auth.users(id),
  besluit_op     timestamptz,
  gegenereerd_door uuid references auth.users(id),
  gegenereerd_op timestamptz not null default now()
);
comment on table public.aqlab_audit_exports is
  'AQLab GLOBAAL, APPEND-ONLY. Bevroren auditrapport per run/release (inhoud_hash); bron van de read-only fonds-download (AQL-4).';

-- Late FK: release_decisions.audit_export_id → audit_exports.id (guarded add).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'aqlab_release_audit_export_fk'
  ) then
    alter table public.aqlab_release_decisions
      add constraint aqlab_release_audit_export_fk
      foreign key (audit_export_id) references public.aqlab_audit_exports(id) on delete set null;
  end if;
end $$;

-- ── 3. aqlab_log — append-only auditspoor van Lab-acties (§2.11) ────────────
create table if not exists public.aqlab_log (
  id             uuid primary key default uuid_generate_v4(),
  gebruiker_id   uuid references auth.users(id),
  gebruiker_naam text,
  actie          text not null,
  object_type    text,
  object_id      uuid,
  oude_waarde    jsonb,
  nieuwe_waarde  jsonb,
  aangemaakt_op  timestamptz not null default now()
);
comment on table public.aqlab_log is
  'AQLab GLOBAAL, APPEND-ONLY (fn_log_append_only). Auditspoor van Lab-acties (run/besluit/seed). Geen fonds_id (provider-acties).';

-- ── 4. RLS: aan, deny-by-default (decision 0058) ────────────────────────────
alter table public.aqlab_release_decisions enable row level security;
alter table public.aqlab_audit_exports     enable row level security;
alter table public.aqlab_log               enable row level security;

-- ── 5. Append-only-triggers op de drie onveranderlijke tabellen ─────────────
drop trigger if exists trg_aqlab_log_no_update on public.aqlab_log;
create trigger trg_aqlab_log_no_update
  before update on public.aqlab_log
  for each row execute procedure public.fn_log_append_only();
drop trigger if exists trg_aqlab_log_no_delete on public.aqlab_log;
create trigger trg_aqlab_log_no_delete
  before delete on public.aqlab_log
  for each row execute procedure public.fn_log_append_only();

drop trigger if exists trg_aqlab_release_decisions_no_update on public.aqlab_release_decisions;
create trigger trg_aqlab_release_decisions_no_update
  before update on public.aqlab_release_decisions
  for each row execute procedure public.fn_log_append_only();
drop trigger if exists trg_aqlab_release_decisions_no_delete on public.aqlab_release_decisions;
create trigger trg_aqlab_release_decisions_no_delete
  before delete on public.aqlab_release_decisions
  for each row execute procedure public.fn_log_append_only();

drop trigger if exists trg_aqlab_audit_exports_no_update on public.aqlab_audit_exports;
create trigger trg_aqlab_audit_exports_no_update
  before update on public.aqlab_audit_exports
  for each row execute procedure public.fn_log_append_only();
drop trigger if exists trg_aqlab_audit_exports_no_delete on public.aqlab_audit_exports;
create trigger trg_aqlab_audit_exports_no_delete
  before delete on public.aqlab_audit_exports
  for each row execute procedure public.fn_log_append_only();

-- ── 6. Indexen ──────────────────────────────────────────────────────────────
create index if not exists idx_aqlab_release_run     on public.aqlab_release_decisions(run_id);
create index if not exists idx_aqlab_release_feature  on public.aqlab_release_decisions(feature_id);
create index if not exists idx_aqlab_audit_run        on public.aqlab_audit_exports(run_id);
create index if not exists idx_aqlab_log_tijd         on public.aqlab_log(aangemaakt_op desc);
create index if not exists idx_aqlab_log_object       on public.aqlab_log(object_type, object_id);

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Drie append-only tabellen dragen no_update/no_delete-triggers:
--      select event_object_table, trigger_name from information_schema.triggers
--       where trigger_name like 'trg_aqlab_%_no_%' order by 1,2;
-- 2. Beslisregel afgedwongen (moet FALEN):
--      insert into public.aqlab_release_decisions
--        (kritieke_bevindingen_count, besluit, release_advies)
--        values (1,'vrijgegeven','accepteren');   -- verwacht: check-constraint-fout
-- 3. Append-only afgedwongen (moet FALEN):
--      insert into public.aqlab_log (actie) values ('seed');   -- ok
--      update public.aqlab_log set actie='x';                  -- verwacht: append-only-fout
