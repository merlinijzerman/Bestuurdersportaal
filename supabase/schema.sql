-- ============================================================
--  Bestuurdersportaal — Supabase Database Schema
--  Plak dit in: Supabase Dashboard → SQL Editor → Run
-- ============================================================
--  ⚠️ DIT BESTAND IS DOCUMENTATIE EN LOOPT ACHTER (zie CLAUDE.md). De
--  migraties in supabase/migrations/ zijn authoritatief. Niet alle latere
--  tabellen/policies staan hier (o.a. decision_objects, catalogus, platform_*,
--  tenant_domains). Verifieer altijd tegen de migraties.
--
--  T3 RLS-HARDENING (2026-07-08, besluit 0040 / beslisnotitie v0.4 §14):
--   • Elke for-all/for-update schrijf-policy heeft nu een gespiegelde WITH CHECK,
--     zodat de schrijfkant fail-closed is (geen cross-tenant fonds_id-injectie).
--     Bron: migratie 2026_07_08_t3_rls_with_check.sql. De policies hieronder zijn
--     bijgewerkt; policies buiten dit bestand zijn in dezelfde migratie gehard.
--   • De audit-logtabellen governance_log, risico_log, procedure_log en
--     agendapunt_log zijn append-only afgedwongen via before update/delete-
--     triggers. Bron: migratie 2026_07_08_t3_append_only_logs.sql.
--   • Bewust globale/hybride referentietabellen zijn gedocumenteerd via
--     COMMENT ON TABLE. Bron: 2026_07_08_t3_globale_tabellen_register.sql.
-- ============================================================

-- Extensies
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";  -- voor full-text zoeken

-- ── 1. Fondsen ─────────────────────────────────────────────
create table if not exists public.fondsen (
  id          uuid primary key default uuid_generate_v4(),
  naam        text not null,
  slug        text unique not null,
  aangemaakt  timestamptz default now(),
  -- T4 Regime-borging (migratie 2026_08_12_t4_regime_borging.sql). Compliance/
  -- platform-beheerd (NIET tenant-writable — de tenant-routes raken fondsen niet).
  -- fondstype = beheerde fondsclassificatie; primair_wettelijk_regime = het
  -- GELDENDE wettelijk regime (leest de retrieval voor de regime-demotie).
  -- NULL primair_wettelijk_regime ≡ 'algemeen' → geen demotie.
  fondstype                text
    check (fondstype is null or fondstype in ('bedrijfstak','onderneming','beroeps','apf','algemeen')),
  primair_wettelijk_regime text
    check (primair_wettelijk_regime is null or primair_wettelijk_regime in ('pw','wvb','beide','algemeen'))
);

-- T4 — beheerde mapping fondstype → primair_wettelijk_regime (juridische
-- kwalificatie in DATA, niet in code). Compliance-eigenaar. Seed = voorstel
-- (bevestigd_door_compliance markeert bevestiging). Retrieval leest het
-- authoritatieve fondsen.primair_wettelijk_regime, niet deze tabel. RLS: lezen
-- voor authenticated (using true), schrijven alleen via service-role.
create table if not exists public.wettelijk_regime_per_fondstype (
  fondstype                 text primary key
    check (fondstype in ('bedrijfstak','onderneming','beroeps','apf','algemeen')),
  primair_wettelijk_regime  text not null
    check (primair_wettelijk_regime in ('pw','wvb','beide','algemeen')),
  toelichting               text,
  bevestigd_door_compliance boolean not null default false,
  aangemaakt                timestamptz not null default now()
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
  -- 2026-08-05 (T1 bureau-rol, besluit 0128, migratie 2026_08_05_bestuursbureau_rol.sql):
  -- vierde waarde 'bestuursbureau'. Default blijft 'bestuurder' — maak_profiel()
  -- zet de rol niet; verhoging loopt via het service-role-pad (P3-B).
  rol         text check (rol in ('bestuurder','voorzitter','beheerder','bestuursbureau')) default 'bestuurder',
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
  detailniveau           text,  -- 'beknopt' | 'standaard' | 'uitgebreid' (app-validatie)
  -- Plateau B / B-6 (migratie 2026_08_05_b6_reflectie_optout.sql, besluit 0126).
  -- Permanente opt-out voor de PROACTIEVE reflectie-uitnodiging (FR-15). Zet dit
  -- de functie niet uit: de handmatige actie "Reflecteer op dit antwoord" blijft
  -- altijd bereikbaar. De frequentiebegrenzing per browsersessie staat bewust in
  -- sessionStorage en niet hier (besluit 0121) — een teller in de database zou
  -- zichtbaar maken hoe vaak iemand is aangespoord, en dat is gedragsregistratie.
  reflectie_uitnodiging  boolean not null default true
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
-- Seed (T1.3, besluit 0042): pilothost horizon.bestuurdersportaal.com was geseed via
-- 2026_07_08_tenant_domains_seed.sql, maar is op 07-08-2026 VERWIJDERD
-- (2026_08_07_tenant_domains_horizon_verwijderen.sql, besluit 0135-opruiming): die host
-- is nooit in gebruik genomen (DNS→Vercel zonder cert) en Horizon draait op de bridge-host
-- hieronder. Fail-closed afdwinging staat achter env TENANT_ENFORCE=on (alleen productie).
-- insert into public.tenant_domains (host, fonds_id, actief)
-- select 'horizon.bestuurdersportaal.com', f.id, true
-- from public.fondsen f where f.slug = 'horizon'
-- on conflict (host) do nothing;
-- Transitionele bridge (besluit 0043): de gedeelde app-host resolveert óók naar
-- Horizon zolang single-tenant. Migratie 2026_07_08_tenant_domains_bridge_app_host.sql.
-- VERWIJDEREN (rollback) vóór het onboarden van een tweede fonds.
insert into public.tenant_domains (host, fonds_id, actief)
select 'app.bestuurdersportaal.com', f.id, true
from public.fondsen f where f.slug = 'horizon'
on conflict (host) do nothing;

-- ── 2c. Bronnen-whitelist (Scenario A live web-retrieval, besluit 0072) ──────
-- Generieke platformconfiguratie (fonds_id-loos) van gezaghebbende domeinen voor
-- live web-retrieval. RLS: tenants lezen ACTIEVE entries (leespad chat-route →
-- allowed_domains); schrijven deny-by-default (alleen service-role achter
-- withPlatform, cap platform.config.manage). Weging op normgewicht (hergebruik,
-- geen parallel tier-veld). Migratie 2026_07_15_bron_whitelist.sql (authoritatief).
create table if not exists public.bron_whitelist (
  id              uuid primary key default uuid_generate_v4(),
  domein          text not null,                 -- genormaliseerd, zonder 'www.'
  matchtype       text not null default 'domein',-- 'domein'|'domein_subdomeinen'|'padprefix'
  pad             text,                           -- alleen bij matchtype='padprefix'
  normgewicht     text not null,                 -- bindend|toezichtverwachting|sector_guidance|informatief|onbekend
  categorie       text,
  tier            text,                           -- '1'|'2'|'3'|'context' — beheerlabel, niet de weging
  status          text not null default 'in_review', -- 'actief'|'inactief'|'in_review'
  toelichting     text not null,
  toegevoegd_door uuid,                           -- platform-identiteit (geen FK)
  gewijzigd_door  uuid,
  toegevoegd_op   timestamptz not null default now(),
  gewijzigd_op    timestamptz not null default now(),
  review_datum    date
);
create unique index if not exists ux_bron_whitelist_domein_match
  on public.bron_whitelist (domein, matchtype, coalesce(pad, ''));
-- RLS: SELECT op status='actief' voor geauthenticeerden; mutatie service-role-only.
alter table public.bron_whitelist enable row level security;
-- Append-only domeinlog (naast platform_event_log): immutable + sha256-hash.
create table if not exists public.bron_whitelist_log (
  id              uuid primary key default uuid_generate_v4(),
  whitelist_id    uuid,                           -- geen FK: log overleeft hard-delete
  domein_snapshot text,
  handeling       text not null,                  -- aanmaken|bijwerken|activeren|deactiveren|verwijderen
  gewijzigd_door  uuid,
  gewijzigd_op    timestamptz not null default now(),
  oud             jsonb,
  nieuw           jsonb,
  reden           text,
  hash            text,
  tijdstip        timestamptz not null default now()
);
-- RLS aan, deny-by-default: geen policy (alleen service-role).
alter table public.bron_whitelist_log enable row level security;

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
                   'bestuursvoorstel','notulen','advies','memo','analyse','rapportage','bijlage','overig')),
  status         text check (status in (
                   'concept','vastgesteld','van_kracht','historisch','gearchiveerd')),
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
  -- T4 Regime-borging (migratie 2026_08_12). Documentfacet: het wettelijk regime
  -- van de bron (compliance-curatie; alleen zinvol voor bibliotheek='generiek').
  -- NULL ≡ 'algemeen' (cross-cutting) → nooit gedemoveerd. Gedenorm. naar
  -- document_chunks via fn_chunk_denorm; voedt de regime-demotie (lib/weeg-regime).
  wettelijk_regime text check (wettelijk_regime is null or wettelijk_regime in
                   ('pw','wvb','beide','algemeen')),
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
  -- Increment T6 — beheerkenmerken generieke contentlaag (§7/B3, besluit 0040).
  -- Migratie 2026_07_09_t6_generiek_beheerkenmerken.sql is authoritatief. Alle
  -- drie additief/nullable, alleen zinvol voor bibliotheek='generiek'. eigenaar =
  -- functioneel/team-label (geen persoonsnaam/FK, PII-minimaal); volgende_review
  -- = datum eerstvolgende review (HANDHAVING geleverd in T10 — zie onder); versie =
  -- leesbaar label naast de self-FK-lineage (vervangt_/vervangen_door, 0022).
  eigenaar        text,
  volgende_review date,
  versie          text,
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
  -- De agendapunt-kolom en bijbehorende context-CHECK worden pas toegevoegd
  -- nadat public.agendapunten bestaat (sectie 9 + migratie 2026_06_18).
  -- Increment T6 (migratie 2026_07_09 authoritatief) — namespace-invariant
  -- (besluit 0045, doorgeschoven naar T6): generiek ⇒ fonds_id NULL, fonds ⇒
  -- fonds_id NOT NULL. Hardt de classificatie waarop de read-only-RLS en de
  -- fondsfilter rusten; verzwakt geen policy.
  constraint documenten_generiek_namespace_check
    check ((bibliotheek = 'generiek' and fonds_id is null)
        or (bibliotheek = 'fonds' and fonds_id is not null))
);

-- ── Increment T10 — review-/publicatieworkflow generieke contentlaag ─────────
-- Migraties 2026_07_10_t10_generiek_transitiepoort.sql (toestandsmachine) en
-- 2026_07_10_t10_retrieval_review_verval.sql (retrieval-gate) zijn authoritatief;
-- besluit decisions/0053. Bouwt de T6-contentlaag uit tot een beheerd redactie-
-- proces. Kern (géén nieuwe kolom — status blijft AFGELEID, besluit 0048):
--   • fn_generiek_geldigheidsstatus(status,bronstatus) — SQL-spiegel van
--     lib/generiek-status.ts (draft/published/deprecated/withdrawn).
--   • fn_generiek_transitie(van,naar) — toegestane canonieke overgangen:
--     draft→published, published→deprecated, published→withdrawn,
--     deprecated→withdrawn, deprecated→published; withdrawn = terminaal.
--   • trg_generiek_status_overgang (BEFORE UPDATE op documenten) — weigert voor
--     bibliotheek='generiek' een ongeldige canonieke overgang (dekt óók de
--     bronstatus-as). fn_document_status_overgang_check() slaat generiek nu over
--     (één autoriteit per bibliotheek; de fonds-lifecycle blijft ongewijzigd).
--   • Review-verval: de retrieval-RPC's (zoek_chunks / zoek_chunks_hybride)
--     filteren generiek published-content met een VERSTREKEN volgende_review
--     (volgende_review < p_peildatum) weg als actuele bron. NULL = niet afgedwongen
--     (backward-compat). Read-time; geen muterende job. Return-kolom volgende_review
--     voedt de app-guard (lib/rag.ts::handhaafFondsdiscipline) als defense-in-depth.
-- Audit: geen nieuwe tabel — elke overgang schrijft append-only naar
-- document_metadata_log (wijzig_type status/bronstatus, reden verplicht). RLS
-- ONGEWIJZIGD (generiek read-only voor fondsen; curatie via de service-role achter
-- withPlatform, capability platform.generic.library.manage).

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
  -- T4 Regime-borging (migratie 2026_08_12) — regime-denorm van documenten.
  -- wettelijk_regime via dezelfde fn_chunk_denorm; voedt de app-side regime-demotie
  -- (lib/weeg-regime). Geen index (niet in de RPC-WHERE gefilterd).
  wettelijk_regime text,
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

-- 2026-08-05 (C1 / PvA vectorless-hybride B-03): indexen op de denorm-filtervelden
-- voor schaalbare gefilterde/vectorless retrieval. Migratie
-- supabase/migrations/2026_08_05_c1_retrieval_denorm_indexen.sql (op productie
-- gedraaid + geverifieerd 2026-08-05). Puur additief, idempotent, geen reindex. Besluit 0127.
create index if not exists idx_chunks_status_geldig on public.document_chunks (documentstatus, bronstatus, geldig_vanaf, geldig_tot);
create index if not exists idx_chunks_procesinstantie on public.document_chunks (procesinstantie_id);
create index if not exists idx_chunks_documentdatum on public.document_chunks (documentdatum);
create index if not exists idx_documenten_fonds_status on public.documenten (fonds_id, status, actief);

-- RAG-retrieval met relevantie-sortering (ts_rank_cd). supabase-js .textSearch()
-- kan niet ORDER BY ts_rank_cd(...), daarom gebeurt het ranken hier in de DB.
-- SECURITY INVOKER: RLS op document_chunks/documenten dwingt tenant-isolatie af.
-- Zie migratie 2026_05_30_rag_ranking.sql.
-- Optionele documentscope (p_document_ids; null = hele bibliotheek), toegepast
-- VÓÓR ranking. Zie migratie 2026_06_10_document_scope.sql. De zustertfunctie
-- public.zoek_chunks_hybride (FTS+vector via RRF) heeft dezelfde scope-param in
-- beide armen — staat niet in dit documentatiebestand, zie die migratie.
-- Besluit 0139 (migratie 2026_08_06_r_retrieval_determinisme_tiebreaker_efsearch.sql,
-- AUTHORITATIEF): zoek_chunks_hybride kreeg een deterministische tiebreaker (, dc.id)
-- op de drie sorteringen; signatuur ongewijzigd. Zorgt dat identieke aanroepen
-- identieke bronnensets geven. (`set hnsw.ef_search = 100` op de functie was beoogd
-- maar wordt door Supabase geweigerd, ERROR 42501 — uitgesteld; ef_search blijft 40.)
--
-- NB (increment T4, migratie 2026_07_08_t4_retrieval_fondsfilter.sql — AUTHORITATIEF;
-- dit documentatieblok loopt op dat punt achter): beide RPC's hebben een extra
-- param `p_fonds_id uuid default null` (expliciete server-side fondsfilter, ADDITIEF
-- náást RLS: `d.fonds_id = p_fonds_id OR bibliotheek='generiek'`), een published-only-
-- gate voor generiek (`documentstatus='van_kracht' AND coalesce(bronstatus,'actief')
-- ='actief'`, modus-onafhankelijk) en een extra return-kolom `fonds_id` (d.fonds_id;
-- NULL = generiek/gedeeld). default null = huidig gedrag. Namespace-conventie =
-- `bibliotheek`; zie decisions/0045.
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

-- ── 5a-bis. Word-export-log (T2/B-4, migratie 2026_08_05_t2_bureau_stukvoorbereiding.sql) ──
-- Aparte, append-only logtabel voor Word-exports uit de bureau-stand. Bewust NIET
-- in governance_log (een export is geen vraag/antwoord-interactie; meeliften zou
-- de interactie- en P5-telemetrie vervuilen). GEEN documenttekst — die staat al in
-- het interactielog. Schrijven kan uitsluitend via de definer-RPC log_word_export()
-- (gebruiker/fonds server-side, rol-backstop bestuursbureau); update/delete zijn
-- door triggers geblokkeerd (append-only). Lezen: eigen fonds + governance_audit_read
-- (mag_audit).
create table if not exists public.governance_export_log (
  id                uuid primary key default uuid_generate_v4(),
  gebruiker_id      uuid references auth.users(id),
  gebruiker_naam    text,
  fonds_id          uuid references public.fondsen(id),
  gesprek_audit_id  uuid,                 -- geen FK (analoog aan governance_log.gesprek_audit_id)
  taak              text not null default 'stukvoorbereiding',
  stuksoort         text,
  promptvariant     text,
  bronnen           jsonb not null default '[]',  -- bronidentiteit, geen documenttekst
  aangemaakt        timestamptz default now()
);

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

-- ── 5b-bis. Reflectieflowstatus (plateau B, migratie 2026_08_05_b1) ─────────
-- Server-controlled status van de reflectiedialoog (besluit 0110). Eén rij per
-- gesprek, AUTEUR-ONLY leesbaar, en muteerbaar UITSLUITEND via de definer-functie
-- public.reflectie_transitie() — de tabel heeft bewust géén insert/update/delete-
-- policy. Waarom een aparte tabel en geen kolom op `gesprekken`: die wordt
-- client-side beschreven met de anon-key en de gebruiker heeft UPDATE-recht op de
-- eigen rij, en RLS werkt op rij- niet op kolomniveau.
--
-- ⚠ Dit is de ENIGE plek waar staat dát er gereflecteerd wordt (besluit 0112).
-- Geen waarde in `governance_log.modus`, geen sleutel in `retrieval_meta`, geen
-- fondsbreed leesbare projectie. `on delete cascade` vanaf `gesprekken` zorgt dat
-- verwijder_gesprek() de status meeneemt (AC-24).
--
-- Migraties authoritatief; hier alleen documentatie.
--   gesprek_reflectie_state(gesprek_id pk → gesprekken on delete cascade,
--                           gebruiker_id, fonds_id, status, ingang, beurt,
--                           bronset_log_id (geen FK), reflectie_bronset_versie,
--                           gestart_op, bijgewerkt_op)
--   reflectie_transitie(uuid, text, text, uuid)  — security definer, de enige schrijfweg
--   reflectie_bronset_hash(jsonb)                — spiegel van core/lib/bronset.ts

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
  aangemaakt      timestamptz default now(),
  -- Wijzig-audit vergaderkop (migratie 2026_07_20_vergadering_wijzigen.sql)
  gewijzigd_op    timestamptz,
  gewijzigd_door  uuid references auth.users(id) on delete set null,
  -- Handmatig archiveren (besluit 0145, migratie 2026_08_07_vergadering_archiveren.sql).
  -- BEWUST GEEN vierde statuswaarde: `status` modelleert de voortgang van de
  -- voorbereiding, archivering de zichtbaarheid in de lijst. Als vierde
  -- statuswaarde zou een afgeronde vergadering bij archivering verliezen dát ze
  -- afgerond was. NULL = staat in de gewone lijst.
  gearchiveerd_op   timestamptz,
  gearchiveerd_door uuid references auth.users(id) on delete set null
);

create index if not exists idx_verg_fonds_datum on public.vergaderingen(fonds_id, datum desc);
-- Partiële index: de gewone lijst vraagt vrijwel altijd om de NIET-gearchiveerde
-- vergaderingen; deze index groeit dus niet mee met het archief.
create index if not exists idx_verg_fonds_actief
  on public.vergaderingen(fonds_id, datum desc)
  where gearchiveerd_op is null;

-- Append-only mutatie-log voor de vergaderkop (titel/locatie/datum).
-- Apart van governance_events (besluit-gericht) en agendapunt_log; RLS
-- select/insert binnen eigen fonds, immutability via fn_log_append_only-
-- triggers. Bron: migratie 2026_07_20_vergadering_wijzigen.sql.
create table if not exists public.vergadering_log (
  id             uuid primary key default uuid_generate_v4(),
  vergadering_id uuid not null references public.vergaderingen(id) on delete cascade,
  -- Besluit 0145 — archiveren krijgt EIGEN eventtypes en lift niet mee op
  -- 'vergadering_gewijzigd'; anders is "de kop is aangepast" in het log niet te
  -- onderscheiden van "de vergadering is uit de lijst gehaald".
  event_type     text not null check (event_type in (
                   'vergadering_gewijzigd',
                   'vergadering_gearchiveerd',
                   'vergadering_gedearchiveerd'
                 )),
  actor_id       uuid not null references auth.users(id) on delete set null,
  payload        jsonb not null default '{}',
  aangemaakt     timestamptz not null default now()
);

create index if not exists idx_vergadering_log_verg
  on public.vergadering_log(vergadering_id, aangemaakt desc);

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
-- T2/B-6 (migratie 2026_08_05_t2_bureau_stukvoorbereiding.sql) — zelfverklaarde
-- markering dat een stuk AI-ondersteund is voorbereid (bureau-stand). Zichtbaar
-- voor het bestuur op de agendapuntkaart.
alter table public.documenten add column if not exists ai_ondersteund_voorbereid boolean not null default false;

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

-- Governance log: alleen eigen fonds (T3: WITH CHECK sluit schrijfkant, append-only via trigger)
create policy "fonds log" on public.governance_log
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

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
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

create policy "fonds agendapunten" on public.agendapunten
  for all
  using (
    vergadering_id in (
      select id from public.vergaderingen where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    vergadering_id in (
      select id from public.vergaderingen where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- 2026-08-05 (T1 bureau-rol, migratie 2026_08_05_bestuursbureau_rol.sql): alle vier
-- de policies dragen de rol-uitsluiting `is distinct from 'bestuursbureau'`. Inbreng
-- is een bestuurlijke uiting; ondersteuning leest die niet mee en plaatst die niet
-- (ontwerp §5.3/§5.4, guardrail G9). NULL-veilig: `is distinct from` i.p.v. `<>`,
-- zodat een profiel met rol IS NULL zich exact gedraagt als vóór de wijziging.
-- De INSERT-tenantgrens (agendapunten -> vergaderingen.fonds_id) komt uit
-- 2026_07_31_r1_rls_tenantgrenzen.sql (bevinding M-01); schema.sql liep daarop achter.
create policy "fonds inbreng lezen" on public.agendapunt_inbreng
  for select using (
    agendapunt_id in (
      select ap.id from public.agendapunten ap
      join public.vergaderingen v on v.id = ap.vergadering_id
      where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

create policy "eigen inbreng schrijven" on public.agendapunt_inbreng
  for insert with check (
    gebruiker_id = auth.uid()
    and agendapunt_id in (
      select ap.id from public.agendapunten ap
      join public.vergaderingen v on v.id = ap.vergadering_id
      where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

create policy "eigen inbreng wijzigen" on public.agendapunt_inbreng
  for update
  using (
    gebruiker_id = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  )
  with check (
    gebruiker_id = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

create policy "eigen inbreng verwijderen" on public.agendapunt_inbreng
  for delete using (
    gebruiker_id = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

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
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds maatregelen" on public.risico_maatregelen;
create policy "fonds maatregelen" on public.risico_maatregelen
  for all
  using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- risico_log: T3 WITH CHECK + append-only via before update/delete-trigger.
drop policy if exists "fonds risico log" on public.risico_log;
create policy "fonds risico log" on public.risico_log
  for all
  using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
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

-- Per-proces bestuurlijke toelichting per fase (WO-2-vervolg, migratie
-- 2026_08_14). Los van de gedeelde D8-fasebeschrijving. Eigen fonds_id →
-- fonds-RLS (Gate B); schrijven voorzitter/beheerder.
create table if not exists public.procedure_fase_toelichting (
  id             uuid primary key default uuid_generate_v4(),
  procedure_id   uuid not null references public.procedures(id) on delete cascade,
  fase_code      text not null,
  toelichting    text,
  fonds_id       uuid not null references public.fondsen(id) on delete cascade,
  aangepast_door uuid references auth.users(id) on delete set null,
  aangepast_op   timestamptz default now(),
  unique (procedure_id, fase_code)
);

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
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds proc eigenaars" on public.procedure_eigenaars;
create policy "fonds proc eigenaars" on public.procedure_eigenaars
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc stappen" on public.procedure_stappen;
create policy "fonds proc stappen" on public.procedure_stappen
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc checklist" on public.procedure_checklist;
create policy "fonds proc checklist" on public.procedure_checklist
  for all
  using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc bewijs" on public.procedure_bewijs;
create policy "fonds proc bewijs" on public.procedure_bewijs
  for all
  using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc besluiten" on public.procedure_besluiten;
create policy "fonds proc besluiten" on public.procedure_besluiten
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- procedure_log: T3 WITH CHECK + append-only via before update/delete-trigger.
drop policy if exists "fonds proc log" on public.procedure_log;
create policy "fonds proc log" on public.procedure_log
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
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
  for update
  using (ontvanger_id = auth.uid())
  with check (ontvanger_id = auth.uid());

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

-- ============================================================
--  Increment T8 — Configuratie-/manifestlaag (2026_07_09)
--  Documentatie; de migratie 2026_07_09_t8_config_manifestlaag.sql is
--  authoritatief. Differentiatie-als-data: een fonds volledig via CONFIGURATIE
--  onderscheidbaar (theming + welke modules actief + feature flags + content-
--  overrides), zonder codewijziging, versiebeheerd en append-only auditbaar.
--  KERNRANDVOORWAARDE (v0.4 §9): het manifest bepaalt BESCHIKBAARHEID, NIET
--  autorisatie — requireCapability()/RLS blijft de securitygrens. Alle tabellen
--  tenant-aware (deny-by-default RLS per fonds_id); lezen = eigen fonds (alle
--  leden), schrijven = eigen fonds + rol voorzitter/beheerder (WITH CHECK),
--  geen DELETE-policy. fonds_id wordt in de app altijd server-side afgeleid.
-- ============================================================

-- Design-tokens per fonds (jsonb, allowlist-gevalideerd; logo als storage-ref,
-- geen binaries). Fail-safe: geen rij = generiek default-thema uit code.
create table if not exists public.fonds_theming (
  fonds_id        uuid primary key references public.fondsen(id) on delete cascade,
  tokens          jsonb not null default '{}'::jsonb,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id)
);

-- Welke modules beschikbaar per fonds. module_key getoetst tegen de code-registry
-- (lib/module-registry.ts); onbekend/uit = niet beschikbaar. Effectieve
-- beschikbaarheid = rij.actief indien aanwezig, anders registry.defaultActief.
create table if not exists public.fonds_module_manifest (
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  module_key      text not null,
  actief          boolean not null default true,
  config          jsonb not null default '{}'::jsonb,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id),
  primary key (fonds_id, module_key)
);

-- Sleutel→waarde feature flags (waarde jsonb). Generalisatie van
-- fonds_instellingen; hybride_zoeken is de eerste gemigreerde flag (backfill
-- 2026_07_09_t8_flags_backfill.sql). Env-default blijft fallback.
create table if not exists public.fonds_feature_flags (
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  flag_key        text not null,
  waarde          jsonb not null,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id),
  primary key (fonds_id, flag_key)
);

-- Minimale per-fonds copy-overrides (sleutel→waarde). Volledige redactie-/
-- publicatieworkflow = T10.
create table if not exists public.fonds_content_overrides (
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  sleutel         text not null,
  waarde          text not null,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id),
  primary key (fonds_id, sleutel)
);

-- APPEND-ONLY audit van elke config-wijziging (wie/wanneer/fonds/config_type/
-- sleutel/oud→nieuw/versie). Hergebruikt fn_log_append_only (geen tweede
-- logmechanisme; decisions/0051). Triggers blokkeren UPDATE/DELETE. Herstel =
-- een eerdere waarde opnieuw wegschrijven als nieuwe versie.
-- AUDIT WORDT ATOMISCH DOOR DE DB GESCHREVEN (migratie t8b, niet door de app):
-- een AFTER-trigger fn_fonds_config_capture op de vier config-tabellen legt de
-- logregel in dezelfde transactie vast (geen stil audit-gat). De UNIQUE-constraint
-- (fonds_id, config_type, config_sleutel, versie) voorkomt dubbele versies bij
-- gelijktijdige schrijvers.
create table if not exists public.fonds_config_log (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  gebruiker_id    uuid references auth.users(id),
  gebruiker_naam  text,
  config_type     text not null check (config_type in ('theming','manifest','flag','override')),
  config_sleutel  text not null,
  oude_waarde     jsonb,
  nieuwe_waarde   jsonb,
  versie          integer not null,
  aangemaakt      timestamptz not null default now(),
  -- t8b: serialiseert gelijktijdige schrijvers; blokkeert dubbele versie per sleutel.
  constraint fonds_config_log_versie_uniek
    unique (fonds_id, config_type, config_sleutel, versie)
);

-- t8b — atomische, onoverslaanbare config-audit via AFTER-trigger op de vier
-- config-tabellen. Bron van waarheid: migratie 2026_07_09_t8b_config_audit_trigger.sql.
-- create or replace function public.fn_fonds_config_capture() ... (dispatch op
-- TG_TABLE_NAME → config_type/sleutel/oud→nieuw) insert into fonds_config_log.
-- after insert or update on {fonds_theming, fonds_module_manifest,
--   fonds_feature_flags, fonds_content_overrides} execute fn_fonds_config_capture().

-- ============================================================
--  Increment T11 — Data-laag stuurinformatie + klantbeeld (2026_07_10)
--  Tenant-veilige AGGREGAAT-data (GEEN deelnemer-PII). Deny-by-default RLS per
--  fonds_id: lezen = eigen fonds (alle leden); schrijven = eigen fonds +
--  voorzitter/beheerder (WITH CHECK); GEEN delete-policy. populatie_n/aantal =
--  celgrootte voor kleine-populatie-suppressie (n<10, app-leeslaag). Presentatie/
--  content per fonds staat in fonds_module_manifest.config (jsonb). Bron van
--  waarheid: migraties 2026_07_10_t11_stuurinfo_klantbeeld_data.sql (+ seed).
--  Zie decisions/0054 (bronkeuze) + decisions/0055 (suppressiedrempel).
--
--  Increment T13 (2026_07_16) — periodemodel + reserves (Balans-tab, AZL-lijn):
--  nieuwe registry fonds_stuurinfo_periode + reserve-tabel fonds_stuurinfo_reserve;
--  kpi/reeks kregen een verplichte periode-kolom in de PK + samengestelde FK naar
--  de registry. Bron van waarheid: 2026_07_16_t13_stuurinfo_periode_reserve.sql
--  (+ seed 2026_07_16_t13b). Zie decisions/0074.
-- ============================================================

-- Periode-registry: welke rapportageperiodes bestaan per fonds ('2026Q2').
-- Bron van waarheid voor de paginabrede periodefilter; de invoerlaag
-- (vervolgticket) bouwt hierop voort (periode + peildatum + bron per periode).
create table if not exists public.fonds_stuurinfo_periode (
  fonds_id    uuid not null references public.fondsen(id) on delete cascade,
  periode     text not null check (periode ~ '^\d{4}Q[1-4]$'),  -- '2026Q2'
  peildatum   date not null,
  bron        text not null default 'seed_synthetisch',
  volgorde    integer not null default 0,  -- T14: deterministisch jaar*4+kwartaal
  invoer_bron text,                        -- T14: 'handmatig'|'upload'|null (seed)
  bijgewerkt  timestamptz not null default now(),
  primary key (fonds_id, periode)
);

create table if not exists public.fonds_stuurinfo_kpi (
  fonds_id     uuid not null references public.fondsen(id) on delete cascade,
  periode      text not null,           -- T13: rapportageperiode ('2026Q1')
  kpi_key      text not null,
  label        text not null,
  waarde       numeric,
  delta        numeric,
  eenheid      text not null default 'getal',
  toelichting  text,
  volgorde     integer not null default 0,
  populatie_n  integer,                 -- celgrootte-drager (suppressie n<10)
  invoer_bron  text,                    -- T14: 'handmatig'|'upload'|null (seed)
  bijgewerkt   timestamptz not null default now(),
  primary key (fonds_id, periode, kpi_key),
  foreign key (fonds_id, periode)
    references public.fonds_stuurinfo_periode(fonds_id, periode) on delete cascade
);

create table if not exists public.fonds_stuurinfo_reeks (
  fonds_id     uuid not null references public.fondsen(id) on delete cascade,
  periode      text not null,           -- T13: rapportageperiode ('2026Q1')
  reeks_key    text not null,           -- trend_fg / balans_activa / balans_passiva / deelnemer_status / ...
  punt_key     text not null,
  label        text,
  volgorde     integer not null default 0,
  waarde       numeric,
  delta        numeric,
  kleur        text,
  populatie_n  integer,                 -- celgrootte-drager (suppressie n<10)
  invoer_bron  text,                    -- T14: 'handmatig'|'upload'|null (seed)
  bijgewerkt   timestamptz not null default now(),
  primary key (fonds_id, periode, reeks_key, punt_key),
  foreign key (fonds_id, periode)
    references public.fonds_stuurinfo_periode(fonds_id, periode) on delete cascade
);
-- Balans-taxonomie (T13, AZL-lijn): balans_activa {belegd, overig};
-- balans_passiva {ev_toets_mvev, ev_toets_oper, ev_toets_overig, ev_soli,
-- ev_comp, tv, vuk, overig}. Subtotalen (toetsvermogen, eigen vermogen,
-- totalen) + balansevenwicht worden in de app-leeslaag AFGELEID.

-- Reservestanden per periode met optionele ABTN-band (grenzen in dezelfde
-- eenheid als pct_waarde). Stoplichtstatus is AFGELEID in de leeslaag:
-- binnen band = ok, onder = rood, boven = oranje, geen band = monitoring —
-- bewust geen status-kolom (decisions/0074).
create table if not exists public.fonds_stuurinfo_reserve (
  fonds_id    uuid not null references public.fondsen(id) on delete cascade,
  periode     text not null,
  reserve_key text not null,            -- solidariteitsreserve / mvev_reserve / ...
  label       text not null,
  stand       numeric not null,         -- € mln
  pct_basis   text,                     -- noemer van pct_waarde ('technische_voorziening')
  pct_waarde  numeric,
  ondergrens  numeric,                  -- NULL = geen formele band → monitoring
  bovengrens  numeric,
  volgorde    integer not null default 0,
  invoer_bron text,                     -- T14: 'handmatig'|'upload'|null (seed)
  bijgewerkt  timestamptz not null default now(),
  primary key (fonds_id, periode, reserve_key),
  foreign key (fonds_id, periode)
    references public.fonds_stuurinfo_periode(fonds_id, periode) on delete cascade
);

create table if not exists public.fonds_klantbeeld_cohort (
  fonds_id          uuid not null references public.fondsen(id) on delete cascade,
  leeftijd          integer not null check (leeftijd between 0 and 120),
  aantal            integer not null default 0,   -- populatie_n (suppressie n<10)
  actief_p          numeric not null default 0,
  slapend_p         numeric not null default 0,
  uitkerend_p       numeric not null default 0,
  salaris           numeric not null default 0,
  maand_premie      numeric not null default 0,
  maand_uitkering   numeric not null default 0,
  invaar_kapitaal   numeric not null default 0,
  doel_op67         numeric not null default 0,
  over_weight       numeric not null default 0,
  bescherm_weight   numeric not null default 0,
  duration_jr       numeric not null default 0,
  uitvoering_mult   numeric not null default 1,
  bijgewerkt        timestamptz not null default now(),
  primary key (fonds_id, leeftijd)
  -- BEWUST GEEN individu-identificator (geen deelnemer-id/naam/bsn/geboortedatum):
  -- dit is de cohort-samenvatting, geen deelnemerslijst.
);
-- RLS (per tabel, identiek T8-patroon): select = eigen fonds; insert/update =
-- eigen fonds + rol voorzitter/beheerder (WITH CHECK); geen delete-policy.

-- ============================================================
--  Increment T14 (2026_07_17) — beheer-invoerlaag stuurinformatie (audit + RPC)
--  Bron van waarheid: 2026_07_17_t14_stuurinfo_invoer_audit.sql +
--  2026_07_17_t14b_stuurinfo_audit_hardening.sql (reviewfixes: capture =
--  VOLLEDIGE rij to_jsonb(new/old) minus 'bijgewerkt'; log-INSERT-policy met
--  actor-check gebruiker_id = auth.uid(); RPC met waarde-typechecks,
--  bron-allowlist en vaste reserve-labels; revoke execute from PUBLIC).
--  Zie decisions/0075.
--  * invoer_bron text-kolom (nullable; CHECK null|'handmatig'|'upload') op
--    fonds_stuurinfo_periode/kpi/reeks/reserve — bron-marker die het schrijfpad
--    meestuurt en de audittrigger naar het log kopieert (seed = null).
--  * fonds_stuurinfo_periode.volgorde is DETERMINISTISCH: jaar*4 + kwartaal
--    (2026Q2 → 8106), zodat historische periodes altijd goed sorteren.
--  * RPC stuurinfo_balans_opslaan(p_periode, p_peildatum, p_bron, p_invoer_bron,
--    p_activa jsonb, p_passiva jsonb, p_reserves jsonb, p_financieringsgraad)
--    — SECURITY INVOKER (RLS geldt onverkort; fonds_id uit auth.uid(), geen
--    parameter): registry + 10 balans-leaves + 8 reserves + FG-KPI in één
--    transactie. Defense-in-depth in de functie: key-allowlists, balans-
--    evenwicht (tolerantie 0.005, 'BALANS_SLUIT_NIET'), gekoppelde-standen-
--    check ('GEKOPPELDE_STAND_ONGELIJK').
-- ============================================================

-- Append-only auditspoor van stuurinformatie-invoer/upload (T14). Gevuld door
-- AFTER-trigger fn_fonds_stuurinfo_capture op de vier fonds_stuurinfo_*-data-
-- tabellen (T8b-patroon: atomisch, niet overslaanbaar; no-op-updates loggen
-- niet). Nooit UPDATE/DELETE (fn_log_append_only-triggers). RLS: lezen = eigen
-- fonds; insert = eigen fonds + voorzitter/beheerder (WITH CHECK).
create table if not exists public.fonds_stuurinfo_log (
  id             uuid primary key default gen_random_uuid(),
  fonds_id       uuid not null references public.fondsen(id) on delete cascade,
  periode        text not null,
  tabel          text not null check (tabel in ('periode','kpi','reeks','reserve')),
  veld_key       text not null,          -- bv. 'balans_passiva.ev_soli', 'solidariteitsreserve'
  oude_waarde    jsonb,                  -- null bij INSERT (nieuwe rij)
  nieuwe_waarde  jsonb not null,
  invoer_bron    text,                   -- 'handmatig'|'upload'|null (seed/migratie)
  gebruiker_id   uuid,                   -- auth.uid(); null bij owner-/seed-writes
  gebruiker_naam text,                   -- naam-snapshot (T8b-patroon)
  aangemaakt     timestamptz not null default now()
);

-- ============================================================
--  Increment T15 (2026_07_17) — tabs 4 (Spreiding) + 5 (Solidariteit)
--  Bron van waarheid: 2026_07_17_t15_stuurinfo_spreiding_soli.sql (RPC) +
--  2026_07_17_t15b_stuurinfo_spreiding_soli_seed.sql (seed). Zie decisions/0076.
--  GEEN nieuwe tabellen — nieuwe keys in de bestaande T13-structuur:
--  * kpi_keys (per fonds/periode): uitkeringsfase_beschikbaar,
--    uitkeringsfase_voorziening, uitkeringsfase_aanpassingsfactor (INVOER van
--    de actuaris, nooit berekend), uitkeringsfase_band_onder/_boven,
--    soli_uitdeling. Spreidingsvermogen, financieringsgraad uitkeringsfase,
--    netto vulling, begin-/eindstand worden in de LEESLAAG afgeleid (geen
--    opgeslagen duplicaat).
--  * reeks_keys: uitkeringsfase_fg_maand (12 maandpunten per periode,
--    punt_key '00'..'11', maandlabel in label; seed-only — handinvoer via het
--    latere Excel-uploadticket) en soli_vulling (punt_keys premie|rendement|
--    micro_langleven|overrendementsbijdrage, ± in € mln). micro_langleven =
--    het biometrische resultaat van tab 3 (later ticket) — ÉÉN bron.
--  * De bandbreedte van de solidariteitsreserve blijft UITSLUITEND op de
--    soli-rij in fonds_stuurinfo_reserve (ondergrens/bovengrens) — dezelfde
--    bron als het tab 1-stoplicht (bewust géén soli_band_*-kpi's).
--  * RPC stuurinfo_soli_opslaan(p_periode, p_invoer_bron, p_vulling jsonb,
--    p_uitdeling, p_ondergrens, p_bovengrens) — SECURITY INVOKER (RLS geldt;
--    fonds_id uit auth.uid(), geen parameter): 4 vullingsbronnen + uitdeling-
--    KPI + grenzen-update op de soli-reserve-rij in één transactie.
--    Defense-in-depth: key-allowlist ('ONGELDIGE_VULLING'), typechecks
--    ('ONGELDIGE_WAARDE'), grenzenorde ('ONGELDIGE_GRENZEN'), soli-rij moet
--    bestaan ('SOLI_RESERVE_ONTBREEKT' — stand komt uit de balans-save) en
--    HARDE eindstand-consistentie: vorige stand + netto − uitdeling = huidige
--    stand, tolerantie 0.005 ('SOLI_EINDSTAND_ONGELIJK').
--    De Spreiding-save loopt zonder RPC (één batch-upsert op één tabel).
--  Auditlog: de bestaande T14-capture-triggers dekken alle writes (kpi/reeks/
--  reserve) — geen triggerwijziging.
-- ============================================================

-- ============================================================
--  Increment T16 (2026_07_18) — tabs 6 (Operationeel) + 7 (Premie & compensatie)
--  Bron van waarheid: 2026_07_18_t16_stuurinfo_oper_premie.sql (RPC's) +
--  2026_07_18_t16b_stuurinfo_oper_premie_seed.sql (seed + depot-correctie).
--  Zie decisions/0077. GEEN nieuwe tabellen — nieuwe keys in de T13-structuur:
--  * reeks_keys tab 6: oper_mutatie (punt_keys premie_kostenopslag|
--    beschermingsrendement|overrendement|gemist_rendement_twk|twk_invaar|
--    verrekening_reserves|overig|kosten, ± in € mln — kosten = geaggregeerde
--    post −) en oper_kosten_realisatie/oper_kosten_begroot (punt_keys
--    uitvoeringskosten|vermogensbeheer|bestuur_overig, YTD, aangeleverd).
--  * kpi_keys tab 6: oper_norm, oper_band_onder, oper_band_boven — in € MLN
--    (bewust GEEN band op de reserve-rij: die is in % van de TV en zou het
--    tab 1-stoplicht wijzigen; operationele_reserve blijft daar "monitoring").
--  * reeks_keys tab 7: premie_component (€) + premie_component_pct (% van de
--    premiegrondslag) — zelfde punt_keys (spaarpremie|risico_ppwzp|risico_aop|
--    risico_pvi|opslag_uitvoeringskosten|opslag_toekomstige_kosten), beide
--    AANGELEVERD; comp_mutatie (punt_keys premie|beschermingsrendement|
--    overrendement|onttrekkingen|verrekening_reserves|overig, ±);
--    comp_uitputting_prognose (punt_key = jaartal, ALM-reeks, seed/upload-only).
--  * kpi_keys tab 7: comp_toekenning_jaar, comp_startomvang, comp_ondergrens_pct.
--  * Totaal mutatie, primo, ultimo en totaal premie worden in de LEESLAAG
--    afgeleid (stuurinfo-ontwikkeling.ts — geen opgeslagen duplicaat). De
--    ULTIMO = de reservestand uit de balans: operationele_reserve
--    (= ev_toets_oper) resp. compensatiedepot (= ev_comp) — ÉÉN bron.
--  * RPC's stuurinfo_operationeel_opslaan(p_periode, p_invoer_bron, p_mutaties
--    jsonb, p_norm, p_band_onder, p_band_boven, p_kosten_realisatie jsonb,
--    p_kosten_begroot jsonb) en stuurinfo_premie_opslaan(p_periode,
--    p_invoer_bron, p_componenten_eur jsonb, p_componenten_pct jsonb,
--    p_comp_mutaties jsonb, p_toekenning, p_startomvang, p_ondergrens_pct) —
--    SECURITY INVOKER (RLS geldt; fonds_id uit auth.uid(), geen parameter).
--    Defense-in-depth: key-allowlists ('ONGELDIGE_MUTATIES'/'ONGELDIGE_KOSTEN'/
--    'ONGELDIGE_COMPONENTEN'), typechecks ('ONGELDIGE_WAARDE'), grenzenorde
--    ('ONGELDIGE_GRENZEN'), reserve-rij moet bestaan ('OPER_/COMP_RESERVE_
--    ONTBREEKT') en HARDE mutatie-consistentie: vorige stand + som(mutaties)
--    = huidige stand, tolerantie 0.005 ('OPER_/COMP_MUTATIE_ONGELIJK').
--  * Seed-correctie (besluit Merlin): compensatiedepot 2026Q1 40 → 42,4
--    (horizon) en 17 → 18,6 (meridiaan), gecompenseerd in balans_passiva
--    'overig' zodat de balans blijft sluiten — het depot is uitputtend.
--  Auditlog: de bestaande T14-capture-triggers dekken alle writes — geen
--  triggerwijziging.
-- ============================================================

-- ============================================================
--  Increment T17 (2026_07_19) — tab 3 (Biometrische rendementen)
--  Bron van waarheid: 2026_07_19_t17_stuurinfo_biometrie.sql (RPC-replaces) +
--  2026_07_19_t17b_stuurinfo_biometrie_seed.sql (seed + herijking + opschoning).
--  Zie decisions/0078. GEEN nieuwe tabellen én GEEN nieuwe RPC — nieuwe keys
--  in de T13-structuur; de biometrie-save is een app-side batch-upsert op
--  alleen fonds_stuurinfo_reeks (spreiding-precedent):
--  * reeks_keys tab 3: langleven (punt_keys micro|macro|vrijval, ± in € mln;
--    vrijval >= 0 = opbrengst) en risicodekking (punt_keys ppwzp_toegekend|
--    aopvi_toegekend, <= 0 = last).
--  * AFGELEID in de leeslaag (stuurinfo-biometrie.ts — nooit opgeslagen):
--    netto langleven = micro + macro + vrijval; resultaat PP/WZP =
--    premie_component.risico_ppwzp + ppwzp_toegekend; resultaat AO/PVI =
--    premie_component.risico_aop + .risico_pvi + aopvi_toegekend. De
--    binnengekomen risicopremies zijn de BESTAANDE premie_component-rijen
--    (tab 7) — read-only referentie, geen tweede opslag.
--  * ÉÉN-BRON-KOPPELINGEN (vervangt de T15-formulering "micro_langleven =
--    het biometrische resultaat"): de langleven-post in de soli-ontwikkeling
--    (tab 5) is het AFGELEIDE netto langleven-resultaat — het opgeslagen punt
--    soli_vulling.micro_langleven is VERVALLEN (t17b-opschoning). De
--    resultaten PP/WZP en AO/PVI zijn afgeleide mutatieregels in de
--    oper-ontwikkeling (tab 6).
--  * RPC-wijzigingen (signaturen ongewijzigd, SECURITY INVOKER blijft):
--    stuurinfo_soli_opslaan — p_vulling exact 3 keys (premie|rendement|
--    overrendementsbijdrage); netto langleven leest de functie uit de
--    langleven-reeks ('SOLI_LANGLEVEN_ONTBREEKT' bij onvolledige reeks);
--    eindstand-check: vorige + som(3) + langleven − uitdeling = stand.
--    stuurinfo_operationeel_opslaan — mutatie-check telt de afgeleide
--    resultaten mee: vorige + som(8) + r_ppwzp + r_aopvi = stand
--    ('OPER_PREMIE_ONTBREEKT'/'OPER_BIOMETRIE_ONTBREEKT' bij ontbrekende
--    bron terwijl de check draait).
--  Auditlog: de bestaande T14-capture-triggers dekken alle writes — geen
--  triggerwijziging.
-- ============================================================

-- ── 14. AI Output Quality & Governance Lab (AQLab, aqlab_*) ──────────────────
-- Werkticket AQL-1 (2026-07-10). AUTHORITATIEF = de migraties:
--   supabase/migrations/2026_07_10_aqlab_1_register.sql   (register)
--   supabase/migrations/2026_07_10_aqlab_2_runs.sql       (runs/outputs/scores)
--   supabase/migrations/2026_07_10_aqlab_3_governance.sql (release/audit/log)
-- Deze sectie is documentatie (mag achterlopen). Alle aqlab_-tabellen zijn in de
-- MVP PROVIDER-GLOBAAL en SYNTHETISCH — geen fonds_id. Autorisatie loopt
-- server-side via de platform-service-role-wrapper (decision 0058), niet via
-- tabel-policies: RLS staat AAN met DENY-BY-DEFAULT (bewust geen permissive
-- policies), analoog aan platform_* (2026_06_23).
--
-- Register (aqlab_1):
--   aqlab_ai_features            — register te toetsen AI-features
--   aqlab_test_sets              — golden set per feature (4 sets in de seed)
--   aqlab_fixture_documents      — synthetisch bronregister; synthetic=true CHECK
--   aqlab_test_cases             — reproduceerbaar testgeval + consistency_*
--   aqlab_test_case_fixtures     — n-n testcase↔fixture (required/excluded)
--   aqlab_prompt_versions        — versiebeheer prompts
--   aqlab_model_configurations   — benoemde modelinstelling (gevraagd vs effectief)
--                                   + config_hash (uniek, AQL-5): dedup-op-hash bij
--                                     append-only pinnen van challenger-varianten
-- Runs (aqlab_2):
--   aqlab_runs                   — uitvoering + aggregatie (consistency-JSON gereserveerd, ADR 0056)
--                                   + naam (AQL-5): benoembare/terugvindbare run
--   aqlab_run_outputs            — resultaat per iteratie + snapshot-refs (refs_only) + effectieve instellingen
--                                   + model_provider (AQL-6): bevroren generatie-provider per iteratie
--                                     (anthropic=baseline; openai/mistral=challenger). Zie 2026_07_12_aqlab_7_*.sql.
--                                   + reasoning_effort_effective (AQL-6): bevroren reasoning-effort bij
--                                     reasoning-modellen (o-serie/GPT-5). Zie 2026_07_12_aqlab_8_*.sql
--                                     (+ aqlab_model_configurations.reasoning_effort_requested).
--   aqlab_scores                 — score per output×criterium (criterium_code → lib/aqlab/criteria.ts)
--   aqlab_findings               — bevindingen per score
--   aqlab_human_reviews          — menselijke aftekening (MVP light)
-- Governance (aqlab_3), APPEND-ONLY (fn_log_append_only-triggers):
--   aqlab_release_decisions      — bron van waarheid vrijgave; kritieke bevinding blokkeert (CHECK)
--   aqlab_audit_exports          — bevroren auditdossier (inhoud_hash)
--   aqlab_log                    — append-only auditspoor van Lab-acties
--
-- Console-UX (aqlab_6, AQL-5): aqlab_runs.naam + aqlab_model_configurations.config_hash
--   (uniek). Zie 2026_07_11_aqlab_6_console_ux.sql.
--
-- Scorecriteria (14) en consistency-config zijn CODE-SEED (geen tabel in de MVP):
--   lib/aqlab/criteria.ts, lib/aqlab/consistency.ts.
-- Modelconfiguraties (allowlist) zijn CODE-SEED (AQL-5): lib/aqlab/modellen.ts →
--   npm run aqlab:seed:modellen (idempotent, dedup-op-hash).
-- Seeden gebeurt via de gate-bewaakte loader (lib/aqlab/seed/*, dry-run default);
-- seeden is GEBLOKKEERD tot de vier seeding-gate-poorten sluiten (validatierapport §6).

-- ============================================================================
-- D1 — SECURITY DEFINER-RPC's voor de gedeelde surface (werkopdracht C1).
-- Migratie: 2026_07_12_d1_service_role_rpcs.sql (AUTORITATIEF). Documentatie:
--   * resolve_tenant_host(p_host text) -> table(host, fonds_id, actief)
--       host->fonds-resolutie met de ANON-key (0/1 actieve rij). Vervangt het
--       service-role full-list-read in core/lib/tenant-domains.ts. tenant_domains
--       blijft deny-by-default.
--   * contact_aanvraag_insert(p_naam,...,p_ip_hash) -> table(id, aangemaakt_op, status)
--       publieke contactinsert MÉT ingebouwde rate-limit (max 3/10 min per
--       ip_hash; status ok|rate_limited). Vervangt de service-role insert+COUNT
--       in app/api/contact/route.ts. contact_aanvragen blijft deny-by-default.
--   * contact_notificatie_status(p_id, p_verzonden, p_error) -> void
--       markeert notificatie_verzonden/mail_error na de (soft-fail) mailstap.
-- Alle drie: SECURITY DEFINER, set search_path = public, pg_temp; EXECUTE aan
-- anon+authenticated; GEEN tabelpolicy toegevoegd (RLS ongewijzigd). Doel: de
-- gedeelde (app/publiek) surface heeft de service-role niet meer nodig, zodat de
-- sleutel in Fase B uitsluitend in het beheer-project leeft (criterium 2).
-- Resttaak D1b: de tenant-facing aqlab-assurance-routes (app/api/aqlab/assurance*)
-- gebruiken de service-role nog — apart deelincrement, zelfde RPC-aanpak.

-- ============================================================================
-- P5/P4-light — monitoringbasis beheer-surface (2026-08-03).
-- Bron van waarheid: supabase/migrations/2026_08_03_p5_monitoring.sql.
-- Sluit de openstaande helft van decisions/0005 (rate limiting werd in 2026-06
-- gebouwd, error-logging niet). Drie nieuwe tabellen, alle drie RLS aan +
-- BEWUST GEEN POLICY + expliciete revoke (patroon rate_limit_events).
--
-- app_errors is NIET append-only en bewust GEEN auditspoor: het is een
-- operationele logtabel met een bewaartermijn van 90 dagen (besluit 0104), die
-- door de snapshot-cron wordt opgeschoond. Een append-only-trigger zou die
-- opschoning onmogelijk maken. De naam draagt daarom geen `_log`-suffix.
-- ============================================================================

create table if not exists public.app_errors (
  id               uuid primary key default gen_random_uuid(),
  tijdstip         timestamptz not null default now(),
  fonds_id         uuid references public.fondsen(id) on delete set null,
  label            text not null,
  categorie        text not null check (categorie in (
                     'auth_sessie','autorisatie','validatie','upload_bestandsveiligheid',
                     'extractie_ocr','embedding_indexering','retrieval_ai','rate_limiting',
                     'database_integriteit','externe_afhankelijkheid')),
  severity         text not null check (severity in ('laag','middel','hoog','kritiek')),
  http_status      integer,
  fouttype         text,
  foutcode         text,
  melding_kort     text check (melding_kort is null or char_length(melding_kort) <= 200),
  context_sleutels text[],   -- alleen SLEUTELS, nooit waarden
  correlatie_id    uuid,     -- → platform_event_log.correlatie_id (geen FK: daar
                             --   is correlatie_id niet uniek, de index is op
                             --   (correlatie_id, fase))
  -- Herkomst: 'rpc' = door een ingelogde gebruiker aangeleverd (beïnvloedbaar),
  -- 'service' = server-side geschreven. Zonder dit onderscheid kan een operator
  -- een gefabriceerde regel niet van een echte onderscheiden.
  bron             text not null default 'rpc' check (bron in ('rpc','service'))
);

create index if not exists idx_app_errors_tijd      on public.app_errors (tijdstip desc);
create index if not exists idx_app_errors_categorie on public.app_errors (categorie, tijdstip desc);
create index if not exists idx_app_errors_fonds     on public.app_errors (fonds_id, tijdstip desc);

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;

create table if not exists public.platform_signal_snapshots (
  id             uuid primary key default gen_random_uuid(),
  tijdstip       timestamptz not null default now(),
  signaal        text not null,
  fonds_id       uuid references public.fondsen(id) on delete set null,  -- null = platformbreed
  waarde         numeric,
  n              integer,
  status         text not null check (status in ('groen','oranje','rood','onbekend')),
  drempel_oranje numeric,   -- meegestempeld op meetmoment
  drempel_rood   numeric,
  meta           jsonb      -- uitsluitend aggregaten
);

create index if not exists idx_pss_signaal_fonds_tijd
  on public.platform_signal_snapshots (signaal, fonds_id, tijdstip desc);
create index if not exists idx_pss_signaal_tijd
  on public.platform_signal_snapshots (signaal, tijdstip desc);
-- Puur op tijdstip: de retentie-DELETE (elke 5 min), het ophalen van de nieuwste
-- meting per signaal en het trendvenster van het dashboard filteren of sorteren
-- alleen op deze kolom. De twee indexen hierboven beginnen op `signaal` en helpen
-- daar niet; zonder deze index zijn dat drie seq scans per cyclus.
create index if not exists idx_pss_tijd
  on public.platform_signal_snapshots (tijdstip desc);
-- Idem voor de retentie-DELETE op app_errors (idx_app_errors_tijd dekt dat al).

alter table public.platform_signal_snapshots enable row level security;
revoke all on public.platform_signal_snapshots from anon, authenticated;

-- Drempels ALS DATA (besluit 0105) — de haak waar de latere alerting-tranche op
-- landt. Platformbreed, dus geen fonds_id; geregistreerd in de globaal-array van
-- supabase/checks/2026_07_31_r1_structurele_gates.sql (gate A1).
create table if not exists public.platform_signaal_config (
  signaal          text primary key,
  label            text not null,
  eenheid          text not null check (eenheid in
                     ('percentage','aantal','milliseconden','trend_percentage')),
  interval_minuten integer not null check (interval_minuten > 0),
  venster_minuten  integer not null check (venster_minuten >= 0),  -- 0 = momentopname
  drempel_oranje   numeric,
  drempel_rood     numeric,
  richting         text not null check (richting in ('hoger_is_slechter','lager_is_slechter')),
  n_drempel        integer,   -- null = geen n-drempel; anders suppressie (besluit 0055)
  actief           boolean not null default true,
  toelichting      text,
  bijgewerkt       timestamptz not null default now(),
  -- Besluit 0055 is geen instelling: de drie gebruikssignalen houden minimaal
  -- n>=10. De code kent dezelfde vloer in combineerConfig().
  constraint chk_signaal_n_drempel check (
    signaal not in ('ai_latency_p95', 'lege_antwoord_ratio', 'tokenverbruik')
    or (n_drempel is not null and n_drempel >= 10)
  )
);

alter table public.platform_signaal_config enable row level security;
revoke all on public.platform_signaal_config from anon, authenticated;

-- Enige schrijfpad naar app_errors vanaf de gedeelde (tenant/publieke) surface,
-- die sinds variant C (besluit 0066) geen service-role meer heeft. Volgt het
-- D1-patroon (besluit 0065). fonds_id wordt SERVER-SIDE uit auth.uid() afgeleid
-- en is bewust geen parameter. NIET aan anon gegeven (gate H, en geen
-- internet-facing schrijfpad naar een platformtabel).
create or replace function public.fn_app_error_log(
  p_label            text,
  p_categorie        text,
  p_severity         text,
  p_http_status      integer default null,
  p_fouttype         text    default null,
  p_foutcode         text    default null,
  p_melding_kort     text    default null,
  p_context_sleutels text[]  default null,
  p_correlatie_id    uuid    default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fonds_id uuid;
  v_limiet   jsonb;
begin
  -- Volumeklep: deze functie is via PostgREST rechtstreeks aanroepbaar door elke
  -- ingelogde gebruiker. Zonder rem kan iemand signaal 5 vervuilen — en een
  -- detectie-control die de gecontroleerde zelf kan vullen is geen control.
  begin
    v_limiet := public.fn_rate_limit_check('app_error_log', 120, interval '1 minute');
    if v_limiet is not null and (v_limiet->>'toegestaan')::boolean is false then
      return;
    end if;
  exception when others then null;
  end;

  select p.fonds_id into v_fonds_id
    from public.profielen p
   where p.id = auth.uid();

  insert into public.app_errors (
    fonds_id, label, categorie, severity, http_status,
    fouttype, foutcode, melding_kort, context_sleutels, correlatie_id, bron
  ) values (
    v_fonds_id, left(p_label, 120), p_categorie, p_severity, p_http_status,
    left(p_fouttype, 80), left(p_foutcode, 40), left(p_melding_kort, 200),
    -- [1:20] begrenst het aantal, left() per element de lengte.
    (select array_agg(left(x, 60)) from unnest(p_context_sleutels[1:20]) as x),
    p_correlatie_id, 'rpc'
  );
end;
$$;

revoke all on function public.fn_app_error_log(text, text, text, integer, text, text, text, text[], uuid)
  from public, anon;
grant execute on function public.fn_app_error_log(text, text, text, integer, text, text, text, text[], uuid)
  to authenticated, service_role;

-- Expliciete grants aan service_role: leunen op de Supabase-default-ACL is
-- riskant zolang R6 die aan het inperken is, en een strakkere ACL zou de
-- monitoring STIL laten falen (de leesfouten worden bewust geslikt).
grant select, insert, delete on public.app_errors                to service_role;
grant select, insert, delete on public.platform_signal_snapshots to service_role;
grant select                 on public.platform_signaal_config   to service_role;

-- De seed van platform_signaal_config (acht signalen met hun FO §19-drempels)
-- staat in de migratie; hier bewust niet herhaald omdat drempels na oplevering
-- in de SQL-editor mogen worden bijgesteld en schema.sql geen seedbron is.

-- ============================================================
--  T6 — Auditdossier-afschriften (procedure_afschriften)
-- ============================================================
-- Permanent vastgelegde, gezipte auditbundels per proces (besluit 0146). Eigen
-- tabel + eigen private bucket, BEWUST buiten `documenten` zodat een auditzip met
-- stemgedrag/dissent nooit de RAG-index in lekt (besluit 0147).
--
-- Documentatie — AUTHORITATIEF zijn de migraties:
--   2026_08_09_procedure_afschriften.sql          (tabel + RLS + claim-RPC + bucket)
--   2026_08_09_procedure_afschriften_hardening.sql (grants + kolom-freeze-trigger)
--   2026_08_09_afschrift_ai_tekst.sql             (fase 2: ai_leeswijzer_tekst)
-- RLS: deny-by-default per fonds_id (gespiegelde WITH CHECK). SELECT toont ook de
-- bureau-rol; INSERT/UPDATE + storage-lezen sluiten 'bestuursbureau' uit. GEEN
-- delete-policy (+ no-delete-trigger). Kolom-freeze: user-sessies mogen na INSERT
-- alleen ingetrokken_* wijzigen; de service-role-worker (auth.uid() IS NULL) bouwt.
create table if not exists public.procedure_afschriften (
  id                      uuid primary key default gen_random_uuid(),
  procedure_id            uuid not null references public.procedures(id) on delete cascade,
  fonds_id                uuid not null references public.fondsen(id) on delete cascade,
  versie                  text not null check (versie in ('actueel','besluitmoment')),
  trigger_status          text,
  aanleiding              text,
  status                  text not null default 'bezig' check (status in ('bezig','gereed','mislukt')),
  poging                  integer not null default 0,      -- jobmodel: crash-reclaim-teller
  lease_tot               timestamptz,                     -- claim-lease + crash-recovery-klok
  laatste_fout            text,
  opslag_pad              text,                            -- <fonds_id>/<procedure_id>/<afschrift_id>.zip
  sha256                  text,
  bytes                   bigint,
  bestandsaantal          integer,
  bevat_stemgedrag        boolean not null default false,
  gebouwd_onder_rol       text,                            -- gezichtshoek (ADR-5/0149)
  uitgesloten_items       jsonb not null default '[]'::jsonb,
  waarschuwingen          jsonb not null default '[]'::jsonb,
  dossier_stand_event_id  uuid,                            -- verouderingsanker (provenance)
  dossier_stand_op        timestamptz,                     -- verouderingsanker (tijdstip)
  ai_leeswijzer           boolean not null default false,  -- fase 2
  ai_leeswijzer_tekst     jsonb,                           -- fase 2: vastgestelde §2–4
  ai_model                text,
  ai_promptversie         text,
  ai_tekst_hash           text,
  ai_vastgesteld_door     uuid references auth.users(id) on delete set null,
  ai_vastgesteld_op       timestamptz,
  ingetrokken_op          timestamptz,
  ingetrokken_door        uuid references auth.users(id) on delete set null,
  ingetrokken_reden       text,
  aangemaakt_op           timestamptz not null default now(),
  aangemaakt_door         uuid references auth.users(id) on delete set null,
  -- Reviewstap-borging (fase 2): 'gereed' vereist een vaststelling bij AI-tekst.
  constraint afschrift_gereed_vereist_vaststelling check (
    status <> 'gereed' or ai_leeswijzer = false or ai_vastgesteld_door is not null
  )
);
-- Private bucket 'afschriften' (public=false, file_size_limit 150 MB) + storage-
-- policies leven in de migratie; schema.sql is geen bron voor storage-config.

-- ── T7 — Semantische laag + reproduceerbaarheid ─────────────────────────────
-- Migratie 2026_08_12_t7_semantische_laag.sql is authoritatief; dit is
-- documentatie. Getypeerde, aan een canoniek concept gebonden "semantic units"
-- voor documentvergelijking (epic Documentvergelijking, Fase 1), plus
-- reproduceerbare extractie-/vergelijkingsruns en menselijke oordelen.
--
-- SCHRIJFPAD (besluit T7): de pijplijn-tabellen (concepts, semantic_units,
-- extraction_run, comparison_run) worden UITSLUITEND door de service-role
-- beschreven; authenticated is read-only (RLS-select op eigen fonds; concepts
-- globaal leesbaar). difference_judgements is gebruiker-geschreven (INSERT met
-- WITH CHECK op auteur + fonds), auteur-scoped + private-aware leesbaar.
-- comparison_run + comparison_results (T5) hebben GEEN authenticated INSERT-grant:
-- schrijven loopt via de SECURITY DEFINER-RPC fn_schrijf_vergelijking (fonds_id
-- server-side uit auth.uid()), zodat de interactieve chat op de app-surface (zonder
-- service-role, Variant-C) toch un-forgeable provenance kan wegschrijven.
--
--  concepts (platform-globaal, geen fonds_id; `for select using(true)`, service-
--    role schrijft — catalogus-eigenaar). uq_concepts_id_type (id, type) dient als
--    doel voor de denorm-lock hieronder. In de global-lijst + gate-C allowlist van
--    de structurele gates. ⚠ Governance: catalogus-eigenaar vóór productie benoemen.
--  extraction_run (fonds_id) — append-only provenance-header (model/prompt/versie/
--    catalog_version) per extractie; T8 schrijft de rij één keer bij afronding.
--  comparison_run (fonds_id) — append-only header (mode/model/prompt/comparator).
--  comparison_results (comparison_run_id→comparison_run, fonds_id, bron/doel_
--    document_id→documenten, concept_id→concepts) — T5, append-only, één rij per
--    bevinding. Draagt UITSLUITEND ruwe verschillen: verschil_type_ruw ∈ gelijk|
--    verschilt|alleen_bron|alleen_doel + method ∈ deterministisch|llm (géén
--    bestuurlijke classificatie/materialiteit — dat is T9). finding_key koppelt aan
--    difference_judgements (T10). Schrijven alleen via fn_schrijf_vergelijking
--    (DEFINER). Indexen: (comparison_run_id), (fonds_id, finding_key).
--  semantic_units (fonds_id, document_id, chunk_id→document_chunks, concept_id→
--    concepts) — NIET append-only (her-extractie mag vervangen). `type` is via
--    composite-FK (concept_id, type)→concepts(id, type) gelockt aan concept.type;
--    een CHECK dwingt de juiste value_*-kolom af (percentage/amount→value_num,
--    date→value_date, policy_choice→value_text); evidence is verplicht + niet-leeg.
--    Indexen: (fonds_id, document_id), (concept_id), (document_id, concept_id),
--    (extraction_run_id).
--  difference_judgements (fonds_id, finding_key, user_id→profielen) — append-only,
--    voedt T10. Lezen: user_id=auth.uid() OF (private=false EN eigen fonds).
--    Promotie (promoted_to_dossier) wordt in T10 een NIEUWE rij, geen UPDATE.
--    Index: (fonds_id, finding_key), (user_id).
--
-- Append-only op extraction_run/comparison_run/difference_judgements via de
-- gedeelde public.fn_log_append_only() before-update/delete-triggers + het
-- ontbreken van UPDATE/DELETE-grants. Puur additief: geen bestaande tabel/policy
-- gewijzigd; geen app-gedrag verandert tot T8 schrijft.
