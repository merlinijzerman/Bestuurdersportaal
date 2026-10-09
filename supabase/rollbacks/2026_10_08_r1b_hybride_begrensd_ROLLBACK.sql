-- R1b-rollback (fase H4a): verwijder uitsluitend de nieuwe hybride RPC. Het
-- bestaande zoek_chunks_hybride-pad en de volledige HNSW-index blijven intact.
-- Zet ZOEK_HYBRIDE_V2 eerst uit; bij PGRST202 valt de app anders terug op het
-- bestaande pad en meldt dat als terminale auditmarker.
--
-- De PARTIËLE INDEX verwijdert dit script bewust NIET meer: DROP INDEX binnen
-- een transactie neemt een ACCESS EXCLUSIVE-lock op document_chunks (alle
-- lezers en schrijvers wachten). Dat gebeurt apart, concurrent en met eigen
-- poort: scripts/ops/r1b/h4b-partiele-index-verwijderen.psql (fase H4b).
begin;
-- Wacht niet onbegrensd op een lock: liever afbreken en later opnieuw.
set local lock_timeout = '5s';

-- Na een latere single-index-cutover is dit rollbackscript NIET voldoende.
-- Voorkom dat het de enige overgebleven HNSW-index verwijdert: bouw en
-- verifieer eerst de volledige index via het afzonderlijke hersteldraaiboek.
-- Bestaan is niet genoeg: een afgebroken CREATE INDEX CONCURRENTLY laat een
-- ONGELDIGE index met dezelfde naam achter. Eis daarom geldig én gereed én de
-- oorspronkelijke definitie.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'idx_chunks_embedding'
      and i.indisvalid and i.indisready
      and pg_catalog.pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX idx_chunks_embedding ON public.document_chunks USING hnsw (embedding vector_cosine_ops)'
  ) then
    raise exception 'R1b rollback geweigerd: volledige HNSW-index ontbreekt of is ongeldig; herstel die eerst';
  end if;
end $$;

drop function if exists public.zoek_chunks_hybride_begrensd(
  text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid
);

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'zoek_chunks_hybride_begrensd'
  ) then
    raise exception 'R1b rollback: een overload van zoek_chunks_hybride_begrensd bestaat nog';
  end if;
  if (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'zoek_chunks_hybride'
  ) <> 1 then
    raise exception 'R1b rollback: bestaande hybride RPC heeft niet één overload';
  end if;
  if not has_function_privilege('authenticated',
    'public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid)', 'execute')
    or not has_function_privilege('service_role',
    'public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid)', 'execute')
  then
    raise exception 'R1b rollback: bestaande hybride RPC mist EXECUTE';
  end if;
end $$;

commit;
