-- ============================================================================
--  Migratie 2026-07-31 — R6: default privileges dichtzetten (vervolg op R4)
--
--  BEVINDING O-03b (gevonden 31-07-2026 uit de pg_default_acl-uitdraai)
--
--  WAT DE METING LIET ZIEN
--  R4 heeft gewerkt — voor de helft. In pg_default_acl staan voor schema
--  `public` TWEE eigenaren met eigen default-ACL's:
--
--    defaclrole = postgres, objtype = r (tabellen):
--        anon = rm            → alleen SELECT (+MAINTAIN). R4-effect zichtbaar.
--        authenticated = arwdm → INSERT/SELECT/UPDATE/DELETE (+MAINTAIN),
--                                géén TRUNCATE/REFERENCES/TRIGGER. Zoals bedoeld.
--
--    defaclrole = supabase_admin, objtype = r (tabellen):
--        anon = arwdDxtm          ← ALLES, inclusief INSERT en TRUNCATE
--        authenticated = arwdDxtm ← ALLES, inclusief TRUNCATE
--
--  `alter default privileges` werkt per EIGENAAR. R4 draaide als `postgres` en
--  raakte daarom alleen de eerste set. GEVOLG: elke tabel die door
--  `supabase_admin` in `public` wordt aangemaakt, krijgt de volledige
--  Supabase-standaardgrant terug — inclusief INSERT voor de publieke anon-key en
--  TRUNCATE, dat RLS niet afdekt. Bevinding O-03 kan dus terugkomen zonder dat
--  iemand iets fout doet.
--
--  Daarnaast, voor FUNCTIES (objtype = f), bij BEIDE eigenaren:
--        anon = X → elke nieuwe functie in `public` is standaard uitvoerbaar
--                   door de publieke anon-key.
--  Dat is dezelfde klasse. De repo kent de les al — zie de comment in
--  2026_07_17_t15_stuurinfo_spreiding_soli.sql r.38 ("revoke from PUBLIC én
--  anon — T14b-les") — maar die discipline is handwerk per migratie. Voor de
--  postgres-kant zetten we hem hier structureel goed.
--
--  WAT DEZE MIGRATIE DOET
--   1. postgres-kant: EXECUTE op nieuwe functies niet meer standaard aan anon.
--   2. postgres-kant: MAINTAIN weg bij anon (PG17+; staat als `m` in de ACL).
--   3. supabase_admin-kant: POGING tot dezelfde intrekking. Dit vereist
--      lidmaatschap van `supabase_admin`, en op een gehost Supabase-project is
--      `postgres` dat doorgaans NIET. Slaagt het niet, dan meldt deze migratie
--      dat expliciet en gaat hij door — een mislukte poging mag de rest niet
--      blokkeren, maar mag ook niet stil blijven.
--
--  WAT ALS STAP 3 FAALT
--  Dan is preventie op dat pad niet mogelijk met de rechten die je hebt, en
--  wordt DETECTIE de maatregel: gate F in
--  supabase/checks/2026_07_31_r1_structurele_gates.sql vangt elke terugkeer van
--  schrijfrechten of TRUNCATE bij anon/authenticated. Zet die gate dan in CI
--  (bevinding H-17) en noteer in het reviewdossier dat dit een geaccepteerd,
--  gedetecteerd-maar-niet-voorkomen risico is. Dat is een bestuurlijk besluit,
--  geen technisch detail: je vertrouwt dan op een controle achteraf in plaats
--  van op een barrière vooraf.
--
--  BELANGRIJK: dit raakt alleen TOEKOMSTIGE objecten. Bestaande tabellen en
--  functies zijn door R4 respectievelijk door de losse revokes in de migraties
--  al afgehandeld.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent. Rollback: 2026_07_31_r6_default_privileges_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. Functies: geen automatische EXECUTE voor anon (postgres-kant) ────────
--  De drie publieke RPC's die anon WEL nodig heeft (resolve_tenant_host,
--  contact_aanvraag_insert, contact_notificatie_status) hebben een expliciete
--  grant uit 2026_07_12_d1_service_role_rpcs.sql en blijven ongemoeid: dit
--  raakt uitsluitend functies die hierna worden aangemaakt.
alter default privileges in schema public
  revoke execute on functions from anon;

-- ── 2. MAINTAIN weg bij anon op nieuwe tabellen (PG17+) ────────────────────
--  MAINTAIN (VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH MATVIEW) heeft geen enkele
--  applicatiefunctie nodig. Praktisch risico is klein — PostgREST biedt geen
--  endpoint voor die commando's — maar het hoort niet bij een publieke rol.
--  Guard op serverversie: vóór PG17 bestaat het recht niet en zou dit falen.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges in schema public revoke maintain on tables from anon';
    raise notice 'R6: MAINTAIN ingetrokken bij anon (postgres-kant).';
  else
    raise notice 'R6: server < PG17, MAINTAIN bestaat niet — stap 2 overgeslagen.';
  end if;
end $$;

-- ── 3. Poging op de supabase_admin-kant ────────────────────────────────────
do $$
declare
  cmd text;
  mislukt text := '';
begin
  foreach cmd in array array[
    'alter default privileges for role supabase_admin in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon',
    'alter default privileges for role supabase_admin in schema public revoke truncate, references, trigger on tables from authenticated',
    'alter default privileges for role supabase_admin in schema public revoke execute on functions from anon'
  ] loop
    begin
      execute cmd;
    exception when others then
      mislukt := mislukt || format('  - %s%s    → %s%s', left(cmd, 90), chr(10), sqlerrm, chr(10));
    end;
  end loop;

  if mislukt <> '' then
    raise warning E'R6: de supabase_admin-kant kon NIET worden dichtgezet:\n%\nDit is geen fout in deze migratie: `alter default privileges` vereist lidmaatschap van de eigenaar-rol, en `postgres` is op een gehost project doorgaans geen lid van `supabase_admin`. GEVOLG: een tabel die door supabase_admin in `public` wordt aangemaakt, krijgt opnieuw de volledige grant (incl. INSERT voor anon en TRUNCATE). Zet gate F uit supabase/checks/2026_07_31_r1_structurele_gates.sql in CI en noteer dit als geaccepteerd, gedetecteerd-maar-niet-voorkomen risico.', mislukt;
  else
    raise notice 'R6 OK: ook de supabase_admin-kant is dichtgezet.';
  end if;
end $$;

-- ── 4. Verificatie: de postgres-kant MOET kloppen ──────────────────────────
do $$
declare
  acl aclitem[];
  fouten text := '';
begin
  -- 4a. tabellen, postgres-kant: anon mag alleen nog lezen.
  select d.defaclacl into acl
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public' and d.defaclobjtype = 'r'
     and pg_get_userbyid(d.defaclrole) = 'postgres';

  if acl is not null and array_to_string(acl, ',') ~ 'anon=[^/]*[awdDxt]' then
    fouten := fouten || format('  - tabellen (postgres): anon houdt schrijfrechten: %s%s', array_to_string(acl, ','), chr(10));
  end if;

  -- 4b. functies, postgres-kant: anon krijgt geen automatische EXECUTE meer.
  select d.defaclacl into acl
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public' and d.defaclobjtype = 'f'
     and pg_get_userbyid(d.defaclrole) = 'postgres';

  if acl is not null and array_to_string(acl, ',') ~ 'anon=[^/]*X' then
    fouten := fouten || format('  - functies (postgres): anon houdt EXECUTE: %s%s', array_to_string(acl, ','), chr(10));
  end if;

  if fouten <> '' then
    raise exception E'R6 FAALT op de postgres-kant:\n%', fouten;
  end if;
  raise notice 'R6 OK: postgres-kant dichtgezet voor tabellen én functies.';
end $$;

commit;

-- ============================================================================
--  Verificatie ná de migratie
-- ============================================================================
-- 1. Herhaal de uitdraai en vergelijk:
--      select pg_get_userbyid(d.defaclrole) as eigenaar, d.defaclobjtype, d.defaclacl
--        from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
--       where n.nspname = 'public' order by 1, 2;
--    → postgres/r : anon=r (of leeg), authenticated=arwd
--      postgres/f : geen anon-entry meer
--      supabase_admin/*: waarschijnlijk ONGEWIJZIGD — zie stap 3 hierboven.
--
-- 2. Welke functies mag anon vandaag uitvoeren? Verwacht exact drie:
--    resolve_tenant_host, contact_aanvraag_insert, contact_notificatie_status.
--      select p.proname, pg_get_function_identity_arguments(p.oid) as args
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and has_function_privilege('anon', p.oid, 'EXECUTE')
--       order by 1;
--    Staat daar meer, beoordeel dan per functie of dat bewust is — een
--    SECURITY DEFINER-functie die anon mag aanroepen, omzeilt RLS volledig.
