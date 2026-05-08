-- ============================================================
--  Migratie 2026-05-08 — Decision Object MVP-1D
--  Schema-uitbreiding op `procedure_bewijs`:
--    • documenttype  text  (nullable)
--      → tag die overeenkomt met procedure_requirements.documenttype.
--        Vervangt fragiele titel-string-matching in
--        lib/decision.ts:buildEvidenceLijst voor de readiness-check
--        op `requirement_type='document'`.
--
--  Idempotent: kolom wordt toegevoegd met IF NOT EXISTS.
--  Geen RLS-wijzigingen: bestaande policies dekken de nieuwe kolom.
-- ============================================================

begin;

alter table public.procedure_bewijs
  add column if not exists documenttype text;

create index if not exists idx_procbewijs_documenttype
  on public.procedure_bewijs(documenttype)
 where documenttype is not null;

commit;

-- ============================================================
--  Verificatie:
--    select stap_id, titel, documenttype, document_id
--      from public.procedure_bewijs
--     order by toegevoegd_op desc
--     limit 10;
-- ============================================================
