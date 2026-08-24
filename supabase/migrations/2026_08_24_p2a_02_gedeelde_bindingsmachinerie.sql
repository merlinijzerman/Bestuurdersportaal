-- P2 / PR-A (#167) — gedeelde bindingsmachinerie voor álle gebonden-feit-typen.
-- ---------------------------------------------------------------------------
-- Ontwerp: PROCEDURE-ENGINE-V2-ONTWERP.md §6 (BP-7, "één mechanisme"). Besluit 0189.
-- Impact: data. HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_24_p2a_02_gedeelde_bindingsmachinerie_ROLLBACK.sql
--
-- De invariant staat op ÉÉN plek (deze twee functies). Per brontabel komt een
-- dunne wrapper die de fonds/procedure-resolutie doet en deze aanroept — géén
-- TG_TABLE_NAME-dispatch die stil kan doorvallen (fail-closed hoort niet in een
-- ELSE-tak van een SECURITY DEFINER-functie).

begin;

-- ── fn_assert_gebonden_feit: de volledige bindingstoets, fail-closed.
--   p_verwacht_type = het type dat de BRONTABEL levert (letterlijk door de wrapper
--   meegegeven, niet afgeleid). Sluit de klasse "decision_risks-rij bindt een
--   kpi-vereiste": de sleutel bestaat en het fonds klopt, maar het type wijkt af.
create or replace function public.fn_assert_gebonden_feit(
  p_fonds_id        uuid,
  p_procedure_id    uuid,
  p_sleutel         text,
  p_verwacht_type   text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sleutel_type    text;
  v_template_code   text;
  v_template_versie text;
  v_fonds_proc      uuid;
  v_treffers        int;
begin
  -- Ontkoppelen (null sleutel) is geen fout op triggerniveau — I1 bewaakt de route.
  if p_sleutel is null then
    return;
  end if;

  -- (1) Type-consistentie. Het type-segment van de sleutel (segment 2; requirement_
  --     type bevat nooit '|') moet gelijk zijn aan wat de brontabel levert.
  v_sleutel_type := split_part(p_sleutel, '|', 2);
  if v_sleutel_type is distinct from p_verwacht_type then
    raise exception
      'Bindingstype-mismatch: sleutel draagt type "%", maar de bron levert "%".',
      v_sleutel_type, p_verwacht_type
      using errcode = '23514';
  end if;

  -- (2) Procedure + fonds + versie ophalen (fail-closed).
  select p.template_code, p.template_versie, p.fonds_id
    into v_template_code, v_template_versie, v_fonds_proc
    from public.procedures p
   where p.id = p_procedure_id;
  if not found then
    raise exception 'Gebonden feit: procedure % niet gevonden (fail-closed).',
      p_procedure_id using errcode = '23514';
  end if;

  -- (3) I5: bron-fonds == procedure-fonds.
  if v_fonds_proc is distinct from p_fonds_id then
    raise exception
      'Fondsgrens (I5): bron-fonds % wijkt af van procedure-fonds %.',
      p_fonds_id, v_fonds_proc using errcode = '23514';
  end if;

  -- (4) De sleutel moet EXACT één vereiste aanwijzen — versie-gefilterd (P1b:
  --     template_code ÉN template_versie), template-arm ∪ actieve instantie-arm van
  --     dit dossier. Volledige sleutel-vergelijking (een label mag '|' bevatten;
  --     daarom niet splitsen maar de hele sleutel opbouwen en vergelijken).
  select count(*) into v_treffers from (
    select 1
      from public.procedure_requirements r
     where r.template_code = v_template_code
       and r.template_versie = v_template_versie
       and (r.stap_volgorde::text || '|' || r.requirement_type || '|'
            || coalesce(r.documenttype, r.label)) = p_sleutel
    union all
    select 1
      from public.procedure_requirement_instance i
      join public.decision_objects d on d.id = i.decision_id
     where d.procedure_id = p_procedure_id
       and i.actief = true
       and (i.stap_volgorde::text || '|' || i.requirement_type || '|'
            || coalesce(i.documenttype, i.label)) = p_sleutel
  ) x;
  if v_treffers = 0 then
    raise exception 'Onbekende vereistesleutel "%" voor %@%.',
      p_sleutel, v_template_code, v_template_versie using errcode = '23514';
  end if;
  if v_treffers > 1 then
    raise exception 'Ambigue vereistesleutel "%" (% keer gedefinieerd).',
      p_sleutel, v_treffers using errcode = '23514';
  end if;
end $$;
revoke all on function public.fn_assert_gebonden_feit(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_assert_gebonden_feit(uuid, uuid, text, text) to service_role;

-- ── fn_log_gebonden_feit_mutatie: append-only auditspoor van de BINDING, niet van
--   de inhoud. De dunne AFTER-wrapper roept dit alleen bij een bindingswijziging
--   aan (INSERT met sleutel / UPDATE waarbij de sleutel wijzigt / DELETE van een
--   gebonden rij) — zo verzuipt het spoor niet in inhoudelijke wijzigingen.
create or replace function public.fn_log_gebonden_feit_mutatie(
  p_procedure_id   uuid,
  p_brontabel      text,
  p_bron_id        uuid,
  p_oude_sleutel   text,
  p_nieuwe_sleutel text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_naam  text;
  v_event text;
begin
  if p_oude_sleutel is null and p_nieuwe_sleutel is not null then
    v_event := 'gebonden_feit_gekoppeld';
  elsif p_oude_sleutel is not null and p_nieuwe_sleutel is null then
    v_event := 'gebonden_feit_ontkoppeld';
  elsif p_oude_sleutel is distinct from p_nieuwe_sleutel then
    v_event := 'gebonden_feit_herbonden';
  else
    return; -- geen bindingswijziging
  end if;

  -- Defensief tegen cascade-delete: is de procedure zelf al weg (bv. een
  -- decision_object dat via ON DELETE CASCADE zijn Groep-A-feiten meesleept), dan
  -- kan er niet tegen procedure_log gelogd worden (FK/NOT NULL). Sla dan stil over
  -- i.p.v. de hele delete met een cryptische NOT-NULL-fout te laten falen; de
  -- verwijdering van de ouder is de audit-gebeurtenis op dat niveau. (Onbereikbaar
  -- in de praktijk: Decision Objects worden niet hard-verwijderd — besluit 0001.)
  if not exists (select 1 from public.procedures where id = p_procedure_id) then
    return;
  end if;

  if v_actor is not null then
    select naam into v_naam from public.profielen where id = v_actor;
  end if;

  insert into public.procedure_log
    (procedure_id, event_type, actor_id, actor_naam, payload)
  values (
    p_procedure_id, v_event, v_actor, v_naam,
    jsonb_build_object(
      'brontabel',      p_brontabel,
      'bron_id',        p_bron_id,
      'oude_sleutel',   p_oude_sleutel,
      'nieuwe_sleutel', p_nieuwe_sleutel
    )
  );
end $$;
revoke all on function public.fn_log_gebonden_feit_mutatie(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_log_gebonden_feit_mutatie(uuid, text, uuid, text, text) to service_role;

commit;
