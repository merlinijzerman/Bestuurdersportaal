-- P3 / PR-C (#168) — afronden met afwijking: vier kolommen op procedure_stappen.
-- ---------------------------------------------------------------------------
-- Ontwerp: PROCEDURE-ENGINE-V2-ONTWERP.md §5.1 (r268-273). Besluit 0192.
-- Impact: data (additief). HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_27_p3c_01_afwijking_kolommen_ROLLBACK.sql
--
-- Een stap kan ALTIJD worden afgerond; ontbreekt er iets bóven `optioneel`, dan
-- legt de afronding vast WAT ontbrak (snapshot), WAAROM toch is afgerond
-- (motivering) en DOOR WIE. Dat is een verantwoordingsfeit dat in een afschrift
-- terecht kan komen.
--
-- GEEN nieuwe tabel, GEEN nieuwe RLS-policy, GEEN I1-trigger: de kolommen erven
-- de bestaande procedure_stappen-RLS (via de procedure) en een afwijking is GEEN
-- gebonden feit — "overrulen is niet vervullen" (§5.1 r279): de ontbrekende
-- vereiste blijft open in de tellingen en in het dossier. procedure_stappen
-- draagt geen onveranderlijkheidstrigger, dus geen I7-interactie.
--
-- De stapkolommen beschrijven UITSLUITEND de laatste afronding en worden bij een
-- her-afronding (na heropenen) overschreven; procedure_log is canoniek voor de
-- historie (§5.1 r275). fn_stap_afronden_met_afwijking (p3c_02) schrijft ze.

begin;

alter table public.procedure_stappen
  add column if not exists afgerond_met_afwijking boolean not null default false,
  add column if not exists afwijking_motivering   text,
  add column if not exists afwijking_snapshot      jsonb,
  add column if not exists afwijking_door          uuid references auth.users(id);

comment on column public.procedure_stappen.afgerond_met_afwijking is
  'P3 (#168, §5.1): stap afgerond terwijl er iets openstond boven optioneel. Voedt bestuurlijk signaal 3 (P5). Zie besluit 0192.';
comment on column public.procedure_stappen.afwijking_motivering is
  'P3 (#168, §5.1): verplichte motivering bij afronden met afwijking; beschrijft de laatste afronding (procedure_log is canoniek).';
comment on column public.procedure_stappen.afwijking_snapshot is
  'P3 (#168, §5.1): wat er ontbrak op het moment van afronden, per zwaarte: {kritiek:[…], vereist:[…], optioneel:[…]}.';
comment on column public.procedure_stappen.afwijking_door is
  'P3 (#168, §5.1): wie de afwijking heeft vastgelegd (afgeleid uit auth.uid(), nooit meegegeven).';

commit;
