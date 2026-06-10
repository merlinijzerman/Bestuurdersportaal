-- ============================================================================
-- Migratie: rate limiting in-stack (Security Route A — WP2)
-- ----------------------------------------------------------------------------
-- Dicht de hoog-risico-bevinding F2 (geen rate limiting): een ingelogde
-- gebruiker kan nu in een loop de AI-/upload-endpoints hameren — kosten-runaway
-- richting Anthropic en DOS-risico. Conform decisions/0005 lossen we dit op
-- BINNEN de bestaande stack (Supabase Postgres), zonder Upstash/Redis.
--
-- Ontwerp (sliding-window-log):
--   - Eén rij per request-event in rate_limit_events (gebruiker_id, endpoint,
--     tijdstip). De functie telt de events binnen het venster en beslist.
--   - Onbeperkte rijgroei wordt voorkomen doordat de functie per check de eigen
--     verlopen events (< now() - venster) wegsnoeit. De tabel blijft daardoor
--     klein, passend bij MVP-volume.
--
-- Niet-omzeilbaarheid (essentieel — anders is de limiet met de anon-key te
-- omzeilen):
--   - RLS staat aan ZONDER policies → deny-all voor anon/authenticated. Een
--     gebruiker kan zijn eigen teller dus niet lezen, niet verwijderen en niet
--     resetten via de anon-key.
--   - fn_rate_limit_check is `security definer` (draait als owner, omzeilt RLS)
--     en is daarmee het ENIGE schrijf-/leespad naar de tabel.
--   - De teller wordt intern op auth.uid() gesleuteld, NIET op een meegegeven
--     parameter. Zo kan een client geen vreemd gebruiker-id meesturen om de
--     eigen check te ontwijken of de teller van een ander te vullen.
--
-- Idempotent: veilig herhaaldelijk uit te voeren. Eerst in Supabase draaien
-- (SQL Editor → Run), DAARNA de code deployen — anders falen de rpc-calls.
-- ============================================================================

-- ── Tabel ───────────────────────────────────────────────────────────────────
create table if not exists public.rate_limit_events (
  id            uuid primary key default uuid_generate_v4(),
  gebruiker_id  uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null,
  tijdstip      timestamptz not null default now()
);

-- Snel tellen binnen venster per (gebruiker, endpoint).
create index if not exists idx_rate_limit_lookup
  on public.rate_limit_events (gebruiker_id, endpoint, tijdstip desc);

-- ── RLS: deny-all ───────────────────────────────────────────────────────────
-- RLS aan + GEEN policies = niemand met anon/authenticated mag direct lezen of
-- schrijven. De security-definer-functie hieronder is het enige pad.
alter table public.rate_limit_events enable row level security;
-- Defense-in-depth: ook de directe tabel-rechten intrekken, zodat de tabel
-- uitsluitend via de functie benaderbaar is.
revoke all on public.rate_limit_events from anon, authenticated;

-- ── Functie: tellen-binnen-venster + beslissen ──────────────────────────────
-- Retourneert jsonb:
--   { "toegestaan": bool, "resterend": int, "reset_at": timestamptz | null }
--
-- `reset_at` is het moment waarop er weer ruimte komt:
--   - bij weigering: oudste event in het venster + venster (dan valt dat event
--     buiten het venster en komt één plek vrij);
--   - bij toestaan: oudste event in het venster + venster, of (bij een lege
--     teller) now() + venster.
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
  -- Alleen geauthenticeerde requests; ongeauthenticeerd hoort hier niet te komen.
  if v_uid is null then
    raise exception 'rate limit check vereist een geauthenticeerde gebruiker'
      using errcode = '28000';
  end if;

  -- Snoei verlopen events van deze gebruiker/endpoint — houdt de tabel klein
  -- en zorgt dat de telling exact het sliding window weerspiegelt.
  delete from public.rate_limit_events
   where gebruiker_id = v_uid
     and endpoint = p_endpoint
     and tijdstip < now() - p_venster;

  -- Tel resterende (= geldige) events binnen het venster.
  select count(*), min(tijdstip)
    into v_aantal, v_oudste
    from public.rate_limit_events
   where gebruiker_id = v_uid
     and endpoint = p_endpoint;

  if v_aantal >= p_limiet then
    -- Geweigerd: geen nieuw event vastleggen. Ruimte komt vrij zodra het
    -- oudste event uit het venster schuift.
    v_reset := coalesce(v_oudste, now()) + p_venster;
    return jsonb_build_object(
      'toegestaan', false,
      'resterend', 0,
      'reset_at', v_reset
    );
  end if;

  -- Toegestaan: leg het event vast en geef het resterende budget terug.
  insert into public.rate_limit_events (gebruiker_id, endpoint)
  values (v_uid, p_endpoint);

  v_reset := coalesce(v_oudste, now()) + p_venster;
  return jsonb_build_object(
    'toegestaan', true,
    'resterend', p_limiet - v_aantal - 1,
    'reset_at', v_reset
  );
end;
$$;

-- Alleen geauthenticeerde gebruikers mogen de functie aanroepen.
revoke all on function public.fn_rate_limit_check(text, int, interval) from public, anon;
grant execute on function public.fn_rate_limit_check(text, int, interval) to authenticated;

-- ============================================================================
-- Verificatie (SQL Editor, als ingelogde gebruiker):
--   select public.fn_rate_limit_check('chat', 3, '1 minute');  -- 1e: toegestaan
--   select public.fn_rate_limit_check('chat', 3, '1 minute');  -- 2e: toegestaan
--   select public.fn_rate_limit_check('chat', 3, '1 minute');  -- 3e: toegestaan
--   select public.fn_rate_limit_check('chat', 3, '1 minute');  -- 4e: toegestaan=false
--
-- RLS-bewijs (mag GEEN rijen geven / moet falen met de anon-key):
--   select * from public.rate_limit_events;          -- deny-all → 0 rijen
--   delete from public.rate_limit_events;            -- geweigerd → kan teller niet resetten
-- ============================================================================
