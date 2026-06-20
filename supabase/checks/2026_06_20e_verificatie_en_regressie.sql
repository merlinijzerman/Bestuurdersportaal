-- ============================================================================
-- Verificatie- + regressiechecklist bij Increment C+/B13 (migratie 2026_06_20e).
-- ----------------------------------------------------------------------------
-- Dekt de DoD-regressies die niet als TS-sanity draaibaar zijn: tenant-isolatie
-- op generiek (#6-#10, #15/#16) en de denorm-doorwerking. Plak per BLOK in de
-- Supabase SQL-editor. De meeste blokken zijn non-destructief (begin/rollback).
--
-- RLS testen vanuit de SQL-editor: de editor draait als 'postgres' en OMZEILT
-- RLS. Om als tenant te testen simuleren we een ingelogde gebruiker met:
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<USER_UUID>"}';
-- auth.uid() leest dan <USER_UUID>. Doe dit altijd binnen begin; ... rollback;.
--
-- VUL EERST DEZE PLACEHOLDERS IN (uit je seed/demo-data):
--   <FONDS_A_USER>   = auth.users.id van een gebruiker in Fonds A
--   <FONDS_B_USER>   = auth.users.id van een gebruiker in Fonds B
--   <FONDS_A_ID>     = fondsen.id van Fonds A
--   <GENERIEK_DOC>   = documenten.id van een bestaand generiek document
--   <FONDS_B_DOC>    = documenten.id van een fondsdocument van Fonds B
-- Tip: select id, fonds_id, rol from public.profielen;  /  select id,bibliotheek,fonds_id,titel from public.documenten;
-- ============================================================================


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL A — VÓÓR de migratie draaien (verificatie + §3-impact)             ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- A1. Ten onrechte-generieke fondsdocs (deze worden door §3 omgeklapt naar 'fonds').
--     Bekijk de lijst en stem af vóór je migreert. Verwacht: bewust te corrigeren rijen.
select id, titel, fonds_id, bibliotheek, opgeslagen_door
from public.documenten
where bibliotheek = 'generiek' and fonds_id is not null
order by titel;

-- A2. Informational: generieke docs zonder bronorganisatie/normgewicht (mogen NULL zijn).
select count(*) filter (where bronorganisatie is null) as zonder_bronorg,
       count(*) filter (where normgewicht is null)     as zonder_normgewicht,
       count(*)                                          as totaal_generiek
from public.documenten
where bibliotheek = 'generiek';
-- NB: bronorganisatie/normgewicht bestaan pas NA de migratie; draai A2 dan pas.


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL B — NA de migratie: structurele checks                             ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- B1. Kolommen aanwezig op documenten (3) + document_chunks (4).
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'documenten'      and column_name in ('bronorganisatie','extern_url','normgewicht'))
    or (table_name = 'document_chunks' and column_name in ('bibliotheek','bronorganisatie','normgewicht','extern_url')))
order by table_name, column_name;
-- Verwacht: 7 rijen.

-- B2. normgewicht-CHECK aanwezig.
select conname from pg_constraint where conname = 'documenten_normgewicht_check';
-- Verwacht: 1 rij.

-- B3. Per-command policies aanwezig (documenten 4 + chunks 2).
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and policyname in ('documenten select','documenten insert eigen fonds',
                     'documenten update eigen fonds','documenten delete eigen fonds',
                     'chunks select','chunks write eigen fonds')
order by tablename, policyname;
-- Verwacht: 6 rijen. De oude 'fonds documenten'/'fonds chunks' mogen NIET meer bestaan:
select policyname from pg_policies
where schemaname='public' and policyname in ('fonds documenten','fonds chunks');
-- Verwacht: 0 rijen.

-- B4. Index voor de bronsoort-weging.
select indexname from pg_indexes where schemaname='public' and indexname='idx_chunks_bronsoort';
-- Verwacht: 1 rij.

-- B5. Denorm-backfill compleet: geen chunk met NULL-bibliotheek terwijl het doc er een draagt.
select count(*) as chunks_zonder_bibliotheek_denorm
from public.document_chunks dc
join public.documenten d on d.id = dc.document_id
where dc.bibliotheek is null and d.bibliotheek is not null;
-- Verwacht: 0.

-- B6. §3-datacorrectie: geen generieke docs meer met fonds_id, EN de correctie is gelogd.
select count(*) as generiek_met_fonds from public.documenten
where bibliotheek='generiek' and fonds_id is not null;        -- Verwacht: 0.

select count(*) as audit_rijen_voor_correctie
from public.document_metadata_log
where veld_naam='bibliotheek' and oude_waarde='generiek' and nieuwe_waarde='fonds';
-- Verwacht: == aantal rijen dat A1 vóór de migratie toonde.

-- B7. Storage-policy: schrijven mag NIET meer naar generiek/ (alleen eigen fonds-pad).
select policyname, cmd, with_check
from pg_policies
where schemaname='storage' and tablename='objects'
  and policyname in ('documenten storage lezen','documenten storage schrijven');
-- Verwacht: de schrijf-policy bevat GEEN "'generiek'"-tak meer in with_check.


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL C — TENANT-ISOLATIE (RLS), als ingelogde gebruiker gesimuleerd      ║
-- ║ Alles non-destructief: begin; ... rollback;                             ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- C1 (#6). Tenant kan GEEN generiek document inserten (RLS with check faalt).
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<FONDS_A_USER>"}';
  -- Verwacht: ERROR new row violates row-level security policy for table "documenten".
  insert into public.documenten (fonds_id, bibliotheek, bron, titel)
  values (null, 'generiek', 'DNB', 'TEST mag niet — generiek door tenant');
rollback;

-- C2 (#7a). Tenant kan een generiek document NIET updaten (0 rijen geraakt).
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<FONDS_A_USER>"}';
  with poging as (
    update public.documenten set titel = titel || ' (gehackt)'
    where id = '<GENERIEK_DOC>' returning 1)
  select count(*) as generiek_update_geraakt from poging;   -- Verwacht: 0.
rollback;

-- C3 (#7b). Tenant kan generiek NIET deleten (0 rijen).
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<FONDS_A_USER>"}';
  with poging as (delete from public.documenten where id='<GENERIEK_DOC>' returning 1)
  select count(*) as generiek_delete_geraakt from poging;   -- Verwacht: 0.
rollback;

-- C4 (#7c). Tenant kan een EIGEN fondsdoc niet naar 'generiek' converteren.
--   Vul <FONDS_A_DOC> = een eigen fondsdocument van Fonds A.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<FONDS_A_USER>"}';
  with poging as (
    update public.documenten set bibliotheek='generiek'
    where id='<FONDS_A_DOC>' and bibliotheek='fonds' returning 1)
  select count(*) as conversie_geraakt from poging;         -- Verwacht: 0 (with check blokkeert).
rollback;

-- C5 (#8a). Tenant KAN generiek wel LEZEN.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<FONDS_A_USER>"}';
  select count(*) as generiek_zichtbaar from public.documenten where bibliotheek='generiek';
  -- Verwacht: > 0 (alle generieke docs leesbaar).
rollback;

-- C6 (#8b). Chunks van generiek: lezen JA, schrijven NEE.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<FONDS_A_USER>"}';
  select count(*) as generiek_chunks_leesbaar
  from public.document_chunks where document_id='<GENERIEK_DOC>';   -- Verwacht: > 0.
  -- Schrijfpoging op een generiek-chunk:
  insert into public.document_chunks (document_id, chunk_index, tekst)
  values ('<GENERIEK_DOC>', 999999, 'TEST mag niet');               -- Verwacht: RLS ERROR.
rollback;

-- C7 (#9 / #15 / #16). Eigen fondsdocs werken; Fonds A ziet Fonds B niet.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<FONDS_A_USER>"}';
  -- Eigen fondsdoc inserten lukt:
  insert into public.documenten (fonds_id, bibliotheek, bron, titel)
  values ('<FONDS_A_ID>', 'fonds', 'Intern', 'TEST eigen fondsdoc');  -- Verwacht: OK (1 rij).
  -- Fonds A kan een fondsdoc van Fonds B NIET zien:
  select count(*) as fonds_b_doc_zichtbaar_voor_a
  from public.documenten where id='<FONDS_B_DOC>';                   -- Verwacht: 0.
rollback;

-- C8 (#10). Service-role/back-office KAN generiek schrijven (interim curatiekanaal).
--   Draai dit blok als 'postgres' (default editor-rol) OF met service-role:
begin;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel)
  values (null, 'generiek', 'DNB', 'TEST generiek via service-role');  -- Verwacht: OK.
rollback;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL D — DENORM-DOORWERKING (triggers)                                  ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- D1. Nieuwe chunk erft bronsoort-denorm uit het parent-document (BEFORE INSERT-trigger).
--   Draai als service-role/postgres. Gebruik een bestaand <GENERIEK_DOC>.
begin;
  insert into public.document_chunks (document_id, chunk_index, tekst)
  values ('<GENERIEK_DOC>', 999998, 'denorm-test');
  select bibliotheek, bronorganisatie, normgewicht, extern_url, geldig_tot
  from public.document_chunks
  where document_id='<GENERIEK_DOC>' and chunk_index=999998;
  -- Verwacht: bibliotheek='generiek' + de waarden van het parent-document.
rollback;

-- D2. AFTER UPDATE op documenten werkt door naar bestaande chunks ZONDER re-embed.
begin;
  -- Onthoud een huidige embedding om te bewijzen dat tekst/vector niet muteren:
  create temp table _voor as
    select id, embedding from public.document_chunks
    where document_id='<GENERIEK_DOC>' limit 1;
  update public.documenten set normgewicht='informatief' where id='<GENERIEK_DOC>';
  select dc.normgewicht as chunk_normgewicht
  from public.document_chunks dc where dc.document_id='<GENERIEK_DOC>' limit 1;
  -- Verwacht: 'informatief' (denorm doorgewerkt).
  select (v.embedding is not distinct from n.embedding) as embedding_ongewijzigd
  from _voor v join public.document_chunks n on n.id=v.id;
  -- Verwacht: true (geen re-embed).
rollback;

-- D3. NULL-denorm breekt retrieval niet. De zoek-RPC's selecteren expliciete
--   kolommen en negeren de denorm-velden (filtering = Increment G). Smoke:
--   draai een normale chat-vraag in de app en controleer dat bronnen terugkomen,
--   óók voor een (hypothetisch) document met NULL bronsoort-denorm. Geen aparte
--   SQL nodig; bevestig functioneel dat retrieval blijft werken.

-- ============================================================================
-- Samenvatting verwachte uitkomsten:
--   B1=7, B2=1, B3=6 (+0 oude), B4=1, B5=0, B6=0/==A1, B7 geen generiek-tak.
--   C1 ERROR, C2=0, C3=0, C4=0, C5>0, C6 leesbaar>0 + ERROR op insert,
--   C7 eigen insert OK + fonds_b=0, C8 OK. D1 erft denorm, D2 doorgewerkt +
--   embedding_ongewijzigd=true.
-- ============================================================================
