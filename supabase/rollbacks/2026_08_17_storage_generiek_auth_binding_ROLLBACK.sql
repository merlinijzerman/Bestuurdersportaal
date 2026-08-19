-- ============================================================================
--  ROLLBACK 2026-08-17 — WP2: auth-binding op de Storage-policies
--
--  ⚠️ LET OP — DIT HEROPENT EEN HIGH-BEVINDING.
--
--  Anders dan bij de meeste rollbacks in deze map is dit géén neutrale
--  terugval. Deze rollback zet de toestand terug waarin `documenten storage
--  lezen` geen TO-clausule en geen expliciete auth.uid()-toets heeft. Daarmee
--  geldt de policy weer voor TO PUBLIC (dus ook `anon`), en is de map
--  `generiek/` in de private bucket `documenten` opnieuw ongeauthenticeerd op
--  te lijsten en te downloaden met de publieke anon-key.
--
--  Draai dit alleen als de forward-migratie aantoonbaar iets breekt dat zwaarder
--  weegt dan die blootstelling, en zet er een einddatum op. De gedragscheck in
--  supabase/checks/2026_07_09_t5_export_storage.sql wordt hierna rood — dat is
--  correct gedrag van de check, geen defect.
--
--  Wat er NIET terugkomt: de fondstak van de leespolicy lekte ook vóór de fix
--  niet (null auth.uid() → null subquery → niet waar). De blootstelling betreft
--  uitsluitend de generieke bibliotheek.
-- ============================================================================

begin;

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

-- De bestaande WP3-quarantainepolicy terugzetten zonder expliciete TO-clausule.
-- De auth.uid()-toets blijft aanwezig; de structurele gate wordt na rollback
-- bewust rood, omdat deze rollback de WP2-rolbinding ongedaan maakt.
drop policy if exists "documenten quarantaine schrijven" on storage.objects;
create policy "documenten quarantaine schrijven" on storage.objects
  for insert with check (
    bucket_id = 'documenten-quarantaine'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
  );

-- `aqlab-audit fonds-download vrijgegeven` stond vóór de migratie al op
-- TO authenticated en wordt door deze rollback dus niet teruggezet.

commit;
