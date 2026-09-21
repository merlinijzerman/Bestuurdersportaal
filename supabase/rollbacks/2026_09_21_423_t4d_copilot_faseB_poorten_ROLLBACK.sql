-- ============================================================================
--  #423 T4-D — ROLLBACK FASE B: de rolloutpoorten weg
-- ----------------------------------------------------------------------------
--  VOORWAARDE   fase A is gedraaid: de kill switch staat aantoonbaar uit.
--  GEVOLG       readiness, de operatorfuncties en de operationele poorttabellen
--               verdwijnen. De applicatiecode die ze leest mag daarna niet meer
--               draaien — in de praktijk draait zij ze toch al niet aan, want
--               de kill switch is uit.
--
--  WAT BLIJFT STAAN, BEWUST
--    `microsoft_private.copilot_operator_log` en zijn append-only trigger.
--    Dat is auditdata: wie de rem wanneer en waarom heeft bediend. CLAUDE.md
--    stelt append-only audit als niet-onderhandelbaar, en een rollback is geen
--    vrijbrief om dat spoor stilletjes te wissen. De tabel is leeg van
--    operationele betekenis zodra de functies weg zijn; laat haar staan.
--    Wil je haar tóch kwijt, dan is dat een aparte, bewuste handeling: eerst
--    exporteren, dan expliciet akkoord op het auditverlies, dan handmatig
--    droppen. Dit bestand doet het niet voor je.
--
--  GEBRUIK
--    psql "$DB" -v ON_ERROR_STOP=1 \
--         -f supabase/rollbacks/2026_09_21_423_t4d_copilot_faseB_poorten_ROLLBACK.sql
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Preflight: fase A aantoonbaar ───────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_rollout'
  ) then
    raise exception 'FASE B kan niet: copilot_rollout bestaat niet. Migratie 423a is niet toegepast, of fase B is al gedraaid.';
  end if;
  if exists (select 1 from microsoft_private.copilot_rollout where aan) then
    raise exception 'FASE B geweigerd: de kill switch staat nog AAN. Draai eerst fase A — anders haal je de poorten weg onder een arm die nog open staat.';
  end if;
  if not exists (
    select 1 from microsoft_private.copilot_operator_log where handeling = 'copilot.rollout.uit'
  ) then
    raise notice 'LET OP: geen auditspoor van een kill switch-uit. De arm heeft mogelijk nooit aan gestaan; controleer dat dit klopt voordat je doorgaat.';
  end if;
end $$;

-- ── Poorten weg ─────────────────────────────────────────────────────────────
drop function if exists microsoft_private.copilot_zet_billingbewijs(uuid, boolean, text, text);
drop function if exists microsoft_private.copilot_zet_rollout(boolean, text, text);
drop function if exists microsoft_private.copilot_lees_readiness(uuid, uuid);
drop function if exists microsoft_private.copilot_registreer_blokkade(uuid, uuid, timestamptz, text);

drop table if exists microsoft_private.copilot_blokkade;
drop table if exists microsoft_private.copilot_billingbewijs;
drop table if exists microsoft_private.copilot_rollout;

-- ── Eindcontrole ────────────────────────────────────────────────────────────
do $$
declare v_rest text;
begin
  select string_agg(naam, ', ') into v_rest from (
    select c.relname as naam
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relkind in ('r','p','v','m')
       and c.relname like 'copilot\_%' and c.relname <> 'copilot_operator_log'
    union all
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname like 'copilot\_%'
       and p.proname <> 'copilot_log_append_only'
  ) rest;
  if v_rest is not null then
    raise exception 'FASE B mislukt: deze copilot-objecten staan er nog: %', v_rest;
  end if;

  -- De audit moet er juist WÉL nog staan, mét zijn slot.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_operator_log'
  ) then
    raise exception 'FASE B mislukt: copilot_operator_log is verdwenen; dat is auditdata en hoort te blijven staan';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'copilot_operator_log' and not t.tgisinternal
  ) then
    raise exception 'FASE B mislukt: de append-only trigger op copilot_operator_log is weg';
  end if;

  raise notice 'FASE B geslaagd: poorten weg, auditspoor behouden. Zet nu de oude applicatiecode klaar en draai daarna fase C.';
end $$;
