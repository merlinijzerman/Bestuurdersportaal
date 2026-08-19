-- ============================================================================
-- ROLLBACK van 2026_08_04_a3_governance_log_contract.sql
-- ----------------------------------------------------------------------------
-- ⚠ DEZE ROLLBACK HERSTELT DE KOLOMMEN **LEEG**, NIET HUN INHOUD.
--
-- `drop column` vernietigt de data. Wat hier terugkomt is de STRUCTUUR:
-- `vraag`, `antwoord` en `bronnen` bestaan weer, met NULL respectievelijk de
-- default. De oorspronkelijke tekst is alleen terug te halen uit:
--
--   • de geverifieerde kopie die gate-eis 3 vóór A3 verplicht stelde, of
--   • public.governance_log_inhoud — die is door A3 niet geraakt en bevat de
--     inhoud nog steeds. Dit is in de praktijk de bruikbare route:
--
--       update public.governance_log gl
--          set vraag    = i.vraag,
--              antwoord = i.antwoord,
--              bronnen  = i.bronnen
--         from public.governance_log_inhoud i
--        where i.log_id = gl.id;
--
--     ⚠ Dat is een UPDATE op een append-only tabel en wordt geblokkeerd door
--     trg_governance_log_no_update. Zet de trigger daarvoor tijdelijk uit
--     (`alter table public.governance_log disable trigger
--       trg_governance_log_no_update;` … en daarna weer `enable`), leg de
--     handeling vast in public.governance_redacties met
--     aanleiding = 'beheerinterventie' en een motivering, en doe dit uitsluitend
--     als databank-eigenaar in een gepland venster.
--
-- `vraag` komt bewust NULLABLE terug: rijen die onder code v1 zijn geschreven
-- hebben nooit een waarde in deze kolom gehad, en NOT NULL zou de rollback
-- laten falen op precies de rijen die het probleem niet zijn.
-- ============================================================================

begin;

alter table public.governance_log
  add column if not exists vraag    text,
  add column if not exists antwoord text,
  add column if not exists bronnen  jsonb default '[]'::jsonb;

comment on table public.governance_log is
  'Append-only auditspoor van AI-interacties. LET OP: de kolommen vraag/'
  'antwoord/bronnen zijn door een rollback van A3 hersteld en zijn LEEG — de '
  'inhoud staat in public.governance_log_inhoud.';

commit;
