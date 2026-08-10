-- ============================================================================
-- Migratie 2026-08-10 — Documentstatus van acht naar vijf (besluit 0154)
-- ----------------------------------------------------------------------------
-- WAAROM (DOELMODEL-status-as / besluit 0154): de documentstatus telde acht
-- waarden, maar de code leest er slechts vier uitkomsten uit. `concept`
-- absorbeert de rijpingsketen (ter_bespreking/ter_besluitvorming — die fase
-- leeft op de dossier-/procedurestatus); `historisch` is de merge van
-- vervangen/alleen_historisch. Nieuw toegestaan: `concept → vastgesteld`
-- ("sprong verboden" vervalt) en `vastgesteld/van_kracht → historisch`.
--
-- SCOPE: dit is UITSLUITEND de documentstatus-krimp (0154). De bronstatus-as
-- (besluit 0153, `rag_uitgesloten`) en de RPC-poort blijven ONGEMOEID — die
-- vormen een aparte track omdat bronstatus de generieke-content-levenscyclus
-- (T6/T10) draagt. De actueel-poort blijft `documentstatus in
-- ('vastgesteld','van_kracht')`; die verwijst niet naar de verwijderde waarden.
--
-- DATAMIGRATIE (onomkeerbaar): ter_bespreking/ter_besluitvorming → concept;
-- vervangen/alleen_historisch → historisch. De statusovergang-trigger
-- (trg_document_status_overgang) zou deze bulk-merge weigeren (het zijn geen
-- geldige overgangen), daarom staat hij tijdens de remap uit. De
-- chunk-denorm-refresh (trg_chunk_denorm_refresh) blijft AAN, zodat
-- document_chunks.documentstatus meteen meeschuift.
--
-- SPIEGELS 1-OP-1 (verplicht): fn_document_status_transitie (trigger-tweeling
-- van core/lib/document-status-transities.ts) en fn_generiek_geldigheidsstatus
-- (tweeling van core/lib/generiek-status.ts) worden hier gelijk getrokken.
--
-- Draai deze migratie EERST op een KLOON, daarna de before/after-controle
-- onderaan + supabase/checks/2026_07_31_r1_structurele_gates.sql, en pas ná
-- groen op productie — gevolgd door de code-deploy.
-- ROLLBACK: 2026_08_10_documentstatus_acht_naar_vijf_ROLLBACK.sql (schema-only;
--   de data-merge is niet terug te draaien — zie daar).
-- ============================================================================

begin;

-- ── 1. Datamigratie met tijdelijk uitgeschakelde validatie-trigger ──────────
alter table public.documenten disable trigger trg_document_status_overgang;
-- De generieke transitie-trigger raakt alleen generieke docs en slaat fonds-
-- docs over; voor de zekerheid ook uit tijdens de bulk-merge.
alter table public.documenten disable trigger trg_generiek_status_overgang;

update public.documenten
   set status = 'concept'
 where status in ('ter_bespreking','ter_besluitvorming');

update public.documenten
   set status = 'historisch'
 where status in ('vervangen','alleen_historisch');

alter table public.documenten enable trigger trg_generiek_status_overgang;
alter table public.documenten enable trigger trg_document_status_overgang;

-- ── 2. CHECK-constraint → vijf waarden ──────────────────────────────────────
alter table public.documenten drop constraint if exists documenten_status_check;
alter table public.documenten add  constraint documenten_status_check
  check (status is null or status in (
    'concept','vastgesteld','van_kracht','historisch','gearchiveerd'));

-- ── 3. SQL-spiegel fn_document_status_transitie → nieuwe transitietabel ──────
-- 1-op-1 met core/lib/document-status-transities.ts::STATUS_TRANSITIES. Alleen
-- de TOEGESTANE overgangen staan hier; een niet-genoemd paar → geen rij →
-- magOvergaan=false. De trigger fn_document_status_overgang_check leest deze fn.
drop function if exists public.fn_document_status_transitie(text, text);
create function public.fn_document_status_transitie(
  p_van text, p_naar text
)
returns table (
  toegestaan boolean,
  redenplicht boolean,
  vereist_vervangen_door boolean,
  herindexering boolean,
  bruikbaar_actueel boolean
)
language sql immutable as $$
  select t.toegestaan::boolean,
         t.redenplicht::boolean,
         t.vereist_vervangen_door::boolean,
         t.herindexering::boolean,
         t.bruikbaar_actueel::boolean
  from (values
    -- Ingest-verklaringen (besluit 0136). `upload` is een pseudo-herkomst.
    ('upload',      'concept',      true,  false, false, true,  false),
    ('upload',      'vastgesteld',  true,  true,  false, true,  true ),
    ('upload',      'van_kracht',   true,  true,  false, true,  true ),
    -- Portaal-keten zonder tussenstaten (0154).
    ('concept',     'vastgesteld',  true,  true,  false, true,  true ),
    ('vastgesteld', 'van_kracht',   true,  false, false, true,  true ),
    -- Afvoeren naar historisch (merge; vervangen_door optioneel).
    ('vastgesteld', 'historisch',   true,  true,  false, true,  false),
    ('van_kracht',  'historisch',   true,  true,  false, true,  false),
    -- Archiveren vanaf elke levende status.
    ('concept',     'gearchiveerd', true,  true,  false, true,  false),
    ('vastgesteld', 'gearchiveerd', true,  true,  false, true,  false),
    ('van_kracht',  'gearchiveerd', true,  true,  false, true,  false),
    ('historisch',  'gearchiveerd', true,  true,  false, true,  false)
  ) as t(van, naar, toegestaan, redenplicht, vereist_vervangen_door, herindexering, bruikbaar_actueel)
  where t.van = p_van and t.naar = p_naar;
$$;

-- ── 4. Generieke afleiding fn_generiek_geldigheidsstatus → `historisch` ─────
-- 1-op-1 met core/lib/generiek-status.ts::generiekGeldigheidsstatus. Alleen de
-- documentstatus-tak wijzigt (merge → historisch); de bronstatus-takken blijven
-- (bronstatus bestaat nog; besluit 0153 is een aparte track).
create or replace function public.fn_generiek_geldigheidsstatus(
  p_status text, p_bronstatus text
)
returns text language sql immutable as $$
  select case
    when p_status = 'van_kracht'
         and coalesce(p_bronstatus, 'actief') = 'actief'      then 'published'
    when p_status = 'gearchiveerd'
         or coalesce(p_bronstatus, 'actief') = 'uitgesloten'  then 'withdrawn'
    when p_status = 'historisch'
         or coalesce(p_bronstatus, 'actief') = 'historisch'   then 'deprecated'
    else 'draft'
  end;
$$;

commit;

-- ============================================================================
-- CONTROLE (draai na COMMIT als losse selects op de kloon)
-- ============================================================================
-- 1. Geen enkele rij draagt nog een oude status (moet 0 zijn):
--   select count(*) from public.documenten
--   where status in ('ter_bespreking','ter_besluitvorming','vervangen','alleen_historisch');
--
-- 2. De chunk-denorm is meegeschoven (moet 0 zijn):
--   select count(*) from public.document_chunks
--   where documentstatus in ('ter_bespreking','ter_besluitvorming','vervangen','alleen_historisch');
--
-- 3. Nieuwe transitie toegestaan, oude keten weg:
--   select * from public.fn_document_status_transitie('concept','vastgesteld');    -- toegestaan=t
--   select * from public.fn_document_status_transitie('vastgesteld','historisch'); -- toegestaan=t
--   select * from public.fn_document_status_transitie('ter_bespreking','ter_besluitvorming'); -- leeg
--
-- 4. RAG-bereik-diff (verwacht LEEG op de huidige populatie): de enige
--    datawijziging is 2 documenten ter_bespreking → concept; beide waren en
--    blijven niet-actueel. Draai de AQLab-regressieset before/after en vergelijk
--    bron-selectie; nul onverklaarde verschuivingen is de acceptatie-eis.
