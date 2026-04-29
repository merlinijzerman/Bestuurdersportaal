-- ============================================================
--  Migratie 2026-04-29
--  1) Hernoem fonds 'Pensioenfonds Metaal & Techniek' → 'Stichting Pensioenfonds Horizon'
--     (en slug 'pmt' → 'horizon')
--  2) Vervang agendapunt-categorie 'discussie' → 'oordeelsvorming'
--     (CHECK-constraint en bestaande rijen)
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent: opnieuw draaien is veilig.
-- ============================================================

-- ── 1. Fondsnaam en slug bijwerken ─────────────────────────
update public.fondsen
   set naam = 'Stichting Pensioenfonds Horizon',
       slug = 'horizon'
 where slug = 'pmt'
    or naam = 'Pensioenfonds Metaal & Techniek';

-- ── 2. Categorie 'discussie' → 'oordeelsvorming' ───────────

-- 2a. Bestaande rijen omzetten (moet vóór de constraint-wissel,
--     anders blokkeert de oude check óf de nieuwe check de UPDATE).
update public.agendapunten
   set categorie = 'oordeelsvorming'
 where categorie = 'discussie';

-- 2b. Oude CHECK-constraint droppen (naam wordt automatisch toegekend
--     door Postgres, meestal `agendapunten_categorie_check`).
do $$
declare
  c_name text;
begin
  select conname into c_name
    from pg_constraint
   where conrelid = 'public.agendapunten'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) ilike '%categorie%';

  if c_name is not null then
    execute format('alter table public.agendapunten drop constraint %I', c_name);
  end if;
end$$;

-- 2c. Nieuwe CHECK-constraint toevoegen
alter table public.agendapunten
  add constraint agendapunten_categorie_check
  check (categorie in ('beeldvorming','oordeelsvorming','besluitvorming','informatie'));
