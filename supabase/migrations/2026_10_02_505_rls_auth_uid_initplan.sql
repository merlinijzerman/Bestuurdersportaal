-- ============================================================================
-- #505 — RLS-performance: auth.uid() eenmaal per statement (InitPlan) in de
-- policies van `document_chunks` en `documenten`.
-- ----------------------------------------------------------------------------
-- OORZAAK (gemeten, zie de PR en HANDOVER §#505).
--   De zes policies op deze twee tabellen roepen `auth.uid()` kaal aan. Die
--   functie is STABLE, niet IMMUTABLE, en Postgres evalueert haar daarom per
--   rij waar zij in een rijfilter staat. Elke aanroep leest
--   `request.jwt.claims` en parset die jsonb volledig. De kosten per rij
--   schalen dus met de omvang van de JWT: op Productie (25k chunks) kost één
--   `zoek_chunks`-aanroep met een realistische JWT (~0,9 kB) 8–12 s tegen een
--   statement_timeout van 8 s (57014).
--
-- WIJZIGING — uitsluitend de expressievorm.
--   Elke `auth.uid()` wordt `(select auth.uid())`, ook binnen de
--   profiel-fonds-lookup. Een ongecorreleerde scalaire subquery wordt een
--   InitPlan: één evaluatie per statement in plaats van één per rij.
--   (Supabase-aanbeveling `auth_rls_initplan`.)
--   Niets anders verandert: per policy blijven naam, command, PERMISSIVE,
--   rollen (`public`), USING en WITH CHECK predicaatgelijk. `auth.uid()` hangt
--   alleen af van de sessie-instelling `request.jwt.claim(s)`, die binnen één
--   statement niet wijzigt; per-rij- en per-statement-evaluatie geven dus
--   dezelfde waarde voor elke rij. Er is geen grantwijziging (V3-allowlist
--   ongewijzigd).
--
--   Bewust NIET in deze migratie (zie besluit 0216):
--   - geen `TO authenticated` in plaats van `public`: dat is een
--     reikwijdtewijziging (rollen als portaal_beperkt, ai_gateway en
--     SECURITY DEFINER-eigenaren vallen dan buiten de policy), en de
--     InitPlan-winst hangt er niet van af;
--   - geen herstructurering van de permissive ALL-policy
--     "chunks write eigen fonds" (die via OR mee-evalueert bij SELECT).
--
-- FAIL-CLOSED. De migratie legt de huidige zes policies vast in een tijdelijke
-- tabel, herschrijft ze en vergelijkt daarna binnen dezelfde transactie:
--   - exact dezelfde zes namen, cmd, permissive en rollen;
--   - USING en WITH CHECK, genormaliseerd (`( SELECT auth.uid() AS uid)` →
--     `auth.uid()`), tekstueel identiek aan vóór de migratie;
--   - geen kale `auth.uid()` meer over;
--   - RLS staat aan op beide tabellen.
--   Wijkt iets af (ook: onverwachte policies vooraf), dan rolt alles terug.
--
-- VOLGORDE. Geen applicatiecode hangt hiervan af; de migratie kan los worden
-- toegepast. EERST portal_preview, dán de merge naar preview; Productie
-- (portal_production) uitsluitend na apart akkoord van de opdrachtgever.
-- Na toepassing op een gehoste omgeving: de fidelity-/driftpin van die
-- omgeving herijken (de policyvingerafdrukken veranderen bewust).
--
-- Idempotent. ROLLBACK: supabase/rollbacks/2026_10_02_505_rls_auth_uid_initplan_ROLLBACK.sql
-- DB-check: supabase/checks/2026_10_02_505_rls_initplan_tenantpariteit.sql
-- ============================================================================

begin;

-- ── 0. Vastleggen wat er nu staat ───────────────────────────────────────────
create temp table _505_voor on commit drop as
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
    into v_namen from _505_voor;
  if v_namen is distinct from
     'document_chunks.chunks select, document_chunks.chunks write eigen fonds, '
     'documenten.documenten delete eigen fonds, documenten.documenten insert eigen fonds, '
     'documenten.documenten select, documenten.documenten update eigen fonds' then
    raise exception '#505 FAALT (vooraf): onverwachte policyset op documenten/document_chunks: %', v_namen;
  end if;
end $$;

-- ── 1. documenten ───────────────────────────────────────────────────────────
drop policy if exists "documenten select" on public.documenten;
create policy "documenten select" on public.documenten
  as permissive for select to public
  using (
    (select auth.uid()) is not null
    and (
      fonds_id = (select profielen.fonds_id from public.profielen
                   where profielen.id = (select auth.uid()))
      or bibliotheek = 'generiek'
    )
  );

drop policy if exists "documenten insert eigen fonds" on public.documenten;
create policy "documenten insert eigen fonds" on public.documenten
  as permissive for insert to public
  with check (
    fonds_id = (select profielen.fonds_id from public.profielen
                 where profielen.id = (select auth.uid()))
    and bibliotheek = 'fonds'
  );

drop policy if exists "documenten update eigen fonds" on public.documenten;
create policy "documenten update eigen fonds" on public.documenten
  as permissive for update to public
  using (
    fonds_id = (select profielen.fonds_id from public.profielen
                 where profielen.id = (select auth.uid()))
  )
  with check (
    fonds_id = (select profielen.fonds_id from public.profielen
                 where profielen.id = (select auth.uid()))
    and bibliotheek = 'fonds'
  );

drop policy if exists "documenten delete eigen fonds" on public.documenten;
create policy "documenten delete eigen fonds" on public.documenten
  as permissive for delete to public
  using (
    fonds_id = (select profielen.fonds_id from public.profielen
                 where profielen.id = (select auth.uid()))
  );

-- ── 2. document_chunks ──────────────────────────────────────────────────────
drop policy if exists "chunks select" on public.document_chunks;
create policy "chunks select" on public.document_chunks
  as permissive for select to public
  using (
    (select auth.uid()) is not null
    and document_id in (
      select documenten.id from public.documenten
       where documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                     where profielen.id = (select auth.uid()))
          or documenten.bibliotheek = 'generiek'
    )
  );

drop policy if exists "chunks write eigen fonds" on public.document_chunks;
create policy "chunks write eigen fonds" on public.document_chunks
  as permissive for all to public
  using (
    document_id in (
      select documenten.id from public.documenten
       where documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                     where profielen.id = (select auth.uid()))
         and documenten.bibliotheek = 'fonds'
    )
  )
  with check (
    document_id in (
      select documenten.id from public.documenten
       where documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                     where profielen.id = (select auth.uid()))
         and documenten.bibliotheek = 'fonds'
    )
  );

-- ── 3. Fail-closed verificatie: alleen de expressievorm veranderde ──────────
do $$
declare
  v_fout text := '';
  r record;
  -- `(select auth.uid())` deparseert als `( SELECT auth.uid() AS uid)`.
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
      from _505_voor v
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
      v_fout := v_fout || format(E'  - %s.%s: cmd/permissive/rollen gewijzigd (%s/%s/%s → %s/%s/%s)\n',
        r.tabel, r.naam, r.v_cmd, r.v_perm, r.v_rol, r.n_cmd, r.n_perm, r.n_rol);
    end if;
    if regexp_replace(r.n_qual, c_omhulsel, 'auth.uid()', 'g')
         is distinct from regexp_replace(r.v_qual, c_omhulsel, 'auth.uid()', 'g')
       or regexp_replace(r.n_wc, c_omhulsel, 'auth.uid()', 'g')
         is distinct from regexp_replace(r.v_wc, c_omhulsel, 'auth.uid()', 'g') then
      v_fout := v_fout || format(E'  - %s.%s: predicaat gewijzigd (meer dan de expressievorm)\n', r.tabel, r.naam);
    end if;
    if position('auth.uid()' in regexp_replace(coalesce(r.n_qual, ''), c_omhulsel, '', 'g')) > 0
       or position('auth.uid()' in regexp_replace(coalesce(r.n_wc, ''), c_omhulsel, '', 'g')) > 0 then
      v_fout := v_fout || format(E'  - %s.%s: nog een kale auth.uid()\n', r.tabel, r.naam);
    end if;
  end loop;

  if exists (select 1 from pg_catalog.pg_class
              where oid in ('public.documenten'::regclass, 'public.document_chunks'::regclass)
                and not relrowsecurity) then
    v_fout := v_fout || E'  - RLS staat niet aan op documenten/document_chunks\n';
  end if;

  if v_fout <> '' then
    raise exception E'#505 FAALT:\n%', v_fout;
  end if;
  raise notice '#505 OK: zes policies herschreven naar (select auth.uid()); predicaten genormaliseerd identiek.';
end $$;

commit;
