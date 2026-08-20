-- ============================================================================
--  ROLLBACK (PREVIEW ONLY) 2026-08-15 — fictieve fonds_licentie-seed
--
--  Verwijdert alleen de vier demo-licentierijen (pgb, phenc, huisartsenpensioen,
--  meridiaan). Laat de tabelstructuur en eventuele echte rijen ongemoeid.
--  Uitsluitend op Preview draaien.
-- ============================================================================

begin;

delete from public.fonds_licentie
 where fonds_id in (
   select id from public.fondsen
    where slug in ('pgb', 'phenc', 'huisartsenpensioen', 'meridiaan')
 );

commit;
