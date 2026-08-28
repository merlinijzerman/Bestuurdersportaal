-- P3 / PR-D (#168) — INSERT-slot: een besluit-status ontstaat alleen via de RPC.
-- ---------------------------------------------------------------------------
-- Reviewbevinding HOOG #1. De kolom-revoke (p3d_03) sluit alleen het UPDATE-pad naar
-- `status`; `authenticated` behoudt INSERT (incl. de status-kolom) op decision_objects
-- (RLS is `for all` fonds-only). De I4- en snapshot-triggers vuren op `update of
-- status`, niet op INSERT. Een fondslid kon dus een rij direct met status='besloten'
-- INSERTen — zonder motivering, zonder governance-event, zonder afschrift — en die
-- verscheen in de overzichten als genomen besluit. Dat omzeilt precies de eis die
-- PR-D onomzeilbaar noemt.
--
-- Remedie: een BEFORE INSERT-trigger die de twee BESLUIT-statussen (`besloten`/
-- `voorwaardelijk_besloten`) bij het AANMAKEN weigert VOOR HET POSTGREST-CLIENTPAD
-- (current_user = authenticated/anon). Een besluit-status is een OVERGANG, geen
-- begintoestand — via de client mag hij alleen via fn_besluit_status_omslag ontstaan
-- (die doet een UPDATE en raakt deze trigger niet). Geen legitiem AUTHENTICATED pad
-- INSERT een besluit-status: ensureDecisionForProcedure zet via mapLegacyStatus alleen
-- in_onderbouwing/in_review/afgesloten; de default is 'concept'. De owner (postgres)
-- en service_role blijven vrij — data-backfill/migratie van reeds-besloten dossiers
-- loopt daarlangs en is geen fondslid-fabricatie. Getoetst.
--
-- Samen met p3d_03 (UPDATE-revoke) kan `authenticated` een decision langs GEEN enkel
-- direct pad in een besluit-status brengen — de RPC is het enige pad, en die dwingt
-- de motivering af. De bredere `for all`-fondsisolatie (fabricatie van ANDERE velden/
-- statussen, is_primary-writes, DELETE) blijft het defect van #214, eigen tranche.
--
-- HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_28_p3d_05_insert_besluitstatus_slot_ROLLBACK.sql

begin;

create or replace function public.fn_guard_decision_insert_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Alleen het PostgREST-clientpad weren (current_user = authenticated/anon). De
  -- owner (postgres) en service_role mogen wél een besluit-status INSERTen: data-
  -- backfill/migratie van reeds-besloten dossiers en beheertaken lopen daarlangs, en
  -- die zijn geen fondslid-fabricatie. De fabricatievector (#1) is juist de directe
  -- PostgREST-insert door een ingelogd fondslid.
  if new.status in ('besloten', 'voorwaardelijk_besloten')
     and current_user in ('authenticated', 'anon') then
    raise exception
      'Een besluit-status ontstaat via een overgang (fn_besluit_status_omslag), niet bij het aanmaken.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- Grants als de i1-guard-triggerfuncties: alleen service_role behoudt EXECUTE
-- (triggers vuren sowieso los van directe grants; anon/authenticated hebben niets
-- te zoeken bij een directe aanroep).
revoke all on function public.fn_guard_decision_insert_status() from public, anon, authenticated;
grant execute on function public.fn_guard_decision_insert_status() to service_role;

drop trigger if exists trg_decision_insert_status_slot on public.decision_objects;
create trigger trg_decision_insert_status_slot
  before insert on public.decision_objects
  for each row execute procedure public.fn_guard_decision_insert_status();

commit;
