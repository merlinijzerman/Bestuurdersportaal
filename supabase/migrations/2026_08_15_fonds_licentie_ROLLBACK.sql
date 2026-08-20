-- ============================================================================
--  ROLLBACK 2026-08-15 — fonds_licentie
--
--  Verwijdert de tabel public.fonds_licentie en alle licentierijen. Raakt GEEN
--  bestaande tabel, policy, trigger of grant: fonds_licentie is een op zichzelf
--  staande, deny-by-default configuratietabel.
--
--  VOLGORDE: rol EERST de code terug (of zet de weergave uit), DAN deze migratie.
--  Anders faalt de leeslaag (verbruik-bundel-lees.ts) op een ontbrekende tabel.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

drop table if exists public.fonds_licentie;

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'fonds_licentie'
  ) then
    raise exception 'ROLLBACK FAALT: fonds_licentie bestaat nog';
  end if;
  raise notice 'ROLLBACK OK: fonds_licentie verwijderd.';
end $$;

commit;
