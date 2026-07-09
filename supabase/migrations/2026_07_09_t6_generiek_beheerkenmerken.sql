-- ============================================================================
-- Migratie 2026-07-09 — Increment T6: Beheerkenmerken generieke contentlaag +
-- namespace-invariant (generic-MVP).
-- ----------------------------------------------------------------------------
-- T6 formaliseert de gedeelde (fonds-overstijgende) contentlaag. Het meeste is
-- al as-built (classificatie bibliotheek='generiek'/fonds_id NULL, read-only-RLS,
-- statusvelden, published-only-RAG-gate uit T4/besluit 0045) en wordt NIET
-- herbouwd. Deze migratie sluit alleen de aantoonbare gaten uit beslisnotitie
-- v0.4 §7 (B3 / besluit 0040) op de beheerkenmerken:
--   • eigenaar         — functioneel/team-eigenaar van de generieke bron.
--   • volgende_review  — datum eerstvolgende inhoudelijke review.
--   • versie           — menselijk leesbaar versielabel (bv. "2024.1").
-- Alle drie ADDITIEF + NULLABLE → géén impact op bestaande rijen, RLS of RAG.
--
-- Statusmapping (draft/published/deprecated/withdrawn) is AFGELEID/documentair
-- over de bestaande status/bronstatus-velden (geen concurrerende kolom); zie
-- lib/generiek-status.ts + decisions/0048. `published` valt 1-op-1 samen met de
-- 0045-gate (status='van_kracht' AND coalesce(bronstatus,'actief')='actief'), dus
-- deze migratie raakt de retrieval-RPC's NIET.
--
-- Namespace-invariant (besluit 0045 verwees dit expliciet door naar T6):
--   generiek ⇒ fonds_id IS NULL   én   fonds ⇒ fonds_id IS NOT NULL.
-- Tot nu toe alleen conventie/comment; nu een harde CHECK. Voorafgegaan door een
-- PRE-CHECK die bestaande schendingen detecteert en de migratie met een duidelijke
-- melding afbreekt vóór de constraint wordt toegevoegd (fail-safe, geen stille
-- data-corruptie). De CHECK verzwakt geen enkele leespolicy en verruimt geen
-- schrijfrecht; hij hardt de classificatie waarop de read-only-RLS en de
-- fondsfilter (0045) rusten.
--
-- Beheervelden worden ingevuld via de bestaande platform-curatie (service-role
-- achter withPlatform, cap platform.generic.library.manage). De HANDHAVING van
-- periodieke review (verplicht, verloop-/intrekkingssignalering) is bewust T10 —
-- deze migratie levert alleen het veld.
--
-- Idempotent (add column if not exists / drop+add constraint). EERST in Supabase
-- draaien, DAN code-deploy (anders schrijft de curatie-UI naar niet-bestaande
-- kolommen). ROLLBACK: 2026_07_09_t6_generiek_beheerkenmerken_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Beheerkenmerken (additief, nullable) ─────────────────────────────────
-- eigenaar = functioneel/team-label (bv. 'Platform-redactie', 'DNB-desk'), GEEN
-- persoonsnaam en GEEN FK naar profielen: generieke content heeft geen fonds-
-- eigenaar en platform-identiteiten hebben geen profielen-rij. Vrije tekst houdt
-- de PII-voetafdruk minimaal (dataminimalisatie).
alter table public.documenten
  add column if not exists eigenaar        text,
  add column if not exists volgende_review date,
  add column if not exists versie          text;

comment on column public.documenten.eigenaar is
  'T6/§7: functioneel of team-eigenaar van een generieke bron (vrije tekst, geen persoonsnaam/FK). Alleen zinvol voor bibliotheek=''generiek''.';
comment on column public.documenten.volgende_review is
  'T6/§7: datum eerstvolgende inhoudelijke review van een generieke bron. Handhaving van periodieke review is T10; T6 levert alleen het veld.';
comment on column public.documenten.versie is
  'T6/§7: menselijk leesbaar versielabel (bv. ''2024.1''). Puur beheerkenmerk; de VERSIE-LINEAGE loopt onveranderd via vervangt_/vervangen_door_document_id (self-FK, decisions/0022).';

-- ── 2. Namespace-invariant: generiek ⇒ fonds_id NULL, fonds ⇒ fonds_id NOT NULL
--    (besluit 0045, doorgeschoven naar T6). Eerst PRE-CHECK, dan de CHECK. ─────
do $$
declare
  n_generiek_met_fonds int;
  n_fonds_zonder_fonds  int;
begin
  select count(*) into n_generiek_met_fonds
    from public.documenten
   where bibliotheek = 'generiek' and fonds_id is not null;
  select count(*) into n_fonds_zonder_fonds
    from public.documenten
   where bibliotheek = 'fonds' and fonds_id is null;

  if n_generiek_met_fonds > 0 or n_fonds_zonder_fonds > 0 then
    raise exception E'T6 PRE-CHECK FAALT: namespace-invariant geschonden door bestaande data.\n  generiek MET fonds_id: %\n  fonds ZONDER fonds_id: %\n  Corrigeer deze rijen vóór het toevoegen van de CHECK (constraint niet toegevoegd).',
      n_generiek_met_fonds, n_fonds_zonder_fonds;
  end if;

  raise notice 'T6 pre-check OK: geen namespace-schendingen; CHECK wordt toegevoegd.';
end $$;

alter table public.documenten drop constraint if exists documenten_generiek_namespace_check;
alter table public.documenten add  constraint documenten_generiek_namespace_check
  check (
    (bibliotheek = 'generiek' and fonds_id is null)
    or (bibliotheek = 'fonds' and fonds_id is not null)
  );

-- ============================================================================
-- Verificatie na afloop (handmatig):
--   • \d+ public.documenten  → eigenaar/volgende_review/versie aanwezig,
--     constraint documenten_generiek_namespace_check aanwezig.
--   • Een generiek document met fonds_id, of een fondsdocument zonder fonds_id,
--     moet nu door de CHECK worden geweigerd.
-- ============================================================================
