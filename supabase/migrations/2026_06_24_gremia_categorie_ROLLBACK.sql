-- ============================================================================
-- ROLLBACK 2026-06-24 — Gremia categorie-indeling.
-- ----------------------------------------------------------------------------
-- LET OP: dit verwijdert uitsluitend de categorie-KOLOM en bijbehorende
-- constraint/index. De template-RESET (stap 2-5 van de forward-migratie) is
-- NIET automatisch terug te draaien zonder dataverlies: bijgewerkte
-- omschrijvingen/types en (de)activaties zijn destructief t.o.v. de vorige
-- seed. Voor een volledige terugkeer naar de oude templateset: herstel uit
-- back-up of draai de oorspronkelijke seed (2026_06_18_catalogus_organen.sql,
-- §7) opnieuw en deactiveer de hier toegevoegde nieuwe templates handmatig.
--
-- Deze rollback maakt de code-deploy in elk geval veilig terugdraaibaar: na het
-- droppen van de kolom werkt de oude code weer (die categorie niet kent).
-- ============================================================================

drop index if exists public.idx_gremia_categorie;

alter table public.gremia
  drop constraint if exists gremia_categorie_check;

alter table public.gremia
  drop column if exists categorie;
