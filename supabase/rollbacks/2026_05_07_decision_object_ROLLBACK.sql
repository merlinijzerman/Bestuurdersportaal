-- ============================================================
--  ROLLBACK voor Migratie 2026-05-07 (Decision Object MVP-1A v2.1)
--
--  ⚠ GEBRUIK ALLEEN ALS DE ORIGINELE MIGRATIE PROBLEMEN GEEFT
--  EN JE WILT TERUG NAAR DE STAAT VAN VÓÓR DE MIGRATIE.
--
--  Effect:
--   • Alle nieuwe tabellen worden gedropt (data gaat verloren!)
--   • Alle nieuwe functies en triggers worden verwijderd
--   • De toegevoegde kolom procedures.decision_id wordt gedropt
--   • De decision_seq sequence wordt verwijderd
--   • Bestaande procedures/procedure_stappen/etc. blijven onaangetast
--
--  Idempotent: meermaals draaien is veilig (alles "if exists").
--
--  Voor: Supabase Dashboard → SQL Editor → Run.
-- ============================================================

-- ── 1. Triggers eerst (verwijzen naar functies en tabellen) ──
drop trigger if exists trg_decision_snapshot      on public.decision_objects;
drop trigger if exists trg_decision_status_check  on public.decision_objects;
drop trigger if exists trg_decision_touch         on public.decision_objects;
drop trigger if exists trg_decision_code          on public.decision_objects;
drop trigger if exists trg_govevent_no_update     on public.governance_events;
drop trigger if exists trg_govevent_no_delete     on public.governance_events;
drop trigger if exists trg_govevent_hash          on public.governance_events;
drop trigger if exists trg_snap_no_update         on public.decision_audit_snapshots;
drop trigger if exists trg_snap_no_delete         on public.decision_audit_snapshots;

-- ── 2. RLS-policies droppen ─────────────────────────────────
drop policy if exists "fonds decision_objects"             on public.decision_objects;
drop policy if exists "fonds decision_assumptions"         on public.decision_assumptions;
drop policy if exists "fonds decision_risks"               on public.decision_risks;
drop policy if exists "fonds decision_dissent"             on public.decision_dissent;
drop policy if exists "fonds decision_conditions"          on public.decision_conditions;
drop policy if exists "fonds decision_actions"             on public.decision_actions;
drop policy if exists "fonds decision_evaluations"         on public.decision_evaluations;
drop policy if exists "fonds decision_ai_interactions"     on public.decision_ai_interactions;
drop policy if exists "fonds governance_events"            on public.governance_events;
drop policy if exists "fonds decision_audit_snapshots"     on public.decision_audit_snapshots;
drop policy if exists "dissent zichtbaarheid select"       on public.decision_dissent;
drop policy if exists "dissent zichtbaarheid write"        on public.decision_dissent;
drop policy if exists "ai validatie domein"               on public.decision_ai_interactions;
drop policy if exists "req read all"                       on public.procedure_requirements;
drop policy if exists "req write beheerder"                on public.procedure_requirements;

-- ── 3. Constraints droppen die we expliciet hebben aangemaakt ──
alter table if exists public.decision_dissent
  drop constraint if exists decision_dissent_voorwaarde_fk;

-- ── 4. Tabellen droppen in juiste FK-volgorde ───────────────
-- (children eerst; cascade vangt eventueel de rest)
drop table if exists public.decision_audit_snapshots cascade;
drop table if exists public.governance_events        cascade;
drop table if exists public.decision_ai_interactions cascade;
drop table if exists public.decision_evaluations     cascade;
drop table if exists public.decision_actions         cascade;
drop table if exists public.decision_dissent         cascade;
drop table if exists public.decision_conditions      cascade;
drop table if exists public.decision_risks           cascade;
drop table if exists public.decision_assumptions     cascade;
drop table if exists public.procedure_requirements   cascade;
drop table if exists public.decision_objects         cascade;

-- ── 5. Toegevoegde kolom op bestaande tabel verwijderen ─────
alter table if exists public.procedures
  drop column if exists decision_id;

-- ── 6. Functies verwijderen ─────────────────────────────────
drop function if exists public.fn_decision_snapshot()                       cascade;
drop function if exists public.fn_decision_readiness_overview(uuid)         cascade;
drop function if exists public.fn_decision_readiness_check(uuid, text)      cascade;
drop function if exists public.fn_build_decision_dossier(uuid)              cascade;
drop function if exists public.fn_decision_status_check()                   cascade;
drop function if exists public.fn_govevent_hash()                           cascade;
drop function if exists public.fn_govevent_immutable()                      cascade;
drop function if exists public.fn_snapshot_immutable()                      cascade;
drop function if exists public.fn_decision_touch()                          cascade;
drop function if exists public.fn_decision_code()                           cascade;

-- ── 7. Sequence verwijderen ─────────────────────────────────
drop sequence if exists public.decision_seq;

-- ============================================================
--  Einde rollback. De database staat nu weer in de pre-2026-05-07 staat.
--  pgcrypto-extensie laten we staan (kan elders gebruikt worden;
--  los te droppen met `drop extension pgcrypto;` indien gewenst).
-- ============================================================
