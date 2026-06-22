-- ============================================================================
-- Migratie 2026-06-22 — Increment F (vervolg): naam-zelfbeheer in profiel-RPC
-- ----------------------------------------------------------------------------
-- Draait NÁ 2026_06_22_profiel_rpc.sql (vervangt die functie-signatuur).
--
-- WAAROM: de bestuurder moet de eigen weergavenaam kunnen instellen (verschijnt
-- platformbreed i.p.v. het e-mailadres; de naam stroomt profielen.naam → layout
-- → Sidebar). De bestaande RPC profiel_opslaan(8 args) kende geen p_naam.
--
-- AANPAK: een extra parameter verandert de functie-signatuur; create-or-replace
-- zou een tweede overload achterlaten. Daarom DROP van de oude 8-arg variant en
-- CREATE van een 9-arg variant met p_naam als EERSTE parameter. Idempotent
-- (drop if exists + create or replace + herhaalbare grants).
--
-- NAAM-SEMANTIEK: een lege/whitespace-naam valt terug op de bestaande naam
-- (coalesce(nullif(trim(p_naam),''), naam)) — de weergavenaam wordt dus NOOIT
-- leeg gemaakt. De gekozen naam landt ook in het append-only profiel_log.
--
-- SECURITY INVOKER (geen DEFINER): RLS blijft onverkort van kracht (strikt
-- zelfbeheer, id = auth.uid()). Geen service-role. App-validatie (lengte, trim)
-- blijft in /api/profiel.
--
-- Eerst in Supabase draaien, dán code-deploy. ROLLBACK: zie
-- 2026_06_22_profiel_rpc_naam_ROLLBACK.sql (herstelt de 8-arg variant).
-- ============================================================================

-- Oude 8-arg variant verwijderen (zonder p_naam).
drop function if exists public.profiel_opslaan(
  text, uuid, text, text, text, uuid[], uuid[], uuid[]
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

  -- RLS laat alleen de eigen profielrij lezen; fonds_id stuurt de composite-FK's.
  select fonds_id into v_fonds_id from public.profielen where id = v_uid;
  if v_fonds_id is null then
    raise exception 'GEEN_FONDS';
  end if;

  -- (1) Profielvelden. RLS dwingt id = auth.uid() af; de composite-FK weigert een
  --     primaire expertise van een ander fonds of een globale template. De naam
  --     valt bij leeg/whitespace terug op de bestaande naam (nooit leeg maken).
  update public.profielen set
    naam                  = coalesce(nullif(trim(p_naam), ''), naam),
    bestuurlijke_rol      = p_bestuurlijke_rol,
    primaire_expertise_id = p_primaire_expertise_id,
    antwoordvoorkeur      = p_antwoordvoorkeur,
    standaard_ai_modus    = p_standaard_ai_modus,
    detailniveau          = p_detailniveau
  where id = v_uid;

  -- (2) Koppeling-sets vervangen (delete + insert in dezelfde transactie).
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

  -- (3) Append-only audit — in dezelfde transactie. Faalt deze insert, dan rolt
  --     ook (1)+(2) terug: een wijziging zonder auditregel is onmogelijk.
  --     Payload = metadata + gekozen ids (reconstrueerbaar); de naam-wijziging
  --     leggen we vast als boolean + de feitelijk gezette naam.
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

-- Alleen ingelogde gebruikers roepen de functie aan; anon krijgt sowieso
-- NIET_INGELOGD (auth.uid() is dan NULL).
revoke execute on function public.profiel_opslaan(
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[]
) from anon;
grant execute on function public.profiel_opslaan(
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[]
) to authenticated;

-- ── Verificatie (handmatig, ná de migratie) ────────────────────────────────
-- (a) Eén functie met SECURITY INVOKER (prosecdef = false) en 9 argumenten:
--     select proname, pronargs, prosecdef from pg_proc where proname = 'profiel_opslaan';
--     -- verwacht: 1 rij, pronargs = 9, prosecdef = false. Géén 8-arg overload meer.
-- (b) Lege naam: roep aan met p_naam = '' -> profielen.naam blijft ongewijzigd.
