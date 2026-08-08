-- ============================================================================
--  Migratie 2026-08-07 — Handmatig archiveren van vergaderingen (besluit 0141)
-- ----------------------------------------------------------------------------
--  Aanleiding: de vergaderingenlijst toonde `afgelopen.slice(0, 10)` — een
--  STILLE cap. Vergadering 11 en verder waren onvindbaar op die pagina, zonder
--  enige melding dat er meer was. Er is nu een expliciet, uitklapbaar archief.
--
--  ONTWERPKEUZE: twee eigen kolommen, GEEN vierde statuswaarde.
--  `vergaderingen.status` modelleert de voortgang van de voorbereiding
--  (gepland → in_voorbereiding → afgerond). Archivering staat daar los van: ze
--  zegt iets over zichtbaarheid, niet over voorbereiding. Zou archivering een
--  vierde statuswaarde worden, dan verliest een afgeronde vergadering bij
--  archivering de informatie dát ze afgerond was — precies wat je later wilt
--  terugzien. Bijkomend voordeel: de CHECK-constraint op `status` blijft
--  ongemoeid en bestaande rijen worden niet geraakt.
--
--  RLS: GEEN wijziging. De bestaande policy op public.vergaderingen dekt de
--  tenantgrens (fonds_id = eigen fonds) en geldt onverkort voor deze kolommen.
--  Er komt geen nieuwe tabel, functie of grant bij → geen structurele gate.
--
--  Idempotent: `add column if not exists` + het CHECK-patroon drop/add, conform
--  de conventie in 2026_06_18_documentstatus_metadata.sql.
--
--  UITVOERING: handmatig plakken in de Supabase SQL-editor VÓÓR de code-deploy.
--  Deploy je de code eerst, dan faalt elke SELECT op de nieuwe kolommen.
-- ============================================================================

-- ── 1. Archiefkolommen op vergaderingen ─────────────────────────────────────
-- `gearchiveerd_op` is de enige bron van waarheid voor "staat in het archief"
-- (NULL = in de lijst). `gearchiveerd_door` legt vast wie de handeling deed;
-- on delete set null zodat een verwijderd account de vergadering niet meesleept.
alter table public.vergaderingen
  add column if not exists gearchiveerd_op   timestamptz,
  add column if not exists gearchiveerd_door uuid references auth.users(id) on delete set null;

comment on column public.vergaderingen.gearchiveerd_op is
  'Besluit 0141 — handmatig archiveren. NULL = staat in de gewone lijst. Losstaand van `status`, die de voorbereidingsvoortgang modelleert.';

-- Partiële index: de gewone lijst vraagt vrijwel altijd om de NIET-gearchiveerde
-- vergaderingen. Een partiële index blijft klein en groeit niet mee met het
-- archief.
create index if not exists idx_verg_fonds_actief
  on public.vergaderingen(fonds_id, datum desc)
  where gearchiveerd_op is null;

-- ── 2. Auditgebeurtenissen toestaan in vergadering_log ──────────────────────
-- De CHECK stond op precies één waarde ('vergadering_gewijzigd'). Archiveren
-- daaronder scharen zou het onderscheid tussen "de kop is aangepast" en "de
-- vergadering is uit de lijst gehaald" onvindbaar maken in het log. Twee eigen
-- eventtypes dus, zodat je er later op kunt filteren.
do $$
begin
  alter table public.vergadering_log drop constraint if exists vergadering_log_event_type_check;
  alter table public.vergadering_log add  constraint vergadering_log_event_type_check
    check (event_type in (
      'vergadering_gewijzigd',
      'vergadering_gearchiveerd',
      'vergadering_gedearchiveerd'
    ));
end $$;

-- ── 3. Verificatie (handmatig na het draaien) ───────────────────────────────
--  select column_name, data_type
--    from information_schema.columns
--   where table_schema = 'public' and table_name = 'vergaderingen'
--     and column_name in ('gearchiveerd_op','gearchiveerd_door');
--  -- verwacht: 2 rijen.
--
--  select pg_get_constraintdef(oid)
--    from pg_constraint
--   where conname = 'vergadering_log_event_type_check';
--  -- verwacht: de drie eventtypes.
--
--  select count(*) from public.vergaderingen where gearchiveerd_op is not null;
--  -- verwacht: 0 direct na de migratie (niets wordt automatisch gearchiveerd).
