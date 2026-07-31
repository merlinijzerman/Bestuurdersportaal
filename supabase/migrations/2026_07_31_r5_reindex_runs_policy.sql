-- ============================================================================
--  Migratie 2026-07-31 — R5: reindex_runs-policy gelijktrekken met de repo
--
--  BEVINDING L-08 (gevonden 31-07-2026 door de nieuwe gate G uit
--  supabase/checks/2026_07_31_r1_structurele_gates.sql)
--
--  WAT IS ER AAN DE HAND
--  Productie draagt op public.reindex_runs de policy:
--
--      reindex_runs eigen fonds | ALL | using (fonds_id = eigen fonds)
--                                     | with_check = NULL
--
--  De repo maakt in 2026_06_24_rag_structuur_contextueel.sql (r.88-92) een
--  policy met een ANDERE NAAM ("fonds reindex_runs") en
--  mét een expliciete, identieke with_check. Geen enkele latere migratie
--  hernoemt hem, en schema.sql maakt hem niet aan — die maakt alleen de tabel
--  plus `enable row level security`. De policy in productie is dus MET DE HAND
--  geschreven in plaats van via de migratie.
--
--  ERNST: LAAG — hygiëne en drift, geen escalatiepad.
--  Postgres gebruikt bij een ontbrekende WITH CHECK de USING-expressie ook voor
--  de schrijfkant. Anders dan bij bevinding K-03 (profielen) staat de te
--  beschermen kolom hier ZELF in die expressie: `fonds_id = eigen fonds` toetst
--  dus ook bij INSERT en UPDATE. Een rij naar een ander fonds schrijven lukt
--  niet, en `fonds_id is null` evalueert naar NULL en dus niet naar true.
--  Effectief gedrag is identiek aan de repo-versie.
--
--  WAAROM DAN TOCH REPAREREN
--  1. Gate G is een structurele regel ("geen FOR ALL zonder WITH CHECK") en
--     hoort geen uitzonderingen te kennen — een expliciete with_check is ook
--     bestand tegen een toekomstige wijziging van de USING-expressie waarbij
--     fonds_id eruit verdwijnt.
--  2. Naam en definitie horen te matchen met de migratie, anders blijft de
--     repo een onbetrouwbaar beeld van productie geven. Dat is de rode draad
--     onder K-02, K-03 en deze bevinding.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent. Rollback: 2026_07_31_r5_reindex_runs_policy_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 0. Preflight: is de RÉST van migratie 2026_06_24 wél gedraaid? ──────────
--  Die migratie deed drie dingen: kolommen op document_chunks, een herbouw van
--  de gegenereerde kolom zoek_vector, en de reindex_runs-tabel + policy. Als de
--  policy met de hand is gezet, is niet vanzelfsprekend dat de rest is
--  toegepast. Deze controle FIXT niets — een herbouw van een generated column
--  op een gevulde tabel is een zwaardere operatie die niet verstopt hoort te
--  zitten in een policy-fix. Ontbreekt er iets, dan stopt R5 en weet je precies
--  welk deel je alsnog handmatig moet draaien.
do $$
declare
  ontbreekt text := '';
  k text;
begin
  foreach k in array array[
    'structuur_type','structuur_label','context_prefix','prefix_model',
    'indexering_versie','zoek_vector'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='document_chunks' and column_name=k
    ) then
      ontbreekt := ontbreekt || format('  - document_chunks.%s%s', k, chr(10));
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and tablename='document_chunks' and indexname='idx_chunks_zoek'
  ) then
    ontbreekt := ontbreekt || '  - index idx_chunks_zoek (gin op zoek_vector)' || chr(10);
  end if;

  if ontbreekt <> '' then
    raise exception E'R5 GESTOPT: migratie 2026_06_24_rag_structuur_contextueel.sql is maar deels toegepast. Ontbreekt:\n%\nDraai eerst secties 1 en 2 van die migratie (kolommen + zoek_vector-herbouw) apart en bewust; kom daarna terug voor R5.', ontbreekt;
  end if;
  raise notice 'R5 preflight OK: document_chunks-kolommen en idx_chunks_zoek aanwezig.';
end $$;

-- ── 1. Index uit dezelfde migratie (no-op als hij er al staat) ──────────────
create index if not exists idx_reindex_runs_fonds
  on public.reindex_runs (fonds_id, aangemaakt desc);

-- ── 2. Policy gelijktrekken met de repo ─────────────────────────────────────
--  Beide namen droppen: de handgeschreven variant én de repo-naam, zodat dit
--  bestand ook idempotent is op een database waar de migratie wél is gedraaid.
drop policy if exists "reindex_runs eigen fonds" on public.reindex_runs;
drop policy if exists "fonds reindex_runs"       on public.reindex_runs;

create policy "fonds reindex_runs" on public.reindex_runs
  for all
  using      (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 3. Fail-closed verificatie binnen dezelfde transactie ───────────────────
do $$
declare
  n_totaal int;
  n_goed   int;
begin
  select count(*) into n_totaal
    from pg_policies where schemaname='public' and tablename='reindex_runs';

  select count(*) into n_goed
    from pg_policies
   where schemaname='public' and tablename='reindex_runs'
     and policyname='fonds reindex_runs'
     and with_check is not null
     and position('profielen' in coalesce(with_check,'')) > 0;

  if n_totaal <> 1 or n_goed <> 1 then
    raise exception 'R5 FAALT: reindex_runs draagt % policies, waarvan % correct (verwacht 1 en 1).', n_totaal, n_goed;
  end if;
  raise notice 'R5 OK: reindex_runs draagt exact één policy, met expliciete en fondsgebonden with_check.';
end $$;

commit;

-- ============================================================================
--  Verificatie ná de migratie
-- ============================================================================
-- 1. Eindtoestand:
--      select policyname, cmd, qual, with_check from pg_policies
--       where schemaname='public' and tablename='reindex_runs';
--    → één rij: "fonds reindex_runs" (ALL), qual én with_check gevuld.
--
-- 2. Draai daarna de volledige gate-set opnieuw:
--      supabase/checks/2026_07_31_r1_structurele_gates.sql
--    → verwacht een schone run: A1, A2, B, C, C2, E, F, G en D allemaal OK.
--      Dat is dan de eerste volledig groene structurele gate-run op productie.
