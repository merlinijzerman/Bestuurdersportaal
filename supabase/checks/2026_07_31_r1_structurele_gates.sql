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
    'platform_event_chain_state',     -- één platformbrede, intern vergrendelde ketenkop
    'platform_event_fork_declarations', -- append-only verklaringen van historische forks
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
    'concepts',                       -- canonieke conceptcatalogus (T7): sectorbrede,
                                      -- platform-globale codelijst, geen fonds_id,
                                      -- geen PII, geen tenantinhoud. `for select
                                      -- using(true)` naar authenticated, service-role
                                      -- schrijft (catalogus-eigenaar). Global-by-design.
    -- AI-begrenzing (besluit 0180). Zes platformbrede configuratie- en
    -- besluittabellen, alle deny-by-default (RLS aan, geen policy, revoke voor
    -- anon én authenticated). Ze dragen bewust geen fonds_id: quota, kill
    -- switches en de modelallowlist gelden voor de HELE omgeving, en een
    -- heractiveringsverzoek is een platformhandeling, geen fondsgegeven.
    -- De twee tabellen die wél per fonds meten — ai_actie en ai_verbruik_log —
    -- hebben een eigen fonds_id en worden door gate A1 overgeslagen.
    'ai_config_versie',               -- deny-by-default; CAS-teller voor vier ogen
    'ai_quota_config',                -- deny-by-default; de vier maandquota als data
    'ai_model_allowlist',             -- deny-by-default; toegestane modellen + venster
    'ai_kill_switch',                 -- deny-by-default; de vier schakelaars
    'ai_heractivering_verzoek',       -- deny-by-default + append-only
    'ai_heractivering_besluit'        -- deny-by-default + append-only
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
-- ║ GATE D1 — policies op storage.objects hebben een echte auth-binding     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- WAAROM DEZE GATE ER NIET WAS, EN WAT DAT KOSTTE (WP2, 17-08-2026).
-- Gates A1, A2, B, C, C2 en G filteren allemaal op `schemaname = 'public'`.
-- Geen enkele gate keek ooit naar storage.objects. Daardoor kon de policy
-- `documenten storage lezen` twee weken zonder TO-clausule en zonder
-- auth.uid()-toets blijven staan — ongeauthenticeerd leesbaar via de publieke
-- anon-key — terwijl de volledige gateset groen rapporteerde. De bevinding was
-- op 31-07 zelfs schriftelijk benoemd (2026_07_31_r1_rls_tenantgrenzen.sql
-- r. 279-282) en verdween alsnog uit beeld. Een gate die een hele klasse
-- objecten niet ziet, geeft geen zekerheid maar de schijn ervan.
--
-- COMMAND-AWARE. Een policy zonder auth.uid() in `qual` is niet per definitie
-- fout: een INSERT-policy hééft geen `qual`, die heeft `with_check`. Een grove
-- regel op alleen `qual` zou elke legitieme schrijfpolicy ten onrechte rood
-- maken en daarmee zichzelf onbruikbaar. Daarom per commando:
--
--     SELECT, DELETE  → qual
--     INSERT          → with_check
--     UPDATE, ALL     → qual én with_check
--
-- ROLLEN. pg_policies.roles is `{public}` wanneer de TO-clausule ontbreekt.
-- Op Supabase is `public` inclusief `anon`, dus dat telt als publiek. NULL
-- wordt defensief net zo behandeld.
--
-- WAT DEZE GATE NIET KAN. De predicaattoets is tekstueel: hij ziet DÁT er
-- `auth.uid()` in de expressie staat, niet of ELKE tak eraan gebonden is. De
-- bevinding die deze gate motiveerde is daar zelf het voorbeeld van — de oude
-- leespolicy bevatte `auth.uid()` in de fondstak terwijl juist de `generiek`-tak
-- ongebonden was. Wat die policy hier tegenhoudt is de ROLGRENS, niet het
-- predicaat. Lees de predicaattoets dus als ondergrens, niet als bewijs; een
-- nieuwe policy met een ongebonden OR-tak én `to authenticated` komt hier
-- doorheen. Voor dat laatste is de gedragstest (gate D) de vangnetlaag.
do $$
declare
  r        record;
  fouten   text := '';
  ontbreekt text;
  -- Gedateerde uitzondering, bewust smal en met naam. Deze policy heeft
  -- `to authenticated` maar GEEN gebruikers- of fondsbinding in het predicaat:
  -- elke ingelogde gebruiker kan een vrijgegeven auditexport van een WILLEKEURIG
  -- fonds lezen. De fondsbinding zit uitsluitend in de applicatielaag
  -- (magFondsAuditExportZien). Dat is een openstaande bevinding (17-08-2026),
  -- geen ontwerpkeuze — hij staat hier zodat de gate bruikbaar blijft zonder de
  -- regel zelf te verzwakken. Verwijder deze uitzondering zodra de policy een
  -- eigen fondsgrens heeft; laat hem niet stilzwijgend staan.
  uitzonderingen text[] := array['aqlab-audit fonds-download vrijgegeven'];
begin
  for r in
    select policyname,
           upper(cmd) as cmd,
           coalesce(roles::text, '{public}') as roles,
           coalesce(qual, '')       as qual,
           coalesce(with_check, '') as with_check
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
     order by policyname
  loop
    -- (a) rolgrens
    if r.roles is null
       or r.roles like '%public%'
       or r.roles like '%anon%' then
      fouten := fouten || format(
        '  - %s (%s): roles = %s — zonder TO-clausule geldt de policy voor anon%s',
        r.policyname, r.cmd, r.roles, chr(10));
    end if;

    -- (b) auth-predicaat op de expressie die voor dít commando telt
    ontbreekt := '';
    if r.cmd in ('SELECT', 'DELETE') then
      if position('auth.uid()' in r.qual) = 0 then ontbreekt := 'qual'; end if;
    elsif r.cmd = 'INSERT' then
      if position('auth.uid()' in r.with_check) = 0 then ontbreekt := 'with_check'; end if;
    elsif r.cmd in ('UPDATE', 'ALL') then
      if position('auth.uid()' in r.qual) = 0 then ontbreekt := 'qual'; end if;
      if position('auth.uid()' in r.with_check) = 0 then
        ontbreekt := case when ontbreekt = '' then 'with_check' else ontbreekt || ' + with_check' end;
      end if;
    end if;

    if ontbreekt <> '' then
      if r.policyname = any (uitzonderingen) then
        -- Luidruchtig, elke run opnieuw: een uitzondering die niemand meer ziet
        -- is een uitzondering die permanent wordt.
        raise notice 'GATE D1 UITZONDERING: % (%) heeft geen auth.uid() in % — bekende openstaande bevinding (geen fondsgrens in de policy, alleen in de applicatielaag).',
                     r.policyname, r.cmd, ontbreekt;
      else
        fouten := fouten || format(
          '  - %s (%s): geen auth.uid() in %s%s',
          r.policyname, r.cmd, ontbreekt, chr(10));
      end if;
    end if;
  end loop;

  -- De uitzonderingslijst mag niet stilletjes verouderen: staat er een naam op
  -- die niet meer bestaat, dan is de lijst niet opgeruimd en verbergt hij
  -- mogelijk een volgende policy met dezelfde naam.
  for r in
    select unnest(uitzonderingen) as naam
  loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname = r.naam
    ) then
      fouten := fouten || format(
        '  - uitzonderingslijst noemt onbekende policy %s — lijst opruimen%s',
        r.naam, chr(10));
    end if;
  end loop;

  -- Sentinel: nul policies betekent hier niet "schoon" maar "niets getoetst".
  -- De vier eigen policies (documenten lezen/schrijven, afschriften, aqlab)
  -- horen te bestaan; ontbreken ze, dan draait de gate tegen een database
  -- zonder onze storage-configuratie en zegt een groene uitslag niets.
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects') = 0 then
    raise exception 'GATE D1 FAALT: geen enkele policy op storage.objects gevonden — storage-baseline niet toegepast, er is niets getoetst.';
  end if;

  if fouten <> '' then
    raise exception E'GATE D1 FAALT: storage.objects-policies zonder sluitende auth-binding:\n%', fouten;
  end if;
  raise notice 'GATE D1 OK: elke policy op storage.objects is rolgebonden en heeft auth.uid() op de juiste expressie.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE D — de rol `anon` ziet geen tenantdata (gedragstest, met seed)     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Zonder seed zou deze test vacuüm slagen: een lege tabel levert altijd 0.
-- Daarom eerst als eigenaar één fondsdocument én één generiek document
-- seeden, en pas daarna als `anon` tellen. Alles in één transactie met
-- rollback.
--
-- Sinds 17-08-2026 seedt deze gate ook storage.objects: D1 hierboven toetst de
-- VORM van de policy, dit toetst het GEDRAG. Beide zijn nodig — een policy kan
-- er correct uitzien en toch rijen prijsgeven, en andersom.
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

-- Storage-seed (17-08-2026). Padconventie: <fonds_uuid>/<doc>.pdf voor
-- fondsmateriaal en generiek/<doc>.pdf voor de gedeelde bibliotheek. Juist die
-- generieke tak was ongeauthenticeerd leesbaar; zonder een object ONDER dat pad
-- zou deze gedragstest vacuüm slagen.
insert into storage.objects (bucket_id, name)
values
  ('documenten', '33333333-3333-3333-3333-333333333333/r1-fonds.pdf'),
  ('documenten', 'generiek/r1-generiek.pdf');

set local role anon;

do $$
declare
  n_doc      int;
  n_chunk    int;
  n_fondsen  int;
  n_storage  int;
  n_generiek int;
  fouten     text := '';
begin
  select count(*) into n_doc     from public.documenten;
  select count(*) into n_chunk   from public.document_chunks;
  select count(*) into n_fondsen from public.fondsen;
  select count(*) into n_storage
    from storage.objects where bucket_id = 'documenten';
  select count(*) into n_generiek
    from storage.objects
   where bucket_id = 'documenten'
     and (storage.foldername(name))[1] = 'generiek';

  if n_doc   <> 0 then fouten := fouten || format('  - documenten: %s rijen zichtbaar voor anon%s', n_doc, chr(10)); end if;
  if n_chunk <> 0 then fouten := fouten || format('  - document_chunks: %s rijen zichtbaar voor anon%s', n_chunk, chr(10)); end if;
  if n_fondsen <> 0 then fouten := fouten || format('  - fondsen: %s rijen zichtbaar voor anon (observatie O-01)%s', n_fondsen, chr(10)); end if;
  -- De generieke telling apart, omdat dát de feitelijke bevinding was: een
  -- generieke uitslag "0 storage-rijen" verbergt niet welke tak lekte.
  if n_generiek <> 0 then fouten := fouten || format('  - storage.objects generiek/: %s objecten zichtbaar voor anon (PT-2)%s', n_generiek, chr(10)); end if;
  if n_storage <> 0 then fouten := fouten || format('  - storage.objects bucket documenten: %s objecten zichtbaar voor anon%s', n_storage, chr(10)); end if;

  if fouten <> '' then
    raise exception E'GATE D FAALT: de publieke anon-key ziet tenantdata:\n%', fouten;
  end if;
  raise notice 'GATE D OK: anon ziet geen documenten, chunks, fondsen of storage-objecten.';
end $$;

reset role;
rollback;


-- ============================================================================
-- ║ GATES K1, K3, K5, K7, K8, K9 — eenheidsdimensie (ZELF-ACTIVEREND)        ║
-- ============================================================================
-- Toegevoegd bij ticket V0 (voorwerk eenheidsdimensie), vóórdat er iets te
-- toetsen valt. Criteria: Architectuurnotitie eenheidsdimensie (APF-kringen)
-- v0.4 §8; datamodel §4.1–§4.3; retrieval-predicaat §5.2.
--
-- WAAROM ZE ER NU AL STAAN. Een acceptatiecriterium dat pas wordt opgeschreven
-- als de migratie er ligt, is geen criterium maar een beschrijving. Deze gates
-- zijn geschreven vóór de eerste kolom bestaat, zodat ze de migratie beoordelen
-- in plaats van andersom.
--
-- HOE "ZELF-ACTIVEREND" WERKT. Elke gate begint met een guard op het object dat
-- hij toetst:
--
--     if to_regclass('public.eenheden') is null then return; end if;
--
-- Zolang dat object niet bestaat zwijgt de gate en blijft CI groen; vanaf het
-- moment dat het er is, handhaaft hij automatisch. Geen aparte "gates aanzetten"-
-- stap, geen periode met rode CI, en niemand kan vergeten ze in te schakelen.
-- Gates die een kolom toetsen guarden aanvullend op die kolom, omdat de kolommen
-- (P1-3) later landen dan de tabel (P1-1).
--
-- LET OP — een zwijgende gate is geen geslaagde gate. Vóór P1-1 geeft geen van
-- deze zes een OK-notice. Zie je ze niet in de output, dan is dat correct; zie je
-- ze ná P1-1 nog steeds niet, dan is de guard verkeerd en toetst er niets.
-- ============================================================================


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE K7 — elk fonds heeft PRECIES ÉÉN systeem-eenheid                  ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Twee helften, omdat "precies één" in PostgreSQL niet met één mechanisme te
-- borgen is (§4.1): *bestaan* is geen tabelconstraint.
--   • hoogstens één → de partiële unique-index ux_eenheden_systeem
--   • ten minste één → een trigger op fondsen, die alleen achteraf toetsbaar is
-- Deze gate toetst beide. Valt de index weg bij een herbouw van het schema, dan
-- is de eerste helft stil verdwenen; daarom staat hij hier expliciet.
do $$
declare
  ontbreekt text;
begin
  if to_regclass('public.eenheden') is null then return; end if;

  select string_agg(format('  - fonds %s (%s)', f.id, f.naam), chr(10) order by f.naam)
    into ontbreekt
    from public.fondsen f
   where not exists (
           select 1 from public.eenheden e
            where e.fonds_id = f.id and e.is_systeem
         );

  if ontbreekt is not null then
    raise exception E'GATE K7 FAALT: fondsen zonder systeem-eenheid — objecten van dit fonds kunnen niet fondsbreed worden geplaatst:\n%', ontbreekt;
  end if;

  if to_regclass('public.ux_eenheden_systeem') is null then
    raise exception 'GATE K7 FAALT: de partiele unique-index ux_eenheden_systeem ontbreekt; "hoogstens een systeem-eenheid per fonds" is dan nergens afgedwongen.';
  end if;

  raise notice 'GATE K7 OK: elk fonds heeft precies een systeem-eenheid (bestaan getoetst, uniciteit afgedwongen).';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE K9 — fonds met de module UIT houdt precies één eenheid            ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- De eenheidsdimensie is optioneel. Een fonds dat hem niet gebruikt, hoort de
-- systeem-eenheid te hebben en verder niets: anders bestaat er wél een indeling
-- die nergens in de interface zichtbaar is, en dat is precies het geval waarin
-- iemand een stuk in een kring hangt die niemand kan zien.
--
-- WAT DEZE GATE NIET ZIET. Het effectieve manifest is `registry.defaultActief ⊕
-- fonds_module_manifest` (core/lib/fonds-config.ts) en die default staat in
-- CODE, niet in de database. SQL kan dus alleen fondsen zien met een EXPLICIETE
-- uit-regel. Staat de module standaard uit en heeft een fonds geen rij, dan valt
-- het buiten deze gate. Dat is een bewuste ondergrens, geen omissie.
do $$
declare
  offenders text;
begin
  if to_regclass('public.eenheden') is null then return; end if;
  if to_regclass('public.fonds_module_manifest') is null then return; end if;

  select string_agg(
           format('  - fonds %s: %s eenheden terwijl de module expliciet uit staat', x.fonds_id, x.aantal),
           chr(10) order by x.fonds_id)
    into offenders
    from (
      select m.fonds_id,
             (select count(*) from public.eenheden e where e.fonds_id = m.fonds_id) as aantal
        from public.fonds_module_manifest m
       where m.module_key = 'eenheden'
         and m.actief is false
    ) x
   where x.aantal <> 1;

  if offenders is not null then
    raise exception E'GATE K9 FAALT: onzichtbare eenheidsindeling — een fonds met de module uit hoort alleen de systeem-eenheid te houden:\n%', offenders;
  end if;

  raise notice 'GATE K9 OK: elk fonds met de module expliciet uit houdt precies een eenheid.';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE K1 — fondsconsistentie op eenheid_id                              ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- De composite-FK (fonds_id, eenheid_id) → eenheden (fonds_id, id) dekt dit
-- declaratief af — MAAR alleen waar beide kolommen gevuld zijn. PostgreSQL
-- hanteert MATCH SIMPLE: is één van de FK-kolommen NULL, dan wordt de constraint
-- overgeslagen (§4.3). Deze gate toetst de uitkomst in de data, niet de intentie
-- in de migratie — conform de werkinstructie "toets de uitkomst in de database".
--
-- De tweede helft is het gat dat MATCH SIMPLE juist openlaat: de HALFGEVULDE
-- combinatie bij `documenten`, waar `eenheid_id` nullable blijft omdat
-- NULL ⟺ generiek. Een document met een fonds maar zonder eenheid, of andersom,
-- valt buiten élke declaratieve toets.
do $$
declare
  t         text;
  n         bigint;
  offenders text := '';
begin
  if to_regclass('public.eenheden') is null then return; end if;

  foreach t in array array['procedures','risicos','vergaderingen','documenten'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = t and column_name = 'eenheid_id')
    then continue; end if;

    execute format(
      'select count(*) from public.%I x
        where x.eenheid_id is not null
          and not exists (select 1 from public.eenheden e
                           where e.id = x.eenheid_id and e.fonds_id = x.fonds_id)', t)
      into n;

    if n > 0 then
      offenders := offenders ||
        format('  - %s: %s rijen verwijzen naar een eenheid van een ANDER fonds%s', t, n, chr(10));
    end if;
  end loop;

  if to_regclass('public.documenten') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'documenten'
                    and column_name = 'eenheid_id')
  then
    execute 'select count(*) from public.documenten
              where (fonds_id is null) <> (eenheid_id is null)'
      into n;
    if n > 0 then
      offenders := offenders ||
        format('  - documenten: %s rijen met een halfgevulde (fonds_id, eenheid_id)-combinatie — buiten bereik van de composite-FK%s', n, chr(10));
    end if;
  end if;

  if offenders <> '' then
    raise exception E'GATE K1 FAALT: eenheidskoppelingen doorbreken de fondsgrens:\n%', offenders;
  end if;

  raise notice 'GATE K1 OK: elke eenheidskoppeling blijft binnen het eigen fonds; geen halfgevulde combinaties.';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE K3 — eenheidsscope filtert geen generieke bronnen weg             ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- TWEE HELFTEN, EN DE TWEEDE IS DE BELANGRIJKSTE.
--
-- K3a (data) — een niet-generieke chunk draagt een eenheid van het EIGEN fonds.
-- `document_chunks.eenheid_id` is een denorm-kolom die de parent volgt via
-- fn_chunk_denorm (§4.2, §5.1). Loopt die denorm scheef, dan is de pre-filter
-- vóór de HNSW-scan aantoonbaar onjuist en betekent "scope ∪ {systeem}" niets
-- meer.
--
-- K3b (structureel) — de REGRESSIETEST op de fout die in v0.3 van de
-- architectuurnotitie zat. Die formulering liet een generieke chunk
-- (`eenheid_id IS NULL`) aan geen enkele tak van het scope-predicaat voldoen.
-- Bij een actieve kringscope zou de assistent daarmee stilzwijgend het volledige
-- DNB-, AFM- en Pensioenfederatie-corpus buitensluiten. Dat is de gevaarlijkste
-- soort fout: hij is niet zichtbaar in de output, alleen in wat ontbreekt. §5.2
-- corrigeert het predicaat met een expliciete generieke ontsnapping; deze helft
-- bewaakt dat die er blijft.
--
-- WAT K3b NIET KAN. De toets is TEKSTUEEL op de functiedefinitie — dezelfde
-- ondergrens die bij gate D1 is opgeschreven. Hij ziet DÁT er binnen de
-- eenheidstak een generieke ontsnapping staat, niet of die in élke uitvoerings-
-- tak bereikbaar is. Lees hem als ondergrens, niet als bewijs; het echte bewijs
-- is de K4-baseline plus de AQLab-categorie "kringvermenging" (K6).
do $$
declare
  n            bigint;
  fn           text;
  definitie    text;
  genormaliseerd text;
  p            int;
  offenders    text := '';
begin
  if to_regclass('public.eenheden') is null then return; end if;

  -- ── K3a — denorm-integriteit ────────────────────────────────────────────
  if to_regclass('public.document_chunks') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'document_chunks'
                    and column_name = 'eenheid_id')
  then
    execute 'select count(*) from public.document_chunks dc
              where dc.bibliotheek is distinct from ''generiek''
                and dc.eenheid_id is not null
                and not exists (select 1 from public.eenheden e
                                 where e.id = dc.eenheid_id and e.fonds_id = dc.fonds_id)'
      into n;
    if n > 0 then
      offenders := offenders ||
        format('  - document_chunks: %s niet-generieke chunks dragen een eenheid van een ander fonds (denorm scheef)%s', n, chr(10));
    end if;
  end if;

  -- ── K3b — generieke ontsnapping in het scope-predicaat ──────────────────
  foreach fn in array array['zoek_chunks','zoek_chunks_hybride'] loop
    select pg_get_functiondef(p2.oid) into definitie
      from pg_proc p2
      join pg_namespace ns on ns.oid = p2.pronamespace
     where ns.nspname = 'public' and p2.proname = fn
     order by p2.oid desc
     limit 1;

    if definitie is null then continue; end if;

    genormaliseerd := lower(regexp_replace(definitie, '\s+', ' ', 'g'));

    -- Nog geen scope-parameter: de gate is voor deze functie niet van toepassing.
    if position('p_eenheid_ids' in genormaliseerd) = 0 then continue; end if;

    p := position('p_eenheid_ids is null' in genormaliseerd);
    if p = 0 then
      offenders := offenders ||
        format('  - %s: heeft p_eenheid_ids maar geen "p_eenheid_ids is null"-tak; scope is dan niet uitschakelbaar%s', fn, chr(10));
    elsif position('generiek' in substr(genormaliseerd, p, 300)) = 0 then
      offenders := offenders ||
        format('  - %s: het eenheidspredicaat kent geen generieke ontsnapping — een actieve scope sluit het generieke corpus uit (v0.3-regressie)%s', fn, chr(10));
    end if;
  end loop;

  if offenders <> '' then
    raise exception E'GATE K3 FAALT: de eenheidsscope tast het generieke corpus aan of de denorm loopt scheef:\n%', offenders;
  end if;

  raise notice 'GATE K3 OK: denorm binnen het eigen fonds; het scope-predicaat laat generieke bronnen door.';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE K8 — de tijdelijke vangnettrigger bestaat niet meer               ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Risico R4: blijft `trg_eenheid_vangnet` staan, dan krijgt elk object waarvoor
-- niemand een eenheid koos stilzwijgend de systeem-eenheid. Dat leest als
-- "bewust APF-breed" terwijl het "vergeten" betekent — en het verschil is later
-- niet meer te reconstrueren.
--
-- AFWIJKENDE GUARD, BEWUST. De overige gates guarden op het bestaan van
-- `eenheden`. Dat zou hier fout uitpakken: de vangnettrigger MAG bestaan tijdens
-- expand/migrate en moet pas weg zijn ná de contract-stap. Guarden op `eenheden`
-- maakt CI rood gedurende precies het venster waarin de trigger legitiem is —
-- exact wat deze aanpak wil voorkomen. Daarom activeert K8 op het contract-
-- signaal zelf: `procedures.eenheid_id` staat op NOT NULL (§4.2, kolom wordt
-- NOT NULL na contract). Vanaf dat moment is er geen reden meer voor een vangnet.
do $$
begin
  if to_regclass('public.eenheden') is null then return; end if;

  if not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'procedures'
          and column_name = 'eenheid_id' and is_nullable = 'NO')
  then return; end if;

  if exists (select 1 from pg_trigger where tgname = 'trg_eenheid_vangnet' and not tgisinternal) then
    raise exception 'GATE K8 FAALT: trg_eenheid_vangnet bestaat nog na de contract-stap; vergeten eenheden worden daardoor als bewust fondsbreed geboekt (risico R4).';
  end if;

  raise notice 'GATE K8 OK: de vangnettrigger is opgeruimd.';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ GATE K5 — een inactieve eenheid weigert nieuwe koppelingen             ║
-- ╚════════════════════════════════════════════════════════════════════════╝
-- GEDRAGSTEST, geen structuurtest. §8 is daar expliciet over: "getoetst door een
-- insert-poging, niet door de aanwezigheid van een FK". Een FK naar `eenheden`
-- zegt niets over `actief` — die invariant is procedureel (§4.1) en dus alleen
-- door gedrag te bewijzen. Zelfde opzet als gate D: alles in een transactie die
-- onvoorwaardelijk terugrolt, zodat de check niets achterlaat.
--
-- MET POSITIEVE CONTROLE. Een test die alleen kijkt of de tweede insert faalt,
-- slaagt óók wanneer die insert om een heel andere reden faalt — een ontbrekende
-- NOT NULL-waarde, een gewijzigde CHECK op template_code, een trigger die er
-- niets mee te maken heeft. Dan is de gate groen zonder iets te hebben
-- aangetoond. Daarom eerst een identieke insert naar een ACTIEVE eenheid, die
-- moet slagen. Slaagt die controle niet, dan meldt de gate zich ONBRUIKBAAR in
-- plaats van groen: een gate die niets kan bewijzen hoort luid te zijn, niet stil.
begin;
do $$
declare
  v_fonds     uuid;
  v_actief    uuid;
  v_inactief  uuid;
  controle_ok boolean := false;
  koppeling_geaccepteerd boolean := false;
  fout        text;
begin
  if to_regclass('public.eenheden') is null then return; end if;
  if not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'procedures' and column_name = 'eenheid_id')
  then return; end if;

  select id into v_fonds from public.fondsen order by aangemaakt nulls last, id limit 1;
  if v_fonds is null then
    raise notice 'GATE K5 OVERGESLAGEN: geen enkel fonds in deze database.';
    return;
  end if;

  insert into public.eenheden (fonds_id, code, naam, soort, is_systeem, actief)
  values (v_fonds, 'k5-gate-actief', 'K5 gatetest actief (rollback)', 'overig', false, true)
  returning id into v_actief;

  insert into public.eenheden (fonds_id, code, naam, soort, is_systeem, actief)
  values (v_fonds, 'k5-gate-inactief', 'K5 gatetest inactief (rollback)', 'overig', false, false)
  returning id into v_inactief;

  -- Positieve controle: naar een ACTIEVE eenheid moet koppelen gewoon lukken.
  begin
    insert into public.procedures (fonds_id, template_code, titel, eenheid_id)
    values (v_fonds, 'k5_gatetest', 'K5 gatetest controle (rollback)', v_actief);
    controle_ok := true;
  exception when others then
    fout := sqlerrm;
  end;

  if not controle_ok then
    raise exception 'GATE K5 ONBRUIKBAAR: de controle-insert naar een ACTIEVE eenheid faalde (%). De gate kan daarmee niets aantonen over inactieve eenheden — repareer de testopzet voordat je dit als groen leest.', fout;
  end if;

  -- De eigenlijke toets: naar een INACTIEVE eenheid moet het worden geweigerd.
  begin
    insert into public.procedures (fonds_id, template_code, titel, eenheid_id)
    values (v_fonds, 'k5_gatetest', 'K5 gatetest inactief (rollback)', v_inactief);
    koppeling_geaccepteerd := true;
  exception when others then
    koppeling_geaccepteerd := false;
  end;

  if koppeling_geaccepteerd then
    raise exception 'GATE K5 FAALT: een nieuwe koppeling naar een GEDEACTIVEERDE eenheid werd geaccepteerd. Deactiveren is dan cosmetisch en de kring blijft in gebruik.';
  end if;

  raise notice 'GATE K5 OK: koppelen naar een actieve eenheid lukt, naar een inactieve wordt geweigerd.';
end $$;
rollback;


-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de OK-notices van A1, A2, B, C, C2,
-- E, F, G, H en D zag. Elke "FAALT" doet raise exception → non-zero exit → CI rood.
--
-- De eenheidsgates K1, K3, K5, K7, K8 en K9 zijn ZELF-ACTIVEREND: zolang
-- public.eenheden niet bestaat geven ze geen notice en is dat correct. Vanaf
-- P1-1 hoor je ze in de output terug te zien; blijven ze dan stil, dan toetst er
-- niets en klopt de guard niet.
-- ============================================================================
