-- ============================================================================
-- Migratie 2026-08-09 — Documenttype `rapportage` toevoegen
-- ----------------------------------------------------------------------------
-- WAAROM (werkopdracht metadata-vereenvoudiging, fase 1.1): het bestaande
-- documenttype-vocabulaire kent geen `rapportage`, terwijl een fonds
-- periodieke rapportages (bv. kwartaal-/jaarrapportages van de uitvoerder of
-- vermogensbeheerder) als eigenstandig type wil kunnen classificeren. Zonder
-- eigen type belanden die stukken in de restgroep `overig`.
--
-- WAT DEZE MIGRATIE DOET.
--   Vervangt de CHECK-constraint `documenten_documenttype_check` door dezelfde
--   lijst mét `rapportage` toegevoegd (ná `analyse`). Puur additief: geen
--   bestaande waarde verdwijnt, dus geen enkele bestaande rij schendt de nieuwe
--   constraint. NULL blijft toegestaan (de vergaderstroom levert geen type aan,
--   besluit 0140).
--
-- VOLGORDE (CLAUDE.md): draai deze migratie EERST in Supabase; pas dán de
--   code-deploy waarin de UI `rapportage` aanbiedt. Andersom zou een insert met
--   `documenttype='rapportage'` op de oude CHECK stuklopen.
--
-- Geen enum-krimp (dat is fase 2, besluit 0154), geen datawijziging, geen
-- RLS-wijziging, geen trigger/functiewijziging. De statusovergang-trigger staat
-- op `before update of status` en raakt documenttype niet.
-- Idempotent (drop + add, zelfde patroon als 2026_06_18_documentstatus_metadata).
-- ROLLBACK: 2026_08_09_documenttype_rapportage_ROLLBACK.sql
-- ============================================================================

begin;

alter table public.documenten drop constraint if exists documenten_documenttype_check;
alter table public.documenten add  constraint documenten_documenttype_check
  check (documenttype is null or documenttype in (
    'beleid','besluit','besluitdocument','besluitregistratie','bestuursvoorstel',
    'notulen','advies','memo','analyse','rapportage','bijlage','overig'));

commit;

-- ============================================================================
-- CONTROLE
-- ============================================================================
-- Nieuwe waarde wordt geaccepteerd (rollt terug, alleen een geldigheidstoets):
--   begin;
--     insert into public.documenten (fonds_id, titel, bron, documenttype)
--     values ('00000000-0000-0000-0000-000000000000', '_check', 'Intern', 'rapportage');
--   rollback;
--
-- Bestaande waarden blijven geldig (moet 0 schendingen tonen):
--   select count(*) from public.documenten
--   where documenttype is not null and documenttype not in (
--     'beleid','besluit','besluitdocument','besluitregistratie','bestuursvoorstel',
--     'notulen','advies','memo','analyse','rapportage','bijlage','overig');
