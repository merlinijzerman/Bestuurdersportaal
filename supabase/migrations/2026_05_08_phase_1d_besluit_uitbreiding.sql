-- ============================================================
--  Migratie 2026-05-08 — Decision Object MVP-1D
--  Schema-uitbreiding voor besluitregistratie + status-overgangen.
--
--  Wijzigingen:
--    • procedure_besluiten krijgt:
--        - decision_id              uuid → decision_objects(id)
--          Backref zodat een besluit direct aan zijn Decision Object
--          hangt voor het auditdossier (auto-snapshot trigger leest
--          procedure_besluiten via procedure_id, maar de directe FK
--          maakt joins eenvoudiger en houdt de UI snel).
--        - verworpen_alternatieven  text[]
--          Lijst van expliciet overwogen en verworpen alternatieven.
--          Eis vanuit acceptatiecriteria §11 ontwerpdoc.
--
--  Idempotent: kolommen worden toegevoegd met IF NOT EXISTS.
--  Geen RLS-wijzigingen nodig — bestaande policies op
--  procedure_besluiten dekken de nieuwe kolommen automatisch.
-- ============================================================

begin;

-- ── 1. Backref naar Decision Object ────────────────────────
alter table public.procedure_besluiten
  add column if not exists decision_id uuid
    references public.decision_objects(id) on delete set null;

create index if not exists idx_procbesluit_decision
  on public.procedure_besluiten(decision_id);

-- ── 2. Verworpen alternatieven ─────────────────────────────
alter table public.procedure_besluiten
  add column if not exists verworpen_alternatieven text[]
    default '{}'::text[];

-- ── 3. Backfill: koppel bestaande besluiten aan hun Decision
--    Object (alleen waar de procedure er al één heeft). Doet
--    niets als er nog geen Decision Objects bestaan.
update public.procedure_besluiten b
   set decision_id = p.decision_id
  from public.procedures p
 where b.procedure_id = p.id
   and b.decision_id is null
   and p.decision_id is not null;

commit;

-- ============================================================
--  Verificatie:
--    select b.id, b.procedure_id, b.decision_id,
--           array_length(b.verworpen_alternatieven, 1) as n_alternatieven
--      from public.procedure_besluiten b
--     order by b.datum desc
--     limit 10;
-- ============================================================
