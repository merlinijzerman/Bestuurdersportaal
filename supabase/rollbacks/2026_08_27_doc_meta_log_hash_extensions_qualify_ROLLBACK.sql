-- ROLLBACK van 2026_08_27_doc_meta_log_hash_extensions_qualify.sql.
-- Herstelt de ONGEKWALIFICEERDE digest()-vorm. LET OP: die faalt (42883) zodra
-- document_metadata_log geneste vanuit een gepinde search_path wordt geschreven —
-- draai alleen terug samen met de notulen-ketenmigratie. Hashuitkomst identiek.
begin;

create or replace function public.fn_doc_meta_log_hash()
returns trigger language plpgsql as $f$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
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
