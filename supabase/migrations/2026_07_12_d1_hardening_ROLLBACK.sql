-- ============================================================================
-- ROLLBACK van 2026_07_12_d1_hardening.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de lengte-CHECK en zet contact_notificatie_status terug naar de
-- ongescope'te versie uit 2026_07_12_d1_service_role_rpcs.sql. Alleen draaien als
-- de hardening bewust wordt teruggedraaid (niet aanbevolen).
-- ============================================================================
begin;

alter table public.contact_aanvragen
  drop constraint if exists contact_aanvragen_lengtes;

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
      mail_error = p_error
  where id = p_id;
$$;

commit;
