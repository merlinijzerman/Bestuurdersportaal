-- ============================================================================
-- 2026-08-22 — hardening expliciete bewijs↔vereiste-binding
--
-- Aanvulling op 2026_08_18_bewijs_requirement_binding.sql:
--   1. één bewijs per vereiste en één stapvolgorde per procedure;
--   2. server-side validatie van iedere niet-lege binding, ook via PostgREST;
--   3. atomisch auditspoor voor INSERT/UPDATE/DELETE van bewijs;
--   4. bewijs, stappen en readiness worden onderdeel van het beslismoment-
--      snapshot. Bestaande snapshots blijven uiteraard onveranderd.
--
-- Fail-closed: bestaande dubbele bindingen of stapvolgordes stoppen de migratie
-- met een concrete fout. Eerst de data beoordelen en herstellen, nooit
-- stilzwijgend één rij kiezen.
-- ROLLBACK: supabase/rollbacks/2026_08_22_bewijs_requirement_binding_hardening_ROLLBACK.sql
-- ============================================================================

begin;

do $$
begin
  if exists (
    select 1
      from public.procedure_bewijs
     where requirement_sleutel is not null
     group by stap_id, requirement_sleutel
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Bewijsbinding-hardening: bestaande dubbele (stap_id, requirement_sleutel); review vereist.';
  end if;

  if exists (
    select 1
      from public.procedure_stappen
     group by procedure_id, volgorde
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Bewijsbinding-hardening: bestaande dubbele (procedure_id, volgorde); review vereist.';
  end if;
end $$;

drop index if exists public.idx_procbewijs_req_sleutel;
create unique index idx_procbewijs_req_sleutel
  on public.procedure_bewijs(stap_id, requirement_sleutel)
  where requirement_sleutel is not null;

create unique index if not exists idx_procedure_stappen_volgorde_uniek
  on public.procedure_stappen(procedure_id, volgorde);

-- Voorkom dat nieuwe instantievereisten dezelfde inhoudelijke sleutel krijgen
-- als een template- of andere instantievereiste binnen dezelfde procedure.
-- Dit is een cross-table invariant en kan dus niet met één gewone UNIQUE-index.
create or replace function public.fn_validate_requirement_instance_binding_sleutel()
returns trigger
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  v_procedure_id uuid;
  v_fonds_id uuid;
  v_template_code text;
  v_sleutel text;
  v_treffers int;
begin
  if not new.actief
     or new.requirement_type not in ('document','external_submission','consultation') then
    return new;
  end if;

  select d.procedure_id, d.fonds_id, p.template_code
    into v_procedure_id, v_fonds_id, v_template_code
    from public.decision_objects d
    join public.procedures p on p.id = d.procedure_id
   where d.id = new.decision_id
     and p.fonds_id = d.fonds_id;

  if not found or new.fonds_id is distinct from v_fonds_id then
    raise exception using
      errcode = '23514',
      message = 'Instantievereiste geweigerd: decision/procedure/fonds-context is ongeldig.';
  end if;

  v_sleutel := new.stap_volgorde::text || '|' || new.requirement_type || '|' ||
               coalesce(new.documenttype, new.label);

  select count(*) into v_treffers
    from (
      select r.stap_volgorde::text || '|' || r.requirement_type || '|' ||
             coalesce(r.documenttype, r.label) as sleutel
        from public.procedure_requirements r
       where r.template_code = v_template_code
         and r.requirement_type in ('document','external_submission','consultation')
      union all
      select i.stap_volgorde::text || '|' || i.requirement_type || '|' ||
             coalesce(i.documenttype, i.label) as sleutel
        from public.procedure_requirement_instance i
        join public.decision_objects d on d.id = i.decision_id
       where d.procedure_id = v_procedure_id
         and d.fonds_id = v_fonds_id
         and i.fonds_id = v_fonds_id
         and i.actief
         and i.id is distinct from new.id
         and i.requirement_type in ('document','external_submission','consultation')
    ) kandidaten
   where kandidaten.sleutel = v_sleutel;

  if v_treffers > 0 then
    raise exception using
      errcode = '23505',
      message = 'Instantievereiste geweigerd: bindingssleutel bestaat al in deze procedure.';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_validate_requirement_instance_binding_sleutel()
  from public, anon, authenticated;

drop trigger if exists trg_requirement_instance_validate_binding_sleutel
  on public.procedure_requirement_instance;
create trigger trg_requirement_instance_validate_binding_sleutel
  before insert or update of
    decision_id, stap_volgorde, requirement_type, label, documenttype, actief, fonds_id
  on public.procedure_requirement_instance
  for each row execute function public.fn_validate_requirement_instance_binding_sleutel();

-- Valideer de inhoudelijke sleutel tegen zowel template- als actieve
-- instantievereisten. SECURITY DEFINER is nodig omdat de trigger onder alle
-- schrijfpaden hetzelfde oordeel moet geven; de procedure/stap wordt uitsluitend
-- uit de gemuteerde, door RLS toegelaten bewijsrij afgeleid.
create or replace function public.fn_validate_bewijs_requirement_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  v_procedure_id uuid;
  v_stap_volgorde int;
  v_template_code text;
  v_fonds_id uuid;
  v_treffers int;
begin
  if tg_op = 'UPDATE' and (
       new.id is distinct from old.id
    or new.stap_id is distinct from old.stap_id
    or new.titel is distinct from old.titel
    or new.beschrijving is distinct from old.beschrijving
    or new.toegevoegd_op is distinct from old.toegevoegd_op
    or new.toegevoegd_door is distinct from old.toegevoegd_door
    or new.toegevoegd_door_naam is distinct from old.toegevoegd_door_naam
    or new.stemming_id is distinct from old.stemming_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Bewijswijziging geweigerd: herkomst- en inhoudsvelden zijn immutable.';
  end if;

  if new.requirement_sleutel is null then
    return new;
  end if;

  select ps.procedure_id, ps.volgorde, p.template_code, p.fonds_id
    into v_procedure_id, v_stap_volgorde, v_template_code, v_fonds_id
    from public.procedure_stappen ps
    join public.procedures p on p.id = ps.procedure_id
   where ps.id = new.stap_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Bewijsbinding geweigerd: stap of procedure ontbreekt.';
  end if;

  if (select count(*) from public.procedure_stappen ps
       where ps.procedure_id = v_procedure_id
         and ps.volgorde = v_stap_volgorde) <> 1 then
    raise exception using
      errcode = '23514',
      message = 'Bewijsbinding geweigerd: stapvolgorde is niet eenduidig.';
  end if;

  select count(*) into v_treffers
    from (
      select r.stap_volgorde::text || '|' || r.requirement_type || '|' ||
             coalesce(r.documenttype, r.label) as sleutel
        from public.procedure_requirements r
       where r.template_code = v_template_code
         and r.requirement_type in ('document','external_submission','consultation')
      union all
      select i.stap_volgorde::text || '|' || i.requirement_type || '|' ||
             coalesce(i.documenttype, i.label) as sleutel
        from public.procedure_requirement_instance i
        join public.decision_objects d on d.id = i.decision_id
       where d.procedure_id = v_procedure_id
         and d.fonds_id = v_fonds_id
         and i.fonds_id = v_fonds_id
         and i.actief
         and i.requirement_type in ('document','external_submission','consultation')
    ) kandidaten
   where kandidaten.sleutel = new.requirement_sleutel;

  if v_treffers = 0 then
    raise exception using
      errcode = '23514',
      message = 'Bewijsbinding geweigerd: onbekende vereistesleutel.';
  elsif v_treffers > 1 then
    raise exception using
      errcode = '23514',
      message = 'Bewijsbinding geweigerd: vereistesleutel is dubbel gedefinieerd.';
  end if;

  if split_part(new.requirement_sleutel, '|', 1) <> v_stap_volgorde::text then
    raise exception using
      errcode = '23514',
      message = 'Bewijsbinding geweigerd: vereiste hoort bij een andere stap.';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_validate_bewijs_requirement_binding()
  from public, anon, authenticated;

drop trigger if exists trg_procedure_bewijs_validate_binding
  on public.procedure_bewijs;
create trigger trg_procedure_bewijs_validate_binding
  before insert or update
  on public.procedure_bewijs
  for each row execute function public.fn_validate_bewijs_requirement_binding();

-- Eén trigger schrijft het log in dezelfde transactie als de bewijsrij. Als de
-- loginsert faalt, rolt de mutatie terug. Daarmee geldt de auditbelofte ook voor
-- directe PostgREST-writes en niet alleen voor de Next-route.
create or replace function public.fn_audit_procedure_bewijs_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  v_row public.procedure_bewijs%rowtype;
  v_procedure_id uuid;
  v_stap_naam text;
  v_actor_id uuid;
  v_actor_naam text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select ps.procedure_id, ps.naam
    into v_procedure_id, v_stap_naam
    from public.procedure_stappen ps
   where ps.id = v_row.stap_id;

  if not found then
    raise exception 'Bewijsaudit geweigerd: stap of procedure ontbreekt.';
  end if;

  -- Alleen de sessie-identiteit is actor. `toegevoegd_door` is inhoud van de
  -- bewijsrij en mag bij een service-/owner-write niet als uitvoerder worden
  -- voorgedaan; die herkomst gaat apart in de payload.
  v_actor_id := auth.uid();
  if v_actor_id is not null then
    select p.naam into v_actor_naam
      from public.profielen p
     where p.id = v_actor_id;
  end if;
  if v_actor_id = v_row.toegevoegd_door then
    v_actor_naam := coalesce(v_actor_naam, v_row.toegevoegd_door_naam);
  end if;

  if tg_op = 'INSERT' then
    insert into public.procedure_log
      (procedure_id, event_type, actor_id, actor_naam, payload)
    values (
      v_procedure_id,
      'bewijs_toegevoegd',
      v_actor_id,
      v_actor_naam,
      jsonb_build_object(
        'bewijs_id', new.id,
        'stap', v_stap_naam,
        'titel', new.titel,
        'document_id', new.document_id,
        'stemming_id', new.stemming_id,
        'toegevoegd_door', new.toegevoegd_door,
        'toegevoegd_door_naam', new.toegevoegd_door_naam,
        'requirement_sleutel', new.requirement_sleutel
      )
    );
  elsif tg_op = 'UPDATE' then
    if old.requirement_sleutel is distinct from new.requirement_sleutel then
      insert into public.procedure_log
        (procedure_id, event_type, actor_id, actor_naam, payload)
      values (
        v_procedure_id,
        'bewijs_binding_gewijzigd',
        v_actor_id,
        v_actor_naam,
        jsonb_build_object(
          'bewijs_id', new.id,
          'stap', v_stap_naam,
          'titel', new.titel,
          'requirement_sleutel_oud', old.requirement_sleutel,
          'requirement_sleutel_nieuw', new.requirement_sleutel
        )
      );
    end if;

    if old.document_id is distinct from new.document_id
       or old.documenttype is distinct from new.documenttype then
      insert into public.procedure_log
        (procedure_id, event_type, actor_id, actor_naam, payload)
      values (
        v_procedure_id,
        'bewijs_document_gekoppeld',
        v_actor_id,
        v_actor_naam,
        jsonb_build_object(
          'bewijs_id', new.id,
          'stap', v_stap_naam,
          'titel', new.titel,
          'document_id_oud', old.document_id,
          'document_id_nieuw', new.document_id,
          'documenttype_oud', old.documenttype,
          'documenttype_nieuw', new.documenttype
        )
      );
    end if;
  else
    insert into public.procedure_log
      (procedure_id, event_type, actor_id, actor_naam, payload)
    values (
      v_procedure_id,
      'bewijs_verwijderd',
      v_actor_id,
      v_actor_naam,
      jsonb_build_object(
        'bewijs_id', old.id,
        'stap', v_stap_naam,
        'titel', old.titel,
        'document_id', old.document_id,
        'stemming_id', old.stemming_id,
        'requirement_sleutel', old.requirement_sleutel
      )
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.fn_audit_procedure_bewijs_mutation()
  from public, anon, authenticated;

drop trigger if exists trg_procedure_bewijs_audit on public.procedure_bewijs;
create trigger trg_procedure_bewijs_audit
  after insert or update or delete on public.procedure_bewijs
  for each row execute function public.fn_audit_procedure_bewijs_mutation();

-- Snapshot vanaf deze migratie: niet alleen het Decision Object en zijn
-- decision_*-kinderen, maar ook de procedurestappen, het concrete bewijs met
-- bindingssleutels en het readiness-oordeel op exact dat moment.
create or replace function public.fn_build_decision_dossier(p_decision_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'decision', to_jsonb(d.*),
    'procedure', (select to_jsonb(p.*) from public.procedures p where p.id = d.procedure_id),
    'steps', coalesce((select jsonb_agg(to_jsonb(ps.*) order by ps.volgorde, ps.id)
                        from public.procedure_stappen ps where ps.procedure_id = d.procedure_id), '[]'::jsonb),
    'bewijs', coalesce((select jsonb_agg(to_jsonb(pb.*) order by ps.volgorde, pb.toegevoegd_op, pb.id)
                         from public.procedure_stappen ps
                         join public.procedure_bewijs pb on pb.stap_id = ps.id
                        where ps.procedure_id = d.procedure_id), '[]'::jsonb),
    'readiness', public.fn_decision_readiness_overview(d.id),
    'assumptions', coalesce((select jsonb_agg(to_jsonb(a.*) order by a.aangemaakt_op)
                              from public.decision_assumptions a where a.decision_id = d.id), '[]'::jsonb),
    'risks',       coalesce((select jsonb_agg(to_jsonb(r.*) order by r.aangemaakt_op)
                              from public.decision_risks r where r.decision_id = d.id), '[]'::jsonb),
    'dissent',     coalesce((select jsonb_agg(to_jsonb(x.*) order by x.aangemaakt_op)
                              from public.decision_dissent x where x.decision_id = d.id), '[]'::jsonb),
    'conditions',  coalesce((select jsonb_agg(to_jsonb(c.*) order by c.aangemaakt_op)
                              from public.decision_conditions c where c.decision_id = d.id), '[]'::jsonb),
    'actions',     coalesce((select jsonb_agg(to_jsonb(ac.*) order by ac.aangemaakt_op)
                              from public.decision_actions ac where ac.decision_id = d.id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(to_jsonb(e.*) order by e.geplande_datum)
                              from public.decision_evaluations e where e.decision_id = d.id), '[]'::jsonb),
    'aiOutputs',   coalesce((select jsonb_agg(to_jsonb(ai.*) order by ai.aangemaakt_op)
                              from public.decision_ai_interactions ai where ai.decision_id = d.id), '[]'::jsonb),
    'events',      coalesce((select jsonb_agg(to_jsonb(g.*) order by g.tijdstip)
                              from public.governance_events g where g.decision_id = d.id), '[]'::jsonb),
    'stemverslagen', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.geopend_op desc)
                                from public.stemmingen s
                               where s.decision_id = d.id
                                 and s.status in ('gesloten','ingetrokken')), '[]'::jsonb)
  )
    from public.decision_objects d
   where d.id = p_decision_id;
$$;

revoke all on function public.fn_build_decision_dossier(uuid) from public, anon;
grant execute on function public.fn_build_decision_dossier(uuid)
  to authenticated, service_role;

commit;
