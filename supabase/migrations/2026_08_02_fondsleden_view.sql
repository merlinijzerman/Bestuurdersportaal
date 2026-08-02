-- ============================================================================
-- Migratie 2026-08-02 — `vw_fondsleden`: weergavenaam + rol van fondsgenoten
-- ----------------------------------------------------------------------------
-- WAAROM. Het portaal toonde bij co-eigenaars van een procedure een e-mailadres
-- in plaats van een naam. Dat is geen weergavefout: `procedure_eigenaars.
-- gebruiker_naam` is een SNAPSHOT van `profielen.naam`, genomen bij aanmaken, en
-- `maak_profiel()` valt bij registratie zonder naam terug op `new.email`. Het
-- e-mailadres ís dus de weergavenaam van dat account.
--
-- Die snapshots bestaan omdat de RLS op `profielen` strikt de eigen rij afdekt
-- ("profiel select eigen", migratie 2026-07-03): niemand kan de naam van een
-- collega lezen, dus moest die bij elke schrijfactie worden meegekopieerd. Die
-- kopieën verouderen stil zodra iemand zijn naam wijzigt, en ze bevriezen een
-- fout die je achteraf alleen met datamigraties rechttrekt.
--
-- WAT DIT NIET IS. De RLS op `profielen` wordt NIET versoepeld. Die tabel draagt
-- naast naam en rol ook het persoonlijke bestuurdersprofiel (bestuurlijke_rol,
-- primaire_expertise_id, antwoordvoorkeur, standaard_ai_modus, detailniveau) en
-- dat is per besluit 0017 strikt zelfbeheerd. Rij-niveau-RLS kan geen kolommen
-- afschermen; een ruimere SELECT-policy zou dus het hele profiel openzetten.
--
-- AANPAK. Eén smalle projectie met definer-semantiek (`security_invoker = false`),
-- die uitsluitend `id`, `naam` en `rol` teruggeeft en zichzelf op het fonds van de
-- aanroeper scopet. De onderliggende policy blijft onaangeroerd; de view is de
-- enige, expliciet afgebakende uitzondering.
--
-- Waarom definer en niet invoker: met invoker-semantiek erft de view de policy
-- "eigen rij" en geeft hij per definitie alleen je eigen naam terug — precies wat
-- niet werkt. De prijs is dat de scoping in de view zélf moet kloppen; daarvoor
-- is `supabase/checks/2026_08_02_fondsleden_cross_tenant.sql`.
--
-- Zonder sessie (`auth.uid()` is null) levert de subquery null en geeft de
-- vergelijking `fonds_id = null` nul rijen — anon en service-role zien dus niets.
-- `anon` krijgt bovendien expliciet geen grant.
--
-- Idempotent (create or replace + drop if exists op de grants).
-- ROLLBACK: 2026_08_02_fondsleden_view_ROLLBACK.sql
-- ============================================================================

begin;

create or replace view public.vw_fondsleden
with (security_invoker = false) as
  select p.id,
         p.fonds_id,
         p.naam,
         p.rol
    from public.profielen p
   where p.fonds_id = (
           select eigen.fonds_id
             from public.profielen eigen
            where eigen.id = auth.uid()
         );

comment on view public.vw_fondsleden is
  'Weergavenaam + rol van de leden van het EIGEN fonds. Definer-semantiek: '
  'omzeilt bewust de policy "profiel select eigen" op public.profielen, maar '
  'projecteert uitsluitend id/fonds_id/naam/rol — het persoonlijke '
  'bestuurdersprofiel (besluit 0017) blijft afgeschermd. Scoping zit in de '
  'WHERE; bewaakt door supabase/checks/2026_08_02_fondsleden_cross_tenant.sql.';

revoke all on public.vw_fondsleden from public;
revoke all on public.vw_fondsleden from anon;
grant select on public.vw_fondsleden to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. Als ingelogde tenant-gebruiker:
--      select * from public.vw_fondsleden;
--    → alle leden van het EIGEN fonds, met naam en rol; geen andere kolommen.
-- 2. Als anon:
--      select * from public.vw_fondsleden;
--    → permission denied (geen grant).
-- 3. Regressie: de policy op profielen is ongewijzigd —
--      select policyname, cmd from pg_policies where tablename = 'profielen';
--    → "profiel select eigen" (SELECT) en "profiel update eigen" (UPDATE).
