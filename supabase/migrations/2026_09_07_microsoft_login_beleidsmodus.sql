-- ============================================================================
--  Microsoft-login fase 1C — organisatiebreed loginbeleid, beheerde ontkoppeling,
--  break-glass en beperkte koppel-/herstelsessie (#344, PR-A; besluit 0212).
-- ----------------------------------------------------------------------------
--  WAAROM
--    Fase 1B (#335, besluit 0211) bindt een Microsoft-identiteit persoonlijk op
--    fonds_id + user_id + tid + oid en kent één binaire fondsvlag (`actief`). De
--    beleidskeuze — is Microsoft-login beschikbaar, optioneel of verplicht — hoort
--    bij de ORGANISATIE, niet bij het persoonlijke profiel. Deze migratie voegt de
--    getypeerde modus toe, verplaatst de regie over verplichte koppelingen naar
--    bevoegd fondsbeheer, en levert de twee herstelpaden die `verplicht` pas
--    verantwoord maken: een MFA-beveiligd break-glassaccount en een beperkte
--    koppel-/herstelsessie per gebruiker.
--
--  MODI (public.fonds_microsoft_login.modus)
--    uit        — Microsoft-login niet beschikbaar; bestaande bindingen blijven
--                 staan maar geven geen tokenuitgifte meer (hook, ongewijzigd).
--    optioneel  — wachtwoord én Microsoft; persoonlijk koppelen/ontkoppelen mag.
--    verplicht  — normale fondsgebruikers melden uitsluitend met hun gekoppelde
--                 Microsoft-identiteit aan. Het wachtwoordpad is voor hen DICHT —
--                 afgedwongen in de Auth-hook, dus ook bij een rechtstreekse
--                 GoTrue-aanroep buiten de app om. Zelf ontkoppelen mag niet.
--
--  `modus` IS DE SEMANTISCHE BRON. `actief` blijft als compatibiliteitskolom staan
--  (hookhelper, kolomgrants, policies en de F1B-suite steunen erop) en kan niet
--  afwijken: `check (actief = (modus <> 'uit'))`. Een opruimmigratie verwijdert
--  `actief` zodra alle code uitsluitend `modus` leest.
--
--  TWEE UITZONDERINGEN OP HET GESLOTEN WACHTWOORDPAD (beide privé en geaudit)
--    * login_private.break_glass — minimaal, expliciet, NIET zelf toe te kennen
--      (`check (user_id <> uitgegeven_door)`) en pas werkzaam met een
--      GEVERIFIEERDE MFA-factor: de hook leest auth.mfa_factors zelf (hij draait
--      als supabase_auth_admin) en geeft dat als argument aan de helper.
--      De AANWIJZING is DUURZAAM (geldig tot intrekking): een noodpad dat na een
--      week vanzelf verdampt is bij een Entra-storing juist géén noodpad meer
--      (reviewbevinding 4). Wat kort is, zijn de ACTIVERINGSVENSTERS: elke
--      verhoging naar de normale rol opent een venster van een uur in
--      login_private.break_glass_activeringen en levert één audit-gebeurtenis
--      `breakglass.gebruikt`. `herzien_voor` draagt de verloopbewaking: de
--      aanwijzing blijft werken, maar preflight en beheeroverzicht melden dat
--      zij herzien moet worden.
--    * login_private.herkoppel_uitnodigingen — de beperkte koppel-/herstelsessie.
--      Het token authenticeert NIET: het identificeert het vooraf door de
--      beheerder geselecteerde portaalaccount en opent voor ten hoogste één kort
--      venster het koppelpad. De gebruiker heeft daarnaast zijn bestaande
--      wachtwoord nodig. Alleen sha256(token) wordt bewaard; het token zelf staat
--      nergens in de database of het log. Eenmalig, intrekbaar, gebonden aan
--      fonds, gebruiker, tenant en doel; het venster sluit onmiddellijk zodra
--      tid+oid actief gekoppeld is (activeer_identiteit/herstel_koppeling).
--
--  DRIE UITGIFTENIVEAUS (login_private.wachtwoordlogin_niveau)
--    'vol'       — het gewone `authenticated`-token; ongewijzigd gedrag.
--    'beperkt'   — hetzelfde token maar met claim `role = portaal_beperkt`: een
--                  rol die NIETS mag behalve de eigen profielrij lezen. Zo bereikt
--                  een break-glasssessie op AAL1 of een koppel-/herstelsessie niet
--                  rechtstreeks PostgREST, Storage of Realtime (reviewbevinding 1).
--                  Pas ná AAL2 (break-glass) of een geldige Microsoft-koppeling
--                  wordt de normale rol uitgegeven.
--    'geweigerd' — 403.
--
--  FAIL-CLOSED-RICHTING (bewust, en aangescherpt na review)
--    Een account ZONDER profielrij (platformidentiteit) valt buiten het
--    fondsbeleid en houdt het gewone wachtwoordpad. Maar een account MÉT profiel
--    in een fonds ZONDER configuratierij is drift — elke fonds krijgt zo'n rij uit
--    de migratie en de trigger — en wordt daarom geweigerd (reviewbevinding 3).
--    Binnen `verplicht` is elke twijfel dicht: alleen een aantoonbaar levende
--    uitzondering geeft toegang, en een fout in het hookpad blijft een 403.
--
--  WAT NIET
--    * geen HTTP-routes en geen UI: die zitten in PR-B (#344);
--    * geen gedeeld Microsoft-account, geen JIT-provisioning, geen SCIM;
--    * geen wijziging aan de Graph-connector (Outlook/SharePoint) — gescheiden
--      vertrouwensdomein (besluit 0211 D7);
--    * geen fonds gaat hier naar `verplicht`: PGB migreert naar `optioneel`.
--
--  RLS-IMPACT   Twee nieuwe private tabellen: RLS aan, alle rechten gerevoked,
--               uitsluitend een select-policy voor login_hook_owner (zelfde,
--               eerlijke `using (true)`-constructie als F1B: de beveiliging rust
--               op de afgeschermde NOLOGIN-eigenaar en het smalle boolean-
--               functiecontract, niet op tenantselectie door RLS).
--  GATE-IMPACT  Publiek verandert alleen public.fonds_microsoft_login (kolom
--               `modus` erbij, `pilotstatus` eraf) en public.fn_access_token_hook;
--               geen nieuwe publieke objecten, dus allowlist-grants.tsv wijzigt
--               niet van vorm. login_private valt buiten V3 en wordt getoetst door
--               supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql.
--               De F1B-suite telt nu 24 gateway-executes (was 14).
--  VOLGORDE     1. rol portaal_beperkt provisionen (security/MICROSOFT-365-F1B-RUNBOOK.md
--               §1C.0); 2. deze migratie; 3. beide suites; 4. code-deploy (PR-A);
--               5. pas daarna een moduswijziging via het beheerpad (PR-B).
--  IDEMPOTENT   create … if not exists / or replace / drop … if exists; de
--               eenmalige backfill draait alleen zolang de spiegelconstraint
--               ontbreekt, zodat een herhaalde run een gezette `verplicht` niet
--               terugzet naar `optioneel`.
--  ROLLBACK     ../rollbacks/2026_09_07_microsoft_login_beleidsmodus_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 0. Grendels ─────────────────────────────────────────────────────────────
do $$
begin
  if to_regnamespace('login_private') is null then
    raise exception 'schema login_private ontbreekt; pas eerst 2026_09_06_microsoft_login_fase1b.sql toe';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'login_gateway' and rolcanlogin) then
    raise exception 'login_gateway-login ontbreekt; provision volgens security/MICROSOFT-365-F1B-RUNBOOK.md';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'login_hook_owner' and not rolcanlogin) then
    raise exception 'login_hook_owner (NOLOGIN) ontbreekt; provision volgens security/MICROSOFT-365-F1B-RUNBOOK.md';
  end if;
  -- De beperkte portaalrol waarnaar de hook een uitzonderingssessie afschaalt.
  -- PostgREST doet `set role <claims.role>`, dus de rol moet bestaan én lid zijn
  -- van authenticator; zonder dat weigert PostgREST het token (fail-closed).
  if not exists (select 1 from pg_roles where rolname = 'portaal_beperkt' and not rolcanlogin) then
    raise exception 'portaal_beperkt (NOLOGIN) ontbreekt; provision volgens security/MICROSOFT-365-F1B-RUNBOOK.md §1C.0';
  end if;
  if not exists (select 1 from pg_auth_members am
                   join pg_roles r on r.oid = am.roleid
                   join pg_roles m on m.oid = am.member
                  where r.rolname = 'portaal_beperkt' and m.rolname = 'authenticator') then
    raise exception 'portaal_beperkt is geen lid van authenticator; PostgREST kan de beperkte rol dan niet aannemen';
  end if;
end $$;

-- ── 1. Getypeerde modus op de fondsconfiguratie ─────────────────────────────
alter table public.fonds_microsoft_login
  add column if not exists modus text not null default 'uit';

-- Eenmalige, deterministische migratie van de binaire vlag: een actief fonds
-- (de PGB Preview-pilot) wordt `optioneel` — gedragsneutraal, want optioneel is
-- exact het huidige gedrag. Alle overige fondsen blijven `uit`. De guard op de
-- spiegelconstraint maakt dit precies één keer effectief.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fonds_microsoft_login_modus_spiegelt_actief') then
    update public.fonds_microsoft_login
       set modus = case when actief then 'optioneel' else 'uit' end;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fonds_microsoft_login_modus_geldig') then
    alter table public.fonds_microsoft_login
      add constraint fonds_microsoft_login_modus_geldig
      check (modus in ('uit','optioneel','verplicht'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fonds_microsoft_login_modus_spiegelt_actief') then
    alter table public.fonds_microsoft_login
      add constraint fonds_microsoft_login_modus_spiegelt_actief
      check (actief = (modus <> 'uit'));
  end if;
end $$;

comment on column public.fonds_microsoft_login.modus is
  '#344: uit | optioneel | verplicht — de semantische bron. actief is de afgeleide compatibiliteitskolom (check actief = (modus <> ''uit'')).';
comment on column public.fonds_microsoft_login.actief is
  '#344: afgeleid van modus; blijft staan voor de hookhelper, kolomgrants en policies uit #335. Verdwijnt in een latere opruimmigratie.';

-- ── 2. Config-lezers en -triggers op modus ──────────────────────────────────
-- lees_config wisselt van retourvorm (pilotstatus → modus): drop + create.
drop function if exists login_private.lees_config(uuid);
create or replace function login_private.lees_config(p_fonds uuid)
returns table(actief boolean, entra_tenant_id text, modus text)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select c.actief, c.entra_tenant_id, c.modus
    from public.fonds_microsoft_login c
   where c.fonds_id = p_fonds
$$;

create or replace function public.fn_fonds_microsoft_login_standaard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.fonds_microsoft_login (fonds_id, actief, modus)
  values (new.id, false, 'uit')
  on conflict (fonds_id) do nothing;
  return new;
end $$;
revoke all on function public.fn_fonds_microsoft_login_standaard() from public, anon, authenticated;

create or replace function public.fn_fonds_microsoft_login_audit() returns trigger
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
begin
  insert into login_private.audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  values (
    coalesce(new.fonds_id, old.fonds_id),
    null,
    case tg_op when 'INSERT' then 'config.aangemaakt' when 'UPDATE' then 'config.gewijzigd' else 'config.verwijderd' end,
    case when tg_op = 'DELETE' then null
         else format('modus=%s;actief=%s;tenant_gezet=%s', new.modus, new.actief::text, (new.entra_tenant_id is not null)::text) end,
    null,
    'txid:' || txid_current()::text
  );
  return coalesce(new, old);
end $$;
revoke all on function public.fn_fonds_microsoft_login_audit() from public, anon, authenticated, service_role;

alter table public.fonds_microsoft_login drop column if exists pilotstatus;

-- ── 3. Break-glass: duurzame aanwijzing + korte activeringsvensters ─────────
-- De AANWIJZING kent geen einddatum: een noodpad dat na een week vanzelf
-- verdwijnt, is bij een Entra-storing geen noodpad (reviewbevinding 4). Zij
-- eindigt door intrekking. `herzien_voor` is de verloopBEWAKING: verstrijkt die
-- datum, dan blijft het pad werken maar melden preflight en beheeroverzicht dat
-- de aanwijzing herzien moet worden.
create table if not exists login_private.break_glass (
  id              uuid primary key default gen_random_uuid(),
  fonds_id        uuid not null references public.fondsen(id),
  user_id         uuid not null references auth.users(id) on delete cascade,
  reden_categorie text not null check (reden_categorie in ('entra_storing','beheerherstel','migratie')),
  uitgegeven_door uuid not null,
  uitgegeven_op   timestamptz not null default now(),
  herzien_voor    timestamptz not null,
  ingetrokken_op  timestamptz,
  ingetrokken_door uuid,
  correlatie_id   text not null,
  -- Niet zelf toe te kennen: de uitgever is nooit de begunstigde.
  constraint break_glass_niet_zelf check (user_id <> uitgegeven_door),
  constraint break_glass_herziening check (herzien_voor > uitgegeven_op)
);
comment on table login_private.break_glass is
  '#344: duurzame noodtoegangsaanwijzing in modus verplicht. Geldig tot intrekking; werkzaam alleen met geverifieerde MFA-factor. herzien_voor draagt de verloopbewaking, niet de geldigheid.';

-- Herhaalbaar over een eerdere toepassing van deze migratie, die de aanwijzing nog
-- als tijdgebonden `geldig_tot` modelleerde. De aanwijzing is nu duurzaam; de
-- datum verhuist naar de bewaking.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='login_private' and table_name='break_glass' and column_name='geldig_tot') then
    alter table login_private.break_glass add column if not exists herzien_voor timestamptz;
    update login_private.break_glass set herzien_voor = coalesce(herzien_voor, uitgegeven_op + interval '90 days');
    alter table login_private.break_glass alter column herzien_voor set not null;
    alter table login_private.break_glass drop column geldig_tot;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'break_glass_herziening') then
    alter table login_private.break_glass
      add constraint break_glass_herziening check (herzien_voor > uitgegeven_op);
  end if;
  alter table login_private.break_glass drop constraint if exists break_glass_geldigheid;
end $$;
create index if not exists break_glass_fonds_idx on login_private.break_glass (fonds_id);
create index if not exists break_glass_user_idx on login_private.break_glass (user_id);
alter table login_private.break_glass enable row level security;
revoke all on login_private.break_glass from public, anon, authenticated, service_role, login_gateway;

-- Elke verhoging naar de normale rol (AAL2) opent hier een kort venster. Het
-- venster begrenst de SESSIE, niet de aanwijzing: het maakt elk gebruik zichtbaar
-- en afdwingbaar aflopend, terwijl het herstelpad zelf blijft bestaan.
create table if not exists login_private.break_glass_activeringen (
  id            uuid primary key default gen_random_uuid(),
  break_glass_id uuid not null references login_private.break_glass(id) on delete cascade,
  fonds_id      uuid not null references public.fondsen(id),
  user_id       uuid not null references auth.users(id) on delete cascade,
  geopend_op    timestamptz not null default now(),
  venster_tot   timestamptz not null,
  correlatie_id text not null,
  constraint break_glass_activering_venster check (venster_tot > geopend_op)
);
comment on table login_private.break_glass_activeringen is
  '#344: kortlopend activeringsvenster per verhoging naar de normale rol; bron voor `breakglass.gebruikt` en voor het aflopen van de verhoogde sessie.';
create index if not exists break_glass_activering_user_idx on login_private.break_glass_activeringen (user_id, venster_tot desc);
alter table login_private.break_glass_activeringen enable row level security;
revoke all on login_private.break_glass_activeringen from public, anon, authenticated, service_role, login_gateway;

-- ── 4. Beperkte koppel-/herstelsessie ───────────────────────────────────────
create table if not exists login_private.herkoppel_uitnodigingen (
  token_hash      text primary key,
  fonds_id        uuid not null references public.fondsen(id),
  user_id         uuid not null references auth.users(id) on delete cascade,
  entra_tenant_id text not null,
  doel            text not null default 'herkoppelen' check (doel in ('herkoppelen')),
  uitgegeven_door uuid not null,
  uitgegeven_op   timestamptz not null default now(),
  verloopt_op     timestamptz not null,
  geactiveerd_op  timestamptz,
  venster_tot     timestamptz,
  voltooid_op     timestamptz,
  ingetrokken_op  timestamptz,
  ingetrokken_door uuid,
  correlatie_id   text not null,
  constraint herkoppel_token_is_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint herkoppel_geldigheid check (verloopt_op > uitgegeven_op),
  constraint herkoppel_venster check (geactiveerd_op is null or venster_tot is not null)
);
comment on table login_private.herkoppel_uitnodigingen is
  '#344: eenmalige, kortlopende koppel-/herstelsessie. Alleen sha256(token) wordt bewaard; het token authenticeert niet (wachtwoord blijft vereist) en opent uitsluitend het koppelpad.';
create index if not exists herkoppel_user_idx on login_private.herkoppel_uitnodigingen (user_id);
create index if not exists herkoppel_fonds_idx on login_private.herkoppel_uitnodigingen (fonds_id);
alter table login_private.herkoppel_uitnodigingen enable row level security;
revoke all on login_private.herkoppel_uitnodigingen from public, anon, authenticated, service_role, login_gateway;

-- ── 4b. Eén fondslock voor álles wat de dekking beïnvloedt ──────────────────
-- Reviewbevinding 2: alleen zet_modus nam de lock, dus een gelijktijdige
-- intrekking, break-glassintrekking of nieuw profiel kon tussen preflight en
-- commit glippen. Elke mutatie die de dekking van een fonds kan veranderen neemt
-- nu DEZELFDE lock — één lock, altijd in dezelfde volgorde, dus geen deadlock.
create or replace function login_private.fondslock(p_fonds uuid) returns void
language sql set search_path = login_private, public, pg_temp as $$
  select pg_advisory_xact_lock(hashtext('microsoft_login_beleid'), hashtext(p_fonds::text));
$$;
revoke all on function login_private.fondslock(uuid) from public, anon, authenticated, service_role;

-- Een nieuw of verplaatst profiel verandert de dekking zonder door een van onze
-- functies te lopen. Deze trigger neemt daarom dezelfde lock, zodat een insert
-- of fondswissel nooit tussen preflight en omslag valt.
create or replace function public.fn_profiel_fondslock() returns trigger
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.fonds_id is not null then perform login_private.fondslock(new.fonds_id); end if;
  elsif tg_op = 'UPDATE' then
    if new.fonds_id is distinct from old.fonds_id then
      if old.fonds_id is not null then perform login_private.fondslock(old.fonds_id); end if;
      if new.fonds_id is not null then perform login_private.fondslock(new.fonds_id); end if;
    end if;
  else
    if old.fonds_id is not null then perform login_private.fondslock(old.fonds_id); end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.fn_profiel_fondslock() from public, anon, authenticated, service_role;
drop trigger if exists trg_profiel_fondslock on public.profielen;
create trigger trg_profiel_fondslock
  before insert or update of fonds_id or delete on public.profielen
  for each row execute function public.fn_profiel_fondslock();

-- ── 5. Gatewayfuncties (execute uitsluitend login_gateway) ──────────────────
-- Vaste, inhoudsvrije foutcategorieën: config_ontbreekt, tenant_ontbreekt,
-- ongeldige_modus, dekking_onvolledig, breakglass_ontbreekt,
-- breakglass_onverifieerbaar, zelf_toekennen, fonds_mismatch, onbekende_binding,
-- uitnodiging_ongeldig, ongeldige_overgang.

-- Leest hoeveel accounts de overgang naar `verplicht` blokkeren en of er een
-- aantoonbaar werkend break-glasspad is. Het MFA-bewijs komt uit auth.mfa_factors;
-- is die tabel voor de functie-eigenaar niet leesbaar, dan is het pad NIET
-- aantoonbaar en faalt de activering gesloten (categorie breakglass_onverifieerbaar)
-- in plaats van op een aanname door te gaan.
-- Retourvorm gewijzigd t.o.v. een eerdere toepassing van deze migratie: eerst weg.
drop function if exists login_private.activering_preflight(uuid);
create or replace function login_private.activering_preflight(p_fonds uuid)
returns table(gereed boolean, categorie text, ongedekte_accounts integer,
              breakglass_accounts integer, breakglass_herziening_verlopen integer)
language plpgsql security definer set search_path = login_private, public, pg_temp stable as $$
declare
  v_tenant text;
  v_ongedekt integer := 0;
  v_bg integer := 0;
  v_herzien integer := 0;
  v_verifieerbaar boolean;
begin
  select c.entra_tenant_id into v_tenant from public.fonds_microsoft_login c where c.fonds_id = p_fonds;
  if not found then
    return query select false, 'config_ontbreekt'::text, 0, 0, 0; return;
  end if;
  if v_tenant is null then
    return query select false, 'tenant_ontbreekt'::text, 0, 0, 0; return;
  end if;

  -- Dekking: elk profiel in het fonds heeft óf een actieve binding, óf een
  -- levende break-glassaanwijzing. Een account zonder beide kan na de omslag
  -- niet meer inloggen en blokkeert de activering.
  select count(*) into v_ongedekt
    from public.profielen p
   where p.fonds_id = p_fonds
     and not exists (
       select 1 from microsoft_identiteiten b
        where b.user_id = p.id and b.fonds_id = p_fonds and b.status = 'active')
     and not exists (
       select 1 from break_glass g
        where g.user_id = p.id and g.fonds_id = p_fonds and g.ingetrokken_op is null);

  v_verifieerbaar := to_regclass('auth.mfa_factors') is not null
                 and has_table_privilege(current_user, 'auth.mfa_factors', 'select');
  if not v_verifieerbaar then
    return query select false, 'breakglass_onverifieerbaar'::text, v_ongedekt, 0, 0; return;
  end if;
  execute $q$
    select count(*) filter (where waar),
           count(*) filter (where waar and g.herzien_voor <= now())
      from login_private.break_glass g
      cross join lateral (select exists (
        select 1 from auth.mfa_factors f where f.user_id = g.user_id and f.status = 'verified') as waar) m
     where g.fonds_id = $1 and g.ingetrokken_op is null
  $q$ into v_bg, v_herzien using p_fonds;

  if v_bg < 1 then
    return query select false, 'breakglass_ontbreekt'::text, v_ongedekt, 0, 0; return;
  end if;
  if v_ongedekt > 0 then
    return query select false, 'dekking_onvolledig'::text, v_ongedekt, v_bg, v_herzien; return;
  end if;
  -- Een verlopen herziening blokkeert NIET: het pad moet blijven bestaan. Het
  -- telveld draagt de bewaking naar preflight, beheeroverzicht en runbook.
  return query select true, null::text, 0, v_bg, v_herzien;
end $$;

-- Zet de modus. Naar `verplicht` gaat de preflight ÍN dezelfde transactie, achter
-- een advisory lock op het fonds én een rijvergrendeling op de configuratie: een
-- gelijktijdige tweede activering of intrekking kan niet tussen toets en omslag
-- glippen. Faalt de preflight, dan verandert er niets en staat de weigering met
-- veilige redencategorie in de audit.
create or replace function login_private.zet_modus(p_fonds uuid, p_modus text, p_actor uuid, p_correlatie text)
returns text
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare
  v_oud text;
  v_tenant text;
  v_pre record;
begin
  if p_modus is null or p_modus not in ('uit','optioneel','verplicht') then
    return 'ongeldige_modus';
  end if;
  perform fondslock(p_fonds);
  select c.modus, c.entra_tenant_id into v_oud, v_tenant
    from public.fonds_microsoft_login c where c.fonds_id = p_fonds for update;
  if not found then return 'config_ontbreekt'; end if;
  if p_modus <> 'uit' and v_tenant is null then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, p_actor, 'beleid.geweigerd', 'tenant_ontbreekt', p_correlatie);
    return 'tenant_ontbreekt';
  end if;
  if p_modus = 'verplicht' and v_oud <> 'verplicht' then
    select * into v_pre from activering_preflight(p_fonds);
    if not v_pre.gereed then
      insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
      values (p_fonds, p_actor, 'beleid.activering_geweigerd', v_pre.categorie, p_correlatie);
      return v_pre.categorie;
    end if;
  end if;
  update public.fonds_microsoft_login
     set modus = p_modus, actief = (p_modus <> 'uit'), bijgewerkt = now()
   where fonds_id = p_fonds;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
  values (p_fonds, p_actor, 'beleid.gewijzigd', format('van=%s;naar=%s', v_oud, p_modus), p_correlatie);
  return null;
end $$;

-- Beheeroverzicht: uitsluitend wat het beheer nodig heeft. Nooit tid/oid/sub,
-- nooit e-mailadres, nooit een Microsoft-claim.
create or replace function login_private.dekkingsrapport(p_fonds uuid)
returns table(user_id uuid, naam text, rol text, binding_status text, laatst_gebruikt_op timestamptz,
              break_glass boolean, uitnodiging_open boolean)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select p.id,
         p.naam,
         p.rol,
         (select b.status from microsoft_identiteiten b
           where b.user_id = p.id and b.fonds_id = p_fonds and b.status in ('pending','active','revoking')
           limit 1),
         (select b.laatst_gebruikt_op from microsoft_identiteiten b
           where b.user_id = p.id and b.fonds_id = p_fonds and b.status in ('pending','active','revoking')
           limit 1),
         exists (select 1 from break_glass g
                  where g.user_id = p.id and g.fonds_id = p_fonds and g.ingetrokken_op is null),
         exists (select 1 from herkoppel_uitnodigingen u
                  where u.user_id = p.id and u.fonds_id = p_fonds
                    and u.ingetrokken_op is null and u.voltooid_op is null and u.verloopt_op > now())
    from public.profielen p
   where p.fonds_id = p_fonds
   order by p.naam nulls last, p.id
$$;

-- Beheerintrekking. Zonder p_afronden gaat de binding naar `revoking`: de hook
-- weigert dan onmiddellijk elke uitgifte, terwijl het levende slot bezet blijft
-- zodat de gebruiker de intrekking in zijn eigen sessie netjes kan afronden
-- (unlink bij GoTrue) vóór een nieuwe koppeling. Met p_afronden geeft het beheer
-- het slot direct vrij — bedoeld voor een vertrokken gebruiker; de GoTrue-
-- identiteit blijft dan achter en is alleen door die gebruiker zelf te ontkoppelen.
create or replace function login_private.beheer_intrekking(
  p_fonds uuid, p_doel uuid, p_actor uuid, p_afronden boolean, p_correlatie text
) returns table(id uuid, categorie text)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  perform fondslock(p_fonds);
  if not exists (select 1 from public.profielen p where p.id = p_doel and p.fonds_id = p_fonds) then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, p_doel, 'beheer.geweigerd', 'fonds_mismatch', p_correlatie);
    return query select null::uuid, 'fonds_mismatch'::text; return;
  end if;
  select * into r from microsoft_identiteiten
   where user_id = p_doel and fonds_id = p_fonds and status in ('pending','active','revoking')
   for update;
  if not found then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, p_doel, 'beheer.geweigerd', 'onbekende_binding', p_correlatie);
    return query select null::uuid, 'onbekende_binding'::text; return;
  end if;
  if coalesce(p_afronden, false) then
    update microsoft_identiteiten
       set status = 'revoked',
           intrekking_gestart_op = coalesce(intrekking_gestart_op, now()),
           ingetrokken_op = now(), ingetrokken_door = p_actor
     where microsoft_identiteiten.id = r.id;
  else
    update microsoft_identiteiten
       set status = 'revoking', intrekking_gestart_op = coalesce(intrekking_gestart_op, now()),
           ingetrokken_door = p_actor
     where microsoft_identiteiten.id = r.id;
  end if;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  values (p_fonds, p_doel,
          case when coalesce(p_afronden, false) then 'beheer.vrijgegeven' else 'beheer.ingetrokken' end,
          null, encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), p_correlatie);
  return query select r.id, null::text;
end $$;

-- ── 6. Break-glass ──────────────────────────────────────────────────────────
-- De aanwijzing is duurzaam; `p_herzien_over_dagen` zet alleen de herzieningsdatum
-- voor de bewaking. Zelf toekennen is uitgesloten en de MFA-eis wordt door de
-- hook afgedwongen (auth.mfa_factors is voor deze functie niet nodig).
-- Parameternaam gewijzigd (geldigheid → herzieningstermijn): eerst weg.
drop function if exists login_private.verleen_break_glass(uuid, uuid, text, uuid, integer, text);
create or replace function login_private.verleen_break_glass(
  p_fonds uuid, p_user uuid, p_reden text, p_actor uuid, p_herzien_over_dagen integer, p_correlatie text
) returns table(id uuid, categorie text)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare v_id uuid;
begin
  perform fondslock(p_fonds);
  if p_user = p_actor then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, p_actor, 'breakglass.geweigerd', 'zelf_toekennen', p_correlatie);
    return query select null::uuid, 'zelf_toekennen'::text; return;
  end if;
  if p_reden is null or p_reden not in ('entra_storing','beheerherstel','migratie') then
    return query select null::uuid, 'ongeldige_reden'::text; return;
  end if;
  if p_herzien_over_dagen is null or p_herzien_over_dagen < 1 or p_herzien_over_dagen > 365 then
    return query select null::uuid, 'ongeldige_geldigheid'::text; return;
  end if;
  if not exists (select 1 from public.profielen p where p.id = p_user and p.fonds_id = p_fonds) then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, p_user, 'breakglass.geweigerd', 'fonds_mismatch', p_correlatie);
    return query select null::uuid, 'fonds_mismatch'::text; return;
  end if;
  -- Eén levende aanwijzing per account: een nieuwe vervangt de vorige expliciet.
  update break_glass set ingetrokken_op = now(), ingetrokken_door = p_actor
   where user_id = p_user and ingetrokken_op is null;
  insert into break_glass (fonds_id, user_id, reden_categorie, uitgegeven_door, herzien_voor, correlatie_id)
  values (p_fonds, p_user, p_reden, p_actor, now() + make_interval(days => p_herzien_over_dagen), p_correlatie)
  returning break_glass.id into v_id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
  values (p_fonds, p_user, 'breakglass.verleend', p_reden, p_correlatie);
  return query select v_id, null::text;
end $$;

create or replace function login_private.trek_break_glass_in(p_id uuid, p_fonds uuid, p_actor uuid, p_correlatie text)
returns text
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r break_glass%rowtype;
begin
  perform fondslock(p_fonds);
  select * into r from break_glass where id = p_id and fonds_id = p_fonds for update;
  if not found then return 'onbekende_uitzondering'; end if;
  if r.ingetrokken_op is not null then return null; end if;              -- idempotent
  update break_glass set ingetrokken_op = now(), ingetrokken_door = p_actor where id = p_id;
  -- Lopende verhogingen vervallen onmiddellijk mee.
  delete from break_glass_activeringen a where a.break_glass_id = p_id and a.venster_tot > now();
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
  values (r.fonds_id, r.user_id, 'breakglass.ingetrokken', null, p_correlatie);
  return null;
end $$;

-- Opent (of hergebruikt) het activeringsvenster van een verhoogde break-glass-
-- sessie. De guard roept dit aan bij het eerste serververzoek van een AAL2-sessie;
-- per venster verschijnt precies één `breakglass.gebruikt` in de audit, zodat
-- herhaald gebruik zichtbaar en alarmeerbaar is.
create or replace function login_private.open_breakglass_venster(
  p_user uuid, p_venster_seconden integer, p_correlatie text
) returns table(venster_tot timestamptz, categorie text)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r break_glass%rowtype; v_tot timestamptz;
begin
  if p_venster_seconden is null or p_venster_seconden < 60 or p_venster_seconden > 28800 then
    return query select null::timestamptz, 'ongeldige_geldigheid'::text; return;
  end if;
  select * into r from break_glass g where g.user_id = p_user and g.ingetrokken_op is null limit 1;
  if not found then
    return query select null::timestamptz, 'onbekende_uitzondering'::text; return;
  end if;
  select a.venster_tot into v_tot from break_glass_activeringen a
   where a.user_id = p_user and a.venster_tot > now()
   order by a.venster_tot desc limit 1;
  if found and v_tot is not null then
    return query select v_tot, null::text; return;                        -- venster loopt al
  end if;
  insert into break_glass_activeringen (break_glass_id, fonds_id, user_id, venster_tot, correlatie_id)
  values (r.id, r.fonds_id, p_user, now() + make_interval(secs => p_venster_seconden), p_correlatie)
  returning break_glass_activeringen.venster_tot into v_tot;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
  values (r.fonds_id, p_user, 'breakglass.gebruikt', r.reden_categorie, p_correlatie);
  return query select v_tot, null::text;
end $$;

-- Beheeroverzicht van de aanwijzingen, inclusief de verloopbewaking. Geen
-- e-mailadres, geen MFA-geheim — alleen wat het beheer moet zien.
create or replace function login_private.breakglass_overzicht(p_fonds uuid)
returns table(id uuid, user_id uuid, naam text, reden_categorie text, uitgegeven_op timestamptz,
              herzien_voor timestamptz, herziening_verlopen boolean, laatst_gebruikt_op timestamptz)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select g.id, g.user_id, p.naam, g.reden_categorie, g.uitgegeven_op, g.herzien_voor,
         g.herzien_voor <= now(),
         (select max(a.geopend_op) from break_glass_activeringen a where a.break_glass_id = g.id)
    from break_glass g
    left join public.profielen p on p.id = g.user_id
   where g.fonds_id = p_fonds and g.ingetrokken_op is null
   order by g.herzien_voor
$$;

-- ── 7. Beperkte koppel-/herstelsessie ───────────────────────────────────────
create or replace function login_private.maak_uitnodiging(
  p_fonds uuid, p_user uuid, p_token_hash text, p_geldig_seconden integer, p_actor uuid, p_correlatie text
) returns text
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare v_tenant text;
begin
  perform fondslock(p_fonds);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return 'ongeldig_token'; end if;
  if p_geldig_seconden is null or p_geldig_seconden < 60 or p_geldig_seconden > 86400 then
    return 'ongeldige_geldigheid';
  end if;
  if not exists (select 1 from public.profielen p where p.id = p_user and p.fonds_id = p_fonds) then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, p_user, 'herkoppelen.geweigerd', 'fonds_mismatch', p_correlatie);
    return 'fonds_mismatch';
  end if;
  select c.entra_tenant_id into v_tenant from public.fonds_microsoft_login c where c.fonds_id = p_fonds;
  if v_tenant is null then return 'tenant_ontbreekt'; end if;
  -- Eén openstaande uitnodiging per account.
  update herkoppel_uitnodigingen set ingetrokken_op = now(), ingetrokken_door = p_actor
   where user_id = p_user and ingetrokken_op is null and voltooid_op is null and verloopt_op > now();
  insert into herkoppel_uitnodigingen
    (token_hash, fonds_id, user_id, entra_tenant_id, doel, uitgegeven_door, verloopt_op, correlatie_id)
  values (p_token_hash, p_fonds, p_user, v_tenant, 'herkoppelen', p_actor,
          now() + make_interval(secs => p_geldig_seconden), p_correlatie);
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
  values (p_fonds, p_user, 'herkoppelen.uitgenodigd', null, p_correlatie);
  return null;
end $$;

-- Atomisch en eenmalig: de update slaagt hooguit één keer per token. Het venster
-- is kort en telt vanaf activering; de uitnodiging is daarna verbruikt, ook als
-- het koppelen mislukt (het beheer geeft dan een nieuwe uit).
create or replace function login_private.activeer_uitnodiging(
  p_token_hash text, p_fonds uuid, p_venster_seconden integer, p_correlatie text
) returns table(user_id uuid, venster_tot timestamptz, categorie text)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r herkoppel_uitnodigingen%rowtype;
begin
  perform fondslock(p_fonds);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, null::timestamptz, 'uitnodiging_ongeldig'::text; return;
  end if;
  if p_venster_seconden is null or p_venster_seconden < 60 or p_venster_seconden > 3600 then
    return query select null::uuid, null::timestamptz, 'ongeldige_geldigheid'::text; return;
  end if;
  update herkoppel_uitnodigingen u
     set geactiveerd_op = now(), venster_tot = now() + make_interval(secs => p_venster_seconden)
   where u.token_hash = p_token_hash
     and u.fonds_id = p_fonds
     and u.geactiveerd_op is null
     and u.ingetrokken_op is null
     and u.voltooid_op is null
     and u.verloopt_op > now()
  returning u.* into r;
  if not found then
    return query select null::uuid, null::timestamptz, 'uitnodiging_ongeldig'::text; return;
  end if;
  -- De tenant is bij uitgifte vastgelegd; wijzigt het fonds daarna van tenant,
  -- dan vervalt de uitnodiging (fail-closed, geen tenantdrift).
  if not exists (
    select 1 from public.fonds_microsoft_login c
     where c.fonds_id = p_fonds and lower(c.entra_tenant_id) = lower(r.entra_tenant_id)) then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, r.user_id, 'herkoppelen.geweigerd', 'tenant_mismatch', p_correlatie);
    return query select null::uuid, null::timestamptz, 'tenant_mismatch'::text; return;
  end if;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
  values (p_fonds, r.user_id, 'herkoppelen.venster_geopend', null, p_correlatie);
  return query select r.user_id, r.venster_tot, null::text;
end $$;

create or replace function login_private.trek_uitnodiging_in(p_fonds uuid, p_user uuid, p_actor uuid, p_correlatie text)
returns text
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare v_n integer;
begin
  perform fondslock(p_fonds);
  update herkoppel_uitnodigingen
     set ingetrokken_op = now(), ingetrokken_door = p_actor
   where fonds_id = p_fonds and user_id = p_user
     and ingetrokken_op is null and voltooid_op is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then return 'uitnodiging_ongeldig'; end if;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
  values (p_fonds, p_user, 'herkoppelen.ingetrokken', null, p_correlatie);
  return null;
end $$;

-- ── 8. Sessiebeleid voor de app-guard (L3) ──────────────────────────────────
-- Eén aanroep per serververzoek van een NIET-oauth-sessie: welke modus geldt,
-- heeft dit account een levende binding, en staat er een uitzondering open?
-- Bewust ONGECACHET: een ingetrokken uitzondering of een omslag naar `verplicht`
-- moet bij het eerstvolgende verzoek werken, niet na een TTL.
drop function if exists login_private.sessiebeleid(uuid);
create or replace function login_private.sessiebeleid(p_user uuid)
returns table(fonds_id uuid, modus text, config_ontbreekt boolean, binding_status text,
              break_glass boolean, breakglass_venster_tot timestamptz, link_only boolean)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select p.fonds_id,
         coalesce(c.modus, 'uit'),
         c.fonds_id is null,                       -- drift: profiel zonder configrij
         (select b.status from microsoft_identiteiten b
           where b.user_id = p.id and b.status in ('pending','active','revoking') limit 1),
         exists (select 1 from break_glass g
                  where g.user_id = p.id and g.fonds_id = p.fonds_id and g.ingetrokken_op is null),
         (select max(a.venster_tot) from break_glass_activeringen a
           where a.user_id = p.id and a.venster_tot > now()),
         exists (select 1 from herkoppel_uitnodigingen u
                  where u.user_id = p.id and u.fonds_id = p.fonds_id
                    and u.ingetrokken_op is null and u.voltooid_op is null
                    and u.geactiveerd_op is not null and u.venster_tot > now())
    from public.profielen p
    left join public.fonds_microsoft_login c on c.fonds_id = p.fonds_id
   where p.id = p_user
$$;

-- ── 9. Activering sluit het herstelvenster ──────────────────────────────────
-- Zodra tid+oid actief gekoppeld is, is de uitzondering overbodig en wordt zij
-- in dezelfde transactie gesloten (§ ticket: "direct gesloten zodra tid + oid
-- actief is gekoppeld"). Beide activeringspaden krijgen dezelfde regel.
create or replace function login_private.activeer_identiteit(p_id uuid, p_user uuid, p_sub text)
returns boolean
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten where id = p_id and user_id = p_user and sub = p_sub for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'active' then return true; end if;                 -- idempotent
  if r.status <> 'pending' or r.pending_verloopt_op <= now() then
    raise exception 'ongeldige_overgang' using errcode = 'check_violation';
  end if;
  update microsoft_identiteiten set status = 'active', geactiveerd_op = now(), pending_verloopt_op = null where id = p_id;
  update herkoppel_uitnodigingen set voltooid_op = now()
   where user_id = r.user_id and voltooid_op is null and ingetrokken_op is null;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'koppelen.geactiveerd', encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), r.correlatie_id);
  return true;
end $$;

create or replace function login_private.herstel_koppeling(p_id uuid, p_user uuid, p_sub text)
returns boolean
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten where id = p_id and user_id = p_user and sub = p_sub for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'active' then return true; end if;
  if r.status <> 'pending' then raise exception 'ongeldige_overgang' using errcode = 'check_violation'; end if;
  update microsoft_identiteiten set status = 'active', geactiveerd_op = now(), pending_verloopt_op = null where id = p_id;
  update herkoppel_uitnodigingen set voltooid_op = now()
   where user_id = r.user_id and voltooid_op is null and ingetrokken_op is null;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'koppelen.hersteld', null, encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), r.correlatie_id);
  return true;
end $$;

-- ── 9b. Persoonlijk ontkoppelen server-side dicht in `verplicht` ────────────
-- start_intrekking is het ENIGE pad van de persoonlijke ontkoppelactie. De
-- weigering staat hier, niet (alleen) in de route: ook een rechtstreekse aanroep
-- buiten de UI om stuit erop. Uitzondering: een geopende koppel-/herstelsessie —
-- daar is het losmaken van de oude identiteit juist de bedoelde eerste stap.
-- Beheerintrekking loopt langs deze functie heen (beheer_intrekking).
--
-- De functie geeft nu (id, categorie) terug in plaats van te raisen — zelfde
-- reden als bij reserveer_identiteit (fase 1B): een auditregel in een functie die
-- daarna een exception werpt, verdwijnt met de subtransactie, en juist de
-- geweigerde ontkoppeling moet áltijd in de audit staan.
drop function if exists login_private.start_intrekking(uuid, uuid, uuid, text);
create or replace function login_private.start_intrekking(p_fonds uuid, p_user uuid, p_door uuid, p_correlatie text)
returns table(id uuid, categorie text)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  perform fondslock(p_fonds);
  if exists (
    select 1 from public.fonds_microsoft_login c
     where c.fonds_id = p_fonds and c.modus = 'verplicht'
  ) and not exists (
    select 1 from herkoppel_uitnodigingen u
     where u.user_id = p_user and u.fonds_id = p_fonds
       and u.ingetrokken_op is null and u.voltooid_op is null
       and u.geactiveerd_op is not null and u.venster_tot > now()
  ) then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, correlatie_id)
    values (p_fonds, p_user, 'ontkoppelen.geweigerd', 'ontkoppelen_verplicht', p_correlatie);
    return query select null::uuid, 'ontkoppelen_verplicht'::text; return;
  end if;
  select * into r from microsoft_identiteiten
   where user_id = p_user and fonds_id = p_fonds and status in ('active','revoking') for update;
  if not found then
    return query select null::uuid, 'onbekende_binding'::text; return;
  end if;
  if r.status = 'revoking' then                                   -- idempotent
    return query select r.id, null::text; return;
  end if;
  update microsoft_identiteiten
     set status = 'revoking', intrekking_gestart_op = now(), ingetrokken_door = p_door
   where microsoft_identiteiten.id = r.id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'ontkoppelen.gestart', encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), p_correlatie);
  return query select r.id, null::text;
end $$;

-- ── 10. Rechten gateway ─────────────────────────────────────────────────────
revoke all on function login_private.lees_config(uuid)                                              from public, anon, authenticated, service_role;
revoke all on function login_private.start_intrekking(uuid, uuid, uuid, text)                        from public, anon, authenticated, service_role;
revoke all on function login_private.activering_preflight(uuid)                                     from public, anon, authenticated, service_role;
revoke all on function login_private.zet_modus(uuid, text, uuid, text)                              from public, anon, authenticated, service_role;
revoke all on function login_private.dekkingsrapport(uuid)                                          from public, anon, authenticated, service_role;
revoke all on function login_private.beheer_intrekking(uuid, uuid, uuid, boolean, text)             from public, anon, authenticated, service_role;
revoke all on function login_private.verleen_break_glass(uuid, uuid, text, uuid, integer, text)     from public, anon, authenticated, service_role;
revoke all on function login_private.trek_break_glass_in(uuid, uuid, uuid, text)                    from public, anon, authenticated, service_role;
revoke all on function login_private.maak_uitnodiging(uuid, uuid, text, integer, uuid, text)        from public, anon, authenticated, service_role;
revoke all on function login_private.activeer_uitnodiging(text, uuid, integer, text)                from public, anon, authenticated, service_role;
revoke all on function login_private.trek_uitnodiging_in(uuid, uuid, uuid, text)                    from public, anon, authenticated, service_role;
revoke all on function login_private.sessiebeleid(uuid)                                             from public, anon, authenticated, service_role;
revoke all on function login_private.open_breakglass_venster(uuid, integer, text)                   from public, anon, authenticated, service_role;
revoke all on function login_private.breakglass_overzicht(uuid)                                     from public, anon, authenticated, service_role;

grant execute on function login_private.lees_config(uuid)                                          to login_gateway;
grant execute on function login_private.start_intrekking(uuid, uuid, uuid, text)                    to login_gateway;
grant execute on function login_private.activering_preflight(uuid)                                 to login_gateway;
grant execute on function login_private.zet_modus(uuid, text, uuid, text)                          to login_gateway;
grant execute on function login_private.dekkingsrapport(uuid)                                      to login_gateway;
grant execute on function login_private.beheer_intrekking(uuid, uuid, uuid, boolean, text)         to login_gateway;
grant execute on function login_private.verleen_break_glass(uuid, uuid, text, uuid, integer, text) to login_gateway;
grant execute on function login_private.trek_break_glass_in(uuid, uuid, uuid, text)                to login_gateway;
grant execute on function login_private.maak_uitnodiging(uuid, uuid, text, integer, uuid, text)    to login_gateway;
grant execute on function login_private.activeer_uitnodiging(text, uuid, integer, text)            to login_gateway;
grant execute on function login_private.trek_uitnodiging_in(uuid, uuid, uuid, text)                to login_gateway;
grant execute on function login_private.sessiebeleid(uuid)                                         to login_gateway;
grant execute on function login_private.open_breakglass_venster(uuid, integer, text)               to login_gateway;
grant execute on function login_private.breakglass_overzicht(uuid)                                 to login_gateway;

-- ── 11. Hookhelper voor het wachtwoordpad ───────────────────────────────────
-- Zelfde constructie als F1B: aangemaakt ALS login_hook_owner, uitsluitend
-- uitvoerbaar door supabase_auth_admin, search_path '' en een smal tekstcontract.
grant usage on schema login_private to login_hook_owner;
grant usage on schema public to login_hook_owner;
grant create on schema login_private to login_hook_owner;
grant login_hook_owner to postgres;
set local role login_hook_owner;
-- Een eerdere toepassing kan nog de boolean-variant hebben; alleen de eigenaar
-- mag die verwijderen, dus dat gebeurt hier binnen de rolwissel.
drop function if exists login_private.wachtwoordlogin_toegestaan(uuid, boolean);
-- Drie niveaus in plaats van ja/nee (reviewbevinding 1): 'vol' = het gewone
-- authenticated-token, 'beperkt' = hetzelfde token met claim role=portaal_beperkt
-- (een rol die niets mag behalve de eigen profielrij), 'geweigerd' = 403.
--
-- Geen profielrij → platformidentiteit, valt buiten het fondsbeleid → 'vol'.
-- Wél een profiel maar GEEN configrij → drift, en drift is dicht (bevinding 3).
--
-- In `verplicht`:
--   * open koppel-/herstelvenster                      → 'beperkt' (alleen koppelpad);
--   * break-glassaanwijzing zonder geverifieerde MFA    → 'geweigerd';
--   * break-glass mét MFA, sessie nog op AAL1           → 'beperkt' (zodat de
--     gebruiker de MFA-stap kán doen; verhogen komt daarna);
--   * break-glass mét MFA op AAL2                       → 'vol', maar alleen zolang
--     het activeringsvenster van DEZE MFA-verificatie loopt. Is dat venster
--     verlopen, dan zakt de sessie terug naar 'beperkt' en moet de gebruiker
--     opnieuw met MFA aanmelden — dat opent een nieuw, apart geaudit venster.
create or replace function login_private.wachtwoordlogin_niveau(
  p_user uuid, p_heeft_mfa boolean, p_aal2 boolean, p_mfa_op timestamptz
) returns text language sql security definer set search_path = '' stable as $$
  select case
    when not exists (select 1 from public.profielen p where p.id = p_user) then 'vol'
    when not exists (
      select 1 from public.profielen p
        join public.fonds_microsoft_login c on c.fonds_id = p.fonds_id
       where p.id = p_user) then 'geweigerd'
    when exists (
      select 1 from public.profielen p
        join public.fonds_microsoft_login c on c.fonds_id = p.fonds_id
       where p.id = p_user and c.modus <> 'verplicht') then 'vol'
    when exists (
      select 1 from login_private.herkoppel_uitnodigingen u
        join public.profielen p on p.id = u.user_id and p.fonds_id = u.fonds_id
       where u.user_id = p_user and u.ingetrokken_op is null and u.voltooid_op is null
         and u.geactiveerd_op is not null and u.venster_tot > pg_catalog.now()) then 'beperkt'
    when coalesce(p_heeft_mfa, false) and exists (
      select 1 from login_private.break_glass g
        join public.profielen p on p.id = g.user_id and p.fonds_id = g.fonds_id
       where g.user_id = p_user and g.ingetrokken_op is null)
      then case
        when not coalesce(p_aal2, false) then 'beperkt'
        -- Verhoogd blijven mag alleen binnen het venster van DEZE MFA-verificatie.
        when exists (
          select 1 from login_private.break_glass_activeringen a
           where a.user_id = p_user
             and (p_mfa_op is null or a.geopend_op >= p_mfa_op)
             and a.venster_tot > pg_catalog.now()) then 'vol'
        when exists (
          select 1 from login_private.break_glass_activeringen a
           where a.user_id = p_user
             and (p_mfa_op is null or a.geopend_op >= p_mfa_op)) then 'beperkt'
        else 'vol'                       -- eerste verzoek na de MFA-stap; de guard opent het venster
      end
    else 'geweigerd'
  end;
$$;
revoke all on function login_private.wachtwoordlogin_niveau(uuid, boolean, boolean, timestamptz) from public, anon, authenticated, service_role, login_gateway;
grant execute on function login_private.wachtwoordlogin_niveau(uuid, boolean, boolean, timestamptz) to supabase_auth_admin;
reset role;
revoke create on schema login_private from login_hook_owner;
revoke login_hook_owner from postgres;

-- Leesrechten van de helper: uitsluitend de kolommen die de beslissing dragen.
grant select (modus) on public.fonds_microsoft_login to login_hook_owner;
grant select (user_id, fonds_id, ingetrokken_op) on login_private.break_glass to login_hook_owner;
grant select (user_id, geopend_op, venster_tot) on login_private.break_glass_activeringen to login_hook_owner;
drop policy if exists "hook owner leest breakglass-activeringen" on login_private.break_glass_activeringen;
create policy "hook owner leest breakglass-activeringen" on login_private.break_glass_activeringen
  for select to login_hook_owner using (true);
drop policy if exists "hook owner leest break glass" on login_private.break_glass;
create policy "hook owner leest break glass" on login_private.break_glass
  for select to login_hook_owner using (true);
grant select (user_id, fonds_id, ingetrokken_op, voltooid_op, geactiveerd_op, venster_tot)
  on login_private.herkoppel_uitnodigingen to login_hook_owner;
drop policy if exists "hook owner leest uitnodigingen" on login_private.herkoppel_uitnodigingen;
create policy "hook owner leest uitnodigingen" on login_private.herkoppel_uitnodigingen
  for select to login_hook_owner using (true);

-- ── 12. Custom Access Token Hook: ook het wachtwoordpad ─────────────────────
-- Verandering t.o.v. F1B: een NIET-oauth-uitgifte keert niet meer onvoorwaardelijk
-- terug, maar wordt tegen het fondsbeleid gehouden. De MFA-toets gebeurt hier — de
-- hook draait als supabase_auth_admin en leest auth.mfa_factors zelf, zodat
-- login_hook_owner géén rechten in het auth-schema nodig heeft.
--
-- Reviewbevinding 1: een uitzonderingssessie kreeg het gewone `authenticated`-token
-- en kon daarmee rechtstreeks PostgREST, Storage en Realtime benaderen. Zij krijgt
-- nu de claim `role = portaal_beperkt` — een rol die niets mag behalve de eigen
-- profielrij lezen. Pas na AAL2 (break-glass) of een geldige Microsoft-koppeling
-- verschijnt de normale rol. PostgREST doet `set role` op deze claim, dus de
-- begrenzing zit in de database en niet in de app.
--
-- De weigering is één neutrale melding zonder accountenumeratie: zij treedt pas op
-- ná geldige credentials, dus zij onderscheidt geen bestaande van niet-bestaande
-- accounts en verraadt geen wachtwoord.
create or replace function public.fn_access_token_hook(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_user uuid;
  v_oauth boolean;
  v_mfa boolean;
  v_aal2 boolean;
  v_mfa_op timestamptz;
  v_niveau text;
  v_aantal integer;
  v_provider text; v_sub text; v_tid text; v_oid text;
  v_weiger jsonb := pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403, 'message', 'Microsoft-login is niet gekoppeld aan dit account.'));
  v_weiger_wachtwoord jsonb := pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403, 'message', 'Voor deze omgeving logt u in met Microsoft.'));
begin
  v_oauth := (event->>'authentication_method') = 'oauth'
          or exists (
               select 1 from pg_catalog.jsonb_array_elements(coalesce(event->'claims'->'amr', '[]'::jsonb)) e
                where coalesce(e->>'method', e #>> '{}') = 'oauth');
  v_user := (event->>'user_id')::uuid;

  if not v_oauth then
    -- Wachtwoord, magic link, herstel en TOTP vallen alle onder het gesloten pad
    -- in modus `verplicht`: een herstelmail zou anders een volledige omweg om
    -- Microsoft zijn. In `uit` en `optioneel` verandert er niets.
    if v_user is null then return v_weiger_wachtwoord; end if;
    v_mfa := exists (
      select 1 from auth.mfa_factors f where f.user_id = v_user and f.status = 'verified');
    v_aal2 := (event->'claims'->>'aal') = 'aal2';
    -- Tijdstip van de MFA-stap uit amr; bepaalt welk activeringsvenster telt.
    select pg_catalog.max(pg_catalog.to_timestamp((e->>'timestamp')::double precision))
      into v_mfa_op
      from pg_catalog.jsonb_array_elements(coalesce(event->'claims'->'amr', '[]'::jsonb)) e
     where e->>'method' in ('totp','mfa','webauthn') and (e->>'timestamp') ~ '^[0-9]+$';
    v_niveau := login_private.wachtwoordlogin_niveau(v_user, v_mfa, v_aal2, v_mfa_op);
    if v_niveau = 'vol' then return event; end if;
    if v_niveau = 'beperkt' then
      return pg_catalog.jsonb_set(event, '{claims,role}', '"portaal_beperkt"'::jsonb, true);
    end if;
    return v_weiger_wachtwoord;
  end if;

  if v_user is null then return v_weiger; end if;

  select pg_catalog.count(*), pg_catalog.min(i.provider), pg_catalog.min(i.provider_id),
         pg_catalog.min(i.identity_data->'custom_claims'->>'tid'), pg_catalog.min(i.identity_data->'custom_claims'->>'oid')
    into v_aantal, v_provider, v_sub, v_tid, v_oid
    from auth.identities i
   where i.user_id = v_user and i.provider not in ('email','phone');
  if v_aantal <> 1 or v_provider <> 'azure' or v_sub is null or v_tid is null or v_oid is null then
    return v_weiger;
  end if;
  if login_private.identiteit_toegestaan(v_user, v_sub, v_tid, v_oid) then
    return event;
  end if;
  return v_weiger;
exception when others then
  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403, 'message', 'Uw aanmelding kan nu niet worden gecontroleerd.'));
end $$;
revoke all on function public.fn_access_token_hook(jsonb) from public, anon, authenticated, service_role;
-- Supabase vereist voor een Postgres Auth-hook expliciet USAGE op het schema van de
-- hookfunctie; de helper staat in login_private, dus ook daar USAGE (geen tabelrechten).
grant usage on schema public to supabase_auth_admin;
grant usage on schema login_private to supabase_auth_admin;
grant execute on function public.fn_access_token_hook(jsonb) to supabase_auth_admin;

-- ── 13. De beperkte portaalrol ──────────────────────────────────────────────
-- Alles dicht, dan precies één ding open: de eigen profielrij lezen. Dat is het
-- minimum waarmee de koppel-/herstelsessie en de MFA-stap kunnen werken (de
-- routewrapper en haalFondsSessie lezen fonds_id en rol uit het eigen profiel).
-- Geen documenten, geen dossiers, geen storage, geen functies — en geen enkele
-- andere policy noemt deze rol, dus RLS geeft haar nergens anders rijen.
revoke all on all tables    in schema public  from portaal_beperkt;
revoke all on all functions in schema public  from portaal_beperkt;
revoke all on all sequences in schema public  from portaal_beperkt;
revoke all on all tables    in schema storage from portaal_beperkt;
revoke usage on schema storage from portaal_beperkt;
revoke usage on schema login_private from portaal_beperkt;
alter default privileges in schema public revoke all on tables    from portaal_beperkt;
alter default privileges in schema public revoke all on functions from portaal_beperkt;
grant usage on schema public to portaal_beperkt;
grant select (id, fonds_id, rol, naam) on public.profielen to portaal_beperkt;
drop policy if exists "beperkte sessie leest eigen profiel" on public.profielen;
create policy "beperkte sessie leest eigen profiel" on public.profielen
  for select to portaal_beperkt using (id = (select auth.uid()));

commit;
