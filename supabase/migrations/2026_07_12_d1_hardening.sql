-- ============================================================================
-- Migratie 2026-07-12 — D1-hardening (security-review C1/D1, B1 + B2).
-- ----------------------------------------------------------------------------
-- Volgt op 2026_07_12_d1_service_role_rpcs.sql. De review stelde vast dat de
-- contact-insert nu (bewust) met de anon-key aanroepbaar is en dat de route-
-- guards + de op p_ip_hash leunende rate-limit dan geen datalaag-grens meer zijn.
-- Deze migratie begrenst de nu-anon-bereikbare schrijf-surface DB-side:
--
--  B1 (payload): lengte-CHECK op contact_aanvragen, zodat een directe RPC-insert
--     geen storage-bom kan zijn. Bounds == de bestaande TS-validatie
--     (core/lib/contact-validatie.ts VELD_MAX); bestaande rijen zijn TS-
--     gevalideerd en vallen binnen deze grenzen. mail_error zit NIET in de
--     tabel-CHECK (bestaande foutteksten kunnen lang zijn) maar wordt in de RPC
--     gekapt.
--  B2: contact_notificatie_status is one-shot gescope't — alleen een recente,
--     nog niet gemarkeerde rij — en kapt mail_error. Voorkomt dat een anon-caller
--     met een (bekende/gelekte) uuid de opvolg-status van willekeurige rijen
--     overschrijft of vrije tekst blijft wegschrijven.
--
-- RLS/tenant-isolatie: ongewijzigd (globale, niet-tenant tabel). Idempotent
-- (drop constraint if exists + create or replace). Backward-compatibel met de
-- reeds gedeployde D1-code (zelfde functiesignatuur; TS-inserts vallen binnen de
-- CHECK). ROLLBACK: apart bestand.
-- ============================================================================

begin;

-- ── B1 — lengte-begrenzing op de anon-bereikbare insert ─────────────────────
alter table public.contact_aanvragen
  drop constraint if exists contact_aanvragen_lengtes;
alter table public.contact_aanvragen
  add constraint contact_aanvragen_lengtes check (
    char_length(naam) <= 200
    and char_length(organisatie) <= 200
    and char_length(rol) <= 200
    and char_length(email) <= 254
    and (telefoon is null or char_length(telefoon) <= 50)
    and char_length(bericht) <= 5000
    and (herkomst_pagina is null or char_length(herkomst_pagina) <= 255)
    and char_length(privacy_version) <= 50
  );

-- ── B2 — contact_notificatie_status gescope't + mail_error gekapt ───────────
create or replace function public.contact_notificatie_status(
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
      mail_error = left(p_error, 500)
  where id = p_id
    and aangemaakt_op >= now() - interval '1 hour'
    and notificatie_verzonden = false;
$$;

comment on function public.contact_notificatie_status(uuid, boolean, text) is
  'D1-hardening: markeert notificatie_verzonden/mail_error na de mailstap (anon-key). One-shot: alleen een recente (<=1u), nog niet gemarkeerde rij; mail_error gekapt op 500.';

commit;
