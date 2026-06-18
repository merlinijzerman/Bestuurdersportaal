-- ============================================================================
-- Migratie 2026-06-18 — Increment A: procescatalogus + organen (gremia,
-- expertises, kritische focusgebieden) als fonds-configureerbare entiteiten.
-- ----------------------------------------------------------------------------
-- Verplaatst de procescatalogus van code (lib/proces-templates.ts) naar de DB
-- en introduceert organen/expertises/focusgebieden met globale templates
-- (fonds_id NULL) die per fonds geimporteerd/aangepast kunnen worden.
--
-- Fondsconsistentie op join-tabellen = composite-FK (besluit 0007):
--   * elke fonds-gebonden parent draagt unique (fonds_id, id) als FK-doel;
--   * join-tabellen dragen fonds_id NOT NULL + twee composite-FK's
--     (voorkomt de MATCH-SIMPLE-valkuil en maakt globale templates
--      declaratief onkoppelbaar).
--
-- RLS: tenant-isolatie op eigen fonds_id via profielen (uitsluitend anon-key).
-- Catalogi met templates: lezen = eigen fonds OF globale template (voor import);
-- schrijven = alleen eigen fonds. catalogus_log is append-only (geen
-- update/delete-policy). Beheeracties worden in de API extra begrensd via de
-- capability-helper (catalog.manage); RLS dekt tenant + leesrechten.
--
-- Idempotent. Eerst in Supabase draaien, dan code-deploy. ROLLBACK: zie
-- 2026_06_18_catalogus_organen_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Procesmodellen (altijd fonds-specifiek) ─────────────────────────────
-- Geen globale procesmodel-rijen: de procesmodel-templates leven als
-- code-constante (lib/catalogus-templates.ts) en worden bij import gekopieerd
-- naar fonds-specifieke rijen.
create table if not exists public.procesmodellen (
  id                        uuid primary key default uuid_generate_v4(),
  fonds_id                  uuid not null references public.fondsen(id) on delete cascade,
  generiek_procestype       text not null,
  naam                      text not null,
  domein                    text,
  omschrijving              text,
  frequentie                text check (frequentie in
                              ('jaarlijks','kwartaal','maandelijks','ad_hoc','projectmatig','doorlopend')),
  verwachte_documenttypen   text[] default '{}',
  synoniemen                text[] default '{}',
  default_tijdlijnfases     text[] default '{}',
  default_bronstatus_regels jsonb default '{}',
  actief                    boolean not null default true,
  aangemaakt                timestamptz default now(),
  bijgewerkt                timestamptz default now(),
  -- composite-FK-doel voor join-tabellen (besluit 0007)
  unique (fonds_id, id)
);

create index if not exists idx_procesmodellen_fonds on public.procesmodellen(fonds_id, generiek_procestype);

-- ── 2. Gremia / expertises / kritische_focusgebieden ───────────────────────
-- fonds_id NULL = globale template; fonds_id gezet = fonds-specifiek record.
create table if not exists public.gremia (
  id                uuid primary key default uuid_generate_v4(),
  fonds_id          uuid references public.fondsen(id) on delete cascade,  -- NULL = template
  naam              text not null,
  type              text check (type in ('besluitvormend','adviserend','toezichthoudend','uitvoerend')),
  omschrijving      text,
  actief            boolean not null default true,
  sort_order        int default 0,
  is_template       boolean generated always as (fonds_id is null) stored,
  gekopieerd_van_id uuid references public.gremia(id),
  aangemaakt        timestamptz default now(),
  bijgewerkt        timestamptz default now(),
  unique (fonds_id, id)
);

create table if not exists public.expertises (
  id                uuid primary key default uuid_generate_v4(),
  fonds_id          uuid references public.fondsen(id) on delete cascade,
  naam              text not null,
  omschrijving      text,
  actief            boolean not null default true,
  sort_order        int default 0,
  gekopieerd_van_id uuid references public.expertises(id),
  aangemaakt        timestamptz default now(),
  bijgewerkt        timestamptz default now(),
  unique (fonds_id, id)
);

create table if not exists public.kritische_focusgebieden (
  id                uuid primary key default uuid_generate_v4(),
  fonds_id          uuid references public.fondsen(id) on delete cascade,
  naam              text not null,
  omschrijving      text,
  actief            boolean not null default true,
  sort_order        int default 0,
  gekopieerd_van_id uuid references public.kritische_focusgebieden(id),
  aangemaakt        timestamptz default now(),
  bijgewerkt        timestamptz default now(),
  unique (fonds_id, id)
);

-- Uniciteit/idempotentie. Plain unique (fonds_id, naam) dedupt globale
-- templates NIET (NULL is distinct in een unique-index), dus partiële indexen:
--   * templates uniek op naam (fonds_id IS NULL) → seed-idempotent;
--   * fonds-records uniek op (fonds_id, naam)    → geen dubbele namen per fonds.
create unique index if not exists uq_gremia_template_naam   on public.gremia (naam)            where fonds_id is null;
create unique index if not exists uq_gremia_fonds_naam      on public.gremia (fonds_id, naam)  where fonds_id is not null;
create unique index if not exists uq_expertises_template_naam on public.expertises (naam)           where fonds_id is null;
create unique index if not exists uq_expertises_fonds_naam    on public.expertises (fonds_id, naam) where fonds_id is not null;
create unique index if not exists uq_focus_template_naam      on public.kritische_focusgebieden (naam)           where fonds_id is null;
create unique index if not exists uq_focus_fonds_naam         on public.kritische_focusgebieden (fonds_id, naam) where fonds_id is not null;

create index if not exists idx_gremia_fonds      on public.gremia(fonds_id, sort_order);
create index if not exists idx_expertises_fonds  on public.expertises(fonds_id, sort_order);
create index if not exists idx_focus_fonds       on public.kritische_focusgebieden(fonds_id, sort_order);

-- ── 3. Join-tabellen (composite-FK, besluit 0007) ──────────────────────────
-- fonds_id NOT NULL is een correctheidseis (MATCH-SIMPLE-valkuil), geen smaak.
create table if not exists public.procesmodel_gremia (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null,
  procesmodel_id  uuid not null,
  gremium_id      uuid not null,
  aangemaakt      timestamptz default now(),
  aangemaakt_door uuid references auth.users(id) on delete set null,
  unique (procesmodel_id, gremium_id),
  foreign key (fonds_id, procesmodel_id)
    references public.procesmodellen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, gremium_id)
    references public.gremia (fonds_id, id) on delete cascade
);

create table if not exists public.procesmodel_expertises (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null,
  procesmodel_id  uuid not null,
  expertise_id    uuid not null,
  aangemaakt      timestamptz default now(),
  aangemaakt_door uuid references auth.users(id) on delete set null,
  unique (procesmodel_id, expertise_id),
  foreign key (fonds_id, procesmodel_id)
    references public.procesmodellen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, expertise_id)
    references public.expertises (fonds_id, id) on delete cascade
);

create table if not exists public.procesmodel_focusgebieden (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null,
  procesmodel_id  uuid not null,
  focusgebied_id  uuid not null,
  aangemaakt      timestamptz default now(),
  aangemaakt_door uuid references auth.users(id) on delete set null,
  unique (procesmodel_id, focusgebied_id),
  foreign key (fonds_id, procesmodel_id)
    references public.procesmodellen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, focusgebied_id)
    references public.kritische_focusgebieden (fonds_id, id) on delete cascade
);

create index if not exists idx_pm_gremia_pm  on public.procesmodel_gremia(procesmodel_id);
create index if not exists idx_pm_exp_pm      on public.procesmodel_expertises(procesmodel_id);
create index if not exists idx_pm_focus_pm    on public.procesmodel_focusgebieden(procesmodel_id);

-- ── 4. Koppeling op procedures ─────────────────────────────────────────────
-- Nullable tijdens migratie; bestaande procedures behouden template_code.
alter table public.procedures
  add column if not exists procesmodel_id uuid references public.procesmodellen(id);
create index if not exists idx_procedures_procesmodel on public.procedures(procesmodel_id);

-- ── 5. Catalogus-log (append-only, governance-relevant) ────────────────────
create table if not exists public.catalogus_log (
  id          uuid primary key default uuid_generate_v4(),
  fonds_id    uuid not null references public.fondsen(id) on delete cascade,
  entiteit    text not null,   -- 'procesmodel'|'gremium'|'expertise'|'focusgebied'|'koppeling'|'import'
  entiteit_id uuid,
  event_type  text not null,   -- 'aangemaakt'|'gewijzigd'|'gedeactiveerd'|'gekoppeld'|'ontkoppeld'|'geimporteerd'
  actor_id    uuid references auth.users(id) on delete set null,
  payload     jsonb default '{}',
  tijdstip    timestamptz default now()
);
create index if not exists idx_catalogus_log_fonds on public.catalogus_log(fonds_id, tijdstip desc);

-- ── 6. Row Level Security ──────────────────────────────────────────────────
alter table public.procesmodellen            enable row level security;
alter table public.gremia                     enable row level security;
alter table public.expertises                 enable row level security;
alter table public.kritische_focusgebieden    enable row level security;
alter table public.procesmodel_gremia         enable row level security;
alter table public.procesmodel_expertises     enable row level security;
alter table public.procesmodel_focusgebieden  enable row level security;
alter table public.catalogus_log              enable row level security;

-- procesmodellen: eigen fonds (lezen + schrijven onder tenant; capability in API)
drop policy if exists "fonds procesmodellen" on public.procesmodellen;
create policy "fonds procesmodellen" on public.procesmodellen
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- gremia: lezen = eigen fonds OF globale template; schrijven = alleen eigen fonds.
-- (Meerdere permissive policies worden ge-OR'd: SELECT ziet eigen-fonds OF
--  template; INSERT/UPDATE/DELETE alleen eigen fonds via de schrijf-policy.)
drop policy if exists "lees gremia" on public.gremia;
create policy "lees gremia" on public.gremia
  for select using (
    fonds_id is null
    or fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );
drop policy if exists "schrijf gremia" on public.gremia;
create policy "schrijf gremia" on public.gremia
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "lees expertises" on public.expertises;
create policy "lees expertises" on public.expertises
  for select using (
    fonds_id is null
    or fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );
drop policy if exists "schrijf expertises" on public.expertises;
create policy "schrijf expertises" on public.expertises
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "lees focusgebieden" on public.kritische_focusgebieden;
create policy "lees focusgebieden" on public.kritische_focusgebieden
  for select using (
    fonds_id is null
    or fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );
drop policy if exists "schrijf focusgebieden" on public.kritische_focusgebieden;
create policy "schrijf focusgebieden" on public.kritische_focusgebieden
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- join-tabellen: tenant-isolatie op eigen fonds_id
drop policy if exists "fonds procesmodel_gremia" on public.procesmodel_gremia;
create policy "fonds procesmodel_gremia" on public.procesmodel_gremia
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds procesmodel_expertises" on public.procesmodel_expertises;
create policy "fonds procesmodel_expertises" on public.procesmodel_expertises
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds procesmodel_focusgebieden" on public.procesmodel_focusgebieden;
create policy "fonds procesmodel_focusgebieden" on public.procesmodel_focusgebieden
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- catalogus_log: lezen eigen fonds; append-only (insert-only, geen update/delete)
drop policy if exists "lees catalogus_log" on public.catalogus_log;
create policy "lees catalogus_log" on public.catalogus_log
  for select using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));
drop policy if exists "schrijf catalogus_log" on public.catalogus_log;
create policy "schrijf catalogus_log" on public.catalogus_log
  for insert with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 7. Seed: globale templates (fonds_id NULL) ─────────────────────────────
-- WERKVOORSTEL: professioneel standaardvoorstel voor NL-pensioenfondsen.
-- Te valideren met de bestuurssecretaris vóór livegang (besluit/§17.5). Alle
-- namen zijn per fonds aanpasbaar; dit zijn importeerbare startwaarden.

insert into public.gremia (fonds_id, naam, type, omschrijving, sort_order) values
  (null, 'Bestuur',                        'besluitvormend',  'Het verantwoordelijke bestuursorgaan van het fonds.', 10),
  (null, 'Dagelijks bestuur',              'besluitvormend',  'Dagelijkse leiding binnen mandaat van het bestuur.', 20),
  (null, 'Beleggingsadviescommissie (BAC)','adviserend',      'Adviseert het bestuur over beleggingsbeleid en -uitvoering.', 30),
  (null, 'Risicocommissie',                'adviserend',      'Adviseert over risicobeheersing (second line).', 40),
  (null, 'Auditcommissie',                 'adviserend',      'Adviseert over verslaggeving, controle en beheersing.', 50),
  (null, 'Communicatiecommissie',          'adviserend',      'Adviseert over deelnemerscommunicatie.', 60),
  (null, 'Verantwoordingsorgaan (VO)',     'toezichthoudend', 'Beoordeelt het handelen van het bestuur; advies- en verantwoordingsrechten.', 70),
  (null, 'Raad van Toezicht (RvT)',        'toezichthoudend', 'Houdt intern toezicht op beleid en algemene gang van zaken.', 80),
  (null, 'Pensioenuitvoerder',             'uitvoerend',      'Voert de pensioenadministratie en -uitvoering uit (uitbesteed).', 90),
  (null, 'Vermogensbeheerder',             'uitvoerend',      'Voert het beleggingsbeleid operationeel uit (uitbesteed).', 100)
on conflict do nothing;

insert into public.expertises (fonds_id, naam, omschrijving, sort_order) values
  (null, 'Beleggingen & vermogensbeheer',        'Beleggingsbeleid, portefeuille, ALM, rendement/risico.', 10),
  (null, 'Risicomanagement',                      'Integraal risicobeheer, risicobereidheid, second-line.', 20),
  (null, 'Compliance & juridisch',                'Wet- en regelgeving, integriteit, naleving.', 30),
  (null, 'Governance & bestuur',                  'Besturing, checks-and-balances, geschiktheid.', 40),
  (null, 'Actuariaat & balansmanagement',         'Actuariële opzet, dekkingsgraad, financiële sturing.', 50),
  (null, 'Pensioenrecht & Wtp',                   'Pensioenwetgeving, Wtp-transitie, invaren.', 60),
  (null, 'Uitbesteding & leveranciersmanagement', 'Uitbestedingsbeleid, SLA, DNB Good Practice.', 70),
  (null, 'Communicatie & stakeholdermanagement',  'Deelnemerscommunicatie, draagvlak, hoorrecht.', 80),
  (null, 'Financiën & verslaggeving',             'Jaarrekening, kostenbeheersing, rapportage.', 90),
  (null, 'IT & datamanagement',                   'Datakwaliteit, informatiebeveiliging, IT-beheersing.', 100)
on conflict do nothing;

insert into public.kritische_focusgebieden (fonds_id, naam, omschrijving, sort_order) values
  (null, 'Evenwichtige belangenafweging',      'Evenwichtige afweging tussen alle belanghebbenden.', 10),
  (null, 'Wtp-transitie en invaren',           'Besluitvorming en uitvoering rond de Wtp-overgang.', 20),
  (null, 'Beleggingsbeleid en rendement',      'Strategisch beleggingsbeleid en behaalde resultaten.', 30),
  (null, 'Risicobereidheid en -beheersing',    'Vastgestelde risicobereidheid en beheersmaatregelen.', 40),
  (null, 'Financiële opzet en dekkingsgraad',  'Financiële gezondheid en houdbaarheid.', 50),
  (null, 'Uitvoeringskwaliteit en uitbesteding','Kwaliteit en beheersing van (uitbestede) uitvoering.', 60),
  (null, 'Compliance en wet- en regelgeving',  'Naleving van toepasselijke wet- en regelgeving.', 70),
  (null, 'Deelnemerscommunicatie',             'Begrijpelijke en tijdige communicatie naar deelnemers.', 80),
  (null, 'Datakwaliteit en IT-beheersing',     'Betrouwbaarheid van data en informatiesystemen.', 90),
  (null, 'Kosten en doelmatigheid',            'Beheersing van uitvoerings- en vermogensbeheerkosten.', 100)
on conflict do nothing;
