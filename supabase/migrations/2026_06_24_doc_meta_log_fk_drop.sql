-- ============================================================================
-- document_metadata_log.document_id: FK naar documenten verwijderen (besluit 0024).
-- ----------------------------------------------------------------------------
-- Probleem: de FK stond op ON DELETE SET NULL, maar document_metadata_log is
-- append-only (before update/delete-guards, migratie 2026_06_18 r.354-369). Een
-- SET NULL bij het verwijderen van een document is een UPDATE op de logrij -> de
-- append-only-guard weigert dat -> de DELETE van het document rolt terug. Daardoor
-- kon GEEN enkel (generiek) document met audithistorie ooit hard-verwijderd
-- worden, terwijl de FK-clausule (SET NULL) dat juist suggereerde: een latente
-- tegenstrijdigheid die nooit kon uitvoeren.
--
-- Oplossing (besluit 0024, optie A): de FK droppen en document_id als kale uuid
-- behouden. De auditrij OVERLEEFT daarmee een hard-delete van het document, met
-- de oorspronkelijke document_id intact -- precies wat een onveranderbaar
-- auditlog hoort te doen (audit overleeft de data). Append-only blijft volledig
-- intact: er wordt nooit een logrij ge-UPDATE of ge-DELETE. De hard-delete in de
-- generieke bibliotheek (curatieVerwijderen) kan de documentrij hierna wel
-- verwijderen; de chunks worden expliciet weggehaald, document_processing_jobs
-- cascadeert, en de overige verwijzingen staan al op ON DELETE SET NULL.
--
-- Idempotent: dropt de FK ongeacht de exacte constraintnaam, en doet niets als
-- hij al weg is. Draai dit in Supabase VOORDAT je de hard-delete gebruikt
-- (migratie-eerst-dan-deploy; de code zelf heeft deze migratie niet nodig om te
-- compileren, maar de delete faalt zonder).
-- ============================================================================

do $$
declare
  v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class rel       on rel.oid = con.conrelid
  join pg_namespace nsp   on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'document_metadata_log'
    and con.contype = 'f'
    and con.confrelid = 'public.documenten'::regclass
    and (
      select attname from pg_attribute
      where attrelid = con.conrelid and attnum = con.conkey[1]
    ) = 'document_id';

  if v_con is not null then
    execute format('alter table public.document_metadata_log drop constraint %I', v_con);
    raise notice 'FK % gedropt op document_metadata_log.document_id', v_con;
  else
    raise notice 'Geen FK op document_metadata_log.document_id gevonden (al gedropt?)';
  end if;
end $$;

comment on column public.document_metadata_log.document_id is
  'Verwijzing naar het gewijzigde document. Bewust GEEN FK (besluit 0024): het '
  'append-only auditlog overleeft een hard-delete van het document; de id blijft '
  'als historische verwijzing staan, ook als het document niet meer bestaat.';

-- ── ROLLBACK (FK herstellen; let op: blokkeert hard-delete weer) ────────────
-- alter table public.document_metadata_log
--   add constraint document_metadata_log_document_id_fkey
--   foreign key (document_id) references public.documenten(id) on delete set null;
