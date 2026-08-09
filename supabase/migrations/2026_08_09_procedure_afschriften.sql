-- ============================================================================
-- Migratie 2026-08-09 — T6: auditdossier-afschriften (procedure_afschriften)
-- ----------------------------------------------------------------------------
-- WAAROM (werkopdracht T6, fase 1): een afschrift is een gezipte, PERMANENT aan
--   een proces gekoppelde auditbundel (auditdossier + tijdlijn + auditlog +
--   bijlagen + leeswijzer). Anders dan de vluchtige export van één besluit is
--   dit een vastgelegd, reproduceerbaar archiefstuk. Deze migratie legt het
--   datamodel + de opslag + het jobmodel aan; de bundelbouw zelf zit in code
--   (core/lib/afschrift-*.ts) en in de service-role-worker.
--
-- DRIE LAGEN, STRIKT GESCHEIDEN (T6-ontwerp): A=bron (audit/besluit/bewijs),
--   B=afgeleid (tijdlijn/manifest, code, deterministisch), C=duiding
--   (leeswijzer §2–4, in fase 2 AI). De ai_*-kolommen worden NU al aangelegd
--   zodat fase 2 geen tweede migratie nodig heeft.
--
-- BOUWMODEL (opdrachtgeverkeuze 2026-08-09): direct het volledige jobmodel.
--   De enqueue (POST /afschrift, user-RLS-client) valideert toegang + bureau-
--   gate en schrijft een rij op status='bezig'. Een cron-gedrainde worker
--   (service-role, /api/internal/afschrift-worker) claimt en bouwt. Zie
--   ADR-5: de worker draait onder service-role (geen sessie), en scoopt in
--   CODE op fonds_id. Precedent: documenten_claim_ingest_jobs (2026_08_07).
--
-- APPEND-ONLY (besluit 0001/0117): GEEN delete op procedure_afschriften.
--   Intrekken = statuswijziging via ingetrokken_*. Een BEFORE DELETE-trigger
--   (gedeelde fn_log_append_only) borgt dat er geen pad is waarlangs een rij
--   verdwijnt. UPDATE blijft toegestaan — de rij heeft een levenscyclus
--   (bezig → gereed/mislukt, en intrekken) — begrensd door RLS + app-logica.
--
-- TENANT-RLS: deny-by-default per fonds_id, patroon 1:1 van "fonds procedures"
--   (2026_07_08_t3_rls_with_check): using/with check gespiegeld. SELECT laat de
--   bureau-rol de rij WÉL zien (met reden onbereikbaar in de UI); INSERT sluit
--   de bureau-rol uit (kan niet genereren). De storage-SELECT-policy sluit de
--   bureau-rol óók uit — anders leest die de zip (met stemgedrag) direct uit
--   storage, langs de download-route-403 heen (H-08-analogie, ontwerpbeslissing
--   4). NULL-safe `is distinct from` (rol is nullable, G23-grens).
--
-- GATES (verplicht ná deze migratie): supabase/checks/2026_07_31_r1_structurele
--   _gates.sql (m.n. gate C/C2 = RLS + WITH CHECK, gate E = gepinde search_path,
--   gate H = anon/authenticated kunnen de claim-RPC niet aanroepen).
--
-- Idempotent (if not exists / drop policy if exists → create / create or
-- replace). Transactioneel. EERST in Supabase draaien, DÁN code-deploy.
-- ROLLBACK: 2026_08_09_procedure_afschriften_ROLLBACK.sql
-- TENANT-IMPACT: nieuwe tenant-tabel + nieuwe private bucket. Geen wijziging aan
--   bestaande tabellen/policies.
-- ============================================================================

begin;

-- ── 1. Tabel procedure_afschriften ──────────────────────────────────────────
create table if not exists public.procedure_afschriften (
  id                      uuid primary key default gen_random_uuid(),
  procedure_id            uuid not null references public.procedures(id) on delete cascade,
  fonds_id                uuid not null references public.fondsen(id) on delete cascade,  -- RLS-anker

  -- Parameters van het afschrift
  versie                  text not null check (versie in ('actueel','besluitmoment')),
  trigger_status          text,                          -- bij besluitmoment: welke snapshot-trigger
  aanleiding              text,                          -- vrij veld (uitgangspunt 2)

  -- Levenscyclus + jobmodel
  status                  text not null default 'bezig'
                            check (status in ('bezig','gereed','mislukt')),
  poging                  integer not null default 0,    -- ophoging per claim (crash-reclaim-teller)
  lease_tot               timestamptz,                   -- claim-lease + crash-recovery-klok
  laatste_fout            text,                          -- diagnostiek bij status='mislukt'

  -- Resultaat (gevuld door de worker)
  opslag_pad              text,                          -- <fonds_id>/<procedure_id>/<afschrift_id>.zip
  sha256                  text,                          -- van de gebouwde bundel (dedup, ontwerpbeslissing 6)
  bytes                   bigint,
  bestandsaantal          integer,
  bevat_stemgedrag        boolean not null default false, -- informatief (manifest/leeswijzer)
  gebouwd_onder_rol       text,                          -- rol van de aanvrager (gezichtshoek, ADR-5)
  uitgesloten_items       jsonb not null default '[]'::jsonb,  -- {pad,reden} per weggelaten stuk
  waarschuwingen          jsonb not null default '[]'::jsonb,  -- bv. versie-drift bijlage

  -- Verouderingssignaal (ontwerpbeslissing 5)
  dossier_stand_event_id  uuid,                          -- laatste governance_events.id bij generatie (provenance)
  dossier_stand_op        timestamptz,                   -- tijdstip-anker voor de "N sindsdien"-badge

  -- Laag C / AI-leeswijzer (FASE 2 — nu al aangelegd)
  ai_leeswijzer           boolean not null default false,
  ai_model                text,
  ai_promptversie         text,
  ai_tekst_hash           text,
  ai_vastgesteld_door     uuid references auth.users(id) on delete set null,
  ai_vastgesteld_op       timestamptz,

  -- Intrekken (geen delete — besluit 0001/0117)
  ingetrokken_op          timestamptz,
  ingetrokken_door        uuid references auth.users(id) on delete set null,
  ingetrokken_reden       text,

  -- Herkomst
  aangemaakt_op           timestamptz not null default now(),
  aangemaakt_door         uuid references auth.users(id) on delete set null,

  -- Reviewstap-borging (fase 2): status='gereed' mag alleen als de AI-tekst is
  -- vastgesteld, óf de deterministische terugval is gebruikt (ai_leeswijzer=false).
  -- In fase 1 is ai_leeswijzer altijd false, dus deze constraint is dan trivium.
  constraint afschrift_gereed_vereist_vaststelling check (
    status <> 'gereed' or ai_leeswijzer = false or ai_vastgesteld_door is not null
  )
);

comment on table public.procedure_afschriften is
  'TENANT (T6). Permanent vastgelegde auditdossier-afschriften per proces. '
  'Append-only: geen delete (fn_log_append_only), intrekken via ingetrokken_*. '
  'Bouw door service-role-worker (ADR-5), fonds-gescoopt in code. RLS per fonds_id; '
  'SELECT toont de bureau-rol de rij, INSERT + storage-lezen sluiten de bureau-rol uit.';

-- ── 2. Indexen ──────────────────────────────────────────────────────────────
create index if not exists idx_afschriften_procedure
  on public.procedure_afschriften (procedure_id, aangemaakt_op desc);
-- Claim-/drain-index op de te-bouwen status (worker selecteert 'bezig').
create index if not exists idx_afschriften_claim
  on public.procedure_afschriften (aangemaakt_op)
  where status = 'bezig';

-- ── 3. RLS: deny-by-default per fonds_id ────────────────────────────────────
alter table public.procedure_afschriften enable row level security;

-- SELECT: eigen fonds. Bewust GEEN bureau-uitsluiting — de bureau-rol ziet het
-- afschrift wél in de lijst, met de reden waarom hij het niet kan openen
-- (ontwerpbeslissing 4). De afscherming zit op downloaden (route + storage).
drop policy if exists "fonds afschriften lezen" on public.procedure_afschriften;
create policy "fonds afschriften lezen" on public.procedure_afschriften
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- INSERT: eigen fonds + NIET de bureau-rol (kan niet genereren). Defense-in-depth
-- náást de route-403; NULL-safe omdat profielen.rol nullable is.
drop policy if exists "fonds afschriften aanmaken" on public.procedure_afschriften;
create policy "fonds afschriften aanmaken" on public.procedure_afschriften
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

-- UPDATE: eigen fonds (intrekken via de PATCH-route). De worker muteert onder
-- service-role (RLS-bypass) en heeft deze policy niet nodig.
drop policy if exists "fonds afschriften bijwerken" on public.procedure_afschriften;
create policy "fonds afschriften bijwerken" on public.procedure_afschriften
  for update
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- GEEN delete-policy (deny-by-default) + BEFORE DELETE-trigger als harde borging.
drop trigger if exists trg_procedure_afschriften_no_delete on public.procedure_afschriften;
create trigger trg_procedure_afschriften_no_delete
  before delete on public.procedure_afschriften
  for each row execute procedure public.fn_log_append_only();

-- ── 4. Atomische claim-RPC voor de worker (FOR UPDATE SKIP LOCKED) ──────────
-- PostgREST kan geen `for update skip locked`; daarom een RPC. Claimt tot
-- p_limit rijen die nog gebouwd moeten worden: status='bezig' met verlopen (of
-- lege) lease. `poging` begrenst crash-reclaims. security definer + gepinde
-- search_path (gate E). Precedent: documenten_claim_ingest_jobs (2026_08_07).
create or replace function public.afschriften_claim_jobs(
  p_worker_id     text,
  p_limit         integer,
  p_lease_seconds integer
) returns setof public.procedure_afschriften
language plpgsql
security definer
set search_path = public
as $f$
begin
  return query
  with kandidaten as (
    select k.id
      from public.procedure_afschriften k
     where k.status = 'bezig'
       and (k.lease_tot is null or k.lease_tot < now())
       and k.poging < 8                         -- crash-loop-rem (§7)
     order by k.aangemaakt_op
     for update of k skip locked
     limit greatest(p_limit, 0)
  )
  update public.procedure_afschriften j
     set lease_tot = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         poging    = j.poging + 1
    from kandidaten g
   where j.id = g.id
  returning j.*;
end
$f$;

-- Grants: uitsluitend de service-role draait de worker. `revoke … from public`
-- is op Supabase niet genoeg (H-18): default-ACL kent EXECUTE expliciet aan anon
-- toe. Daarom óók anon + authenticated intrekken (die functie omzeilt RLS).
revoke execute on function public.afschriften_claim_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.afschriften_claim_jobs(text, integer, integer)
  to service_role;

-- ── 5. Private storage-bucket 'afschriften' ─────────────────────────────────
-- public=false → geen publieke URL's; download uitsluitend via kortlevende
-- signed URL (user-RLS-client) of de service-role (worker-upload). file_size_limit
-- = 150 MB, gelijk aan de ongecomprimeerde totaalcap uit ontwerpbeslissing 7.
insert into storage.buckets (id, name, public, file_size_limit)
values ('afschriften', 'afschriften', false, 157286400)  -- 150 * 1024 * 1024
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Pad-conventie: <fonds_id>/<procedure_id>/<afschrift_id>.zip
-- Lezen: eigen fonds én NIET de bureau-rol. Deze uitsluiting is essentieel:
-- zonder haar leest de bureau-rol de zip (met stemgedrag) rechtstreeks uit
-- storage, langs de download-route-403 heen (ontwerpbeslissing 4 / H-08).
drop policy if exists "afschriften storage lezen" on storage.objects;
create policy "afschriften storage lezen" on storage.objects
  for select using (
    bucket_id = 'afschriften'
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

-- Bewust GEEN insert/update/delete-policy: de worker schrijft onder service-role
-- (RLS-bypass); niemand anders schrijft of verwijdert in deze bucket.
-- Defensief: verwijder eventueel eerder per ongeluk aangemaakte schrijf-policies.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and qual like '%afschriften%'
       and policyname <> 'afschriften storage lezen'
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

commit;

-- ── Verificatie (handmatig ná de migratie; toets de UITKOMST) ────────────────
-- 1. Tabel + RLS aan:
--      select tablename, rowsecurity from pg_tables where tablename='procedure_afschriften';
-- 2. Drie policies (select/insert/update), GEEN delete-policy:
--      select cmd, policyname from pg_policies where tablename='procedure_afschriften' order by cmd;
-- 3. No-delete-trigger aanwezig:
--      select trigger_name from information_schema.triggers
--       where event_object_table='procedure_afschriften' and event_manipulation='DELETE';
-- 4. Claim-RPC = SECURITY DEFINER + gepinde search_path (gate E):
--      select proname, prosecdef, proconfig from pg_proc where proname='afschriften_claim_jobs';
-- 5. anon/authenticated kunnen de claim NIET aanroepen (gate H):
--      select has_function_privilege('anon','public.afschriften_claim_jobs(text,integer,integer)','EXECUTE');          -- false
--      select has_function_privilege('authenticated','public.afschriften_claim_jobs(text,integer,integer)','EXECUTE'); -- false
-- 6. Bucket private + limiet:
--      select id, public, file_size_limit from storage.buckets where id='afschriften';
-- 7. Storage-leespolicy sluit de bureau-rol uit (handmatig als bureau-account testen).
-- 8. Draai supabase/checks/2026_07_31_r1_structurele_gates.sql — gates A–H schoon.
-- ============================================================================
