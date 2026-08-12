-- ============================================================================
-- Migratie 2026-08-12 (T7) — datamodel semantische laag + reproduceerbaarheid
-- ----------------------------------------------------------------------------
-- WAAROM. Documentvergelijking op bestuurlijk niveau vraagt getypeerde
-- "semantic units" (parameters, datums, beleidskeuzes) die aan een canoniek
-- concept zijn gebonden, plus reproduceerbare extractie-/vergelijkingsruns en een
-- plek voor menselijke oordelen. S1 bewees de haalbaarheid op een gecureerde
-- catalogus; T7 legt het schema. Puur ADDITIEF: geen bestaande tabel of policy
-- wijzigt, en zolang T8 (de extractiepijplijn) niets schrijft verandert er geen
-- app-gedrag. Terugdraaibaar via de ROLLBACK-migratie.
--
-- SCOPE (T7). De tabellen, constraints, indexes, RLS-policies en de startcatalogus
-- hieronder. BUITEN scope: de extractiepijplijn (T8), de vergelijking +
-- comparison_results (T5), de many-to-many concept-index semantic_unit_concepts
-- (Fase 3), UI.
--
-- BEWUSTE HERGEBRUIK-/ONTWERPBESLUITEN (voorkomt dubbele opslag):
--  • GEEN document_versions-tabel. Versionering loopt via `documenten` (nieuwe
--    upload = nieuw document) + de bestaande self-FK's vervangt_document_id /
--    vervangen_door_document_id. Een semantic_unit verwijst naar een concreet
--    (versie-)document_id.
--  • Binding als concept_id direct op semantic_units (persistent, promoteerbaar).
--    De many-to-many kandidaat-concepten met confidence is Fase 3.
--  • `concepts` is platform-globaal (canoniek, sectorbreed): geen fonds_id, curatie
--    door de catalogus-eigenaar, tenants read-only. Zelfde register-patroon als
--    wettelijk_regime_per_fondstype (T4). ⚠ Governance: de catalogus-eigenaar van
--    `concepts` moet vóór productie benoemd zijn — zonder eigenaar geen beheerde
--    catalogus (openstaand risico, zie COMMENT).
--
-- TENANT-ISOLATIE (RLS). semantic_units, extraction_run, comparison_run,
-- difference_judgements dragen elk een eigen fonds_id → gate B-predicaat
-- `fonds_id = (select fonds_id from profielen where id = auth.uid())`. `concepts`
-- is globaal read-only (`for select using(true)`, geregistreerd in de global-lijst
-- van de structurele gates + de select-allowlist van gate C).
--
-- SCHRIJFPAD (besluit T7). De pijplijn-tabellen (semantic_units, extraction_run,
-- comparison_run) worden UITSLUITEND server-side door de service-role beschreven —
-- net als de bestaande ingest-worker (Variant-C). `authenticated` krijgt daarom
-- alléén SELECT onder RLS; geen INSERT/UPDATE/DELETE-grant. Zo kan een client geen
-- extractie-provenance vervalsen. difference_judgements is wél gebruiker-geschreven
-- (INSERT met WITH CHECK op auteur + fonds).
--
-- WAARDETYPERING — DB-afgedwongen, geen trigger nodig:
--  • concepts krijgt uq_concepts_id_type (id, type); semantic_units FK't
--    (concept_id, type) → concepts(id, type). Het gedenormaliseerde type kan zo
--    NOOIT afwijken van concept.type (composite-FK denorm-lock i.p.v. trigger).
--  • CHECK dwingt de juiste value_*-kolom af per type: percentage/amount→value_num,
--    date→value_date, policy_choice→value_text. Een percentage-unit zonder
--    value_num wordt geweigerd (acceptatiecriterium).
--  • evidence is not null én niet-leeg (S1-eis).
--
-- APPEND-ONLY. extraction_run, comparison_run en difference_judgements zijn
-- onveranderlijk: geen UPDATE/DELETE-grant + de gedeelde before-update/delete-
-- trigger public.fn_log_append_only() (borg in de DB, niet alleen in grants —
-- CLAUDE.md). Gevolg voor T8/T10 (openstaand): een extraction_run wordt ÉÉN keer
-- bij afronding weggeschreven (status/finished_at meteen definitief), en promotie
-- van een difference_judgement (promoted_to_dossier) wordt een NIEUWE rij, geen
-- UPDATE. semantic_units is bewust NIET append-only (her-extractie vervangt units).
--
-- Idempotent (create ... if not exists, drop policy/trigger if exists + create,
-- on conflict do nothing). Transactioneel. EERST in Supabase draaien, DÁN
-- code-deploy. Draai na deze migratie de structurele gates (A–H) en de
-- cross-tenant suite.
-- ROLLBACK: 2026_08_12_t7_semantische_laag_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- ── 1. Canonieke conceptcatalogus (platform-globaal, read-only voor tenants) ──
create table if not exists public.concepts (
  id            uuid primary key default uuid_generate_v4(),
  key           text not null unique,           -- bv. 'solidariteitsreserve.bovengrens'
  label         text not null,
  type          text not null check (type in ('percentage','date','amount','policy_choice')),
  status        text not null check (status in ('actief','conditioneel','uitgesteld')),
  normalization jsonb,                            -- normalisatie-hints
  created_at    timestamptz not null default now(),
  -- Composite-uniek zodat semantic_units (concept_id, type) hiernaar kan FK'en en
  -- het gedenormaliseerde type nooit van concept.type kan afwijken. `id` is al PK,
  -- dus (id, type) is triviaal uniek; deze constraint bestaat puur als FK-doel.
  constraint uq_concepts_id_type unique (id, type)
);

comment on table public.concepts is
  'Canonieke, sectorbrede conceptcatalogus voor de semantische laag (T7). '
  'Platform-globaal: geen fonds_id, `for select using(true)` voor authenticated, '
  'schrijven uitsluitend via de service-role (catalogus-eigenaar). Global-by-design '
  '(T3-registerpatroon, zie de globale lijst in de structurele gates). ⚠ GOVERNANCE: '
  'de catalogus-eigenaar moet vóór productie benoemd zijn — zonder eigenaar is er '
  'geen beheerde catalogus (openstaand risico T7).';

alter table public.concepts enable row level security;

drop policy if exists "concepts lezen" on public.concepts;
create policy "concepts lezen" on public.concepts
  for select using (true);

-- Expliciete tabelgrants i.p.v. vertrouwen op de default-ACL (gate F / precedent
-- wettelijk_regime_per_fondstype). anon dicht; authenticated read-only; de
-- service-role schrijft via haar inherente rolrechten (catalogus-eigenaar-pad).
revoke all on public.concepts from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.concepts from authenticated;
grant select on table public.concepts to authenticated, service_role;

-- ── 2. Reproduceerbaarheid extractie (append-only provenance-header) ──────────
create table if not exists public.extraction_run (
  id                 uuid primary key default uuid_generate_v4(),
  fonds_id           uuid not null references public.fondsen(id),
  document_id        uuid not null references public.documenten(id),
  model              text not null,              -- HAIKU_MODEL-string
  prompt_version     text not null,
  extractor_version  text not null,
  catalog_version    text not null,              -- snapshot van de actieve catalogus
  status             text not null check (status in ('gestart','geslaagd','mislukt')),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);

comment on table public.extraction_run is
  'Reproduceerbaarheid van de extractie (T7): model/prompt/versie/catalogus-'
  'snapshot per run; elke semantic_unit hangt via extraction_run_id aan een run. '
  'Append-only (geen UPDATE/DELETE) — T8 schrijft de rij ÉÉN keer bij afronding.';

alter table public.extraction_run enable row level security;

drop policy if exists "extraction_run eigen fonds lezen" on public.extraction_run;
create policy "extraction_run eigen fonds lezen" on public.extraction_run
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

revoke all on public.extraction_run from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.extraction_run from authenticated;
grant select on table public.extraction_run to authenticated;

-- ── 3. Reproduceerbaarheid vergelijking (header; comparison_results = T5) ──────
create table if not exists public.comparison_run (
  id                 uuid primary key default uuid_generate_v4(),
  fonds_id           uuid not null references public.fondsen(id),
  mode               text not null check (mode in ('symmetrisch','coverage')),
  model              text not null,
  prompt_version     text not null,
  comparator_version text not null,
  created_at         timestamptz not null default now()
);

comment on table public.comparison_run is
  'Reproduceerbaarheid van de vergelijking (T7-header). De feitelijke '
  'comparison_results komen in T5. Append-only (geen UPDATE/DELETE).';

alter table public.comparison_run enable row level security;

drop policy if exists "comparison_run eigen fonds lezen" on public.comparison_run;
create policy "comparison_run eigen fonds lezen" on public.comparison_run
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

revoke all on public.comparison_run from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.comparison_run from authenticated;
grant select on table public.comparison_run to authenticated;

-- ── 4. Geëxtraheerde, gebonden units ─────────────────────────────────────────
create table if not exists public.semantic_units (
  id                 uuid primary key default uuid_generate_v4(),
  fonds_id           uuid not null references public.fondsen(id),
  document_id        uuid not null references public.documenten(id),
  chunk_id           uuid references public.document_chunks(id),   -- bronchunk-link (geen silo)
  concept_id         uuid not null references public.concepts(id), -- de binding
  type               text not null,                                -- denorm van concept.type (FK-gelockt)
  statement          text not null,                                -- "De bovengrens bedraagt 6,0%"
  value_raw          text not null,                                -- "6,0%"
  value_num          numeric,                                      -- percentage/amount → getal
  value_date         date,                                         -- date → ISO
  value_text         text,                                         -- policy_choice → enum
  value_unit         text,                                         -- '%', 'EUR', ...
  page               int,
  section            text,
  evidence           text not null,                                -- verbatim bronpassage (S1-eis)
  evidence_verified  boolean not null default false,               -- objectief signaal
  confidence_signals jsonb not null default '{}',                  -- schema_valid, evidence_literal, ...
  document_status    text,                                         -- denorm: gezag-signaal
  extraction_run_id  uuid not null references public.extraction_run(id),
  created_at         timestamptz not null default now(),
  -- Denorm-lock: type kan niet afwijken van concept.type (composite-FK).
  constraint fk_semantic_units_concept_type
    foreign key (concept_id, type) references public.concepts(id, type),
  -- Waardetypering: de juiste value_*-kolom is gevuld, passend bij het type. Dekt
  -- meteen dat `type` een van de vier catalogus-typen is (anders geen match).
  constraint semantic_units_waardetypering_check check (
    (type = 'percentage'    and value_num  is not null) or
    (type = 'amount'        and value_num  is not null) or
    (type = 'date'          and value_date is not null) or
    (type = 'policy_choice' and value_text is not null)
  ),
  -- Evidence altijd niet-leeg (S1-eis). chunk_id blijft nullable: evidence is de
  -- harde garantie, de chunk-koppeling is best-effort en wordt door T8 gevuld.
  constraint semantic_units_evidence_niet_leeg_check
    check (length(btrim(evidence)) > 0)
);

comment on table public.semantic_units is
  'Getypeerde, aan een canoniek concept gebonden semantic units (T7). Per fonds '
  'geïsoleerd (RLS op fonds_id). Schrijven uitsluitend via de service-role '
  '(besluit T7); authenticated is read-only. NIET append-only: her-extractie mag '
  'units vervangen. type is FK-gelockt aan concept.type; value_* is per type '
  'afgedwongen; evidence is verplicht en niet-leeg.';

alter table public.semantic_units enable row level security;

drop policy if exists "semantic_units eigen fonds lezen" on public.semantic_units;
create policy "semantic_units eigen fonds lezen" on public.semantic_units
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

revoke all on public.semantic_units from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.semantic_units from authenticated;
grant select on table public.semantic_units to authenticated;

create index if not exists idx_semantic_units_fonds_document
  on public.semantic_units (fonds_id, document_id);
create index if not exists idx_semantic_units_concept
  on public.semantic_units (concept_id);
create index if not exists idx_semantic_units_document_concept
  on public.semantic_units (document_id, concept_id);
create index if not exists idx_semantic_units_extraction_run
  on public.semantic_units (extraction_run_id);

create index if not exists idx_extraction_run_document
  on public.extraction_run (document_id);

-- ── 5. Menselijke oordelen (voedt T10; bevindings-agnostisch) ─────────────────
create table if not exists public.difference_judgements (
  id                  uuid primary key default uuid_generate_v4(),
  fonds_id            uuid not null references public.fondsen(id),
  finding_key         text not null,             -- stabiele, generieke bevindingssleutel
  user_id             uuid not null references public.profielen(id),
  judgement           text not null check (judgement in
                        ('begrepen','twijfel','oneens','mis_info','risico','verklaard_geaccepteerd')),
  rationale           text,
  evidence_ref        text,                       -- bron van de geaccepteerde verklaring
  private             boolean not null default true,
  promoted_to_dossier boolean not null default false,
  created_at          timestamptz not null default now()
);

comment on table public.difference_judgements is
  'Menselijke oordelen over vergelijkingsbevindingen (T7, voedt T10). '
  'Bevindings-agnostisch (finding_key is een generieke sleutel) zodat T10 vooruit '
  'kan. Auteur-scoped + private-aware RLS (besluit 0112-lijn): lezen als '
  'user_id=auth.uid() OF (private=false EN eigen fonds). Append-only — promotie '
  '(promoted_to_dossier) wordt in T10 een NIEUWE rij, geen UPDATE.';

alter table public.difference_judgements enable row level security;

-- Lezen: het eigen oordeel altijd; andermans oordeel alleen als het niet privé is
-- én binnen het eigen fonds. De fonds_id-binding voldoet aan gate B; de private-/
-- auteurgrens honoreert de privacylijn (persoonlijke twijfel is geen fondsbrede
-- registratie tenzij bewust gepromoot).
drop policy if exists "eigen oordelen lezen" on public.difference_judgements;
create policy "eigen oordelen lezen" on public.difference_judgements
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (user_id = auth.uid() or private = false)
  );

-- Schrijven: alleen het eigen oordeel, binnen het eigen fonds. Geen UPDATE/DELETE
-- (append-only, zie trigger onderaan).
drop policy if exists "eigen oordelen schrijven" on public.difference_judgements;
create policy "eigen oordelen schrijven" on public.difference_judgements
  for insert with check (
    user_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

revoke all on public.difference_judgements from anon;
revoke update, delete, truncate, references, trigger
  on public.difference_judgements from authenticated;
grant select, insert on table public.difference_judgements to authenticated;

create index if not exists idx_difference_judgements_fonds_finding
  on public.difference_judgements (fonds_id, finding_key);
create index if not exists idx_difference_judgements_user
  on public.difference_judgements (user_id);

-- ── 6. Append-only-borging (hergebruikt public.fn_log_append_only) ────────────
-- Onveranderlijkheid van de provenance-headers en de oordelen: naast het
-- ontbreken van UPDATE/DELETE-grants blokkeert de gedeelde before-trigger elke
-- mutatie op DB-niveau (ook voor de service-role). semantic_units krijgt bewust
-- GEEN trigger: her-extractie moet units mogen vervangen.
do $$
declare
  t text;
  appendonly text[] := array[
    'extraction_run',
    'comparison_run',
    'difference_judgements'
  ];
begin
  foreach t in array appendonly loop
    execute format('drop trigger if exists trg_%1$s_no_update on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_no_update before update on public.%1$s '
      'for each row execute procedure public.fn_log_append_only()', t);
    execute format('drop trigger if exists trg_%1$s_no_delete on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_no_delete before delete on public.%1$s '
      'for each row execute procedure public.fn_log_append_only()', t);
  end loop;
end $$;

-- ── 7. Startcatalogus (S1) ────────────────────────────────────────────────────
-- bovengrens + franchise = 'actief'; invaarmethodiek = 'conditioneel';
-- transitiedatum = 'uitgesteld'. Idempotent op de unieke `key`.
insert into public.concepts (key, label, type, status) values
  ('solidariteitsreserve.bovengrens', 'Bovengrens solidariteitsreserve', 'percentage',    'actief'),
  ('franchise',                       'Franchise',                       'amount',        'actief'),
  ('invaarmethodiek',                 'Invaarmethodiek',                 'policy_choice', 'conditioneel'),
  ('transitiedatum',                  'Transitiedatum',                  'date',          'uitgesteld')
on conflict (key) do nothing;

commit;

-- ── Verificatie (handmatig ná de migratie) ───────────────────────────────────
-- 1. Vijf tabellen met RLS aan:
--      select relname, relrowsecurity from pg_class
--       where relnamespace = 'public'::regnamespace
--         and relname in ('concepts','semantic_units','extraction_run',
--                         'comparison_run','difference_judgements')
--       order by relname;               -- → 5 rijen, relrowsecurity = t
-- 2. Startcatalogus met juiste status:
--      select key, type, status from public.concepts order by key;
--      -- → bovengrens/franchise 'actief', invaarmethodiek 'conditioneel',
--      --    transitiedatum 'uitgesteld'
-- 3. Waardetypering wordt afgedwongen (moet FALEN met check-violation):
--      insert into public.semantic_units
--        (fonds_id, document_id, concept_id, type, statement, value_raw,
--         evidence, extraction_run_id)
--      values (<fonds>, <doc>, <concept percentage>, 'percentage', 'x', '6,0%',
--              'De bovengrens bedraagt 6,0%', <run>);  -- value_num NULL → 23514
-- 4. Denorm-lock: een type dat afwijkt van concept.type faalt op de composite-FK.
-- 5. Zes append-only triggers (2 per tabel):
--      select event_object_table, event_manipulation from information_schema.triggers
--       where event_object_table in ('extraction_run','comparison_run','difference_judgements')
--       order by event_object_table, event_manipulation;
-- 6. anon ziet niets, authenticated schrijft niet op de pijplijn-tabellen:
--      select has_table_privilege('anon','public.semantic_units','select');       -- → f
--      select has_table_privilege('authenticated','public.semantic_units','insert'); -- → f
-- 7. Structurele gates A–H schoon draaien (concepts nu in de global-lijst + gate-C
--    allowlist): supabase/checks/2026_07_31_r1_structurele_gates.sql
-- 8. Gedragstoets: supabase/checks/2026_08_12_t7_semantische_laag.sql
