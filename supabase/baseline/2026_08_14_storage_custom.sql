-- Applicatiespecifieke Storage-configuratie uit bestuurdersportaal-preview.
-- De Supabase-systeemtabeldefinities komen uit de lokale stack zelf; alleen
-- bucketconfiguratie en onze eigen RLS-policies horen in de applicatiebaseline.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('documenten-quarantaine', 'documenten-quarantaine', false, null),
  ('aqlab-audit',            'aqlab-audit',            false, null),
  ('documenten',             'documenten',             false, 26214400),
  ('afschriften',            'afschriften',            false, 157286400)
on conflict (id) do update
set name            = excluded.name,
    public          = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "documenten storage lezen" on storage.objects;
create policy "documenten storage lezen"
  on storage.objects for select
  using (
    bucket_id = 'documenten'
    and (
      (storage.foldername(name))[1] = 'generiek'
      or (storage.foldername(name))[1] = (
        select fonds_id::text from public.profielen where id = auth.uid()
      )
    )
  );

drop policy if exists "documenten storage schrijven" on storage.objects;
create policy "documenten storage schrijven"
  on storage.objects for insert
  with check (
    bucket_id = 'documenten'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
  );

drop policy if exists "afschriften storage lezen" on storage.objects;
create policy "afschriften storage lezen"
  on storage.objects for select
  using (
    bucket_id = 'afschriften'
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
    and (
      select rol from public.profielen where id = auth.uid()
    ) is distinct from 'bestuursbureau'
  );

drop policy if exists "aqlab-audit fonds-download vrijgegeven" on storage.objects;
create policy "aqlab-audit fonds-download vrijgegeven"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'aqlab-audit'
    and exists (
      select 1
        from public.aqlab_audit_exports ae
        join public.aqlab_release_decisions rd
          on rd.audit_export_id = ae.id
       where rd.release_status = 'vrijgegeven'
         and coalesce(
           ae.opslag_ref,
           ae.run_id::text || '/' || ae.id::text || '.html'
         ) = storage.objects.name
    )
  );
