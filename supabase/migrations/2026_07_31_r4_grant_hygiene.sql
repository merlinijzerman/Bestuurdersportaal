-- ============================================================================
--  Migratie 2026-07-31 — R4: granthygiëne op schema `public`
--
--  BEVINDING O-03, opgewaardeerd van Observatie naar HOOG op 31-07-2026 na
--  inspectie van information_schema.role_table_grants in productie.
--
--  WAT DE METING LIET ZIEN
--  De rol `anon` — de rol achter de PUBLIEKE, in de browserbundel meegeleverde
--  NEXT_PUBLIC_SUPABASE_ANON_KEY — houdt op ELKE tabel in `public`
--  (95 tabellen plus de view vw_dossier_status) het volledige pakket:
--
--      DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
--  Enige uitzondering: rate_limit_events, waarop 2026_06_10_rate_limiting.sql
--  een expliciete revoke doet. Dat bevestigt tegelijk dat de revoke werkt en dat
--  hij nergens anders is toegepast. Dit is de Supabase-standaardgrant
--  (`grant all on all tables in schema public to anon, authenticated`), niet
--  iets wat dit project bewust heeft gezet.
--
--  WAAROM DIT ERTOE DOET
--  RLS is hiermee de ENIGE barrière. Eén te ruime policy is dan meteen een
--  volwaardig schrijfpad voor een ongeauthenticeerde partij — precies wat
--  bevinding K-02 was: "chunks schrijven" (INSERT, TO public, with_check = true)
--  werd exploitabel omdat anon de INSERT-grant al had. Zonder die grant was
--  diezelfde kapotte policy een dode letter geweest.
--
--  Twee rechten verdienen aparte aandacht omdat RLS ze NIET afdekt:
--
--    TRUNCATE — Postgres past géén row level security toe op TRUNCATE. Wie het
--      recht heeft, leegt de hele tabel, ongeacht welke policies er staan. Dat
--      raakt rechtstreeks de append-only auditsporen (governance_log,
--      platform_event_log, vergadering_log, document_inzage, risico_log,
--      procedure_log, catalogus_log, fonds_config_log, bron_whitelist_log,
--      document_metadata_log, decision_audit_snapshots). Het uitgangspunt
--      "auditdata mag niet manipuleerbaar zijn" is met dit recht niet houdbaar.
--      PostgREST biedt zelf geen truncate-endpoint, maar de grant staat wél op
--      de rol en is bereikbaar voor elke directe verbinding met dezelfde rol.
--
--    TRIGGER / REFERENCES — het recht om een eigen trigger of foreign key op een
--      tabel te hangen. Geen enkele applicatiefunctie heeft dit nodig.
--
--  WAT DEZE MIGRATIE DOET — EN BEWUST NIET
--   1. anon           → INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER weg.
--   2. authenticated   → TRUNCATE, REFERENCES, TRIGGER weg. SELECT/INSERT/UPDATE/
--                        DELETE blijven: daar hóórt RLS de grens te trekken, en
--                        de app draait volledig op deze rol.
--   3. Default privileges aangepast, zodat een nieuw aangemaakte tabel de grants
--      niet automatisch terugkrijgt. Zonder deze stap groeit de bevinding terug
--      bij de eerstvolgende create table.
--
--   NIET in deze migratie: het intrekken van SELECT bij `anon`. Dat is een
--   grotere ingreep die eerst bewijs vergt dat geen enkel publiek pad leest
--   (gate D toont aan dat RLS anon nu al nul rijen teruggeeft, maar dat is een
--   ander argument dan "de grant mag weg"). Zie de vervolgacties onderaan.
--
--  REGRESSIERISICO: nihil, gecontroleerd op 31-07-2026.
--   - De enige anon-clients in de codebase zijn core/lib/tenant-domains.ts en
--     app/api/contact/route.ts. Beide roepen UITSLUITEND SECURITY DEFINER-RPC's
--     aan (resolve_tenant_host, contact_aanvraag_insert,
--     contact_notificatie_status); geen enkele .from()-aanroep. Een SECURITY
--     DEFINER-functie draait met de rechten van de eigenaar en heeft de
--     tabelgrant van de aanroeper niet nodig. De EXECUTE-grants op die drie
--     functies blijven onaangeroerd.
--   - Ingelogd verkeer draait op `authenticated`, niet op `anon`; punt 1 raakt
--     de applicatie dus niet.
--   - De app truncate't nergens en maakt geen triggers of foreign keys aan
--     namens een eindgebruiker; punt 2 raakt niets.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent. Rollback: 2026_07_31_r4_grant_hygiene_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. anon: alle schrijfrechten weg ────────────────────────────────────────
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon;

-- ── 2. authenticated: de rechten die RLS niet afdekt ────────────────────────
revoke truncate, references, trigger
  on all tables in schema public from authenticated;

-- ── 3. Voorkom terugkeer bij nieuwe tabellen ────────────────────────────────
--  Let op: dit werkt alleen voor objecten die door de HUIDIGE rol worden
--  aangemaakt (in de SQL-editor is dat `postgres`). Maakt een ander rol-account
--  tabellen aan, dan moet dezelfde regel voor die rol worden gezet — de
--  diagnosequery onderaan laat zien welke defaclrole-entries er staan.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- ── 4. Fail-closed verificatie binnen dezelfde transactie ───────────────────
do $$
declare
  n_anon_write int;
  n_trunc      int;
  n_select_ok  int;
  fouten       text := '';
begin
  -- 4a. anon mag nergens meer schrijven.
  select count(*) into n_anon_write
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'anon'
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
  if n_anon_write <> 0 then
    fouten := fouten || format('  - anon houdt nog %s schrijfgrant(s) in public%s', n_anon_write, chr(10));
  end if;

  -- 4b. niemand van de twee PostgREST-rollen mag nog truncaten.
  select count(*) into n_trunc
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon','authenticated')
     and privilege_type = 'TRUNCATE';
  if n_trunc <> 0 then
    fouten := fouten || format('  - TRUNCATE staat nog op %s tabel/rol-combinatie(s) — RLS dekt dat niet af%s', n_trunc, chr(10));
  end if;

  -- 4c. de app moet blijven werken: authenticated houdt SELECT.
  select count(*) into n_select_ok
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT';
  if n_select_ok = 0 then
    fouten := fouten || '  - authenticated heeft NERGENS meer SELECT — te ver ingetrokken, de app is stuk' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'R4 FAALT:\n%', fouten;
  end if;
  raise notice 'R4 OK: anon schrijft nergens meer; TRUNCATE/REFERENCES/TRIGGER weg bij beide PostgREST-rollen; authenticated houdt % SELECT-grants.', n_select_ok;
end $$;

commit;

-- ============================================================================
--  Verificatie ná de migratie (handmatig; leesbaar, wijzigt niets)
-- ============================================================================
-- 1. Wat houdt anon nog over? (verwacht: alleen SELECT, en niets op
--    rate_limit_events)
--      select privilege_type, count(*)
--        from information_schema.role_table_grants
--       where table_schema='public' and grantee='anon'
--       group by 1 order by 1;
--
-- 2. Wat houdt authenticated over? (verwacht: SELECT, INSERT, UPDATE, DELETE)
--      select privilege_type, count(*)
--        from information_schema.role_table_grants
--       where table_schema='public' and grantee='authenticated'
--       group by 1 order by 1;
--
-- 3. Default privileges — staan er nog entries die de grants terugzetten bij een
--    nieuwe tabel, en onder welke defaclrole?
--      select pg_get_userbyid(d.defaclrole) as eigenaar,
--             n.nspname as schema, d.defaclobjtype, d.defaclacl
--        from pg_default_acl d
--        join pg_namespace n on n.oid = d.defaclnamespace
--       where n.nspname = 'public';
--    → verschijnt hier een andere eigenaar dan `postgres`, herhaal stap 3 van
--      deze migratie ingelogd als díe rol.
--
-- 4. Rookproef in de app (verplicht vóór akkoord):
--      - publieke website laden op een tenantdomein → resolve_tenant_host werkt;
--      - contactformulier verzenden → 200, rij in contact_aanvragen;
--      - inloggen, document openen, chatvraag stellen, besluit vastleggen.
--
-- ============================================================================
--  Vervolgacties (bewust NIET in deze migratie)
-- ============================================================================
-- a) SELECT intrekken bij `anon`. Vergt eerst een bewezen inventarisatie van
--    alle publieke leespaden. Aanpak: laat gate D draaien (die toont dat RLS nu
--    al nul rijen teruggeeft), trek daarna SELECT in op een staging-kopie en
--    draai de volledige rookproef. Winst is verdedigbaar maar kleiner dan die
--    van de schrijfrechten: RLS doet hier al het werk.
--
-- b) `authenticated` per tabel fijnmaziger maken (bijv. geen INSERT/UPDATE op de
--    append-only logtabellen — die worden door SECURITY DEFINER-RPC's en de
--    service-role geschreven). Dat zou het "auditdata is niet manipuleerbaar"-
--    uitgangspunt van een tweede slot voorzien naast RLS. Vergt per tabel
--    onderzoek naar welke rol daadwerkelijk schrijft; hoort in een eigen ronde.
--
-- c) Baseline pinnen (bevinding H-17). Dump pg_policies, pg_proc(prosecdef),
--    pg_trigger én information_schema.role_table_grants naar de repo en laat CI
--    op drift breken. Deze bevinding kwam boven omdat een mens toevallig keek —
--    dat is geen beheersmaatregel.
