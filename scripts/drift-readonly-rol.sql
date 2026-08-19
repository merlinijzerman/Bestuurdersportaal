-- ============================================================================
-- Read-only rol voor de nachtelijke driftdetectie (fase 5).
-- ----------------------------------------------------------------------------
-- Eenmalig met de hand uit te voeren op Preview én Productie, door iemand met
-- voldoende rechten. Daarna nooit meer aanraken.
--
-- WAAROM EEN EIGEN ROL
-- De driftcontrole draait elke nacht vanuit CI. Zou hij `postgres` of de
-- service-role gebruiken, dan heeft een CI-omgeving permanent schrijfrecht op
-- Productie voor een taak die uitsluitend leest. Dat is precies het soort
-- stilzwijgende rechtenuitbreiding dat deze hele exercitie wil uitbannen.
--
-- Deze rol kan lezen wat de momentopname nodig heeft en verder niets: geen
-- tabelinhoud, geen storage-objecten, geen DDL.
--
-- WACHTWOORD: vervang <ZET-HIER-EEN-STERK-WACHTWOORD> vóór uitvoeren, en zet
-- dezelfde waarde als GitHub-secret DRIFT_DB_PASSWORD (Preview: DRIFT_DB_
-- PASSWORD_PREVIEW). Bewaar hem verder in de wachtwoordkluis, niet in een
-- document, een ticket of een chat.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'drift_lezer') then
    create role drift_lezer login password '<ZET-HIER-EEN-STERK-WACHTWOORD>';
  end if;
end $$;

-- Geen erfenis van rechten via andere rollen.
alter role drift_lezer nobypassrls nocreatedb nocreaterole nosuperuser;

-- Catalogus is standaard leesbaar; expliciet maken wat de momentopname raakt.
grant connect on database postgres to drift_lezer;
grant usage on schema public  to drift_lezer;
grant usage on schema storage to drift_lezer;

-- Uitsluitend de bucket-DEFINITIES, niet de objecten erin. storage.objects
-- blijft bewust buiten bereik: de momentopname telt geen bestanden en heeft
-- geen enkele reden om documentnamen van fondsen te kunnen zien.
grant select on storage.buckets to drift_lezer;

-- Geen tabelrechten in public. pg_policies, pg_proc, pg_class en pg_extension
-- zijn systeemcatalogi en vereisen geen grant.
revoke all on all tables    in schema public from drift_lezer;
revoke all on all sequences in schema public from drift_lezer;
revoke all on all functions in schema public from drift_lezer;

-- Eindcontrole: fail-closed als de rol méér kan dan bedoeld.
do $$
declare
  v_super   boolean;
  v_bypass  boolean;
  v_tabellen integer;
begin
  select rolsuper, rolbypassrls into v_super, v_bypass
    from pg_roles where rolname = 'drift_lezer';

  select count(*) into v_tabellen
    from information_schema.role_table_grants
   where grantee = 'drift_lezer'
     and table_schema = 'public';

  if v_super or v_bypass or v_tabellen > 0 then
    raise exception
      'DRIFT_ROL_TE_RUIM: super=% bypassrls=% tabelrechten_public=%',
      v_super, v_bypass, v_tabellen;
  end if;
end $$;

commit;

-- Controleer daarna handmatig dat de rol wérkt en niet meer dan dat:
--   psql "postgresql://drift_lezer:...@host:5432/postgres" \
--     -At -f supabase/checks/2026_08_19_drift_momentopname.sql | head
-- en dat dit FAALT:
--   psql "postgresql://drift_lezer:...@host:5432/postgres" \
--     -c "select * from public.profielen limit 1;"
