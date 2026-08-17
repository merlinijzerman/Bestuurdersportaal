-- ============================================================================
--  2026-08-17 — WP2: auth-binding op de Storage-policies (pen-testvoorbereiding)
--
--  BEVINDING (PT-2, High). De policy `documenten storage lezen` heeft geen
--  TO-clausule en geen `auth.uid() is not null`. Zonder TO-clausule geldt een
--  policy voor TO PUBLIC, en dus ook voor `anon`. De `generiek`-tak toetst
--  uitsluitend het pad:
--
--      (storage.foldername(name))[1] = 'generiek'
--
--  Die expressie is waar zónder enige sessie. Supabase geeft `anon` standaard
--  `select` op storage.objects, dus de volledige generieke bibliotheek in de
--  private bucket `documenten` was met de publieke anon-key op te lijsten en te
--  downloaden. De fondstak lekte niet: bij een null `auth.uid()` levert de
--  subquery op profielen null op en is de vergelijking niet waar.
--
--  Dit is de DERDE M-02-locatie. De eerste twee (documenten, document_chunks)
--  zijn op 31-07-2026 gerepareerd in 2026_07_31_r1_rls_tenantgrenzen.sql; die
--  migratie benoemt deze storage-policy expliciet (r. 279-282) als "staat BUITEN
--  de migraties en moet handmatig in het dashboard". Dat is nooit gebeurd — de
--  baselinedump van 14-08 bevat de policy nog ongewijzigd. Vandaar nu wél een
--  migratie, zodat de reparatie in de keten zit in plaats van in een comment.
--
--  WAT DEZE MIGRATIE DOET. Alle vijf eigen policies op storage.objects gaan
--  expliciet op `TO authenticated`, en de leespolicy op `documenten` krijgt
--  daarnaast een expliciete `auth.uid() is not null`.
--
--  Waarom ALLE vijf en niet alleen de lekkende: een gate die "policy zonder
--  TO-clausule" afkeurt, is alleen scherp als er geen uitzonderingen zijn. Met
--  drie legitieme uitzonderingen op een allowlist is de volgende policy zonder
--  TO-clausule opnieuw onzichtbaar. `afschriften storage lezen` en `documenten
--  storage schrijven` lekken niet (hun predicaten falen fail-closed op een null
--  auth.uid()), maar leunen hun weigering op een subquery in plaats van op de
--  rol. Dat is een toevallige, geen ontworpen grens.
--
--  Zowel TO authenticated ALS het predicaat: de TO-clausule is de grofmazige
--  grens (welke rol mag de policy überhaupt aanroepen), het predicaat de
--  fijnmazige (welke rijen). Alleen TO authenticated zou een geldige sessie
--  zonder profiel nog toegang tot `generiek/` geven.
--
--  IDEMPOTENT: drop policy if exists + create policy.
--  ROLLBACK: 2026_08_17_storage_generiek_auth_binding_ROLLBACK.sql — let op, die
--  heropent het lek; lees de kop van dat bestand.
--
--  NB Storage-policies leven in het storage-schema en worden in dit project
--  buiten de reguliere migratieketen beheerd (zie 2026_06_20e). Deze migratie
--  sorteert ná de baseline-cutoff in scripts/testdb-apply-migrations.sh en wordt
--  daardoor wél automatisch op de testdatabase toegepast.
-- ============================================================================

begin;

-- ── 1. documenten — LEZEN. De lekkende policy. ──────────────────────────────
drop policy if exists "documenten storage lezen" on storage.objects;
create policy "documenten storage lezen"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documenten'
    and auth.uid() is not null
    and (
      (storage.foldername(name))[1] = 'generiek'
      or (storage.foldername(name))[1] = (
        select fonds_id::text from public.profielen where id = auth.uid()
      )
    )
  );

-- ── 2. documenten — SCHRIJVEN. Predicaat ongewijzigd, alleen TO toegevoegd. ──
-- `generiek/` valt hier bewust buiten (B13: tenants zijn read-only op de
-- gedeelde bibliotheek); dat gedrag verandert niet.
drop policy if exists "documenten storage schrijven" on storage.objects;
create policy "documenten storage schrijven"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documenten'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
  );

-- ── 3. afschriften — LEZEN. Predicaat ongewijzigd, alleen TO toegevoegd. ─────
-- De rol-uitsluiting van 'bestuursbureau' blijft ongemoeid.
drop policy if exists "afschriften storage lezen" on storage.objects;
create policy "afschriften storage lezen"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'afschriften'
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
    and (
      select rol from public.profielen where id = auth.uid()
    ) is distinct from 'bestuursbureau'
  );

-- ── 4. aqlab-audit — LEZEN. Ongewijzigd; stond al goed. ─────────────────────
-- Hier alleen opnieuw gedeclareerd zodat dit bestand de volledige, actuele
-- verzameling eigen storage-policies bevat en er geen tweede bron van waarheid
-- ontstaat.
--
-- LET OP, bekend en NIET door deze migratie opgelost: deze policy heeft geen
-- fondsgrens. Elke geauthenticeerde gebruiker kan een vrijgegeven auditexport
-- van een WILLEKEURIG fonds lezen; de fondsbinding zit uitsluitend in de
-- applicatielaag (magFondsAuditExportZien). Belegd als openstaand punt.
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

-- ── 5. documenten-quarantaine — SCHRIJVEN. ──────────────────────────────────
-- Deze WP3-policy staat al op Preview. De inhoudelijke scanpipeline valt buiten
-- deze deploy; alleen de ontbrekende rolbinding hoort bij WP2/D1.
drop policy if exists "documenten quarantaine schrijven" on storage.objects;
create policy "documenten quarantaine schrijven"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documenten-quarantaine'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
  );

-- ── 6. Fail-closed naverificatie binnen dezelfde transactie ─────────────────
-- Conform de guardrail "toets de uitkomst, niet de intentie": als de policies
-- na deze migratie niet de bedoelde vorm hebben, rollt de migratie terug in
-- plaats van een onjuiste toestand achter te laten.
do $$
declare
  fout text := '';
  r    record;
begin
  for r in
    select policyname, cmd, roles::text as roles, coalesce(qual, '') as qual
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname in (
         'documenten storage lezen',
         'documenten storage schrijven',
         'afschriften storage lezen',
         'aqlab-audit fonds-download vrijgegeven',
         'documenten quarantaine schrijven'
       )
  loop
    if r.roles is distinct from '{authenticated}' then
      fout := fout || format('  - %s: roles = %s (verwacht {authenticated})%s',
                             r.policyname, r.roles, chr(10));
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'documenten storage lezen'
       and position('auth.uid() IS NOT NULL' in coalesce(qual, '')) > 0
  ) then
    fout := fout || '  - documenten storage lezen: expliciete auth.uid()-toets ontbreekt' || chr(10);
  end if;

  if fout <> '' then
    raise exception E'MIGRATIE 2026_08_17 FAALT — policies niet in de bedoelde vorm:\n%', fout;
  end if;
  raise notice '2026_08_17 OK: vijf storage-policies op TO authenticated, leespolicy met expliciete auth.uid()-toets.';
end $$;

commit;
