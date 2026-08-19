-- ROLLBACK migratie 2026-07-08 tenant_domains.
-- Omgekeerde volgorde: index → tabel. RLS + (afwezige) policies verdwijnen met
-- de tabel. De pgcrypto-extensie blijft staan (gedeeld gebruik).
drop index if exists public.tenant_domains_host_idx;
drop table if exists public.tenant_domains;
