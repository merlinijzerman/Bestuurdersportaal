-- ==========================================================================
-- 2026-08-27 — fn_govevent_hash: extensions.digest kwalificeren (#183b spoor T)
-- --------------------------------------------------------------------------
-- LATENT GEBREK, blootgelegd door de #183b-brontabel-triggers. fn_govevent_hash
-- roept digest() ONGEKWALIFICEERD aan. Dat werkte zolang de aanroeper
-- 'extensions' in zijn search_path had (PostgREST/authenticated-rol), maar faalt
-- met 42883 (`function digest(text, unknown) does not exist`) zodra de trigger
-- wordt aangeroepen vanuit een functie die een gepinde search_path zonder
-- 'extensions' zet — precies wat fn_stemming_ketengebeurtenis c.s. doen (0182:
-- pin search_path). De geneste hash-trigger ERFT die path en vindt digest niet.
--
-- Fix: kwalificeer als extensions.digest — exact zoals fn_platform_event_hash al
-- doet sinds 2026_08_15. digest en extensions.digest zijn DEZELFDE functie, dus
-- de HASHUITKOMST is identiek → geen ketenbreuk, bestaande hashes blijven geldig.
-- (encode/now zijn pg_catalog-ingebouwd en altijd resolvebaar; digest is de enige
-- extensie-aanroep, dus hierna is de functie self-contained ongeacht search_path.)
-- ==========================================================================

begin;

create or replace function public.fn_govevent_hash()
returns trigger
language plpgsql
as $$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    extensions.digest(
      coalesce(new.event_type,'')        || '|' ||
      coalesce(new.decision_id::text,'') || '|' ||
      coalesce(new.object_type,'')       || '|' ||
      coalesce(new.object_id::text,'')   || '|' ||
      coalesce(new.oude_waarde::text,'') || '|' ||
      coalesce(new.nieuwe_waarde::text,'')|| '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$$;

commit;
