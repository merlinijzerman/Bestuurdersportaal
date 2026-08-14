-- ============================================================================
-- Migratie 2026-08-14 — Non-destructieve vergaderkoppelingen (document_agendapunten)
-- ----------------------------------------------------------------------------
-- WAAROM: een bestaand (bibliotheek)document moet aan een vergadering/agendapunt
--   gekoppeld kunnen worden ZONDER dat het brondocument van context wisselt of
--   zijn classificatie/geldigheid verliest. De primaire koppeling
--   (documenten.agendapunt_id / vergadering_id + context='vergadering') is
--   enkelvoudig en destructief: die verhuist het document naar de vergadercontext.
--   Deze koppeltabel is het n-op-n, non-destructieve spiegelbeeld van
--   document_procesinstanties (secundaire dossierkoppelingen, Increment C) voor
--   de vergaderkant. Eén document kan zo aan meerdere agendapunten/vergaderingen
--   hangen én tegelijk een bibliotheekdocument (context='algemeen') blijven.
--
-- MODEL (spiegelt document_procesinstanties):
--   * fonds_id NOT NULL -> tenant-isolatie via RLS op eigen fonds.
--   * vergadering_id gedenormaliseerd (afgeleid uit het agendapunt) zodat "alle
--     stukken bij deze vergadering" zonder join op agendapunten kan.
--   * validatietrigger: document niet-generiek (fonds_id NOT NULL),
--     fondsconsistentie document = vergadering = koppeling, vergadering_id hoort
--     bij het agendapunt, en de secundaire koppeling <> de primaire agendapunt-
--     koppeling van hetzelfde document (documenten.agendapunt_id).
--   * uniek (document_id, agendapunt_id).
--
-- Capability documents.metadata.update wordt server-side afgedwongen in
-- /api/documents/[id]/agendapunten (analoog aan de procesinstanties-route).
-- fondsconsistentie via TRIGGER (besluit 0007): documenten.fonds_id is nullable
-- (generieke bibliotheek), dus geen composite-FK. Generieke documenten kunnen
-- daardoor geen vergaderkoppeling krijgen — bewust.
-- ============================================================================

begin;

create table if not exists public.document_agendapunten (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  document_id     uuid not null references public.documenten(id) on delete cascade,
  agendapunt_id   uuid not null references public.agendapunten(id) on delete cascade,
  vergadering_id  uuid not null references public.vergaderingen(id) on delete cascade,
  aangemaakt_door uuid references auth.users(id) on delete set null,
  aangemaakt      timestamptz default now(),
  unique (document_id, agendapunt_id)
);

create index if not exists idx_doc_agenda_document    on public.document_agendapunten(document_id);
create index if not exists idx_doc_agenda_agendapunt  on public.document_agendapunten(agendapunt_id);
create index if not exists idx_doc_agenda_vergadering on public.document_agendapunten(vergadering_id);

-- RLS: tenant-isolatie op eigen fonds_id (fonds_id is NOT NULL op deze tabel).
-- Capability documents.metadata.update wordt server-side in de route afgedwongen;
-- RLS dekt tenant + leesrechten (anon-key, nooit service-role).
alter table public.document_agendapunten enable row level security;

drop policy if exists "fonds document_agendapunten" on public.document_agendapunten;
create policy "fonds document_agendapunten" on public.document_agendapunten
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- Validatie op de koppeltabel: document niet-generiek, fondsconsistentie
-- (document = vergadering = join), vergadering_id hoort bij het agendapunt, en
-- de secundaire koppeling mag niet gelijk zijn aan de PRIMAIRE agendapunt-
-- koppeling van hetzelfde document (documenten.agendapunt_id).
create or replace function public.fn_document_agendapunt_validatie()
returns trigger language plpgsql as $$
declare
  v_doc_fonds   uuid;
  v_doc_primair uuid;
  v_ap_verg     uuid;
  v_verg_fonds  uuid;
begin
  select fonds_id, agendapunt_id into v_doc_fonds, v_doc_primair
    from public.documenten where id = new.document_id;
  if v_doc_fonds is null then
    raise exception
      'Generiek document (fonds_id NULL) kan geen vergaderkoppeling krijgen (document %)', new.document_id;
  end if;

  select vergadering_id into v_ap_verg
    from public.agendapunten where id = new.agendapunt_id;
  if v_ap_verg is null then
    raise exception 'Agendapunt % bestaat niet of heeft geen vergadering', new.agendapunt_id;
  end if;
  if new.vergadering_id is distinct from v_ap_verg then
    raise exception
      'vergadering_id (%) hoort niet bij agendapunt % (verwacht %).',
      new.vergadering_id, new.agendapunt_id, v_ap_verg;
  end if;

  select fonds_id into v_verg_fonds
    from public.vergaderingen where id = new.vergadering_id;
  if not (v_doc_fonds = v_verg_fonds and v_doc_fonds = new.fonds_id) then
    raise exception
      'Fondsconsistentie geschonden: document-fonds %, vergadering-fonds %, koppel-fonds %',
      v_doc_fonds, v_verg_fonds, new.fonds_id;
  end if;

  if v_doc_primair is not null and new.agendapunt_id = v_doc_primair then
    raise exception
      'Secundaire koppeling mag niet gelijk zijn aan de primaire agendapunt-koppeling (%).',
      v_doc_primair;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_document_agendapunt_validatie on public.document_agendapunten;
create trigger trg_document_agendapunt_validatie
  before insert or update on public.document_agendapunten
  for each row execute procedure public.fn_document_agendapunt_validatie();

commit;
