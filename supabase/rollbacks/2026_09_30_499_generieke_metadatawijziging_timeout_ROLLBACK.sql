-- #499 — terugdraaien van 2026_09_30_499_generieke_metadatawijziging_timeout.sql.
-- Herstelt fn_chunk_denorm_refresh en trg_chunk_denorm_refresh exact naar
-- 2026_08_12_t4_regime_borging (zonder IS DISTINCT FROM-filter en zonder WHEN)
-- en verwijdert de RPC fn_platform_generiek_document_bijwerken.
--
-- LET OP — VOLGORDE: draai deze rollback pas NADAT de applicatiecode is
-- teruggezet naar de tabel-PATCH (vóór #499). De #499-code roept de RPC aan;
-- zonder RPC krijgt elke curatiewijziging PGRST202 (nette melding "tijdelijk
-- niet beschikbaar", er wijzigt niets — maar de curatie ligt dan stil).
-- Na deze rollback geldt weer de 8 s-grens van authenticator voor een
-- wijziging op documenten met veel chunks (het oorspronkelijke #499-probleem).
-- Data: geen. Chunkmetadata blijft consistent (de eindtoestand van beide
-- functies is identiek); reeds geschreven document_metadata_log-regels blijven
-- (append-only).
-- Idempotent.
begin;

drop function if exists public.fn_platform_generiek_document_bijwerken(uuid, jsonb, jsonb, uuid, text, text);

create or replace function public.fn_chunk_denorm_refresh()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.document_chunks dc
     set procesmodel_id     = v.procesmodel_id,
         procesinstantie_id = v.procesinstantie_id,
         vergadering_id     = v.vergadering_id,
         agendapunt_id      = v.agendapunt_id,
         documenttype       = v.documenttype,
         documentstatus     = v.documentstatus,
         documentdatum      = v.documentdatum,
         periode            = v.periode,
         bronstatus         = v.bronstatus,
         geldig_vanaf       = v.geldig_vanaf,
         geldig_tot         = v.geldig_tot,
         bibliotheek        = v.bibliotheek,
         bronorganisatie    = v.bronorganisatie,
         normgewicht        = v.normgewicht,
         extern_url         = v.extern_url,
         wettelijk_regime   = v.wettelijk_regime
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot,
                  bibliotheek, bronorganisatie, normgewicht, extern_url,
                  wettelijk_regime
  on public.documenten
  for each row execute procedure public.fn_chunk_denorm_refresh();

commit;

notify pgrst, 'reload schema';
