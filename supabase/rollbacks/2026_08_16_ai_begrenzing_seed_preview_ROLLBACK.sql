-- ============================================================================
--  ROLLBACK van 2026_08_16_ai_begrenzing_seed_preview.sql (besluit 0180)
--
--  Verwijdert de vier quotumrijen en laat de tabel leeg achter — de stand direct
--  na de basismigratie.
--
--  LET OP: een lege ai_quota_config betekent dat de preflight ALLES weigert
--  (fail-closed). Draai dit dus alleen als onderdeel van een volledige rollback,
--  of wanneer je de quota direct daarna opnieuw zet. Wil je alleen andere
--  waarden, gebruik dan /platform/ai-begrenzing — daar loopt de wijziging via
--  het reguliere beheerpad met auditspoor, en dit script niet.
--
--  IDEMPOTENT: `delete ... where sleutel in (...)`.
-- ============================================================================

begin;

delete from public.ai_quota_config
 where sleutel in ('gebruiker_maand','fonds_maand','globaal_maand','ocr_fonds_maand');

do $$
declare
  n int;
begin
  select count(*) into n from public.ai_quota_config;
  if n <> 0 then
    raise exception 'SEED-ROLLBACK FAALT: er staan nog % quotumrijen', n;
  end if;
  raise notice 'SEED-ROLLBACK OK: ai_quota_config is leeg — de preflight weigert nu fail-closed alles.';
end $$;

commit;
