-- ============================================================================
--  ROLLBACK voor Migratie 2026-07-09 (T6 — Beheerkenmerken generieke
--  contentlaag + namespace-invariant).
--
--  ⚠ GEBRUIK ALLEEN ALS DE ORIGINELE MIGRATIE PROBLEMEN GEEFT EN JE TERUG WILT
--  NAAR DE STAAT VAN VÓÓR DE MIGRATIE.
--
--  Effect:
--   • De namespace-CHECK (documenten_generiek_namespace_check) wordt verwijderd.
--   • De drie beheerkolommen (eigenaar, volgende_review, versie) worden gedropt
--     — eventueel ingevulde waarden gaan verloren.
--   • Raakt GEEN andere kolom, RLS-policy of de retrieval-RPC's (die zijn door
--     T6 niet gewijzigd).
--
--  Idempotent: meermaals draaien is veilig (alles "if exists").
--
--  Voor: Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

-- ── 1. Namespace-CHECK verwijderen ──────────────────────────────────────────
alter table if exists public.documenten
  drop constraint if exists documenten_generiek_namespace_check;

-- ── 2. Beheerkolommen verwijderen ───────────────────────────────────────────
alter table if exists public.documenten
  drop column if exists versie,
  drop column if exists volgende_review,
  drop column if exists eigenaar;
