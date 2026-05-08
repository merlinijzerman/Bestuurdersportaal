-- ============================================================
--  Migratie 2026-05-07 — Decision Object (Proceduremodule MVP-1A)
--  Revisie 2.1 — tweede reviewronde, 7 correcties
--
--  Wijzigingen t.o.v. v2:
--   • decision_ai_interactions: nieuw veld validatie_domein
--     (algemeen / risk / compliance / beleggingen / governance)
--     bepaalt welke rol mag valideren (RLS in sectie 15)
--
--  Wijzigingen t.o.v. v1:
--   • classificatie: van één enum-veld naar zes dimensies
--     (complexiteit, risiconiveau, mandaatgevoelig, toezichtgevoelig,
--      beleidsafwijking, ai_risicoklasse)
--   • 1-op-1 procedure↔decision: harde unique index vervangen
--     door partial unique op is_primary_decision = true
--   • procedure_evidence_requirements vervangen door
--     procedure_requirements met requirement_type-enum
--   • decision_dissent: zichtbaarheid + formeel_vastgesteld
--   • decision_ai_interactions: gebruikt_in_dossier +
--     gebruik_context + verworpen_reden
--   • governance_events: sha256 hash per event
--   • decision_audit_snapshots: nieuwe tabel + trigger
--     (snapshot bij overgang naar besloten/in_evaluatie/afgesloten)
--   • Volledigheidscheck → decision_readiness_check(target)
--     + decision_readiness_overview(); werkt over requirement_type
--   • Dissent-RLS: zichtbaarheid × rol caller
--   • fn_build_decision_dossier(decision_id) als view-builder
--
--  Strategie:
--   • Bestaande procedures-tabellen blijven volledig intact.
--   • Decision Object hangt 1-op-1 aan procedure_id voor MVP,
--     maar het datamodel staat 1-op-n later toe.
--   • Auto-upgrade van bestaande procedures bij eerste opening
--     gebeurt via lib-code (zie lib/decision.ts), niet hier.
--   • Idempotent: opnieuw draaien is veilig.
--
--  Voor: Supabase Dashboard → SQL Editor → Run.
-- ============================================================

create extension if not exists "pgcrypto";   -- voor digest()

-- ── 1. Decision Objects ────────────────────────────────────
create table if not exists public.decision_objects (
  id                   uuid primary key default uuid_generate_v4(),
  procedure_id         uuid not null references public.procedures(id) on delete cascade,
  fonds_id             uuid not null references public.fondsen(id) on delete cascade,
  besluit_code         text not null,
  titel                text not null,
  besluitvraag         text not null,
  aanleiding           text,
  scope                text,
  governance_orgaan    text,
  vertrouwelijkheid    text not null default 'intern'
                        check (vertrouwelijkheid in (
                          'publiek','intern','vertrouwelijk','strikt_vertrouwelijk'
                        )),

  -- Classificatie: zes onafhankelijke dimensies (rev. 2)
  complexiteit         text not null default 'complicated'
                        check (complexiteit in ('routine','complicated','complex')),
  risiconiveau         text not null default 'middel'
                        check (risiconiveau in ('laag','middel','hoog')),
  mandaatgevoelig      boolean not null default false,
  toezichtgevoelig     boolean not null default false,
  beleidsafwijking     boolean not null default false,
  ai_risicoklasse      text not null default 'laag'
                        check (ai_risicoklasse in ('laag','middel','hoog')),

  status               text not null default 'concept'
                        check (status in (
                          'concept','in_onderbouwing','in_validatie','in_review',
                          'geagendeerd','in_bespreking','besloten','voorwaardelijk_besloten',
                          'afgewezen','aangehouden','geescaleerd','teruggezet',
                          'in_uitvoering','in_evaluatie','afgesloten','heropend','geannuleerd'
                        )),
  is_primary_decision  boolean not null default true,        -- bereid 1:n voor (rev. 2)
  eigenaar_id          uuid references auth.users(id) on delete set null,
  eigenaar_naam        text,
  template_versie      text,
  gewenste_besluitdatum date,
  aangemaakt_op        timestamptz default now(),
  laatst_gewijzigd     timestamptz default now(),
  unique (besluit_code)
);

create index if not exists idx_dobj_fonds on public.decision_objects(fonds_id, aangemaakt_op desc);
create index if not exists idx_dobj_status on public.decision_objects(fonds_id, status);
create index if not exists idx_dobj_procedure on public.decision_objects(procedure_id);

-- Partial unique: maximaal één primary decision per procedure (rev. 2).
-- Niet-primary decisions zijn toegestaan, ook in MVP, als datamodel-toleratie.
create unique index if not exists idx_dobj_one_primary
  on public.decision_objects(procedure_id)
  where is_primary_decision = true;

-- Backref-kolom in procedures voor JOIN-gemak (optioneel).
alter table public.procedures
  add column if not exists decision_id uuid references public.decision_objects(id) on delete set null;
create index if not exists idx_procedures_decision on public.procedures(decision_id);

-- Sequence voor besluit_code (BSL-2026-NNNN). Gevoed via trigger.
create sequence if not exists public.decision_seq start 1;

create or replace function public.fn_decision_code()
returns trigger language plpgsql as $$
declare
  jaar text := to_char(now(), 'YYYY');
  vol  int  := nextval('public.decision_seq');
begin
  if new.besluit_code is null or new.besluit_code = '' then
    new.besluit_code := 'BSL-' || jaar || '-' || lpad(vol::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_decision_code on public.decision_objects;
create trigger trg_decision_code
  before insert on public.decision_objects
  for each row execute procedure public.fn_decision_code();

create or replace function public.fn_decision_touch()
returns trigger language plpgsql as $$
begin
  new.laatst_gewijzigd := now();
  return new;
end;
$$;

drop trigger if exists trg_decision_touch on public.decision_objects;
create trigger trg_decision_touch
  before update on public.decision_objects
  for each row execute procedure public.fn_decision_touch();

-- ── 2. Aannames ────────────────────────────────────────────
create table if not exists public.decision_assumptions (
  id                  uuid primary key default uuid_generate_v4(),
  decision_id         uuid not null references public.decision_objects(id) on delete cascade,
  tekst               text not null,
  type                text default 'overig'
                       check (type in (
                         'macro','beleggingsinhoudelijk','risico','kosten','governance','overig'
                       )),
  bron_document_id    uuid references public.documenten(id) on delete set null,
  ai_gedetecteerd     boolean default false,
  status              text default 'concept'
                       check (status in ('concept','gevalideerd','gewijzigd','verwijderd')),
  onzekerheid         text check (onzekerheid in ('laag','middel','hoog')),
  evaluatiecriterium  text,
  aangemaakt_op       timestamptz default now(),
  gewijzigd_door      uuid references auth.users(id) on delete set null
);
create index if not exists idx_assump_dec on public.decision_assumptions(decision_id);

-- ── 3. Risico's ────────────────────────────────────────────
create table if not exists public.decision_risks (
  id                  uuid primary key default uuid_generate_v4(),
  decision_id         uuid not null references public.decision_objects(id) on delete cascade,
  risicomatrix_id     uuid references public.risicos(id) on delete set null,
  categorie           text check (categorie in (
                        'financieel','operationeel','juridisch','reputatie',
                        'liquiditeit','compliance','overig'
                      )),
  beschrijving        text not null,
  impact              int check (impact between 1 and 5),
  kans                int check (kans between 1 and 5),
  eigenaar_naam       text,
  mitigatie           text,
  residual_risk       text,
  status              text default 'open'
                       check (status in ('open','gemitigeerd','geaccepteerd')),
  aangemaakt_op       timestamptz default now()
);
create index if not exists idx_risk_dec on public.decision_risks(decision_id);

-- ── 4. Dissent (rev. 2: zichtbaarheid + formeel_vastgesteld) ─
create table if not exists public.decision_dissent (
  id                       uuid primary key default uuid_generate_v4(),
  decision_id              uuid not null references public.decision_objects(id) on delete cascade,
  bestuurder_id            uuid references auth.users(id) on delete set null,
  bestuurder_naam          text not null,
  zichtbaarheid            text not null default 'gedeelde_zorg'
                            check (zichtbaarheid in (
                              'prive','gedeelde_zorg','formele_dissent','minderheidsnotitie'
                            )),
  formeel_vastgesteld      boolean default false,
  standpunt                text not null,
  argument                 text,
  gekoppeld_risico_id      uuid references public.decision_risks(id) on delete set null,
  gekoppeld_aanname_id     uuid references public.decision_assumptions(id) on delete set null,
  gekoppeld_voorwaarde_id  uuid,  -- forward declared
  aangemaakt_op            timestamptz default now()
);
create index if not exists idx_dissent_dec on public.decision_dissent(decision_id);

-- ── 5. Voorwaarden + KPI's ─────────────────────────────────
create table if not exists public.decision_conditions (
  id                     uuid primary key default uuid_generate_v4(),
  decision_id            uuid not null references public.decision_objects(id) on delete cascade,
  voorwaarde             text not null,
  eigenaar_naam          text,
  kpi                    text,
  drempelwaarde          text,
  monitorfrequentie      text,
  deadline               date,
  heroverwegingstrigger  text,
  status                 text default 'open'
                          check (status in (
                            'open','op_schema','afwijking','vervuld','overschreden'
                          )),
  aangemaakt_op          timestamptz default now()
);
create index if not exists idx_cond_dec on public.decision_conditions(decision_id);

-- Forward FK voor dissent → condition
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'decision_dissent_voorwaarde_fk'
  ) then
    alter table public.decision_dissent
      add constraint decision_dissent_voorwaarde_fk
      foreign key (gekoppeld_voorwaarde_id)
      references public.decision_conditions(id)
      on delete set null;
  end if;
end $$;

-- ── 6. Acties ──────────────────────────────────────────────
create table if not exists public.decision_actions (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  voorwaarde_id   uuid references public.decision_conditions(id) on delete set null,
  actie           text not null,
  eigenaar_naam   text,
  deadline        date,
  status          text default 'open'
                   check (status in ('open','in_behandeling','afgerond','vervallen','escalatie')),
  afhankelijk_van uuid references public.decision_actions(id) on delete set null,
  aangemaakt_op   timestamptz default now()
);
create index if not exists idx_actions_dec on public.decision_actions(decision_id);

-- ── 7. Evaluaties ──────────────────────────────────────────
create table if not exists public.decision_evaluations (
  id                  uuid primary key default uuid_generate_v4(),
  decision_id         uuid not null references public.decision_objects(id) on delete cascade,
  geplande_datum      date not null,
  uitgevoerd_op       timestamptz,
  verwachte_effecten  text,
  realisatie          text,
  afwijkingsanalyse   text,
  conclusie           text,
  lessons_learned     text,
  uitgevoerd_door     uuid references auth.users(id) on delete set null,
  aangemaakt_op       timestamptz default now()
);
create index if not exists idx_eval_dec on public.decision_evaluations(decision_id);

-- ── 8. AI-interacties (rev. 2: gebruikt_in_dossier + context) ─
create table if not exists public.decision_ai_interactions (
  id                  uuid primary key default uuid_generate_v4(),
  decision_id         uuid not null references public.decision_objects(id) on delete cascade,
  procedure_stap_id   uuid references public.procedure_stappen(id) on delete set null,
  type                text not null
                       check (type in (
                         'samenvatting','aannamedetectie','scenario',
                         'kritische_vraag','vergelijking'
                       )),
  prompt              text not null,
  bronnen             jsonb default '[]',
  model               text default 'claude-sonnet-4-5',
  modelversie         text,
  output              text not null,
  validatiestatus     text default 'concept'
                       check (validatiestatus in (
                         'concept','gevalideerd','aangepast','afgekeurd','gearchiveerd'
                       )),
  gevalideerd_door    uuid references auth.users(id) on delete set null,
  gevalideerd_op      timestamptz,
  aangepaste_output   text,

  -- Rev. 2: audit-vraag "welke AI-output heeft besluit beïnvloed?"
  gebruikt_in_dossier boolean default false,
  gebruik_context     text,
  verworpen_reden     text,

  -- Rev. 2.1: bepaalt welke rol mag valideren (zie RLS-policy in sectie 15)
  validatie_domein    text default 'algemeen'
                       check (validatie_domein in (
                         'algemeen','risk','compliance','beleggingen','governance'
                       )),

  aangemaakt_op       timestamptz default now(),
  aangemaakt_door     uuid references auth.users(id) on delete set null
);
create index if not exists idx_aiint_dec on public.decision_ai_interactions(decision_id, aangemaakt_op desc);

-- Migratiepad voor lopende installaties die v2 al draaiden:
alter table public.decision_ai_interactions
  add column if not exists validatie_domein text default 'algemeen'
    check (validatie_domein in ('algemeen','risk','compliance','beleggingen','governance'));

-- ── 9. Procedure requirements (rev. 2: generiek) ───────────
create table if not exists public.procedure_requirements (
  id                              uuid primary key default uuid_generate_v4(),
  template_code                   text not null,
  stap_volgorde                   int not null,
  requirement_type                text not null
                                   check (requirement_type in (
                                     'document','field','assumption','risk',
                                     'ai_validation','approval','mandate_check',
                                     'kpi','evaluation','dissent_review'
                                   )),
  label                           text not null,
  documenttype                    text,                       -- nullable; alleen bij type='document'
  veld_pad                        text,                       -- alleen bij type='field'
  verplicht                       boolean default true,
  blokkerend                      boolean default true,
  validatieregel                  text,

  -- Conditionele activatie op classificatie-dimensies
  triggert_bij_complexiteit       text[],
  triggert_bij_risiconiveau       text[],
  triggert_bij_mandaatgevoelig    boolean,
  triggert_bij_toezichtgevoelig   boolean
);
create index if not exists idx_req_template on public.procedure_requirements(template_code, stap_volgorde);
create unique index if not exists idx_req_uniek
  on public.procedure_requirements(template_code, stap_volgorde, requirement_type, coalesce(documenttype, label));

-- ── 10. Governance event log (rev. 2: append-only + hash) ──
create table if not exists public.governance_events (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid references public.decision_objects(id) on delete cascade,
  event_type      text not null,
  actor_id        uuid references auth.users(id) on delete set null,
  actor_naam      text,
  object_type     text,
  object_id       uuid,
  oude_waarde     jsonb,
  nieuwe_waarde   jsonb,
  reden           text,
  hash            text,                                  -- sha256 over canonical event-data
  tijdstip        timestamptz default now()
);
create index if not exists idx_govevents_dec on public.governance_events(decision_id, tijdstip desc);

-- Append-only: blokkeer update/delete door ALLE rollen.
create or replace function public.fn_govevent_immutable()
returns trigger language plpgsql as $f$
begin
  raise exception 'governance_events is append-only';
end;
$f$;

drop trigger if exists trg_govevent_no_update on public.governance_events;
create trigger trg_govevent_no_update
  before update on public.governance_events
  for each row execute procedure public.fn_govevent_immutable();

drop trigger if exists trg_govevent_no_delete on public.governance_events;
create trigger trg_govevent_no_delete
  before delete on public.governance_events
  for each row execute procedure public.fn_govevent_immutable();

-- Hash per event (rev. 2)
create or replace function public.fn_govevent_hash()
returns trigger language plpgsql as $f$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
      coalesce(new.event_type,'')        || '|' ||
      coalesce(new.decision_id::text,'') || '|' ||
      coalesce(new.object_type,'')       || '|' ||
      coalesce(new.object_id::text,'')   || '|' ||
      coalesce(new.oude_waarde::text,'') || '|' ||
      coalesce(new.nieuwe_waarde::text,'')|| '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$f$;

drop trigger if exists trg_govevent_hash on public.governance_events;
create trigger trg_govevent_hash
  before insert on public.governance_events
  for each row execute procedure public.fn_govevent_hash();

-- ── 11. Statusovergangen — assertion-functie ───────────────
create or replace function public.fn_decision_status_check()
returns trigger language plpgsql as $$
declare
  toegestaan jsonb := jsonb_build_object(
    'concept',                    jsonb_build_array('in_onderbouwing','geannuleerd'),
    'in_onderbouwing',            jsonb_build_array('in_validatie','teruggezet','geannuleerd'),
    'in_validatie',               jsonb_build_array('in_review','teruggezet','geescaleerd'),
    'in_review',                  jsonb_build_array('geagendeerd','teruggezet','geescaleerd'),
    'geagendeerd',                jsonb_build_array('in_bespreking','aangehouden'),
    'in_bespreking',              jsonb_build_array('besloten','voorwaardelijk_besloten','aangehouden','teruggezet','afgewezen'),
    'besloten',                   jsonb_build_array('in_uitvoering','afgesloten'),
    'voorwaardelijk_besloten',    jsonb_build_array('in_uitvoering','heropend'),
    'in_uitvoering',              jsonb_build_array('in_evaluatie','geescaleerd'),
    'in_evaluatie',               jsonb_build_array('afgesloten','heropend'),
    'afgesloten',                 jsonb_build_array('heropend'),
    'teruggezet',                 jsonb_build_array('in_onderbouwing','in_validatie'),
    'geescaleerd',                jsonb_build_array('in_validatie','in_review','aangehouden'),
    'aangehouden',                jsonb_build_array('in_review','geagendeerd','geannuleerd'),
    'heropend',                   jsonb_build_array('in_onderbouwing','in_validatie'),
    'afgewezen',                  jsonb_build_array(),
    'geannuleerd',                jsonb_build_array()
  );
  toegestane_arr text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  toegestane_arr := array(
    select jsonb_array_elements_text(coalesce(toegestaan -> old.status, '[]'::jsonb))
  );
  if not (new.status = any (toegestane_arr)) then
    raise exception
      'Ongeldige statusovergang van % naar %. Toegestaan: %',
      old.status, new.status, toegestane_arr;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_decision_status_check on public.decision_objects;
create trigger trg_decision_status_check
  before update of status on public.decision_objects
  for each row execute procedure public.fn_decision_status_check();

-- ── 12. Audit snapshots (nieuw v2) ─────────────────────────
create table if not exists public.decision_audit_snapshots (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  trigger_status  text not null,
  snapshot        jsonb not null,
  hash            text not null,
  aangemaakt_op   timestamptz default now()
);
create index if not exists idx_audit_snap_dec on public.decision_audit_snapshots(decision_id, aangemaakt_op desc);

-- Snapshots zijn ook append-only (eindgebruikers mogen niet wijzigen)
create or replace function public.fn_snapshot_immutable()
returns trigger language plpgsql as $f$
begin
  raise exception 'decision_audit_snapshots is append-only';
end;
$f$;

drop trigger if exists trg_snap_no_update on public.decision_audit_snapshots;
create trigger trg_snap_no_update
  before update on public.decision_audit_snapshots
  for each row execute procedure public.fn_snapshot_immutable();

drop trigger if exists trg_snap_no_delete on public.decision_audit_snapshots;
create trigger trg_snap_no_delete
  before delete on public.decision_audit_snapshots
  for each row execute procedure public.fn_snapshot_immutable();

-- ── 13. View-builder fn_build_decision_dossier ─────────────
-- Levert een samengesteld JSON-object met alle relevante kindrijen.
-- Wordt gebruikt door (a) de live API-route GET /api/decisions/:id/dossier
-- en (b) de snapshot-trigger.
create or replace function public.fn_build_decision_dossier(p_decision_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'decision', to_jsonb(d.*),
    'procedure', (select to_jsonb(p.*) from public.procedures p where p.id = d.procedure_id),
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
                              from public.governance_events g where g.decision_id = d.id), '[]'::jsonb)
  )
    from public.decision_objects d
   where d.id = p_decision_id;
$$;

-- Snapshot-trigger: bij overgang naar besluitvormings- of evaluatiestatus
create or replace function public.fn_decision_snapshot()
returns trigger language plpgsql as $$
declare
  v_doc jsonb;
begin
  if new.status in ('besloten','voorwaardelijk_besloten','in_evaluatie','afgesloten')
     and (old.status is null or old.status <> new.status) then
    select public.fn_build_decision_dossier(new.id) into v_doc;
    insert into public.decision_audit_snapshots(decision_id, trigger_status, snapshot, hash)
    values (
      new.id,
      new.status,
      v_doc,
      encode(digest(v_doc::text, 'sha256'), 'hex')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_decision_snapshot on public.decision_objects;
create trigger trg_decision_snapshot
  after update of status on public.decision_objects
  for each row execute procedure public.fn_decision_snapshot();

-- ── 14. Readiness-check (rev. 2) ───────────────────────────
-- Generiek: itereert over procedure_requirements per requirement_type.
-- target = onderbouwing_compleet | reviewrijp | bespreekrijp |
--          besluitrijp | verantwoordingsrijp | evaluatierijp
create or replace function public.fn_decision_readiness_check(
  p_decision_id uuid,
  p_target      text
) returns jsonb language plpgsql stable as $$
declare
  v_dec       record;
  v_proc      record;
  ontbrekend  jsonb := '[]'::jsonb;
  blokkerend  boolean := false;
  rij         record;

  -- Mapping: welke requirement_types gelden voor welke readiness-target?
  relevante_types text[];
begin
  select * into v_dec from public.decision_objects where id = p_decision_id;
  if not found then
    return jsonb_build_object('error', 'decision_not_found');
  end if;
  select * into v_proc from public.procedures where id = v_dec.procedure_id;

  relevante_types := case p_target
    when 'onderbouwing_compleet' then array['document','field']
    when 'reviewrijp'            then array['document','field','ai_validation','risk']
    when 'bespreekrijp'          then array['document','field','ai_validation','risk','assumption']
    when 'besluitrijp'           then array['document','field','ai_validation','risk','assumption','mandate_check','approval']
    when 'verantwoordingsrijp'   then array['document','field','ai_validation','risk','assumption','mandate_check','approval','dissent_review']
    when 'evaluatierijp'         then array['kpi','evaluation']
    else array['document']
  end;

  -- Itereer over alle requirements voor template+stap, gefilterd op
  -- conditionele activatie en op type-relevantie voor dit target.
  for rij in
    select *
      from public.procedure_requirements
     where template_code = v_proc.template_code
       and verplicht = true
       and requirement_type = any (relevante_types)
       and (triggert_bij_complexiteit       is null or v_dec.complexiteit       = any (triggert_bij_complexiteit))
       and (triggert_bij_risiconiveau       is null or v_dec.risiconiveau       = any (triggert_bij_risiconiveau))
       and (triggert_bij_mandaatgevoelig    is null or v_dec.mandaatgevoelig    = triggert_bij_mandaatgevoelig)
       and (triggert_bij_toezichtgevoelig   is null or v_dec.toezichtgevoelig   = triggert_bij_toezichtgevoelig)
  loop
    declare
      vervuld boolean := false;
    begin
      case rij.requirement_type
        when 'document' then
          vervuld := exists (
            select 1
              from public.procedure_stappen ps
              join public.procedure_bewijs pb on pb.stap_id = ps.id
             where ps.procedure_id = v_proc.id
               and ps.volgorde = rij.stap_volgorde
               and (rij.documenttype is null
                    or lower(coalesce(pb.titel,'')) like '%' || lower(rij.documenttype) || '%')
          );
        when 'ai_validation' then
          vervuld := exists (
            select 1 from public.decision_ai_interactions
             where decision_id = p_decision_id
               and validatiestatus in ('gevalideerd','aangepast')
          );
        when 'assumption' then
          vervuld := exists (
            select 1 from public.decision_assumptions
             where decision_id = p_decision_id
               and status in ('gevalideerd','gewijzigd')
          );
        when 'risk' then
          vervuld := exists (
            select 1 from public.decision_risks where decision_id = p_decision_id
          );
        when 'mandate_check' then
          vervuld := exists (
            select 1 from public.governance_events
             where decision_id = p_decision_id and event_type = 'mandate_check_passed'
          );
        when 'approval' then
          vervuld := v_dec.status in ('besloten','voorwaardelijk_besloten','in_uitvoering','in_evaluatie','afgesloten');
        when 'kpi' then
          vervuld := exists (
            select 1 from public.decision_conditions where decision_id = p_decision_id and kpi is not null
          );
        when 'evaluation' then
          vervuld := exists (
            select 1 from public.decision_evaluations where decision_id = p_decision_id
          );
        when 'dissent_review' then
          vervuld := not exists (
            select 1 from public.decision_dissent
             where decision_id = p_decision_id
               and zichtbaarheid in ('formele_dissent','minderheidsnotitie')
               and not formeel_vastgesteld
          );
        when 'field' then
          vervuld := true;  -- placeholder; veld-specifieke checks in MVP-1B
        else
          vervuld := false;
      end case;

      if not vervuld then
        ontbrekend := ontbrekend || jsonb_build_object(
          'requirement_type', rij.requirement_type,
          'stap_volgorde',    rij.stap_volgorde,
          'label',            rij.label,
          'documenttype',     rij.documenttype,
          'blokkerend',       rij.blokkerend
        );
        if rij.blokkerend then blokkerend := true; end if;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'decision_id',    p_decision_id,
    'target',         p_target,
    'voldoet',        not blokkerend,
    'blokkerend',     blokkerend,
    'kan_overrulen',  array['voorzitter','beheerder'],
    'ontbrekend',     ontbrekend
  );
end;
$$;

-- Overview: alle readiness-niveaus in één call
create or replace function public.fn_decision_readiness_overview(p_decision_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'onderbouwing_compleet', public.fn_decision_readiness_check(p_decision_id, 'onderbouwing_compleet'),
    'reviewrijp',            public.fn_decision_readiness_check(p_decision_id, 'reviewrijp'),
    'bespreekrijp',          public.fn_decision_readiness_check(p_decision_id, 'bespreekrijp'),
    'besluitrijp',           public.fn_decision_readiness_check(p_decision_id, 'besluitrijp'),
    'verantwoordingsrijp',   public.fn_decision_readiness_check(p_decision_id, 'verantwoordingsrijp'),
    'evaluatierijp',         public.fn_decision_readiness_check(p_decision_id, 'evaluatierijp')
  );
$$;

-- ── 15. RLS policies (rev. 2: zes lagen, dissent strenger) ─
alter table public.decision_objects             enable row level security;
alter table public.decision_assumptions         enable row level security;
alter table public.decision_risks               enable row level security;
alter table public.decision_dissent             enable row level security;
alter table public.decision_conditions          enable row level security;
alter table public.decision_actions             enable row level security;
alter table public.decision_evaluations         enable row level security;
alter table public.decision_ai_interactions     enable row level security;
alter table public.procedure_requirements       enable row level security;
alter table public.governance_events            enable row level security;
alter table public.decision_audit_snapshots     enable row level security;

-- Laag 1: tenant-isolatie via fonds_id
drop policy if exists "fonds decision_objects" on public.decision_objects;
create policy "fonds decision_objects" on public.decision_objects
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Laag 2: decision-chain — generiek voor decision_*-tabellen + events + snapshots
do $$
declare
  t text;
  policies text[] := array[
    'decision_assumptions',
    'decision_risks',
    'decision_conditions',
    'decision_actions',
    'decision_evaluations',
    'decision_ai_interactions',
    'governance_events',
    'decision_audit_snapshots'
  ];
begin
  foreach t in array policies loop
    execute format('drop policy if exists "fonds %1$s" on public.%1$s', t);
    execute format($p$
      create policy "fonds %1$s" on public.%1$s
        for all using (
          decision_id in (
            select id from public.decision_objects
             where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
          )
        )
    $p$, t);
  end loop;
end $$;

-- Laag 5: dissent-zichtbaarheid (rev. 2) — strenger dan generieke chain
drop policy if exists "fonds decision_dissent" on public.decision_dissent;
drop policy if exists "dissent zichtbaarheid select" on public.decision_dissent;
create policy "dissent zichtbaarheid select" on public.decision_dissent
  for select using (
    -- Eigen dissent altijd zichtbaar
    bestuurder_id = auth.uid()
    or
    -- Niet-privé voor voorzitter/beheerder binnen fonds
    (zichtbaarheid <> 'prive' and exists (
       select 1 from public.profielen
        where id = auth.uid() and rol in ('voorzitter','beheerder')
    ))
    or
    -- Formele dissent + minderheidsnotitie zichtbaar voor alle bestuurders binnen fonds
    (zichtbaarheid in ('formele_dissent','minderheidsnotitie')
     and decision_id in (
       select id from public.decision_objects
        where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
     ))
  );

-- Schrijf-policy voor dissent: alleen bestuurder zelf (voor eigen dissent) of voorzitter/beheerder
drop policy if exists "dissent zichtbaarheid write" on public.decision_dissent;
create policy "dissent zichtbaarheid write" on public.decision_dissent
  for all using (
    bestuurder_id = auth.uid()
    or exists (
      select 1 from public.profielen
       where id = auth.uid() and rol in ('voorzitter','beheerder')
    )
  );

-- procedure_requirements: read-all (template-config), write alleen beheerder.
drop policy if exists "req read all" on public.procedure_requirements;
create policy "req read all" on public.procedure_requirements
  for select using (auth.uid() is not null);

drop policy if exists "req write beheerder" on public.procedure_requirements;
create policy "req write beheerder" on public.procedure_requirements
  for all using (
    exists (
      select 1 from public.profielen
       where id = auth.uid() and rol = 'beheerder'
    )
  );

-- AI-validatie: welke rol mag validatiestatus updaten? (rev. 2.1)
-- Selecteren mag iedereen binnen fonds (via generieke decision-chain policy
-- hierboven). Voor update geldt een striktere domein-gebaseerde regel.
drop policy if exists "ai validatie domein" on public.decision_ai_interactions;
create policy "ai validatie domein" on public.decision_ai_interactions
  for update using (
    -- Decision binnen eigen fonds (laag 2)
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      -- Algemene output: elke ingelogde gebruiker
      validatie_domein = 'algemeen'
      or
      -- Specialistische domeinen: alleen voorzitter/beheerder.
      -- Wanneer in latere fases dedicated rollen `risk` en `compliance`
      -- worden geïntroduceerd, kunnen die hier worden toegevoegd.
      (validatie_domein in ('risk','compliance','beleggingen','governance')
       and exists (
         select 1 from public.profielen
          where id = auth.uid() and rol in ('voorzitter','beheerder')
       )
      )
    )
  );

-- ============================================================
--  Einde migratie 2026-05-07 (rev. 2.1).
--  Volgende: Fase 1B — template-seed voor
--  'beleidswijziging_beleggingsbeleid' + procedure_requirements
--  + auto-upgrade-functie voor bestaande procedures
--  + lib/decision-view.ts types + dossier-API.
-- ============================================================
