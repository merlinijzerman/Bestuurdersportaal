-- ============================================================================
-- ROLLBACK van 2026_08_04_a1_governance_log_inhoud.sql
-- ----------------------------------------------------------------------------
-- ⚠ VOORWAARDE. Draai dit UITSLUITEND zolang code v1 nog niet live is, of nadat
-- die is teruggerold. Zodra de route naar `governance_log_inhoud` schrijft,
-- vernietigt deze rollback de chatinhoud van alle interacties sindsdien: die
-- staat dan namelijk NIET meer in governance_log.vraag/antwoord/bronnen.
--
-- ⚠ EN NIET NA DE CONTRACT-STAP. Is 2026_08_04_a3_governance_log_contract.sql
-- gedraaid, dan bestaan governance_log.vraag/antwoord/bronnen niet meer en is
-- deze tabel de ENIGE plaats waar de inhoud leeft. Rol dan eerst A3 terug (die
-- herstelt de kolommen leeg) en herstel de inhoud uit de geverifieerde kopie.
--
-- `vraag` weer NOT NULL maken kan alleen als er geen rijen met NULL zijn; die
-- ontstaan zodra code v1 heeft gedraaid. De stap staat daarom apart en faalt
-- luid in plaats van stil.
-- ============================================================================

begin;

drop index if exists public.idx_govlog_gesprek_audit;

alter table public.governance_log
  drop column if exists gesprek_audit_id,
  drop column if exists inhoud_hmac,
  drop column if exists hmac_schema_versie,
  drop column if exists hmac_sleutel_versie;

drop policy if exists "eigen loginhoud lezen" on public.governance_log_inhoud;
drop table if exists public.governance_log_inhoud;

-- `vraag` terug naar NOT NULL. Faalt bewust wanneer code v1 al rijen zonder
-- vraag heeft geschreven — die inhoud is dan zojuist met de tabel verdwenen en
-- stil doorgaan zou dat verbergen.
do $$
declare v_leeg int;
begin
  select count(*) into v_leeg from public.governance_log where vraag is null;
  if v_leeg > 0 then
    raise exception
      'ROLLBACK GESTOPT: % rijen in governance_log hebben vraag IS NULL. Code v1 '
      'heeft al gedraaid; hun inhoud stond alleen in governance_log_inhoud. '
      'Herstel eerst uit de geverifieerde kopie.', v_leeg;
  end if;
  alter table public.governance_log alter column vraag set not null;
end $$;

commit;
