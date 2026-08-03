-- ============================================================================
-- ROLLBACK van 2026_08_04_a2_audit_least_privilege.sql
-- ----------------------------------------------------------------------------
-- Herstelt de situatie van vóór de autorisatielaag: `governance_log` weer
-- fondsbreed via "fonds log", `gesprekken` weer één `for all`-policy, en de
-- capability-, redactie- en inzagetabellen weg.
--
-- ⚠ WAT DIT TERUGDRAAIT IS EEN BEVEILIGINGSVERSCHERPING. Na deze rollback leest
-- elke gebruiker in het fonds weer de auditregels van alle collega's, en kan een
-- gesprek weer rechtstreeks worden verwijderd zonder redactieregel. Doe dit
-- alleen om een gefaalde uitrol te stoppen, niet als bestendige toestand.
--
-- ⚠ `governance_redacties` en `governance_audit_inzage` zijn append-only
-- AUDITTABELLEN. Ze worden hier gedropt en daarmee gaat hun inhoud verloren.
-- Exporteer ze eerst als er al redacties of inzages in staan:
--     \copy (select * from public.governance_redacties)     to 'redacties.csv' csv header
--     \copy (select * from public.governance_audit_inzage)  to 'inzage.csv'    csv header
--
-- ⚠ NIET draaien zolang code v1 live is: die roept schrijf_ai_interactie() en
-- verwijder_gesprek() aan. Rol eerst de code terug.
--
-- `fn_log_append_only()` wordt NIET gedropt: die is gedeeld met governance_log,
-- risico_log, procedure_log, agendapunt_log en aqlab_log.
-- ============================================================================

begin;

-- VOLGORDE. Eerst de afhankelijke objecten (RPC's, view), dan de policies, dan
-- de tabellen — en pas daarná de helperfuncties. Andersom weigert Postgres de
-- drop, want de policies "redacties lezen" en "eigen inzage lezen" hangen aan
-- mag_audit_redacties() en de view aan mag_audit()/meta_*().

-- ── RPC's en view ───────────────────────────────────────────────────────────
drop function if exists public.verwijder_gesprek(uuid, uuid);
drop function if exists public.schrijf_ai_interactie(
  text, text, jsonb, text, text, jsonb, jsonb, uuid, text, smallint, smallint);
drop function if exists public.lees_governance_audit(uuid, jsonb, text, int, boolean);
drop view     if exists public.vw_governance_audit;

-- ── governance_log: terug naar de fondsbrede policy ────────────────────────
drop policy if exists "eigen auditregels lezen"          on public.governance_log;
drop policy if exists "auditregels schrijven eigen fonds" on public.governance_log;

drop policy if exists "fonds log" on public.governance_log;
create policy "fonds log" on public.governance_log
  for all
  using      (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── gesprekken: terug naar één for-all-policy ──────────────────────────────
drop policy if exists "eigen gesprekken lezen"    on public.gesprekken;
drop policy if exists "eigen gesprekken aanmaken" on public.gesprekken;
drop policy if exists "eigen gesprekken bijwerken" on public.gesprekken;

drop policy if exists "eigen gesprekken" on public.gesprekken;
create policy "eigen gesprekken" on public.gesprekken
  for all
  using (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  )
  with check (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- ── Tabellen (hun policies verdwijnen mee) ─────────────────────────────────
drop table if exists public.governance_audit_inzage;
drop table if exists public.governance_audit_grants;
drop table if exists public.governance_redacties;

-- ── Helperfuncties, nu niets er meer aan hangt ─────────────────────────────
drop function if exists public.meta_basisniveau(jsonb);
drop function if exists public.meta_bronniveau(jsonb);
drop function if exists public.meta_projectie(jsonb, boolean);
drop function if exists public.mag_audit(uuid);
drop function if exists public.mag_audit_bronnen(uuid);
drop function if exists public.mag_audit_redacties(uuid);

commit;
