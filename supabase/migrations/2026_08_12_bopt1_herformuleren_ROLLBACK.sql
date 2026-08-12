-- ============================================================================
-- ROLLBACK van 2026_08_12_bopt1_herformuleren.sql
-- ----------------------------------------------------------------------------
-- Herstelt public.reflectie_transitie naar de 5-actie-versie uit
-- 2026_08_05_b1_reflectie_state.sql (zonder `herformuleren`). De tabel, de
-- bronsethash en de grants blijven ongemoeid.
--
-- LET OP: draai deze rollback alleen wanneer er geen client-code meer live staat
-- die `herformuleren` aanroept — anders valt de Aanpassen-flow terug op
-- 'ongeldige_actie' (409). De client behandelt dat als een geweigerde transitie
-- en valt veilig terug, maar de knop doet dan niets nuttigs meer.
-- ============================================================================

begin;

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

  if p_actie is null or p_actie not in ('start','antwoord','concept','afronden','afbreken') then
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

comment on function public.reflectie_transitie(uuid, text, text, uuid) is
  'DE ENIGE schrijfweg naar gesprek_reflectie_state (besluit 0110, AC-18). '
  'Valideert de gevraagde ACTIE tegen de opnieuw uitgelezen actuele status '
  '(FR-67); de client geeft nooit een gewenste einddstatus door. Beurtteller '
  'kan alleen omhoog; bronset alleen bij `start`, en alleen uit een '
  'governance_log-rij van dezelfde gebruiker én hetzelfde gesprek. Fail-safe: '
  'een status ouder dan 24 uur telt als niet_actief (FR-57).';

revoke all on function public.reflectie_transitie(uuid, text, text, uuid) from public, anon;
grant execute on function public.reflectie_transitie(uuid, text, text, uuid) to authenticated;

commit;
