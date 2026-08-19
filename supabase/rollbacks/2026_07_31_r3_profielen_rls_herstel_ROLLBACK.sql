-- ============================================================================
--  ROLLBACK 2026-07-31 — R3: profielen-RLS
--
--  ⚠️⚠️  DRAAI DIT NIET TENZIJ JE PRECIES WEET WAAROM.  ⚠️⚠️
--
--  Deze rollback herstelt de ONGEHARDE toestand van public.profielen
--  (bevinding K-03): één FOR ALL-policy met alleen USING en zonder WITH CHECK.
--  Daarmee is opnieuw uitvoerbaar, door elke ingelogde gebruiker:
--
--    update public.profielen set rol = 'beheerder' where id = auth.uid();
--        → rechtenescalatie naar beheerder.
--
--    update public.profielen set fonds_id = '<ander fonds>' where id = auth.uid();
--        → volledige doorbraak van de tenantisolatie: vrijwel elke RLS-policy in
--          dit schema sleutelt op profielen.fonds_id.
--
--  Er is GEEN functioneel scenario waarin je dit terugwilt. De app schrijft
--  alleen op de eigen rij (naam/voorkeuren) — dat blijft werken onder
--  "profiel update eigen" — en rolbeheer loopt via de service-role, die zowel
--  RLS als de trigger omzeilt.
--
--  Dit bestand bestaat uitsluitend omdat elke migratie in dit project een
--  spiegel hoort te hebben. Breekt er iets na R3, zoek de oorzaak dan eerst in
--  de bevriezingstrigger (fn_profiel_bevries_kolommen) en overweeg alleen die
--  te droppen — niet de policy-split.
-- ============================================================================

begin;

drop trigger if exists trg_profiel_bevries_kolommen on public.profielen;
drop function if exists public.fn_profiel_bevries_kolommen();

drop policy if exists "profiel select eigen" on public.profielen;
drop policy if exists "profiel update eigen" on public.profielen;

drop policy if exists "eigen profiel" on public.profielen;
create policy "eigen profiel" on public.profielen
  for all using (auth.uid() = id);

commit;
