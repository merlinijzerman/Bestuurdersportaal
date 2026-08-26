-- ============================================================================
-- W11 — handelingen_log: forensische tenant-handelingslog (besluit 0191)
-- ----------------------------------------------------------------------------
-- Operationele, niet-bestuurlijke state-changing handelingen (wie, welke
-- handeling, welke route, welke uitkomst, wanneer) voor forensische reconstructie
-- van beveiligings-/misbruikincidenten. GEEN inhoud, GEEN querystring. Bestuurlijke
-- feiten staan in governance_events; deze tabel niet.
--
-- Dataminimalisatie (0191 §1) · append-only voor gebruikers, retentie 90 dagen via
-- de service-role · SECURITY DEFINER-schrijfpad (fonds/gebruiker uit auth.uid(),
-- niet meegegeven) · deny-by-default lezen achter de tenant-capability
-- `handelingen.lezen` (bureau/beheer, NIET bestuurder; NIET observability.read).
--
-- ⚠ SUPABASE-EERST. Draai deze migratie in Supabase VÓÓR de code-deploy die de
--   throw-stub in `echteDeps.schrijfHandeling` (core/lib/route-wrapper.ts) vervangt
--   door een rpc-aanroep van `fn_schrijf_handeling`. Anders throwt de wrapper op de
--   handhaaf-tak (best-effort opgevangen, maar wél luidruchtig).
-- ⚠ ENFORCE_AUDIT blijft UIT tot deze migratie draait én de code-deploy erna landt.
--
-- Modellen: 2026_08_04_a2_audit_least_privilege.sql (deny-by-default + definer-read
-- + grants) en 2026_06_10_rate_limiting.sql (SECURITY DEFINER + auth.uid()).
-- ROLLBACK: supabase/rollbacks/2026_08_26_w11_handelingen_log_ROLLBACK.sql
-- ============================================================================

-- ══ 1. Tabel ════════════════════════════════════════════════════════════════
create table if not exists public.handelingen_log (
  id            uuid primary key default gen_random_uuid(),
  fonds_id      uuid not null references public.fondsen(id)   on delete cascade,
  gebruiker_id  uuid not null references auth.users(id)       on delete cascade,
  handeling     text not null,                                    -- semantisch label
  methode       text not null check (methode in ('POST','PATCH','PUT','DELETE')),
  pad           text not null,                                    -- alleen het pad, nooit de querystring
  status        int  not null,
  request_id    uuid not null,
  tijdstip      timestamptz not null default now()
);

comment on table public.handelingen_log is
  'Besluit 0191 — forensische, niet-bestuurlijke handelingslog. Operationele '
  'state-changing handelingen; 90 dagen retentie; geen inhoud, geen querystring. '
  'Bestuurlijke feiten staan in governance_events. Schrijven uitsluitend via '
  'fn_schrijf_handeling(); lezen deny-by-default achter mag_handelingen_lezen().';

create index if not exists idx_handelingen_log_fonds_tijd
  on public.handelingen_log (fonds_id, tijdstip desc);

alter table public.handelingen_log enable row level security;

-- ══ 2. Append-only voor gebruikers, retentiesnoei voor de service-role ══════
-- UPDATE: nooit — een handeling wijzigt niet.
drop trigger if exists trg_handelingen_no_update on public.handelingen_log;
create trigger trg_handelingen_no_update before update on public.handelingen_log
  for each row execute function public.fn_log_append_only();

-- DELETE: alleen rijen ouder dan het retentievenster mogen weg (retentiesnoei).
-- Recente rijen zijn dus onaantastbaar, óók voor de service-role. Combineer met de
-- grants hieronder (authenticated/anon krijgen sowieso geen DELETE): in de praktijk
-- verwijdert alleen fn_handelingen_snoei() als service-role, en enkel verlopen rijen.
create or replace function public.fn_handelingen_retentie_guard()
returns trigger language plpgsql as $f$
begin
  if old.tijdstip > now() - interval '90 days' then
    raise exception 'handelingen_log: verwijderen mag alleen bij retentiesnoei (rij ouder dan 90 dagen)';
  end if;
  return old;
end;
$f$;

drop trigger if exists trg_handelingen_retentie on public.handelingen_log;
create trigger trg_handelingen_retentie before delete on public.handelingen_log
  for each row execute function public.fn_handelingen_retentie_guard();

-- ══ 3. Leesrecht: deny-by-default achter de tenant-capability handelingen.lezen ═
-- Eigen grants-tabel (niet governance_audit_grants: dat is bestuur-audit; dit is
-- forensisch/bureau). Deny-by-default: RLS aan, BEWUST geen policy — lezen van de
-- grants uitsluitend binnen mag_handelingen_lezen().
create table if not exists public.handelingen_lees_grants (
  gebruiker_id   uuid not null references auth.users(id)     on delete cascade,
  fonds_id       uuid not null references public.fondsen(id) on delete cascade,
  toegekend_door uuid,
  toegekend_op   timestamptz not null default now(),
  geldig_van     timestamptz,
  geldig_tot     timestamptz,
  motivering     text,
  primary key (gebruiker_id, fonds_id)
);
comment on table public.handelingen_lees_grants is
  'Besluit 0191 — wie handelingen_log van een fonds mag lezen (capability '
  'handelingen.lezen; bureau/beheer, niet bestuurder). Deny-by-default: RLS aan, '
  'geen policy; uitsluitend leesbaar binnen mag_handelingen_lezen().';
alter table public.handelingen_lees_grants enable row level security;

create or replace function public.mag_handelingen_lezen(p_fonds uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.handelingen_lees_grants g
     where g.gebruiker_id = auth.uid()
       and g.fonds_id     = p_fonds
       and now() between coalesce(g.geldig_van, '-infinity'::timestamptz)
                     and coalesce(g.geldig_tot,  'infinity'::timestamptz)
  );
$$;

-- RLS-leespolicy: fonds-isolatie én capability in één predicaat.
drop policy if exists "handelingen lezen met capability" on public.handelingen_log;
create policy "handelingen lezen met capability" on public.handelingen_log
  for select to authenticated
  using (public.mag_handelingen_lezen(fonds_id));

-- ══ 4. Schrijfpad: SECURITY DEFINER, fonds/gebruiker uit auth.uid() ═════════
-- De wrapper geeft GEEN fonds/gebruiker mee (defense-in-depth). fonds_id komt uit
-- het profiel van auth.uid(), net als haalProfiel server-side doet.
create or replace function public.fn_schrijf_handeling(
  p_handeling  text,
  p_methode    text,
  p_pad        text,
  p_status     int,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
begin
  if v_uid is null then
    raise exception 'fn_schrijf_handeling vereist een geauthenticeerde gebruiker'
      using errcode = '28000';
  end if;
  select fonds_id into v_fonds from public.profielen where id = v_uid;
  if v_fonds is null then
    -- Een gebruiker zonder fonds hoort geen tenant-handeling achter te laten;
    -- stilzwijgend niets schrijven i.p.v. een NOT NULL-crash.
    return;
  end if;
  insert into public.handelingen_log
    (fonds_id, gebruiker_id, handeling, methode, pad, status, request_id)
  values (v_fonds, v_uid, p_handeling, p_methode, p_pad, p_status, p_request_id);
end;
$$;

-- ══ 5. Retentiesnoei (service-role-baan) ════════════════════════════════════
-- Verwijdert rijen ouder dan 90 dagen. Alleen aanroepbaar met verhoogde rechten
-- (service-role / definer-eigenaar); de retentie-guard laat enkel verlopen rijen toe.
create or replace function public.fn_handelingen_snoei()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aantal int;
begin
  delete from public.handelingen_log where tijdstip < now() - interval '90 days';
  get diagnostics v_aantal = row_count;
  return v_aantal;
end;
$$;

-- ══ 6. Grants (H-18: revoke van public, anon; gericht teruggeven) ═══════════
revoke all on public.handelingen_log        from anon;
revoke all on public.handelingen_lees_grants from anon;
-- authenticated mag NIET zelf schrijven/muteren en de grants niet lezen.
revoke insert, update, delete, truncate, references, trigger
  on public.handelingen_log from authenticated;
-- V3 browserrollen mogen ook op nieuwe tabellen geen MAINTAIN erven.
revoke maintain on public.handelingen_log from anon, authenticated;
revoke all on public.handelingen_lees_grants from authenticated;
-- Lezen van handelingen_log mag wél, maar de RLS-policy gate't op de capability.
grant select on public.handelingen_log to authenticated;

revoke all on function public.fn_schrijf_handeling(text, text, text, int, uuid) from public, anon;
grant execute on function public.fn_schrijf_handeling(text, text, text, int, uuid) to authenticated;
revoke all on function public.mag_handelingen_lezen(uuid) from public, anon;
grant execute on function public.mag_handelingen_lezen(uuid) to authenticated;
-- Snoei is service-role-only.
revoke all on function public.fn_handelingen_snoei() from public, anon, authenticated;
-- Trigger-functie: niemand roept hem direct aan (draait in de triggercontext).
-- Expliciet dichtzetten voor determinisme, zodat de V3-allowlist eenduidig is.
revoke all on function public.fn_handelingen_retentie_guard() from public, anon, authenticated;

-- ══ 7. Verificatie (dezelfde transactie — de eindtoestand of niets) ═════════
do $$
declare
  v_rls   boolean;
  v_pol   int;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.handelingen_log'::regclass;
  if not v_rls then raise exception 'VERIFICATIE: RLS staat niet aan op handelingen_log'; end if;

  select count(*) into v_pol from pg_policies
    where schemaname = 'public' and tablename = 'handelingen_log';
  if v_pol <> 1 then raise exception 'VERIFICATIE: verwacht 1 SELECT-policy op handelingen_log, vond %', v_pol; end if;

  -- append-only + retentie-guard triggers aanwezig
  if not exists (select 1 from pg_trigger where tgrelid = 'public.handelingen_log'::regclass
                   and tgname = 'trg_handelingen_no_update') then
    raise exception 'VERIFICATIE: trg_handelingen_no_update ontbreekt'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.handelingen_log'::regclass
                   and tgname = 'trg_handelingen_retentie') then
    raise exception 'VERIFICATIE: trg_handelingen_retentie ontbreekt'; end if;

  -- anon heeft geen enkel recht; authenticated heeft geen INSERT
  if has_table_privilege('anon', 'public.handelingen_log', 'SELECT') then
    raise exception 'VERIFICATIE: anon mag handelingen_log lezen'; end if;
  if has_table_privilege('authenticated', 'public.handelingen_log', 'INSERT') then
    raise exception 'VERIFICATIE: authenticated mag direct in handelingen_log inserten'; end if;
  if has_table_privilege('authenticated', 'public.handelingen_log', 'MAINTAIN') then
    raise exception 'VERIFICATIE: authenticated mag handelingen_log onderhouden'; end if;

  raise notice 'W11 handelingen_log: verificatie geslaagd.';
end $$;
