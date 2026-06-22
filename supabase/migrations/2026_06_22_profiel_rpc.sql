-- ============================================================================
-- Migratie 2026-06-22 — Increment F (vervolg): transactionele profiel-opslag-RPC
-- ----------------------------------------------------------------------------
-- Draait NÁ 2026_06_22_profiel.sql (heeft de profiel-tabellen + RLS nodig).
--
-- WAAROM (pre-merge review-bevindingen, besluit 0017):
--  * Thema 2 (code-reviewer): de replace-set in /api/profiel was niet-atomair
--    (delete-dan-insert per join-tabel zonder transactie). Bij een partiële fout
--    kon een koppeling-set leeg achterblijven (dataverlies).
--  * Thema 1 (audit-evidence must-fix): de profiel_log-insert was fire-and-forget;
--    een stille audit-miss schendt "elke mutatie logt expliciet".
--  * Should-fix #4 (audit-evidence): leg de gekozen ids vast in de payload, niet
--    enkel aantallen, zodat de profielstaat reconstrueerbaar is uit het auditspoor.
--
-- OPLOSSING: één functie die de hele mutatie (velden + 3 koppeling-sets +
-- audit-insert) in ÉÉN transactie uitvoert. Faalt één statement (bijv. een
-- composite-FK-weigering of de audit-insert), dan rolt ALLES terug — geen
-- half doorgevoerde profielstaat, geen ontbrekende auditregel.
--
-- SECURITY INVOKER (geen DEFINER): de functie draait met de rechten van de
-- aanroeper, dus alle RLS-policies van de profiel-tabellen blijven onverkort van
-- kracht (strikt zelfbeheer, besluit 0017). De functie omzeilt RLS NIET; ze
-- bundelt enkel de statements transactioneel. Geen service-role.
--
-- App-validatie (aantal-grenzen, toegestane tekstwaarden, primair != secundair)
-- blijft in /api/profiel; de DB borgt fondsconsistentie/zelfbeheer declaratief.
--
-- Idempotent (create or replace + herhaalbare grants). Eerst in Supabase draaien,
-- dán code-deploy. ROLLBACK: zie 2026_06_22_profiel_rpc_ROLLBACK.sql.
-- ============================================================================

create or replace function public.profiel_opslaan(
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
  --     primaire expertise van een ander fonds of een globale template.
  update public.profielen set
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
  --     Payload = metadata + gekozen ids (reconstrueerbaar), geen vrije profieltekst.
  insert into public.profiel_log (fonds_id, profiel_id, event_type, actor_id, payload)
  values (
    v_fonds_id, v_uid, 'profiel_gewijzigd', v_uid,
    jsonb_build_object(
      'velden', jsonb_build_object(
        'bestuurlijke_rol',  p_bestuurlijke_rol is not null,
        'primaire_expertise', p_primaire_expertise_id is not null,
        'antwoordvoorkeur',  p_antwoordvoorkeur,
        'standaard_ai_modus', p_standaard_ai_modus,
        'detailniveau',      p_detailniveau
      ),
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
  text, uuid, text, text, text, uuid[], uuid[], uuid[]
) from anon;
grant execute on function public.profiel_opslaan(
  text, uuid, text, text, text, uuid[], uuid[], uuid[]
) to authenticated;

-- ── Verificatie (handmatig, ná de migratie) ────────────────────────────────
-- (a) Functie bestaat met SECURITY INVOKER (prosecdef = false):
--     select proname, prosecdef from pg_proc where proname = 'profiel_opslaan';
--     -- verwacht: 1 rij, prosecdef = false.
-- (b) Atomiciteit: roep de RPC aan met één focusgebied-id van een ander fonds in
--     de array -> de hele call faalt (FK-violation) en de bestaande koppelingen
--     blijven ongewijzigd (geen lege set).
