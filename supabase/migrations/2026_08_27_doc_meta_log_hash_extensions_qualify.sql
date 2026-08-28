-- ==========================================================================
-- 2026-08-27 — fn_doc_meta_log_hash: extensions.digest kwalificeren (#183b spoor T)
-- --------------------------------------------------------------------------
-- TWEEDE voorkomen van hetzelfde latente gebrek als fn_govevent_hash (zie
-- 2026_08_27_govevent_hash_extensions_qualify.sql en het gate-gat-ticket
-- TICKET-GATE-ONGEKWALIFICEERDE-EXTENSIE-AANROEPEN.md). fn_doc_meta_log_hash roept
-- digest() ONGEKWALIFICEERD aan en heeft geen eigen search_path. Zolang
-- document_metadata_log via PostgREST wordt geschreven werkt dat (authenticated
-- draagt `extensions`); maar de notulen-RPC's (fn_notulen_segment_bevestig/
-- _verwijder) hebben `set search_path = public, pg_temp` en roepen
-- fn_notulen_segment_audit → document_metadata_log GENEST aan → de hash-trigger
-- erft die path en vindt digest niet (42883).
--
-- Fix: extensions.digest — DEZELFDE functie, IDENTIEKE hashuitkomst → geen
-- ketenbreuk, bestaande document_metadata_log-hashes blijven verifieerbaar.
-- Bereikbaarheid gemeten: dit is de enige extra unqualified-digest-functie die
-- geneste vanuit een #183b-spoor-T-functie wordt aangeroepen. De overige
-- (fn_bron_whitelist_log_hash, fn_decision_snapshot) zijn NIET bereikbaar vanuit
-- dit spoor en horen bij het bredere gate-ticket, niet hier.
-- ==========================================================================

begin;

create or replace function public.fn_doc_meta_log_hash()
returns trigger language plpgsql as $f$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    extensions.digest(
      coalesce(new.document_id::text,'') || '|' ||
      coalesce(new.veld_naam,'')         || '|' ||
      coalesce(new.oude_waarde,'')       || '|' ||
      coalesce(new.nieuwe_waarde,'')     || '|' ||
      coalesce(new.wijzig_reden,'')      || '|' ||
      coalesce(new.wijzig_type,'')       || '|' ||
      coalesce(new.rag_impact::text,'')  || '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$f$;

commit;
