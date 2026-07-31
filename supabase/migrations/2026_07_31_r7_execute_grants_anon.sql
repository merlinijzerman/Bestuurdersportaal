-- ============================================================================
--  Migratie 2026-07-31 — R7: EXECUTE-rechten van `anon` op functies in `public`
--
--  BEVINDING H-18 (gevonden 31-07-2026, na R6, uit
--  has_function_privilege('anon', …) over pg_proc)
--
--  ────────────────────────────────────────────────────────────────────────────
--  WAT IS ER AAN DE HAND — EN WAAROM DE BESTAANDE MAATREGEL NIET WERKTE
--  ────────────────────────────────────────────────────────────────────────────
--  Twee migraties documenteren expliciet dat anon deze functies NIET mag
--  aanroepen:
--
--    2026_07_10_aqlab_4_run_jobs.sql r.128:
--      "-- Geen EXECUTE voor anon/authenticated: uitsluitend de service-role
--        draait de worker."
--      revoke all on function public.aqlab_claim_run_jobs(...) from public;
--
--    2026_07_12_d1b_assurance_rpcs.sql r.201:
--      "-- Grants: alleen authenticated (ingelogde bestuurders); nooit anon"
--      revoke all on function public.aqlab_assurance_meetwaarden(...) from public;
--
--  Beide revokes hebben NOOIT effect gehad. Supabase' default-ACL op schema
--  `public` kent EXECUTE toe EXPLICIET AAN DE ROL `anon`, niet via PUBLIC:
--
--      pg_default_acl → objtype 'f' → {postgres=X, anon=X, authenticated=X,
--                                      service_role=X}      ← geen PUBLIC-entry
--
--  `revoke ... from public` haalt dus een recht weg dat er niet was, terwijl de
--  expliciete anon-grant blijft staan. Rechten in Postgres zijn optellend; een
--  revoke op de verkeerde grantee is een no-op. De code documenteerde een
--  beheersmaatregel die niet bestond — precies het geval waarvoor het
--  reviewuitgangspunt "aanwezig bewijs is nog geen werkende maatregel" bedoeld
--  is. Ook de "T14b-les" in 2026_07_17_t15/t16 ("PUBLIC erft standaard EXECUTE")
--  berust op een verkeerde diagnose van hetzelfde symptoom; die migraties doen
--  toevallig wél `from public, anon` en zijn daardoor per ongeluk correct.
--
--  R6 heeft de default-ACL voor de postgres-kant dichtgezet, maar dat werkt
--  alleen voor TOEKOMSTIGE functies. Alles wat er al stond houdt zijn grant.
--
--  ────────────────────────────────────────────────────────────────────────────
--  IMPACT (ongeauthenticeerd, RLS-omzeilend — alle vijf zijn SECURITY DEFINER)
--  ────────────────────────────────────────────────────────────────────────────
--    aqlab_claim_run_jobs      jobs claimen + op 'bezig' zetten met eigen lease
--                              → evaluatiepijplijn stilleggen; retourneert de
--                                volledige jobrijen (setof aqlab_run_jobs).
--    aqlab_add_run_cost        totale_kosten ophogen op willekeurige run
--                              → kostenplafond onbetrouwbaar.
--    aqlab_log_download        insert in het APPEND-ONLY aqlab_log met
--                              gebruiker_id = null → auditvervuiling die per
--                              definitie niet meer te verwijderen is.
--    aqlab_assurance_meetwaarden  interne releasestatus, kritieke bevindingen,
--                              brongebondenheid- en format-ratio's uitlezen.
--    aqlab_audit_export_bron   bestaan/vrijgavestatus van een export bevestigen
--                              (vereist wel een geldige, onraadbare UUID).
--
--  ERNST: HOOG. Ongeauthenticeerd, RLS-omzeilend, lezend én schrijvend, en het
--  raakt een append-only auditspoor. NIET Kritiek: AQLab is provider-globaal
--  (geen fonds_id op aqlab_-tabellen, bevestigd door de eigen testset), dus er
--  wordt geen fondsdata of besluitinhoud blootgesteld en geen tenantgrens
--  overschreden.
--
--  De twee triggerfuncties (maak_profiel, fn_profiel_bevries_kolommen) zijn niet
--  los aanroepbaar — Postgres weigert een directe aanroep van een functie die
--  `trigger` retourneert — en dus niet exploiteerbaar. Ze worden wel meegenomen:
--  een grant die geen doel dient, hoort weg.
--
--  ────────────────────────────────────────────────────────────────────────────
--  AANPAK
--  ────────────────────────────────────────────────────────────────────────────
--  Per functie: `revoke all from public, anon`, daarna gericht teruggeven.
--  Beide grantees, omdat functies van vóór de default-ACL wél een PUBLIC-grant
--  kunnen hebben. Teruggeven gebeurt naar de rol die de aanroeper daadwerkelijk
--  gebruikt, geverifieerd in de codebase op 31-07-2026:
--
--    aqlab_claim_run_jobs   platform/lib/aqlab/run-orchestrator.ts r.439  → svc
--    aqlab_add_run_cost     platform/lib/aqlab/run-orchestrator.ts r.498  → svc
--        → uitsluitend service_role. Dit is een VERSMALLING: `authenticated`
--          had het recht vandaag ook (via dezelfde default-ACL) en verliest het.
--          Dat is exact wat de migratie in r.128 al beweerde af te dwingen.
--
--    aqlab_log_download            app/api/aqlab/assurance/audit/[exportId]/route.ts r.53
--    aqlab_assurance_meetwaarden   core/lib/aqlab/assurance.ts r.120
--    aqlab_audit_export_bron       core/lib/aqlab/assurance.ts r.142
--        → gebruikerscliënt, dus authenticated + service_role.
--
--    maak_profiel, fn_profiel_bevries_kolommen
--        → triggerfuncties; geen enkele grant nodig. Postgres toetst EXECUTE op
--          een triggerfunctie bij CREATE TRIGGER, niet bij elke firing, dus het
--          intrekken raakt de aanmaak van profielen bij signup niet.
--
--  ALLOWLIST (anon MOET deze houden — de publieke website draait erop):
--    resolve_tenant_host(text)              core/lib/tenant-domains.ts r.34
--    contact_aanvraag_insert(...)           app/api/contact/route.ts r.204
--    contact_notificatie_status(uuid,bool,text)  idem r.259/r.268
--  Alle drie expliciet aan anon gegeven in 2026_07_12_d1_service_role_rpcs.sql
--  r.138-140. Die grant is bewust en blijft staan.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent. Rollback: 2026_07_31_r7_execute_grants_anon_ROLLBACK.sql
-- ============================================================================

begin;

-- ── DEEL A — de zeven met naam en toenaam ──────────────────────────────────

-- A1. Uitsluitend service-role (worker). Versmalling t.o.v. vandaag.
revoke all on function public.aqlab_claim_run_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.aqlab_claim_run_jobs(text, integer, integer) to service_role;

revoke all on function public.aqlab_add_run_cost(uuid, numeric) from public, anon, authenticated;
grant execute on function public.aqlab_add_run_cost(uuid, numeric) to service_role;

-- A2. Ingelogde gebruikers + service-role.
revoke all on function public.aqlab_log_download(uuid) from public, anon;
grant execute on function public.aqlab_log_download(uuid) to authenticated, service_role;

revoke all on function public.aqlab_assurance_meetwaarden(text[]) from public, anon;
grant execute on function public.aqlab_assurance_meetwaarden(text[]) to authenticated, service_role;

revoke all on function public.aqlab_audit_export_bron(uuid) from public, anon;
grant execute on function public.aqlab_audit_export_bron(uuid) to authenticated, service_role;

-- A3. Triggerfuncties — geen enkele aanroeper, dus geen grant terug.
revoke all on function public.maak_profiel() from public, anon, authenticated;
revoke all on function public.fn_profiel_bevries_kolommen() from public, anon, authenticated;

-- ── DEEL B — sweep over al het overige ─────────────────────────────────────
--  Alles wat anon verder nog mag uitvoeren en niet op de allowlist staat, en
--  geen onderdeel is van een extensie (pgvector, pg_trgm — zuiver rekenkundig
--  en zonder toegang tot data). Deze functies zijn overwegend SECURITY INVOKER,
--  dus RLS geldt er nog; het risico is kleiner dan bij deel A, maar een
--  publieke rol hoort geen applicatiefuncties te kunnen aanroepen.
--
--  `authenticated` en `service_role` krijgen het recht terug, zodat dit géén
--  gedragswijziging is voor de applicatie: beide hebben het vandaag al via
--  dezelfde default-ACL.
do $$
declare
  r record;
  allowlist text[] := array[
    'resolve_tenant_host',
    'contact_aanvraag_insert',
    'contact_notificatie_status'
  ];
  n int := 0;
  overgeslagen text := '';
begin
  for r in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prokind,
           p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and not (p.proname = any(allowlist))
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
     order by p.proname
  loop
    if r.prokind <> 'f' then
      -- Aggregaten/procedures/window-functies vergen een andere REVOKE-vorm.
      -- Niet stilzwijgend overslaan: benoemen, zodat het een keuze blijft.
      overgeslagen := overgeslagen || format('  - %s(%s) [prokind=%s]%s',
                                             r.proname, r.args, r.prokind, chr(10));
      continue;
    end if;

    execute format('revoke all on function public.%I(%s) from public, anon',
                   r.proname, r.args);

    if not r.is_trigger then
      execute format('grant execute on function public.%I(%s) to authenticated, service_role',
                     r.proname, r.args);
    end if;

    n := n + 1;
  end loop;

  raise notice 'R7 deel B: EXECUTE ingetrokken bij anon op % functie(s).', n;
  if overgeslagen <> '' then
    raise warning E'R7 deel B: overgeslagen (geen gewone functie, handmatig beoordelen):\n%', overgeslagen;
  end if;
end $$;

-- ── DEEL C — fail-closed verificatie ───────────────────────────────────────
do $$
declare
  rest text := '';
  r record;
  allowlist text[] := array[
    'resolve_tenant_host',
    'contact_aanvraag_insert',
    'contact_notificatie_status'
  ];
  n_allow int;
begin
  -- C1. Anon mag niets meer buiten de allowlist (extensies uitgezonderd).
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and not (p.proname = any(allowlist))
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
     order by p.proname
  loop
    rest := rest || format('  - %s(%s)%s%s', r.proname, r.args,
                           case when r.prosecdef then '  [SECURITY DEFINER]' else '' end, chr(10));
  end loop;

  if rest <> '' then
    raise exception E'R7 FAALT: anon houdt EXECUTE op functies buiten de allowlist:\n%', rest;
  end if;

  -- C2. De drie publieke RPC's MOETEN blijven werken — anders is de
  --     marketingsite en het contactformulier stuk.
  select count(*) into n_allow
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = any(allowlist)
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n_allow <> 3 then
    raise exception 'R7 FAALT: % van de 3 publieke RPC''s is voor anon uitvoerbaar (verwacht 3) — resolve_tenant_host / contact_aanvraag_insert / contact_notificatie_status.', n_allow;
  end if;

  raise notice 'R7 OK: anon mag nog exact de drie publieke RPC''s en verder niets in public.';
end $$;

commit;

-- ============================================================================
--  Verificatie ná de migratie
-- ============================================================================
-- 1. Wat mag anon nog? Verwacht: alleen extensiefuncties + de drie RPC's.
--      select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--             p.prosecdef,
--             exists (select 1 from pg_depend d
--                      where d.objid = p.oid and d.deptype = 'e') as uit_extensie
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and has_function_privilege('anon', p.oid, 'EXECUTE')
--       order by uit_extensie, 1;
--
-- 2. Rookproef — dit raakt publieke functionaliteit:
--      - publieke site op een tenantdomein laden  → resolve_tenant_host
--      - contactformulier verzenden               → contact_aanvraag_insert
--      - ingelogd: /governance/assurance openen   → aqlab_assurance_meetwaarden
--      - ingelogd: vrijgegeven auditrapport downloaden
--                                                 → aqlab_audit_export_bron
--                                                 + aqlab_log_download
--      - een AQLab-run starten en laten verwerken → claim_run_jobs / add_run_cost
--        (service-role; hier zit de versmalling, dus dit pad expliciet testen)
--      - een nieuw account aanmaken               → maak_profiel-trigger
--
-- ============================================================================
--  Vervolgactie (bewust NIET hier)
-- ============================================================================
-- `authenticated` houdt in deel B EXECUTE op alles wat het vandaag al had. Dat
-- is bewust: deze migratie mag geen gedragswijziging zijn voor ingelogde
-- gebruikers. Maar een deel van die functies (met name de SECURITY DEFINER-
-- varianten en de triggerfuncties) hoort daar evenmin. Dat vergt een analyse
-- per functie van wie hem daadwerkelijk aanroept, en hoort in een eigen ronde
-- met eigen rookproef — niet verstopt achter een anon-fix.
