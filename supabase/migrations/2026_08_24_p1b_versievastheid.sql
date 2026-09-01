-- P1b (#166) — Versievastheid & onveranderlijkheid van een proceduredefinitie (I7)
-- ---------------------------------------------------------------------------
-- Ontwerp : PROCEDURE-ENGINE-V2-ONTWERP.md v0.10 §13.1 (I7). Besluit 0188.
-- Impact  : data + audit. HAND-APPLIED in Supabase (Dashboard → SQL Editor → Run)
--           VÓÓR de code-deploy. Rollback:
--           supabase/rollbacks/2026_08_24_p1b_versievastheid_ROLLBACK.sql
--
-- I7 = het verschil tussen versiePINNING (het dossier wijst naar een versie) en
--      versieBEVRIEZING (die versie kán niet meer veranderen). Alleen het tweede
--      is verdedigbaar tegenover een toezichthouder.
--
-- DE VOLGORDE IS DRAGEND. Eerst kolom + backfill + index; PAS ALS LAATSTE stap
-- de bestaande versies publiceren. Publiceren zet de bevriezing aan: de trigger
-- weigert dan élke mutatie op die (template_code, template_versie). Alles wat
-- requirement-rijen aanraakt moet dus vóór de publicatie-INSERT gebeuren, anders
-- blokkeert de migratie zichzelf.

begin;

-- ── 1. template_versie op procedure_requirements (nullable → backfill → not null)
alter table public.procedure_requirements
  add column if not exists template_versie text;

-- Backfill: versie PER template_code afgeleid uit de bron (JSON `versie` / OB-4),
-- NOOIT een blanket default. Verkeerd getagd (bv. invaar als 1.0.0 terwijl het
-- dossier op 2.0.0 pint) → het dossier vindt nul vereisten en toont een lege,
-- groene bewijslast — stil, en erger dan het probleem dat we oplossen.
-- Vandaag dragen alleen pf_wtp_invaarbesluit (2.0.0, uit de canonieke JSON) en
-- beleidswijziging_beleggingsbeleid (1.0.0, OB-4) rijen; de overige code-
-- templates zijn leeg maar worden voor de volledigheid meegenomen.
update public.procedure_requirements
   set template_versie = '2.0.0'
 where template_code = 'pf_wtp_invaarbesluit'
   and template_versie is null;

update public.procedure_requirements
   set template_versie = '1.0.0'
 where template_code in (
         'beleidswijziging_beleggingsbeleid',
         'beleidswijziging',
         'uitbestedingsreview',
         'incident_dnb')
   and template_versie is null;

-- Faal LUID op een onbekende template_code i.p.v. stil te defaulten.
do $$
begin
  if exists (
    select 1 from public.procedure_requirements where template_versie is null
  ) then
    raise exception
      'P1b: procedure_requirements met een template_code zonder versie-mapping — breid de backfill uit i.p.v. te defaulten (I7).';
  end if;
end $$;

alter table public.procedure_requirements
  alter column template_versie set not null;

-- ── 2. Vijfde trigger-kolom (§8). ALLEEN de kolom; activeren vraagt het
--   JSON-contract en volgt met fase C. ai_risicoklasse is text (laag/middel/hoog),
--   dus text[] zoals triggert_bij_risiconiveau (niet boolean).
alter table public.procedure_requirements
  add column if not exists triggert_bij_ai_risicoklasse text[];

-- ── 3. idx_req_uniek uitbreiden met template_versie (nu pas versievast).
drop index if exists public.idx_req_uniek;
create unique index if not exists idx_req_uniek
  on public.procedure_requirements(
    template_code, template_versie, stap_volgorde, requirement_type,
    coalesce(documenttype, label));

-- ── 4. template_versie op procedures (nullable; de app vult hem bij start).
--   Bewust NULLABLE, geen NOT NULL: deze migratie draait vóór de code-deploy;
--   een NOT NULL zonder default zou procedure-aanmaak door de nog-oude code
--   breken in het deploy-venster. De lezer valt terug op code-only als de versie
--   (kortstondig) null is.
alter table public.procedures
  add column if not exists template_versie text;

update public.procedures set template_versie = '2.0.0'
 where template_code = 'pf_wtp_invaarbesluit' and template_versie is null;
update public.procedures set template_versie = '1.0.0'
 where template_code in (
         'beleidswijziging_beleggingsbeleid', 'beleidswijziging',
         'uitbestedingsreview', 'incident_dnb')
   and template_versie is null;

-- ── 5. decision_objects.template_versie herstellen. Deze werd door decision.ts
--   met de CODE gevuld i.p.v. de versie (de bug die P1b in de code corrigeert).
--   Zet 'm naar de VERSIE van de gekoppelde procedure. Alleen waar hij nu de code
--   of null bevat — een al correct gezette versie blijft ongemoeid.
update public.decision_objects d
   set template_versie = p.template_versie
  from public.procedures p
 where d.procedure_id = p.id
   and p.template_versie is not null
   and (d.template_versie is null or d.template_versie = p.template_code);

-- ── 6. Publicatieregister (I7). GLOBAAL, geen fonds_id. Uitdrukkelijk NIET de
--   registry (fase C van PROCEDURE-GENERIEK-ONTWERP); fase C kan dit later
--   absorberen.
create table if not exists public.procedure_definitie_publicatie (
  template_code     text not null,
  template_versie   text not null,
  gepubliceerd_op   timestamptz not null default now(),
  -- NULL voor migratie-/systeempublicaties (er is nu geen runtime-schrijfpad);
  -- vullen zodra publiceren ooit een app-actie wordt.
  gepubliceerd_door uuid,
  primary key (template_code, template_versie)
);
comment on table public.procedure_definitie_publicatie is
  'GLOBAAL (geen fonds_id): publicatieregister proceduredefinities (I7). Append-only — publiceren kan, ontpubliceren niet. Zie besluit 0188.';

alter table public.procedure_definitie_publicatie enable row level security;

-- Leesbaar voor elke ingelogde gebruiker (de versievast-trigger op
-- procedure_requirements leest dit register). GEEN write-policy → schrijven kan
-- alleen via een migratie (postgres) of service_role, niet via de app. Zo is er
-- geen FOR ALL-policy (Gate G) en geen anon-write (Gate F).
drop policy if exists "pub read all" on public.procedure_definitie_publicatie;
create policy "pub read all" on public.procedure_definitie_publicatie
  for select using (auth.uid() is not null);

-- De Supabase-default-ACL kent anon ÉN authenticated brede rechten toe op elk
-- nieuw object (bevindingen C-01/H-18): eerst intrekken, dan gericht teruggeven.
-- authenticated leest alleen (de trigger op procedure_requirements leest dit
-- register als de aanroepende rol); service_role behoudt de default (niet door
-- de app gebruikt — Variant-C: geen service-role in de app).
revoke all on public.procedure_definitie_publicatie from public, anon, authenticated;
grant select on public.procedure_definitie_publicatie to authenticated;

-- ── 7a. Append-only-grendel op het register zélf: publiceren kan, wijzigen en
--   verwijderen niet. Zonder deze grendel is I7 één `delete` van uitgeschakeld
--   (rij weg → vereiste wijzigen → rij terug, zonder spoor).
create or replace function public.fn_publicatie_append_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception
    'Publicatieregister is append-only (I7): een gepubliceerde versie kan niet worden gewijzigd of ontpubliceerd. Maak een nieuwe versie. Zie besluit 0188.'
    using errcode = 'restrict_violation';
  return null;
end $$;
revoke all on function public.fn_publicatie_append_only() from public, anon, authenticated;
grant execute on function public.fn_publicatie_append_only() to service_role;

drop trigger if exists trg_publicatie_append_only on public.procedure_definitie_publicatie;
create trigger trg_publicatie_append_only
  before update or delete on public.procedure_definitie_publicatie
  for each row execute function public.fn_publicatie_append_only();

-- TRUNCATE is statement-level en vuurt de row-trigger NIET — dat zou een stille
-- mass-ontpublicatie zijn (bevriezing uit). Een aparte statement-trigger sluit
-- dat gat; dezelfde functie (TRUNCATE = ontpubliceren van alles tegelijk).
drop trigger if exists trg_publicatie_geen_truncate on public.procedure_definitie_publicatie;
create trigger trg_publicatie_geen_truncate
  before truncate on public.procedure_definitie_publicatie
  for each statement execute function public.fn_publicatie_append_only();

-- ── 7b. Onveranderlijkheidstrigger op procedure_requirements. Weigert ELKE
--   mutatie (INSERT/UPDATE/DELETE) op een gepubliceerde (template_code, versie).
--   INSERT hoort erbij (breder dan de v0.10-schets 'update or delete'): een
--   vereiste TOEVOEGEN aan een bevroren versie verandert de bewijslast van een
--   lopend dossier net zo goed. Nieuwe, nog niet gepubliceerde versies insert je
--   vrij.
create or replace function public.fn_procedure_requirements_versievast()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_code   text;
  v_versie text;
begin
  if tg_op = 'DELETE' then
    v_code := old.template_code; v_versie := old.template_versie;
  else
    v_code := new.template_code; v_versie := new.template_versie;
  end if;
  if exists (
    select 1 from public.procedure_definitie_publicatie p
     where p.template_code = v_code
       and p.template_versie = v_versie
  ) then
    raise exception
      'Vereiste van gepubliceerde definitie %@% is onveranderlijk (I7). Wijzig via een nieuwe versie; zie besluit 0188.',
      v_code, v_versie
      using errcode = 'restrict_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.fn_procedure_requirements_versievast() from public, anon, authenticated;
grant execute on function public.fn_procedure_requirements_versievast() to service_role;

drop trigger if exists trg_req_versievast on public.procedure_requirements;
create trigger trg_req_versievast
  before insert or update or delete on public.procedure_requirements
  for each row execute function public.fn_procedure_requirements_versievast();

-- ── 8. PUBLICEREN — de bevriezing gaat NU in (laatste stap, ná alle backfill).
--   De twee codes die requirements dragen. Lege codes invriezen is moot.
insert into public.procedure_definitie_publicatie (template_code, template_versie)
values
  ('pf_wtp_invaarbesluit', '2.0.0'),
  ('beleidswijziging_beleggingsbeleid', '1.0.0')
on conflict (template_code, template_versie) do nothing;

commit;
