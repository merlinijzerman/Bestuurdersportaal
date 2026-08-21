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
-- dezelfde waarde als GitHub-secret DRIFT_DB_PASSWORD. Bewaar hem verder in de
-- wachtwoordkluis, niet in een document, een ticket of een chat.
--
-- ── DRIE DINGEN DIE UIT HET ECHT DRAAIEN KWAMEN (21-08-2026) ────────────────
-- Dit script is uitgevoerd tegen een wegwerp-PG17-stack met het volledige
-- schema, en daarbij bleken drie dingen die op papier niet zichtbaar waren.
--
-- 1. `alter role ... nosuperuser` WERKT NIET OP SUPABASE.
--    `postgres` is daar zelf geen superuser, en het zetten of wissen van het
--    SUPERUSER-attribuut vereist superuser. De regel gaf
--    "permission denied to alter role", en omdat dit script in één
--    begin/commit draait rolde daarmee ook de CREATE ROLE terug — je houdt dan
--    helemaal niets over. De regel is weg: CREATE ROLE levert standaard al
--    NOSUPERUSER op. De vier andere attributen (nobypassrls, nocreatedb,
--    nocreaterole, noinherit) kunnen wél en staan er expliciet.
--
-- 2. ZONDER DE BUCKETPOLICY HIERONDER MEET DE HELE CONTROLE NIETS OP STORAGE.
--    `storage.buckets` heeft RLS AAN en NUL policies. Een rol met SELECT maar
--    zonder BYPASSRLS ziet daar dus 0 rijen — geen fout, geen waarschuwing,
--    gewoon niets. Gemeten: `postgres` 4 buckets, `drift_lezer` 0.
--    De momentopname velt geen oordeel maar produceert regels; pin je hem in
--    die toestand, dan bevries je "er zijn geen buckets" als de VERWACHTE
--    toestand en wordt bucketdrift nooit meer opgemerkt. Precies de categorie
--    waar bevinding P0-3 zit. Vandaar een expliciete leespolicy op ALLEEN de
--    definities; `storage.objects` blijft dicht.
--
-- 3. DE MOMENTOPNAME IS ROL-AFHANKELIJK ZONDER `usage on schema public`.
--    `md5(pg_get_functiondef(oid))` rendert typenamen schema-gekwalificeerd of
--    niet, afhankelijk van wat de rol kan zien. Zonder die USAGE veranderde
--    ELKE functiehash — 700+ regels vals verschil. Mét de grants hieronder
--    leveren `postgres` en `drift_lezer` een BYTE-IDENTIEKE momentopname
--    (718 regels, gemeten). Pin en vergelijk desondanks altijd met dezelfde
--    rol; dat is één regel discipline die een klasse valse alarmen uitsluit.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'drift_lezer') then
    -- NOSUPERUSER is hier de default en wordt bewust NIET via ALTER gezet; zie
    -- punt 1 in de kop.
    create role drift_lezer login password '<ZET-HIER-EEN-STERK-WACHTWOORD>';
  end if;
end $$;

-- Geen RLS-bypass, geen rolbeheer, en geen erfenis van rechten via rollen die
-- later aan drift_lezer worden toegekend.
alter role drift_lezer nobypassrls nocreatedb nocreaterole noinherit;

-- Catalogus is standaard leesbaar; expliciet maken wat de momentopname raakt.
-- `usage on schema public` is GEEN formaliteit — zie punt 3 in de kop.
grant connect on database postgres to drift_lezer;
grant usage on schema public  to drift_lezer;
grant usage on schema storage to drift_lezer;

-- Uitsluitend de bucket-DEFINITIES, niet de objecten erin. storage.objects
-- blijft bewust buiten bereik: de momentopname telt geen bestanden en heeft
-- geen enkele reden om documentnamen van fondsen te kunnen zien.
grant select on storage.buckets to drift_lezer;

-- En de policy die dat SELECT-recht pas werkzaam maakt; zie punt 2 in de kop.
-- Alleen SELECT, alleen voor deze rol, alleen op de definities.
drop policy if exists "drift_lezer leest bucketdefinities" on storage.buckets;
create policy "drift_lezer leest bucketdefinities"
  on storage.buckets for select to drift_lezer using (true);

-- Geen tabelrechten in public. pg_policies, pg_proc, pg_class, pg_extension en
-- pg_publication zijn systeemcatalogi en vereisen geen grant.
revoke all on all tables    in schema public from drift_lezer;
revoke all on all sequences in schema public from drift_lezer;
revoke all on all functions in schema public from drift_lezer;

-- Eindcontrole: fail-closed als de rol méér OF MINDER kan dan bedoeld.
do $$
declare
  v_super    boolean;
  v_bypass   boolean;
  v_tabellen integer;
  v_buckets  integer;  -- aantal leespolicies op storage.buckets voor deze rol
begin
  select rolsuper, rolbypassrls into v_super, v_bypass
    from pg_roles where rolname = 'drift_lezer';

  select count(*) into v_tabellen
    from information_schema.role_table_grants
   where grantee = 'drift_lezer' and table_schema = 'public';

  if v_super or v_bypass or v_tabellen > 0 then
    raise exception
      'DRIFT_ROL_TE_RUIM: super=% bypassrls=% tabelrechten_public=%',
      v_super, v_bypass, v_tabellen;
  end if;

  -- TE KRAP is hier net zo fout als te ruim, en veel moeilijker te zien: een
  -- rol die niets mag levert een lege momentopname en dus een groene controle
  -- die niets controleert.
  --
  -- Getoetst wordt de VOORWAARDE, niet het effect. Twee eerdere vormen werkten
  -- niet, allebei gemeten op 21-08-2026:
  --   • `select count(*) from storage.buckets` telt wat POSTGRES ziet, en die
  --     heeft BYPASSRLS — die guard gaat nooit af, juist wanneer je hem nodig
  --     hebt;
  --   • `set local role drift_lezer` eerst doen mag niet: postgres is geen lid
  --     van die rol ("permission denied to set role"), en er een grant voor
  --     maken is een rechtenuitbreiding om een controle te kunnen draaien.
  -- Wat wél als postgres leesbaar is: bestaat de leespolicy voor deze rol.
  select count(*) into v_buckets
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'buckets'
     and cmd in ('SELECT', 'ALL')
     and 'drift_lezer' = any(roles);

  if v_buckets = 0 then
    raise exception
      'DRIFT_ROL_ZIET_GEEN_BUCKETS: geen SELECT-policy op storage.buckets voor '
      'drift_lezer. RLS staat daar AAN met nul policies, dus de rol ziet 0 '
      'definities: de bucketcategorie zou leeg worden gepind en bucketdrift '
      'nooit opvallen.';
  end if;
end $$;

commit;

-- Controleer daarna handmatig dat de rol wérkt en niet meer dan dat. Alle vier
-- zijn op 21-08-2026 gemeten op een wegwerp-PG17-stack met het volle schema:
--
--   1. momentopname draait en levert regels (718, gelijk aan die van postgres):
--        psql "$DRIFT_URL" -At -f supabase/checks/2026_08_19_drift_momentopname.sql | wc -l
--   2. buckets zijn zichtbaar (verwacht: het aantal dat postgres ook ziet):
--        psql "$DRIFT_URL" -c "select count(*) from storage.buckets;"
--   3. fondsdata is dicht — MOET falen met permission denied:
--        psql "$DRIFT_URL" -c "select * from public.profielen limit 1;"
--   4. storage-objecten zijn dicht — MOET falen met permission denied:
--        psql "$DRIFT_URL" -c "select * from storage.objects limit 1;"
