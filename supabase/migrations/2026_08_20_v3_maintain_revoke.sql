-- ============================================================================
-- Migratie 2026-08-20 (V3) — MAINTAIN intrekken bij de browserrollen in public
-- ----------------------------------------------------------------------------
-- WAAROM. Dezelfde Supabase-default-ACL die C-01 veroorzaakte kent óók MAINTAIN
-- toe aan `anon` en `authenticated` op ELK object in `public`:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO authenticated;
--   (en een vergelijkbare regel richting anon voor SELECT/MAINTAIN)
--
-- Gemeten op de databasestand: `anon` had MAINTAIN op 118 van 123 relaties,
-- `authenticated` op 120. MAINTAIN (Postgres 17) dekt VACUUM, ANALYZE, CLUSTER,
-- REINDEX, REFRESH MATERIALIZED VIEW en LOCK TABLE. Geen datapad, maar ook
-- nergens nodig voor een browserrol — en precies de "kader groeit langs reeds
-- gemaakte fouten"-blinde vlek die V3 sluit. De C-01-migratie heeft deze
-- opruiming expliciet naar V3 doorgeschoven ("MAINTAIN … wegnemen hoort bij V3").
--
-- WAT DEZE MIGRATIE DOET.
--  1. Trekt MAINTAIN in op alle bestaande relaties in `public` voor anon +
--     authenticated (tabellen, views, foreign/partitioned tables).
--  2. Corrigeert de default-ACL zodat TOEKOMSTIGE objecten in `public` geen
--     MAINTAIN meer aan die rollen toekennen. Zonder stap 2 keert de drift terug
--     bij het volgende nieuwe object (exact het H-18/C-01-mechanisme).
--
-- SCOPE. Alleen `public` en alleen anon + authenticated. `service_role` (de
-- vertrouwde backend-rol, net als bij gate F) behoudt MAINTAIN. `storage` is
-- Supabase-beheerd en blijft ongemoeid; de V3-grants-gate allowlist die stand
-- expliciet als platform-beheerd.
--
-- Idempotent en transactioneel: `revoke` van een niet-bestaand recht is een
-- no-op, dus herhaald toepassen is veilig. Eindtoestand of niets.
-- ============================================================================

begin;

-- ── 1. Bestaande objecten: MAINTAIN intrekken bij de browserrollen ──────────
-- `ON ALL TABLES IN SCHEMA` dekt relkinds r/v/f/p (tabellen, views, foreign,
-- partitioned). In `public` bestaan geen materialized views; komt er ooit een,
-- dan vangt de V3-gate hem als onbekend object.
revoke maintain on all tables in schema public from anon, authenticated;

-- ── 2. Default-ACL corrigeren voor toekomstige objecten ─────────────────────
-- De grant komt uit een ALTER DEFAULT PRIVILEGES FOR ROLE postgres; de correctie
-- moet dezelfde grantor (postgres) noemen, anders raakt ze de bestaande ACL-entry
-- niet.
alter default privileges for role postgres in schema public
  revoke maintain on tables from anon, authenticated;

-- ── Verificatie in dezelfde transactie: eindtoestand of niets ──────────────
do $$
declare
  n_anon int;
  n_auth int;
begin
  select count(*) into n_anon
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind in ('r','v','m','p','f')
     and has_table_privilege('anon', c.oid, 'MAINTAIN');

  select count(*) into n_auth
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind in ('r','v','m','p','f')
     and has_table_privilege('authenticated', c.oid, 'MAINTAIN');

  if n_anon <> 0 or n_auth <> 0 then
    raise exception 'V3-MAINTAIN FAALT: anon houdt MAINTAIN op % relatie(s), authenticated op % — revoke onvolledig.', n_anon, n_auth;
  end if;
  raise notice 'V3-MAINTAIN OK: anon en authenticated hebben nergens in public nog MAINTAIN.';
end $$;

commit;
