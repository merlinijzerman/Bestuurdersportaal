-- P3 / PR-B (#168) — verplicht/blokkerend → afgeleide (generated) leeskolommen.
-- ---------------------------------------------------------------------------
-- Het RISICOVOLSTE stukje van de tranche: drop-and-re-add van twee kolommen op
-- twee tabellen. Bewust een EIGEN migratie met een EIGEN rollback (besluit 0192).
--
-- Na p3b_01 is `zwaarte` de bron van waarheid. `verplicht`/`blokkerend` worden
-- `generated always as (…) stored` uit `zwaarte` — niet trigger-onderhouden, zodat
-- ze niet kunnen driften. De leescode blijft ze lezen (dezelfde waarden). De
-- schrijfkant (de instantie-route en de seeds) gaat in dezelfde PR over op zwaarte,
-- want een generated kolom is niet schrijfbaar.
--
-- Mapping (exact bijectief, de onzin-combo is in p3b_01 uitgesloten):
--   verplicht  = (zwaarte <> 'optioneel')
--   blokkerend = (zwaarte  = 'kritiek')
-- De rollback zet ze terug als gewone booleans mét exact dezelfde waarden en de
-- oorspronkelijke default/nullability.

begin;

-- ── procedure_requirements ────────────────────────────────────────────────
alter table public.procedure_requirements drop column verplicht;
alter table public.procedure_requirements drop column blokkerend;
alter table public.procedure_requirements
  add column verplicht  boolean generated always as (zwaarte <> 'optioneel') stored,
  add column blokkerend boolean generated always as (zwaarte  = 'kritiek')  stored;

-- ── procedure_requirement_instance ────────────────────────────────────────
alter table public.procedure_requirement_instance drop column verplicht;
alter table public.procedure_requirement_instance drop column blokkerend;
alter table public.procedure_requirement_instance
  add column verplicht  boolean generated always as (zwaarte <> 'optioneel') stored,
  add column blokkerend boolean generated always as (zwaarte  = 'kritiek')  stored;

commit;
