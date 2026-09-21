-- ============================================================================
--  #423 T4-D — ROLLBACK FASE 1 van 4: kill switch uit
-- ----------------------------------------------------------------------------
--  DIT IS HET HELE HERSTELPAD VOOR EEN INCIDENT. Fase 2 tot en met 4 zijn alleen
--  nodig bij een volledige terugbouw en horen dagen later te kunnen draaien.
--
--  VOLGORDE (gewijzigd na review op PR #425)
--      1 kill switch uit
--      2 oude bewaar_koppeling-signatuur terug
--      → OUDE APPLICATIECODE DEPLOYEN EN WAARNEMEN
--      3 rolloutpoorten weg
--      4 kolommen weg
--
--    De poorten gaan BEWUST pas in fase 3, ná de deploy. Zou fase 3 vóór de
--    deploy draaien, dan verdwijnt `copilot_lees_readiness` onder draaiende
--    nieuwe code — juist de functie waarmee die code vaststelt dat de kill
--    switch uit staat. Elke retrievalbeurt zou dan falen op een ontbrekend
--    leespad in plaats van netjes inert te zijn.
--
--  SQL-EDITORVAST: geen psql-metacommando's. Dit bestand is te plakken in de
--    Supabase SQL Editor én te draaien met psql. Het draait in één transactie,
--    dus een mislukte preflight laat niets half achter.
--
--  VUL IN: vervang hieronder VUL_IN door de naam van de operator en de reden.
--
--  LET OP  deze fase weigert ook als het operatorauditspoor of zijn append-only
--    trigger ontbreekt. Moet de arm in een incident écht NU uit terwijl dat spoor
--    stuk is, gebruik dan rechtstreeks de eenregelige vorm uit het runbook:
--        select microsoft_private.copilot_zet_rollout(false, '<actor>', '<reden>');
--    Herstel daarna het auditslot en draai deze fase alsnog voor de controle.
-- ============================================================================
begin;

select set_config('t4d.actor', 'VUL_IN', true),
       set_config('t4d.reden', 'VUL_IN', true);

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
declare
  v_actor text := coalesce(current_setting('t4d.actor', true), '');
  v_reden text := coalesce(current_setting('t4d.reden', true), '');
begin
  if v_actor in ('', 'VUL_IN') or v_reden in ('', 'VUL_IN') then
    raise exception 'FASE 1 geweigerd: vul bovenaan dit bestand actor en reden in. Ze landen in het operatorauditspoor; een anonieme rem is geen rem die je later kunt verantwoorden.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'copilot_zet_rollout'
  ) then
    raise exception 'FASE 1 kan niet: copilot_zet_rollout bestaat niet. Migratie 423a is niet toegepast, of fase 3 is al gedraaid — er is dan geen kill switch om uit te zetten.';
  end if;
end $$;

-- ── De rem ──────────────────────────────────────────────────────────────────
do $$
begin
  perform microsoft_private.copilot_zet_rollout(
    false,
    current_setting('t4d.actor', true),
    current_setting('t4d.reden', true));
end $$;

-- ── Eindcontrole ────────────────────────────────────────────────────────────
do $$
declare v_tgnaam text; v_tgenabled text; v_tgtype integer; v_fnnaam text; v_fnschema text; v_muteerbaar boolean;
begin
  if exists (select 1 from microsoft_private.copilot_rollout where aan) then
    raise exception 'FASE 1 mislukt: de kill switch staat nog aan';
  end if;
  if not exists (
    select 1 from microsoft_private.copilot_operator_log where handeling = 'copilot.rollout.uit'
  ) then
    raise exception 'FASE 1 mislukt: er is geen auditspoor van het uitzetten';
  end if;
  -- ── Auditslot: de tabel ÉN een trigger die werkelijk append-only afdwingt ──
  -- Het bestaan van "een" niet-interne trigger bewijst niets. Een uitgeschakelde
  -- trigger, een trigger die alleen op INSERT vuurt, of een onschuldige dummy met
  -- een andere functie eronder laat het spoor gewoon muteerbaar. Daarom naam,
  -- functie, status én dekking — en daarna een echte mutatiepoging, want alleen
  -- die bewijst dat het slot ook werkelijk dichtvalt.
  --
  --   tgtype-bits: 1 = ROW, 2 = BEFORE, 8 = DELETE, 16 = UPDATE.
  --   tgenabled:   'O' origin, 'A' always, 'R' alleen replica, 'D' uitgeschakeld.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_operator_log'
       and c.relkind = 'r'
  ) then
    raise exception 'FASE 1 mislukt: copilot_operator_log ontbreekt in microsoft_private; dat is auditdata en hoort te blijven staan';
  end if;

  select t.tgname, t.tgenabled::text, t.tgtype::integer, fn.proname, fnn.nspname
    into v_tgnaam, v_tgenabled, v_tgtype, v_fnnaam, v_fnschema
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc fn on fn.oid = t.tgfoid
    join pg_namespace fnn on fnn.oid = fn.pronamespace
   where n.nspname = 'microsoft_private'
     and c.relname = 'copilot_operator_log'
     and not t.tgisinternal
     and t.tgname = 'trg_copilot_operator_log_append_only';

  if v_tgnaam is null then
    raise exception 'FASE 1 mislukt: de trigger trg_copilot_operator_log_append_only ontbreekt op copilot_operator_log';
  end if;
  if v_fnschema <> 'microsoft_private' or v_fnnaam <> 'copilot_log_append_only' then
    raise exception 'FASE 1 mislukt: het auditslot hangt aan %.% in plaats van microsoft_private.copilot_log_append_only', v_fnschema, v_fnnaam;
  end if;
  if v_tgenabled not in ('O', 'A') then
    raise exception 'FASE 1 mislukt: het auditslot staat uit of vuurt alleen op een replica (tgenabled = %)', v_tgenabled;
  end if;
  if (v_tgtype & 16) = 0 or (v_tgtype & 8) = 0 then
    raise exception 'FASE 1 mislukt: het auditslot dekt niet zowel UPDATE als DELETE (tgtype = %)', v_tgtype;
  end if;
  if (v_tgtype & 1) = 0 or (v_tgtype & 2) = 0 then
    raise exception 'FASE 1 mislukt: het auditslot is niet BEFORE ... FOR EACH ROW (tgtype = %)', v_tgtype;
  end if;

  -- De metadata kan kloppen terwijl de functie eronder niets doet. Eén echte
  -- poging is het enige sluitende bewijs. Op een lege tabel vuurt een ROW-trigger
  -- niet, dus dan zegt de poging niets en slaan we haar over — de controles
  -- hierboven blijven staan.
  if exists (select 1 from microsoft_private.copilot_operator_log) then
    v_muteerbaar := true;
    begin
      update microsoft_private.copilot_operator_log set reden = reden;
    exception when others then
      v_muteerbaar := false;
    end;
    if v_muteerbaar then
      raise exception 'FASE 1 mislukt: een UPDATE op copilot_operator_log werd NIET geblokkeerd; het slot staat er wel maar werkt niet';
    end if;
  end if;

  raise notice 'FASE 1 geslaagd: de Copilot-arm is inert. Bij een incident stopt het hier; fase 2 t/m 4 zijn alleen nodig bij een volledige terugbouw.';
end $$;

commit;
