-- ============================================================
--  ROLLBACK 2026-07-31 — R1: ontbrekende tenantgrenzen in RLS-policies
--
--  Zet de policies terug naar de staat van vóór
--  2026_07_31_r1_rls_tenantgrenzen.sql.
--
--  ⚠️ LET OP — dit herstelt bewust een KRITIEK cross-tenant lek
--  (bevinding K-01: elke voorzitter/beheerder van elk fonds kan dan weer
--  de dissent van álle fondsen lezen, wijzigen en verwijderen). Draai deze
--  rollback UITSLUITEND wanneer de nieuwe policies aantoonbaar een werkend
--  pad breken én er nog maar één tenant in de omgeving staat, en herstel
--  daarna zo snel mogelijk met een gecorrigeerde variant.
--
--  De search_path-pins (deel 6 van de migratie) worden hier NIET
--  teruggedraaid: het pinnen is onvoorwaardelijk veiliger en kan geen
--  functioneel pad breken.
-- ============================================================

begin;

-- ── 1. decision_dissent → staat van 2026_05_07 / 2026_07_08_t3 ──
drop policy if exists "dissent zichtbaarheid select" on public.decision_dissent;
create policy "dissent zichtbaarheid select" on public.decision_dissent
  for select using (
    bestuurder_id = auth.uid()
    or (zichtbaarheid <> 'prive' and exists (
         select 1 from public.profielen
          where id = auth.uid() and rol in ('voorzitter','beheerder')
       ))
    or (zichtbaarheid in ('formele_dissent','minderheidsnotitie')
        and decision_id in (
          select id from public.decision_objects
           where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
        ))
  );

drop policy if exists "dissent zichtbaarheid write" on public.decision_dissent;
create policy "dissent zichtbaarheid write" on public.decision_dissent
  for all
  using (
    bestuurder_id = auth.uid()
    or exists (
      select 1 from public.profielen
       where id = auth.uid() and rol in ('voorzitter','beheerder')
    )
  )
  with check (
    bestuurder_id = auth.uid()
    or exists (
      select 1 from public.profielen
       where id = auth.uid() and rol in ('voorzitter','beheerder')
    )
  );

-- ── 2. notificaties → staat van 2026_05_18 ──
drop policy if exists "eigen notificaties select" on public.notificaties;
create policy "eigen notificaties select" on public.notificaties
  for select using (ontvanger_id = auth.uid());

drop policy if exists "notificaties insert eigen fonds" on public.notificaties;
create policy "notificaties insert eigen fonds" on public.notificaties
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- ── 3. document_inzage → staat van 2026_05_03 ──
drop policy if exists "fonds inzage lezen" on public.document_inzage;
create policy "fonds inzage lezen" on public.document_inzage
  for select using (
    fonds_id is null
    or fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "eigen inzage schrijven" on public.document_inzage;
create policy "eigen inzage schrijven" on public.document_inzage
  for insert with check (gebruiker_id = auth.uid());

-- ── 4. document_metadata_log → staat van 2026_06_18 ──
drop policy if exists "lees document_metadata_log" on public.document_metadata_log;
create policy "lees document_metadata_log" on public.document_metadata_log
  for select using (
    fonds_id is null
    or fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "schrijf document_metadata_log" on public.document_metadata_log;
create policy "schrijf document_metadata_log" on public.document_metadata_log
  for insert with check (gewijzigd_door = auth.uid());

-- ── 5. agendapunt_inbreng → staat van schema.sql ──
drop policy if exists "eigen inbreng schrijven" on public.agendapunt_inbreng;
create policy "eigen inbreng schrijven" on public.agendapunt_inbreng
  for insert with check (gebruiker_id = auth.uid());

-- ── 6. documenten/document_chunks → staat van 2026_06_20e ──
drop policy if exists "documenten select" on public.documenten;
create policy "documenten select" on public.documenten
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    or bibliotheek = 'generiek');

drop policy if exists "chunks select" on public.document_chunks;
create policy "chunks select" on public.document_chunks
  for select using (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      or bibliotheek = 'generiek'));

drop policy if exists "fondsen lezen" on public.fondsen;
create policy "fondsen lezen" on public.fondsen
  for select using (true);

-- ── 7. Helper opruimen ──
-- Pas ná het terugzetten van de notificaties-policy, anders blijft er een
-- policy staan die naar een niet-bestaande functie verwijst.
drop function if exists public.fn_zelfde_fonds(uuid);

commit;
