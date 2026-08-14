-- ============================================================
--  Migratie 2026-08-14 — Per-proces uitsluiting van standaardset-bewijslast
--
--  DOEL: een fonds kan per PROCES een vereiste uit de generieke set als
--  "niet van toepassing" markeren, ZONDER de generieke set te wijzigen.
--
--  KERNPRINCIPE (bevestigd met de opdrachtgever): `procedure_requirements`
--  (gesleuteld op template_code, GLOBAAL/gedeeld) blijft volledig onaangeroerd —
--  geen delete, geen deactivate. Deze tabel is een OVERLAY per Decision Object:
--  ze zegt alleen "toon/tel deze vereiste niet mee vóór DIT proces". De lees-
--  laag (buildEvidenceLijst) en de readiness-functie trekken de overlay af van
--  de generieke set; andere processen (zelfde template, zelfde/ander fonds) en
--  nieuwe processen zien de volledige set.
--
--  Match-sleutel naar de template-vereiste: (stap_volgorde, requirement_type,
--  `match_sleutel`), waarbij match_sleutel = coalesce(documenttype, label) —
--  exact de identiteit uit de UNIEKE index van procedure_requirements
--  (template_code, stap_volgorde, requirement_type, coalesce(documenttype,label)).
--  Zo wordt bij twee 'document'-vereisten met dezelfde label maar ander
--  documenttype de juiste (en enkel die) uitgesloten. Append-only: `actief=false`
--  heractiveert (uitsluiting terugdraaien), geen harde delete.
--
--  Spiegelt exact het RLS/grant-patroon van procedure_requirement_instance
--  (D7b): eigen fonds_id → Gate B (WITH CHECK), schrijven voorzitter/beheerder.
--  Idempotent.
-- ============================================================

begin;

create table if not exists public.procedure_requirement_uitsluiting (
  id                  uuid primary key default uuid_generate_v4(),
  decision_id         uuid not null references public.decision_objects(id) on delete cascade,
  fonds_id            uuid not null references public.fondsen(id) on delete cascade,
  stap_volgorde       int  not null,
  requirement_type    text not null,
  label               text not null,           -- weergave/audit
  match_sleutel       text not null,           -- coalesce(documenttype, label) van de template-vereiste
  reden               text not null,
  actief              boolean not null default true,
  governance_event_id uuid references public.governance_events(id),
  uitgesloten_door    uuid references auth.users(id) on delete set null,
  uitgesloten_op      timestamptz default now(),
  unique (decision_id, stap_volgorde, requirement_type, match_sleutel)
);

create index if not exists idx_req_uitsluiting_decision
  on public.procedure_requirement_uitsluiting(decision_id);

comment on table public.procedure_requirement_uitsluiting is
  'Per-proces overlay (WO-3-vervolg): markeert een TEMPLATE-vereiste als niet van toepassing voor één Decision Object. Raakt de generieke procedure_requirements NOOIT. Fonds-RLS + WITH CHECK; schrijven voorzitter/beheerder; append-only (actief=false = terugdraaien).';

alter table public.procedure_requirement_uitsluiting enable row level security;

-- Lezen: eigen fonds.
drop policy if exists "req-uitsluiting eigen fonds lezen"
  on public.procedure_requirement_uitsluiting;
create policy "req-uitsluiting eigen fonds lezen" on public.procedure_requirement_uitsluiting
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Toevoegen: eigen fonds + voorzitter/beheerder.
drop policy if exists "req-uitsluiting toevoegen voorzitter-beheerder"
  on public.procedure_requirement_uitsluiting;
create policy "req-uitsluiting toevoegen voorzitter-beheerder" on public.procedure_requirement_uitsluiting
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

-- Wijzigen (heractiveren / opnieuw uitsluiten): eigen fonds + voorzitter/beheerder.
drop policy if exists "req-uitsluiting wijzigen voorzitter-beheerder"
  on public.procedure_requirement_uitsluiting;
create policy "req-uitsluiting wijzigen voorzitter-beheerder" on public.procedure_requirement_uitsluiting
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

revoke all on public.procedure_requirement_uitsluiting from anon;
revoke delete, truncate, references, trigger
  on public.procedure_requirement_uitsluiting from authenticated;
grant select, insert, update
  on table public.procedure_requirement_uitsluiting to authenticated;

commit;
