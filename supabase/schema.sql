-- ============================================================
--  Bestuurdersportaal — Supabase Database Schema
--  Plak dit in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Extensies
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";  -- voor full-text zoeken

-- ── 1. Fondsen ─────────────────────────────────────────────
create table if not exists public.fondsen (
  id          uuid primary key default uuid_generate_v4(),
  naam        text not null,
  slug        text unique not null,
  aangemaakt  timestamptz default now()
);

-- Voeg een standaard fonds in
insert into public.fondsen (naam, slug) values
  ('Stichting Pensioenfonds Horizon', 'horizon')
on conflict (slug) do nothing;

-- ── 2. Gebruikers-profielen ────────────────────────────────
-- (Aanvullend op Supabase Auth)
create table if not exists public.profielen (
  id          uuid primary key references auth.users(id) on delete cascade,
  fonds_id    uuid references public.fondsen(id),
  naam        text,
  rol         text check (rol in ('bestuurder','voorzitter','beheerder')) default 'bestuurder',
  aangemaakt  timestamptz default now(),
  -- Increment F (FO §14, migratie 2026_06_22_profiel.sql) — persoonlijk
  -- bestuurdersprofiel. Strikt zelfbeheerd (besluit 0017): alleen de persoon zelf
  -- muteert het eigen profiel (RLS id=auth.uid()); geen beheerder-override.
  -- primaire_expertise_id koppelt via composite-FK (fonds_id, id) aan expertises;
  -- uq_profielen_fonds_id (fonds_id, id) maakt die composite-verwijzing mogelijk.
  bestuurlijke_rol       text,
  primaire_expertise_id  uuid,
  antwoordvoorkeur       text,  -- 'kern-eerst' | 'puntsgewijs' | 'lopende tekst' (app-validatie)
  standaard_ai_modus     text,  -- voorselectie AI-antwoordmodus (lib/vraagtype ANTWOORDMODI)
  detailniveau           text   -- 'beknopt' | 'standaard' | 'uitgebreid' (app-validatie)
);

-- Increment F — koppel-/audittabellen (volledige definitie in
-- migratie 2026_06_22_profiel.sql; hier alleen documentatie). Elk met composite-FK
-- (fonds_id NOT NULL) naar parent(fonds_id, id) — globale templates declaratief
-- ontkoppelbaar. RLS join-tabellen: for all using/with check (profiel_id=auth.uid()).
-- profiel_log is append-only (geen update/delete-policy), fonds-breed leesbaar,
-- bevat uitsluitend metadata over wijzigingen (geen profielinhoud-as-waarheid).
--   profiel_expertises    (profiel_id, expertise_id)   → expertises
--   profiel_gremia        (profiel_id, gremium_id)     → gremia
--   profiel_focusgebieden (profiel_id, focusgebied_id) → kritische_focusgebieden
--   profiel_log           (append-only audit)
-- RPC profiel_opslaan(...) (migratie 2026_06_22_profiel_rpc.sql; hier alleen
-- documentatie): SECURITY INVOKER-functie die profielvelden + de 3 koppeling-sets
-- + de append-only profiel_log-insert in ÉÉN transactie uitvoert, zodat een
-- partiële fout volledig terugrolt en een wijziging zonder auditregel onmogelijk
-- is. RLS blijft onverkort gelden (geen DEFINER, geen service-role).

-- Automatisch profiel aanmaken bij registratie.
-- Authoritatief in de migraties: 2026-06-23b (platform-skip-guard) +
-- 2026-07-08 (R1, deterministische fondstoewijzing). Hier alleen documentatie.
--  - Platform-back-office-accounts ({"platform": true}) krijgen bewust GEEN
--    tenant-profiel.
--  - Het fonds komt UITSLUITEND uit raw_user_meta_data.fonds_id (geen limit 1 /
--    default-fonds). Ontbrekend/ongeldig/onbekend fonds → fail-closed exception
--    (auth.users-insert rolt terug). Zie decisions/0044.
create or replace function public.maak_profiel()
returns trigger language plpgsql security definer as $$
declare
  v_fonds_tekst text;
  v_fonds_id    uuid;
begin
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  v_fonds_tekst := new.raw_user_meta_data->>'fonds_id';

  if v_fonds_tekst is null or btrim(v_fonds_tekst) = '' then
    raise exception
      'maak_profiel: geen fonds_id in user-metadata (geen default/eerste-fonds). Zie decisions/0044.'
      using errcode = 'check_violation';
  end if;

  begin
    v_fonds_id := v_fonds_tekst::uuid;
  exception
    when others then
      raise exception 'maak_profiel: fonds_id (%) is geen geldige UUID.', v_fonds_tekst
        using errcode = 'check_violation';
  end;

  if not exists (select 1 from public.fondsen f where f.id = v_fonds_id) then
    raise exception 'maak_profiel: fonds_id % bestaat niet in public.fondsen.', v_fonds_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    v_fonds_id
  );
  return new;
end;
$$;

drop trigger if exists bij_registratie on auth.users;
create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();

-- ── 2b. Organisatieprofiel ─────────────────────────────────
-- Generiek, bestuurlijk-licht contextprofiel per organisatie (1-op-1 met
-- fondsen). Grondt AI-duiding met organisatiespecifieke feiten + strategie en
-- voorkomt sectoraannames. Migratie 2026_07_06_organisatie_profielen.sql is
-- authoritatief; dit is documentatie. FO Organisatieprofiel v0.4 (§4/§5, FR-1).
--
-- GEEN vaststellings-/status-laag: geen profiel_status/gating (elk profiel
-- direct actief). Van beheer resteert alleen wie/wanneer-audit (bijgewerkt_door/
-- -op). Bewerken kan langs twee wegen: (1) tenant-zelfservice door de fonds-
-- beheerder in het portaal (tab op Mijn profiel, capability
-- organisation.profile.manage, alleen rol 'beheerder'); (2) de platform-back-
-- office via de service-role (omzeilt RLS). Zie besluit 0038 (herzien).
--
-- RLS: aan. SELECT eigen fonds (fonds_id = profielen.fonds_id van auth.uid()).
-- INSERT/UPDATE eigen fonds (migratie 2026_07_07_organisatieprofiel_tenant_write.sql);
-- de beheerder-rolgate zit server-side in /api/organisatieprofiel, niet in RLS
-- (huispatroon: RLS = fonds-isolatie, code = rolgate). Geen DELETE-policy.
-- Trigger trg_organisatie_profielen_touch zet bijgewerkt_op op now() bij UPDATE.
create table if not exists public.organisatie_profielen (
  id                       uuid primary key default uuid_generate_v4(),
  fonds_id                 uuid not null unique
                             references public.fondsen(id) on delete cascade,
  organisatietype          text,   -- generiek type (bijv. "pensioenfonds (OPF)")
  uitvoerende_partijen     text,   -- administrateur, vermogensbeheerder e.d.
  omvang                   text,   -- korte omvang-indicatie
  kernfeiten               text,   -- overige stabiele, foutgevoelige feiten
  missie                   text check (missie is null or char_length(missie) <= 600),
  visie                    text check (visie is null or char_length(visie) <= 600),
  strategische_speerpunten text check (strategische_speerpunten is null
                             or char_length(strategische_speerpunten) <= 600),
  risicohouding            text check (risicohouding is null
                             or char_length(risicohouding) <= 600),
  peildatum                date,   -- optioneel; promptblok + conflictregel
  bijgewerkt_door          text,   -- audit: wie (back-office, geen FK)
  bijgewerkt_op            timestamptz not null default now(),  -- audit: wanneer (trigger)
  aangemaakt_op            timestamptz not null default now()
);

-- ── 2b. Tenant-domains (host→fonds-mapping, besluit 0040 B4) ─────────────────
-- Globale mappingtabel voor de server-side tenant-resolver. BEWUSTE GLOBALE /
-- UITZONDERINGSTABEL: RLS aan, deny-by-default (GEEN policy) → alleen leesbaar
-- via de service-role (T1.2). Defense-in-depth naast RLS, geen autorisatie.
-- Pure resolver: lib/tenant-host.ts (bepaalFondsContext, fail-closed).
create table if not exists public.tenant_domains (
  id            uuid primary key default gen_random_uuid(),
  host          text not null unique,   -- genormaliseerd: lowercase, geen poort, geen leidende www.
  fonds_id      uuid not null references public.fondsen(id) on delete restrict,
  actief        boolean not null default true,   -- actief=false → host geldt als onbekend
  aangemaakt_op timestamptz not null default now()
);
create unique index if not exists tenant_domains_host_idx
  on public.tenant_domains (host);
-- RLS aan, deny-by-default: GEEN policy (bewuste globale tabel, RLS-hardening 0040).
alter table public.tenant_domains enable row level security;
-- Seed (T1.3, besluit 0042): pilothost Horizon, via fondsen.slug i.p.v. UUID.
-- Migratie 2026_07_08_tenant_domains_seed.sql. Fail-closed afdwinging staat achter
-- env TENANT_ENFORCE=on (alleen productie, pas ná seed + observatie-gate).
insert into public.tenant_domains (host, fonds_id, actief)
select 'horizon.bestuurdersportaal.com', f.id, true
from public.fondsen f where f.slug = 'horizon'
on conflict (host) do nothing;
-- Transitionele bridge (besluit 0043): de gedeelde app-host resolveert óók naar
-- Horizon zolang single-tenant. Migratie 2026_07_08_tenant_domains_bridge_app_host.sql.
-- VERWIJDEREN (rollback) vóór het onboarden van een tweede fonds.
insert into public.tenant_domains (host, fonds_id, actief)
select 'app.bestuurdersportaal.com', f.id, true
from public.fondsen f where f.slug = 'horizon'
on conflict (host) do nothing;

-- ── 3. Documenten ──────────────────────────────────────────
create table if not exists public.documenten (
  id            uuid primary key default uuid_generate_v4(),
  fonds_id      uuid references public.fondsen(id),
  bibliotheek   text check (bibliotheek in ('generiek','fonds')) not null,
  bron          text check (bron in ('DNB','AFM','Pensioenfederatie','Intern','Extern')) not null,
  titel         text not null,
  bestandsnaam  text,
  paginas       int,
  gepubliceerd  date,
  geindexeerd   boolean default false,
  opgeslagen_door uuid references auth.users(id),
  aangemaakt    timestamptz default now(),
  -- Primaire procesinstantie-koppeling (Increment B). Fondsconsistentie
  -- (document-fonds = procesinstantie-fonds) via trigger; generieke docs
  -- (fonds_id NULL) kunnen daardoor niet aan een fonds-dossier koppelen.
  procesinstantie_id uuid references public.procedures(id) on delete set null,
  -- Increment C — statusmodel (3 lagen) + metadata. Migratie
  -- 2026_06_18_documentstatus_metadata.sql is authoritatief; dit is documentatie.
  -- Laag 1 = actief (boven); laag 2 = status; laag 3 = bronstatus.
  context        text not null default 'algemeen'
                   check (context in ('dossier','vergadering','algemeen')),
  vergadering_id uuid references public.vergaderingen(id) on delete set null,
  documenttype   text check (documenttype in (
                   'beleid','besluit','besluitdocument','besluitregistratie',
                   'bestuursvoorstel','notulen','advies','memo','analyse','bijlage','overig')),
  status         text check (status in (
                   'concept','ter_bespreking','ter_besluitvorming','vastgesteld',
                   'van_kracht','vervangen','alleen_historisch','gearchiveerd')),
  -- bronstatus NULL ≡ "actief" tijdens de overgang (Increment C backfill);
  -- strikte filtering komt in Increment G.
  bronstatus     text check (bronstatus in (
                   'actief','historisch','uitgesloten','actief_na_vaststelling')),
  documentdatum  date,
  geldig_vanaf   date,
  geldig_tot     date,
  vervangt_document_id       uuid references public.documenten(id) on delete set null,
  vervangen_door_document_id uuid references public.documenten(id) on delete set null,
  -- Increment C+/B13 — bronsoort-metadata voor generieke documenten (migratie
  -- 2026_06_20e, authoritatief). 'bibliotheek' IS de bronsoort (B12); deze 3 zijn
  -- aanvullende beschrijvende velden, beheerd op het platform-pad (P1/B14).
  bronorganisatie text,
  extern_url      text,
  normgewicht     text check (normgewicht is null or normgewicht in
                   ('bindend','toezichtverwachting','sector_guidance','informatief','onbekend')),
  metadata_te_controleren    boolean not null default false,
  metadata_review_status     text not null default 'niet_nodig'
                   check (metadata_review_status in ('niet_nodig','te_controleren','gecontroleerd','afgewezen')),
  metadata_gecontroleerd_door uuid references auth.users(id) on delete set null,
  metadata_gecontroleerd_op   timestamptz,
  -- OCR-audit (besluit 0020, migratie 2026_06_22x_ocr_audit.sql authoritatief).
  -- ocr_toegepast = inhoud via OCR-fallback verkregen i.p.v. PDF-tekstlaag;
  -- ocr_engine bv. 'mistral:mistral-ocr-latest' (NULL = tekstlaag gebruikt).
  ocr_toegepast  boolean not null default false,
  ocr_engine     text,
  -- Increment P1/B14 — generieke documentcuratie (platform back-office). Migratie
  -- 2026_06_24_p1_generieke_curatie.sql is authoritatief; dit is documentatie.
  -- Toepasbaarheidsmetadata (§8.1) + uploadsecurity-velden (§8.2), alle nullable/
  -- additief. regelingstype-enum + verwerkingsstatus-pipeline-enum via CHECK.
  -- bestand_hash voedt de partial-unique dedup-index ux_documenten_generiek_hash
  -- (alleen bibliotheek='generiek'); tenant-uploads raken die niet.
  toepassingsgebied   text,
  regelingstype       text check (regelingstype is null or regelingstype in
                        ('FTK','SPR','FPR','CVP','algemeen')),
  doelgroep           text,
  thema               text,
  statusinterpretatie text,
  verwerkingsstatus   text check (verwerkingsstatus is null or verwerkingsstatus in
                        ('ontvangen','gevalideerd','gescand','extractie','chunking',
                         'embedding','beschikbaar','geweigerd','gequarantineerd','mislukt')),
  scan_resultaat      jsonb,
  bestand_hash        text,
  mime_gedetecteerd   text,
  -- Increment P1 — bestandstype-CHECK uitgebreid met 'pptx' (§8.2). Authoritatief
  -- in 2026_06_24; oorspronkelijk 2026_05_03 (pdf/docx/xlsx). 'bestandstype' en
  -- 'opslag_pad' bestaan al sinds eerdere migraties (hier niet eerder gedocumenteerd).
  -- bestandstype  text check (bestandstype in ('pdf','docx','pptx','xlsx')),
  -- Contextvalidatie (CHECK): dossier→procesinstantie_id, vergadering→vergadering_id,
  -- agendapunt→vergadering. Statusovergangen + secundaire koppelingen via triggers.
  constraint documenten_context_dossier_check
    check (context <> 'dossier' or procesinstantie_id is not null),
  constraint documenten_context_vergadering_check
    check (context <> 'vergadering' or vergadering_id is not null),
  constraint documenten_agendapunt_vergadering_check
    check (agendapunt_id is null or vergadering_id is not null)
);

-- Increment C — secundaire dossierkoppelingen, append-only metadata-auditlog en
-- metadata-review-queue. Volledige definitie + triggers/RLS in migratie
-- 2026_06_18_documentstatus_metadata.sql (authoritatief).
create table if not exists public.document_procesinstanties (
  id uuid primary key default uuid_generate_v4(),
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  document_id uuid not null references public.documenten(id) on delete cascade,
  procesinstantie_id uuid not null references public.procedures(id) on delete cascade,
  aangemaakt_door uuid references auth.users(id) on delete set null,
  aangemaakt timestamptz default now(),
  unique (document_id, procesinstantie_id)
);

create table if not exists public.document_metadata_log (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid references public.documenten(id) on delete set null,
  document_titel_snapshot text,
  fonds_id uuid references public.fondsen(id) on delete set null,
  gewijzigd_door uuid references auth.users(id) on delete set null,
  gewijzigd_door_naam text,
  gewijzigd_op timestamptz default now(),
  veld_naam text not null,
  oude_waarde text, nieuwe_waarde text,
  wijzig_reden text, wijzig_type text,
  rag_impact boolean default false,
  hash text, tijdstip timestamptz default now()
);

create table if not exists public.document_metadata_review_queue (
  id uuid primary key default uuid_generate_v4(),
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  document_id uuid not null references public.documenten(id) on delete cascade,
  reden text not null check (reden in ('backfill','ontbrekende_metadata','onzekere_status','handmatig')),
  status text not null default 'open' check (status in ('open','in_behandeling','gecontroleerd','afgewezen')),
  aangemaakt timestamptz default now(),
  beoordeeld_door uuid references auth.users(id) on delete set null,
  beoordeeld_op timestamptz, opmerking text,
  unique (document_id)
);

-- Increment P1/B14 — per-stap pipelineregistratie voor de generieke uploadsecurity-
-- pipeline. Migratie 2026_06_24_p1_generieke_curatie.sql is authoritatief.
-- NIET append-only (status/retry_count = operationele state die muteert). Platform-
-- intern: RLS aan + deny-by-default (geen policy); toegang via service-role achter
-- withPlatform. correlatie_id koppelt aan platform_event_log voor de audit-trail.
create table if not exists public.document_processing_jobs (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documenten(id) on delete cascade,
  versie_id     uuid references public.documenten(id) on delete set null,
  stap          text not null check (stap in
                  ('validatie','scan','extractie','ocr','chunking','embedding','indexering')),
  status        text not null default 'wachtend' check (status in
                  ('wachtend','bezig','geslaagd','mislukt','overgeslagen')),
  start         timestamptz,
  eind          timestamptz,
  foutcode      text,
  retry_count   integer not null default 0,
  worker_id     text,
  correlatie_id uuid,
  aangemaakt    timestamptz not null default now()
);

-- ── 3d. Notulensegmenten (Increment D, migratie 2026_06_20d, authoritatief) ──
-- Half-automatische segmenten per agendapunt. Alleen bevestigd=true wordt
-- geïndexeerd (document_chunks.notulen_segment_id) en door de AI als
-- agendapuntbron gebruikt. Trigger fn_notulen_segment_check borgt
-- documenttype=notulen + agendapunt↔vergadering + fondsconsistentie.
create table if not exists public.notulen_segmenten (
  id             uuid primary key default uuid_generate_v4(),
  document_id    uuid not null references public.documenten(id)    on delete cascade,
  vergadering_id uuid not null references public.vergaderingen(id) on delete cascade,
  agendapunt_id  uuid          references public.agendapunten(id)  on delete set null,
  fonds_id       uuid not null references public.fondsen(id)       on delete cascade,
  segment_index  int  not null,
  titel          text,
  tekst          text not null,
  bevestigd      boolean not null default false,
  bevestigd_door uuid references auth.users(id) on delete set null,
  bevestigd_op   timestamptz,
  aangemaakt     timestamptz not null default now(),
  unique (document_id, segment_index)
);

-- ── 4. Document chunks (voor zoeken) ──────────────────────
-- Increment E (migratie 2026_06_19e_indexering_classificatie.sql, authoritatief)
-- voegt gedenormaliseerde proces-/status-/geldigheidsvelden toe zodat Increment G
-- goedkoop kan filteren vóór retrieval. E SLAAT alleen op (de hybride zoek-RPC
-- blijft ongewijzigd); G filtert. Sync via DB-triggers (fn_chunk_denorm):
-- BEFORE INSERT op document_chunks + AFTER UPDATE op documenten. Geen re-embed.
create table if not exists public.document_chunks (
  id            uuid primary key default uuid_generate_v4(),
  document_id   uuid references public.documenten(id) on delete cascade,
  chunk_index   int not null,
  tekst         text not null,
  pagina        int,
  paragraaf     text,  -- bijv. "§3.2" of "Art. 12"
  -- R1.2 (contextual retrieval, migratie 2026_06_24_rag_structuur_contextueel,
  -- authoritatief): FTS indexeert de VERRIJKTE tekst (context_prefix + tekst).
  -- prefix NULL => to_tsvector('dutch', tekst) = baseline. `tekst` blijft het
  -- weergaveveld en wordt nooit aangeraakt (prefix-isolatie).
  zoek_vector   tsvector generated always as (
    to_tsvector('dutch', coalesce(context_prefix || ' ', '') || tekst)
  ) stored,
  aangemaakt    timestamptz default now(),
  -- R1.1 — structuur-metadata bovenop pagina/paragraaf (migratie 2026_06_24):
  structuur_type  text,   -- artikel|paragraaf|definitie|besluit|tabel|kop|tekst
  structuur_label text,    -- bv. "Artikel 12", "§3.2", "Tabblad: Dekkingsgraad"
  -- R1.2 — context-prefix (NOOIT getoond; alleen embedding + FTS) + herkomst:
  context_prefix    text,
  prefix_model      text,  -- model dat de prefix maakte (NULL = geen prefix)
  indexering_versie text,   -- bv. 'r1-structuur-contextueel' (NULL = baseline)
  -- embedding/embedding_model worden additief toegevoegd bij ── 5c (Fase C).
  -- Increment E — denorm uit documenten + primaire procesinstantie (nullable):
  procesmodel_id     uuid references public.procesmodellen(id) on delete set null,
  procesinstantie_id uuid references public.procedures(id)     on delete set null,
  vergadering_id     uuid references public.vergaderingen(id)  on delete set null,
  agendapunt_id      uuid references public.agendapunten(id)   on delete set null,
  documenttype       text,
  documentstatus     text,
  documentdatum      date,
  periode            text,                  -- jaar van de procesinstantie of documentdatum
  bronstatus         text,
  geldig_vanaf       date,
  geldig_tot         date,
  -- Increment C+/B13 — bronsoort-denorm (migratie 2026_06_20e, authoritatief),
  -- vooruitgetrokken uit G via dezelfde fn_chunk_denorm. geldig_tot (boven)
  -- dekt de generiek-geldigheid al; deze 4 zijn de aanvullende bronsoort-velden.
  -- Index idx_chunks_bronsoort en de fn_chunk_denorm*-functies/triggers leven in
  -- de migratie (niet hier gespiegeld; schema.sql mag op dat punt achterlopen).
  bibliotheek     text,
  bronorganisatie text,
  normgewicht     text,
  extern_url      text,
  -- Increment D — markeert een segmentchunk (vs. whole-document-chunk = null).
  -- Volledige definitie in 2026_06_20d_notulen_segmenten.sql.
  notulen_segment_id uuid references public.notulen_segmenten(id) on delete cascade
);

-- Increment E — nieuw: AI-procesclassificatievoorstellen + auto-koppeling (B5).
-- Volledige definitie/RLS/indexen in 2026_06_19e_indexering_classificatie.sql.
create table if not exists public.classificatie_voorstellen (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documenten(id) on delete cascade,
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  voorgestelde_procesinstantie_id uuid references public.procedures(id) on delete set null,
  voorgesteld_documenttype text,
  confidence text not null check (confidence in ('hoog','middel','laag','geen_match')),
  bron text not null check (bron in ('titel','inhoud','periode','synoniem')),
  status text not null default 'open'
    check (status in ('open','bevestigd','afgewezen','auto_toegepast','teruggedraaid')),
  toelichting text,
  toegepast_op timestamptz, teruggedraaid_op timestamptz,
  beoordeeld_door uuid references auth.users(id) on delete set null,
  aangemaakt timestamptz default now()
);

-- Index voor full-text zoeken
create index if not exists idx_chunks_zoek on public.document_chunks using gin(zoek_vector);
create index if not exists idx_chunks_document on public.document_chunks(document_id);

-- RAG-retrieval met relevantie-sortering (ts_rank_cd). supabase-js .textSearch()
-- kan niet ORDER BY ts_rank_cd(...), daarom gebeurt het ranken hier in de DB.
-- SECURITY INVOKER: RLS op document_chunks/documenten dwingt tenant-isolatie af.
-- Zie migratie 2026_05_30_rag_ranking.sql.
-- Optionele documentscope (p_document_ids; null = hele bibliotheek), toegepast
-- VÓÓR ranking. Zie migratie 2026_06_10_document_scope.sql. De zustertfunctie
-- public.zoek_chunks_hybride (FTS+vector via RRF) heeft dezelfde scope-param in
-- beide armen — staat niet in dit documentatiebestand, zie die migratie.
create or replace function public.zoek_chunks(
  p_query text,
  p_limit int default 20,
  p_document_ids uuid[] default null
)
returns table (
  id uuid, document_id uuid, tekst text, pagina int, paragraaf text,
  chunk_index int, titel text, bron text, bibliotheek text,
  opslag_pad text, rang real
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select c.id, c.document_id, c.tekst, c.pagina, c.paragraaf, c.chunk_index,
         d.titel, d.bron, d.bibliotheek, d.opslag_pad,
         ts_rank_cd(c.zoek_vector, q.query) as rang
    from public.document_chunks c
    join public.documenten d on d.id = c.document_id
   cross join websearch_to_tsquery('dutch', p_query) as q(query)
   where d.actief = true and c.zoek_vector @@ q.query
     and (p_document_ids is null or c.document_id = any(p_document_ids))
   order by rang desc, c.chunk_index asc
   limit greatest(p_limit, 1);
$$;

-- ── 5. Governance log ──────────────────────────────────────
create table if not exists public.governance_log (
  id              uuid primary key default uuid_generate_v4(),
  gebruiker_id    uuid references auth.users(id),
  gebruiker_naam  text,
  fonds_id        uuid references public.fondsen(id),
  vraag           text not null,
  antwoord        text,
  bronnen         jsonb default '[]',  -- [{document_id, titel, pagina, paragraaf}]
  modus           text check (modus in ('documenten','combineren','algemeen')) default 'documenten',
  model           text default 'claude-sonnet-4-5',
  retrieval_meta  jsonb,  -- RAG-diagnostiek: {methode, opgehaald, geselecteerd, chunks:[{id,document_id,rang}]}
  aangemaakt      timestamptz default now()
);

-- Migratie voor bestaande installaties (idempotent)
alter table public.governance_log add column if not exists modus text default 'documenten';
alter table public.governance_log add column if not exists retrieval_meta jsonb;

create index if not exists idx_log_fonds on public.governance_log(fonds_id);
create index if not exists idx_log_gebruiker on public.governance_log(gebruiker_id);
create index if not exists idx_log_tijd on public.governance_log(aangemaakt desc);

-- ── 5b. Persistente AI-gesprekken (Fase B2) ─────────────────
-- Gebruikersgerichte opslag zodat een gesprek een refresh overleeft. Bewust
-- losgekoppeld van governance_log (dat blijft het append-only auditspoor).
-- Zie migratie 2026_06_07_gesprekken.sql. Berichten als jsonb-array; alleen de
-- auteur heeft toegang (RLS); soft-delete via gearchiveerd.
create table if not exists public.gesprekken (
  id            uuid primary key default uuid_generate_v4(),
  gebruiker_id  uuid not null references auth.users(id) on delete cascade,
  fonds_id      uuid references public.fondsen(id) on delete cascade,
  titel         text,
  berichten     jsonb not null default '[]',  -- [{rol, tekst, bronnen?, modus?}]
  gearchiveerd  boolean not null default false,
  -- Actieve documentscope (increment 1): {type, document_ids[], titels[], gezet_op}.
  -- NULL = hele bibliotheek. Zie migratie 2026_06_10_document_scope.sql.
  document_scope jsonb,
  -- Actieve antwoordmodus (Increment G): feitelijk|bronoverzicht|historisch|
  -- duiding|besluitrijpheid|sparring|persoonlijke_voorbereiding. NULL =
  -- auto-detectie per vraag. Zie migratie 2026_06_20g_retrieval_modusfamilie.sql.
  actieve_antwoordmodus text,
  aangemaakt    timestamptz default now(),
  bijgewerkt    timestamptz default now()
);

alter table public.gesprekken add column if not exists document_scope jsonb;
alter table public.gesprekken add column if not exists actieve_antwoordmodus text;

create index if not exists idx_gesprek_gebruiker
  on public.gesprekken(gebruiker_id, bijgewerkt desc)
  where gearchiveerd = false;

-- ── 5c. Fase C fundament: vector-embeddings (additief) ──────
-- Semantische vector-search náást FTS. Zie migratie
-- 2026_06_07_fase_c_embeddings.sql en het Fase C-ontwerp. Mistral mistral-embed
-- → 1024 dim. Puur additief; FTS-route blijft intact.
create extension if not exists vector;
alter table public.document_chunks
  add column if not exists embedding vector(1024);
alter table public.document_chunks
  add column if not exists embedding_model text;
create index if not exists idx_chunks_embedding
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- ── 5d. Re-index-runs (R1.1/R1.2 provenance) ────────────────
-- Lichte per-run provenance van de gedeelde re-index (structuur + contextual
-- prefix): welk model/prompt, hoeveel verwerkt, door wie. GEEN per-chunk en
-- GEEN append-only/hash-spoor; het auditspoor blijft onaangeroerd. Zie migratie
-- 2026_06_24_rag_structuur_contextueel.sql (authoritatief).
create table if not exists public.reindex_runs (
  id                uuid primary key default uuid_generate_v4(),
  fonds_id          uuid references public.fondsen(id) on delete cascade,
  bibliotheek       text,                 -- 'fonds' | 'generiek'
  prefix_model      text,
  prompt_versie     text,
  indexering_versie text,
  aantal_documenten int,
  aantal_chunks     int,
  gestart_door      uuid references auth.users(id) on delete set null,
  aangemaakt        timestamptz default now()
);
alter table public.reindex_runs enable row level security;

-- ── 6. Vergaderingen ────────────────────────────────────────
create table if not exists public.vergaderingen (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid references public.fondsen(id) on delete cascade,
  titel           text not null,
  datum           timestamptz not null,
  locatie         text,
  status          text check (status in ('gepland','in_voorbereiding','afgerond')) default 'in_voorbereiding',
  aangemaakt_door uuid references auth.users(id),
  aangemaakt      timestamptz default now()
);

create index if not exists idx_verg_fonds_datum on public.vergaderingen(fonds_id, datum desc);

-- ── 7. Agendapunten ─────────────────────────────────────────
create table if not exists public.agendapunten (
  id                uuid primary key default uuid_generate_v4(),
  vergadering_id    uuid references public.vergaderingen(id) on delete cascade,
  volgorde          int not null default 0,
  titel             text not null,
  beschrijving      text,
  categorie         text check (categorie in ('beeldvorming','oordeelsvorming','besluitvorming','informatie')) default 'informatie',
  tijdsduur_minuten int,
  verantwoordelijke text,
  aangemaakt        timestamptz default now()
);

create index if not exists idx_agenda_verg on public.agendapunten(vergadering_id, volgorde);

-- ── 8. Inbreng vooraf ───────────────────────────────────────
create table if not exists public.agendapunt_inbreng (
  id              uuid primary key default uuid_generate_v4(),
  agendapunt_id   uuid references public.agendapunten(id) on delete cascade,
  gebruiker_id    uuid references auth.users(id),
  gebruiker_naam  text,
  tekst           text not null,
  aangemaakt      timestamptz default now()
);

create index if not exists idx_inbreng_punt on public.agendapunt_inbreng(agendapunt_id, aangemaakt);

-- ── 9. Documenten uitbreiden voor vergaderstukken ──────────
alter table public.documenten add column if not exists agendapunt_id uuid references public.agendapunten(id) on delete set null;
alter table public.documenten add column if not exists samenvatting_ai text;
alter table public.documenten add column if not exists samengevat_op timestamptz;

create index if not exists idx_doc_agendapunt on public.documenten(agendapunt_id);

-- ── 10. Row Level Security ─────────────────────────────────
alter table public.fondsen enable row level security;
alter table public.profielen enable row level security;
alter table public.documenten enable row level security;
alter table public.document_chunks enable row level security;
alter table public.governance_log enable row level security;

-- Profielen: alleen eigen profiel zien
create policy "eigen profiel" on public.profielen
  for all using (auth.uid() = id);

-- Documenten (Increment C+/B13, migratie 2026_06_20e authoritatief): RLS-split per
-- command. SELECT gedeeld (eigen fonds OF generiek); INSERT/UPDATE alleen eigen
-- fonds ÉN bibliotheek='fonds'; DELETE alleen eigen fonds. Tenants zijn read-only
-- op generiek; generiek-curatie loopt interim via service-role (omzeilt RLS).
create policy "documenten select" on public.documenten
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    or bibliotheek = 'generiek');

create policy "documenten insert eigen fonds" on public.documenten
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and bibliotheek = 'fonds');

create policy "documenten update eigen fonds" on public.documenten
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and bibliotheek = 'fonds');

create policy "documenten delete eigen fonds" on public.documenten
  for delete using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- Chunks: SELECT gedeeld (incl. generiek), schrijven alleen eigen fondsdocs.
create policy "chunks select" on public.document_chunks
  for select using (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      or bibliotheek = 'generiek'));

create policy "chunks write eigen fonds" on public.document_chunks
  for all using (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds')
  ) with check (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds'));

-- Governance log: alleen eigen fonds
create policy "fonds log" on public.governance_log
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Gesprekken: alleen de auteur, binnen het eigen fonds (using + with check)
alter table public.gesprekken enable row level security;
create policy "eigen gesprekken" on public.gesprekken
  for all
  using (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  )
  with check (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Fondsen: iedereen mag lezen
create policy "fondsen lezen" on public.fondsen
  for select using (true);

-- Vergaderingen RLS
alter table public.vergaderingen enable row level security;
alter table public.agendapunten enable row level security;
alter table public.agendapunt_inbreng enable row level security;

create policy "fonds vergaderingen" on public.vergaderingen
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

create policy "fonds agendapunten" on public.agendapunten
  for all using (
    vergadering_id in (
      select id from public.vergaderingen where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

create policy "fonds inbreng lezen" on public.agendapunt_inbreng
  for select using (
    agendapunt_id in (
      select ap.id from public.agendapunten ap
      join public.vergaderingen v on v.id = ap.vergadering_id
      where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

create policy "eigen inbreng schrijven" on public.agendapunt_inbreng
  for insert with check (gebruiker_id = auth.uid());

create policy "eigen inbreng wijzigen" on public.agendapunt_inbreng
  for update using (gebruiker_id = auth.uid());

create policy "eigen inbreng verwijderen" on public.agendapunt_inbreng
  for delete using (gebruiker_id = auth.uid());

-- ── 11. Risicomatrix ────────────────────────────────────────
create table if not exists public.risicos (
  id                  uuid primary key default uuid_generate_v4(),
  fonds_id            uuid not null references public.fondsen(id) on delete cascade,
  categorie           text not null check (categorie in (
                        'financieel_actuarieel',
                        'governance_organisatie',
                        'operationeel_datakwaliteit',
                        'informatie_communicatie'
                      )),
  titel               text not null,
  toelichting         text,
  kans                int not null check (kans between 1 and 5),
  impact              int not null check (impact between 1 and 5),
  niveau              text not null check (niveau in ('laag','middel','hoog')) default 'middel',
  niveau_handmatig    boolean default false,
  type_risico         text not null check (type_risico in ('structureel','tijdelijk')) default 'structureel',
  status              text not null check (status in ('actief','gesloten')) default 'actief',
  eigenaar_id         uuid references auth.users(id) on delete set null,
  eigenaar_naam       text,
  volgende_beoordeling date,
  aangemaakt          timestamptz default now(),
  aangemaakt_door     uuid references auth.users(id) on delete set null,
  gesloten_op         timestamptz,
  gesloten_door       uuid references auth.users(id) on delete set null,
  sluit_motivering    text
);

create index if not exists idx_risicos_fonds on public.risicos(fonds_id, status, aangemaakt desc);
create index if not exists idx_risicos_categorie on public.risicos(fonds_id, categorie);

create table if not exists public.risico_maatregelen (
  id                uuid primary key default uuid_generate_v4(),
  risico_id         uuid not null references public.risicos(id) on delete cascade,
  beschrijving      text not null,
  status            text not null check (status in ('open','in_voorbereiding','genomen')) default 'open',
  verantwoordelijke text,
  procedure_id      uuid,
  volgorde          int default 0,
  aangemaakt        timestamptz default now(),
  aangemaakt_door   uuid references auth.users(id) on delete set null,
  bijgewerkt_op     timestamptz default now()
);

create index if not exists idx_maatregelen_risico on public.risico_maatregelen(risico_id, volgorde);

create table if not exists public.risico_log (
  id          uuid primary key default uuid_generate_v4(),
  risico_id   uuid not null references public.risicos(id) on delete cascade,
  event_type  text not null,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_naam  text,
  payload     jsonb default '{}',
  tijdstip    timestamptz default now()
);

create index if not exists idx_risico_log_risico on public.risico_log(risico_id, tijdstip desc);

alter table public.risicos enable row level security;
alter table public.risico_maatregelen enable row level security;
alter table public.risico_log enable row level security;

drop policy if exists "fonds risicos" on public.risicos;
create policy "fonds risicos" on public.risicos
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "fonds maatregelen" on public.risico_maatregelen;
create policy "fonds maatregelen" on public.risico_maatregelen
  for all using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds risico log" on public.risico_log;
create policy "fonds risico log" on public.risico_log
  for all using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- ── 12. Procedures (workflow & case management) ─────────────
-- Procedure = procesinstantie (UI: "dossier"). Status verbreed naar de 8
-- dossierstatussen (Increment B, migratie 2026_06_18_dossier_procesinstantie).
-- De EFFECTIEVE dossierstatus wordt afgeleid via view vw_dossier_status uit
-- het primaire Decision Object; procedures.status is de handmatige fallback.
create table if not exists public.procedures (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  template_code   text not null,
  titel           text not null,
  beschrijving    text,
  status          text not null check (status in (
                    'gepland','lopend','ter_besluitvorming','besloten',
                    'in_implementatie','afgerond','heropend','gearchiveerd'
                  )) default 'lopend',
  gestart_op      timestamptz default now(),
  gestart_door    uuid references auth.users(id) on delete set null,
  deadline        date,
  afgerond_op     timestamptz,
  -- procesmodel-koppeling (Increment A) + periode-velden (Increment B, nullable)
  procesmodel_id  uuid references public.procesmodellen(id),
  periode_type    text check (periode_type in (
                    'jaar','kwartaal','maand','projectperiode',
                    'ad_hoc','doorlopend','versiegedreven'
                  )),
  periode_start   date,
  periode_eind    date,
  periode_jaar    int
);

-- View: effectieve dossierstatus + sublabel (security_invoker; RLS van
-- procedures + decision_objects leidend). Mapping in
-- fn_dossierstatus_van_decision (TO §3.2). Zie migratie 2026_06_18_dossier.
-- create view public.vw_dossier_status with (security_invoker = true) as ...

create index if not exists idx_procedures_fonds on public.procedures(fonds_id, gestart_op desc);
create index if not exists idx_procedures_status on public.procedures(fonds_id, status);

create table if not exists public.procedure_eigenaars (
  procedure_id    uuid not null references public.procedures(id) on delete cascade,
  gebruiker_id    uuid references auth.users(id) on delete cascade,
  gebruiker_naam  text not null,
  toegevoegd_op   timestamptz default now(),
  primary key (procedure_id, gebruiker_naam)
);

create index if not exists idx_eigenaars_proc on public.procedure_eigenaars(procedure_id);

create table if not exists public.procedure_stappen (
  id                uuid primary key default uuid_generate_v4(),
  procedure_id      uuid not null references public.procedures(id) on delete cascade,
  volgorde          int not null,
  naam              text not null,
  beschrijving      text,
  vereist_besluit   boolean default false,
  geschatte_dagen   int,
  status            text not null check (status in ('open','actief','afgerond')) default 'open',
  eigenaar_naam     text,
  deadline          date,
  voltooid_op       timestamptz,
  voltooid_door     uuid references auth.users(id) on delete set null
);

create index if not exists idx_stappen_proc on public.procedure_stappen(procedure_id, volgorde);

create table if not exists public.procedure_checklist (
  id                  uuid primary key default uuid_generate_v4(),
  stap_id             uuid not null references public.procedure_stappen(id) on delete cascade,
  volgorde            int not null,
  label               text not null,
  bewijs_vereist      boolean default false,
  voldaan             boolean default false,
  voldaan_op          timestamptz,
  voldaan_door        uuid references auth.users(id) on delete set null,
  voldaan_door_naam   text,
  opmerking           text
);

create index if not exists idx_checklist_stap on public.procedure_checklist(stap_id, volgorde);

create table if not exists public.procedure_bewijs (
  id                    uuid primary key default uuid_generate_v4(),
  stap_id               uuid not null references public.procedure_stappen(id) on delete cascade,
  document_id           uuid references public.documenten(id) on delete set null,
  titel                 text not null,
  beschrijving          text,
  toegevoegd_op         timestamptz default now(),
  toegevoegd_door       uuid references auth.users(id) on delete set null,
  toegevoegd_door_naam  text
);

create index if not exists idx_bewijs_stap on public.procedure_bewijs(stap_id, toegevoegd_op desc);

create table if not exists public.procedure_besluiten (
  id                    uuid primary key default uuid_generate_v4(),
  procedure_id          uuid not null references public.procedures(id) on delete cascade,
  stap_id               uuid references public.procedure_stappen(id) on delete set null,
  vergadering_id        uuid references public.vergaderingen(id) on delete set null,
  agendapunt_id         uuid references public.agendapunten(id) on delete set null,
  formulering           text not null,
  motivering            text,
  datum                 date not null,
  vastgelegd_door       uuid references auth.users(id) on delete set null,
  vastgelegd_door_naam  text,
  vastgelegd_op         timestamptz default now()
);

create index if not exists idx_besluiten_proc on public.procedure_besluiten(procedure_id, datum desc);

create table if not exists public.procedure_log (
  id            uuid primary key default uuid_generate_v4(),
  procedure_id  uuid not null references public.procedures(id) on delete cascade,
  event_type    text not null,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_naam    text,
  payload       jsonb default '{}',
  tijdstip      timestamptz default now()
);

create index if not exists idx_proc_log_proc on public.procedure_log(procedure_id, tijdstip desc);

-- Procedures iteratie 2: koppeling agendapunt ↔ procedure-stap
alter table public.agendapunten
  add column if not exists procedure_stap_id uuid references public.procedure_stappen(id) on delete set null;
create index if not exists idx_agendapunten_procstap on public.agendapunten(procedure_stap_id);

-- ── 13. Voorbereidingen op agendapunten (persoonlijk) ────────
create table if not exists public.voorbereidingen (
  id              uuid primary key default uuid_generate_v4(),
  agendapunt_id   uuid not null references public.agendapunten(id) on delete cascade,
  gebruiker_id    uuid not null references auth.users(id) on delete cascade,
  diepte          text not null check (diepte in ('snel','grondig')) default 'snel',
  ai_output       jsonb not null default '{}',
  eigen_notities  jsonb not null default '{}',
  bronnen_meta    jsonb not null default '{}',
  gegenereerd_op  timestamptz default now(),
  bijgewerkt_op   timestamptz default now(),
  unique (agendapunt_id, gebruiker_id)
);

create index if not exists idx_voorbereiding_user on public.voorbereidingen(gebruiker_id, bijgewerkt_op desc);

alter table public.voorbereidingen enable row level security;

drop policy if exists "eigen voorbereiding" on public.voorbereidingen;
create policy "eigen voorbereiding" on public.voorbereidingen
  for all using (gebruiker_id = auth.uid())
  with check (gebruiker_id = auth.uid());

alter table public.procedures enable row level security;
alter table public.procedure_eigenaars enable row level security;
alter table public.procedure_stappen enable row level security;
alter table public.procedure_checklist enable row level security;
alter table public.procedure_bewijs enable row level security;
alter table public.procedure_besluiten enable row level security;
alter table public.procedure_log enable row level security;

drop policy if exists "fonds procedures" on public.procedures;
create policy "fonds procedures" on public.procedures
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "fonds proc eigenaars" on public.procedure_eigenaars;
create policy "fonds proc eigenaars" on public.procedure_eigenaars
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc stappen" on public.procedure_stappen;
create policy "fonds proc stappen" on public.procedure_stappen
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc checklist" on public.procedure_checklist;
create policy "fonds proc checklist" on public.procedure_checklist
  for all using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc bewijs" on public.procedure_bewijs;
create policy "fonds proc bewijs" on public.procedure_bewijs
  for all using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc besluiten" on public.procedure_besluiten;
create policy "fonds proc besluiten" on public.procedure_besluiten
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc log" on public.procedure_log;
create policy "fonds proc log" on public.procedure_log
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- ============================================================
--  Notificaties (Iteratie 3-A, 2026-05-18)
--  In-app notificaties per gebruiker. Geen e-mail.
-- ============================================================

create table if not exists public.notificaties (
  id                    uuid primary key default uuid_generate_v4(),
  ontvanger_id          uuid not null references auth.users(id) on delete cascade,
  fonds_id              uuid not null references public.fondsen(id) on delete cascade,
  type                  text not null check (type in (
                          'inbreng_geplaatst',
                          'ai_validatie_wacht',
                          'procedure_afgerond',
                          'besluit_geregistreerd',
                          'dissent_formeel_vastgelegd'
                        )),
  payload               jsonb not null default '{}',
  gerelateerd_aan_type  text,
  gerelateerd_aan_id    uuid,
  actor_id              uuid references auth.users(id) on delete set null,
  actor_naam            text,
  aangemaakt            timestamptz default now(),
  gelezen_op            timestamptz
);

create index if not exists idx_notif_ontvanger_aangemaakt
  on public.notificaties(ontvanger_id, aangemaakt desc);
create index if not exists idx_notif_ongelezen
  on public.notificaties(ontvanger_id, aangemaakt desc)
  where gelezen_op is null;
create index if not exists idx_notif_idempotent
  on public.notificaties(ontvanger_id, type, gerelateerd_aan_id, aangemaakt desc);

alter table public.notificaties enable row level security;

drop policy if exists "eigen notificaties select" on public.notificaties;
create policy "eigen notificaties select" on public.notificaties
  for select using (ontvanger_id = auth.uid());

drop policy if exists "eigen notificaties update" on public.notificaties;
create policy "eigen notificaties update" on public.notificaties
  for update using (ontvanger_id = auth.uid());

drop policy if exists "notificaties insert eigen fonds" on public.notificaties;
create policy "notificaties insert eigen fonds" on public.notificaties
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- ── Rate limiting (Security Route A — WP2) ──────────────────
-- Bron van waarheid: supabase/migrations/2026_06_10_rate_limiting.sql.
-- Sliding-window-teller in Postgres (geen Upstash, conform decisions/0005).
-- Niet-omzeilbaar: RLS staat aan ZONDER policies (deny-all) + directe rechten
-- ingetrokken; de security-definer-functie is het enige schrijf-/leespad en
-- sleutelt op auth.uid(), zodat een gebruiker zijn eigen teller niet kan
-- resetten of een vreemd gebruiker-id kan meesturen.
create table if not exists public.rate_limit_events (
  id            uuid primary key default uuid_generate_v4(),
  gebruiker_id  uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null,
  tijdstip      timestamptz not null default now()
);

create index if not exists idx_rate_limit_lookup
  on public.rate_limit_events (gebruiker_id, endpoint, tijdstip desc);

alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;

create or replace function public.fn_rate_limit_check(
  p_endpoint text,
  p_limiet   int,
  p_venster  interval
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_aantal  int;
  v_oudste  timestamptz;
  v_reset   timestamptz;
begin
  if v_uid is null then
    raise exception 'rate limit check vereist een geauthenticeerde gebruiker'
      using errcode = '28000';
  end if;

  delete from public.rate_limit_events
   where gebruiker_id = v_uid
     and endpoint = p_endpoint
     and tijdstip < now() - p_venster;

  select count(*), min(tijdstip)
    into v_aantal, v_oudste
    from public.rate_limit_events
   where gebruiker_id = v_uid
     and endpoint = p_endpoint;

  if v_aantal >= p_limiet then
    v_reset := coalesce(v_oudste, now()) + p_venster;
    return jsonb_build_object('toegestaan', false, 'resterend', 0, 'reset_at', v_reset);
  end if;

  insert into public.rate_limit_events (gebruiker_id, endpoint)
  values (v_uid, p_endpoint);

  v_reset := coalesce(v_oudste, now()) + p_venster;
  return jsonb_build_object(
    'toegestaan', true, 'resterend', p_limiet - v_aantal - 1, 'reset_at', v_reset
  );
end;
$$;

revoke all on function public.fn_rate_limit_check(text, int, interval) from public, anon;
grant execute on function public.fn_rate_limit_check(text, int, interval) to authenticated;

-- ============================================================
--  Increment A — Procescatalogus + organen (2026_06_18)
--  Documentatie; de migratie is authoritatief. Fondsconsistentie op
--  join-tabellen = composite-FK (besluit 0007): elke fonds-gebonden parent
--  draagt unique (fonds_id, id); join-tabellen dragen fonds_id NOT NULL + twee
--  composite-FK's. gremia/expertises/kritische_focusgebieden met fonds_id NULL
--  zijn globale templates (lezen mag iedereen voor import; koppelen kan niet).
-- ============================================================

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
  unique (fonds_id, id)
);

create table if not exists public.gremia (
  id                uuid primary key default uuid_generate_v4(),
  fonds_id          uuid references public.fondsen(id) on delete cascade,
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

-- Join-tabellen (fonds_id NOT NULL + dubbele composite-FK)
create table if not exists public.procesmodel_gremia (
  id uuid primary key default uuid_generate_v4(),
  fonds_id uuid not null, procesmodel_id uuid not null, gremium_id uuid not null,
  aangemaakt timestamptz default now(),
  aangemaakt_door uuid references auth.users(id) on delete set null,
  unique (procesmodel_id, gremium_id),
  foreign key (fonds_id, procesmodel_id) references public.procesmodellen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, gremium_id)     references public.gremia (fonds_id, id) on delete cascade
);
create table if not exists public.procesmodel_expertises (
  id uuid primary key default uuid_generate_v4(),
  fonds_id uuid not null, procesmodel_id uuid not null, expertise_id uuid not null,
  aangemaakt timestamptz default now(),
  aangemaakt_door uuid references auth.users(id) on delete set null,
  unique (procesmodel_id, expertise_id),
  foreign key (fonds_id, procesmodel_id) references public.procesmodellen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, expertise_id)   references public.expertises (fonds_id, id) on delete cascade
);
create table if not exists public.procesmodel_focusgebieden (
  id uuid primary key default uuid_generate_v4(),
  fonds_id uuid not null, procesmodel_id uuid not null, focusgebied_id uuid not null,
  aangemaakt timestamptz default now(),
  aangemaakt_door uuid references auth.users(id) on delete set null,
  unique (procesmodel_id, focusgebied_id),
  foreign key (fonds_id, procesmodel_id) references public.procesmodellen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, focusgebied_id) references public.kritische_focusgebieden (fonds_id, id) on delete cascade
);

-- procedures.procesmodel_id: nullable koppeling naar gekozen DB-procesmodel.
alter table public.procedures add column if not exists procesmodel_id uuid references public.procesmodellen(id);

-- Append-only koppellog
create table if not exists public.catalogus_log (
  id uuid primary key default uuid_generate_v4(),
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  entiteit text not null, entiteit_id uuid, event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb default '{}', tijdstip timestamptz default now()
);
