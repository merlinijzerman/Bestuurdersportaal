-- ============================================================================
-- Migratie 2026-06-18c — Increment C: Documentstatus, bronstatus en
-- metadata-beheer.
-- ----------------------------------------------------------------------------
-- Maakt van documenten bestuurbare bronnen: rijk statusmodel in drie lagen,
-- bewerkbare + auditbare metadata zonder herupload, en een metadata-review-
-- queue. Levert de DATA en het BEHEER; de filtering-vóór-retrieval
-- (peildatum/bronstatus/conceptuitsluiting in de RAG) komt in Increment G.
--
-- Leidend: FO v1.2 §6 (documentmodule + statusmodel) en §7 (metadata-beheer);
-- TO v1.2 §2.4, §3 (drie statuslagen) en §3.1 (statustransitietabel);
-- decisions/0006, decisions/0007 (fondsconsistentie via trigger bij nullable
-- documenten.fonds_id).
--
-- Drie statuslagen (TO §3):
--   Laag 1 = documenten.actief  (bestaat al; harde uitsluiting; ONGEWIJZIGD).
--   Laag 2 = documenten.status  (deze migratie; 8-waarden enum).
--   Laag 3 = documenten.bronstatus (deze migratie; 4-waarden enum).
--
-- Transitiespec-spiegel: fn_document_status_transitie() is de SQL-tweeling van
-- lib/document-status-transities.ts (TO §3.1). IMMUTABLE + puur → los testbaar
-- en gedeeld door de status-overgang-trigger.
--
-- Backfill (kritisch, veilig):
--   • Nieuwe kolommen nullable bij toevoeging; documenten.actief ongewijzigd.
--   • bronstatus blijft NULL → tijdens de overgang behandelt retrieval (G)
--     NULL als "actief"; bestaande documenten vallen NIET uit de RAG.
--   • status backfill = 'concept' (conservatief: concept is nooit actuele bron).
--   • Alle bestaande documenten: metadata_te_controleren=true +
--     metadata_review_status='te_controleren' + (fonds-docs) in de review-queue
--     als "nog niet verrijkt".
--   • Exit-criterium voor de NULL-coulance: zodra de review-queue leeg is
--     (of onder afgesproken drempel), landt een vervolgmigratie die strikte
--     bronstatusfiltering inschakelt (Increment G).
--
-- Idempotent. EERST in Supabase draaien, DAN code-deploy (anders breken de
-- nieuwe CHECK-constraints / enumwaarden). ROLLBACK: zie
-- 2026_06_18_documentstatus_metadata_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Nieuwe kolommen op documenten (allemaal additief) ───────────────────
alter table public.documenten
  add column if not exists context                     text,
  add column if not exists vergadering_id              uuid references public.vergaderingen(id) on delete set null,
  add column if not exists documenttype                text,
  add column if not exists status                      text,
  add column if not exists bronstatus                  text,
  add column if not exists documentdatum               date,
  add column if not exists geldig_vanaf                date,
  add column if not exists geldig_tot                  date,
  add column if not exists vervangt_document_id        uuid references public.documenten(id) on delete set null,
  add column if not exists vervangen_door_document_id  uuid references public.documenten(id) on delete set null,
  add column if not exists metadata_te_controleren     boolean not null default false,
  add column if not exists metadata_review_status      text not null default 'niet_nodig',
  add column if not exists metadata_gecontroleerd_door uuid references auth.users(id) on delete set null,
  add column if not exists metadata_gecontroleerd_op   timestamptz;

-- ── 2. Backfill (VÓÓR de CHECK-constraints; volgorde is cruciaal) ──────────

-- 2a. vergadering_id afleiden uit het gekoppelde agendapunt (nieuw kolom).
update public.documenten d
   set vergadering_id = a.vergadering_id
  from public.agendapunten a
 where d.agendapunt_id = a.id
   and d.vergadering_id is null;

-- 2b. context afleiden: vergadering > dossier > algemeen (conservatief).
update public.documenten
   set context = case
     when agendapunt_id is not null or vergadering_id is not null then 'vergadering'
     when procesinstantie_id is not null                          then 'dossier'
     else 'algemeen'
   end
 where context is null;

-- 2c. status: conservatief 'concept' (nooit actuele bron tot bewust verrijkt).
update public.documenten set status = 'concept' where status is null;

-- 2d. bronstatus: bewust NULL laten (≡ "actief" tijdens overgang, zie kop).

-- 2e. metadata-review-markering op alle bestaande documenten.
update public.documenten
   set metadata_te_controleren = true,
       metadata_review_status  = 'te_controleren'
 where metadata_review_status is null
    or metadata_review_status = 'niet_nodig';

-- ── 3. Pre-flight: faal hard als backfill een contextregel zou schenden ─────
do $$
declare
  v_aantal int;
begin
  select count(*) into v_aantal
    from public.documenten
   where (context = 'dossier'     and procesinstantie_id is null)
      or (context = 'vergadering' and vergadering_id     is null)
      or (agendapunt_id is not null and vergadering_id   is null)
      or (context not in ('dossier','vergadering','algemeen'));
  if v_aantal > 0 then
    raise exception
      'Migratie afgebroken: % document(en) schenden de contextregels na backfill. Controleer 2a-2b vóór het zetten van de constraints.',
      v_aantal;
  end if;
end $$;

-- ── 4. CHECK-constraints + defaults op documenten ──────────────────────────
-- context: NOT NULL met default (TO §2.4).
alter table public.documenten alter column context set default 'algemeen';
update public.documenten set context = 'algemeen' where context is null;
alter table public.documenten alter column context set not null;
alter table public.documenten alter column status set default 'concept';

do $$
begin
  -- enum-checks (idempotent: eerst droppen)
  alter table public.documenten drop constraint if exists documenten_context_check;
  alter table public.documenten add  constraint documenten_context_check
    check (context in ('dossier','vergadering','algemeen'));

  alter table public.documenten drop constraint if exists documenten_documenttype_check;
  alter table public.documenten add  constraint documenten_documenttype_check
    check (documenttype is null or documenttype in (
      'beleid','besluit','besluitdocument','besluitregistratie','bestuursvoorstel',
      'notulen','advies','memo','analyse','bijlage','overig'));

  alter table public.documenten drop constraint if exists documenten_status_check;
  alter table public.documenten add  constraint documenten_status_check
    check (status is null or status in (
      'concept','ter_bespreking','ter_besluitvorming','vastgesteld',
      'van_kracht','vervangen','alleen_historisch','gearchiveerd'));

  alter table public.documenten drop constraint if exists documenten_bronstatus_check;
  alter table public.documenten add  constraint documenten_bronstatus_check
    check (bronstatus is null or bronstatus in (
      'actief','historisch','uitgesloten','actief_na_vaststelling'));

  alter table public.documenten drop constraint if exists documenten_review_status_check;
  alter table public.documenten add  constraint documenten_review_status_check
    check (metadata_review_status in (
      'niet_nodig','te_controleren','gecontroleerd','afgewezen'));

  -- contextvalidatieregels (FO §6 / TO §2.4) die als CHECK kunnen
  alter table public.documenten drop constraint if exists documenten_context_dossier_check;
  alter table public.documenten add  constraint documenten_context_dossier_check
    check (context <> 'dossier' or procesinstantie_id is not null);

  alter table public.documenten drop constraint if exists documenten_context_vergadering_check;
  alter table public.documenten add  constraint documenten_context_vergadering_check
    check (context <> 'vergadering' or vergadering_id is not null);

  alter table public.documenten drop constraint if exists documenten_agendapunt_vergadering_check;
  alter table public.documenten add  constraint documenten_agendapunt_vergadering_check
    check (agendapunt_id is null or vergadering_id is not null);
end $$;

create index if not exists idx_documenten_status      on public.documenten(status);
create index if not exists idx_documenten_bronstatus  on public.documenten(bronstatus);
create index if not exists idx_documenten_vergadering on public.documenten(vergadering_id) where vergadering_id is not null;
create index if not exists idx_documenten_review      on public.documenten(metadata_review_status) where metadata_te_controleren = true;

-- ── 5. Statustransitie-spec als SQL-spiegel (TO §3.1) ──────────────────────
-- IMMUTABLE + puur (geen tabeltoegang): testbaar over alle paren, gedeeld door
-- de status-overgang-trigger. Houd 1-op-1 gelijk aan
-- lib/document-status-transities.ts. Niet-genoemde paren → toegestaan=false.
-- drop+create (geen "create or replace") zodat een eerder half-aangemaakte
-- of afwijkende signature schoon vervangen wordt.
drop function if exists public.fn_document_status_transitie(text, text);
create function public.fn_document_status_transitie(
  p_van text, p_naar text
)
returns table (
  toegestaan boolean,
  redenplicht boolean,
  vereist_vervangen_door boolean,
  herindexering boolean,
  bruikbaar_actueel boolean
)
language sql immutable as $$
  select t.toegestaan::boolean,
         t.redenplicht::boolean,
         t.vereist_vervangen_door::boolean,
         t.herindexering::boolean,
         t.bruikbaar_actueel::boolean
  from (values
    ('concept',           'ter_bespreking',     true,  false, false, true,  false),
    ('ter_bespreking',    'ter_besluitvorming', true,  false, false, true,  false),
    ('ter_besluitvorming','vastgesteld',        true,  true,  false, true,  true ),
    ('vastgesteld',       'van_kracht',         true,  false, false, true,  true ),
    ('van_kracht',        'vervangen',          true,  true,  true,  true,  false),
    ('van_kracht',        'alleen_historisch',  true,  true,  false, true,  false),
    ('concept',           'gearchiveerd',       true,  true,  false, true,  false),
    ('ter_bespreking',    'gearchiveerd',       true,  true,  false, true,  false),
    ('ter_besluitvorming','gearchiveerd',       true,  true,  false, true,  false),
    ('vastgesteld',       'gearchiveerd',       true,  true,  false, true,  false),
    ('van_kracht',        'gearchiveerd',       true,  true,  false, true,  false),
    ('vervangen',         'gearchiveerd',       true,  true,  false, true,  false),
    ('alleen_historisch', 'gearchiveerd',       true,  true,  false, true,  false)
  ) as t(van, naar, toegestaan, redenplicht, vereist_vervangen_door, herindexering, bruikbaar_actueel)
  where t.van = p_van and t.naar = p_naar;
$$;

-- Status-overgang-trigger (defense-in-depth náást server-side validatie).
-- Dwingt "geen sprongen" af. Escape voor admin-herstel + migratie/backfill via
-- session-GUC app.status_transitie_bypass = 'on' (set local in de admin-route).
create or replace function public.fn_document_status_overgang_check()
returns trigger language plpgsql as $$
declare
  v_toegestaan boolean;
begin
  if new.status is distinct from old.status then
    if coalesce(current_setting('app.status_transitie_bypass', true), 'off') = 'on' then
      return new;
    end if;
    -- NULL/onbekende oude status (legacy) → laat eerste expliciete zet toe.
    if old.status is null then
      return new;
    end if;
    select toegestaan into v_toegestaan
      from public.fn_document_status_transitie(old.status, new.status);
    if not coalesce(v_toegestaan, false) then
      raise exception
        'Ongeldige documentstatus-overgang: % → % (niet toegestaan volgens transitietabel TO §3.1)',
        old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_status_overgang on public.documenten;
create trigger trg_document_status_overgang
  before update of status on public.documenten
  for each row execute procedure public.fn_document_status_overgang_check();

-- ── 6. Secundaire dossierkoppelingen: document_procesinstanties ─────────────
-- Fondsconsistentie via TRIGGER (besluit 0007): documenten.fonds_id is nullable
-- (generieke bibliotheek), dus geen composite-FK. Generieke documenten kunnen
-- daardoor geen secundaire dossierkoppeling krijgen — bewust.
create table if not exists public.document_procesinstanties (
  id                 uuid primary key default uuid_generate_v4(),
  fonds_id           uuid not null references public.fondsen(id) on delete cascade,
  document_id        uuid not null references public.documenten(id) on delete cascade,
  procesinstantie_id uuid not null references public.procedures(id) on delete cascade,
  aangemaakt_door    uuid references auth.users(id) on delete set null,
  aangemaakt         timestamptz default now(),
  unique (document_id, procesinstantie_id)
);

create index if not exists idx_doc_proc_document on public.document_procesinstanties(document_id);
create index if not exists idx_doc_proc_proc     on public.document_procesinstanties(procesinstantie_id);

-- RLS: tenant-isolatie op eigen fonds_id (fonds_id is NOT NULL op deze tabel).
-- Capability documents.metadata.update wordt server-side in de route afgedwongen;
-- RLS dekt tenant + leesrechten (anon-key, nooit service-role).
alter table public.document_procesinstanties enable row level security;

drop policy if exists "fonds document_procesinstanties" on public.document_procesinstanties;
create policy "fonds document_procesinstanties" on public.document_procesinstanties
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- Validatie op de koppeltabel: secundair ≠ primair, fondsconsistentie
-- (document = procesinstantie = join), en document moet fonds-gebonden zijn.
create or replace function public.fn_document_procesinstantie_validatie()
returns trigger language plpgsql as $$
declare
  v_doc_fonds    uuid;
  v_doc_primair  uuid;
  v_proc_fonds   uuid;
begin
  select fonds_id, procesinstantie_id into v_doc_fonds, v_doc_primair
    from public.documenten where id = new.document_id;
  if v_doc_fonds is null then
    raise exception
      'Generiek document (fonds_id NULL) kan geen secundaire dossierkoppeling krijgen (document %)', new.document_id;
  end if;

  select fonds_id into v_proc_fonds
    from public.procedures where id = new.procesinstantie_id;
  if v_proc_fonds is null then
    raise exception 'Procesinstantie % bestaat niet', new.procesinstantie_id;
  end if;

  if not (v_doc_fonds = v_proc_fonds and v_doc_fonds = new.fonds_id) then
    raise exception
      'Fondsconsistentie geschonden: document-fonds %, procesinstantie-fonds %, koppel-fonds %',
      v_doc_fonds, v_proc_fonds, new.fonds_id;
  end if;

  if new.procesinstantie_id = v_doc_primair then
    raise exception
      'Secundaire koppeling mag niet gelijk zijn aan de primaire procesinstantie (%).',
      v_doc_primair;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_document_procesinstantie_validatie on public.document_procesinstanties;
create trigger trg_document_procesinstantie_validatie
  before insert or update on public.document_procesinstanties
  for each row execute procedure public.fn_document_procesinstantie_validatie();

-- Wijziging van de PRIMAIRE procesinstantie die een bestaande secundaire zou
-- dupliceren → weigeren (geen stille correctie). Op documenten.
create or replace function public.fn_document_primair_vs_secundair_check()
returns trigger language plpgsql as $$
begin
  if new.procesinstantie_id is not null
     and new.procesinstantie_id is distinct from old.procesinstantie_id
     and exists (
       select 1 from public.document_procesinstanties
        where document_id = new.id
          and procesinstantie_id = new.procesinstantie_id
     ) then
    raise exception
      'Nieuwe primaire procesinstantie % is al een secundaire koppeling van dit document. Verwijder eerst de secundaire koppeling.',
      new.procesinstantie_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_primair_vs_secundair on public.documenten;
create trigger trg_document_primair_vs_secundair
  before update of procesinstantie_id on public.documenten
  for each row execute procedure public.fn_document_primair_vs_secundair_check();

-- ── 7. Append-only metadata-auditlog (patroon governance_events) ───────────
create table if not exists public.document_metadata_log (
  id                      uuid primary key default uuid_generate_v4(),
  document_id             uuid references public.documenten(id) on delete set null,
  document_titel_snapshot text,
  fonds_id                uuid references public.fondsen(id) on delete set null,
  gewijzigd_door          uuid references auth.users(id) on delete set null,
  gewijzigd_door_naam     text,
  gewijzigd_op            timestamptz default now(),
  veld_naam               text not null,
  oude_waarde             text,
  nieuwe_waarde           text,
  wijzig_reden            text,
  wijzig_type             text,    -- 'metadata'|'status'|'bronstatus'|'koppeling'
  rag_impact              boolean default false,
  hash                    text,    -- sha256 over canonical event-data
  tijdstip                timestamptz default now()
);

create index if not exists idx_doc_meta_log_doc   on public.document_metadata_log(document_id, tijdstip desc);
create index if not exists idx_doc_meta_log_fonds on public.document_metadata_log(fonds_id, tijdstip desc);

-- Append-only: blokkeer update/delete door ALLE rollen.
create or replace function public.fn_doc_meta_log_immutable()
returns trigger language plpgsql as $f$
begin
  raise exception 'document_metadata_log is append-only';
end;
$f$;

drop trigger if exists trg_doc_meta_log_no_update on public.document_metadata_log;
create trigger trg_doc_meta_log_no_update
  before update on public.document_metadata_log
  for each row execute procedure public.fn_doc_meta_log_immutable();

drop trigger if exists trg_doc_meta_log_no_delete on public.document_metadata_log;
create trigger trg_doc_meta_log_no_delete
  before delete on public.document_metadata_log
  for each row execute procedure public.fn_doc_meta_log_immutable();

-- Hash per event (sha256), zodat de logregel manipulatie-detecteerbaar is.
create or replace function public.fn_doc_meta_log_hash()
returns trigger language plpgsql as $f$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
      coalesce(new.document_id::text,'') || '|' ||
      coalesce(new.veld_naam,'')         || '|' ||
      coalesce(new.oude_waarde,'')       || '|' ||
      coalesce(new.nieuwe_waarde,'')     || '|' ||
      coalesce(new.wijzig_reden,'')      || '|' ||
      coalesce(new.wijzig_type,'')       || '|' ||
      coalesce(new.rag_impact::text,'')  || '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$f$;

drop trigger if exists trg_doc_meta_log_hash on public.document_metadata_log;
create trigger trg_doc_meta_log_hash
  before insert on public.document_metadata_log
  for each row execute procedure public.fn_doc_meta_log_hash();

alter table public.document_metadata_log enable row level security;

drop policy if exists "lees document_metadata_log" on public.document_metadata_log;
create policy "lees document_metadata_log" on public.document_metadata_log
  for select using (
    fonds_id is null
    or fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "schrijf document_metadata_log" on public.document_metadata_log;
create policy "schrijf document_metadata_log" on public.document_metadata_log
  for insert with check (gewijzigd_door = auth.uid());

-- ── 8. Metadata-review-queue (generieke "Te beoordelen"-hub, increment C) ───
-- Bewust gescheiden van classificatie_voorstellen (increment E). Enkel
-- fonds-documenten (per-fonds queue); generieke docs vallen er buiten.
create table if not exists public.document_metadata_review_queue (
  id             uuid primary key default uuid_generate_v4(),
  fonds_id       uuid not null references public.fondsen(id) on delete cascade,
  document_id    uuid not null references public.documenten(id) on delete cascade,
  reden          text not null check (reden in ('backfill','ontbrekende_metadata','onzekere_status','handmatig')),
  status         text not null default 'open' check (status in ('open','in_behandeling','gecontroleerd','afgewezen')),
  aangemaakt     timestamptz default now(),
  beoordeeld_door uuid references auth.users(id) on delete set null,
  beoordeeld_op  timestamptz,
  opmerking      text,
  unique (document_id)
);

create index if not exists idx_meta_review_fonds  on public.document_metadata_review_queue(fonds_id, status);
create index if not exists idx_meta_review_status on public.document_metadata_review_queue(status);

alter table public.document_metadata_review_queue enable row level security;

drop policy if exists "lees meta_review_queue" on public.document_metadata_review_queue;
create policy "lees meta_review_queue" on public.document_metadata_review_queue
  for select using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "schrijf meta_review_queue" on public.document_metadata_review_queue;
create policy "schrijf meta_review_queue" on public.document_metadata_review_queue
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 9. Backfill review-queue: bestaande fonds-documenten = "nog niet verrijkt" ─
insert into public.document_metadata_review_queue (fonds_id, document_id, reden, status)
select d.fonds_id, d.id, 'backfill', 'open'
  from public.documenten d
 where d.fonds_id is not null
   and d.metadata_te_controleren = true
on conflict (document_id) do nothing;

-- ============================================================================
--  Verificatie (handmatig na Run) — migratie-DoD + regressie:
--
--  -- 9a. Statustransitie-spiegel (moet 1-op-1 met lib/ kloppen):
--  --     verwacht toegestaan=true, redenplicht=true, bruikbaar_actueel=true:
--  select * from public.fn_document_status_transitie('ter_besluitvorming','vastgesteld');
--  --     verwacht GEEN rij (sprong verboden):
--  select * from public.fn_document_status_transitie('concept','vastgesteld');
--
--  -- 9b. Rapport "aantal handmatig te beoordelen" (TO §7 punt 4):
--  select
--    count(*)                                              as totaal,
--    count(*) filter (where documentdatum is null)         as zonder_datum,
--    count(*) filter (where documenttype  is null)         as zonder_type,
--    count(*) filter (where context = 'algemeen')          as zonder_context_verfijning,
--    count(*) filter (where procesinstantie_id is null)    as zonder_dossierkoppeling,
--    count(*) filter (where metadata_te_controleren)       as te_controleren
--    from public.documenten;
--
--  -- 9c. Review-queue gevuld (open per fonds):
--  select fonds_id, status, count(*) from public.document_metadata_review_queue group by 1,2;
--
--  -- 9d. NULL-bronstatus breekt bestaande retrieval niet (C wijzigt zoek_chunks
--  --     niet; bronstatus wordt nog niet gefilterd). Sanity: documenten met
--  --     bronstatus IS NULL blijven actief/zichtbaar:
--  select count(*) from public.documenten where bronstatus is null and actief = true;
--
--  -- 9e. Contextregel afgedwongen (verwacht: 0 schendingen):
--  select count(*) from public.documenten
--   where (context='dossier' and procesinstantie_id is null)
--      or (context='vergadering' and vergadering_id is null);
-- ============================================================================
