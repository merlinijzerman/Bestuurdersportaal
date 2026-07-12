-- ============================================================================
-- Migratie 2026-07-12 — D1: SECURITY DEFINER-RPC's voor de gedeelde surface.
-- ----------------------------------------------------------------------------
-- Doel (werkopdracht C1, Fase B criterium 2): de SUPABASE_SERVICE_ROLE_KEY mag
-- straks UITSLUITEND in het beheer-project leven. Vandaag heeft de gedeelde
-- (app/publiek) surface de service-role nog nodig op twee paden:
--   1. host->fonds-resolutie  (core/lib/tenant-domains.ts, op elke tenant-load);
--   2. publieke contactinzending (app/api/contact/route.ts): insert + rate-limit
--      COUNT + notificatie-status-UPDATE.
-- Beide tabellen (tenant_domains, contact_aanvragen) zijn GLOBAAL en
-- deny-by-default (RLS aan, GEEN policy). Deze migratie geeft de gedeelde surface
-- exact drie SMALLE, anon-aanroepbare SECURITY DEFINER-entrypoints, zodat die
-- paden met de ANON-key werken en de service-role uit het gedeelde project kan.
--
-- RLS/tenant-isolatie: ONGEWIJZIGD. Geen tabelpolicy toegevoegd; beide tabellen
-- blijven deny-by-default. Beide zijn NIET-tenant (geen fonds_id-RLS). De
-- SECURITY DEFINER-functies draaien als eigenaar (RLS-bypass) maar zijn strikt
-- afgebakend tot deze operaties. search_path gepind (search-path-hijack-hardening,
-- patroon van fn_profiel_bevries_kolommen). Append-only-trigger op
-- contact_aanvragen ongemoeid (geen delete).
--
-- Conventies: idempotent (drop if exists + create); ROLLBACK-bestand apart;
-- migratie-eerst-dan-deploy (deze functies zijn standalone veilig — de
-- D1-code-switch komt pas in de deploy erna).
-- ============================================================================

begin;

-- ── 1. resolve_tenant_host(host) — één actieve rij, geen full-table-exposure ──
-- Vervangt de service-role full-list-read in core/lib/tenant-domains.ts. De
-- caller normaliseert de host in TS (normaliseerHost) en geeft de reeds
-- genormaliseerde host mee; deze functie doet een exacte match op een ACTIEVE
-- rij en geeft 0 of 1 rij terug. Strikt minder blootstelling dan het huidige
-- full-table-leespad: geen enumeratie van de volledige mapping mogelijk.
drop function if exists public.resolve_tenant_host(text);
create function public.resolve_tenant_host(p_host text)
returns table (host text, fonds_id uuid, actief boolean)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select td.host, td.fonds_id, td.actief
  from public.tenant_domains td
  where td.actief = true
    and td.host = p_host
  limit 1;
$$;

comment on function public.resolve_tenant_host(text) is
  'D1: host->fonds-resolutie voor de gedeelde surface met de anon-key. SECURITY DEFINER (tenant_domains blijft deny-by-default). Geeft 0/1 actieve rij; caller levert een genormaliseerde host.';

-- ── 2. contact_aanvraag_insert(...) — insert MÉT ingebouwde rate-limit ───────
-- Vervangt in app/api/contact/route.ts zowel de service-role rate-limit-COUNT
-- als de insert. status = 'ok' (met id + aangemaakt_op) of 'rate_limited'
-- (id/ts null). Rate-limit: max 3 per ip_hash / 10 min; geen ip_hash -> geen
-- limiet (fail-open, gelijk aan de huidige route-logica). type_verzoek wordt door
-- de tabel-CHECK bewaakt; server-side validatie in TS blijft (defense-in-depth).
drop function if exists public.contact_aanvraag_insert(text, text, text, text, text, text, text, text, text, text);
create function public.contact_aanvraag_insert(
  p_naam text,
  p_organisatie text,
  p_rol text,
  p_email text,
  p_telefoon text,
  p_type_verzoek text,
  p_bericht text,
  p_herkomst_pagina text,
  p_privacy_version text,
  p_ip_hash text
)
returns table (id uuid, aangemaakt_op timestamptz, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_id uuid;
  v_ts timestamptz;
begin
  if p_ip_hash is not null then
    select count(*) into v_count
    from public.contact_aanvragen
    where ip_hash = p_ip_hash
      and aangemaakt_op >= now() - interval '10 minutes';
    if v_count >= 3 then
      return query select null::uuid, null::timestamptz, 'rate_limited'::text;
      return;
    end if;
  end if;

  insert into public.contact_aanvragen (
    naam, organisatie, rol, email, telefoon, type_verzoek, bericht,
    herkomst_pagina, privacy_version, ip_hash
  ) values (
    p_naam, p_organisatie, p_rol, p_email, p_telefoon, p_type_verzoek, p_bericht,
    p_herkomst_pagina, p_privacy_version, p_ip_hash
  )
  returning contact_aanvragen.id, contact_aanvragen.aangemaakt_op into v_id, v_ts;

  return query select v_id, v_ts, 'ok'::text;
end;
$$;

comment on function public.contact_aanvraag_insert(text, text, text, text, text, text, text, text, text, text) is
  'D1: publieke contactinsert met ingebouwde rate-limit voor de gedeelde surface met de anon-key. SECURITY DEFINER (contact_aanvragen blijft deny-by-default). status ok|rate_limited.';

-- ── 3. contact_notificatie_status(id, verzonden, error) — post-mail-UPDATE ───
-- Vervangt de service-role UPDATE waarmee de route na de (soft-fail) mailstap
-- notificatie_verzonden/mail_error markeert voor handmatige opvolging. Smal:
-- raakt alleen deze twee ops-velden (geen tenant/PII-data).
drop function if exists public.contact_notificatie_status(uuid, boolean, text);
create function public.contact_notificatie_status(
  p_id uuid,
  p_verzonden boolean,
  p_error text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.contact_aanvragen
  set notificatie_verzonden = p_verzonden,
      mail_error = p_error
  where id = p_id;
$$;

comment on function public.contact_notificatie_status(uuid, boolean, text) is
  'D1: markeert notificatie_verzonden/mail_error na de mailstap (gedeelde surface, anon-key). SECURITY DEFINER; raakt alleen ops-velden.';

-- ── Grants: alleen deze drie entrypoints; verder niets op de tabellen ────────
revoke all on function public.resolve_tenant_host(text) from public;
revoke all on function public.contact_aanvraag_insert(text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.contact_notificatie_status(uuid, boolean, text) from public;

grant execute on function public.resolve_tenant_host(text) to anon, authenticated;
grant execute on function public.contact_aanvraag_insert(text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.contact_notificatie_status(uuid, boolean, text) to anon, authenticated;

commit;
