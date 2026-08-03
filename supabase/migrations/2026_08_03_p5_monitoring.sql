-- ============================================================================
--  Migratie 2026-08-03 — P5/P4-light: monitoringbasis beheer-surface
--
--  WAAROM
--  De beheer-surface heeft geen monitoringlaag. Fouten landen uitsluitend in
--  console.error -> Vercel-logs; er is geen aggregatie, geen gezondheidsmeting
--  en geen plek waar iemand kijkt. Detectie is inmiddels de compensating
--  control onder meerdere bewust geaccepteerde risico's (fail-open rate
--  limiting, gestubde malwarescan, de 72-uurs meldtermijn art. 33/34). Besluit
--  0005 koos voor in-stack (geen Sentry); de rate-limiting-helft daarvan is in
--  2026_06_10 gebouwd, de error-logging-helft nooit. Deze migratie sluit die.
--
--  WAT DEZE MIGRATIE LEVERT
--   1. public.app_errors               — gestructureerde foutregels (FO §18.1:
--                                        tien categorieën + vier severities).
--   2. public.platform_signal_snapshots — tijdreeks per signaal per fonds.
--   3. public.platform_signaal_config   — drempels/intervallen ALS DATA, zodat
--                                        de latere alerting-tranche alleen een
--                                        bestemming hoeft toe te voegen en geen
--                                        herdefinitie (besluit 0105).
--   4. public.fn_app_error_log(...)     — het ENIGE schrijfpad naar app_errors
--                                        vanaf de gedeelde (tenant/publieke)
--                                        surface.
--
--  WAAROM EEN SECURITY DEFINER-FUNCTIE EN NIET GEWOON DE SERVICE-ROLE
--  Sinds variant C (besluit 0066) leeft SUPABASE_SERVICE_ROLE_KEY UITSLUITEND
--  in het beheer-project. core/lib/api-errors.ts draait op de gedeelde surface
--  en heeft die sleutel niet. Zonder RPC zou de tenant-surface dus niets kunnen
--  loggen. Dit volgt exact het D1-patroon (besluit 0065): een SMALLE,
--  SECURITY DEFINER-RPC met gepind search_path, aanroepbaar met de sessieclient.
--  De tabel blijft deny-by-default; de RLS-bypass is afgebakend tot de body.
--
--  BEWUST NIET AAN anon GEGEVEN. Een internet-facing schrijfpad naar een
--  platformtabel is een spam-/vulvector, en gate H staat maar drie
--  anon-uitvoerbare functies toe. Gevolg: fouten op ongeauthenticeerde paden
--  (contactformulier, publieke pagina's) landen NIET in app_errors; daar blijft
--  console.error het enige spoor. Bewust aanvaard restrisico.
--
--  APPEND-ONLY: NEE, EXPLICIET NIET.
--  app_errors is een OPERATIONELE logtabel, geen auditspoor. Er komt bewust
--  GEEN fn_log_append_only-trigger op: die zou de retentie-opschoning (90 dagen)
--  onmogelijk maken. De naam draagt daarom ook geen `_log`-suffix, zodat de
--  tabel niet als lid van de auditfamilie (governance_log, platform_event_log,
--  procedure_log, ...) leest. Zie besluit 0104. Het bestaande auditspoor wordt
--  door deze migratie NIET geraakt: geen enkele bestaande tabel, policy,
--  trigger of grant wijzigt.
--
--  RLS/AUTORISATIE-IMPACT
--  Drie nieuwe tabellen, alle drie RLS aan + BEWUST GEEN POLICY
--  (deny-by-default, patroon van document_processing_jobs en rate_limit_events)
--  + expliciete revoke van anon en authenticated. Reden voor die revoke: R6 kon
--  de supabase_admin-kant van de default privileges niet dichtzetten, dus een
--  nieuwe tabel kan de volledige Supabase-standaardgrant meekrijgen. Handwerk
--  per migratie is daar de maatregel.
--
--  GATE-IMPACT (supabase/checks/2026_07_31_r1_structurele_gates.sql)
--   * app_errors en platform_signal_snapshots dragen een eigen fonds_id -> gate
--     A1 slaat ze over; gate B vindt geen policies dus niets te toetsen.
--   * platform_signaal_config heeft GEEN fonds_id (drempels zijn platformbreed)
--     en is daarom toegevoegd aan de `globaal`-array in het gate-bestand.
--   * fn_app_error_log heeft een gepind search_path (gate E) en is ingetrokken
--     bij public én anon (gate H).
--   * Geen TRUNCATE-recht aan wie dan ook (gate F).
--
--  IDEMPOTENT: create table/index if not exists, create or replace function,
--  seed met on conflict do nothing. Meermaals draaien is veilig.
--  ROLLBACK: 2026_08_03_p5_monitoring_ROLLBACK.sql
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  EERST deze migratie draaien, DAN code-deploy — anders falen de inserts op
--  een tabel die nog niet bestaat.
-- ============================================================================

begin;

-- ── 1. app_errors ───────────────────────────────────────────────────────────
--  fonds_id staat op de rij zodat signaal 1 (embedding-/indexeringsfouten) en
--  signaal 5 (rate-limit-incidenten) per fonds gegroepeerd kunnen worden, ook
--  nu er één fonds is (bronneutraal, TO §9 / FO §20.1). De waarde wordt
--  SERVER-SIDE afgeleid in fn_app_error_log uit auth.uid(); er is bewust geen
--  p_fonds_id-parameter, zodat een caller hem niet kan vervalsen. Dat is
--  hetzelfde principe als de T8-guard op het chat-auditpad.
--
--  WAT ER NIET IN MAG: prompts, documentinhoud, vraagteksten, deelnemer-
--  gegevens. Er is geen enkel veld waar die in kunnen landen — melding_kort is
--  altijd AFGELEID en geredigeerd (core/lib/app-fout.ts) en hard afgekapt, en
--  context_sleutels bevat alleen de SLEUTELS van de logcontext, nooit de
--  waarden. De negatieve controle staat in core/lib/app-fout.sanity.ts.
create table if not exists public.app_errors (
  id               uuid primary key default gen_random_uuid(),
  tijdstip         timestamptz not null default now(),
  fonds_id         uuid references public.fondsen(id) on delete set null,
  label            text not null,
  categorie        text not null check (categorie in (
                     'auth_sessie',                -- 1. auth/sessie
                     'autorisatie',                -- 2. autorisatie/capability
                     'validatie',                  -- 3. validatie/invoer
                     'upload_bestandsveiligheid',  -- 4. upload/bestandsveiligheid
                     'extractie_ocr',              -- 5. extractie/OCR
                     'embedding_indexering',       -- 6. embedding/indexering
                     'retrieval_ai',               -- 7. retrieval/AI-model
                     'rate_limiting',              -- 8. rate limiting
                     'database_integriteit',       -- 9. database/integriteit
                     'externe_afhankelijkheid')),  -- 10. externe afhankelijkheid/infra
  severity         text not null check (severity in ('laag','middel','hoog','kritiek')),
  http_status      integer,
  fouttype         text,
  foutcode         text,
  melding_kort     text check (melding_kort is null or char_length(melding_kort) <= 200),
  context_sleutels text[],
  correlatie_id    uuid,
  -- Herkomst van de rij. 'rpc' = via fn_app_error_log, dus door een INGELOGDE
  -- gebruiker aangeleverd en daarmee in principe beïnvloedbaar; 'service' = door
  -- de beheer-surface of een cron geschreven. Zonder dit onderscheid kan een
  -- operator een server-gegenereerde regel niet van een gefabriceerde
  -- onderscheiden — en signaal 5 is juist de detectielaag onder een bewust
  -- geaccepteerd risico.
  bron             text not null default 'rpc' check (bron in ('rpc','service'))
);

comment on table public.app_errors is
  'GLOBAAL + OPERATIONEEL (T3-register). Gestructureerde API-foutregels (FO §18.1). '
  'RLS aan, GEEN policy: alleen de service-role leest; schrijven uitsluitend via '
  'fn_app_error_log (gedeelde surface) of de service-role (beheer-surface). '
  'NIET append-only en bewust GEEN auditspoor — retentie 90 dagen, opgeschoond '
  'door de snapshot-cron (besluit 0104). Bevat per constructie geen prompt-, '
  'document- of deelnemergegevens.';

comment on column public.app_errors.fonds_id is
  'Server-side afgeleid uit auth.uid() in fn_app_error_log; nooit door de caller aangeleverd. NULL = platformcontext of geen sessie.';
comment on column public.app_errors.melding_kort is
  'AFGELEIDE, geredigeerde melding (max 200 tekens). Nooit error.message rauw; nooit details/hint van een PostgrestError.';
comment on column public.app_errors.context_sleutels is
  'Alleen de SLEUTELS van de logcontext — nooit de waarden.';
comment on column public.app_errors.correlatie_id is
  'Verwijst naar platform_event_log.correlatie_id waar een platformhandeling de fout veroorzaakte. Geen FK omdat correlatie_id daar NIET uniek is: de unique index staat op (correlatie_id, fase), want elke handeling levert een attempt- en een result-rij.';
comment on column public.app_errors.bron is
  'rpc = aangeleverd door een ingelogde gebruiker via fn_app_error_log (beïnvloedbaar); service = geschreven door de beheer-surface of een cron.';

create index if not exists idx_app_errors_tijd
  on public.app_errors (tijdstip desc);
create index if not exists idx_app_errors_categorie
  on public.app_errors (categorie, tijdstip desc);
create index if not exists idx_app_errors_fonds
  on public.app_errors (fonds_id, tijdstip desc);

alter table public.app_errors enable row level security;
-- Deny-by-default: bewust GEEN policy. De anon-key ziet/raakt deze tabel niet.
-- Defense-in-depth tegen de supabase_admin-default-ACL (zie R6): ook de directe
-- tabelrechten intrekken.
revoke all on public.app_errors from anon, authenticated;

-- ── 2. platform_signal_snapshots ────────────────────────────────────────────
--  Tijdreeks. Elke signaalquery groepeert op fonds_id, ook bij één fonds;
--  platformbrede signalen (uptime) schrijven één rij met fonds_id = null. Dat
--  is een expliciete keuze, geen ontbrekende groepering.
--
--  drempel_oranje/drempel_rood worden MEEGESTEMPELD uit platform_signaal_config
--  op het moment van meten. Zonder dat is historie niet interpreteerbaar nadat
--  iemand een drempel bijstelt.
create table if not exists public.platform_signal_snapshots (
  id             uuid primary key default gen_random_uuid(),
  tijdstip       timestamptz not null default now(),
  signaal        text not null,
  fonds_id       uuid references public.fondsen(id) on delete set null,
  waarde         numeric,
  n              integer,
  status         text not null check (status in ('groen','oranje','rood','onbekend')),
  drempel_oranje numeric,
  drempel_rood   numeric,
  meta           jsonb
);

comment on table public.platform_signal_snapshots is
  'GLOBAAL (T3-register). Tijdreeks per signaal per fonds (FO §19, signalen 1-7 en 14). '
  'RLS aan, GEEN policy: gevuld door de snapshot-cron met de service-role, gelezen '
  'achter withPlatformRead + platform.observability.read. Uitsluitend AGGREGATEN — '
  'geen individu-herleidbare gegevens; onder de n-drempel (n<10, besluit 0055) is de '
  'status "onbekend". Retentie 180 dagen (besluit 0104).';

comment on column public.platform_signal_snapshots.fonds_id is
  'NULL = platformbreed signaal (bv. uptime). Anders het fonds waarop het aggregaat slaat.';
comment on column public.platform_signal_snapshots.n is
  'Aantal waarnemingen achter de waarde; voedt de n-drempel bij gebruikssignalen.';
comment on column public.platform_signal_snapshots.meta is
  'Aanvullende AGGREGATEN (bv. status per healthcheck-component). Nooit fondsinhoud of gebruikersgegevens.';

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
-- Deny-by-default: bewust GEEN policy.
revoke all on public.platform_signal_snapshots from anon, authenticated;

-- ── 3. platform_signaal_config ──────────────────────────────────────────────
--  Drempels ALS DATA (TO §9, besluit 0105). Een drempel wijzigen is een
--  SQL-update, geen deploy. De code kent dezelfde waarden als typed registry
--  (platform/lib/monitoring-signalen.ts) en gebruikt die als FALLBACK: een
--  ontbrekende of gedeactiveerde rij mag nooit een snapshot blokkeren.
--
--  Platformbreed, dus GEEN fonds_id -> geregistreerd in de globaal-array van
--  supabase/checks/2026_07_31_r1_structurele_gates.sql (gate A1).
create table if not exists public.platform_signaal_config (
  signaal          text primary key,
  label            text not null,
  eenheid          text not null check (eenheid in
                     ('percentage','aantal','milliseconden','trend_percentage')),
  interval_minuten integer not null check (interval_minuten > 0),
  venster_minuten  integer not null check (venster_minuten >= 0),
  drempel_oranje   numeric,
  drempel_rood     numeric,
  richting         text not null check (richting in ('hoger_is_slechter','lager_is_slechter')),
  n_drempel        integer,
  actief           boolean not null default true,
  toelichting      text,
  bijgewerkt       timestamptz not null default now(),
  -- Besluit 0055 is geen instelling. De drie gebruikssignalen moeten een
  -- n-drempel houden van ten minste 10; anders is de suppressie met één
  -- SQL-update uitgeschakeld voor precies de signalen waar hij voor bedoeld is,
  -- terwijl het dashboard blijft beweren dat hij geldt. Verlagen hoort een
  -- besluit te zijn dat 0055 herziet. (De code kent dezelfde vloer, zodat een
  -- database die vóór deze constraint is aangelegd óók gedekt is.)
  constraint chk_signaal_n_drempel check (
    signaal not in ('ai_latency_p95', 'lege_antwoord_ratio', 'tokenverbruik')
    or (n_drempel is not null and n_drempel >= 10)
  )
);

comment on table public.platform_signaal_config is
  'GLOBAAL (T3-register). Drempel- en frequentieconfiguratie per monitoringsignaal. '
  'RLS aan, GEEN policy: gelezen door de snapshot-cron (service-role); wijzigen gebeurt '
  'in de SQL-editor. Dit is de haak waar de latere alerting-tranche op landt — een '
  'hardcoded drempel zou dan opnieuw verplaatst moeten worden (besluit 0105).';

comment on column public.platform_signaal_config.venster_minuten is
  '0 = momentopname (geen tijdvenster), bv. de extractie-achterstand.';
comment on column public.platform_signaal_config.richting is
  'hoger_is_slechter: waarde >= drempel is slechter. lager_is_slechter: waarde <= drempel is slechter (uptime).';
comment on column public.platform_signaal_config.n_drempel is
  'NULL = geen n-drempel. Anders: onder dit aantal waarnemingen wordt de waarde onderdrukt (status "onbekend"), wegens her-identificatierisico bij kleine fondsen (FO §17, besluit 0055).';

alter table public.platform_signaal_config enable row level security;
-- Deny-by-default: bewust GEEN policy.
revoke all on public.platform_signaal_config from anon, authenticated;

-- ── 4. Seed van de acht signalen uit deze tranche ───────────────────────────
--  Drempelwaarden zijn de richtwaarden uit FO §19. on conflict do nothing: een
--  latere handmatige bijstelling in de SQL-editor wordt door een herdraai van
--  deze migratie NIET teruggezet.
insert into public.platform_signaal_config
  (signaal, label, eenheid, interval_minuten, venster_minuten,
   drempel_oranje, drempel_rood, richting, n_drempel, toelichting)
values
  ('uptime_kern', 'Uptime kernfunctionaliteit', 'percentage', 5, 1440,
   99.5, 99.0, 'lager_is_slechter', null,
   'Aandeel healthcheck-runs zonder rode component. Traag (oranje) en onbekend tellen niet als storing.'),

  ('embedding_indexering_fouten', 'Embedding-/indexeringsfouten', 'percentage', 15, 60,
   2, 5, 'hoger_is_slechter', null,
   'Aandeel mislukte embedding-/indexeringsjobs t.o.v. alle jobs in die stappen.'),

  ('extractie_achterstand', 'Extractie-/OCR-achterstand', 'aantal', 15, 0,
   10, 50, 'hoger_is_slechter', null,
   'Momentopname: jobs in stap extractie/ocr met status wachtend of bezig.'),

  ('rate_limit_incidenten', 'Rate-limit-incidenten', 'aantal', 15, 1440,
   20, 40, 'hoger_is_slechter', null,
   'Foutregels met categorie rate_limiting: 429-responses plus mislukte limietchecks (fail-open).'),

  ('audit_volledigheid', 'Audit-volledigheid (attempt zonder result)', 'aantal', 15, 1440,
   1, 5, 'hoger_is_slechter', null,
   'Attempt-events in platform_event_log zonder bijbehorend result-event, ouder dan 5 minuten. Alleen het AANTAL; doorklik vergt platform.logs.read (P6).'),

  ('ai_latency_p95', 'AI-modellatency (p95)', 'milliseconden', 60, 1440,
   5000, 10000, 'hoger_is_slechter', 10,
   'p95 van de modeltijd per gesprek (map-lus + eindgeneratie). Geen doorlooptijd van de beurt.'),

  ('lege_antwoord_ratio', 'Lege-antwoord-ratio', 'percentage', 60, 1440,
   15, 30, 'hoger_is_slechter', 10,
   'Aandeel antwoorden met geselecteerd = 0 of zwakke_bronbasis = true; terugvragen tellen niet mee.'),

  ('tokenverbruik', 'Tokenverbruik per fonds', 'trend_percentage', 60, 1440,
   50, 100, 'hoger_is_slechter', 10,
   'Procentuele stijging t.o.v. het voortschrijdend 7-daags daggemiddelde. Ondergrens — zie het dekkingsvoorbehoud op het dashboard.')
on conflict (signaal) do nothing;

-- ── 5. fn_app_error_log — het schrijfpad vanaf de gedeelde surface ──────────
--  SECURITY DEFINER met gepind search_path (gate E). fonds_id wordt hier
--  afgeleid en is daarom niet spoofbaar door de caller. De left()-afkappingen
--  zijn defense-in-depth: de TS-laag saniteert al, maar de database hoort niet
--  te vertrouwen op de correctheid van zijn aanroeper.
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
  -- ── Volumeklep ────────────────────────────────────────────────────────────
  -- Deze functie is via PostgREST rechtstreeks aanroepbaar door ELKE ingelogde
  -- gebruiker (`POST /rest/v1/rpc/fn_app_error_log`). Zonder rem kan iemand de
  -- tabel vullen en signaal 5 (rate-limit-incidenten) naar believen op rood
  -- zetten of juist in de ruis laten verdwijnen. Een detectie-control die de
  -- gecontroleerde zelf kan vullen is geen control.
  --
  -- Hergebruikt de bestaande primitief uit 2026_06_10_rate_limiting.sql: die
  -- sleutelt op auth.uid(), schoont zichzelf op, en introduceert dus geen nieuw
  -- oppervlak. Boven de limiet wordt de regel STIL genegeerd — een foutlogger
  -- die zelf een fout gooit maakt het probleem erger. Het verlies is zichtbaar:
  -- de betrokken gebruiker zit dan al ver boven een normaal foutvolume.
  begin
    v_limiet := public.fn_rate_limit_check('app_error_log', 120, interval '1 minute');
    if v_limiet is not null and (v_limiet->>'toegestaan')::boolean is false then
      return;
    end if;
  exception when others then
    -- Geen sessie of teller onbereikbaar: doorgaan. Fail-open is hier juist,
    -- want de klep beschermt tegen vervuiling, niet tegen verlies.
    null;
  end;

  -- Server-side fondsafleiding. Geen sessie (machine-/publiek pad) -> null.
  select p.fonds_id into v_fonds_id
    from public.profielen p
   where p.id = auth.uid();

  insert into public.app_errors (
    fonds_id, label, categorie, severity, http_status,
    fouttype, foutcode, melding_kort, context_sleutels, correlatie_id, bron
  ) values (
    v_fonds_id,
    left(p_label, 120),
    p_categorie,
    p_severity,
    p_http_status,
    left(p_fouttype, 80),
    left(p_foutcode, 40),
    left(p_melding_kort, 200),
    -- [1:20] begrenst het AANTAL elementen; left() per element begrenst de
    -- LENGTE. Zonder dat tweede is 20 elementen van 1 MB een rij van 20 MB —
    -- een directe RPC-aanroeper is niet gebonden aan de afkapping in de TS-laag.
    (select array_agg(left(x, 60)) from unnest(p_context_sleutels[1:20]) as x),
    p_correlatie_id,
    'rpc'
  );
end;
$$;

comment on function public.fn_app_error_log(text, text, text, integer, text, text, text, text[], uuid) is
  'P5: enige schrijfpad naar app_errors vanaf de gedeelde (tenant/publieke) surface, die sinds variant C geen service-role meer heeft. SECURITY DEFINER (app_errors blijft deny-by-default); fonds_id wordt server-side uit auth.uid() afgeleid en is geen parameter. NIET aan anon gegeven.';

-- Grants: intrekken bij public ÉN anon (op Supabase is `from public` alleen niet
-- genoeg — de default-ACL kent EXECUTE expliciet aan anon toe), daarna gericht
-- teruggeven aan de rollen die de aanroeper werkelijk gebruikt.
revoke all on function public.fn_app_error_log(text, text, text, integer, text, text, text, text[], uuid)
  from public, anon;
grant execute on function public.fn_app_error_log(text, text, text, integer, text, text, text, text[], uuid)
  to authenticated, service_role;

-- ── 5b. Expliciete grants aan service_role ─────────────────────────────────
--  Geen enkele migratie in deze repo geeft ooit een expliciete tabelgrant aan
--  service_role; dat leunt volledig op de Supabase-default-ACL — dezelfde ACL
--  die R6 juist aan het inperken is. Wordt die strakker gezet, dan faalt de
--  monitoring STIL: laadConfiguratie, schoonOp en logPlatformFout slikken hun
--  fout allemaal (bewust, want ze mogen niets blokkeren). Een blinde monitor
--  dus — precies de faalvorm die deze tranche moet uitsluiten. Expliciet
--  maken kost niets en haalt de aanname weg.
grant select, insert, delete on public.app_errors                to service_role;
grant select, insert, delete on public.platform_signal_snapshots to service_role;
grant select                 on public.platform_signaal_config   to service_role;

-- ── 6. Fail-closed verificatie binnen dezelfde transactie ───────────────────
do $$
declare
  t text;
  n_policies int;
  n_signalen int;
  fouten text := '';
begin
  -- 6a. Alle drie de tabellen bestaan, hebben RLS aan en GEEN policy.
  foreach t in array array['app_errors','platform_signal_snapshots','platform_signaal_config']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      fouten := fouten || format('  - tabel %s ontbreekt%s', t, chr(10));
      continue;
    end if;

    if not exists (
      select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      fouten := fouten || format('  - RLS staat UIT op %s%s', t, chr(10));
    end if;

    select count(*) into n_policies
      from pg_policies where schemaname = 'public' and tablename = t;
    if n_policies <> 0 then
      fouten := fouten || format('  - %s draagt %s policy/policies (verwacht 0, deny-by-default)%s', t, n_policies, chr(10));
    end if;

    -- 6b. anon en authenticated houden geen enkel recht op deze tabellen.
    if has_table_privilege('anon', 'public.' || t, 'SELECT')
       or has_table_privilege('anon', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT') then
      fouten := fouten || format('  - anon/authenticated heeft nog rechten op %s%s', t, chr(10));
    end if;
  end loop;

  -- 6c. De functie is niet uitvoerbaar door anon (gate H) en heeft een gepind
  --     search_path (gate E).
  if has_function_privilege('anon',
       'public.fn_app_error_log(text, text, text, integer, text, text, text, text[], uuid)', 'EXECUTE') then
    fouten := fouten || '  - anon mag fn_app_error_log uitvoeren (gate H breekt)' || chr(10);
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'fn_app_error_log'
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
  ) then
    fouten := fouten || '  - fn_app_error_log mist een gepind search_path (gate E breekt)' || chr(10);
  end if;

  -- 6d. POSITIEVE controle: service_role moet er wél bij kunnen. Zonder deze
  --     controle is de deny-by-default alleen negatief bewezen en zou een
  --     strakkere default-ACL de monitoring stil laten falen.
  foreach t in array array['app_errors','platform_signal_snapshots','platform_signaal_config']
  loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then
      fouten := fouten || format('  - service_role kan %s niet lezen (monitoring zou stil falen)%s', t, chr(10));
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.app_errors', 'INSERT')
     or not has_table_privilege('service_role', 'public.app_errors', 'DELETE') then
    fouten := fouten || '  - service_role kan niet schrijven of opschonen in app_errors' || chr(10);
  end if;
  if not has_table_privilege('service_role', 'public.platform_signal_snapshots', 'INSERT')
     or not has_table_privilege('service_role', 'public.platform_signal_snapshots', 'DELETE') then
    fouten := fouten || '  - service_role kan niet schrijven of opschonen in platform_signal_snapshots' || chr(10);
  end if;

  -- 6e. De acht signalen staan in de config.
  select count(*) into n_signalen from public.platform_signaal_config;
  if n_signalen < 8 then
    fouten := fouten || format('  - platform_signaal_config bevat %s rijen (verwacht >= 8)%s', n_signalen, chr(10));
  end if;

  if fouten <> '' then
    raise exception E'P5-MIGRATIE FAALT:\n%', fouten;
  end if;
  raise notice 'P5 OK: drie tabellen deny-by-default, fn_app_error_log afgeschermd, % signalen geconfigureerd.', n_signalen;
end $$;

commit;

-- ============================================================================
--  Verificatie ná de migratie (handmatig)
-- ============================================================================
-- 1. Deny-by-default bevestigen:
--      select tablename, rowsecurity from pg_tables
--       where schemaname='public'
--         and tablename in ('app_errors','platform_signal_snapshots','platform_signaal_config');
--      select * from pg_policies
--       where schemaname='public'
--         and tablename in ('app_errors','platform_signal_snapshots','platform_signaal_config');
--    → rowsecurity = true op alle drie; nul policies.
--
-- 2. Configuratie:
--      select signaal, interval_minuten, drempel_oranje, drempel_rood, n_drempel
--        from public.platform_signaal_config order by interval_minuten, signaal;
--
-- 3. Schrijfpad roken (als ingelogde gebruiker via de app, niet hier):
--      select public.fn_app_error_log('handmatig.test','validatie','laag');
--      select tijdstip, fonds_id, label, categorie, severity from public.app_errors
--       order by tijdstip desc limit 5;
--
-- 4. Draai daarna de volledige gate-set:
--      supabase/checks/2026_07_31_r1_structurele_gates.sql
--    → verwacht schoon op A1, A2, B, C, C2, E, F, G, H en D.
--      (platform_signaal_config is in dezelfde wijziging aan de globaal-array
--       toegevoegd; zonder die aanpassing faalt A1 terecht.)
--
-- 5. En de gedragscheck van deze tranche:
--      supabase/checks/2026_08_03_p5_monitoring.sql
