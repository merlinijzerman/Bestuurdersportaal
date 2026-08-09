-- ============================================================================
--  ROLLBACK van 2026_08_07_vergadering_archiveren.sql (besluit 0145)
-- ----------------------------------------------------------------------------
--  LET OP — dataverlies. Het droppen van `gearchiveerd_op`/`gearchiveerd_door`
--  wist wélke vergaderingen gearchiveerd waren en door wie. Die informatie is
--  daarna niet te reconstrueren uit de vergaderingenrij zelf; alleen de
--  auditregels in vergadering_log blijven bestaan (die worden hier NIET
--  verwijderd — het log is append-only en blijft leidend).
--
--  Draai dit alleen als de code-deploy is teruggedraaid. Een oude frontend die
--  nog `gearchiveerd_op` selecteert, faalt zodra de kolom weg is.
-- ============================================================================

-- ── 1. Eventtypes terug naar de oorspronkelijke enkelvoudige CHECK ──────────
-- Bestaan er al archiveer-events, dan faalt deze constraint. Ruim ze in dat
-- geval eerst bewust op of laat de bredere CHECK staan; stilzwijgend verwijderen
-- van auditregels is geen optie (append-only).
do $$
begin
  alter table public.vergadering_log drop constraint if exists vergadering_log_event_type_check;
  alter table public.vergadering_log add  constraint vergadering_log_event_type_check
    check (event_type in ('vergadering_gewijzigd'));
end $$;

-- ── 2. Index en kolommen ────────────────────────────────────────────────────
drop index if exists public.idx_verg_fonds_actief;

alter table public.vergaderingen drop column if exists gearchiveerd_door;
alter table public.vergaderingen drop column if exists gearchiveerd_op;
