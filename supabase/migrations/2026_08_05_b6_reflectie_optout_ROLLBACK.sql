-- ============================================================================
-- ROLLBACK van 2026_08_05_b6_reflectie_optout.sql (plateau B, B-6)
-- ----------------------------------------------------------------------------
-- Herstelt de 9-arg `profiel_opslaan` (zonder p_reflectie_uitnodiging) en dropt
-- de kolom op `profielen`.
--
-- WAT ER VERLOREN GAAT: de opt-outkeuzes van alle gebruikers. Wie de proactieve
-- uitnodiging had uitgezet, krijgt hem na een terugdraai én een herinvoering
-- opnieuw — de kolom komt dan terug op de default `true`. Dat is geen
-- dataverlies met juridische gevolgen, maar wél een keuze van de gebruiker die
-- stil ongedaan wordt gemaakt. Noem het als je deze rollback draait.
--
-- Het auditspoor in `profiel_log` blijft bestaan (append-only); daar staan de
-- eerdere wijzigingen dus nog in, inclusief de payload-sleutel
-- `velden.reflectie_uitnodiging`. Dat is correct: een auditregel wordt niet
-- herschreven omdat de kolom verdwijnt.
--
-- VOORWAARDE: draai deze rollback pas ná het terugzetten van de code naar de
-- versie vóór plateau B. De profielroute stuurt anders een parameter mee die de
-- herstelde functie niet kent, en elke profielopslag faalt.
--
-- Idempotent. Transactioneel.
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

drop function if exists public.profiel_opslaan(
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[], boolean
);

create or replace function public.profiel_opslaan(
  p_naam                    text,
  p_bestuurlijke_rol        text,
  p_primaire_expertise_id   uuid,
  p_antwoordvoorkeur        text,
  p_standaard_ai_modus      text,
  p_detailniveau            text,
  p_secundaire_expertise_ids uuid[],
  p_gremium_ids             uuid[],
  p_focusgebied_ids         uuid[]
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_fonds_id uuid;
begin
  if v_uid is null then
    raise exception 'NIET_INGELOGD';
  end if;

  select fonds_id into v_fonds_id from public.profielen where id = v_uid;
  if v_fonds_id is null then
    raise exception 'GEEN_FONDS';
  end if;

  update public.profielen set
    naam                  = coalesce(nullif(trim(p_naam), ''), naam),
    bestuurlijke_rol      = p_bestuurlijke_rol,
    primaire_expertise_id = p_primaire_expertise_id,
    antwoordvoorkeur      = p_antwoordvoorkeur,
    standaard_ai_modus    = p_standaard_ai_modus,
    detailniveau          = p_detailniveau
  where id = v_uid;

  delete from public.profiel_expertises    where profiel_id = v_uid;
  delete from public.profiel_gremia         where profiel_id = v_uid;
  delete from public.profiel_focusgebieden  where profiel_id = v_uid;

  if coalesce(array_length(p_secundaire_expertise_ids, 1), 0) > 0 then
    insert into public.profiel_expertises (fonds_id, profiel_id, expertise_id)
    select v_fonds_id, v_uid, x from unnest(p_secundaire_expertise_ids) as x;
  end if;
  if coalesce(array_length(p_gremium_ids, 1), 0) > 0 then
    insert into public.profiel_gremia (fonds_id, profiel_id, gremium_id)
    select v_fonds_id, v_uid, x from unnest(p_gremium_ids) as x;
  end if;
  if coalesce(array_length(p_focusgebied_ids, 1), 0) > 0 then
    insert into public.profiel_focusgebieden (fonds_id, profiel_id, focusgebied_id)
    select v_fonds_id, v_uid, x from unnest(p_focusgebied_ids) as x;
  end if;

  insert into public.profiel_log (fonds_id, profiel_id, event_type, actor_id, payload)
  values (
    v_fonds_id, v_uid, 'profiel_gewijzigd', v_uid,
    jsonb_build_object(
      'velden', jsonb_build_object(
        'naam',              nullif(trim(p_naam), '') is not null,
        'bestuurlijke_rol',  p_bestuurlijke_rol is not null,
        'primaire_expertise', p_primaire_expertise_id is not null,
        'antwoordvoorkeur',  p_antwoordvoorkeur,
        'standaard_ai_modus', p_standaard_ai_modus,
        'detailniveau',      p_detailniveau
      ),
      'naam', nullif(trim(p_naam), ''),
      'aantallen', jsonb_build_object(
        'secundaire_expertises', coalesce(array_length(p_secundaire_expertise_ids, 1), 0),
        'gremia',                coalesce(array_length(p_gremium_ids, 1), 0),
        'focusgebieden',         coalesce(array_length(p_focusgebied_ids, 1), 0)
      ),
      'ids', jsonb_build_object(
        'primaire_expertise',    p_primaire_expertise_id,
        'secundaire_expertises', to_jsonb(coalesce(p_secundaire_expertise_ids, array[]::uuid[])),
        'gremia',                to_jsonb(coalesce(p_gremium_ids, array[]::uuid[])),
        'focusgebieden',         to_jsonb(coalesce(p_focusgebied_ids, array[]::uuid[]))
      )
    )
  );
end;
$$;

revoke execute on function public.profiel_opslaan(
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[]
) from public, anon;
grant execute on function public.profiel_opslaan(
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[]
) to authenticated;

alter table public.profielen drop column if exists reflectie_uitnodiging;

commit;

-- ── Verificatie (handmatig ná de rollback) ──────────────────────────────────
-- 1. Eén functie met 9 argumenten — geen 10-arg overload meer:
--      select proname, pronargs from pg_proc where proname = 'profiel_opslaan';
-- 2. De kolom is weg — moet 0 teruggeven:
--      select count(*) from information_schema.columns
--       where table_name = 'profielen' and column_name = 'reflectie_uitnodiging';
