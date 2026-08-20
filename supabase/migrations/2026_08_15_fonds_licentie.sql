-- ============================================================================
--  Migratie 2026-08-15 — fonds_licentie: bundel/tarief/contract per fonds (P5)
--
--  WAAROM
--  De weergave "Verbruik & bundel" (monitoring, beheer-surface) zet het
--  AI-verbruik per fonds af tegen de licentiebundel. Bundel, tarieven en de
--  contract-ingangsdatum stonden tot nu toe UITSLUITEND hard-coded in de mockup
--  (MOCKUP-monitoring-verbruik-bundel-v0.2.html). Deze migratie ontsluit ze als
--  platform-beheerde, geaudite configuratie. Besluit 0178 (B-2).
--
--  WAT DEZE MIGRATIE LEVERT
--   1. public.fonds_licentie — één rij per fonds: jaarbundel (euro), tarief per
--      miljoen input-/output-tokens (euro), contract-ingangsdatum (bron voor de
--      pro-rata) en geldig_vanaf (voorkomt stille herberekening van historie).
--
--  WAT DEZE MIGRATIE NIET DOET
--   * GEEN verbruik-DB-object. De maand-in/out per fonds wordt LIVE afgeleid uit
--     governance_log.retrieval_meta->tokens (besluit 0178, B-1 = pad 2); er komt
--     bewust geen materialized view of per-aanroep-verbruikslog bij.
--   * GEEN fictieve cijfers. De tabel is leeg na deze migratie. De fictieve
--     pilot-seed staat apart in 2026_08_15_fonds_licentie_seed_preview.sql en
--     hoort UITSLUITEND op Preview (§12: Preview = synthetische inhoud).
--
--  RLS/AUTORISATIE-IMPACT
--  Eén nieuwe tabel, RLS aan + BEWUST GEEN POLICY (deny-by-default, patroon van
--  platform_signal_snapshots) + expliciete revoke van anon en authenticated.
--  Reden voor die revoke: een nieuwe tabel kan de volledige Supabase-
--  standaardgrant meekrijgen (R6). Lezen/schrijven gebeurt UITSLUITEND met de
--  service-role achter withPlatform(Read) op de beheer-surface. Licentiedata is
--  commercieel en mag NIET via tenant-RLS aan het fonds zelf lekken — daarom
--  geen fonds-policy.
--
--  GATE-IMPACT (supabase/checks/2026_07_31_r1_structurele_gates.sql)
--   * fonds_licentie draagt een EIGEN fonds_id -> gate A1 slaat de tabel over;
--     gate B vindt geen policies dus niets te toetsen (zelfde als
--     platform_signal_snapshots). Geen register-wijziging nodig.
--   * Geen SECURITY DEFINER-functie (gate E n.v.t.), geen anon-uitvoerbare
--     functie (gate H n.v.t.), geen TRUNCATE-recht aan wie dan ook (gate F).
--
--  IDEMPOTENT: create table/index if not exists. Meermaals draaien is veilig en
--  raakt bestaande rijen niet.
--  ROLLBACK: 2026_08_15_fonds_licentie_ROLLBACK.sql
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  EERST deze migratie draaien, DAN code-deploy — anders faalt de leeslaag op
--  een tabel die nog niet bestaat.
-- ============================================================================

begin;

create table if not exists public.fonds_licentie (
  fonds_id           uuid primary key references public.fondsen(id) on delete cascade,
  bundel_eur_jaar    numeric not null check (bundel_eur_jaar >= 0),
  tarief_in_eur_mln  numeric not null check (tarief_in_eur_mln >= 0),
  tarief_uit_eur_mln numeric not null check (tarief_uit_eur_mln >= 0),
  contract_start     date    not null,
  geldig_vanaf       date    not null default (date_trunc('year', now())::date),
  versie             integer not null default 1,
  bijgewerkt         timestamptz not null default now(),
  bijgewerkt_door    uuid
);

comment on table public.fonds_licentie is
  'GLOBAAL (T3-register: eigen fonds_id). Platform-beheerde licentie per fonds: '
  'jaarbundel, tarieven en contract-ingangsdatum voor de weergave "Verbruik & '
  'bundel". RLS aan, GEEN policy: uitsluitend gelezen/geschreven met de service-'
  'role achter withPlatform(Read). Commerciële data — bewust NIET via tenant-RLS '
  'aan het fonds zelf ontsloten. Besluit 0178.';

comment on column public.fonds_licentie.bundel_eur_jaar is
  'Jaarbundel in euro (vóór pro rata). De weergave rekent pro rata vanaf contract_start.';
comment on column public.fonds_licentie.contract_start is
  'Contract-ingangsdatum. Bron voor de pro-rata bundel en de prognose (verstreken contractmaanden).';
comment on column public.fonds_licentie.geldig_vanaf is
  'Datum vanaf wanneer dit tarief/deze bundel geldt. Voorkomt stille herberekening '
  'van historie bij een tariefwijziging; V0.2 gebruikt één actuele rij per fonds.';
comment on column public.fonds_licentie.bijgewerkt_door is
  'Platform-actor (auth.uid) die de rij laatst wijzigde, gezet via withPlatform. '
  'Geen FK: de schrijfkant loopt met de service-role, niet als de tenantgebruiker.';

alter table public.fonds_licentie enable row level security;
-- Deny-by-default: bewust GEEN policy.
revoke all on public.fonds_licentie from anon, authenticated;
-- De beheer-surface leest en beheert met de service-role.
grant select, insert, update, delete on public.fonds_licentie to service_role;

-- ── Fail-closed verificatie binnen dezelfde transactie ──────────────────────
--  Toets de UITKOMST in de database, niet de intentie in de migratie (CLAUDE.md).
do $$
declare
  n_policies int;
  fouten text := '';
begin
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'fonds_licentie' and c.relkind = 'r'
  ) then
    raise exception 'FONDS_LICENTIE-MIGRATIE FAALT: tabel ontbreekt';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'fonds_licentie' and c.relrowsecurity
  ) then
    fouten := fouten || '  - RLS staat UIT op fonds_licentie' || chr(10);
  end if;

  select count(*) into n_policies
    from pg_policies where schemaname = 'public' and tablename = 'fonds_licentie';
  if n_policies <> 0 then
    fouten := fouten || format('  - fonds_licentie draagt %s policy/policies (verwacht 0, deny-by-default)%s', n_policies, chr(10));
  end if;

  if has_table_privilege('anon', 'public.fonds_licentie', 'SELECT')
     or has_table_privilege('anon', 'public.fonds_licentie', 'INSERT')
     or has_table_privilege('authenticated', 'public.fonds_licentie', 'SELECT')
     or has_table_privilege('authenticated', 'public.fonds_licentie', 'INSERT') then
    fouten := fouten || '  - anon/authenticated heeft nog rechten op fonds_licentie' || chr(10);
  end if;

  -- Positieve controle: de service-role moet er wél bij kunnen, anders faalt de
  -- weergave stil.
  if not has_table_privilege('service_role', 'public.fonds_licentie', 'SELECT')
     or not has_table_privilege('service_role', 'public.fonds_licentie', 'INSERT')
     or not has_table_privilege('service_role', 'public.fonds_licentie', 'UPDATE') then
    fouten := fouten || '  - service_role kan fonds_licentie niet lezen/schrijven' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'FONDS_LICENTIE-MIGRATIE FAALT:\n%', fouten;
  end if;
  raise notice 'FONDS_LICENTIE OK: tabel deny-by-default, service_role heeft lees-/schrijfrecht.';
end $$;

commit;
