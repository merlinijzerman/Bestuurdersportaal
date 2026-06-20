-- ============================================================================
-- Storage-policy spiegel bij 2026-06-20e (Increment C+/B13).
-- ----------------------------------------------------------------------------
-- De DB-RLS-split maakt tenants read-only op generieke DOCUMENTEN; de bucket
-- 'documenten' moet dat spiegelen voor de fysieke BESTANDEN. De bestaande
-- schrijf-policy (2026_05_03) liet tenants nog naar het generiek/-pad schrijven —
-- dat is precies het lek dat B13 dicht.
--
-- Na deze migratie:
--   • LEZEN  blijft gedeeld: generiek/ + eigen fonds-pad (ongewijzigd).
--   • SCHRIJVEN (insert) mag ALLEEN nog naar het eigen fonds-pad; generiek/ niet.
-- Generiek-curatie loopt interim via service-role (omzeilt RLS); de platform-UI
-- komt in Increment P1 (B14).
--
-- Storage-policies leven in het storage-schema en worden los van de tabel-
-- migraties beheerd. Draai dit bestand handmatig in Supabase, in dezelfde
-- migratie-eerst-dan-deploy-slag als 2026_06_20e. Idempotent.
-- ============================================================================

-- Lezen: ONGEWIJZIGD (gedeeld, incl. generiek). Herzet idempotent voor de zekerheid.
drop policy if exists "documenten storage lezen" on storage.objects;
create policy "documenten storage lezen" on storage.objects
  for select using (
    bucket_id = 'documenten'
    and (
      (storage.foldername(name))[1] = 'generiek'
      or (storage.foldername(name))[1] = (
        select fonds_id::text from public.profielen where id = auth.uid()
      )
    )
  );

-- Schrijven: B13 — ALLEEN het eigen fonds-pad. generiek/ valt er bewust uit.
drop policy if exists "documenten storage schrijven" on storage.objects;
create policy "documenten storage schrijven" on storage.objects
  for insert with check (
    bucket_id = 'documenten'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = (
      select fonds_id::text from public.profielen where id = auth.uid()
    )
  );

-- ── ROLLBACK (terug naar de 2026_05_03-staat: generiek/ weer beschrijfbaar) ──
-- drop policy if exists "documenten storage schrijven" on storage.objects;
-- create policy "documenten storage schrijven" on storage.objects
--   for insert with check (
--     bucket_id = 'documenten'
--     and auth.uid() is not null
--     and (
--       (storage.foldername(name))[1] = 'generiek'
--       or (storage.foldername(name))[1] = (
--         select fonds_id::text from public.profielen where id = auth.uid()
--       )
--     )
--   );
