-- ============================================================================
-- Migratie 2026-08-05 (B6) — permanente opt-out voor de reflectie-uitnodiging
-- ----------------------------------------------------------------------------
-- WAAROM. De proactieve reflectie-uitnodiging moet permanent uit te zetten zijn
-- (FR-15). Besluit 0121 zegt waaróm dat in het profiel hoort en niet in
-- sessionStorage: een opt-out is een UITGESPROKEN VOORKEUR van de gebruiker, geen
-- registratie van zijn gedrag. De frequentiebegrenzing per browsersessie is het
-- omgekeerde geval en blijft daarom bewust wél in sessionStorage.
--
-- WAAR DE KOLOM STAAT. Op `profielen`. De RLS daar is strikt de eigen rij
-- ("eigen profiel", `auth.uid() = id`), en de definer-view `vw_fondsleden`
-- projecteert uitsluitend id/fonds_id/naam/rol. Een collega kan deze waarde dus
-- niet lezen. Strikt zelfbeheerd (besluit 0017): er is geen profile.manage.all.
--
-- ⚠ SPANNING MET BESLUIT 0112 — BEWUST AANVAARD, MET MOTIVERING ⚠
-- Profielmutaties lopen via `profiel_opslaan`, die in dezelfde transactie een
-- regel in `profiel_log` schrijft. Die tabel is FONDS-BREED LEESBAAR (policy
-- "lees profiel_log", migratie 2026_06_22_profiel.sql). Een regel "deze
-- bestuurder heeft zijn reflectie-uitnodiging uitgezet" is daarmee zichtbaar voor
-- fondsgenoten.
--
-- Dat is een reflectie-GERELATEERD spoor, en besluit 0112 verbiedt registratie
-- van reflectieGEDRAG. De afweging (opdrachtgever, 04-08-2026):
--
--   • het veld legt een VOORKEUR vast, geen gedrag — precies het onderscheid dat
--     besluit 0121 al maakt;
--   • `antwoordvoorkeur`, `standaard_ai_modus` en `detailniveau` staan om
--     dezelfde reden bij naam in `profiel_log`; een uitzondering maken zou een
--     stil gat in het auditspoor slaan;
--   • de guardrail "elke mutatie logt expliciet" weegt hier zwaarder dan de
--     restkans dat iemand uit één logregel een conclusie trekt over de
--     reflectiebereidheid van een collega.
--
-- Wat er NIET gebeurt: het aantal keren dat een uitnodiging is getoond of
-- weggeklikt wordt nergens vastgelegd. Alleen het zetten van de voorkeur zelf.
-- Zie het decision-record bij deze release en het restrisico in
-- 00 Overzicht en status/openstaande-punten-en-risicos.md.
--
-- DEFAULT TRUE: de uitnodiging staat aan tot de gebruiker hem uitzet. Zou de
-- default false zijn, dan zou de functie voor bestaande gebruikers stil
-- uitgeschakeld blijven en zou niemand hem ooit tegenkomen.
--
-- Idempotent (add column if not exists, drop function if exists + create).
-- Transactioneel. Eerst in Supabase draaien, dán code-deploy.
-- ROLLBACK: 2026_08_05_b6_reflectie_optout_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- ── 1. De kolom ─────────────────────────────────────────────────────────────
alter table public.profielen
  add column if not exists reflectie_uitnodiging boolean not null default true;

comment on column public.profielen.reflectie_uitnodiging is
  'Mag de PROACTIEVE reflectie-uitnodiging (T1-T5) verschijnen? Permanente '
  'opt-out uit FR-15, strikt zelfbeheerd (besluit 0017). Uit betekent NIET dat '
  'de reflectiefunctie weg is: de handmatige actie "Reflecteer op dit antwoord" '
  'blijft altijd bereikbaar (v1.0 §9.1 A). De frequentiebegrenzing per '
  'browsersessie staat bewust in sessionStorage en niet hier (besluit 0121).';

-- ── 2. De RPC uitbreiden ────────────────────────────────────────────────────
-- Een extra parameter verandert de signatuur; `create or replace` zou een
-- tweede overload achterlaten. Daarom eerst DROP van de 9-arg variant, dan
-- CREATE van de 10-arg variant — exact het patroon van
-- 2026_06_22_profiel_rpc_naam.sql, dat op dezelfde manier p_naam toevoegde.
--
-- SECURITY INVOKER blijft: RLS is onverkort van kracht (id = auth.uid()), er is
-- geen service-role en de functie omzeilt niets — ze bundelt alleen de
-- statements transactioneel.

drop function if exists public.profiel_opslaan(
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[]
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
  p_focusgebied_ids         uuid[],
  -- Plateau B / B-6. NULL = ongewijzigd laten, zodat een oudere client die deze
  -- parameter niet meestuurt de voorkeur niet per ongeluk terugzet op de
  -- default. Alleen een expliciete true/false wijzigt hem.
  p_reflectie_uitnodiging   boolean default null
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
    detailniveau          = p_detailniveau,
    reflectie_uitnodiging = coalesce(p_reflectie_uitnodiging, reflectie_uitnodiging)
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
  --
  --     `reflectie_uitnodiging` staat hier bij naam, net als de andere
  --     voorkeuren. Zie de header voor de afweging tegenover besluit 0112.
  --     NULL (ongewijzigd) landt als NULL in de payload en is dus te
  --     onderscheiden van een expliciete false.
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
        'detailniveau',      p_detailniveau,
        'reflectie_uitnodiging', p_reflectie_uitnodiging
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
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[], boolean
) from public, anon;
grant execute on function public.profiel_opslaan(
  text, text, uuid, text, text, text, uuid[], uuid[], uuid[], boolean
) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. Eén functie, 10 argumenten, SECURITY INVOKER — verwacht 1 rij met
--    pronargs = 10 en prosecdef = false (géén 9-arg overload meer):
--      select proname, pronargs, prosecdef from pg_proc where proname = 'profiel_opslaan';
-- 2. De kolom bestaat met default true:
--      select column_default, is_nullable from information_schema.columns
--       where table_name = 'profielen' and column_name = 'reflectie_uitnodiging';
-- 3. anon heeft geen EXECUTE — moet false teruggeven:
--      select has_function_privilege('anon',
--        'public.profiel_opslaan(text,text,uuid,text,text,text,uuid[],uuid[],uuid[],boolean)',
--        'execute');
-- 4. `vw_fondsleden` lekt de kolom niet — moet 4 kolommen geven (id, fonds_id,
--    naam, rol) en géén reflectie_uitnodiging:
--      select column_name from information_schema.columns
--       where table_name = 'vw_fondsleden';
