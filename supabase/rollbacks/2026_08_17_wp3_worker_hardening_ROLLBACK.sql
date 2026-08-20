-- Alleen gebruiken wanneer de WP3-worker eveneens naar de vorige versie gaat.
begin;

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
  return query
  with kandidaten as (
    select k.id, k.fonds_id, k.aangemaakt,
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
         start = now()
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

alter table public.document_processing_jobs
  drop column if exists claim_count;

commit;
