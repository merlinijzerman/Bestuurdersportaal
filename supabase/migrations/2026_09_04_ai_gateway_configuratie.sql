-- ============================================================================
--  AI-gateway — configuratielaag per fonds (M365 fase 2B, issue #311, tranche T2)
-- ----------------------------------------------------------------------------
--  WAAROM
--    Besluit 0208 maakt de AI-provider een afzonderlijke configuratiedimensie per
--    fonds. Tot nu toe zijn provider en model code-constanten. Deze migratie
--    levert de server-side bron van waarheid: per fonds en per TAAKGROEP welk
--    goedgekeurd platform- of fondsprofiel en welk model gelden.
--
--  WAT WEL
--    * privaat schema ai_gateway_private met vijf tabellen:
--        provider_profiel        — platform- of fondsgebonden profiel; alleen een
--                                  secret-/endpoint-REFERENTIE (sleutelnaam), nooit
--                                  een key of URL;
--        taakgroep_default       — productbeleid-default per taakgroep (bron voor
--                                  nieuwe fondsen); uitsluitend platformprofielen;
--        fonds_configuratie      — de fondsconfiguratie zelf (fonds × taakgroep);
--        fonds_configuratie_log  — append-only wijzigingslog;
--        gateway_log             — append-only, inhoudsvrije auditregel per
--                                  providercall (provider, model, versie, usage,
--                                  resultaatcategorie, correlatie-id);
--    * drie SECURITY DEFINER-functies die UITSLUITEND de aparte minimale loginrol
--      ai_gateway mag uitvoeren (patroon microsoft_vault, fase 1):
--        lees_config, schrijf_log, lees_log_platform;
--    * profiel-eigenaarschap: een fonds kan alleen een platformprofiel of zijn
--      EIGEN profiel selecteren (trigger + leescontrole);
--    * deterministische backfill: elk bestaand fonds krijgt vier rijen op het
--      huidige platform-Anthropicprofiel met het huidige model per taakgroep —
--      geen wijziging van model, temperatuur, tokenlimiet of streaming;
--    * AFTER INSERT-trigger op public.fondsen: elk nieuw fonds krijgt de vier
--      rijen transactioneel; ontbreekt of faalt een default, dan FAALT de
--      fondscreatie (geen stille fallback).
--
--  WAT NIET
--    * geen browser-bereikbare functie: anon, authenticated én service_role hebben
--      nul rechten in dit schema; tenantroutes blijven op de RLS-client;
--    * geen koppeling met een klant-eigen provider (fase 3); geen beheer-UI (#317);
--    * geen wijziging aan ai_model_allowlist, kill switch of quota (0180-laag).
--
--  RLS-IMPACT   deny-by-default op alle vijf tabellen (RLS aan, geen policies,
--               alle rechten gerevoked). Alleen de functies raken de tabellen.
--  GATE-IMPACT  publiek: één nieuwe triggerfunctie zonder enige execute-grant
--               (gate H, V3-allowlist). Privaat schema valt buiten A1/B/V3-scope;
--               de eigen suite supabase/checks/2026_09_04_ai_gateway.sql toetst het.
--  VOLGORDE     1. rol ai_gateway provisionen (security/AI-GATEWAY-RUNBOOK.md);
--               2. deze migratie; 3. de suite; 4. pas daarna de T3-code-deploy.
--               Code zonder tabellen faalt gesloten (config_ontbreekt); tabellen
--               zonder code zijn inert.
--  IDEMPOTENT   create … if not exists / or replace / drop trigger if exists /
--               on conflict do nothing. Meermaals draaien is veilig.
--  ROLLBACK     ../rollbacks/2026_09_04_ai_gateway_configuratie_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 0. Rol-grendel: zonder de minimale loginrol geen migratie ─────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_gateway') then
    raise exception 'ai_gateway-login ontbreekt; provision deze volgens security/AI-GATEWAY-RUNBOOK.md vóór de migratie';
  end if;
end $$;

-- ── 1. Schema ─────────────────────────────────────────────────────────────────
create schema if not exists ai_gateway_private;
revoke all on schema ai_gateway_private from public, anon, authenticated, service_role;

-- ── 2. Tabellen ───────────────────────────────────────────────────────────────

-- 2a. Providerprofiel. `eigenaar_fonds_id` NULL = platformprofiel; anders het
--     fonds waarvan het profiel is (toekomstige klant-eigen Azure/Copilot).
--     secret_ref/endpoint_ref zijn SLEUTELNAMEN die de server via een code-
--     allowlist naar omgevingsvariabelen vertaalt; er staat hier nooit een key
--     of URL (SSRF/lekrisico).
create table if not exists ai_gateway_private.provider_profiel (
  id                text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  eigenaar_fonds_id uuid references public.fondsen(id) on delete cascade,
  provider          text not null check (provider in ('anthropic','openai','mistral')),
  secret_ref        text not null check (secret_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  endpoint_ref      text check (endpoint_ref is null or endpoint_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  actief            boolean not null default true,
  versie            integer not null default 1,
  bijgewerkt        timestamptz not null default now(),
  bijgewerkt_door   uuid,
  reden             text
);
create index if not exists provider_profiel_eigenaar_idx
  on ai_gateway_private.provider_profiel (eigenaar_fonds_id);

-- 2b. Productbeleid-default per taakgroep — de bron voor nieuwe fondsen.
create table if not exists ai_gateway_private.taakgroep_default (
  taakgroep       text primary key
                  check (taakgroep in ('generatie','hulp_sterk','concept','hulp_snel')),
  profiel_id      text not null references ai_gateway_private.provider_profiel(id),
  provider        text not null,
  model           text not null,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid,
  reden           text,
  foreign key (provider, model) references public.ai_model_allowlist(provider, model)
);

-- 2c. De fondsconfiguratie: fonds × taakgroep → profiel + model.
create table if not exists ai_gateway_private.fonds_configuratie (
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  taakgroep       text not null
                  check (taakgroep in ('generatie','hulp_sterk','concept','hulp_snel')),
  profiel_id      text not null references ai_gateway_private.provider_profiel(id),
  provider        text not null,
  model           text not null,
  actief          boolean not null default true,
  versie          integer not null default 1,
  geldig_vanaf    timestamptz not null default now(),
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid,
  reden           text,
  primary key (fonds_id, taakgroep),
  foreign key (provider, model) references public.ai_model_allowlist(provider, model)
);

-- 2d. Append-only wijzigingslog van de fondsconfiguratie.
create table if not exists ai_gateway_private.fonds_configuratie_log (
  id              uuid primary key default gen_random_uuid(),
  fonds_id        uuid not null,
  taakgroep       text not null,
  actie           text not null check (actie in ('insert','update','delete')),
  oud             jsonb,
  nieuw           jsonb,
  versie          integer,
  gewijzigd_op    timestamptz not null default now(),
  gewijzigd_door  uuid,
  reden           text
);
create index if not exists fonds_configuratie_log_fonds_idx
  on ai_gateway_private.fonds_configuratie_log (fonds_id, gewijzigd_op desc);

-- 2e. Append-only, inhoudsvrije auditregel per providercall.
--     Geen prompt, geen documentinhoud, geen secrets, geen providerrespons.
create table if not exists ai_gateway_private.gateway_log (
  id                   uuid primary key default gen_random_uuid(),
  aangemaakt           timestamptz not null default now(),
  fonds_id             uuid,                                   -- NULL bij platformbrede taken (AQLab)
  actor_soort          text not null check (actor_soort in ('gebruiker','systeem')),
  actor_id             uuid,
  proces               text check (proces is null or length(proces) between 2 and 64),
  taaktype             text not null check (taaktype ~ '^[a-z][a-z0-9_]{2,63}$'),
  taakgroep            text check (taakgroep is null or taakgroep in ('generatie','hulp_sterk','concept','hulp_snel')),
  modaliteit           text not null default 'tekst' check (modaliteit in ('tekst','embedding','ocr')),
  provider             text not null check (provider in ('anthropic','openai','mistral')),
  model                text not null check (length(btrim(model)) > 0),
  profiel_id           text,
  config_versie        integer,
  poort_config_versie  bigint,
  resultaat            text not null check (resultaat in
                         ('ok','configuratiefout','poort_gesloten','providerfout','timeout','rate_limit','geannuleerd')),
  stop_reden           text check (stop_reden is null or stop_reden in ('einde','max_tokens','stop_sequence','tool','onbekend')),
  latency_ms           integer check (latency_ms is null or latency_ms >= 0),
  tokens_in            integer not null default 0 check (tokens_in >= 0),
  tokens_out           integer not null default 0 check (tokens_out >= 0),
  tokens_cache_lezen   integer not null default 0 check (tokens_cache_lezen >= 0),
  tokens_cache_creatie integer not null default 0 check (tokens_cache_creatie >= 0),
  tokens_totaal        integer not null default 0 check (tokens_totaal >= 0),
  correlatie_id        text not null check (length(correlatie_id) between 8 and 128),
  actie_id             uuid,
  label                text check (label is null or length(label) <= 80),
  constraint chk_gateway_log_actor check (
    (actor_soort = 'gebruiker' and actor_id is not null)
    or (actor_soort = 'systeem' and proces is not null)
  )
);
create index if not exists gateway_log_fonds_idx
  on ai_gateway_private.gateway_log (fonds_id, aangemaakt desc);
create index if not exists gateway_log_correlatie_idx
  on ai_gateway_private.gateway_log (correlatie_id);

-- ── 3. RLS aan (deny-by-default), alle rechten weg ───────────────────────────
alter table ai_gateway_private.provider_profiel        enable row level security;
alter table ai_gateway_private.taakgroep_default       enable row level security;
alter table ai_gateway_private.fonds_configuratie      enable row level security;
alter table ai_gateway_private.fonds_configuratie_log  enable row level security;
alter table ai_gateway_private.gateway_log             enable row level security;

revoke all on all tables    in schema ai_gateway_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema ai_gateway_private from public, anon, authenticated, service_role;
revoke all on all functions in schema ai_gateway_private from public, anon, authenticated, service_role;
alter default privileges in schema ai_gateway_private revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges in schema ai_gateway_private revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema ai_gateway_private revoke all on functions from public, anon, authenticated, service_role;

-- ── 4. Triggerfuncties (privaat; draaien onder de eigenaar) ──────────────────

-- 4a. Append-only.
create or replace function ai_gateway_private.tg_append_only()
returns trigger
language plpgsql
set search_path = ai_gateway_private, pg_temp
as $$
begin
  raise exception 'ai_gateway_private.% is append-only (geen UPDATE/DELETE toegestaan)', tg_table_name;
end;
$$;

-- 4b. Bewaakt de fondsconfiguratie: profiel bestaat en is actief, provider is
--     consistent, eigenaarschap klopt (platform óf dit fonds), versie/bijgewerkt
--     bij update, en een update zonder reden is niet auditbaar.
create or replace function ai_gateway_private.tg_bewaak_fonds_configuratie()
returns trigger
language plpgsql
set search_path = ai_gateway_private, public, pg_temp
as $$
declare
  v_profiel ai_gateway_private.provider_profiel%rowtype;
begin
  select * into v_profiel from ai_gateway_private.provider_profiel where id = new.profiel_id;
  if not found then
    raise exception 'AI-gateway: profiel % bestaat niet', new.profiel_id;
  end if;
  if not v_profiel.actief then
    raise exception 'AI-gateway: profiel % is inactief', new.profiel_id;
  end if;
  if v_profiel.provider <> new.provider then
    raise exception 'AI-gateway: provider % wijkt af van profiel % (%)', new.provider, new.profiel_id, v_profiel.provider;
  end if;
  if v_profiel.eigenaar_fonds_id is not null and v_profiel.eigenaar_fonds_id <> new.fonds_id then
    raise exception 'AI-gateway: profiel % is van een ander fonds en mag niet aan fonds % worden gekoppeld', new.profiel_id, new.fonds_id;
  end if;
  if tg_op = 'UPDATE' then
    if new.fonds_id <> old.fonds_id or new.taakgroep <> old.taakgroep then
      raise exception 'AI-gateway: fonds_id/taakgroep van een configuratieregel zijn onveranderlijk';
    end if;
    if length(btrim(coalesce(new.reden, ''))) < 10 then
      raise exception 'AI-gateway: een configuratiewijziging vereist een reden (>= 10 tekens)';
    end if;
    new.versie := old.versie + 1;
    new.bijgewerkt := now();
  end if;
  return new;
end;
$$;

-- 4c. Bewaakt de defaulttabel: uitsluitend ACTIEVE PLATFORMprofielen, provider
--     consistent. Een klantprofiel kan zo nooit de default voor nieuwe fondsen worden.
create or replace function ai_gateway_private.tg_bewaak_taakgroep_default()
returns trigger
language plpgsql
set search_path = ai_gateway_private, public, pg_temp
as $$
declare
  v_profiel ai_gateway_private.provider_profiel%rowtype;
begin
  select * into v_profiel from ai_gateway_private.provider_profiel where id = new.profiel_id;
  if not found or not v_profiel.actief then
    raise exception 'AI-gateway: default verwijst naar onbekend of inactief profiel %', new.profiel_id;
  end if;
  if v_profiel.eigenaar_fonds_id is not null then
    raise exception 'AI-gateway: default mag alleen naar een platformprofiel verwijzen (% is fondsgebonden)', new.profiel_id;
  end if;
  if v_profiel.provider <> new.provider then
    raise exception 'AI-gateway: provider % wijkt af van profiel % (%)', new.provider, new.profiel_id, v_profiel.provider;
  end if;
  if tg_op = 'UPDATE' then
    new.versie := old.versie + 1;
    new.bijgewerkt := now();
  end if;
  return new;
end;
$$;

-- 4d. Logt elke wijziging van de fondsconfiguratie (append-only spoor).
create or replace function ai_gateway_private.tg_log_fonds_configuratie()
returns trigger
language plpgsql
set search_path = ai_gateway_private, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    insert into ai_gateway_private.fonds_configuratie_log
      (fonds_id, taakgroep, actie, oud, nieuw, versie, gewijzigd_door, reden)
    values (old.fonds_id, old.taakgroep, 'delete', to_jsonb(old), null, old.versie, old.bijgewerkt_door, old.reden);
    return old;
  end if;
  insert into ai_gateway_private.fonds_configuratie_log
    (fonds_id, taakgroep, actie, oud, nieuw, versie, gewijzigd_door, reden)
  values (
    new.fonds_id, new.taakgroep, lower(tg_op),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), new.versie, new.bijgewerkt_door, new.reden
  );
  return new;
end;
$$;

revoke all on function ai_gateway_private.tg_append_only()                from public, anon, authenticated, service_role;
revoke all on function ai_gateway_private.tg_bewaak_fonds_configuratie()  from public, anon, authenticated, service_role;
revoke all on function ai_gateway_private.tg_bewaak_taakgroep_default()   from public, anon, authenticated, service_role;
revoke all on function ai_gateway_private.tg_log_fonds_configuratie()     from public, anon, authenticated, service_role;

drop trigger if exists trg_fonds_configuratie_bewaak on ai_gateway_private.fonds_configuratie;
create trigger trg_fonds_configuratie_bewaak
  before insert or update on ai_gateway_private.fonds_configuratie
  for each row execute function ai_gateway_private.tg_bewaak_fonds_configuratie();

drop trigger if exists trg_fonds_configuratie_log on ai_gateway_private.fonds_configuratie;
create trigger trg_fonds_configuratie_log
  after insert or update or delete on ai_gateway_private.fonds_configuratie
  for each row execute function ai_gateway_private.tg_log_fonds_configuratie();

drop trigger if exists trg_taakgroep_default_bewaak on ai_gateway_private.taakgroep_default;
create trigger trg_taakgroep_default_bewaak
  before insert or update on ai_gateway_private.taakgroep_default
  for each row execute function ai_gateway_private.tg_bewaak_taakgroep_default();

drop trigger if exists trg_fonds_configuratie_log_append_only on ai_gateway_private.fonds_configuratie_log;
create trigger trg_fonds_configuratie_log_append_only
  before update or delete on ai_gateway_private.fonds_configuratie_log
  for each row execute function ai_gateway_private.tg_append_only();

drop trigger if exists trg_gateway_log_append_only on ai_gateway_private.gateway_log;
create trigger trg_gateway_log_append_only
  before update or delete on ai_gateway_private.gateway_log
  for each row execute function ai_gateway_private.tg_append_only();

-- ── 5. Nieuwe fondsen: vier expliciete rijen, transactioneel, fail-closed ────
--  SECURITY DEFINER omdat de insert in public.fondsen door service_role/postgres
--  gebeurt en die rollen bewust géén rechten in het private schema hebben.
--  Reviewbesluit R6: ontbrekende of ongeldige defaults laten de fondscreatie
--  FALEN; er is geen stille fallback.
create or replace function public.fn_fonds_ai_configuratie_standaard()
returns trigger
language plpgsql
security definer
set search_path = ai_gateway_private, public, pg_temp
as $$
declare
  v_aantal integer;
begin
  insert into ai_gateway_private.fonds_configuratie
    (fonds_id, taakgroep, profiel_id, provider, model, reden)
  select new.id, d.taakgroep, d.profiel_id, d.provider, d.model,
         'Standaardconfiguratie bij fondscreatie (#311 T2)'
    from ai_gateway_private.taakgroep_default d
    join ai_gateway_private.provider_profiel p on p.id = d.profiel_id and p.actief;
  get diagnostics v_aantal = row_count;
  if v_aantal <> 4 then
    raise exception 'AI-gateway: standaardconfiguratie onvolledig voor nieuw fonds % (% van 4 taakgroepen); fondscreatie geweigerd', new.id, v_aantal;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_fonds_ai_configuratie_standaard() from public, anon, authenticated, service_role;

drop trigger if exists trg_fonds_ai_configuratie_standaard on public.fondsen;
create trigger trg_fonds_ai_configuratie_standaard
  after insert on public.fondsen
  for each row execute function public.fn_fonds_ai_configuratie_standaard();

-- ── 6. Functies voor de gateway-rol ──────────────────────────────────────────

-- 6a. Configuratieresolutie. Het fonds-id komt van de SERVER (sessiecontext via
--     withFondsRoute, of de job-rij), nooit van de browser. Fail-closed: elke
--     onvolledige of inconsistente toestand geeft {ok:false, reden}.
create or replace function ai_gateway_private.lees_config(p_fonds_id uuid, p_taakgroep text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ai_gateway_private, public, pg_temp
as $$
declare
  v_cfg     ai_gateway_private.fonds_configuratie%rowtype;
  v_profiel ai_gateway_private.provider_profiel%rowtype;
  v_allow   public.ai_model_allowlist%rowtype;
begin
  if p_fonds_id is null then
    return jsonb_build_object('ok', false, 'reden', 'fonds_ontbreekt');
  end if;
  if p_taakgroep is null or p_taakgroep not in ('generatie','hulp_sterk','concept','hulp_snel') then
    return jsonb_build_object('ok', false, 'reden', 'taakgroep_onbekend');
  end if;

  select * into v_cfg from ai_gateway_private.fonds_configuratie
   where fonds_id = p_fonds_id and taakgroep = p_taakgroep;
  if not found then
    return jsonb_build_object('ok', false, 'reden', 'config_ontbreekt');
  end if;
  if not v_cfg.actief then
    return jsonb_build_object('ok', false, 'reden', 'config_inactief', 'versie', v_cfg.versie);
  end if;

  select * into v_profiel from ai_gateway_private.provider_profiel where id = v_cfg.profiel_id;
  if not found or not v_profiel.actief then
    return jsonb_build_object('ok', false, 'reden', 'profiel_inactief', 'versie', v_cfg.versie);
  end if;
  if v_profiel.eigenaar_fonds_id is not null and v_profiel.eigenaar_fonds_id <> p_fonds_id then
    return jsonb_build_object('ok', false, 'reden', 'profiel_niet_van_fonds', 'versie', v_cfg.versie);
  end if;
  if v_profiel.provider <> v_cfg.provider then
    return jsonb_build_object('ok', false, 'reden', 'provider_inconsistent', 'versie', v_cfg.versie);
  end if;

  -- Defense-in-depth: de live poort (fn_ai_poort_check) toetst dit óók vlak vóór
  -- de call; hier stopt een verwijderde of gedeactiveerde allowlistregel al eerder.
  select * into v_allow from public.ai_model_allowlist
   where provider = v_cfg.provider and model = v_cfg.model;
  if not found or not v_allow.actief then
    return jsonb_build_object('ok', false, 'reden', 'model_niet_toegestaan', 'versie', v_cfg.versie);
  end if;

  return jsonb_build_object(
    'ok', true,
    'profiel_id', v_profiel.id,
    'profiel_versie', v_profiel.versie,
    'eigenaar_fonds_id', v_profiel.eigenaar_fonds_id,
    'provider', v_cfg.provider,
    'model', v_cfg.model,
    'secret_ref', v_profiel.secret_ref,
    'endpoint_ref', v_profiel.endpoint_ref,
    'versie', v_cfg.versie,
    'geldig_vanaf', v_cfg.geldig_vanaf
  );
end;
$$;

-- 6b. Auditregel per providercall. De gateway levert fonds en actor uit dezelfde
--     servercontext als bij lees_config. Strikte extractie; de CHECK-constraints
--     op de tabel doen de rest. Retourneert het id van de regel.
create or replace function ai_gateway_private.schrijf_log(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ai_gateway_private, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'AI-gateway: schrijf_log verwacht een jsonb-object';
  end if;
  insert into ai_gateway_private.gateway_log (
    fonds_id, actor_soort, actor_id, proces, taaktype, taakgroep, modaliteit,
    provider, model, profiel_id, config_versie, poort_config_versie,
    resultaat, stop_reden, latency_ms,
    tokens_in, tokens_out, tokens_cache_lezen, tokens_cache_creatie, tokens_totaal,
    correlatie_id, actie_id, label
  ) values (
    nullif(p->>'fonds_id','')::uuid,
    p->>'actor_soort',
    nullif(p->>'actor_id','')::uuid,
    nullif(p->>'proces',''),
    p->>'taaktype',
    nullif(p->>'taakgroep',''),
    coalesce(nullif(p->>'modaliteit',''), 'tekst'),
    p->>'provider',
    p->>'model',
    nullif(p->>'profiel_id',''),
    nullif(p->>'config_versie','')::integer,
    nullif(p->>'poort_config_versie','')::bigint,
    p->>'resultaat',
    nullif(p->>'stop_reden',''),
    nullif(p->>'latency_ms','')::integer,
    coalesce(nullif(p->>'tokens_in','')::integer, 0),
    coalesce(nullif(p->>'tokens_out','')::integer, 0),
    coalesce(nullif(p->>'tokens_cache_lezen','')::integer, 0),
    coalesce(nullif(p->>'tokens_cache_creatie','')::integer, 0),
    coalesce(nullif(p->>'tokens_totaal','')::integer, 0),
    p->>'correlatie_id',
    nullif(p->>'actie_id','')::uuid,
    nullif(p->>'label','')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- 6c. Leespad voor de platformlaag (beheerscherm #317); nooit voor tenantsessies.
create or replace function ai_gateway_private.lees_log_platform(p_fonds_id uuid, p_limiet integer default 100)
returns setof ai_gateway_private.gateway_log
language sql
stable
security definer
set search_path = ai_gateway_private, public, pg_temp
as $$
  select * from ai_gateway_private.gateway_log
   where (p_fonds_id is null or fonds_id = p_fonds_id)
   order by aangemaakt desc
   limit greatest(1, least(coalesce(p_limiet, 100), 500));
$$;

revoke all on function ai_gateway_private.lees_config(uuid, text)               from public, anon, authenticated, service_role;
revoke all on function ai_gateway_private.schrijf_log(jsonb)                     from public, anon, authenticated, service_role;
revoke all on function ai_gateway_private.lees_log_platform(uuid, integer)       from public, anon, authenticated, service_role;

grant usage on schema ai_gateway_private to ai_gateway;
grant execute on function ai_gateway_private.lees_config(uuid, text)          to ai_gateway;
grant execute on function ai_gateway_private.schrijf_log(jsonb)                to ai_gateway;
grant execute on function ai_gateway_private.lees_log_platform(uuid, integer)  to ai_gateway;

comment on function ai_gateway_private.lees_config(uuid, text) is
  'AI-gateway (#311): server-side configuratieresolutie per fonds × taakgroep. Alleen uitvoerbaar door de loginrol ai_gateway; fail-closed bij elke onvolledige of inconsistente toestand.';
comment on function ai_gateway_private.schrijf_log(jsonb) is
  'AI-gateway (#311): append-only, inhoudsvrije auditregel per providercall. Alleen uitvoerbaar door ai_gateway.';
comment on function ai_gateway_private.lees_log_platform(uuid, integer) is
  'AI-gateway (#311): leespad voor de platformlaag (beheerscherm #317). Alleen uitvoerbaar door ai_gateway.';

-- ── 7. Seed: platformprofielen en productbeleid-defaults ─────────────────────
--  De secret_ref/endpoint_ref zijn sleutelnamen; de code-allowlist in de gateway
--  bepaalt welke namen bestaan. Het huidige productiepad is Anthropic.
insert into ai_gateway_private.provider_profiel (id, eigenaar_fonds_id, provider, secret_ref, endpoint_ref, reden) values
  ('platform-anthropic', null, 'anthropic', 'ANTHROPIC_API_KEY', null,
   'Platformprofiel; het bestaande productiepad (#311 T2).'),
  ('platform-openai',    null, 'openai',    'OPENAI_API_KEY',    'OPENAI_BASE_URL',
   'Platformprofiel voor AQLab-challengers; kill switch openai staat standaard uit (0180).'),
  ('platform-mistral',   null, 'mistral',   'MISTRAL_API_KEY',   'MISTRAL_CHAT_URL',
   'Platformprofiel voor AQLab-challengers (chat); embeddings/OCR blijven op de 0180-poort.')
on conflict (id) do nothing;

insert into ai_gateway_private.taakgroep_default (taakgroep, profiel_id, provider, model, reden) values
  ('generatie',  'platform-anthropic', 'anthropic', 'claude-opus-4-8',
   'Huidig AI_MODEL-default (chat_generatie, vergelijk_waarde); Vercel heeft geen AI_MODEL-override (reviewbesluit R2).'),
  ('hulp_sterk', 'platform-anthropic', 'anthropic', 'claude-sonnet-4-6',
   'Huidig REWRITE_MODEL (chat_contextresolutie, chat_reformulatie).'),
  ('concept',    'platform-anthropic', 'anthropic', 'claude-sonnet-4-5',
   'Huidig SAMENVATTING_/AFSCHRIFT_AI_/BESLUIT_MODEL (samenvatting, afschrift_concept, besluit_concept).'),
  ('hulp_snel',  'platform-anthropic', 'anthropic', 'claude-haiku-4-5-20251001',
   'Huidig HAIKU_MODEL (vraagrouter, mapstap, rerank, vergelijk_dimensies, context_prefix, semantische_extractie).')
on conflict (taakgroep) do nothing;

-- ── 8. Backfill: elk bestaand fonds expliciet op het huidige profiel/model ───
insert into ai_gateway_private.fonds_configuratie (fonds_id, taakgroep, profiel_id, provider, model, reden)
select f.id, d.taakgroep, d.profiel_id, d.provider, d.model,
       'Backfill #311 T2: huidig platform-Anthropicprofiel en huidig model; geen gedragswijziging.'
  from public.fondsen f
 cross join ai_gateway_private.taakgroep_default d
on conflict (fonds_id, taakgroep) do nothing;

-- ── 9. Eindcontrole — toets de UITKOMST, niet de intentie ────────────────────
do $$
declare
  fouten text := '';
  v_n integer;
begin
  -- 9a. Vier rijen per fonds, allemaal actief.
  if exists (
    select 1 from public.fondsen f
    where (select count(*) from ai_gateway_private.fonds_configuratie c
            where c.fonds_id = f.id and c.actief) <> 4
  ) then
    fouten := fouten || E'\n- niet ieder fonds heeft exact vier actieve configuratieregels';
  end if;
  -- 9b. Vier defaults op actieve platformprofielen.
  select count(*) into v_n
    from ai_gateway_private.taakgroep_default d
    join ai_gateway_private.provider_profiel p on p.id = d.profiel_id
   where p.actief and p.eigenaar_fonds_id is null;
  if v_n <> 4 then
    fouten := fouten || format(E'\n- verwacht 4 defaults op actieve platformprofielen, gevonden %s', v_n);
  end if;
  -- 9c. Browser- en service-rollen: nul toegang tot het schema.
  if has_schema_privilege('anon', 'ai_gateway_private', 'USAGE')
     or has_schema_privilege('authenticated', 'ai_gateway_private', 'USAGE')
     or has_schema_privilege('service_role', 'ai_gateway_private', 'USAGE') then
    fouten := fouten || E'\n- anon/authenticated/service_role heeft USAGE op ai_gateway_private';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ai_gateway_private'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) then
    fouten := fouten || E'\n- een browser- of servicerol kan een functie in ai_gateway_private uitvoeren';
  end if;
  -- 9d. De gateway-rol: exact drie executes, nul tabelrechten.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ai_gateway_private' and has_function_privilege('ai_gateway', p.oid, 'EXECUTE');
  if v_n <> 3 then
    fouten := fouten || format(E'\n- ai_gateway mag exact 3 functies uitvoeren, gevonden %s', v_n);
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ai_gateway_private' and c.relkind in ('r','p','v','m','S','f')
      and has_table_privilege('ai_gateway', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) then
    fouten := fouten || E'\n- ai_gateway heeft directe tabelrechten in ai_gateway_private';
  end if;
  -- 9e. De publieke triggerfunctie is voor niemand uitvoerbaar (gate H).
  if has_function_privilege('anon', 'public.fn_fonds_ai_configuratie_standaard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_fonds_ai_configuratie_standaard()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.fn_fonds_ai_configuratie_standaard()', 'EXECUTE') then
    fouten := fouten || E'\n- fn_fonds_ai_configuratie_standaard is uitvoerbaar door een applicatierol';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_fonds_ai_configuratie_standaard' and not tgisinternal) then
    fouten := fouten || E'\n- trigger trg_fonds_ai_configuratie_standaard ontbreekt';
  end if;

  if fouten <> '' then
    raise exception E'AI-gateway T2 FAALT — transactie teruggedraaid:%', fouten;
  end if;
  raise notice 'AI-gateway T2 OK: privaat schema, 3 gateway-functies, backfill volledig, nul browser-/servicetoegang.';
end $$;

commit;
