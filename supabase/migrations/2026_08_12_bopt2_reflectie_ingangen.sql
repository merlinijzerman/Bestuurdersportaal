-- ============================================================================
-- Migratie 2026-08-12 (B-opt tranche 2b/2d) — vier reflectie-ingangen + actie
-- `verdiepen`.
-- ----------------------------------------------------------------------------
-- WAAROM. Acht ingangen vroegen de bestuurder zijn aarzeling te classificeren
-- vóórdat hij hem had verwoord, en overlapten (VOORSTEL §A/§B). Terug naar vier:
-- mis_iets · twijfel · risico · overtuigt. De fijnmazigheid keert terug als
-- verdiepings-*richting* binnen guardrails (tranche 3), niet als knop.
--
-- Daarnaast wordt "één verdiepingsvraag als standaard; verdieping op initiatief
-- van de bestuurder" ingevoerd (VOORSTEL §E): na elk antwoord toont de chatroute
-- het concept, en "Nog een stap verdiepen" vraagt met de nieuwe actie `verdiepen`
-- om één extra vraag. Het beurtplafond van 3 blijft server-side hard.
--
-- WAT DEZE MIGRATIE DOET.
--  (1) CHECK op `gesprek_reflectie_state.ingang` van acht naar vier waarden, mét
--      mapping van bestaande rijen (kortlevend, maar een migratie die op
--      bestaande data stukloopt is geen migratie).
--  (2) `create or replace reflectie_transitie`: nieuwe ingang-allowlist bij
--      `start`, plus de actie `verdiepen` (conceptweergave → verdieping_{beurt},
--      geweigerd bij beurt >= 3). `herformuleren` (tranche 1a) blijft.
--
-- GATE-GEVOLG. CHECK-wijziging + `create or replace` op een SECURITY DEFINER-
-- functie → draai ná deze migratie supabase/checks/2026_07_31_r1_structurele_
-- gates.sql (A–H) én 2026_08_05_b_reflectie_flow.sql tegen de doeldatabase.
--
-- GATE-CONTEXT. De gebruikerstoets is voor deze wijziging bewust overgeslagen
-- (besluit 0164); `risico` blijft daarom staan.
--
-- Idempotent (drop constraint if exists → herbouw; create or replace).
-- Transactioneel. ROLLBACK: 2026_08_12_bopt2_reflectie_ingangen_ROLLBACK.sql.
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run. Draai eerst
-- 2026_08_12_bopt1_herformuleren.sql als dat nog niet is gebeurd.
-- ============================================================================

begin;

-- ── 1. CHECK op `ingang`: acht → vier, met datamapping ──────────────────────
-- Volgorde: eerst de nieuwe named CHECK weg (idempotent re-add), dan de oude
-- (inline, naamloze) CHECK op ingang, dan de rijen mappen, dan de nieuwe CHECK.
alter table public.gesprek_reflectie_state
  drop constraint if exists gesprek_reflectie_state_ingang_check;

-- Verwijder elke resterende CHECK op UITSLUITEND de kolom `ingang`, ongeacht de
-- (auto-gegenereerde) naam uit de oorspronkelijke inline-definitie.
--
-- ⚠ Match op de KOLOM (con.conkey), niet op de constraint-tekst. De status-CHECK
-- bevat de literal 'ingang_gekozen'; een `ilike '%ingang%'` zou die óók droppen
-- en nooit herstellen — een stille integriteitsregressie op `status`. Door op het
-- attnum van `ingang` te matchen (één-koloms-CHECK) raken we status/beurt niet.
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and rel.relname = 'gesprek_reflectie_state'
       and con.contype = 'c'
       and con.conkey = array[
         (select attnum from pg_attribute
           where attrelid = 'public.gesprek_reflectie_state'::regclass
             and attname = 'ingang'
             and not attisdropped)
       ]
  loop
    execute format('alter table public.gesprek_reflectie_state drop constraint %I', c);
  end loop;
end $$;

-- Datamapping oud → nieuw (spiegel: INGANG_MAPPING_OUD_NAAR_NIEUW in
-- core/lib/reflectie-flow.ts). `risico` blijft bestaan (besluit 0164).
update public.gesprek_reflectie_state
   set ingang = case ingang
                  when 'informatie_ontbreekt' then 'mis_iets'
                  when 'alternatief'          then 'mis_iets'
                  when 'onderbouwing'         then 'twijfel'
                  when 'evenwichtigheid'      then 'twijfel'
                  when 'uitlegbaarheid'       then 'twijfel'
                  when 'niet_te_plaatsen'     then 'twijfel'
                  when 'uitvoeringsrisico'    then 'risico'
                  when 'overtuiging'          then 'overtuigt'
                  else ingang
                end
 where ingang is not null;

alter table public.gesprek_reflectie_state
  add constraint gesprek_reflectie_state_ingang_check
  check (ingang is null or ingang in ('mis_iets','twijfel','risico','overtuigt'));

-- ── 2. Toestandsmachine: nieuwe ingang-allowlist + actie `verdiepen` ─────────
create or replace function public.reflectie_transitie(
  p_gesprek_id     uuid,
  p_actie          text,
  p_ingang         text default null,
  p_bronset_log_id uuid default null
) returns public.gesprek_reflectie_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_eigenaar     uuid;
  v_fonds        uuid;
  v_status       text;
  v_beurt        smallint;
  v_bijgewerkt   timestamptz;
  v_nieuw_status text;
  v_nieuwe_beurt smallint;
  v_meta         jsonb;
  v_versie       text;
  v_bestaat      boolean;
  v_rij          public.gesprek_reflectie_state;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  -- B-opt tranche 2d: `verdiepen` toegevoegd aan de allowlist (naast
  -- `herformuleren` uit tranche 1a).
  if p_actie is null or p_actie not in
     ('start','antwoord','concept','afronden','afbreken','herformuleren','verdiepen') then
    raise exception 'ongeldige_actie' using errcode = '22023';
  end if;

  select g.gebruiker_id, g.fonds_id into v_eigenaar, v_fonds
    from public.gesprekken g
   where g.id = p_gesprek_id
   for update;

  if not found then
    raise exception 'gesprek_niet_gevonden' using errcode = 'P0002';
  end if;
  if v_eigenaar is distinct from v_uid then
    raise exception 'geen_eigenaar' using errcode = '42501';
  end if;

  select s.status, s.beurt, s.bijgewerkt_op
    into v_status, v_beurt, v_bijgewerkt
    from public.gesprek_reflectie_state s
   where s.gesprek_id = p_gesprek_id
   for update;

  v_bestaat := found;
  if not v_bestaat then
    v_status     := 'niet_actief';
    v_beurt      := 0;
    v_bijgewerkt := now();
  end if;

  if p_actie = 'afbreken' and not v_bestaat then
    v_rij.gesprek_id    := p_gesprek_id;
    v_rij.gebruiker_id  := v_uid;
    v_rij.fonds_id      := v_fonds;
    v_rij.status        := 'niet_actief';
    v_rij.beurt         := 0;
    v_rij.bijgewerkt_op := now();
    return v_rij;
  end if;

  if v_status <> 'niet_actief' and v_bijgewerkt < now() - interval '24 hours' then
    v_status := 'niet_actief';
    v_beurt  := 0;
  end if;

  v_nieuwe_beurt := v_beurt;

  if p_actie = 'afbreken' then
    v_nieuw_status := 'niet_actief';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'start' then
    if v_status <> 'niet_actief' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    -- B-opt tranche 2a: de vier nieuwe ingangwaarden.
    if p_ingang is null or p_ingang not in ('mis_iets','twijfel','risico','overtuigt') then
      raise exception 'ongeldige_ingang' using errcode = '22023';
    end if;
    v_nieuw_status := 'ingang_gekozen';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'antwoord' then
    -- Beurtplafond leidend (zie de correctie op TO §6.1 uit B1): het derde
    -- antwoord landt in verdieping_3, een vierde bestaat niet.
    if v_status not in ('ingang_gekozen','verdieping_1','verdieping_2') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuwe_beurt := (v_beurt + 1)::smallint;
    if v_nieuwe_beurt > 3 then
      raise exception 'beurtplafond_bereikt' using errcode = '22023';
    end if;
    if v_status = 'ingang_gekozen' then
      v_nieuw_status := 'verdieping_1';
    elsif v_status = 'verdieping_1' then
      v_nieuw_status := 'verdieping_2';
    else
      v_nieuw_status := 'verdieping_3';
    end if;

  elsif p_actie = 'concept' then
    -- De chatroute roept dit ná ELK reflectieantwoord aan (tranche 2c), niet
    -- meer alleen bij het bereikte plafond. Verhoogt de beurt niet.
    if v_status not in ('verdieping_1','verdieping_2','verdieping_3') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'herformuleren' then
    -- B-opt tranche 1a: eigen overweging aanscherpen; blijft conceptweergave,
    -- beurt/ingang/bronset ongemoeid.
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'verdiepen' then
    -- ── B-opt tranche 2d ──────────────────────────────────────────────────
    -- "Nog een stap verdiepen": vanuit de conceptweergave terug naar de
    -- verdiepingsstatus die bij de HUIDIGE beurt hoort (verdieping_1 bij beurt 1,
    -- verdieping_2 bij beurt 2), zodat het volgende `antwoord` doortelt naar
    -- verdieping_2 resp. verdieping_3. De beurt verandert NIET; ingang en bronset
    -- blijven behouden (p_actie <> 'start'). Bij beurt >= 3 is het plafond bereikt
    -- en wordt geweigerd — het beurtplafond blijft een hard vangnet.
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    if v_beurt >= 3 then
      raise exception 'beurtplafond_bereikt' using errcode = '22023';
    end if;
    if v_beurt < 1 then
      -- Conceptweergave impliceert minstens één gegeven antwoord; defensief.
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'verdieping_' || v_beurt::text;

  elsif p_actie = 'afronden' then
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'afgerond';
  end if;

  if p_actie = 'start' and p_bronset_log_id is not null then
    select gl.retrieval_meta into v_meta
      from public.governance_log gl
     where gl.id               = p_bronset_log_id
       and gl.gebruiker_id     = v_uid
       and gl.gesprek_audit_id = p_gesprek_id;

    if not found then
      raise exception 'bronset_niet_van_dit_gesprek' using errcode = '42501';
    end if;

    v_versie := public.reflectie_bronset_hash(coalesce(v_meta, '{}'::jsonb));
  end if;

  insert into public.gesprek_reflectie_state as s
    (gesprek_id, gebruiker_id, fonds_id, status, ingang, beurt,
     bronset_log_id, reflectie_bronset_versie, gestart_op, bijgewerkt_op)
  values
    (p_gesprek_id, v_uid, v_fonds, v_nieuw_status,
     case when p_actie = 'start' then p_ingang else null end,
     v_nieuwe_beurt,
     case when p_actie = 'start' then p_bronset_log_id else null end,
     case when p_actie = 'start' then v_versie else null end,
     case when p_actie = 'start' then now() else null end,
     now())
  on conflict (gesprek_id) do update
     set status                   = excluded.status,
         beurt                    = excluded.beurt,
         bijgewerkt_op            = now(),
         -- Ingang en bronset worden UITSLUITEND bij `start` gezet en bij
         -- `afbreken` gewist. Vervolgacties (antwoord/concept/herformuleren/
         -- verdiepen) laten ze onaangeroerd — dat houdt de bevriezing intact.
         ingang                   = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.ingang
                                      else s.ingang
                                    end,
         bronset_log_id           = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.bronset_log_id
                                      else s.bronset_log_id
                                    end,
         reflectie_bronset_versie = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.reflectie_bronset_versie
                                      else s.reflectie_bronset_versie
                                    end,
         gestart_op               = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.gestart_op
                                      else s.gestart_op
                                    end
  returning * into v_rij;

  return v_rij;
end;
$$;

comment on function public.reflectie_transitie(uuid, text, text, uuid) is
  'DE ENIGE schrijfweg naar gesprek_reflectie_state (besluit 0110, AC-18). '
  'Valideert de gevraagde ACTIE tegen de opnieuw uitgelezen actuele status '
  '(FR-67). B-opt tranche 2: vier ingangwaarden (mis_iets/twijfel/risico/'
  'overtuigt) bij `start`; nieuwe actie `verdiepen` (conceptweergave → '
  'verdieping_{beurt}, geweigerd bij beurt >= 3). `herformuleren` (tranche 1a) '
  'blijft. Beurtteller alleen omhoog; bronset alleen bij `start`; fail-safe 24u.';

revoke all on function public.reflectie_transitie(uuid, text, text, uuid) from public, anon;
grant execute on function public.reflectie_transitie(uuid, text, text, uuid) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. De ingang-CHECK kent nog vier waarden:
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conname = 'gesprek_reflectie_state_ingang_check';
-- 2. Geen rij draagt nog een oude ingangwaarde:
--      select count(*) from public.gesprek_reflectie_state
--       where ingang in ('informatie_ontbreekt','onderbouwing','uitvoeringsrisico',
--                        'evenwichtigheid','alternatief','uitlegbaarheid',
--                        'niet_te_plaatsen','overtuiging');   -- moet 0 zijn
-- 3. Gedragstoets: supabase/checks/2026_08_05_b_reflectie_flow.sql (blok AC-18h).
