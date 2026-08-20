-- ============================================================================
-- ROLLBACK voor 2026_06_18_catalogus_organen.sql
--
-- ALLEEN gebruiken om Increment A (procescatalogus + organen) volledig terug
-- te draaien. Dit verwijdert alle catalogus-/organen-/koppelrecords en de
-- procesmodel_id-koppeling op procedures. Volgorde respecteert FK-afhankelijk-
-- heden: join-tabellen → catalogus_log → procedures-kolom → catalogustabellen.
-- ============================================================================

-- 1. Join-tabellen (verwijzen naar procesmodellen + organen)
drop table if exists public.procesmodel_gremia        cascade;
drop table if exists public.procesmodel_expertises    cascade;
drop table if exists public.procesmodel_focusgebieden cascade;

-- 2. Koppellog
drop table if exists public.catalogus_log cascade;

-- 3. Koppeling op procedures (kolom + index)
drop index if exists public.idx_procedures_procesmodel;
alter table public.procedures drop column if exists procesmodel_id;

-- 4. Catalogustabellen (gremia heeft self-FK; cascade ruimt dat op)
drop table if exists public.procesmodellen            cascade;
drop table if exists public.gremia                    cascade;
drop table if exists public.expertises                cascade;
drop table if exists public.kritische_focusgebieden   cascade;
