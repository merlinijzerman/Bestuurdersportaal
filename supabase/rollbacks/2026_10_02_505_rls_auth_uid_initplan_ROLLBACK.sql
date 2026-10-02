-- ============================================================================
-- #505 — terugdraaien van 2026_10_02_505_rls_auth_uid_initplan.sql.
-- ----------------------------------------------------------------------------
-- Herstelt de zes policies op `documenten` en `document_chunks` EXACT naar de
-- vorm die vóór #505 in Productie en Preview stond (read-only vastgesteld op
-- 02-10-2026, identiek aan 2026_06_20e + 2026_07_31_r1_rls_tenantgrenzen en de
-- baseline 2026_08_14): kale `auth.uid()`, rollen `public`, PERMISSIVE.
--
-- Tenantgedrag: identiek in beide standen (de check
-- supabase/checks/2026_10_02_505_rls_initplan_tenantpariteit.sql bewijst dat).
-- Gevolg: de per-rij-evaluatie van auth.uid() — en daarmee de JWT-afhankelijke
-- retrievalkosten en het 57014-risico — komt terug.
-- Data: geen. Grants: geen. Applicatiecode: geen afhankelijkheid.
--
-- Fail-closed: binnen dezelfde transactie wordt gecontroleerd dat de zes
-- policies er met dezelfde cmd/permissive/rollen staan, dat de predicaten
-- (genormaliseerd) gelijk zijn aan de vorige stand, en dat er geen
-- `( SELECT auth.uid() AS uid)` meer in voorkomt.
-- Idempotent.
-- ============================================================================

begin;

create temp table _505_rb_voor on commit drop as
select tablename::text, policyname::text, cmd::text, permissive::text,
       roles::text as roles, qual::text, with_check::text
  from pg_catalog.pg_policies
 where schemaname = 'public'
   and tablename in ('documenten', 'document_chunks');

do $$
declare
  v_namen text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into v_namen from _505_rb_voor;
  if v_namen is distinct from
     'document_chunks.chunks select, document_chunks.chunks write eigen fonds, '
     'documenten.documenten delete eigen fonds, documenten.documenten insert eigen fonds, '
     'documenten.documenten select, documenten.documenten update eigen fonds' then
    raise exception '#505-ROLLBACK FAALT (vooraf): onverwachte policyset: %', v_namen;
  end if;
end $$;

-- ── documenten (vorm van 2026_06_20e, select via 2026_07_31_r1 §7) ──────────
drop policy if exists "documenten select" on public.documenten;
create policy "documenten select" on public.documenten
  for select using (
    auth.uid() is not null
    and (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      or bibliotheek = 'generiek'
    )
  );

drop policy if exists "documenten insert eigen fonds" on public.documenten;
create policy "documenten insert eigen fonds" on public.documenten
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and bibliotheek = 'fonds');

drop policy if exists "documenten update eigen fonds" on public.documenten;
create policy "documenten update eigen fonds" on public.documenten
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and bibliotheek = 'fonds');

drop policy if exists "documenten delete eigen fonds" on public.documenten;
create policy "documenten delete eigen fonds" on public.documenten
  for delete using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── document_chunks (vorm van 2026_06_20e, select via 2026_07_31_r1 §7) ─────
drop policy if exists "chunks select" on public.document_chunks;
create policy "chunks select" on public.document_chunks
  for select using (
    auth.uid() is not null
    and document_id in (
      select id from public.documenten
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
          or bibliotheek = 'generiek'
    )
  );

drop policy if exists "chunks write eigen fonds" on public.document_chunks;
create policy "chunks write eigen fonds" on public.document_chunks
  for all using (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds')
  ) with check (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds'));

do $$
declare
  v_fout text := '';
  r record;
  c_omhulsel constant text := '\( SELECT auth\.uid\(\) AS uid\)';
begin
  for r in
    select coalesce(v.tablename, n.tablename::text) as tabel,
           coalesce(v.policyname, n.policyname::text) as naam,
           v.cmd as v_cmd, n.cmd::text as n_cmd,
           v.permissive as v_perm, n.permissive::text as n_perm,
           v.roles as v_rol, n.roles::text as n_rol,
           v.qual as v_qual, n.qual::text as n_qual,
           v.with_check as v_wc, n.with_check::text as n_wc
      from _505_rb_voor v
      full join pg_catalog.pg_policies n
        on n.schemaname = 'public' and n.tablename::text = v.tablename
       and n.policyname::text = v.policyname
     where n.tablename is null
        or n.tablename in ('documenten', 'document_chunks')
  loop
    if r.v_cmd is null or r.n_cmd is null then
      v_fout := v_fout || format(E'  - %s.%s: policy verdwenen of nieuw\n', r.tabel, r.naam);
      continue;
    end if;
    if r.v_cmd <> r.n_cmd or r.v_perm <> r.n_perm or r.v_rol <> r.n_rol then
      v_fout := v_fout || format(E'  - %s.%s: cmd/permissive/rollen gewijzigd\n', r.tabel, r.naam);
    end if;
    if regexp_replace(r.n_qual, c_omhulsel, 'auth.uid()', 'g')
         is distinct from regexp_replace(r.v_qual, c_omhulsel, 'auth.uid()', 'g')
       or regexp_replace(r.n_wc, c_omhulsel, 'auth.uid()', 'g')
         is distinct from regexp_replace(r.v_wc, c_omhulsel, 'auth.uid()', 'g') then
      v_fout := v_fout || format(E'  - %s.%s: predicaat wijkt af van de stand vóór de rollback\n', r.tabel, r.naam);
    end if;
    if coalesce(r.n_qual, '') ~ c_omhulsel or coalesce(r.n_wc, '') ~ c_omhulsel then
      v_fout := v_fout || format(E'  - %s.%s: nog een (select auth.uid())-omhulsel\n', r.tabel, r.naam);
    end if;
  end loop;
  if v_fout <> '' then
    raise exception E'#505-ROLLBACK FAALT:\n%', v_fout;
  end if;
  raise notice '#505-ROLLBACK OK: zes policies terug naar kale auth.uid(); predicaten genormaliseerd identiek.';
end $$;

commit;
