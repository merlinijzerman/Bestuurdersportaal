-- ============================================================
--  Migratie 2026-08-13 — Proceduremodule-engine v2, D8
--  Fasebeschrijving als data, per fonds overschrijfbaar.
--
--  Levert:
--   • procedure_template_fasen           — globale, gedeelde fase-defaults
--     (fase_code, titel, generieke_beschrijving) per template_code.
--     GEEN fonds_id → global-by-design (geregistreerd in de A1-lijst van
--     supabase/checks/2026_07_31_r1_structurele_gates.sql).
--   • procedure_fase_beschrijving_override — fonds-specifieke override van
--     de beschrijving; fallback naar de generieke default bij ontbreken.
--   • Seed van de zes fasen (I–VI) voor template_code 'pf_wtp_invaarbesluit'.
--
--  Leeslogica (server): beschrijving := coalesce(override[fonds,fase],
--  template.generieke_beschrijving). Een fasebeschrijving is pure content —
--  wijzigen raakt stappen/checklist/bewijslast/activatie niet.
--
--  Aanpassing t.o.v. PROCEDURE-ENGINE-V2-ONTWERP §6: de tabellen worden op
--  `template_code` (text) gesleuteld i.p.v. `template_id → procedure_templates(id)`,
--  omdat er in dit project GEEN procedure_templates-tabel bestaat; templates
--  leven als code/JSON-definitie en requirements zijn al op `template_code`
--  gesleuteld (procedure_requirements). Zo blijft D8 consistent met het model.
--
--  Idempotent: create table if not exists + drop policy if exists + delete/insert.
--  Toepassen: eerst in Supabase, dán code-deploy. Draai daarna de structurele
--  gates (A t/m H) en scripts/cross-tenant-ci.sh.
--  Aanbevolen volgorde binnen deze tranche: D6 → D7a → D7b → D8 → seeds.
-- ============================================================

begin;

-- ── Globale fase-defaults ─────────────────────────────────────────────
create table if not exists public.procedure_template_fasen (
  id                      uuid primary key default uuid_generate_v4(),
  template_code           text not null,
  fase_code               text not null,
  volgorde                int  not null,
  titel                   text not null,
  generieke_beschrijving  text,
  unique (template_code, fase_code)
);

comment on table public.procedure_template_fasen is
  'Globale, gedeelde fase-defaults per template_code (D8). Geen fonds_id: global-by-design, geregistreerd in de A1-lijst van de structurele gates. Schrijven: beheerder.';

alter table public.procedure_template_fasen enable row level security;

-- Lezen: elke ingelogde gebruiker (gedeelde templateconfig). Bewust
-- `auth.uid() is not null` i.p.v. `using(true)` zodat gate C niet vuurt.
drop policy if exists "fasen read all" on public.procedure_template_fasen;
create policy "fasen read all" on public.procedure_template_fasen
  for select using (auth.uid() is not null);

-- Schrijven: alleen beheerder (globale templateconfig, vgl. procedure_requirements).
drop policy if exists "fasen insert beheerder" on public.procedure_template_fasen;
create policy "fasen insert beheerder" on public.procedure_template_fasen
  for insert with check (
    exists (select 1 from public.profielen
             where id = auth.uid() and rol = 'beheerder')
  );

drop policy if exists "fasen update beheerder" on public.procedure_template_fasen;
create policy "fasen update beheerder" on public.procedure_template_fasen
  for update using (
    exists (select 1 from public.profielen
             where id = auth.uid() and rol = 'beheerder')
  ) with check (
    exists (select 1 from public.profielen
             where id = auth.uid() and rol = 'beheerder')
  );

revoke all on public.procedure_template_fasen from anon;
revoke delete, truncate, references, trigger
  on public.procedure_template_fasen from authenticated;
grant select, insert, update on table public.procedure_template_fasen to authenticated;

-- ── Fonds-override van de fasebeschrijving ────────────────────────────
create table if not exists public.procedure_fase_beschrijving_override (
  id              uuid primary key default uuid_generate_v4(),
  template_code   text not null,
  fase_code       text not null,
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  beschrijving    text not null,
  aangepast_door  uuid references auth.users(id) on delete set null,
  aangepast_op    timestamptz default now(),
  unique (template_code, fase_code, fonds_id)
);

comment on table public.procedure_fase_beschrijving_override is
  'Fonds-specifieke override van een fasebeschrijving (D8). Fonds-RLS + WITH CHECK; schrijven door voorzitter/beheerder. Fallback naar procedure_template_fasen.generieke_beschrijving bij ontbreken.';

alter table public.procedure_fase_beschrijving_override enable row level security;

drop policy if exists "fase-override eigen fonds lezen"
  on public.procedure_fase_beschrijving_override;
create policy "fase-override eigen fonds lezen" on public.procedure_fase_beschrijving_override
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "fase-override schrijven voorzitter-beheerder"
  on public.procedure_fase_beschrijving_override;
create policy "fase-override schrijven voorzitter-beheerder" on public.procedure_fase_beschrijving_override
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

drop policy if exists "fase-override wijzigen voorzitter-beheerder"
  on public.procedure_fase_beschrijving_override;
create policy "fase-override wijzigen voorzitter-beheerder" on public.procedure_fase_beschrijving_override
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

revoke all on public.procedure_fase_beschrijving_override from anon;
revoke delete, truncate, references, trigger
  on public.procedure_fase_beschrijving_override from authenticated;
grant select, insert, update
  on table public.procedure_fase_beschrijving_override to authenticated;

-- ── Seed: zes fasen (I–VI) voor de invaarprocedure ───────────────────
-- Idempotent: eerst de bestaande rijen voor deze template_code weg.
delete from public.procedure_template_fasen
 where template_code = 'pf_wtp_invaarbesluit';

insert into public.procedure_template_fasen
  (template_code, fase_code, volgorde, titel, generieke_beschrijving)
values
  ('pf_wtp_invaarbesluit', 'I', 1, 'Kaders',
   'Het bestuur legt de opdracht en de eigen beoordelingsmaatstaven vast vóórdat de inhoudelijke weging begint: wat vraagt de opdrachtgever, en op basis van welk kader beoordelen wij of de transitie verantwoord en evenwichtig is?'),
  ('pf_wtp_invaarbesluit', 'II', 2, 'Onderbouwing',
   'Het bestuur bouwt de feitelijke onderbouwing op: uitvoerbaarheid en beheersing, betrouwbaarheid van data en modellen, de transitie-effecten en evenwichtigheid, en de uitlegbaarheid richting deelnemers.'),
  ('pf_wtp_invaarbesluit', 'III', 3, 'Besluitvorming',
   'Het bestuur vormt het voorgenomen besluit en doorloopt medezeggenschap en intern toezicht, met zichtbare weging van adviezen, hoorrecht en eventuele afwijkende inzichten.'),
  ('pf_wtp_invaarbesluit', 'IV', 4, 'Toezicht & voorbereiding',
   'Het dossier gaat naar DNB en AFM ter beoordeling, en de deelnemers en de klantbediening worden tijdig en persoonlijk voorbereid op de transitie.'),
  ('pf_wtp_invaarbesluit', 'V', 5, 'Gereedheid & invaren',
   'Het bestuur toetst de finale gereedheid tegen vooraf bepaalde criteria, neemt het go/no-go-besluit en voert — bij go — de daadwerkelijke omzetting uit.'),
  ('pf_wtp_invaarbesluit', 'VI', 6, 'Verantwoording & nazorg',
   'Na de transitie controleert en verklaart het bestuur de uitkomsten, informeert het definitief, en monitort het gemaakte keuzes, klachten en signalen als bestuurlijke feedback.');

commit;

-- ============================================================
--  Verificatie:
--    select fase_code, titel from public.procedure_template_fasen
--     where template_code = 'pf_wtp_invaarbesluit' order by volgorde;  -- 6 rijen I..VI
--    -- Vergeet niet 'procedure_template_fasen' in de A1-globaal-lijst van
--    -- supabase/checks/2026_07_31_r1_structurele_gates.sql te registreren
--    -- (in deze tranche meegeleverd), anders faalt gate A1.
-- ============================================================
