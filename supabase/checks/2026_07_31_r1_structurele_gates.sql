-- ============================================================================
-- R1 — STRUCTURELE GATES op tenantcorrectheid van RLS-policies
-- ----------------------------------------------------------------------------
-- Aanleiding (integrale review 2026-07-30): de T3-gate
-- (2026_07_08_t3_cross_tenant.sql DEEL 1a) toetst of een schrijf-policy een
-- WITH CHECK HEEFT — niet of het PREDIKAAT een tenantgrens bevat. Daardoor
-- passeerden vijf policies de gate terwijl ze cross-tenant toegang toestonden
-- (K-01 decision_dissent, H-01 notificaties, H-02 document_inzage +
-- document_metadata_log, M-01 agendapunt_inbreng).
--
-- Deze suite sluit dat gat met vier structurele gates. Ze hebben GEEN seed-data
-- nodig (op gate D na) en dekken daarmee ook toekomstige tabellen.
--
--   GATE A — parent-afgeleide tenanttabellen: een tabel zonder eigen fonds_id
--            die tenantdata bevat, staat in het register (A1) en al haar
--            lees-/invoegpolicies noemen de parenttabel (A2). Dit is de gate die
--            K-01 en M-01 permanent onmogelijk maakt. Mutatiepolicies op
--            bestaande rijen mogen eigenaarsgebonden zijn — zie A2.
--   GATE B — tabellen mét eigen fonds_id: een policy moet ófwel fonds_id
--            noemen, ófwel aan auth.uid() binden. Vangt `using (true)` en
--            OR-takken zonder enige binding.
--   GATE C — leeskant: geen SELECT-policy op een tenanttabel met qual = 'true'.
--   GATE C2 — schrijfkant: geen INSERT/UPDATE/ALL-policy met with_check = 'true'
--            (toegevoegd na K-02: een open schrijfpad naar de RAG-corpus).
--   GATE D — anon: de rol `anon` ziet geen enkele rij in de tenanttabellen
--            (inclusief de generieke bibliotheek). Gedragstest met seed.
--   GATE E — elke SECURITY DEFINER-functie in `public` heeft een gepind
--            search_path.
--   GATE F — granthygiëne: de rol `anon` heeft nergens schrijfrechten, en geen
--            van beide PostgREST-rollen heeft TRUNCATE/REFERENCES/TRIGGER
--            (toegevoegd na O-03; TRUNCATE wordt door RLS NIET afgedekt).
--   GATE G — geen FOR ALL-policy zonder WITH CHECK: Postgres valt dan voor de
--            schrijfkant terug op USING, waardoor alleen wordt getoetst wélke
--            rij je wijzigt en niet wat erin komt te staan (toegevoegd na K-03,
--            de zelf-muteerbare profielen.rol/fonds_id).
--   GATE H — de rol `anon` kan geen enkele applicatiefunctie in `public`
--            uitvoeren, op drie publieke RPC's na (toegevoegd na H-18;
--            tevens de detectie voor het supabase_admin-pad uit O-03b).
--
-- ONDERHOUD: gate A werkt met een expliciet REGISTER. Een nieuwe tabel die
-- tenantdata bevat maar geen eigen fonds_id heeft, hoort in dat register — zo
-- niet, dan faalt gate A1 met de melding welke tabel ontbreekt. Dat is de
-- bedoelde forcing function: registreren of expliciet als globaal markeren.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
--             (draait in scripts/cross-tenant-ci.sh)
--          OF: hele bestand plakken in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- Geen `\set ON_ERROR_STOP on` hier: dat is een psql-CLIENTcommando en de
-- Supabase SQL-editor kent het niet ("syntax error at or near \"\\\"").
-- scripts/cross-tenant-ci.sh geeft `-v ON_ERROR_STOP=1` al op de commandoregel
-- mee, dus deze regel was dubbelop. Zonder hem draait dit bestand zowel in
-- psql/CI als rechtstreeks in de SQL-editor.

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE A — parent-afgeleide tenanttabellen                                ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
declare
  r record;
  reg record;
  offenders text := '';
  ontbreekt text := '';
  -- REGISTER: tabel → parenttabel die in het policy-predikaat moet voorkomen.
  -- Uitsluitend tabellen die tenantdata bevatten en GEEN eigen fonds_id hebben.
  register text[][] := array[
    ['decision_assumptions',      'decision_objects'],
    ['decision_risks',            'decision_objects'],
    ['decision_conditions',       'decision_objects'],
    ['decision_actions',          'decision_objects'],
    ['decision_evaluations',      'decision_objects'],
    ['decision_ai_interactions',  'decision_objects'],
    ['decision_dissent',          'decision_objects'],
    ['decision_audit_snapshots',  'decision_objects'],
    ['governance_events',         'decision_objects'],
    ['agendapunten',              'vergaderingen'],
    ['agendapunt_inbreng',        'agendapunten'],
    ['agendapunt_log',            'vergaderingen'],
    ['vergadering_log',           'vergaderingen'],
    ['procedure_stappen',         'procedures'],
    ['procedure_eigenaars',       'procedures'],
    ['procedure_checklist',       'procedures'],
    ['procedure_bewijs',          'procedures'],
    ['procedure_besluiten',       'procedures'],
    ['procedure_log',             'procedures'],
    ['risico_maatregelen',        'risicos'],
    ['risico_log',                'risicos'],
    ['stem_uitbrengingen',        'stemmingen'],
    ['document_chunks',           'documenten'],
    -- Plateau A (2026-08-04): de chatinhoud bij een auditregel. Geen eigen
    -- fonds_id — de tenantgrens én de auteursgrens komen uit governance_log,
    -- dat de policy dan ook letterlijk moet noemen.
    ['governance_log_inhoud',     'governance_log']
  ];
  -- Tabellen zonder fonds_id die BEWUST geen tenantgrens dragen. Elke regel is
  -- een expliciet besluit; zie 2026_07_08_t3_globale_tabellen_register.sql.
  globaal text[] := array[
    'fondsen',                        -- lijst van fondsen, geen tenantinhoud
    'procedure_requirements',         -- globale templateconfiguratie
    'procedure_template_fasen',       -- globale fase-defaults per template_code
                                      -- (D8): gedeelde toelichtende content, geen
                                      -- fonds_id, geen PII. `for select using
                                      -- (auth.uid() is not null)`, beheerder schrijft.
                                      -- De fonds-override leeft in de aparte,
                                      -- fonds-gescopete tabel
                                      -- procedure_fase_beschrijving_override.
    'bron_whitelist',                 -- platformbrede bronnenlijst
    'bron_whitelist_log',             -- deny-by-default
    'contact_aanvragen',              -- deny-by-default (publiek schrijfpad via RPC)
    'document_processing_jobs',       -- deny-by-default
    'rate_limit_events',              -- deny-by-default + revoke
    'tenant_domains',                 -- deny-by-default (host→fonds via RPC)
    'platform_identities',            -- platformregister (auth.uid() = id)
    'platform_capabilities',          -- deny-by-default
    'platform_identity_capabilities', -- deny-by-default
    'platform_event_log',             -- deny-by-default
    'platform_event_chain_state',     -- één platformbrede ketenkop; RLS aan,
                                      -- geen browser-/service-rolegrants
    'platform_event_fork_declarations', -- append-only platformregister voor
                                      -- exact verklaarde historische forks;
                                      -- RLS aan, geen applicatiegrants
    'platform_signaal_config',        -- deny-by-default; drempels/intervallen zijn
                                      -- platformbreed, niet per fonds (P5, besluit 0105)
    'voorbereidingen',                -- persoonlijk (gebruiker_id = auth.uid())
    'profielen',                      -- eigen rij; fonds_id bestaat wél maar de
                                      -- policy is strikter (zie gate B)
    'gremia',                         -- hybride template/fonds (fonds_id nullable)
    'expertises',
    'kritische_focusgebieden',
    'wettelijk_regime_per_fondstype', -- codelijst fondstype→wettelijk regime (T4,
                                      -- besluit 0162): juridische kwalificatie in
                                      -- DATA, geen tenantinhoud, geen PII;
                                      -- `for select using(true)`, service-role
                                      -- schrijft. Global-by-design (T3-register-
                                      -- patroon); ontbrak in deze lijst omdat de
                                      -- T4-migratie is opgeleverd zonder gate-run.
    'concepts'                        -- canonieke conceptcatalogus (T7): sectorbrede,
                                      -- platform-globale codelijst, geen fonds_id,
                                      -- geen PII, geen tenantinhoud. `for select
                                      -- using(true)` naar authenticated, service-role
                                      -- schrijft (catalogus-eigenaar). Global-by-design.
  ];
begin
  -- A1. Elke tabel met RLS die géén eigen fonds_id heeft moet in het register
  --     of in de globale lijst staan. Onbekende tabellen = onbewuste keuze.
  for r in
    select c.relname as tabel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
       and not exists (
             select 1 from information_schema.columns col
              where col.table_schema='public' and col.table_name=c.relname
                and col.column_name='fonds_id')
       and c.relname not like 'aqlab\_%'   -- productbreed, deny-by-default (AQL-1)
     order by c.relname
  loop
    if not (r.tabel = any(globaal))
       and not (r.tabel = any(array(select register[i][1]
                                      from generate_subscripts(register,1) i)))
    then
      ontbreekt := ontbreekt || format('  - %s%s', r.tabel, chr(10));
    end if;
  end loop;

  if ontbreekt <> '' then
    raise exception E'GATE A1 FAALT: tabellen met RLS zonder eigen fonds_id die niet in het R1-register of de globale lijst staan.\nRegistreer ze met hun parenttabel, of voeg ze expliciet toe aan de globale lijst met motivatie:\n%', ontbreekt;
  end if;
  raise notice 'GATE A1 OK: alle parent-afgeleide tabellen zijn geregistreerd.';

  -- A2. Policies op een geregistreerde tabel moeten de parenttabel noemen —
  --     ASYMMETRISCH, omdat de risico's dat ook zijn:
  --
  --       SELECT / ALL  → USING MOET de parent noemen. Zonder die clausule leest
  --                       een gebruiker rijen van een ander fonds. Dit is K-01.
  --       INSERT / ALL  → WITH CHECK MOET de parent noemen. Zonder die clausule
  --                       injecteert een gebruiker rijen ONDER een parent van een
  --                       ander fonds. Dit is M-01.
  --       UPDATE/DELETE → parent OF een binding aan auth.uid() volstaat. Een
  --                       eigenaarsgebonden mutatie (bv. "eigen inbreng wijzigen",
  --                       "fonds stem update") kan per definitie alleen een rij
  --                       raken die de gebruiker zelf bezit, en aanmaken is door
  --                       de INSERT-eis hierboven al fondsgebonden. Een policy
  --                       met NOCH parent NOCH auth.uid() is wél fout.
  --
  --     Deze verfijning is aangebracht na de eerste productiedraai (31-07-2026):
  --     de oorspronkelijke, symmetrische eis markeerde drie inhoudelijk correcte
  --     eigenaarspolicies als overtreding.
  for reg in
    select register[i][1] as tabel, register[i][2] as parent
      from generate_subscripts(register,1) i
  loop
    for r in
      select p.tablename, p.policyname, p.cmd, p.qual, p.with_check
        from pg_policies p
       where p.schemaname='public' and p.tablename = reg.tabel
    loop
      -- Leeskant: SELECT en ALL moeten hard parent-gebonden zijn.
      if r.cmd in ('SELECT','ALL')
         and r.qual is not null
         and position(reg.parent in r.qual) = 0 then
        offenders := offenders || format('  - %s.%s (%s): USING noemt %s niet — cross-tenant LEZEN mogelijk%s',
                                         r.tablename, r.policyname, r.cmd, reg.parent, chr(10));
      end if;

      -- Schrijfkant: INSERT en ALL moeten hard parent-gebonden zijn.
      if r.cmd in ('SELECT','ALL','INSERT')
         and r.with_check is not null
         and position(reg.parent in r.with_check) = 0 then
        offenders := offenders || format('  - %s.%s (%s): WITH CHECK noemt %s niet — cross-tenant INJECTIE mogelijk%s',
                                         r.tablename, r.policyname, r.cmd, reg.parent, chr(10));
      end if;

      -- Mutatie op bestaande rijen: parent OF eigenaarsbinding.
      if r.cmd in ('UPDATE','DELETE') then
        if r.qual is not null
           and position(reg.parent in r.qual) = 0
           and position('auth.uid()' in r.qual) = 0 then
          offenders := offenders || format('  - %s.%s (%s): USING noemt %s niet en bindt niet aan auth.uid()%s',
                                           r.tablename, r.policyname, r.cmd, reg.parent, chr(10));
        end if;
        if r.with_check is not null
           and position(reg.parent in r.with_check) = 0
           and position('auth.uid()' in r.with_check) = 0 then
          offenders := offenders || format('  - %s.%s (%s): WITH CHECK noemt %s niet en bindt niet aan auth.uid()%s',
                                           r.tablename, r.policyname, r.cmd, reg.parent, chr(10));
        end if;
      end if;
    end loop;
  end loop;

  if offenders <> '' then
    raise exception E'GATE A2 FAALT: policies op parent-afgeleide tenanttabellen zonder tenantgrens:\n%', offenders;
  end if;
  raise notice 'GATE A2 OK: alle parent-afgeleide policies dragen een tenantgrens.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE B — tabellen mét eigen fonds_id                                    ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Een policy moet ófwel fonds_id noemen, ófwel binden aan auth.uid(). Een
-- predikaat dat geen van beide doet (bv. `using (true)`) is per definitie
-- tenant-blind.
do $$
declare
  r record;
  offenders text := '';
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.qual, p.with_check
      from pg_policies p
     where p.schemaname='public'
       and exists (select 1 from information_schema.columns col
                    where col.table_schema='public' and col.table_name=p.tablename
                      and col.column_name='fonds_id')
       and p.tablename <> 'fondsen'
     order by p.tablename, p.policyname
  loop
    if r.qual is not null
       and position('fonds_id' in r.qual) = 0
       and position('auth.uid()' in r.qual) = 0 then
      offenders := offenders || format('  - %s.%s (%s): USING zonder fonds_id én zonder auth.uid()%s',
                                       r.tablename, r.policyname, r.cmd, chr(10));
    end if;
    if r.with_check is not null
       and position('fonds_id' in r.with_check) = 0
       and position('auth.uid()' in r.with_check) = 0 then
      offenders := offenders || format('  - %s.%s (%s): WITH CHECK zonder fonds_id én zonder auth.uid()%s',
                                       r.tablename, r.policyname, r.cmd, chr(10));
    end if;
  end loop;

  if offenders <> '' then
    raise exception E'GATE B FAALT: tenant-blinde policies op tabellen met fonds_id:\n%', offenders;
  end if;
  raise notice 'GATE B OK: geen tenant-blinde policies op fonds_id-tabellen.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE C — leeskant: geen open SELECT op tenanttabellen                   ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
declare
  r record;
  offenders text := '';
  -- Bewust open leesbaar (gedocumenteerd besluit).
  --  • fondsen                        — lijst van fondsen, geen tenantinhoud
  --  • wettelijk_regime_per_fondstype — codelijst fondstype→regime (T4, besluit
  --    0162): juridische kwalificatie in DATA, geen PII, geen tenantinhoud;
  --    `for select using(true)` naar authenticated, service-role schrijft.
  --    Global-by-design (T3-register-patroon); ontbrak hier omdat de T4-migratie
  --    is opgeleverd zonder gate-run (zelfde OP-C5-patroon als bij gate A1).
  --  • concepts                       — canonieke conceptcatalogus (T7): sectorbrede
  --    codelijst, geen fonds_id/PII/tenantinhoud; `for select using(true)` naar
  --    authenticated, service-role schrijft (catalogus-eigenaar). Global-by-design.
  select_allow text[] := array['fondsen', 'wettelijk_regime_per_fondstype', 'concepts'];
begin
  for r in
    select p.tablename, p.policyname, p.qual
      from pg_policies p
     where p.schemaname='public'
       and p.cmd in ('SELECT','ALL')
       and btrim(coalesce(p.qual,'')) = 'true'
       and not (p.tablename = any(select_allow))
     order by p.tablename
  loop
    offenders := offenders || format('  - %s.%s: USING (true)%s', r.tablename, r.policyname, chr(10));
  end loop;

  if offenders <> '' then
    raise exception E'GATE C FAALT: onbeperkte leespolicies op tenanttabellen:\n%', offenders;
  end if;
  raise notice 'GATE C OK: geen USING (true) op tenanttabellen.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE C2 — schrijfkant: geen onbeperkte WITH CHECK op tenanttabellen     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Toegevoegd 31-07-2026 na bevinding K-02. In productie stond op
-- document_chunks een policy "chunks schrijven" (INSERT, TO public,
-- WITH CHECK = true) die in geen enkele migratie voorkwam. Omdat permissive
-- policies ge-OR'd worden, maakte die de parent-gebonden schrijfpolicy volledig
-- irrelevant: met de publieke anon-key kon iedereen chunks invoegen onder een
-- document van een willekeurig fonds — en die tekst wordt door de retrieval van
-- dát fonds als [Bron N] geciteerd.
--
-- Gate A2 ving dit geval al af via het register, maar een expliciete gate op
-- `with_check = true` is scherper: hij benoemt precies wát er mis is, en dekt
-- óók tabellen die bewust als globaal zijn gemarkeerd.
do $$
declare
  r record;
  offenders text := '';
  -- Tabellen waar een onbeperkte WITH CHECK een bewuste keuze is. Leeg houden
  -- tenzij er een gedocumenteerd besluit onder ligt: een schrijfpolicy zonder
  -- enige voorwaarde is per definitie een open schrijfpad.
  check_allow text[] := array[]::text[];
begin
  for r in
    select p.tablename, p.policyname, p.cmd
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('ALL','INSERT','UPDATE')
       and btrim(coalesce(p.with_check,'')) = 'true'
       and not (p.tablename = any(check_allow))
     order by p.tablename, p.policyname
  loop
    offenders := offenders || format('  - %s.%s (%s): WITH CHECK (true)%s',
                                     r.tablename, r.policyname, r.cmd, chr(10));
  end loop;

  if offenders <> '' then
    raise exception E'GATE C2 FAALT: onbeperkte schrijfpolicies — elke rol met een tabelgrant kan hier willekeurige rijen invoegen:\n%', offenders;
  end if;
  raise notice 'GATE C2 OK: geen WITH CHECK (true) op tenanttabellen.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE E — search_path gepind op elke SECURITY DEFINER-functie            ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
declare
  r record;
  offenders text := '';
begin
  for r in
    select p.proname, p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'
       and p.prosecdef
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
     order by p.proname
  loop
    offenders := offenders || format('  - %s%s', r.sig, chr(10));
  end loop;

  if offenders <> '' then
    raise exception E'GATE E FAALT: SECURITY DEFINER-functies zonder gepind search_path (search-path-hijack mogelijk):\n%', offenders;
  end if;
  raise notice 'GATE E OK: alle SECURITY DEFINER-functies hebben een gepind search_path.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE F — granthygiëne op de PostgREST-rollen                            ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Achtergrond (bevinding O-03, opgewaardeerd 31-07-2026). Supabase geeft
-- standaard `grant all on all tables in schema public to anon, authenticated`.
-- Daardoor is RLS de enige barrière en wordt één te ruime policy meteen een
-- volwaardig schrijfpad — precies het mechanisme onder K-02.
--
-- Twee rechten dekt RLS helemaal niet af:
--   TRUNCATE  — geen enkele policy wordt geëvalueerd; de hele tabel gaat leeg.
--               Dat maakt "auditdata is niet manipuleerbaar" onhoudbaar.
--   TRIGGER / REFERENCES — het recht eigen triggers of foreign keys op een
--               tabel van een ander te hangen. Nooit nodig voor de app.
--
-- Deze gate faalt zolang R4 (2026_07_31_r4_grant_hygiene.sql) niet is gedraaid.
do $$
declare
  offenders text := '';
  r record;
begin
  for r in
    select grantee, privilege_type, count(*) as n
      from information_schema.role_table_grants
     where table_schema = 'public'
       and (
             (grantee = 'anon' and privilege_type in
                ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
          or (grantee = 'authenticated' and privilege_type in
                ('TRUNCATE','REFERENCES','TRIGGER'))
           )
     group by grantee, privilege_type
     order by grantee, privilege_type
  loop
    offenders := offenders || format('  - %s heeft %s op %s tabel(len)%s',
                                     r.grantee, r.privilege_type, r.n, chr(10));
  end loop;

  if offenders <> '' then
    raise exception E'GATE F FAALT: te ruime tabelgrants op de PostgREST-rollen — RLS is dan de enige barrière, en op TRUNCATE werkt RLS niet:\n%', offenders;
  end if;
  raise notice 'GATE F OK: anon schrijft nergens; geen TRUNCATE/REFERENCES/TRIGGER op anon of authenticated.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE G — geen FOR ALL-policy zonder WITH CHECK                          ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Achtergrond (bevinding K-03). Bij `for all ... using (X)` zonder with_check
-- gebruikt Postgres X ook voor de schrijfkant. Bij een UPDATE wordt daardoor
-- alleen getoetst wélke rij je wijzigt, niet wat erin komt te staan. Op
-- profielen betekende dat: rol en fonds_id zelf-muteerbaar, dus rechtenescalatie
-- én doorbraak van de tenantisolatie.
--
-- pg_policies rapporteert with_check als NULL wanneer de clausule ontbreekt.
-- Dat is exact het te detecteren geval; with_check = 'true' wordt al door gate
-- C2 gevangen.
--
-- LET OP bij de eerste run: migratie 2026_07_08_t3_rls_with_check.sql heeft
-- historisch veertien van deze policies gerepareerd. Vuurt deze gate toch, dan
-- is dat een signaal dat die migratie (net als de profielen-hardening) niet of
-- niet volledig op de database is gedraaid — triageer per policy, ga niet uit
-- van een vals alarm.
do $$
declare
  offenders text := '';
  r record;
begin
  for r in
    select tablename, policyname, coalesce(qual, '') as q
      from pg_policies
     where schemaname = 'public'
       and cmd = 'ALL'
       and with_check is null
     order by tablename, policyname
  loop
    offenders := offenders || format('  - %s.%s (FOR ALL, using: %s)%s',
                                     r.tablename, r.policyname, left(r.q, 90), chr(10));
  end loop;

  if offenders <> '' then
    raise exception E'GATE G FAALT: FOR ALL-policies zonder WITH CHECK — de schrijfkant valt terug op USING, dus de nieuwe rijinhoud wordt niet getoetst:\n%', offenders;
  end if;
  raise notice 'GATE G OK: elke FOR ALL-policy heeft een expliciete WITH CHECK.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE H — anon mag geen applicatiefuncties uitvoeren                     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Achtergrond (bevinding H-18). Supabase' default-ACL op schema `public` kent
-- EXECUTE toe EXPLICIET aan de rol `anon` — niet via PUBLIC. Daardoor was
-- `revoke all on function … from public`, het idioom dat deze repo op meerdere
-- plekken gebruikt, een no-op: er wás geen PUBLIC-grant, en de anon-grant bleef
-- staan. Vijf SECURITY DEFINER-RPC's waren zo ongeauthenticeerd aanroepbaar,
-- waaronder een insert in een append-only auditspoor.
--
-- Deze gate is óók de vangnetcontrole voor het pad dat R6 niet kon dichtzetten:
-- de default-ACL van `supabase_admin` geeft nieuwe functies nog steeds anon=X,
-- en `postgres` mag die entry niet wijzigen. Preventie ontbreekt daar; dit is de
-- detectie.
--
-- ONDERHOUD: de allowlist bevat wat de PUBLIEKE (uitgelogde) kant nodig heeft.
-- Groeit die lijst, dan is dat een bewust besluit dat hier zichtbaar hoort te
-- worden — een SECURITY DEFINER-functie die anon mag aanroepen, omzeilt RLS
-- volledig. Extensiefuncties (pgvector, pg_trgm) zijn uitgezonderd: zuiver
-- rekenkundig, zonder toegang tot data.
do $$
declare
  offenders text := '';
  r record;
  allowlist text[] := array[
    'resolve_tenant_host',        -- core/lib/tenant-domains.ts  (host -> fonds)
    'contact_aanvraag_insert',    -- app/api/contact/route.ts    (publiek formulier)
    'contact_notificatie_status'  -- app/api/contact/route.ts    (mailstatus)
  ];
begin
  for r in
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and not (p.proname = any(allowlist))
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
     order by p.prosecdef desc, p.proname
  loop
    offenders := offenders || format('  - %s(%s)%s%s',
                   r.proname, left(r.args, 60),
                   case when r.prosecdef then '   [SECURITY DEFINER - omzeilt RLS]' else '' end,
                   chr(10));
  end loop;

  if offenders <> '' then
    raise exception E'GATE H FAALT: de publieke anon-rol kan functies in public uitvoeren die niet op de allowlist staan:\n%', offenders;
  end if;
  raise notice 'GATE H OK: anon mag alleen de drie publieke RPC-functies uitvoeren.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE D — de rol `anon` ziet geen tenantdata (gedragstest, met seed)     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Zonder seed zou deze test vacuüm slagen: een lege tabel levert altijd 0.
-- Daarom eerst als eigenaar één fondsdocument én één generiek document
-- seeden, en pas daarna als `anon` tellen. Alles in één transactie met
-- rollback.
begin;

-- `slug` is NOT NULL UNIQUE (schema.sql r.30); zonder waarde faalt de seed op
-- een not-null-constraint in plaats van op de gate zelf.
insert into public.fondsen (id, naam, slug)
values ('33333333-3333-3333-3333-333333333333', 'R1 Testfonds anon', 'r1-anon-test');

insert into public.documenten (id, fonds_id, titel, bron, bibliotheek)
values ('30000000-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333',
        'R1 fondsdocument', 'Intern', 'fonds');

insert into public.documenten (id, fonds_id, titel, bron, bibliotheek)
values ('30000000-0000-0000-0000-000000000002',
        null, 'R1 generiek document', 'DNB', 'generiek');

insert into public.document_chunks (document_id, tekst, chunk_index)
values ('30000000-0000-0000-0000-000000000002', 'R1 generieke chunktekst', 0);

set local role anon;

do $$
declare
  n_doc      int;
  n_chunk    int;
  n_fondsen  int;
  fouten     text := '';
begin
  select count(*) into n_doc     from public.documenten;
  select count(*) into n_chunk   from public.document_chunks;
  select count(*) into n_fondsen from public.fondsen;

  if n_doc   <> 0 then fouten := fouten || format('  - documenten: %s rijen zichtbaar voor anon%s', n_doc, chr(10)); end if;
  if n_chunk <> 0 then fouten := fouten || format('  - document_chunks: %s rijen zichtbaar voor anon%s', n_chunk, chr(10)); end if;
  if n_fondsen <> 0 then fouten := fouten || format('  - fondsen: %s rijen zichtbaar voor anon (observatie O-01)%s', n_fondsen, chr(10)); end if;

  if fouten <> '' then
    raise exception E'GATE D FAALT: de publieke anon-key ziet tenantdata:\n%', fouten;
  end if;
  raise notice 'GATE D OK: anon ziet geen documenten, chunks of fondsen.';
end $$;

reset role;
rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de OK-notices van A1, A2, B, C, C2,
-- E, F, G, H en D zag. Elke "FAALT" doet raise exception → non-zero exit → CI rood.
-- ============================================================================
