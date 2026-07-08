-- ============================================================================
-- Migratie 2026-07-08 — T3: register van globale/hybride referentietabellen
-- ----------------------------------------------------------------------------
-- WAAROM: v0.4 §14 punt 4 eist dat elke tabel die BEWUST afwijkt van strikte
-- fonds-isolatie expliciet als zodanig gedocumenteerd is — zodat een brede
-- leespolicy niet per ongeluk voor een lek wordt aangezien (geen schijnzekerheid).
-- Deze migratie legt die keuze in de database vast via COMMENT ON TABLE, naast
-- de policy-matrix in de projectdocumentatie.
--
-- Deze migratie wijzigt GEEN policies of data; alleen tabelcommentaar. Volledig
-- veilig en idempotent (comment overschrijft).
-- ROLLBACK: 2026_07_08_t3_globale_tabellen_register_ROLLBACK.sql
-- TENANT-IMPACT: geen (documentatie).
-- ============================================================================

begin;

-- Volledig globaal (geen fonds_id-isolatie op de leeskant) — bewuste keuze:
comment on table public.fondsen is
  'GLOBAAL (T3-register). Leespolicy "fondsen lezen" = using(true): de fondsenlijst '
  'is voor elke ingelogde gebruiker leesbaar (tenant-keuze/host-resolutie). Bevat '
  'geen tenant-inhoud. Schrijven gebeurt platform-/service-role-kant.';

comment on table public.procedure_requirements is
  'GLOBALE TEMPLATE (T3-register). Leespolicy "req read all" = using(auth.uid() is not null): '
  'proces-vereisten zijn fondsoverstijgende templateconfiguratie zonder fonds_id. '
  'Schrijven alleen door rol=beheerder ("req write beheerder", mét WITH CHECK sinds T3).';

-- Hybride (template-rijen globaal leesbaar via fonds_id IS NULL; fonds-eigen
-- rijen strikt geïsoleerd) — bewuste keuze:
comment on table public.gremia is
  'HYBRIDE (T3-register). Leespolicy "lees gremia" = fonds_id IS NULL (template) OR eigen fonds. '
  'Template-rijen (fonds_id NULL) zijn fondsoverstijgend leesbaar; fonds-eigen rijen zijn '
  'strikt geïsoleerd. Schrijven "schrijf gremia" is eigen-fonds met WITH CHECK.';

comment on table public.expertises is
  'HYBRIDE (T3-register). Leespolicy "lees expertises" = fonds_id IS NULL (template) OR eigen fonds. '
  'Zie public.gremia voor het patroon.';

comment on table public.kritische_focusgebieden is
  'HYBRIDE (T3-register). Leespolicy "lees focusgebieden" = fonds_id IS NULL (template) OR eigen fonds. '
  'Zie public.gremia voor het patroon.';

comment on table public.documenten is
  'HYBRIDE (T3-register). Leespolicy "documenten select" = eigen fonds OR bibliotheek=''generiek''. '
  'De generieke bibliotheek is fondsoverstijgend leesbaar (gedeelde kennisbasis); '
  'fonds-documenten strikt geïsoleerd. Inserts alleen bibliotheek=''fonds'' + eigen fonds (WITH CHECK).';

comment on table public.document_inzage is
  'HYBRIDE (T3-register). Leespolicy "fonds inzage lezen" = fonds_id IS NULL OR eigen fonds. '
  'Inzage-audit van generieke documenten (fonds_id NULL) is fondsoverstijgend zichtbaar; '
  'schrijven alleen eigen logregel (gebruiker_id = auth.uid()).';

comment on table public.document_metadata_log is
  'HYBRIDE + APPEND-ONLY (T3-register). Leespolicy = fonds_id IS NULL OR eigen fonds; '
  'append-only via before update/delete-trigger (migratie 2026_06_18).';

commit;

-- ── Verificatie (handmatig) ─────────────────────────────────────────────────
--   select relname, obj_description(oid) from pg_class
--    where relname in ('fondsen','procedure_requirements','gremia','expertises',
--                      'kritische_focusgebieden','documenten','document_inzage',
--                      'document_metadata_log');
