-- ============================================================================
-- Wetsgeschiedenis A-light foundation — DB-invarianten op documenten.
-- ----------------------------------------------------------------------------
-- Doel: bewijzen dat de CHECKs uit migratie
-- 2026_09_23_wetsgeschiedenis_a_light_foundation.sql in de DATABASE gelden (niet
-- alleen in valideerCuratie), en dat bestaande documenttypen en de chunk-
-- denormalisatie ongewijzigd werken. Elke overtreding → `raise exception` →
-- psql exit-code <> 0 → CI faalt.
--
-- Scenario's:
--   W1  — geldige MvT (generiek, subtype, dossier, informatief) wordt aanvaard.
--   W2  — wetsgeschiedenis met normgewicht ≠ informatief (o.a. een aangenomen
--         amendement als 'bindend') wordt geweigerd.
--   W3  — wetsgeschiedenis zonder subtype of zonder dossiernummer: geweigerd
--         (ook memorie van antwoord); alleen een nota van toelichting (AMvB)
--         mag zonder dossiernummer.
--   W4  — subtype/dossiernummer bij een ander documenttype: geweigerd.
--   W5  — ongeldig subtype (bv. verworpen amendement) of niet-genormaliseerd
--         dossiernummer: geweigerd.
--   W6  — actuele wetgeving als bindende generieke bron: aanvaard.
--   W7  — een FONDSdocument kan geen wetgeving/wetsgeschiedenis zijn.
--   W8  — onder échte RLS: fondsgebruiker kan het eigen fondsdocument niet
--         omtypen naar 'wetgeving'.
--   W9  — non-regressie: bestaande documenttypen en NULL blijven geldig.
--   W10 — denormalisatie: documenttype 'wetsgeschiedenis' komt op de chunk;
--         subtype/dossiernummer bewust niet (geen chunkkolom).
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak en de CHECK-scenario's (CHECKs gelden voor
--      elke rol, ook BYPASSRLS); authenticated voor W8 — die meting gebeurt
--      onder RLS, niet onder BYPASSRLS.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- Hulpfunctie: probeer een statement; true = geweigerd door een CHECK.
create or replace function pg_temp.geweigerd(p_sql text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end;
$$;

-- ── W1 (positief): geldige memorie van toelichting ──────────────────────────
insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   documenttype, wetsgeschiedenis_subtype, dossiernummer, normgewicht,
   wettelijk_regime, extern_url, documentdatum)
values
  ('0a230900-0000-0000-0000-0000000000a1', null, 'generiek', 'Extern',
   'Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3',
   'van_kracht', 'actief', true,
   'wetsgeschiedenis', 'memorie_van_toelichting', '36067', 'informatief',
   'beide', 'https://zoek.officielebekendmakingen.nl/kst-36067-3.html', '2022-03-30');

do $$ begin raise notice 'OK W1: geldige MvT aanvaard.'; end $$;

-- ── W2: wetsgeschiedenis is nooit bindend ───────────────────────────────────
do $$
declare ng text;
begin
  foreach ng in array array['bindend','toezichtverwachting','sector_guidance','onbekend'] loop
    if not pg_temp.geweigerd(format(
      $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
           wetsgeschiedenis_subtype, dossiernummer, normgewicht)
         values (null,'generiek','Extern','Amendement 36 067 nr. 97','wetsgeschiedenis',
           'aangenomen_amendement','36067',%L)$f$, ng)) then
      raise exception 'LEK W2: wetsgeschiedenis met normgewicht % aanvaard.', ng;
    end if;
  end loop;
  if not pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
         wetsgeschiedenis_subtype, dossiernummer, normgewicht)
       values (null,'generiek','Extern','Amendement 36 067 nr. 97','wetsgeschiedenis',
         'aangenomen_amendement','36067',null)$f$) then
    raise exception 'LEK W2: wetsgeschiedenis zonder normgewicht (NULL) aanvaard.';
  end if;
  -- Ook achteraf ophogen via UPDATE wordt geweigerd.
  if not pg_temp.geweigerd(
    $f$update public.documenten set normgewicht='bindend'
        where id='0a230900-0000-0000-0000-0000000000a1'$f$) then
    raise exception 'LEK W2: MvT via UPDATE bindend gemaakt.';
  end if;
  raise notice 'OK W2: wetsgeschiedenis alleen informatief (insert én update).';
end $$;

-- ── W3: subtype en dossiernummer verplicht bij wetsgeschiedenis ─────────────
do $$
begin
  if not pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
         dossiernummer, normgewicht)
       values (null,'generiek','Extern','MvT 36 067','wetsgeschiedenis','36067','informatief')$f$) then
    raise exception 'LEK W3: wetsgeschiedenis zonder subtype aanvaard.';
  end if;
  if not pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
         wetsgeschiedenis_subtype, normgewicht)
       values (null,'generiek','Extern','MvT','wetsgeschiedenis','memorie_van_toelichting','informatief')$f$) then
    raise exception 'LEK W3: wetsgeschiedenis zonder dossiernummer aanvaard.';
  end if;
  if not pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
         wetsgeschiedenis_subtype, normgewicht)
       values (null,'generiek','Extern','Nadere memorie van antwoord','wetsgeschiedenis',
         'memorie_van_antwoord','informatief')$f$) then
    raise exception 'LEK W3: memorie van antwoord zonder dossiernummer aanvaard.';
  end if;
  -- Positief: nota van toelichting bij een AMvB zonder Kamerstukdossier.
  if pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
         wetsgeschiedenis_subtype, normgewicht, extern_url)
       values (null,'generiek','Extern',
         'Nota van toelichting — Besluit toekomst pensioenen, Stb. 2023, 217',
         'wetsgeschiedenis','nota_van_toelichting','informatief',
         'https://zoek.officielebekendmakingen.nl/stb-2023-217.html')$f$) then
    raise exception 'REGRESSIE W3: nota van toelichting zonder dossiernummer geweigerd.';
  end if;
  -- Ook een nota van toelichting blijft informatief.
  if not pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
         wetsgeschiedenis_subtype, normgewicht)
       values (null,'generiek','Extern','NvT Stb. 2025, 423','wetsgeschiedenis',
         'nota_van_toelichting','bindend')$f$) then
    raise exception 'LEK W3: nota van toelichting als bindend aanvaard.';
  end if;
  raise notice 'OK W3: subtype verplicht; dossiernummer verplicht behalve bij nota van toelichting.';
end $$;

-- ── W4: subtype/dossiernummer alleen bij wetsgeschiedenis ───────────────────
do $$
begin
  if not pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
         wetsgeschiedenis_subtype, normgewicht)
       values (null,'generiek','Extern','Pensioenwet','wetgeving','memorie_van_toelichting','bindend')$f$) then
    raise exception 'LEK W4: subtype bij wetgeving aanvaard.';
  end if;
  if not pg_temp.geweigerd(
    $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, dossiernummer)
       values (null,'generiek','Extern','DNB-leidraad','36067')$f$) then
    raise exception 'LEK W4: dossiernummer zonder documenttype aanvaard.';
  end if;
  raise notice 'OK W4: subtype/dossiernummer alleen bij wetsgeschiedenis.';
end $$;

-- ── W5: waardedomeinen ──────────────────────────────────────────────────────
do $$
declare st text; dn text;
begin
  foreach st in array array['verworpen_amendement','ingetrokken_amendement','amendement'] loop
    if not pg_temp.geweigerd(format(
      $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
           wetsgeschiedenis_subtype, dossiernummer, normgewicht)
         values (null,'generiek','Extern','x 36067','wetsgeschiedenis',%L,'36067','informatief')$f$, st)) then
      raise exception 'LEK W5: subtype % aanvaard.', st;
    end if;
  end loop;
  foreach dn in array array['36 067','36.067','12','36200-xv','kst-36067-3'] loop
    if not pg_temp.geweigerd(format(
      $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
           wetsgeschiedenis_subtype, dossiernummer, normgewicht)
         values (null,'generiek','Extern','x','wetsgeschiedenis','nota_van_wijziging',%L,'informatief')$f$, dn)) then
      raise exception 'LEK W5: niet-genormaliseerd dossiernummer % aanvaard.', dn;
    end if;
  end loop;
  -- Canonieke vormen zijn wél geldig.
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, documenttype,
    wetsgeschiedenis_subtype, dossiernummer, normgewicht)
  values (null,'generiek','Extern','Nota van wijziging — Kamerstukken II, 36 200-XV, nr. 8',
    'wetsgeschiedenis','nota_van_wijziging','36200-XV','informatief');
  raise notice 'OK W5: waardedomeinen subtype en dossiernummer afgedwongen.';
end $$;

-- ── W6 (positief): actuele wetgeving als bindende generieke bron ────────────
insert into public.documenten
  (fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   documenttype, normgewicht, wettelijk_regime, extern_url)
values
  (null, 'generiek', 'Extern', 'Pensioenwet — geconsolideerde tekst (BWBR0020809)',
   'van_kracht', 'actief', true, 'wetgeving', 'bindend', 'pw',
   'https://wetten.overheid.nl/BWBR0020809');

do $$ begin raise notice 'OK W6: wetgeving als bindende generieke bron aanvaard.'; end $$;

-- ── Seed fonds + gebruiker voor W7–W9 ───────────────────────────────────────
insert into public.fondsen (id, naam, slug)
values ('0a230900-1111-1111-1111-111111111111', 'WG Testfonds A', 'wg-testfonds-a');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('0a230900-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','wg-a@test.local',
   '{"naam":"WG A","fonds_id":"0a230900-1111-1111-1111-111111111111"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id='0a230900-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '0a230900-1111-1111-1111-111111111111'::uuid then
    raise exception 'SEED FAALT: profiel WG A niet aan fonds A gekoppeld (trigger maak_profiel).';
  end if;
end $$;

insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, documenttype, opgeslagen_door)
values
  ('0a230900-0000-0000-0000-0000000000f1', '0a230900-1111-1111-1111-111111111111', 'fonds',
   'Intern', 'WG fondsrapportage', 'rapportage', '0a230900-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ── W7: een fondsdocument is nooit wetgeving/wetsgeschiedenis ───────────────
do $$
declare t text;
begin
  foreach t in array array['wetgeving','wetsgeschiedenis'] loop
    if not pg_temp.geweigerd(format(
      $f$update public.documenten set documenttype=%L
          where id='0a230900-0000-0000-0000-0000000000f1'$f$, t)) then
      raise exception 'LEK W7: fondsdocument als % geclassificeerd.', t;
    end if;
  end loop;
  raise notice 'OK W7: juridische typen alleen in de generieke bibliotheek.';
end $$;

-- ── W9 (non-regressie): bestaande typen en NULL blijven geldig ──────────────
do $$
declare t text;
begin
  foreach t in array array['beleid','besluit','besluitdocument','besluitregistratie',
    'bestuursvoorstel','notulen','advies','memo','analyse','rapportage','bijlage','overig'] loop
    if pg_temp.geweigerd(format(
      $f$update public.documenten set documenttype=%L
          where id='0a230900-0000-0000-0000-0000000000f1'$f$, t)) then
      raise exception 'REGRESSIE W9: bestaand documenttype % geweigerd.', t;
    end if;
  end loop;
  if pg_temp.geweigerd(
    $f$update public.documenten set documenttype=null
        where id='0a230900-0000-0000-0000-0000000000f1'$f$) then
    raise exception 'REGRESSIE W9: documenttype NULL geweigerd.';
  end if;
  update public.documenten set documenttype='rapportage'
   where id='0a230900-0000-0000-0000-0000000000f1';
  raise notice 'OK W9: bestaande documenttypen en NULL ongewijzigd geldig.';
end $$;

-- ── W10: denormalisatie naar document_chunks ────────────────────────────────
insert into public.document_chunks (document_id, chunk_index, tekst)
values ('0a230900-0000-0000-0000-0000000000a1', 0, 'II. ARTIKELSGEWIJS — synthetische testtekst');

do $$
declare v_type text; v_ng text; v_regime text;
begin
  select documenttype, normgewicht, wettelijk_regime into v_type, v_ng, v_regime
    from public.document_chunks
   where document_id = '0a230900-0000-0000-0000-0000000000a1' and chunk_index = 0;
  if v_type is distinct from 'wetsgeschiedenis' or v_ng is distinct from 'informatief'
     or v_regime is distinct from 'beide' then
    raise exception 'REGRESSIE W10: denorm op chunk onjuist (type=%, normgewicht=%, regime=%).',
      v_type, v_ng, v_regime;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='document_chunks'
                and column_name in ('wetsgeschiedenis_subtype','dossiernummer')) then
    raise exception 'ONVERWACHT W10: subtype/dossiernummer staan op document_chunks (foundation denormaliseert ze bewust niet).';
  end if;
  raise notice 'OK W10: documenttype/normgewicht/regime gedenormaliseerd; subtype/dossier niet.';
end $$;

-- ── W8: onder RLS — fondsgebruiker kan eigen document niet tot wet maken ────
set local role authenticated;
set local request.jwt.claims to '{"sub":"0a230900-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n int;
begin
  -- Voorwaarde: de gebruiker ziet het eigen document (anders bewijst W8 niets).
  select count(*) into n from public.documenten
   where id = '0a230900-0000-0000-0000-0000000000f1';
  if n <> 1 then
    raise exception 'SEED FAALT W8: fondsgebruiker ziet het eigen fondsdocument niet.';
  end if;
  if not pg_temp.geweigerd(
    $f$update public.documenten set documenttype='wetgeving'
        where id='0a230900-0000-0000-0000-0000000000f1'$f$) then
    raise exception 'LEK W8: fondsgebruiker typeerde eigen document als wetgeving.';
  end if;
  raise notice 'OK W8: fondsgebruiker kan geen wetgeving creëren (onder RLS).';
end $$;

reset role;

rollback;
