-- ============================================================================
-- Migratie 2026-08-04 (A3) — CONTRACT-stap: chatinhoud uit het auditspoor
-- ----------------------------------------------------------------------------
-- ⛔ NIET PLAKKEN VOORDAT DEZE DRIE DINGEN AANTOONBAAR KLOPPEN ⛔
--
--   1. Code v1 draait in productie en schrijft via schrijf_ai_interactie(),
--      dus naar governance_log_inhoud. Toets:
--        select count(*) from public.governance_log
--         where aangemaakt > '<moment van de code-deploy>' and vraag is not null;
--      → moet 0 zijn. Is het >0, dan schrijft er nog een pad naar de oude kolom
--        en zou deze migratie díé inhoud vernietigen.
--
--   2. De backfill uit A1 is compleet. Toets:
--        select count(*) from public.governance_log gl
--         where gl.vraag is not null
--           and not exists (select 1 from public.governance_log_inhoud i
--                            where i.log_id = gl.id);
--      → moet 0 zijn.
--
--   3. Er is een GEVERIFIEERDE kopie van governance_log, mét terugleestoets.
--      Deze stap is de enige in plateau A die niet terug te draaien is: de
--      rollback herstelt de kolommen LEEG, niet hun inhoud.
--
-- WAAROM DIT MOET. Zonder deze stap blijven vraag, antwoord en bronnen in het
-- append-only spoor staan en is "de gebruiker kan zijn gesprek verwijderen"
-- niet waar te maken: DELETE op governance_log is geblokkeerd door
-- fn_log_append_only(), en dat blijft zo — terecht.
--
-- WAT DEZE STAP NIET DOET. Hij raakt `retrieval_meta` niet. Historische rijen
-- dragen daar nog inhoudsleutels (`zoekvraag`, `sources[].fragment`,
-- `scope.titels`). Die worden niet herschreven — een UPDATE op een append-only
-- tabel is precies wat we niet doen. De bescherming komt van twee andere kanten:
-- de herziene RLS (auteur of capability) en de allowlist-projectie
-- meta_basisniveau()/meta_bronniveau(). Restrisico: een auditor MÉT
-- governance_audit_read_sources ziet in oude rijen nog de zoekvraag. Bewust
-- geaccepteerd; vastgelegd in 00 Overzicht en status/openstaande-punten-en-
-- risicos.md.
--
-- Idempotent (drop column if exists). Transactioneel.
-- ROLLBACK: 2026_08_04_a3_governance_log_contract_ROLLBACK.sql (herstelt LEEG)
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- Fail-closed voorportaal: weiger te droppen zolang er inhoud is die nog niet in
-- governance_log_inhoud staat. Een migratie die data vernietigt hoort niet stil
-- door te lopen omdat iemand stap 2 hierboven oversloeg.
do $$
declare v_ontbreekt int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='governance_log'
                    and column_name='vraag') then
    raise notice 'A3: kolommen al gedropt — niets te doen.';
    return;
  end if;

  select count(*) into v_ontbreekt
    from public.governance_log gl
   where gl.vraag is not null
     and not exists (select 1 from public.governance_log_inhoud i where i.log_id = gl.id);

  if v_ontbreekt > 0 then
    raise exception
      'A3 GESTOPT: % auditregels hebben een vraag die NIET in governance_log_inhoud '
      'staat. Draai eerst de backfill uit 2026_08_04_a1_governance_log_inhoud.sql; '
      'droppen zou deze inhoud vernietigen.', v_ontbreekt;
  end if;
end $$;

alter table public.governance_log
  drop column if exists vraag,
  drop column if exists antwoord,
  drop column if exists bronnen;

comment on table public.governance_log is
  'Append-only auditspoor van AI-interacties. Draagt GEEN chatinhoud meer: '
  'vraag, antwoord en bronnen leven sinds plateau A in public.'
  'governance_log_inhoud en zijn daar verwijderbaar. retrieval_meta bevat '
  'uitsluitend spoorsleutels (allowlist: core/lib/audit-meta.ts); de '
  'leesprojectie meta_basisniveau()/meta_bronniveau() schermt historische '
  'rijen af die die splitsing nog niet hadden.';

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. AC-2 — geen kolommen met vraag- of antwoordtekst meer (moet 0 zijn):
--      select count(*) from information_schema.columns
--       where table_schema='public' and table_name='governance_log'
--         and column_name in ('vraag','antwoord','bronnen');
-- 2. Het spoor is intact — het rijaantal is ongewijzigd t.o.v. vóór de migratie.
-- 3. De governancepagina en het dashboard tonen nog steeds vragen (die komen nu
--    uit governance_log_inhoud, alleen voor de eigen regels).
-- 4. P5-signalen 3, 4 en 6 blijven gevuld (retrieval_meta is niet geraakt).
