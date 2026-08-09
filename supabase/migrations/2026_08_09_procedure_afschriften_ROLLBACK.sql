-- ============================================================================
-- ROLLBACK 2026-08-09 — T6: auditdossier-afschriften (procedure_afschriften)
-- ----------------------------------------------------------------------------
-- Draait 2026_08_09_procedure_afschriften.sql terug. Idempotent (drop if exists).
--
-- LET OP:
--  * Draai dit alleen als de T6-code (routes + worker) NIET meer gedeployed is.
--  * Deze rollback WEIGERT te draaien als er nog afschrift-rijen bestaan — die
--    zijn permanente archiefstukken (uitgangspunt 5); het per ongeluk droppen
--    van de tabel zou ze vernietigen. Verwijder/archiveer ze eerst bewust.
--  * De bucket 'afschriften' wordt NIET automatisch verwijderd: `delete from
--    storage.buckets` faalt zolang er objecten in staan. Maak de bucket eerst
--    handmatig leeg en verwijder hem daarna (onderaan, uitgecommentarieerd).
-- ============================================================================

begin;

-- Veiligheidsgrendel: geen data stilzwijgend vernietigen.
do $$
declare
  v_aantal integer;
begin
  select count(*) into v_aantal from public.procedure_afschriften;
  if v_aantal > 0 then
    raise exception
      'ROLLBACK geweigerd: % afschrift-rij(en) aanwezig. Afschriften zijn permanente archiefstukken; verwijder ze eerst bewust voordat je de tabel dropt.',
      v_aantal;
  end if;
end $$;

-- Storage-leespolicy weg.
drop policy if exists "afschriften storage lezen" on storage.objects;

-- Claim-RPC weg.
drop function if exists public.afschriften_claim_jobs(text, integer, integer);

-- Tabel (met triggers, policies, indexen) weg.
drop trigger if exists trg_procedure_afschriften_no_delete on public.procedure_afschriften;
drop table if exists public.procedure_afschriften;

commit;

-- ── Bucket handmatig verwijderen (alleen als hij leeg is) ────────────────────
-- delete from storage.buckets where id = 'afschriften';
