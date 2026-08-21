-- ============================================================================
-- R1 — GEDRAGSTESTS op de vijf herstelde tenantgrenzen
-- ----------------------------------------------------------------------------
-- Bewijst dat de policies uit migratie 2026_07_31_r1_rls_tenantgrenzen.sql
-- daadwerkelijk weigeren wat ze horen te weigeren, en nog steeds toestaan wat
-- ze horen toe te staan (regressiecontrole).
--
-- Gedekt (reviewbevindingen 2026-07-30):
--   K-01  decision_dissent      — lezen, schrijven, verwijderen én injecteren
--   H-01  notificaties          — ontvanger buiten het eigen fonds
--   H-02  document_inzage       — auditregel voor een vreemd document/fonds
--   H-02  document_metadata_log — idem, incl. de nul-fonds-variant
--   M-01  agendapunt_inbreng    — inbreng op een agendapunt van een ander fonds
--
-- Zelfde patroon als 2026_07_08_t3_cross_tenant.sql DEEL 2: self-seeding via
-- auth.users (trigger maak_profiel), impersonatie met `set local role
-- authenticated` + jwt-claims, alles in één transactie met ROLLBACK.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
--             (draait in scripts/cross-tenant-ci.sh)
--          OF: hele bestand plakken in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- Geen `\set ON_ERROR_STOP on` hier: dat is een psql-CLIENTcommando en de
-- Supabase SQL-editor kent het niet ("syntax error at or near \"\\\"").
-- scripts/cross-tenant-ci.sh geeft `-v ON_ERROR_STOP=1` al op de commandoregel
-- mee, dus deze regel was dubbelop. Zonder hem draait dit bestand zowel in
-- psql/CI als rechtstreeks in de SQL-editor.

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak, authenticated per scenario — de meting
--      gebeurt onder RLS, niet onder BYPASSRLS.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

begin;

-- ── Seed: twee fondsen, twee gebruikers, objecten aan beide kanten ──────────
-- Fonds A = 44444444-…  user A = a4a4…   (bestuurder)
-- Fonds B = 55555555-…  user B = b5b5…   (bestuurder)
-- user V  = c6c6…       voorzitter in fonds A — nodig om te bewijzen dat óók
--                        een privileged rol de fondsgrens niet kan passeren.
-- `slug` is NOT NULL UNIQUE (schema.sql r.30) — expliciet meegeven.
insert into public.fondsen (id, naam, slug)
values ('44444444-4444-4444-4444-444444444444', 'R1 Testfonds A', 'r1-test-a'),
       ('55555555-5555-5555-5555-555555555555', 'R1 Testfonds B', 'r1-test-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4','authenticated','authenticated','r1-a@test.local',
   '{"naam":"R1 A","fonds_id":"44444444-4444-4444-4444-444444444444"}', now(), now()),
  ('b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5','authenticated','authenticated','r1-b@test.local',
   '{"naam":"R1 B","fonds_id":"55555555-5555-5555-5555-555555555555"}', now(), now()),
  ('c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6','authenticated','authenticated','r1-v@test.local',
   '{"naam":"R1 Voorzitter A","fonds_id":"44444444-4444-4444-4444-444444444444"}', now(), now());

update public.profielen set rol = 'voorzitter'
 where id = 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6';

do $$
begin
  if (select rol from public.profielen where id='c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6') <> 'voorzitter' then
    raise exception 'SEED FAALT: voorzittersrol niet gezet.';
  end if;
end $$;

-- Objecten van FONDS B (het doelwit van elke lekpoging).
insert into public.procedures (id, fonds_id, template_code, titel)
values ('b0000000-0000-0000-0000-00000000000b',
        '55555555-5555-5555-5555-555555555555', 'r1-test', 'B-procedure');

insert into public.decision_objects (id, fonds_id, procedure_id, besluit_code, titel, besluitvraag)
values ('b0000000-0000-0000-0000-0000000000dd',
        '55555555-5555-5555-5555-555555555555',
        'b0000000-0000-0000-0000-00000000000b',
        'R1-B-001', 'B-besluit', 'B-besluitvraag');

insert into public.decision_dissent
  (id, decision_id, bestuurder_id, bestuurder_naam, zichtbaarheid, standpunt)
values ('b0000000-0000-0000-0000-0000000000d1',
        'b0000000-0000-0000-0000-0000000000dd',
        'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5', 'R1 B',
        'prive', 'B-dissent prive'),
       ('b0000000-0000-0000-0000-0000000000d2',
        'b0000000-0000-0000-0000-0000000000dd',
        'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5', 'R1 B',
        'formele_dissent', 'B-dissent formeel');

insert into public.vergaderingen (id, fonds_id, titel, datum)
values ('b0000000-0000-0000-0000-0000000000e1',
        '55555555-5555-5555-5555-555555555555', 'B-vergadering', now());

insert into public.agendapunten (id, vergadering_id, titel)
values ('b0000000-0000-0000-0000-0000000000a1',
        'b0000000-0000-0000-0000-0000000000e1', 'B-agendapunt');

insert into public.documenten (id, fonds_id, titel, bron, bibliotheek)
values ('b0000000-0000-0000-0000-0000000000c1',
        '55555555-5555-5555-5555-555555555555', 'B-document', 'Intern', 'fonds');

-- Eigen objecten van FONDS A (voor de positieve regressiecontroles).
insert into public.procedures (id, fonds_id, template_code, titel)
values ('a0000000-0000-0000-0000-00000000000a',
        '44444444-4444-4444-4444-444444444444', 'r1-test', 'A-procedure');

insert into public.decision_objects (id, fonds_id, procedure_id, besluit_code, titel, besluitvraag)
values ('a0000000-0000-0000-0000-0000000000dd',
        '44444444-4444-4444-4444-444444444444',
        'a0000000-0000-0000-0000-00000000000a',
        'R1-A-001', 'A-besluit', 'A-besluitvraag');

insert into public.documenten (id, fonds_id, titel, bron, bibliotheek)
values ('a0000000-0000-0000-0000-0000000000c1',
        '44444444-4444-4444-4444-444444444444', 'A-document', 'Intern', 'fonds');


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ K-01 — decision_dissent                                                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ── Als VOORZITTER van fonds A (de rol die het lek exploiteerbaar maakte) ──
set local role authenticated;
set local request.jwt.claims to '{"sub":"c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6"}';

do $$
declare n int;
begin
  select count(*) into n from public.decision_dissent
   where decision_id = 'b0000000-0000-0000-0000-0000000000dd';
  if n <> 0 then
    raise exception 'LEK (K-01): voorzitter van fonds A ziet % dissentrij(en) van fonds B.', n;
  end if;
  raise notice 'OK K-01a: dissent van fonds B onzichtbaar voor voorzitter van fonds A.';
end $$;

do $$
declare n int;
begin
  update public.decision_dissent set standpunt = 'gemanipuleerd'
   where id = 'b0000000-0000-0000-0000-0000000000d2';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'LEK (K-01): voorzitter van fonds A wijzigde % dissentrij(en) van fonds B.', n;
  end if;
  raise notice 'OK K-01b: UPDATE op dissent van fonds B raakt 0 rijen.';
end $$;

do $$
declare n int;
begin
  delete from public.decision_dissent
   where id = 'b0000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'LEK (K-01): voorzitter van fonds A verwijderde % dissentrij(en) van fonds B.', n;
  end if;
  raise notice 'OK K-01c: DELETE op dissent van fonds B raakt 0 rijen.';
end $$;

-- ── Als gewone BESTUURDER van fonds A: injectie in het dossier van fonds B ──
set local request.jwt.claims to '{"sub":"a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4"}';

do $$
begin
  insert into public.decision_dissent
    (decision_id, bestuurder_id, bestuurder_naam, zichtbaarheid, standpunt)
  values ('b0000000-0000-0000-0000-0000000000dd',
          'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'R1 A',
          'formele_dissent', 'LEK-poging injectie in fonds B');
  raise exception 'LEK (K-01): dissent-injectie in het besluit van fonds B SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK K-01d: dissent-injectie in fonds B geweigerd (RLS).';
  when others then
    if sqlstate = '42501' then raise notice 'OK K-01d: dissent-injectie in fonds B geweigerd (RLS).';
    else raise; end if;
end $$;

-- POSITIEF: eigen dissent in het EIGEN fonds moet gewoon werken.
do $$
begin
  insert into public.decision_dissent
    (decision_id, bestuurder_id, bestuurder_naam, zichtbaarheid, standpunt)
  values ('a0000000-0000-0000-0000-0000000000dd',
          'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'R1 A',
          'formele_dissent', 'eigen dissent mag');
  raise notice 'OK K-01e: eigen dissent in eigen fonds toegestaan (geen regressie).';
exception when others then
  raise exception 'REGRESSIE (K-01): eigen dissent in eigen fonds geweigerd (sqlstate %). Policy te streng.', sqlstate;
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ H-01 — notificaties: ontvanger buiten het eigen fonds                   ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Let op: de bestaande T3-test dekt de variant fonds_id = B (die werd al
-- geweigerd). De variant die WEL slaagde is fonds_id = A met een ontvanger
-- uit fonds B — precies wat hier wordt getoetst.
do $$
begin
  insert into public.notificaties (ontvanger_id, fonds_id, type)
  values ('b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5',
          '44444444-4444-4444-4444-444444444444', 'procedure_afgerond');
  raise exception 'LEK (H-01): notificatie met eigen fonds_id maar ontvanger uit fonds B SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK H-01a: notificatie naar ontvanger buiten het fonds geweigerd (RLS).';
  when others then
    if sqlstate = '42501' then raise notice 'OK H-01a: notificatie naar ontvanger buiten het fonds geweigerd (RLS).';
    else raise; end if;
end $$;

-- POSITIEF: notificatie naar een collega in het EIGEN fonds moet werken.
do $$
begin
  insert into public.notificaties (ontvanger_id, fonds_id, type)
  values ('c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
          '44444444-4444-4444-4444-444444444444', 'procedure_afgerond');
  raise notice 'OK H-01b: notificatie naar collega in eigen fonds toegestaan (geen regressie).';
exception when others then
  raise exception 'REGRESSIE (H-01): notificatie naar eigen collega geweigerd (sqlstate %). Controleer fn_zelfde_fonds.', sqlstate;
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ H-02 — document_inzage en document_metadata_log                         ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- Auditregel schrijven voor een document van fonds B.
do $$
begin
  insert into public.document_inzage
    (document_id, document_titel_snapshot, fonds_id, gebruiker_id, actie)
  values ('b0000000-0000-0000-0000-0000000000c1', 'B-document',
          '55555555-5555-5555-5555-555555555555',
          'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'inzage');
  raise exception 'LEK (H-02): inzage-auditregel voor een document van fonds B SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK H-02a: inzage-auditregel voor fonds B geweigerd (RLS).';
  when others then
    if sqlstate = '42501' then raise notice 'OK H-02a: inzage-auditregel voor fonds B geweigerd (RLS).';
    else raise; end if;
end $$;

-- Nul-fonds-variant: rij zonder fonds_id verscheen voorheen bij ELK fonds.
do $$
begin
  insert into public.document_inzage
    (document_id, document_titel_snapshot, fonds_id, gebruiker_id, actie)
  values ('a0000000-0000-0000-0000-0000000000c1', 'A-document', null,
          'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'inzage');
  raise exception 'LEK (H-02): inzage-auditregel met fonds_id = NULL op een FONDS-document SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK H-02b: nul-fonds-inzageregel op een fondsdocument geweigerd (RLS).';
  when others then
    if sqlstate = '42501' then raise notice 'OK H-02b: nul-fonds-inzageregel op een fondsdocument geweigerd (RLS).';
    else raise; end if;
end $$;

-- POSITIEF: eigen inzage op een eigen document blijft werken.
do $$
begin
  insert into public.document_inzage
    (document_id, document_titel_snapshot, fonds_id, gebruiker_id, actie)
  values ('a0000000-0000-0000-0000-0000000000c1', 'A-document',
          '44444444-4444-4444-4444-444444444444',
          'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'inzage');
  raise notice 'OK H-02c: eigen inzageregel op eigen document toegestaan (geen regressie).';
exception when others then
  raise exception 'REGRESSIE (H-02): eigen inzageregel geweigerd (sqlstate %). Policy te streng.', sqlstate;
end $$;

-- Metadata-log voor een document van fonds B.
do $$
begin
  insert into public.document_metadata_log
    (document_id, fonds_id, gewijzigd_door, veld_naam, oude_waarde, nieuwe_waarde)
  values ('b0000000-0000-0000-0000-0000000000c1',
          '55555555-5555-5555-5555-555555555555',
          'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'status', 'concept', 'vastgesteld');
  raise exception 'LEK (H-02): metadata-auditregel voor een document van fonds B SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK H-02d: metadata-auditregel voor fonds B geweigerd (RLS).';
  when others then
    if sqlstate = '42501' then raise notice 'OK H-02d: metadata-auditregel voor fonds B geweigerd (RLS).';
    else raise; end if;
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ M-01 — agendapunt_inbreng                                               ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
begin
  insert into public.agendapunt_inbreng (agendapunt_id, gebruiker_id, tekst)
  values ('b0000000-0000-0000-0000-0000000000a1',
          'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'LEK-poging inbreng in fonds B');
  raise exception 'LEK (M-01): inbreng op een agendapunt van fonds B SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK M-01: inbreng op agendapunt van fonds B geweigerd (RLS).';
  when others then
    if sqlstate = '42501' then raise notice 'OK M-01: inbreng op agendapunt van fonds B geweigerd (RLS).';
    else raise; end if;
end $$;

reset role;
rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de OK-notices K-01a t/m e, H-01a/b,
-- H-02a t/m d en M-01 zag. Elke "LEK:"/"REGRESSIE:" doet raise exception →
-- non-zero exit → CI rood.
-- ============================================================================
