-- ============================================================================
-- Migratie 2026-09-23 — Wetsgeschiedenis A-light: foundation (bronmodel)
-- ----------------------------------------------------------------------------
-- WAAROM (WERKTICKET-WETSGESCHIEDENIS-A-LIGHT §4 PR 1): de generieke
-- bibliotheek moet actuele geconsolideerde wetgeving en wetsgeschiedenis
-- (memorie van toelichting, aangenomen amendement, nota van wijziging, nota
-- naar aanleiding van het verslag, memorie van antwoord, nota van toelichting
-- bij een AMvB) herkenbaar kunnen cureren, met een
-- technisch afgedwongen onderscheid tussen norm en toelichting.
--
-- HERGEBRUIK (geen parallel metadatamodel): titel (volledige officiële
-- verwijzing, géén apart publicatiekenmerk), documentdatum, extern_url,
-- bronorganisatie, thema, wettelijk_regime (pw/wvb/beide, T4), normgewicht,
-- status/bronstatus, geindexeerd en vervangt_/vervangen_door_document_id.
--
-- WAT DEZE MIGRATIE DOET (puur additief):
--   1. Twee nullable kolommen op documenten:
--        wetsgeschiedenis_subtype — soort parlementair stuk;
--        dossiernummer            — Kamerstukdossier, genormaliseerd
--                                   (cijfers zonder spatie, optioneel
--                                   "-<suffix>", bv. '36067' of '36200-XV').
--      Géén kolom voor publicatiekenmerk of behandelingsstatus (bewust):
--      "aangenomen" ligt vast in het subtype `aangenomen_amendement`; de
--      controle daarop gebeurt vóór import in de broncuratielijst.
--   2. documenten_documenttype_check uitgebreid met 'wetgeving' en
--      'wetsgeschiedenis'. Geen bestaande waarde verdwijnt.
--   3. Waarde-CHECKs op subtype en dossiernummer (zelfde patroon als
--      documenten_wettelijk_regime_check: NULL of een vaste lijst/vorm).
--   4. Combinatie-CHECKs (governance in de DB, niet alleen in de UI):
--        • 'wetgeving' en 'wetsgeschiedenis' alleen in de generieke
--          bibliotheek — een fondsdocument kan zich niet als wet voordoen;
--        • subtype en dossiernummer uitsluitend bij 'wetsgeschiedenis';
--          subtype daar altijd verplicht, dossiernummer verplicht behalve bij
--          'nota_van_toelichting' (AMvB-toelichting, geïdentificeerd via het
--          Staatsblad in de titel);
--        • wetsgeschiedenis heeft altijd normgewicht 'informatief' — nooit
--          bindend, dus ook een aangenomen amendement niet.
--
-- IMPACT
--   • Bestaande rijen: geen enkele rij heeft een van de nieuwe waarden, dus
--     alle nieuwe CHECKs zijn voor de huidige data waar (controle onderaan).
--     Geen datawijziging, geen backfill.
--   • RLS/grants: geen wijziging. documenten heeft tabel-brede grants; de
--     bestaande policies (fonds-isolatie + generiek alleen-lezen) dekken de
--     nieuwe kolommen. Geen nieuw object → geen regel in allowlist-grants.tsv.
--   • Denormalisatie: bewust NIET naar document_chunks. documenttype wordt al
--     gedenormaliseerd (fn_chunk_denorm) en volstaat om later wetgeving en
--     wetsgeschiedenis te onderscheiden. Subtype en dossiernummer volgen pas
--     in de post-release retrievalfase; fn_chunk_denorm en de triggers blijven
--     hier ongemoeid (raakvlak retrieval-release vermeden).
--   • Retrieval: geen RPC-, trigger- of functiewijziging. Zonder de nieuwe
--     waarden verandert er niets aan bestaand gedrag.
--   • Audit: wijzigingen lopen via de bestaande curatie-actie en het
--     append-only document_metadata_log (geen schemawijziging nodig).
--
-- VOLGORDE: NOG NIET UITVOEREN tot de Microsoft-release geland is en deze
--   branch is gerebased. Daarna: eerst Preview-DB, structurele gates, dan pas
--   de code-deploy (de UI biedt de nieuwe waarden aan; op de oude CHECK zou
--   een insert stuklopen).
-- Idempotent (add column if not exists; drop + add constraint).
-- ROLLBACK: supabase/rollbacks/2026_09_23_wetsgeschiedenis_a_light_foundation_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. Kolommen ─────────────────────────────────────────────────────────────
alter table public.documenten
  add column if not exists wetsgeschiedenis_subtype text,
  add column if not exists dossiernummer            text;

comment on column public.documenten.wetsgeschiedenis_subtype is
  'Wetsgeschiedenis A-light: soort parlementair stuk. Alleen bij documenttype=wetsgeschiedenis.';
comment on column public.documenten.dossiernummer is
  'Wetsgeschiedenis A-light: Kamerstukdossier, genormaliseerd (bv. 36067 of 36200-XV). Alleen bij documenttype=wetsgeschiedenis; optioneel bij subtype nota_van_toelichting.';

-- ── 2. Documenttype ─────────────────────────────────────────────────────────
alter table public.documenten drop constraint if exists documenten_documenttype_check;
alter table public.documenten add  constraint documenten_documenttype_check
  check (documenttype is null or documenttype in (
    'beleid','besluit','besluitdocument','besluitregistratie','bestuursvoorstel',
    'notulen','advies','memo','analyse','rapportage','bijlage','overig',
    'wetgeving','wetsgeschiedenis'));

-- ── 3. Waarde-CHECKs ────────────────────────────────────────────────────────
alter table public.documenten drop constraint if exists documenten_wetsgeschiedenis_subtype_check;
alter table public.documenten add  constraint documenten_wetsgeschiedenis_subtype_check
  check (wetsgeschiedenis_subtype is null or wetsgeschiedenis_subtype in (
    'memorie_van_toelichting','aangenomen_amendement','nota_van_wijziging',
    'nota_naar_aanleiding_van_het_verslag','memorie_van_antwoord',
    'nota_van_toelichting'));

alter table public.documenten drop constraint if exists documenten_dossiernummer_check;
alter table public.documenten add  constraint documenten_dossiernummer_check
  check (dossiernummer is null or dossiernummer ~ '^[0-9]{3,6}(-[A-Z0-9]{1,8})?$');

-- ── 4. Combinatie-CHECKs ────────────────────────────────────────────────────
alter table public.documenten drop constraint if exists documenten_juridisch_generiek_check;
alter table public.documenten add  constraint documenten_juridisch_generiek_check
  check (documenttype is null
         or documenttype not in ('wetgeving','wetsgeschiedenis')
         or coalesce(bibliotheek, '') = 'generiek');

alter table public.documenten drop constraint if exists documenten_wetsgeschiedenis_combinatie_check;
alter table public.documenten add  constraint documenten_wetsgeschiedenis_combinatie_check
  check (
    case
      when documenttype = 'wetsgeschiedenis' then
        wetsgeschiedenis_subtype is not null
        and (dossiernummer is not null
             or wetsgeschiedenis_subtype = 'nota_van_toelichting')
        and coalesce(normgewicht, '') = 'informatief'
      else
        wetsgeschiedenis_subtype is null
        and dossiernummer is null
    end
  );

-- ── 5. Fail-closed eindcontrole binnen dezelfde transactie ──────────────────
do $$
declare
  ontbreekt text := '';
  n_ongeldig integer;
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'documenten'
       and column_name = 'wetsgeschiedenis_subtype'
       and data_type = 'text'
       and is_nullable = 'YES'
  ) then
    ontbreekt := ontbreekt || ' documenten.wetsgeschiedenis_subtype';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'documenten'
       and column_name = 'dossiernummer'
       and data_type = 'text'
       and is_nullable = 'YES'
  ) then
    ontbreekt := ontbreekt || ' documenten.dossiernummer';
  end if;

  if (
    select count(*)
      from pg_constraint
     where conrelid = 'public.documenten'::regclass
       and conname in (
         'documenten_documenttype_check',
         'documenten_wetsgeschiedenis_subtype_check',
         'documenten_dossiernummer_check',
         'documenten_juridisch_generiek_check',
         'documenten_wetsgeschiedenis_combinatie_check'
       )
       and contype = 'c'
       and convalidated
  ) <> 5 then
    ontbreekt := ontbreekt || ' gevalideerde CHECK-constraints';
  end if;

  select count(*) into n_ongeldig
    from public.documenten
   where (documenttype in ('wetgeving', 'wetsgeschiedenis')
          and coalesce(bibliotheek, '') <> 'generiek')
      or (documenttype = 'wetsgeschiedenis'
          and (wetsgeschiedenis_subtype is null
               or (dossiernummer is null
                   and wetsgeschiedenis_subtype <> 'nota_van_toelichting')
               or coalesce(normgewicht, '') <> 'informatief'))
      or (documenttype is distinct from 'wetsgeschiedenis'
          and (wetsgeschiedenis_subtype is not null or dossiernummer is not null));

  if ontbreekt <> '' or n_ongeldig <> 0 then
    raise exception
      'Wetsgeschiedenis-foundation eindcontrole faalt: ontbreekt=%, ongeldige rijen=%',
      nullif(btrim(ontbreekt), ''), n_ongeldig;
  end if;

  raise notice 'Wetsgeschiedenis-foundation OK: kolommen, vijf CHECKs en bestaande data gevalideerd.';
end $$;

commit;

-- ============================================================================
-- CONTROLE (lokaal: supabase/checks/2026_09_23_wetsgeschiedenis_foundation.sql)
-- ============================================================================
-- Bestaande data schendt niets (moet 0 zijn):
--   select count(*) from public.documenten
--    where documenttype in ('wetgeving','wetsgeschiedenis')
--       or wetsgeschiedenis_subtype is not null or dossiernummer is not null;
