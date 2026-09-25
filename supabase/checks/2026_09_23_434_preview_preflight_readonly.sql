-- ============================================================================
--  #434 T4-F — READ-ONLY preflight voor de Preview-uitrol
-- ----------------------------------------------------------------------------
--  DOEL
--    Vóór toepassing vaststellen WAT er op de doelomgeving staat: is dit
--    werkelijk Preview, zijn de voorwaarden aanwezig, en welke van de twee
--    #434-migraties moeten nog worden toegepast. Zij VERANDERT NIETS: geen
--    insert, geen update, geen delete, geen DDL, geen tijdelijke tabel, geen
--    `set role`. Alleen catalogus- en grantmetadata lezen.
--
--    Model: `supabase/checks/2026_09_21_423_t4d_premerge_readonly.sql`.
--
--  ROL: database-eigenaar/postgres. Deze preflight meet de STAND van de
--    catalogus en van de grants, niet het gedrag van één sessie. Zij speelt de
--    rolscheiding daarom niet na met `set role` — dat zou alleen tonen wat één
--    rol mag — maar leest de werkelijke rechten uit met has_function_privilege()
--    voor anon en authenticated tegelijk. Zij is niet aangesloten in
--    scripts/cross-tenant-ci.sh: op een wegwerp-DB ontbreekt de
--    Preview-fingerprint en hoort zij juist fail-closed af te breken.
--
--  SQL-EDITORVAST: geen psql-metacommando's. Plakbaar in de Supabase SQL Editor.
--
--  DOELBEVESTIGING. De eerste controle is de Preview-fingerprint uit
--  `supabase/seeds/preview/2026_09_22_428_app365_preview_provision.sql`: een
--  actieve `app.preview.bestuurdersportaal.com` én GEEN productiehost. Draait
--  dit script per ongeluk op Productie, dan breekt het af vóór het iets meldt.
--  Een preflight die op de verkeerde database een geruststellend antwoord geeft,
--  is gevaarlijker dan geen preflight.
--
--  `pg_get_functiondef()` wordt hier gebruikt om de DOEL-database te
--  controleren. Zij is nadrukkelijk niet de bron van de migratie: dezelfde
--  migratie moet op Preview en Productie dezelfde SQL opleveren, en dat kan
--  alleen als het migratiebestand leidend is.
-- ============================================================================
do $$
declare
  v_fout        text := '';
  v_stand       text := '';
  v_basis       text;
  v_heeft_proj  boolean;
  v_heeft_fn    boolean;
  v_wrapper_ok  boolean;
  v_te_doen     text := '';
begin
  -- ── 0. DOELBEVESTIGING. Eerst, en fail-closed ────────────────────────────
  if not exists (
        select 1 from public.tenant_domains
         where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (
        select 1 from public.tenant_domains
         where host like '%.bestuurdersportaal.com'
           and host not like '%.preview.bestuurdersportaal.com')
  then
    raise exception '#434 VERKEERDE DOELOMGEVING: Preview-fingerprint ontbreekt of er staat een productiehost. Deze preflight hoort uitsluitend op portal_preview te draaien.';
  end if;
  v_stand := v_stand || E'\n  [doel]      Preview-fingerprint bevestigd (app.preview.bestuurdersportaal.com actief, geen productiehost).';

  -- ── 1. VOORWAARDEN voor migratie 1 (2026_09_22_434_meta_adapters.sql) ────
  -- Zij herdefinieert de wrappers en roept meta_projectie() aan.
  if to_regprocedure('public.meta_projectie(jsonb, boolean)') is null then
    v_fout := v_fout || E'\n  - public.meta_projectie(jsonb, boolean) ontbreekt; migratie 1 kan niet worden toegepast.';
  end if;
  if to_regprocedure('public.meta_basisniveau(jsonb)') is null
     or to_regprocedure('public.meta_bronniveau(jsonb)') is null then
    v_fout := v_fout || E'\n  - meta_basisniveau/meta_bronniveau ontbreken; de wrapperketen is niet op #367/#368-stand.';
  else
    v_basis := pg_get_functiondef(to_regprocedure('public.meta_basisniveau(jsonb)')::oid);
    -- #368-stand: beide auditsleutels zitten in de basisprojectie. Staat Preview
    -- daaronder, dan zou migratie 1 sleutels TOEVOEGEN die nog niet zijn
    -- vrijgegeven; staat er iets nieuwers in, dan zou zij het WEGNEMEN.
    v_wrapper_ok := v_basis like '%evidence_audit%' and v_basis like '%modelcontext_audit%';
    if not v_wrapper_ok then
      v_fout := v_fout || E'\n  - meta_basisniveau draagt evidence_audit/modelcontext_audit niet; Preview staat onder de #368-stand waarop migratie 1 voortbouwt.';
    else
      v_stand := v_stand || E'\n  [stand]     wrapperketen op #368-stand (evidence_audit + modelcontext_audit aanwezig).';
    end if;
  end if;

  -- ── 2. VOORWAARDEN voor migratie 2 (2026_09_23_434_adapterstand_fonds.sql)
  if to_regprocedure('public.mag_audit(uuid)') is null then
    v_fout := v_fout || E'\n  - public.mag_audit(uuid) ontbreekt (besluit 0119); migratie 2 kan niet worden toegepast.';
  end if;
  if to_regclass('public.governance_audit_inzage') is null then
    v_fout := v_fout || E'\n  - public.governance_audit_inzage ontbreekt (besluit 0119); migratie 2 kan geen inzageregel schrijven.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'governance_log'
                    and column_name = 'aangemaakt') then
    v_fout := v_fout || E'\n  - governance_log.aangemaakt ontbreekt; de sortering in migratie 2 zou falen.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profielen'
                    and column_name = 'fonds_id') then
    v_fout := v_fout || E'\n  - profielen.fonds_id ontbreekt; migratie 2 leidt het fonds daaruit af.';
  end if;

  -- ── 3. WAT STAAT ER AL? ──────────────────────────────────────────────────
  v_heeft_proj := to_regprocedure('public.meta_adapters_projectie(jsonb)') is not null;
  v_heeft_fn   := to_regprocedure('public.fn_adapterstand_fonds(integer)') is not null;

  if v_heeft_proj then
    v_stand := v_stand || E'\n  [aanwezig]  meta_adapters_projectie(jsonb).';
    if v_basis is not null and v_basis like '%meta_adapters_projectie%' then
      v_stand := v_stand || E'\n  [aanwezig]  meta_basisniveau roept meta_adapters_projectie aan: migratie 1 is VOLLEDIG toegepast.';
    else
      v_fout := v_fout || E'\n  - HALVE STAND: meta_adapters_projectie bestaat, maar meta_basisniveau roept haar niet aan. Migratie 1 is niet volledig toegepast; pas haar opnieuw volledig toe.';
    end if;
  else
    v_te_doen := v_te_doen || E'\n  1. supabase/migrations/2026_09_22_434_meta_adapters.sql';
  end if;

  if v_heeft_fn then
    v_stand := v_stand || E'\n  [aanwezig]  fn_adapterstand_fonds(integer): migratie 2 is toegepast.';
  else
    v_te_doen := v_te_doen || E'\n  2. supabase/migrations/2026_09_23_434_adapterstand_fonds.sql';
  end if;

  -- Volgordeslot: migratie 2 roept meta_adapters_projectie aan.
  if v_heeft_fn and not v_heeft_proj then
    v_fout := v_fout || E'\n  - VOLGORDEFOUT: fn_adapterstand_fonds bestaat zonder meta_adapters_projectie. Migratie 2 is vóór migratie 1 toegepast.';
  end if;

  -- ── 4. GRANTS op wat er al staat (H-18) ──────────────────────────────────
  if v_heeft_proj then
    if has_function_privilege('anon', to_regprocedure('public.meta_adapters_projectie(jsonb)')::oid, 'EXECUTE') then
      v_fout := v_fout || E'\n  - anon heeft EXECUTE op meta_adapters_projectie; dat hoort ingetrokken te zijn.';
    end if;
    if not has_function_privilege('authenticated', to_regprocedure('public.meta_adapters_projectie(jsonb)')::oid, 'EXECUTE') then
      v_fout := v_fout || E'\n  - authenticated mist EXECUTE op meta_adapters_projectie; de leesprojectie werkt dan niet.';
    end if;
  end if;
  if v_heeft_fn then
    if has_function_privilege('anon', to_regprocedure('public.fn_adapterstand_fonds(integer)')::oid, 'EXECUTE') then
      v_fout := v_fout || E'\n  - anon heeft EXECUTE op fn_adapterstand_fonds; dat hoort ingetrokken te zijn.';
    end if;
    if not has_function_privilege('authenticated', to_regprocedure('public.fn_adapterstand_fonds(integer)')::oid, 'EXECUTE') then
      v_fout := v_fout || E'\n  - authenticated mist EXECUTE op fn_adapterstand_fonds; de beheerstand valt dan terug op eigen beurten.';
    end if;
    -- 0119: de functie hoort de capabilitypoort te gebruiken, geen rolgate.
    if pg_get_functiondef(to_regprocedure('public.fn_adapterstand_fonds(integer)')::oid) not like '%mag_audit%' then
      v_fout := v_fout || E'\n  - fn_adapterstand_fonds op de doel-DB gebruikt mag_audit() NIET; dat is niet de versie uit deze tranche.';
    end if;
  end if;

  -- ── 5. NIEMAND KRIJGT DE GRANT OM DE PAGINA TE VULLEN ────────────────────
  -- Puur informatief, en bewust zichtbaar: deze uitrol kent GEEN stap die
  -- governance_audit_read toekent. Zonder grant toont de pagina "alleen uw
  -- eigen beurten", en dat is het beoogde eindgedrag.
  select count(*)::text into v_basis
    from public.governance_audit_grants
   where capability = 'governance_audit_read';
  v_stand := v_stand || E'\n  [0119]      governance_audit_read-grants nu aanwezig: ' || v_basis ||
             ' (deze uitrol wijzigt dat aantal NIET).';

  raise notice E'\n#434 PREVIEW-PREFLIGHT%', v_stand;
  if v_te_doen = '' then
    raise notice E'\n  [nog doen]  niets: beide #434-migraties staan al op deze omgeving.';
  else
    raise notice E'\n  [nog doen]  in deze volgorde:%', v_te_doen;
  end if;

  if v_fout <> '' then
    raise exception E'#434 PREFLIGHT ROOD — niet toepassen:%', v_fout;
  end if;
  raise notice E'\n#434 PREFLIGHT GROEN: voorwaarden aanwezig, geen halve of omgekeerde stand.';
end $$;
