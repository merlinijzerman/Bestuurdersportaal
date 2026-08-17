-- WP3 — crash-loop-rem voor de gedeelde document-ingestworker.
-- retry_count telt afgehandelde fouten; claim_count telt opeenvolgende claims
-- die niet via een gecontroleerde workertransitie zijn afgesloten.
begin;

alter table public.document_processing_jobs
  add column if not exists claim_count integer not null default 0
    check (claim_count >= 0);

comment on column public.document_processing_jobs.claim_count is
  'Opeenvolgende onafgeronde claims. De worker reset bij yield/backoff; een harde kill niet.';

create or replace function public.documenten_claim_ingest_jobs(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer,
  p_max_per_fonds integer
) returns setof public.document_processing_jobs
language plpgsql
security definer
set search_path = public
as $f$
begin
  with uitgeput as (
    update public.document_processing_jobs j
       set status = 'mislukt', foutcode = 'claimlimiet_bereikt', eind = now()
     where j.status = 'bezig'
       and j.lease_expires_at is not null
       and j.lease_expires_at < now()
       and j.claim_count >= 3
    returning j.document_id
  )
  update public.documenten d
     set verwerkingsstatus = 'mislukt'
    from uitgeput u
   where d.id = u.document_id;

  return query
  with kandidaten as (
    select k.id, k.fonds_id, k.aangemaakt,
           (d.agendapunt_id is not null) as prioriteit
      from public.document_processing_jobs k
      join public.documenten d on d.id = k.document_id
     where k.claim_count < 3
       and (k.status = 'wachtend'
        or (k.status = 'bezig'
            and k.lease_expires_at is not null
            and k.lease_expires_at < now()))
     order by (d.agendapunt_id is not null) desc, k.aangemaakt
     for update of k skip locked
     limit greatest(p_limit, 0) * greatest(coalesce(p_max_per_fonds, 1), 1)
           + greatest(p_limit, 0)
  ),
  gerangschikt as (
    select id, prioriteit, aangemaakt,
           row_number() over (
             partition by fonds_id order by prioriteit desc, aangemaakt
           ) as rn_fonds
      from kandidaten
  ),
  geselecteerd as (
    select id from gerangschikt
     where rn_fonds <= greatest(coalesce(p_max_per_fonds, 1), 1)
     order by prioriteit desc, aangemaakt
     limit greatest(p_limit, 0)
  )
  update public.document_processing_jobs j
     set status = 'bezig',
         worker_id = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         start = now(),
         claim_count = j.claim_count + 1
    from geselecteerd g
   where j.id = g.id
  returning j.*;
end
$f$;

revoke execute on function
  public.documenten_claim_ingest_jobs(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.documenten_claim_ingest_jobs(text, integer, integer, integer)
  to service_role;

commit;
