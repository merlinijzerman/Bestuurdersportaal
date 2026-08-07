-- ============================================================================
-- Migratie 2026-08-07 — Async ingest-worker: jobs-uitbreiding + claim-RPC (F1)
-- ----------------------------------------------------------------------------
-- WAAROM (bouwticket "Async document-ingest + directe opslag", v2.1, §3):
--   Fase 2 maakt van tenant-ingest een pipeline: het upload-request registreert
--   een job, een cron-gedrainde worker (beheer-project, service-role) verwerkt.
--   Deze migratie legt het FUNDAMENT: vier additieve kolommen op de BESTAANDE
--   document_processing_jobs (P1) plus één atomische claim-functie naar het
--   bewezen model van aqlab_claim_run_jobs (2026_07_10).
--
-- WAT DEZE MIGRATIE WEL EN NIET DOET:
--   WEL:  kolommen (lease/voortgang/fonds/batch), twee indexen, claim-RPC.
--   NIET: geen nieuwe tabel, geen RLS-wijziging, geen wijziging aan documenten
--         of document_chunks. document_processing_jobs blijft deny-by-default.
--         De generieke P1-pipeline schrijft terminale jobstatussen
--         (geslaagd/mislukt/overgeslagen) en wordt NIET door de claim geraakt
--         (die selecteert alleen 'wachtend' of verlopen 'bezig').
--
-- LEASE DOET DUBBEL WERK (§3): naast "wie is ermee bezig" is lease_expires_at de
--   backoff-klok. Bij een tijdelijke providerfout blijft de job op 'bezig' met
--   een lease in de toekomst; de claim pikt hem pas op als die verlopen is —
--   exponentiële backoff zonder aparte scheduler.
--
-- SORTEERSLEUTEL (besluit A): stukken bij een agendapunt gaan vóór; binnen die
--   ordening geldt oudste-eerst. p_max_per_fonds begrenst de eerlijke verdeling.
--
-- GATES (verplicht ná deze migratie): supabase/checks/2026_07_31_r1_structurele
--   _gates.sql — met name gate E (gepinde search_path op de nieuwe SECURITY
--   DEFINER-functie) en gate H (anon kan de functie niet aanroepen).
--
-- Idempotent (add column/create index if not exists + create or replace).
-- Transactioneel. EERST in Supabase draaien, DÁN code-deploy.
-- ROLLBACK: 2026_08_07_async_ingest_worker_ROLLBACK.sql
-- TENANT-IMPACT: geen wijziging aan tenant-RLS. fonds_id op de job is
--   denormalisatie voor auditspoor + eerlijke verdeling (besluit B, mitigatie 2).
-- ============================================================================

begin;

-- ── 1. Additieve kolommen op document_processing_jobs ───────────────────────
alter table public.document_processing_jobs
  add column if not exists lease_expires_at timestamptz,
  add column if not exists verwerkt_chunks  integer,
  add column if not exists fonds_id         uuid references public.fondsen(id) on delete cascade,
  add column if not exists extern_batch_id  text;

comment on column public.document_processing_jobs.lease_expires_at is
  'Claim-lease én backoff-klok. Verlopen ⇒ herclaimbaar. Toekomst ná providerfout ⇒ backoff.';
comment on column public.document_processing_jobs.verwerkt_chunks is
  'Optionele voortgangsteller (telemetrie). De echte voortgang is chunks met embedding is null.';
comment on column public.document_processing_jobs.fonds_id is
  'Denorm van documenten.fonds_id: auditspoor + eerlijke verdeling (p_max_per_fonds). Geen RLS-grens.';
comment on column public.document_processing_jobs.extern_batch_id is
  'Anthropic Message Batches API-id (besluit D, batch-baan). NULL op de live-baan.';

-- ── 2. Claim-/drain-index op de te-verwerken statussen ──────────────────────
-- Aparte index van het bestaande idx_dpj_status: hier (status, aangemaakt) zodat
-- de order-by van de claim (aangemaakt) uit de index kan lopen.
create index if not exists idx_dpj_claim
  on public.document_processing_jobs (status, aangemaakt)
  where status in ('wachtend', 'bezig');

-- ── 3. Partiële unieke index: één OPEN job per (document, stap) ─────────────
-- Voorkomt dubbele wachtende/bezige jobs (§4b verstoring 6). Terminale jobs
-- (geslaagd/mislukt/overgeslagen) vallen buiten de index: meerdere afgeronde
-- pogingen per (document, stap) blijven toegestaan. De enqueue in F3/F6 gebruikt
-- `on conflict do nothing` tegen deze index.
-- LET OP bij het draaien: bestaan er nú al dubbele OPEN jobs, dan faalt de
-- indexcreatie. De generieke P1-pipeline schrijft alleen terminale statussen,
-- dus dat is niet verwacht; verschijnt de fout toch, ruim de dubbele open jobs
-- eerst op.
create unique index if not exists uq_dpj_open_stap
  on public.document_processing_jobs (document_id, stap)
  where status in ('wachtend', 'bezig');

-- ── 4. Atomische claim-functie (FOR UPDATE SKIP LOCKED) ─────────────────────
-- PostgREST kan geen `for update skip locked` uitdrukken; daarom een RPC. De
-- worker (service-role) claimt tot p_limit wachtende óf lease-verlopen jobs, met
-- agendapunt-voorrang, oudste-eerst, en maximaal p_max_per_fonds per fonds per
-- invocatie (eerlijke verdeling). security definer + gepinde search_path (gate E;
-- de service-role omzeilt RLS toch al, maar de pin is defense-in-depth).
--
-- ONTWERP — waarom een CTE i.p.v. één subquery zoals aqlab:
--   De eerlijke-verdeling-rang gebruikt row_number() OVER (...), en Postgres
--   staat FOR UPDATE niet toe samen met window-functies. Daarom eerst een
--   begrensd venster kandidaten LOCKEN (skip locked), dán per fonds rangschikken
--   en p_limit selecteren. Het venster is bewust ruim (overfetch) zodat na de
--   per-fonds-cap nog p_limit jobs overblijven; niet-geselecteerde locks vallen
--   vrij zodra deze rpc-transactie commit (autocommit per .rpc-call), dus de
--   overlap met een gelijktijdige invocatie is klein en zelfcorrigerend.
--
-- retry_count wordt hier BEWUST NIET verhoogd: dat telt documentfouten (§4b), en
-- die zet de worker bij falen. De reclaim-lus wordt begrensd door de lease +
-- de leeftijdscap (§4b verstoring 11), niet door retry_count.
create or replace function public.documenten_claim_ingest_jobs(
  p_worker_id     text,
  p_limit         integer,
  p_lease_seconds integer,
  p_max_per_fonds integer
) returns setof public.document_processing_jobs
language plpgsql
security definer
set search_path = public
as $f$
begin
  return query
  with kandidaten as (
    select k.id,
           k.fonds_id,
           k.aangemaakt,
           (d.agendapunt_id is not null) as prioriteit
      from public.document_processing_jobs k
      join public.documenten d on d.id = k.document_id
     where k.status = 'wachtend'
        or (k.status = 'bezig'
            and k.lease_expires_at is not null
            and k.lease_expires_at < now())
     order by (d.agendapunt_id is not null) desc, k.aangemaakt
     for update of k skip locked
     limit greatest(p_limit, 0) * greatest(coalesce(p_max_per_fonds, 1), 1)
           + greatest(p_limit, 0)
  ),
  gerangschikt as (
    select id, prioriteit, aangemaakt,
           row_number() over (
             partition by fonds_id
             order by prioriteit desc, aangemaakt
           ) as rn_fonds
      from kandidaten
  ),
  geselecteerd as (
    select id
      from gerangschikt
     where rn_fonds <= greatest(coalesce(p_max_per_fonds, 1), 1)
     order by prioriteit desc, aangemaakt
     limit greatest(p_limit, 0)
  )
  update public.document_processing_jobs j
     set status           = 'bezig',
         worker_id        = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         start            = now()
    from geselecteerd g
   where j.id = g.id
  returning j.*;
end
$f$;

-- ── 5. Grants: uitsluitend de service-role draait de worker ─────────────────
-- `revoke … from public` is op Supabase niet genoeg (H-18): de default-ACL kent
-- EXECUTE expliciet aan anon toe. Daarom óók anon; en authenticated, want geen
-- tenant-gebruiker mag ooit de queue claimen (die functie omzeilt RLS volledig).
revoke execute on function
  public.documenten_claim_ingest_jobs(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.documenten_claim_ingest_jobs(text, integer, integer, integer)
  to service_role;

commit;

-- ── Verificatie (handmatig ná de migratie; toets de UITKOMST, niet de intentie) ─
-- 1. Kolommen aanwezig:
--      select column_name from information_schema.columns
--       where table_name='document_processing_jobs'
--         and column_name in ('lease_expires_at','verwerkt_chunks','fonds_id','extern_batch_id');
-- 2. Indexen aanwezig:
--      select indexname from pg_indexes
--       where tablename='document_processing_jobs'
--         and indexname in ('idx_dpj_claim','uq_dpj_open_stap');
-- 3. Functie is SECURITY DEFINER met gepinde search_path (gate E):
--      select proname, prosecdef, proconfig from pg_proc
--       where proname='documenten_claim_ingest_jobs';
-- 4. anon kan de functie NIET aanroepen (gate H):
--      select has_function_privilege('anon',
--        'public.documenten_claim_ingest_jobs(text,integer,integer,integer)','EXECUTE');   -- false
--    en authenticated evenmin:
--      select has_function_privilege('authenticated',
--        'public.documenten_claim_ingest_jobs(text,integer,integer,integer)','EXECUTE');   -- false
-- 5. Draai supabase/checks/2026_07_31_r1_structurele_gates.sql — gates A–H schoon.
-- ============================================================================
