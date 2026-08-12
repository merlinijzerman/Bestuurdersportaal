-- ============================================================================
-- ROLLBACK van 2026_08_12_bopt2_reflectie_ingangen.sql
-- ----------------------------------------------------------------------------
-- Herstelt de toestand ná tranche 1a (herformuleren, acht ingangen, GEEN
-- verdiepen): de ingang-CHECK terug naar acht waarden en `reflectie_transitie`
-- terug naar de bopt1-versie.
--
-- ⚠ De reverse-mapping is LOSSY: `twijfel` kwam uit vier oude waarden
-- (onderbouwing/evenwichtigheid/uitlegbaarheid/niet_te_plaatsen) en `mis_iets`
-- uit twee (informatie_ontbreekt/alternatief). Bij terugdraaien wordt één
-- representatieve oude waarde gekozen. Aanvaardbaar omdat de rijen kortlevend
-- zijn (24u-failsafe, cascade bij verwijderen), maar de exacte oorspronkelijke
-- ingang is niet reconstrueerbaar.
--
-- Draai deze rollback alleen wanneer geen client-code meer live staat die de
-- vier nieuwe ingangwaarden of `verdiepen` stuurt.
-- ============================================================================

begin;

-- ── 1. CHECK terug naar acht waarden, met (lossy) reverse-mapping ────────────
alter table public.gesprek_reflectie_state
  drop constraint if exists gesprek_reflectie_state_ingang_check;

-- Match op de KOLOM `ingang` (con.conkey), niet op de constraint-tekst — anders
-- dropt de status-CHECK (bevat 'ingang_gekozen') mee. Zie de migratie.
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

update public.gesprek_reflectie_state
   set ingang = case ingang
                  when 'mis_iets'  then 'informatie_ontbreekt'
                  when 'twijfel'   then 'onderbouwing'
                  when 'risico'    then 'uitvoeringsrisico'
                  when 'overtuigt' then 'overtuiging'
                  else ingang
                end
 where ingang is not null;

alter table public.gesprek_reflectie_state
  add constraint gesprek_reflectie_state_ingang_check
  check (ingang is null or ingang in
    ('informatie_ontbreekt','onderbouwing','uitvoeringsrisico','evenwichtigheid',
     'alternatief','uitlegbaarheid','niet_te_plaatsen','overtuiging'));

-- ── 2. Functie terug naar de bopt1-versie (herformuleren, geen verdiepen) ────
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

  if p_actie is null or p_actie not in
     ('start','antwoord','concept','afronden','afbreken','herformuleren') then
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
    if p_ingang is null or p_ingang not in
       ('informatie_ontbreekt','onderbouwing','uitvoeringsrisico','evenwichtigheid',
        'alternatief','uitlegbaarheid','niet_te_plaatsen','overtuiging') then
      raise exception 'ongeldige_ingang' using errcode = '22023';
    end if;
    v_nieuw_status := 'ingang_gekozen';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'antwoord' then
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
    if v_status not in ('verdieping_1','verdieping_2','verdieping_3') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'herformuleren' then
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

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

revoke all on function public.reflectie_transitie(uuid, text, text, uuid) from public, anon;
grant execute on function public.reflectie_transitie(uuid, text, text, uuid) to authenticated;

commit;
