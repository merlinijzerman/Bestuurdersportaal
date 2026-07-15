-- ============================================================================
-- Migratie 2026-07-15 — Scenario A live web-retrieval: gezaghebbende bronnen-
-- whitelist (besluit 0072, voorstel 0019). Ontwerp: AI-WEBRETRIEVAL-ONTWERP.md.
-- ----------------------------------------------------------------------------
-- WAAROM. Scenario A activeert live web-retrieval, maar UITSLUITEND over een
-- beheerde whitelist van gezaghebbende domeinen. De whitelist is GENERIEKE
-- PLATFORMCONFIGURATIE (fonds_id-loos, cross-tenant), read-only voor tenants,
-- curatie via de platform-back-office (service-role achter withPlatform, cap
-- platform.config.manage). De chat-route (tenant anon+RLS) leest de actieve
-- entries om `allowed_domains` voor de Anthropic web_search-tool te bouwen.
--
-- Deze migratie levert:
--   1. public.bron_whitelist        — de whitelist zelf.
--   2. public.bron_whitelist_log    — append-only domeinlog (naast platform_event_log).
--   3. RLS: tenants lezen ACTIEVE entries (read-only); schrijven deny-by-default
--      (alleen service-role). Log = deny-by-default (alleen service-role).
--   4. Seed van de startset (§3.2). normgewicht-mapping is een VOORSTEL, te
--      bekrachtigen door compliance; de entries staan 'actief', maar live web-
--      retrieval blijft daarnaast achter de env-vlag WEB_RETRIEVAL_ACTIEF
--      (dubbele poort: DB-actief + env-aan) tot productie-readiness.
--
-- AUTORISATIE-RLS. bron_whitelist: SELECT voor elke geauthenticeerde gebruiker
--   op status='actief' (leespad chat-route); geen insert/update/delete-policy →
--   deny-by-default voor anon/tenant, mutatie uitsluitend via service-role.
--   bron_whitelist_log: RLS aan, geen policy → alleen service-role leest/schrijft.
--
-- NORMGEWICHT. Hergebruikt de bestaande enum (bindend/toezichtverwachting/
--   sector_guidance/informatief/onbekend) — GEEN parallel tier-veld voor weging.
--   `tier`/`categorie` zijn puur beheerlabels voor het curatie-scherm.
--
-- Idempotent (create table if not exists / add column if not exists / drop+create
--   policy+trigger / seed via on conflict do nothing). EERST in Supabase draaien,
--   DAN code-deploy (anders leest de chat-route naar een niet-bestaande tabel).
-- ROLLBACK: 2026_07_15_bron_whitelist_ROLLBACK.sql.
-- ============================================================================

begin;

-- ── 1. Whitelist-tabel ──────────────────────────────────────────────────────
create table if not exists public.bron_whitelist (
  id             uuid primary key default uuid_generate_v4(),
  domein         text        not null,                 -- genormaliseerd, zonder 'www.'
  matchtype      text        not null default 'domein',-- 'domein'|'domein_subdomeinen'|'padprefix'
  pad            text,                                  -- padprefix, alleen bij matchtype='padprefix'
  normgewicht    text        not null,                 -- bindend|toezichtverwachting|sector_guidance|informatief|onbekend
  categorie      text,                                  -- vrij beheerlabel (filter)
  tier           text,                                  -- '1'|'2'|'3'|'context' — beheerlabel, NIET de weging
  status         text        not null default 'in_review', -- 'actief'|'inactief'|'in_review'
  toelichting    text        not null,                 -- verplichte reden/duiding
  toegevoegd_door uuid,                                 -- platform-identiteit (geen FK: identities leven apart)
  gewijzigd_door  uuid,
  toegevoegd_op  timestamptz not null default now(),
  gewijzigd_op   timestamptz not null default now(),
  review_datum   date
);

comment on table public.bron_whitelist is
  '0072/Scenario A: beheerde whitelist van gezaghebbende domeinen voor live web-retrieval. Generieke platformconfiguratie (fonds_id-loos), read-only voor tenants, curatie via platform.config.manage. Weging op normgewicht.';
comment on column public.bron_whitelist.matchtype is
  '''domein'' = exact dit domein; ''domein_subdomeinen'' = domein + alle subdomeinen; ''padprefix'' = domein beperkt tot het pad in kolom pad.';
comment on column public.bron_whitelist.normgewicht is
  'Hergebruik van de documenten-normgewicht-enum; leidend voor de bron-weging (bindend > toezichtverwachting > sector_guidance > informatief). Geen parallel tier-veld.';
comment on column public.bron_whitelist.tier is
  'Puur beheerlabel voor het curatie-scherm (1/2/3/context). De feitelijke weging loopt via normgewicht.';

-- CHECK-constraints (idempotent toegevoegd).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bron_whitelist_matchtype_check') then
    alter table public.bron_whitelist add constraint bron_whitelist_matchtype_check
      check (matchtype in ('domein','domein_subdomeinen','padprefix'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bron_whitelist_status_check') then
    alter table public.bron_whitelist add constraint bron_whitelist_status_check
      check (status in ('actief','inactief','in_review'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bron_whitelist_normgewicht_check') then
    alter table public.bron_whitelist add constraint bron_whitelist_normgewicht_check
      check (normgewicht in ('bindend','toezichtverwachting','sector_guidance','informatief','onbekend'));
  end if;
  -- padprefix vereist een pad; andere matchtypes hebben geen pad.
  if not exists (select 1 from pg_constraint where conname = 'bron_whitelist_pad_check') then
    alter table public.bron_whitelist add constraint bron_whitelist_pad_check
      check (
        (matchtype = 'padprefix' and pad is not null and pad <> '')
        or (matchtype <> 'padprefix')
      );
  end if;
end $$;

-- Uniek per (domein, matchtype, pad): voorkomt exacte duplicaten, staat wél een
-- padprefix-entry náást een domein-entry op hetzelfde domein toe.
create unique index if not exists ux_bron_whitelist_domein_match
  on public.bron_whitelist (domein, matchtype, coalesce(pad, ''));
create index if not exists idx_bron_whitelist_status on public.bron_whitelist (status);
create index if not exists idx_bron_whitelist_review on public.bron_whitelist (review_datum);

-- ── 2. Append-only domeinlog (patroon document_metadata_log) ────────────────
create table if not exists public.bron_whitelist_log (
  id              uuid primary key default uuid_generate_v4(),
  whitelist_id    uuid,                                 -- geen FK: log overleeft hard-delete van de entry
  domein_snapshot text,
  handeling       text not null,                        -- 'aanmaken'|'bijwerken'|'activeren'|'deactiveren'|'verwijderen'
  gewijzigd_door  uuid,                                 -- platform-identiteit
  gewijzigd_op    timestamptz not null default now(),
  oud             jsonb,
  nieuw           jsonb,
  reden           text,
  hash            text,                                 -- sha256 over canonical event-data
  tijdstip        timestamptz not null default now()
);

comment on table public.bron_whitelist_log is
  '0072/Scenario A: append-only auditlog van whitelist-wijzigingen (naast platform_event_log). Immutable + hash per event.';

create index if not exists idx_bron_whitelist_log_entry on public.bron_whitelist_log (whitelist_id, tijdstip desc);

-- Append-only: blokkeer update/delete door ALLE rollen (incl. service-role).
create or replace function public.fn_bron_whitelist_log_immutable()
returns trigger language plpgsql as $f$
begin
  raise exception 'bron_whitelist_log is append-only';
end;
$f$;

drop trigger if exists trg_bron_whitelist_log_no_update on public.bron_whitelist_log;
create trigger trg_bron_whitelist_log_no_update
  before update on public.bron_whitelist_log
  for each row execute procedure public.fn_bron_whitelist_log_immutable();

drop trigger if exists trg_bron_whitelist_log_no_delete on public.bron_whitelist_log;
create trigger trg_bron_whitelist_log_no_delete
  before delete on public.bron_whitelist_log
  for each row execute procedure public.fn_bron_whitelist_log_immutable();

-- Hash per event (sha256) → manipulatie-detecteerbaar.
create or replace function public.fn_bron_whitelist_log_hash()
returns trigger language plpgsql as $f$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
      coalesce(new.whitelist_id::text,'') || '|' ||
      coalesce(new.domein_snapshot,'')    || '|' ||
      coalesce(new.handeling,'')          || '|' ||
      coalesce(new.gewijzigd_door::text,'')|| '|' ||
      coalesce(new.oud::text,'')          || '|' ||
      coalesce(new.nieuw::text,'')        || '|' ||
      coalesce(new.reden,'')              || '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$f$;

drop trigger if exists trg_bron_whitelist_log_hash on public.bron_whitelist_log;
create trigger trg_bron_whitelist_log_hash
  before insert on public.bron_whitelist_log
  for each row execute procedure public.fn_bron_whitelist_log_hash();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
alter table public.bron_whitelist     enable row level security;
alter table public.bron_whitelist_log enable row level security;

-- Whitelist: elke geauthenticeerde gebruiker leest ACTIEVE entries (de chat-route
-- bouwt hieruit allowed_domains). Inactieve/in_review-entries én álle mutaties zijn
-- deny-by-default → uitsluitend via de service-role achter withPlatform.
drop policy if exists "bron_whitelist lees actief" on public.bron_whitelist;
create policy "bron_whitelist lees actief" on public.bron_whitelist
  for select using (status = 'actief' and auth.uid() is not null);

-- Log: geen policy → deny-by-default; alleen service-role leest/schrijft.

-- ── 4. Seed startset (§3.2). normgewicht-mapping = VOORSTEL (compliance). ─────
-- Idempotent via on conflict (ux_bron_whitelist_domein_match). toegevoegd_door
-- NULL = systeem-seed (geen platform-identiteit bij migratie).
insert into public.bron_whitelist (domein, matchtype, pad, normgewicht, categorie, tier, status, toelichting) values
  -- Tier 1 — wet/toezicht (bindend)
  ('wetten.overheid.nl',              'domein_subdomeinen', null, 'bindend',            'wet/toezicht',        '1',       'actief', 'Officiële geconsolideerde wetteksten (bindende norm).'),
  ('zoek.officielebekendmakingen.nl', 'domein_subdomeinen', null, 'bindend',            'wet/toezicht',        '1',       'actief', 'Officiële bekendmakingen (Staatsblad, Staatscourant).'),
  ('wetgevingskalender.overheid.nl',  'domein_subdomeinen', null, 'bindend',            'wet/toezicht',        '1',       'actief', 'Status en planning van wetgeving.'),
  ('dnb.nl',                          'domein_subdomeinen', null, 'bindend',            'wet/toezicht',        '1',       'actief', 'De Nederlandsche Bank — prudentieel toezicht pensioenfondsen.'),
  ('afm.nl',                          'domein_subdomeinen', null, 'bindend',            'wet/toezicht',        '1',       'actief', 'Autoriteit Financiële Markten — gedragstoezicht.'),
  ('eur-lex.europa.eu',               'domein_subdomeinen', null, 'bindend',            'wet/toezicht',        '1',       'actief', 'EU-wetgeving en -jurisprudentie (bindende norm).'),
  -- Tier 2 — overheidsbeleid/uitvoering (toezichtverwachting)
  ('rijksoverheid.nl',                'domein_subdomeinen', null, 'toezichtverwachting','overheidsbeleid',     '2',       'actief', 'Rijksoverheid — beleid en uitleg wet- en regelgeving.'),
  ('werkenaanonspensioen.nl',         'domein_subdomeinen', null, 'toezichtverwachting','overheidsbeleid',     '2',       'actief', 'Officiële voorlichting Wet toekomst pensioenen (Wtp).'),
  ('belastingdienst.nl',              'domein_subdomeinen', null, 'toezichtverwachting','overheidsbeleid',     '2',       'actief', 'Belastingdienst — fiscale kaders pensioen.'),
  ('autoriteitpersoonsgegevens.nl',   'domein_subdomeinen', null, 'toezichtverwachting','overheidsbeleid',     '2',       'actief', 'Autoriteit Persoonsgegevens — AVG-toezicht.'),
  -- Tier 3 — sector/zelfregulering (sector_guidance)
  ('pensioenfederatie.nl',            'domein_subdomeinen', null, 'sector_guidance',    'sector',              '3',       'actief', 'Pensioenfederatie — sectorbrede guidance en servicedocumenten.'),
  ('stvda.nl',                        'domein_subdomeinen', null, 'sector_guidance',    'sector',              '3',       'actief', 'Stichting van de Arbeid — sociale partners, pensioenakkoord.'),
  ('kifid.nl',                        'domein_subdomeinen', null, 'sector_guidance',    'sector',              '3',       'actief', 'Kifid — klachteninstituut financiële dienstverlening.'),
  -- Context (informatief)
  ('cbs.nl',                          'domein_subdomeinen', null, 'informatief',        'context',             'context', 'actief', 'CBS — statistische context (levensverwachting, inflatie).'),
  ('tweedekamer.nl',                  'domein_subdomeinen', null, 'informatief',        'context',             'context', 'actief', 'Tweede Kamer — parlementaire behandeling (context, geen norm).'),
  ('ondernemersplein.overheid.nl',    'domein_subdomeinen', null, 'informatief',        'context',             'context', 'actief', 'Ondernemersplein — toegankelijke uitleg regelgeving (context).')
on conflict (domein, matchtype, coalesce(pad, '')) do nothing;

commit;

-- ============================================================================
-- Verificatie na afloop (handmatig):
--   • select count(*) from public.bron_whitelist;                 → 16 seed-rijen
--   • select domein, normgewicht, status from public.bron_whitelist order by tier;
--   • update public.bron_whitelist_log set reden='x';             → moet FALEN (append-only)
--   • als tenant (anon+RLS): select * from public.bron_whitelist; → alleen status='actief'
--   • als tenant: insert into public.bron_whitelist(...);         → moet FALEN (geen policy)
-- ============================================================================
