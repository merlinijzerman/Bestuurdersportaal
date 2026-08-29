-- P4 tranche 8 (#169, besluit 0194 F) — I5-extensie: composite-FK's zodat een
-- gerefereerd object tot HETZELFDE fonds hoort. Vorm = de govevent-tenantketen
-- (0192 §2e): `(bron_id, fonds_id)` → `(id, fonds_id)` van het doel, met een unieke
-- index op het doel. Declaratief, dekt óók service_role, en kan niet stilvallen
-- zoals een trigger. MATCH SIMPLE: een NULL-referentie slaat de toets over.
-- ---------------------------------------------------------------------------
-- WAAR EEN COMPOSITE-FK KAN (de bron draagt fonds_id):
--   • procedure_requirement_instance   (decision_id, fonds_id) → decision_objects
--   • procedure_requirement_uitsluiting (decision_id, fonds_id) → decision_objects
--   • procedure_vaststelling            (procedure_id, fonds_id) → procedures
-- WAAR NIET (bron draagt géén fonds_id) → routecheck-terugval, expliciet:
--   • decision_risks/assumptions/conditions/actions/evaluations/ai_interactions/
--     dissent: erven fonds via decision_id; I5 leunt op de fonds-RLS + de
--     bewijsbinding-validatie. Een eigen fonds_id + composite-FK is een latere,
--     bredere schemastap (#214-familie), geen P4-scope.
--   • procedure_besluiten: erft fonds via procedure_id → procedures.fonds_id (RLS-keten).
--
-- decision_objects draagt al `unique (id, fonds_id)` (decision_objects_id_fonds_uniek,
-- govevent_tenantketen). procedures krijgt hier de tegenhanger.
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_29_p4_08_i5_composite_fk_ROLLBACK.sql

begin;

-- ── FK-doel: uniek (id, fonds_id) op procedures ────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'procedures_id_fonds_uniek') then
    alter table public.procedures add constraint procedures_id_fonds_uniek unique (id, fonds_id);
  end if;
end $$;

-- ── Composite-FK's (idempotent) ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pri_decision_zelfde_fonds') then
    alter table public.procedure_requirement_instance
      add constraint pri_decision_zelfde_fonds
      foreign key (decision_id, fonds_id) references public.decision_objects (id, fonds_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pru_decision_zelfde_fonds') then
    alter table public.procedure_requirement_uitsluiting
      add constraint pru_decision_zelfde_fonds
      foreign key (decision_id, fonds_id) references public.decision_objects (id, fonds_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_procedure_zelfde_fonds') then
    alter table public.procedure_vaststelling
      add constraint pv_procedure_zelfde_fonds
      foreign key (procedure_id, fonds_id) references public.procedures (id, fonds_id);
  end if;
end $$;

commit;
