-- Rollback van 2026_08_24_profielen_rol_not_null.sql
-- Heft de NOT NULL-constraint op profielen.rol op. De DEFAULT 'bestuurder' en
-- de CHECK-constraint blijven ongemoeid.
begin;
alter table public.profielen alter column rol drop not null;
commit;
