-- ============================================================================
--  #423 T4-D — ROLLBACK FASE 3 van 4: de rolloutpoorten weg
-- ----------------------------------------------------------------------------
--  VOORWAARDE   fase 2 is gedraaid ÉN de oude applicatiecode draait aantoonbaar.
--
--  WAAROM PAS HIER, NA DE DEPLOY (correctie na review op PR #425)
--    Deze fase verwijdert `copilot_lees_readiness`. Dat is juist de functie
--    waarmee de NIEUWE code vaststelt dat de kill switch uit staat. Zou zij
--    verdwijnen terwijl die code nog draait, dan faalt elke retrievalbeurt op
--    een ontbrekend leespad in plaats van netjes inert te zijn — een storing
--    veroorzaakt door de rollback zelf. Dezelfde redenering geldt voor
--    `copilot_rollout`: readiness leest die tabel, dus haar eerder droppen
--    breekt readiness net zo goed.
--
--  WAT BLIJFT STAAN, BEWUST
--    `microsoft_private.copilot_operator_log` en zijn append-only trigger. Dat
--    is auditdata: wie de rem wanneer en waarom bediende. CLAUDE.md stelt
--    append-only audit als niet-onderhandelbaar, en een rollback is geen
--    vrijbrief om dat spoor stilletjes te wissen. Wil je haar tóch kwijt, dan is
--    dat een aparte bewuste handeling: eerst exporteren, dan expliciet akkoord
--    op het auditverlies, dan handmatig droppen. Dit bestand doet het niet.
--
--  SQL-EDITORVAST: geen psql-metacommando's; één transactie.
--
--  VUL IN: de bevestiging op 'ja', en het WAARGENOMEN deploymoment als
--          tijdstempel (bijvoorbeeld 2026-09-21T14:05:00+02:00).
-- ============================================================================
begin;

select set_config('t4d.oude_code_gedeployd', 'VUL_IN', true),
       set_config('t4d.deploy_moment', 'VUL_IN', true);

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
declare v_vers integer; v_moment timestamptz;
begin
  if coalesce(current_setting('t4d.oude_code_gedeployd', true), '') <> 'ja' then
    raise exception 'FASE 3 geweigerd: zet bovenaan dit bestand de bevestiging op ''ja'' zodra de oude applicatiecode draait. Vóór die deploy haalt deze fase het leespad weg onder code die het nog nodig heeft.';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_rollout'
  ) then
    if exists (select 1 from microsoft_private.copilot_rollout where aan) then
      raise exception 'FASE 3 geweigerd: de kill switch staat nog AAN. Draai eerst fase 1.';
    end if;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling' and p.pronargs = 12
  ) then
    raise exception 'FASE 3 geweigerd: fase 2 is niet gedraaid; de twaalf-parametersignatuur bestaat niet. De oude code kan dan niet draaien, dus de bevestiging hierboven kan niet kloppen.';
  end if;

  -- Schrijft er nog iets een client-id? Dan draait de nieuwe code nog en is de
  -- bevestiging hierboven te goeder trouw maar onjuist.
  -- Het WAARGENOMEN deploymoment is de scherpe grens. Een vast venster van een
  -- uur zou een correcte rollback nog een uur tegenhouden om koppelingen die
  -- van vóór de deploy stammen — terecht geschreven door code die toen nog
  -- draaide. Alleen writes ná dat moment zeggen iets over de huidige stand.
  begin
    v_moment := coalesce(current_setting('t4d.deploy_moment', true), '')::timestamptz;
  exception when others then
    raise exception 'FASE 3 geweigerd: vul bovenaan dit bestand het waargenomen deploymoment in als tijdstempel, bijvoorbeeld 2026-09-21T14:05:00+02:00.';
  end;
  if v_moment > now() then
    raise exception 'FASE 3 geweigerd: het opgegeven deploymoment (%) ligt in de toekomst; dan meet de controle een leeg venster en stelt zij niets vast.', v_moment;
  end if;
  if v_moment > now() - interval '2 minutes' then
    raise notice 'LET OP: het deploymoment is nog geen twee minuten geleden. Neem de deploy eerst werkelijk waar; de controle hieronder meet dan pas iets.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'microsoft_private' and table_name = 'verbindingen'
       and column_name = 'client_id'
  ) then
    execute $q$
      select count(*) from microsoft_private.verbindingen
       where client_id is not null and gekoppeld_op > $1
    $q$ into v_vers using v_moment;
    if v_vers > 0 then
      raise exception 'FASE 3 geweigerd: % koppeling(en) met een gevulde client_id NA het opgegeven deploymoment (%). Er draait nog een instantie op de nieuwe code.', v_vers, v_moment;
    end if;
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
       and p.proname not in ('copilot_log_append_only', 'copilot_rollback_herstel_bewaar_koppeling')
  ) rest;
  if v_rest is not null then
    raise exception 'FASE 3 mislukt: deze copilot-objecten staan er nog: %', v_rest;
  end if;

  -- ── Auditslot: tabel ÉN de append-only trigger ──────────────────────────
  -- Een append-only tabel zonder haar trigger is geen append-only tabel. Een
  -- destructieve rollback voortzetten terwijl het operatorspoor onbeschermd is,
  -- is precies het moment waarop je moet stoppen. Schemagekwalificeerd, want
  -- `relname` alleen kan een gelijknamige tabel in een ander schema treffen.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_operator_log'
       and c.relkind = 'r'
  ) then
    raise exception 'FASE 3 mislukt: copilot_operator_log ontbreekt in microsoft_private; dat is auditdata en hoort te blijven staan';
  end if;
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_operator_log'
       and not t.tgisinternal
  ) then
    raise exception 'FASE 3 mislukt: de append-only trigger op copilot_operator_log ontbreekt; het auditspoor is muteerbaar';
  end if;

  -- De generator uit fase 2 moet blijven: fase 4 heeft haar nodig.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'copilot_rollback_herstel_bewaar_koppeling'
  ) then
    raise exception 'FASE 3 mislukt: de generator uit fase 2 is weg; fase 4 kan bewaar_koppeling dan niet hergenereren';
  end if;

  raise notice 'FASE 3 geslaagd: poorten weg, auditspoor behouden. Fase 4 is onomkeerbaar; draai haar pas als je de kolomwaarden niet meer nodig hebt.';
end $$;

commit;
