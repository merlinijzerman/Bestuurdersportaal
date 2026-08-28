-- ROLLBACK van 2026_08_27_govevent_tenantketen.sql (besluit 0192).
-- Herstelt de decision_id-only policy en verwijdert de fonds_id-sleutel + trigger.
-- LET OP: draai dit alleen terug als óók de spoor-T-brontabel-triggers zijn
-- teruggedraaid — die schrijven fonds_id en leunen op fn_govevent_fonds.

begin;

drop trigger if exists trg_govevent_fonds on public.governance_events;
drop function if exists public.fn_govevent_fonds();

-- Policy terug naar de oorspronkelijke, uitsluitend decision_id-gescopete vorm.
drop policy if exists "fonds governance_events" on public.governance_events;
create policy "fonds governance_events" on public.governance_events
  using (
    decision_id in (
      select d.id from public.decision_objects d
      where d.fonds_id = (select p.fonds_id from public.profielen p where p.id = auth.uid())
    )
  )
  with check (
    decision_id in (
      select d.id from public.decision_objects d
      where d.fonds_id = (select p.fonds_id from public.profielen p where p.id = auth.uid())
    )
  );

-- Composite FK (I5/§4.5) + zijn doel-unieke eerst weg (vóór de kolom).
alter table public.governance_events
  drop constraint if exists governance_events_decision_zelfde_fonds;
alter table public.decision_objects
  drop constraint if exists decision_objects_id_fonds_uniek;

alter table public.governance_events
  drop constraint if exists governance_events_fonds_id_fkey;
alter table public.governance_events
  drop column if exists fonds_id;

commit;
