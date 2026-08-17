-- ============================================================================
-- T5/§15 — Cross-tenant export- én storagegrens (T6 + T7), DB-laag onder RLS.
-- ----------------------------------------------------------------------------
-- Zusje van 2026_07_08_t3_cross_tenant.sql, maar toegespitst op de twee
-- isolatiegrenzen die de §15-matrix apart benoemt en die T3 (tenant-tabellen)
-- niet dekt:
--
--   T6 — EXPORT: exports worden server-side samengesteld uit RLS-gefilterde
--        queries. De DB-borging is dat de bronqueries van een export (documenten
--        als representatieve exportbron) cross-tenant NIETS teruggeven; er is
--        geen pad waarlangs fonds A een fonds-B-rij in zijn export krijgt.
--        (De app-laag T5/T6 — géén body.fonds_id-vertrouwen — staat in
--        tests/cross-tenant/audit-fonds.test.ts + lib/audit-fonds-guard.ts.)
--
--   T7 — STORAGE/DOWNLOAD: de RLS op storage.objects (bucket 'documenten')
--        weigert een download/insert buiten het eigen fonds-pad. Generiek/ is
--        gedeeld-LEESBAAR maar voor tenants read-only (B13, migratie
--        2026_06_20e).
--
-- Twee delen, zelfde patroon als T3:
--   DEEL 1 — STRUCTUREEL (geen seed): de storage.objects-lees- én schrijfpolicy
--     bestaan en de schrijfpolicy heeft WITH CHECK. Sloopt iemand de storage-RLS,
--     dan faalt dit deel meteen — ook zonder seed-data.
--   DEEL 2 — GEDRAG (self-seeding, 2 fondsen + 2 users via auth-trigger): bewijs
--     dat cross-tenant export-reads leeg zijn en dat cross-tenant/generiek
--     storage-writes RLS-geweigerd worden, mét positieve controles zodat de
--     policy niet stiekem álles blokkeert. Eén transactie, begin ... rollback.
--
-- Uitvoeren:  psql "$DB" -f dit-bestand   (of via scripts/cross-tenant-ci.sh)
-- ============================================================================

\set ON_ERROR_STOP on

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTURELE DEKKING: storage-RLS staat overeind (harde gate)   ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. Zowel de lees- als de schrijfpolicy op storage.objects moet bestaan.
do $$
declare
  heeft_lezen boolean;
  heeft_schrijven boolean;
begin
  select exists (
    select 1 from pg_policies
     where schemaname='storage' and tablename='objects'
       and policyname='documenten storage lezen' and cmd='SELECT'
  ) into heeft_lezen;
  select exists (
    select 1 from pg_policies
     where schemaname='storage' and tablename='objects'
       and policyname='documenten storage schrijven' and cmd='INSERT'
  ) into heeft_schrijven;

  if not heeft_lezen then
    raise exception 'T7-DEKKING FAALT: leespolicy "documenten storage lezen" ontbreekt op storage.objects — storage-isolatie niet geborgd.';
  end if;
  if not heeft_schrijven then
    raise exception 'T7-DEKKING FAALT: schrijfpolicy "documenten storage schrijven" ontbreekt op storage.objects.';
  end if;
  raise notice 'DEEL 1a OK: storage.objects heeft de lees- én schrijfpolicy voor de documenten-bucket.';
end $$;

-- 1b. De storage-schrijfpolicy MOET een WITH CHECK dragen (anders vrije injectie).
do $$
declare heeft_check boolean;
begin
  select (with_check is not null) into heeft_check
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname='documenten storage schrijven';
  if not coalesce(heeft_check, false) then
    raise exception 'T7-DEKKING FAALT: storage-schrijfpolicy zonder WITH CHECK — cross-tenant storage-injectie mogelijk.';
  end if;
  raise notice 'DEEL 1b OK: storage-schrijfpolicy heeft WITH CHECK.';
end $$;

-- 1c. governance_events (de sha256-hashketen — kern van reproduceerbaarheid) MOET
--     append-only zijn. T3 DEEL 1b dekt de vier *_log-tabellen; governance_events
--     draagt eigen immutability-triggers (2026_05_07) en hoort óók in de
--     gebundelde §15-dekking (audit-evidence-review T5).
do $$
begin
  if not exists (
    select 1 from information_schema.triggers
     where event_object_schema='public' and event_object_table='governance_events'
       and trigger_name='trg_govevent_no_update') then
    raise exception 'T8-APPEND-ONLY FAALT: governance_events mist de no_update-trigger (hashketen muteerbaar).';
  end if;
  if not exists (
    select 1 from information_schema.triggers
     where event_object_schema='public' and event_object_table='governance_events'
       and trigger_name='trg_govevent_no_delete') then
    raise exception 'T8-APPEND-ONLY FAALT: governance_events mist de no_delete-trigger (hashketen verwijderbaar).';
  end if;
  raise notice 'DEEL 1c OK: governance_events is append-only afgedwongen (hashketen onveranderlijk).';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG: cross-tenant export leeg + storage-writes geweigerd     ║
-- ║ Self-seeding (2 fondsen + 2 users via auth-trigger). begin ... rollback. ║
-- ╚════════════════════════════════════════════════════════════════════════╝

begin;

-- Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's, gelijk aan de T3-suite.
--   Fonds A = 11111111-...  user A = aaaa...
--   Fonds B = 22222222-...  user B = bbbb...
insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111', 'T5 Testfonds A', 't5-testfonds-a'),
       ('22222222-2222-2222-2222-222222222222', 'T5 Testfonds B', 't5-testfonds-b');

-- auth.users-insert vuurt trigger maak_profiel() → tenant-profielen met het juiste fonds.
insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t5-a@test.local',
   '{"naam":"Test A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t5-b@test.local',
   '{"naam":"Test B","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '11111111-1111-1111-1111-111111111111'::uuid
     or (select fonds_id from public.profielen where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
       is distinct from '22222222-2222-2222-2222-222222222222'::uuid then
    raise exception 'SEED FAALT: profielen niet aan het juiste fonds gekoppeld (trigger maak_profiel).';
  end if;
end $$;

-- Exportbron-seed: één document per fonds + één generiek document.
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel)
values
  ('11111111-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','fonds','Intern','Doc fonds A'),
  ('22222222-0000-0000-0000-0000000000d2','22222222-2222-2222-2222-222222222222','fonds','Intern','Doc fonds B'),
  ('00000000-0000-0000-0000-0000000000d0', null,                                  'generiek','DNB','Generiek doc');

-- Storage-seed: één object per fonds-pad + één generiek object.
--   Padconventie: <fonds_uuid>/<doc>.pdf  en  generiek/<doc>.pdf
insert into storage.objects (bucket_id, name)
values
  ('documenten','11111111-1111-1111-1111-111111111111/a.pdf'),
  ('documenten','22222222-2222-2222-2222-222222222222/b.pdf'),
  ('documenten','generiek/g.pdf');

-- Inzage-audit-seed: één download-logregel per fonds. Een export/download hoort
-- een document_inzage-regel te schrijven; hier bewijzen we dat DIE auditlog zelf
-- tenant-geïsoleerd is (fonds A ziet nooit de inzage van fonds B).
insert into public.document_inzage (id, document_id, document_titel_snapshot, fonds_id, gebruiker_id, actie)
values
  ('11111111-0000-0000-0000-00000000e001','11111111-0000-0000-0000-0000000000d1','Doc fonds A',
   '11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','download'),
  ('22222222-0000-0000-0000-00000000e002','22222222-0000-0000-0000-0000000000d2','Doc fonds B',
   '22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','download');

-- ── Impersoneer user A (fonds A) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- ── T6 — EXPORT: bronqueries zijn RLS-gefilterd ─────────────────────────────

-- POSITIEF T6a: A ziet het EIGEN document (export niet over-restrictief).
do $$
declare n int;
begin
  select count(*) into n from public.documenten where id='11111111-0000-0000-0000-0000000000d1';
  if n <> 1 then raise exception 'REGRESSIE T6: fonds A ziet het eigen exportdocument NIET (leespolicy te streng).'; end if;
  raise notice 'OK T6a: eigen exportdocument zichtbaar voor A.';
end $$;

-- POSITIEF T6b: A ziet het GENERIEKE document (gedeelde exportbron, read-only).
do $$
declare n int;
begin
  select count(*) into n from public.documenten where id='00000000-0000-0000-0000-0000000000d0';
  if n <> 1 then raise exception 'REGRESSIE T6: generiek exportdocument onzichtbaar voor A (gedeelde bron kapot).'; end if;
  raise notice 'OK T6b: generiek exportdocument zichtbaar voor A (read-only bron).';
end $$;

-- NEGATIEF T6 (LEIDEND): A krijgt het fonds-B-document NIET in een export.
do $$
declare n int;
begin
  select count(*) into n from public.documenten where id='22222222-0000-0000-0000-0000000000d2';
  if n <> 0 then raise exception 'LEK T6: fonds A ziet exportdocument van fonds B — cross-tenant export mogelijk (leesisolatie kapot).'; end if;
  raise notice 'OK T6: fonds-B-exportdocument onzichtbaar voor A.';
end $$;

-- ── T7 — STORAGE/DOWNLOAD: RLS op storage.objects ───────────────────────────

-- POSITIEF T7a: A ziet zijn EIGEN storage-object (download eigen fonds mag).
do $$
declare n int;
begin
  select count(*) into n from storage.objects
   where bucket_id='documenten' and name='11111111-1111-1111-1111-111111111111/a.pdf';
  if n <> 1 then raise exception 'REGRESSIE T7: eigen storage-object onzichtbaar voor A (leespolicy te streng).'; end if;
  raise notice 'OK T7a: eigen storage-object zichtbaar voor A.';
end $$;

-- POSITIEF T7b: A ziet het GENERIEKE storage-object (gedeeld leesbaar).
do $$
declare n int;
begin
  select count(*) into n from storage.objects
   where bucket_id='documenten' and name='generiek/g.pdf';
  if n <> 1 then raise exception 'REGRESSIE T7: generiek storage-object onzichtbaar voor A (gedeelde leespolicy kapot).'; end if;
  raise notice 'OK T7b: generiek storage-object zichtbaar voor A.';
end $$;

-- NEGATIEF T7 #1 (LEIDEND, download-grens): A ziet het fonds-B-object NIET.
do $$
declare n int;
begin
  select count(*) into n from storage.objects
   where bucket_id='documenten' and name='22222222-2222-2222-2222-222222222222/b.pdf';
  if n <> 0 then raise exception 'LEK T7: fonds A ziet storage-object van fonds B — cross-tenant download mogelijk.'; end if;
  raise notice 'OK T7 #1: fonds-B-storage-object onzichtbaar voor A (download geweigerd).';
end $$;

-- POSITIEF T7c: A mag naar het EIGEN fonds-pad schrijven (upload eigen fonds).
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('documenten','11111111-1111-1111-1111-111111111111/nieuw.pdf');
  raise notice 'OK T7c: upload naar eigen fonds-pad toegestaan.';
exception when others then
  raise exception 'REGRESSIE T7: eigen-fonds upload geweigerd (sqlstate %). Schrijfpolicy te streng.', sqlstate;
end $$;

-- NEGATIEF T7 #2 (upload-grens): A mag NIET naar het fonds-B-pad schrijven.
-- Discrimineer BEWUST op de weigergrond: SQLSTATE 42501 dekt zowel een RLS-
-- WITH CHECK-schending ('new row violates row-level security policy') ALS een
-- ontbrekend table-privilege ('permission denied'). Alleen de eerste bewijst
-- tenant-isolatie; de tweede zou een false pass zijn (weigering om de verkeerde
-- reden). We eisen daarom de row-level-security-boodschap (audit-evidence-review).
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('documenten','22222222-2222-2222-2222-222222222222/lek.pdf');
  raise exception 'LEK T7: upload naar fonds-B-pad SLAAGDE — WITH CHECK ontbreekt/werkt niet.';
exception
  when insufficient_privilege then
    if sqlerrm ilike '%row-level security%' then
      raise notice 'OK T7 #2: upload naar fonds-B-pad geweigerd door RLS-WITH CHECK.';
    else
      raise exception 'ONGELDIGE WEIGERGROND T7 #2: geweigerd, maar niet door RLS (%). Grant/privilege-probleem maskeert de test.', sqlerrm;
    end if;
end $$;

-- NEGATIEF T7 #3 (B13, generiek read-only): A mag NIET naar generiek/ schrijven.
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('documenten','generiek/lek.pdf');
  raise exception 'LEK T7: upload naar generiek/ SLAAGDE — B13 (generiek read-only voor tenants) doorbroken.';
exception
  when insufficient_privilege then
    if sqlerrm ilike '%row-level security%' then
      raise notice 'OK T7 #3: upload naar generiek/ geweigerd door RLS (B13 read-only).';
    else
      raise exception 'ONGELDIGE WEIGERGROND T7 #3: geweigerd, maar niet door RLS (%). Grant/privilege-probleem maskeert de test.', sqlerrm;
    end if;
end $$;

-- ── T8/audit — de inzage-audit is zelf tenant-geïsoleerd ────────────────────

-- POSITIEF: A ziet zijn EIGEN download-logregel (inzage-audit eigen fonds).
do $$
declare n int;
begin
  select count(*) into n from public.document_inzage
   where id='11111111-0000-0000-0000-00000000e001';
  if n <> 1 then raise exception 'REGRESSIE T8: eigen inzage-logregel onzichtbaar voor A (leespolicy te streng).'; end if;
  raise notice 'OK T8a: eigen inzage-logregel zichtbaar voor A.';
end $$;

-- NEGATIEF: A ziet de download-logregel van fonds B NIET (auditlog tenant-geïsoleerd).
do $$
declare n int;
begin
  select count(*) into n from public.document_inzage
   where id='22222222-0000-0000-0000-00000000e002';
  if n <> 0 then raise exception 'LEK T8: fonds A ziet de inzage-audit van fonds B — cross-tenant auditlek.'; end if;
  raise notice 'OK T8: fonds-B-inzage-logregel onzichtbaar voor A.';
end $$;

reset role;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de DEEL 1-OK's + alle T6/T7-notices
-- zag. Elke "LEK:"/"FAALT" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
