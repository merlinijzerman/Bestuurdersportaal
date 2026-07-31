-- ============================================================
--  Migratie 2026-07-31 — R1: ontbrekende tenantgrenzen in RLS-policies
--
--  Herstelt vijf policies die tenantdata beschermen maar waarvan het
--  PREDIKAAT geen fondsgrens bevat. De T3-hardening (2026_07_08_t3_rls_
--  with_check.sql) heeft destijds getoetst of er een WITH CHECK áánwezig
--  was, niet of het predikaat tenantcorrect is — daardoor zijn deze vijf
--  door de gate geglipt.
--
--  Bevindingen uit de integrale review van 2026-07-30:
--    K-01  decision_dissent        — cross-tenant lezen/wijzigen/verwijderen
--                                    én injecteren van dissent, incl. 'prive'
--    H-01  notificaties            — injectie in de feed van een andere tenant
--    H-02  document_inzage         — vervalsing van het inzage-auditlog
--    H-02  document_metadata_log   — vervalsing van het metadata-auditlog
--    M-01  agendapunt_inbreng      — inbreng op de agenda van een ander fonds
--    M-04  search_path-pins op de SECURITY DEFINER-functies die die missen
--
--  ONTWERPKEUZES
--  1. Alle predikaten volgen het huispatroon
--       fonds_id = (select fonds_id from public.profielen where id = auth.uid())
--     of, waar de tabel geen eigen fonds_id heeft, een subquery naar de
--     parenttabel — identiek aan de decision-chain-loop in t3.
--  2. Voor `notificaties` kan dat patroon NIET: de check moet vaststellen dat
--     de ONTVANGER in hetzelfde fonds zit, en `profielen` heeft een eigen-rij-
--     only SELECT-policy. Een subquery in een policy draait onder de RLS van
--     de aangeroepen tabel, dus die zou altijd leeg zijn. Daarom één smalle
--     SECURITY DEFINER-helper (fn_zelfde_fonds) die uitsluitend een boolean
--     teruggeeft — geen rijen, geen kolommen, geen enumeratie.
--  3. `fonds_id is null` blijft toegestaan waar dat functioneel nodig is
--     (inzage/metadata van een GENERIEK document heeft geen fonds), maar nu
--     alleen nog gekoppeld aan een document dat aantoonbaar generiek is.
--     Daarmee vervalt de route waarlangs een rij met fonds_id = null bij
--     alle fondsen zichtbaar werd.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent: opnieuw draaien is veilig. Rollback:
--  2026_07_31_r1_rls_tenantgrenzen_ROLLBACK.sql
-- ============================================================

begin;

-- ── 0. Helper: zit de opgegeven gebruiker in hetzelfde fonds als de caller? ──
-- SECURITY DEFINER omdat `profielen` eigen-rij-only leesbaar is. De functie
-- geeft uitsluitend true/false terug over een door de caller aangeleverde uuid
-- en lekt dus geen ledenlijst. STABLE + gepind search_path (M-04-patroon).
create or replace function public.fn_zelfde_fonds(p_gebruiker uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profielen actor
    join public.profielen doel on doel.fonds_id = actor.fonds_id
    where actor.id = auth.uid()
      and doel.id = p_gebruiker
      and actor.fonds_id is not null
  );
$$;

comment on function public.fn_zelfde_fonds(uuid) is
  'True als p_gebruiker in hetzelfde fonds zit als auth.uid(). SECURITY DEFINER omdat profielen eigen-rij-only leesbaar is; geeft alleen een boolean terug (geen ledenlijst). Gebruikt door de RLS-policy op notificaties.';

revoke all on function public.fn_zelfde_fonds(uuid) from public, anon;
grant execute on function public.fn_zelfde_fonds(uuid) to authenticated;

-- ── 1. K-01 — decision_dissent ──────────────────────────────
-- decision_dissent heeft geen eigen fonds_id; de grens loopt via
-- decision_objects, precies zoals bij de acht andere decision-satellieten
-- (zie de do$$-loop in 2026_07_08_t3_rls_with_check.sql regel 222-252).
-- Die loop bevatte decision_dissent niet omdat deze tabel een strengere,
-- eigen zichtbaarheidsregel heeft. Die regel blijft hier intact — er komt
-- alleen een fondsclausule vóór.

drop policy if exists "dissent zichtbaarheid select" on public.decision_dissent;
create policy "dissent zichtbaarheid select" on public.decision_dissent
  for select using (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      -- eigen dissent altijd zichtbaar
      bestuurder_id = auth.uid()
      -- niet-privé zichtbaar voor voorzitter/beheerder
      or (zichtbaarheid <> 'prive' and exists (
            select 1 from public.profielen
             where id = auth.uid() and rol in ('voorzitter','beheerder')
          ))
      -- formele dissent + minderheidsnotitie zichtbaar voor alle bestuurders
      or zichtbaarheid in ('formele_dissent','minderheidsnotitie')
    )
  );

drop policy if exists "dissent zichtbaarheid write" on public.decision_dissent;
create policy "dissent zichtbaarheid write" on public.decision_dissent
  for all
  using (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      bestuurder_id = auth.uid()
      or exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
    )
  )
  with check (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      bestuurder_id = auth.uid()
      or exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
    )
  );

-- ── 2. H-01 — notificaties ──────────────────────────────────
-- SELECT: eigen notificaties én binnen het eigen fonds. Zonder de tweede
-- voorwaarde is een rij die door een andere tenant is aangemaakt zichtbaar.
-- INSERT: server-side flows mogen voor een collega inserten, maar de
-- ontvanger moet aantoonbaar in hetzelfde fonds zitten (fn_zelfde_fonds).
-- De aanname in de oorspronkelijke migratie ("de ontvanger zit ook in het
-- eigen fonds") werd nergens afgedwongen.

drop policy if exists "eigen notificaties select" on public.notificaties;
create policy "eigen notificaties select" on public.notificaties
  for select using (
    ontvanger_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "notificaties insert eigen fonds" on public.notificaties;
create policy "notificaties insert eigen fonds" on public.notificaties
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and public.fn_zelfde_fonds(ontvanger_id)
  );

-- "eigen notificaties update" (t3) blijft ongewijzigd: ontvanger_id = auth.uid()
-- in zowel USING als WITH CHECK. Een rij van een ander fonds is door de nieuwe
-- SELECT-policy toch niet zichtbaar.

-- ── 3. H-02 — document_inzage ───────────────────────────────
-- Schrijven bond alleen de actor. fonds_id en document_id waren vrij te
-- kiezen; met fonds_id = null verscheen de rij bij ELK fonds (leestak
-- "fonds_id is null"). Nu: de rij moet bij een document horen dat de caller
-- onder RLS mag zien, en het fonds moet het eigen fonds zijn — of null, maar
-- dan uitsluitend voor een generiek document.

drop policy if exists "fonds inzage lezen" on public.document_inzage;
create policy "fonds inzage lezen" on public.document_inzage
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    or (
      fonds_id is null
      and document_id in (
        select id from public.documenten where bibliotheek = 'generiek'
      )
    )
  );

drop policy if exists "eigen inzage schrijven" on public.document_inzage;
create policy "eigen inzage schrijven" on public.document_inzage
  for insert with check (
    gebruiker_id = auth.uid()
    and document_id in (select id from public.documenten)
    and (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      or (
        fonds_id is null
        and document_id in (
          select id from public.documenten where bibliotheek = 'generiek'
        )
      )
    )
  );

-- ── 4. H-02 — document_metadata_log ─────────────────────────
-- Zelfde patroon. Extra belang: op deze tabel ligt een sha256-hashketen
-- (fn_doc_meta_log_hash). Die hasht wat er wordt aangeleverd, dus een
-- vervalste rij kreeg een geldige hash — schijnintegriteit.

drop policy if exists "lees document_metadata_log" on public.document_metadata_log;
create policy "lees document_metadata_log" on public.document_metadata_log
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    or (
      fonds_id is null
      and document_id in (
        select id from public.documenten where bibliotheek = 'generiek'
      )
    )
  );

drop policy if exists "schrijf document_metadata_log" on public.document_metadata_log;
create policy "schrijf document_metadata_log" on public.document_metadata_log
  for insert with check (
    gewijzigd_door = auth.uid()
    and document_id in (select id from public.documenten)
    and (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      or (
        fonds_id is null
        and document_id in (
          select id from public.documenten where bibliotheek = 'generiek'
        )
      )
    )
  );

-- ── 5. M-01 — agendapunt_inbreng ────────────────────────────
-- De SELECT-policy joint al correct naar vergaderingen.fonds_id; de INSERT
-- deed dat niet. Gevolg: inbreng plaatsen op een agendapunt van een ander
-- fonds (onzichtbaar voor de plaatser, zichtbaar voor het doelfonds), en de
-- unique-constraint (agendapunt_id, gebruiker_id) werkte als bestaansoracle.

drop policy if exists "eigen inbreng schrijven" on public.agendapunt_inbreng;
create policy "eigen inbreng schrijven" on public.agendapunt_inbreng
  for insert with check (
    gebruiker_id = auth.uid()
    and agendapunt_id in (
      select ap.id
        from public.agendapunten ap
        join public.vergaderingen v on v.id = ap.vergadering_id
       where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- ── 6. M-04 — search_path pinnen op SECURITY DEFINER-functies ──
-- maak_profiel() was de enige SECURITY DEFINER-functie zonder gepind
-- search_path, en draait op de auth.users-triggerpad dat fonds_id bepaalt.
-- De overige vier hadden `public` zonder `pg_temp`; Postgres doorzoekt
-- pg_temp dan impliciet als eerste voor relatienamen.
-- ALTER FUNCTION faalt als de functie niet bestaat, vandaar de guard.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'maak_profiel',
         'fn_profiel_bevries_kolommen',
         'fn_rate_limit_check',
         'aqlab_claim_run_jobs',
         'aqlab_add_run_cost'
       )
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

-- ── 7. M-02 — generieke bibliotheek achter authenticatie ────
-- De 'generiek'-tak in beide leespolicies had geen enkele binding aan een
-- sessie. Supabase geeft de rol `anon` standaard tabelrechten en die worden
-- in dit project nergens ingetrokken (alleen op rate_limit_events), dus de
-- volledige gedeelde kennisbank — metadata én chunkteksten — was in beginsel
-- leesbaar met de publieke anon-key. De INSERT-policy op dezelfde storage-
-- bucket eist `auth.uid() is not null` al wél; dit trekt de leeskant gelijk.
--
-- Effect op bestaande code: geen. De twee server-side anon-clients
-- (core/lib/tenant-domains.ts, app/api/contact/route.ts) roepen uitsluitend
-- SECURITY DEFINER-RPC's aan en raken deze tabellen niet.
--
-- ⚠️ De DERDE plek — de storage-leespolicy op bucket `documenten`, tak
-- (storage.foldername(name))[1] = 'generiek' — staat BUITEN de migraties
-- (zie 2026_06_20e_storage_generiek_readonly.sql) en moet handmatig in het
-- Supabase-dashboard dezelfde `auth.uid() is not null` krijgen.

drop policy if exists "documenten select" on public.documenten;
create policy "documenten select" on public.documenten
  for select using (
    auth.uid() is not null
    and (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      or bibliotheek = 'generiek'
    )
  );

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

-- ── 7b. O-01 — fondsenlijst achter authenticatie ────────────
-- `using (true)` maakt de volledige klantenlijst (naam + slug) leesbaar voor
-- iedereen met de publieke anon-key. Het T3-register beschrijft de bedoeling
-- als "voor elke INGELOGDE gebruiker leesbaar"; dit brengt de policy daarmee
-- in lijn. Alle lezers in de code zijn een authenticated tenantsessie of de
-- service-role (platform), dus geen functioneel effect.
drop policy if exists "fondsen lezen" on public.fondsen;
create policy "fondsen lezen" on public.fondsen
  for select using (auth.uid() is not null);

-- ── 8. Registercommentaar bijwerken ─────────────────────────
-- De T3-registercommentaren beschreven het oude gedrag ("fonds_id IS NULL OR
-- eigen fonds", "schrijven alleen eigen logregel"). Bijwerken zodat het
-- register de werkelijkheid weergeeft.
comment on table public.document_inzage is
  'HYBRIDE (T3-register). Leespolicy "fonds inzage lezen" = eigen fonds OR (fonds_id IS NULL '
  'én het document is generiek). Schrijven: eigen logregel (gebruiker_id = auth.uid()) EN '
  'gekoppeld aan een onder RLS zichtbaar document EN eigen fonds (of NULL bij een generiek '
  'document). Aangescherpt 2026-07-31 (reviewbevinding H-02).';

comment on table public.document_metadata_log is
  'HYBRIDE + APPEND-ONLY (T3-register). Leespolicy = eigen fonds OR (fonds_id IS NULL én het '
  'document is generiek). Schrijven: gewijzigd_door = auth.uid() EN gekoppeld aan een onder RLS '
  'zichtbaar document EN eigen fonds (of NULL bij een generiek document). De sha256-hashketen '
  'borgt onveranderlijkheid, niet de herkomst — daarvoor is deze WITH CHECK nodig. '
  'Aangescherpt 2026-07-31 (reviewbevinding H-02).';

comment on table public.decision_dissent is
  'TENANT via decision_objects (T3-register). Beide policies dragen sinds 2026-07-31 een '
  'fondsclausule (reviewbevinding K-01); de strengere zichtbaarheidsregel per dissenttype '
  'blijft daar bovenop gelden.';

commit;

-- ============================================================
--  Verificatie (handmatig draaien ná de migratie)
-- ============================================================
-- 1. Geen policy op een decision-satelliet zonder verwijzing naar
--    decision_objects:
--      select tablename, policyname, cmd
--        from pg_policies
--       where schemaname = 'public'
--         and tablename = 'decision_dissent'
--         and (coalesce(qual,'') not like '%decision_objects%'
--              or (cmd in ('ALL','INSERT','UPDATE')
--                  and coalesce(with_check,'') not like '%decision_objects%'));
--      -- verwacht: 0 rijen
--
-- 2. Alle vijf herstelde tabellen dragen een fondsverwijzing:
--      select tablename, policyname, cmd,
--             coalesce(qual,'') like '%fonds%'      as qual_fonds,
--             coalesce(with_check,'') like '%fonds%' as check_fonds
--        from pg_policies
--       where schemaname='public'
--         and tablename in ('decision_dissent','notificaties','document_inzage',
--                           'document_metadata_log','agendapunt_inbreng')
--       order by tablename, policyname;
--
-- 3. Alle SECURITY DEFINER-functies in public hebben een search_path:
--      select p.proname, p.proconfig
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.prosecdef
--         and (p.proconfig is null
--              or not exists (select 1 from unnest(p.proconfig) c
--                              where c like 'search_path=%'));
--      -- verwacht: 0 rijen
--
-- 4. De geautomatiseerde gedragscontroles staan in
--    supabase/checks/2026_07_31_r1_tenantgrenzen.sql en
--    supabase/checks/2026_07_31_r1_structurele_gates.sql (draaien in CI).
