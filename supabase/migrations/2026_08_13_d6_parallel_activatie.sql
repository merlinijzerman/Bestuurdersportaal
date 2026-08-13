-- ============================================================
--  Migratie 2026-08-13 — Proceduremodule-engine v2, D6
--  Afhankelijkheidsgestuurde, parallelle activatie + heropenen.
--
--  Voegt aan de gesnapshotte instantietabel `procedure_stappen` toe:
--   • blokkerende_afhankelijkheden int[]  — stap-volgordes die eerst
--     'afgerond' moeten zijn (leeg = geen gate; parallel-by-default).
--   • herbevestiging_nodig boolean        — zichtbaar, niet-blokkerend
--     signaal na heropening van een stap waarvan deze afhing.
--   • heropend_op timestamptz             — tijdstip van heropenen.
--   • fase_code text                       — koppeling stap → fase (D8).
--
--  Statusmodel: de CHECK wordt uitgebreid van ('open','actief','afgerond')
--  naar de SUPERSET ('open','geblokkeerd','actief','afgerond','heropend').
--  'open' blijft bewust geldig zodat LOPENDE (legacy) procedures niet van
--  gedrag veranderen (snapshot-integriteit): de engine behandelt 'open' via
--  het oude, sequentiële pad en raakt het in de nieuwe recompute niet aan.
--  Nieuwe procedures gebruiken 'geblokkeerd' voor nog-niet-activeerbare
--  stappen.
--
--  Reuse: het afrondtijdstip blijft `voltooid_op` (bestond al); er komt GEEN
--  aparte `afgerond_op` bij (afwijking t.o.v. ontwerp §4.1, dat de bestaande
--  kolom niet kende).
--
--  RLS: `procedure_stappen` is al parent-afgeleid (via procedures) met
--  WITH CHECK; de nieuwe kolommen vallen onder de bestaande policies. Geen
--  nieuwe policy/grant nodig; geen SECURITY DEFINER-functie.
--
--  Idempotent (add column if not exists; drop/add constraint if exists).
--  Toepassen: eerst in Supabase, dán code-deploy — de startroute schrijft
--  na deze migratie 'geblokkeerd'/'actief' i.p.v. 'open'.
-- ============================================================

begin;

alter table public.procedure_stappen
  add column if not exists blokkerende_afhankelijkheden int[] not null default '{}',
  add column if not exists herbevestiging_nodig boolean not null default false,
  add column if not exists heropend_op timestamptz,
  add column if not exists fase_code text;

-- Status-CHECK naar de superset (legacy 'open' behouden).
alter table public.procedure_stappen
  drop constraint if exists procedure_stappen_status_check;
alter table public.procedure_stappen
  add constraint procedure_stappen_status_check
  check (status in ('open','geblokkeerd','actief','afgerond','heropend'));

comment on column public.procedure_stappen.blokkerende_afhankelijkheden is
  'D6: stap-volgordes die eerst afgerond moeten zijn. Leeg = geen gate (parallel-by-default).';
comment on column public.procedure_stappen.herbevestiging_nodig is
  'D6: niet-blokkerend signaal dat een afhankelijke stap is heropend; controleer of dit nog klopt.';

commit;

-- ============================================================
--  Verificatie:
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.procedure_stappen'::regclass and contype='c';
--    -- moet de 5-waarden-CHECK tonen.
-- ============================================================
