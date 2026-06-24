-- ============================================================================
-- Storage-quarantainezone bij 2026-06-24 (Increment P1, FO §8.2).
-- ----------------------------------------------------------------------------
-- De uploadsecurity-pipeline (fail-closed scan) heeft een APARTE, private bucket
-- nodig waar een verdacht/ongescand bestand naartoe gaat zónder dat het ooit in
-- de leesbare 'documenten'-bucket belandt. Pas ná een schone scan promoveert de
-- server-action (service-role) het bestand naar 'documenten'; een verdacht
-- bestand blijft hier en wordt nooit gecureerd/gechunkt.
--
-- Beleid: deny-by-default voor ALLE niet-service-role-rollen. De anon-key (tenant
-- én platform-sessie via PostgREST) ziet of raakt deze bucket NIET — er zijn
-- bewust GEEN policies. Alle toegang loopt via de service-role-client achter
-- withPlatform (lib/supabase-platform.ts), die RLS bypasst. Dit spiegelt de
-- deny-by-default van de P0-platformtabellen (2026_06_23) en de quarantaine-
-- gedachte: niets leesbaar tot de scan slaagt.
--
-- Storage-policies leven in het storage-schema en worden los van de tabel-
-- migraties beheerd. Draai dit bestand HANDMATIG in Supabase, in dezelfde
-- migratie-eerst-dan-deploy-slag als 2026_06_24_p1_generieke_curatie.sql.
-- Idempotent.
-- ============================================================================

-- Private bucket. public=false → geen publieke URL's; toegang uitsluitend via
-- signed URLs of de service-role. on conflict houdt de insert idempotent.
insert into storage.buckets (id, name, public)
values ('documenten-quarantaine', 'documenten-quarantaine', false)
on conflict (id) do nothing;

-- Deny-by-default: bewust GEEN select/insert/update/delete-policy. Zonder
-- permissive policy weigert RLS elke anon-/authenticated-rol. De service-role
-- bypasst RLS en is zo de enige die schrijft (quarantaine-upload) en leest
-- (promotie naar 'documenten' of definitieve afkeuring).
--
-- Defensief: verwijder eventueel eerder (per ongeluk) aangemaakte policies op
-- deze bucket, zodat de zone gegarandeerd dicht staat. Geen-op als ze ontbreken.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and qual       like '%documenten-quarantaine%'
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- ── Verificatie (informatief) ───────────────────────────────────────────────
do $$
begin
  raise notice 'P1: quarantaine-bucket private = %.',
    (select not public from storage.buckets where id = 'documenten-quarantaine');
end $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Alleen draaien als de bucket leeg is (anders verwijder je bestanden — eerst
-- handmatig leegmaken/afhandelen). Geen policies om te droppen (deny-by-default).
-- delete from storage.buckets where id = 'documenten-quarantaine';
