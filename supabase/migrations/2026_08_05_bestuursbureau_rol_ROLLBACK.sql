-- ============================================================================
--  ROLLBACK van 2026_08_05_bestuursbureau_rol.sql
-- ----------------------------------------------------------------------------
--  Zet de elf policies terug naar hun exacte staat van vóór de migratie
--  (2026_07_31_r1_rls_tenantgrenzen.sql / 2026_07_08_t3_rls_with_check.sql /
--  2026_05_20_stemmingen.sql / schema.sql §9) en herstelt de rol-CHECK op drie
--  waarden.
--
--  ⚠️ LET OP — deze rollback HEROPENT de afscherming van de bureau-rol.
--  Bestaat er op dat moment nog een profiel met rol = 'bestuursbureau', dan:
--    • zou de CHECK falen op bestaande data — daarom breekt dit script dan
--      bewust af met een exception, vóórdat er iets is gewijzigd;
--    • zouden die gebruikers ná herstel van de policies weer alle inbreng en al
--      het individuele stemgedrag van hun fonds kunnen lezen, én kunnen stemmen,
--      inbrengen en dissent vastleggen.
--  Zet die profielen dus eerst via het service-role-pad terug op een
--  bestuurlijke rol (of verwijder de accounts), en draai dan pas deze rollback.
--
--  Idempotent (drop policy if exists → create policy; dynamische constraint-drop).
-- ============================================================================

begin;

-- ── 0. Voorportaal: geen bureau-profielen meer, anders stoppen ─────────────
do $$
declare n int;
begin
  select count(*) into n from public.profielen where rol = 'bestuursbureau';
  if n > 0 then
    raise exception
      'ROLLBACK GEWEIGERD: er zijn nog % profiel(en) met rol = ''bestuursbureau''. '
      'Zet die eerst via het service-role-pad om naar een bestuurlijke rol; anders '
      'faalt de herstelde CHECK op bestaande data en verliezen die accounts hun '
      'afscherming.', n;
  end if;
end $$;

-- ── 1. agendapunt_inbreng → staat van 2026_07_31_r1 / 2026_07_08_t3 ───────
drop policy if exists "fonds inbreng lezen" on public.agendapunt_inbreng;
create policy "fonds inbreng lezen" on public.agendapunt_inbreng
  for select using (
    agendapunt_id in (
      select ap.id from public.agendapunten ap
      join public.vergaderingen v on v.id = ap.vergadering_id
      where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "eigen inbreng schrijven" on public.agendapunt_inbreng;
create policy "eigen inbreng schrijven" on public.agendapunt_inbreng
  for insert with check (
    gebruiker_id = auth.uid()
    and agendapunt_id in (
      select ap.id
        from public.agendapunten ap
        join public.vergaderingen v on v.id = ap.vergadering_id
       where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "eigen inbreng wijzigen" on public.agendapunt_inbreng;
create policy "eigen inbreng wijzigen" on public.agendapunt_inbreng
  for update
  using (gebruiker_id = auth.uid())
  with check (gebruiker_id = auth.uid());

drop policy if exists "eigen inbreng verwijderen" on public.agendapunt_inbreng;
create policy "eigen inbreng verwijderen" on public.agendapunt_inbreng
  for delete using (gebruiker_id = auth.uid());

-- ── 2. stem_uitbrengingen → staat van 2026_05_20 / 2026_07_08_t3 ──────────
drop policy if exists "fonds stem select" on public.stem_uitbrengingen;
create policy "fonds stem select" on public.stem_uitbrengingen
  for select using (
    stemming_id in (
      select id from public.stemmingen
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds stem insert" on public.stem_uitbrengingen;
create policy "fonds stem insert" on public.stem_uitbrengingen
  for insert with check (
    uitgebracht_door = auth.uid()
    and stemming_id in (
      select id from public.stemmingen
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds stem update" on public.stem_uitbrengingen;
create policy "fonds stem update" on public.stem_uitbrengingen
  for update
  using (uitgebracht_door = auth.uid())
  with check (uitgebracht_door = auth.uid());

drop policy if exists "fonds stem delete" on public.stem_uitbrengingen;
create policy "fonds stem delete" on public.stem_uitbrengingen
  for delete using (uitgebracht_door = auth.uid());

-- ── 3. stemmingen → staat van 2026_05_20 / 2026_07_08_t3 ──────────────────
drop policy if exists "fonds stemmingen insert" on public.stemmingen;
create policy "fonds stemmingen insert" on public.stemmingen
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and geopend_door = auth.uid()
  );

drop policy if exists "fonds stemmingen update" on public.stemmingen;
create policy "fonds stemmingen update" on public.stemmingen
  for update
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 4. decision_dissent → staat van 2026_07_31_r1 ─────────────────────────
drop policy if exists "dissent zichtbaarheid write" on public.decision_dissent;
create policy "dissent zichtbaarheid write" on public.decision_dissent
  for all
  using (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      bestuurder_id = auth.uid()
      or exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
    )
  )
  with check (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      bestuurder_id = auth.uid()
      or exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
    )
  );

-- ── 5. profielen.rol-CHECK terug naar drie waarden ────────────────────────
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'profielen'
       and con.contype = 'c'
       -- Vastgepind op de KOLOM `rol`, niet op de tekst van de definitie. Een
       -- match op '%rol%bestuurder%' zou ook een toekomstige CHECK op
       -- profielen.bestuurlijke_rol raken (bv. een waarde 'werkgeversbestuurder')
       -- en die stil droppen zonder hem te herbouwen.
       and con.conkey = array[
             (select attnum from pg_attribute
               where attrelid = rel.oid and attname = 'rol' and not attisdropped)
           ]::smallint[]
  loop
    execute format('alter table public.profielen drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profielen
  add constraint profielen_rol_check
  check (rol in ('bestuurder','voorzitter','beheerder'));

-- Commentaren terugzetten naar de staat van vóór T1. `stem_uitbrengingen` had al
-- documentatie uit 2026_05_20_stemmingen.sql — die herstellen we letterlijk in
-- plaats van hem te nullen; `agendapunt_inbreng` en `profielen.rol` hadden er geen.
comment on column public.profielen.rol is null;
comment on table public.agendapunt_inbreng is null;
comment on table public.stem_uitbrengingen is
  'Individuele stemuitbrengingen per stemronde. Volmacht: uitgebracht_door <> '
  'stemgerechtigde_id, met verplichte bevestiging (chk_volmacht_bevestigd).';

commit;

-- ── Verificatie ná de rollback ────────────────────────────────────────────
-- 1. Geen policy noemt de rol meer:
--      select tablename, policyname from pg_policies
--       where schemaname = 'public'
--         and coalesce(qual,'') || coalesce(with_check,'') like '%bestuursbureau%';
--    → verwacht: 0 rijen.
-- 2. De CHECK kent weer drie waarden:
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conrelid = 'public.profielen'::regclass and contype = 'c';
-- ============================================================================
