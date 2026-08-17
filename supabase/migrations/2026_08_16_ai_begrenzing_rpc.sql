-- ============================================================================
--  Migratie 2026-08-16 (b) — AI-begrenzing: preflight, poort en beheer-RPC's
--
--  WAAROM
--    De tabellen uit 2026_08_16_ai_begrenzing.sql zijn deny-by-default: niemand
--    komt er rechtstreeks bij. Dit bestand levert de ENIGE toegangspaden, elk zo
--    smal mogelijk. Twee eisen sturen het ontwerp:
--
--    1. De app-surface heeft GEEN service-role (Variant-C, besluit 0066). Een
--       tenantroute kan dus niet zelf in de tellers schrijven en moet via een
--       nauw begrensde SECURITY DEFINER-functie die de identiteit zélf afleidt.
--    2. Losse Supabase-aanroepen binnen withPlatform() zijn elk een eigen
--       transactie en vormen samen GEEN atomaire handeling. Elke beheermutatie
--       is daarom precies één RPC.
--
--  WAT DIT LEVERT
--    Reserveren
--      fn_ai_actietype_spec        — de actietype-tabel als functie (bron van waarheid)
--      fn_ai_reserveer_intern      — de atomaire kern; door niemand rechtstreeks aanroepbaar
--      fn_ai_preflight             — wrapper voor de tenant-surface (authenticated)
--      fn_ai_preflight_systeem     — wrapper voor cron/worker/AQLab (service_role)
--      fn_ai_actie_afronden        — sluit een actie af (voltooid/mislukt)
--    Poort
--      fn_ai_poort_check           — LIVE controle vlak vóór iedere providercall
--    Beheer (elk één transactie, elk hoogt ai_config_versie op)
--      fn_ai_switch_stoppen
--      fn_ai_heractivering_aanvragen
--      fn_ai_heractivering_goedkeuren
--      fn_ai_heractivering_afwijzen
--      fn_ai_heractivering_intrekken
--      fn_ai_quota_wijzigen
--      fn_ai_allowlist_wijzigen
--
--  WAT DIT NIET DOET
--    * Geen capabilitycheck en geen AAL2-toets in de DB. Die horen in
--      withPlatform() op de beheer-surface, dat is de bestaande, geteste plek.
--      De beheer-RPC's zijn uitsluitend voor service_role uitvoerbaar en zijn
--      daardoor alleen ACHTER die wrapper bereikbaar. Wat de DB wél afdwingt is
--      het vier-ogenprincipe zelf — dat mag niet van een UI afhangen.
--    * Geen providerkeys, prompts, antwoorden of persoonsgegevens.
--
--  FAIL-CLOSED
--    Elk pad dat niet aantoonbaar mag doorgaan, gaat niet door. Een onbekend
--    actietype, een ontbrekende quotumrij, een onbekend model of een ontbrekend
--    fonds levert `toegestaan = false`. Er is geen impliciete default.
--
--  GATE-IMPACT
--    * Gate E — alle functies hier zijn SECURITY DEFINER MET
--      `set search_path = public, pg_temp`.
--    * Gate H — elke functie krijgt `revoke all ... from public, anon` en daarna
--      uitsluitend de minimaal vereiste executegrant. Een `drop`+`create` reset
--      de ACL, dus de revoke staat bij ELKE definitie en niet in een losse
--      reparatiemigratie (les uit OP-C5/OP-C13).
--
--  IDEMPOTENT: uitsluitend `create or replace function`. Meermaals draaien is veilig.
--
--  ROLLBACK: 2026_08_16_ai_begrenzing_rpc_ROLLBACK.sql
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → New query → Run.
--  Draai EERST 2026_08_16_ai_begrenzing.sql.
-- ============================================================================

begin;

-- ── 1. Actietype-tabel ──────────────────────────────────────────────────────
--  BRON VAN WAARHEID voor het bereik en het gewicht van een actietype. Bewust
--  een functie en geen tabel: dit is code, geen configuratie. Hetzelfde model
--  als platform_capabilities, waar de code-union leidend is en de tabel alleen
--  voor FK-integriteit bestaat. core/lib/ai-quota-kern.ts is de TypeScript-
--  spiegel; supabase/checks/2026_08_16_ai_begrenzing.sql toetst dat beide
--  dezelfde lijst kennen.
create or replace function public.fn_ai_actietype_spec(p_actietype text)
returns table (bereik text, ai_acties integer, via_gebruiker boolean, via_systeem boolean, lease_seconden integer)
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select s.bereik, s.ai_acties, s.via_gebruiker, s.via_systeem, s.lease_seconden
    from (values
      -- actietype                  bereik      acties  gebruiker systeem lease
      ('chat',                     'fonds',      1,     true,   false,   300),
      ('agendapunt_voorbereiding', 'fonds',      1,     true,   false,   300),
      ('besluit_concept',          'fonds',      1,     true,   false,   300),
      ('afschrift_concept',        'fonds',      1,     true,   false,   300),
      ('vergelijken',              'fonds',      1,     true,   false,   600),
      ('notulen_bevestig',         'fonds',      1,     true,   false,   300),
      ('embeddings_backfill',      'fonds',      1,     true,   false,   600),
      ('reindex_backfill',         'fonds',      1,     true,   false,   900),
      ('document_ingest',          'fonds',      1,     false,  true,    900),
      -- OCR is een EIGEN grootheid: nul AI-acties, wel pagina's.
      ('ocr',                      'fonds',      0,     true,   true,    600),
      -- Platformbreed: telt ALLEEN globaal. Korte, expliciete lijst, zodat
      -- fonds_id = null nooit een makkelijke quota-bypass wordt (FR-2).
      ('generiek_curatie',         'globaal',    1,     false,  true,    900),
      -- OCR op de generieke bibliotheek: geen fonds, dus een eigen
      -- platformbrede paginabucket tegen dezelfde grens.
      ('ocr_generiek',             'globaal',    0,     false,  true,    600),
      ('aqlab_run',                'globaal',    1,     false,  true,   1800),
      ('aqlab_adhoc',              'globaal',    1,     false,  true,   1800)
    ) as s(actietype, bereik, ai_acties, via_gebruiker, via_systeem, lease_seconden)
   where s.actietype = p_actietype;
$$;

comment on function public.fn_ai_actietype_spec(text) is
  'Bron van waarheid voor bereik, gewicht en lease per AI-actietype (besluit 0180). '
  'Geen rij = onbekend actietype = fail-closed. Spiegel: core/lib/ai-quota-kern.ts.';

revoke all on function public.fn_ai_actietype_spec(text) from public, anon;
grant execute on function public.fn_ai_actietype_spec(text) to authenticated, service_role;

-- ── 2. Configuratieversie ophogen ───────────────────────────────────────────
--  ELKE configuratiemutatie hoogt deze teller op — stop, heractivering, quota
--  én allowlist. Alleen daardoor detecteert de compare-and-swap bij goedkeuring
--  iedere tussentijdse wijziging, en niet slechts een nieuwe stop.
create or replace function public.fn_ai_bump_config_versie()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nieuw bigint;
begin
  update public.ai_config_versie
     set versie = versie + 1, bijgewerkt = now()
   where id = 1
  returning versie into v_nieuw;

  if v_nieuw is null then
    raise exception 'ai_config_versie ontbreekt' using errcode = 'P0002';
  end if;
  return v_nieuw;
end;
$$;

comment on function public.fn_ai_bump_config_versie() is
  'Hoogt de algemene AI-configuratieversie op. Aangeroepen door ELKE mutatie-RPC.';

revoke all on function public.fn_ai_bump_config_versie() from public, anon, authenticated;
grant execute on function public.fn_ai_bump_config_versie() to service_role;

-- ── 3. De atomaire reserveringskern ─────────────────────────────────────────
--  Door niemand rechtstreeks aanroepbaar: alleen de twee wrappers hieronder
--  komen erbij, en die stellen de identiteit zélf vast.
--
--  RACE-VEILIGHEID. Een `count` gevolgd door een `insert` is onder READ
--  COMMITTED niet atomair: twee gelijktijdige verzoeken lezen dezelfde stand en
--  reserveren allebei. `pg_advisory_xact_lock` serialiseert de hele preflight,
--  zodat de laatste vrije plek gegarandeerd één keer wordt uitgegeven. Eén
--  globale lock is bij Previewvolume (1.200 acties per maand) rekenkundig
--  irrelevant en aantoonbaar correct; de doorvoergrens is een herijkpunt vóór
--  productie (besluit 0180).
create or replace function public.fn_ai_reserveer_intern(
  p_actietype     text,
  p_fonds_id      uuid,
  p_gebruiker_id  uuid,
  p_via_systeem   boolean,
  p_provider      text,
  p_model         text,
  p_ocr_paginas   integer,
  p_idempotentie  text,
  p_vingerafdruk  text,
  p_dryrun        boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spec        record;
  v_maand       date;
  v_bestaand    record;
  v_switch      text;
  v_regel       record;
  v_limiet      integer;
  v_gebruikt    integer;
  v_actie_id    uuid;
  v_versie      bigint;
  v_ocr         integer := greatest(coalesce(p_ocr_paginas, 0), 0);
  v_reset       integer;
begin
  v_maand := (date_trunc('month', (now() at time zone 'UTC')))::date;
  v_reset := ceil(extract(epoch from (
               (date_trunc('month', (now() at time zone 'UTC')) + interval '1 month')
               - (now() at time zone 'UTC'))))::integer;
  select versie into v_versie from public.ai_config_versie where id = 1;

  -- 3a. Actietype moet bestaan en op dit pad zijn toegestaan.
  select * into v_spec from public.fn_ai_actietype_spec(p_actietype);
  if not found then
    return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
      'reden','onbekend_actietype','config_versie',v_versie);
  end if;
  if p_via_systeem and not v_spec.via_systeem then
    return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
      'reden','actietype_niet_toegestaan_op_dit_pad','config_versie',v_versie);
  end if;
  if (not p_via_systeem) and not v_spec.via_gebruiker then
    return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
      'reden','actietype_niet_toegestaan_op_dit_pad','config_versie',v_versie);
  end if;

  -- 3b. Een fondsgebonden actie ZONDER fonds bestaat niet. Dit is de plek waar
  --     `fonds_id = null` zou kunnen ontsporen tot een gratis kanaal.
  if v_spec.bereik = 'fonds' and p_fonds_id is null then
    return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
      'reden','fonds_ontbreekt','config_versie',v_versie);
  end if;
  -- Andersom net zo streng: een platformbreed actietype mag geen fonds dragen,
  -- anders zou het fondsquotum stil worden omzeild terwijl het wel fondswerk is.
  if v_spec.bereik = 'globaal' and p_fonds_id is not null then
    return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
      'reden','actietype_niet_toegestaan_op_dit_pad','config_versie',v_versie);
  end if;

  if p_idempotentie is null or length(btrim(p_idempotentie)) = 0 then
    raise exception 'idempotentiesleutel ontbreekt' using errcode = '22023';
  end if;

  -- 3c. Serialiseer vanaf hier: alles hierna leest en schrijft tellers.
  perform pg_advisory_xact_lock(hashtext('ai_quota'));

  -- 3d. Verlopen acties opruimen. Een proces dat halverwege crasht laat een rij
  --     `in_uitvoering` achter; zonder deze stap zou die de sleutel eeuwig
  --     bezet houden en een nieuwe poging blijvend blokkeren.
  update public.ai_actie
     set status = 'verlopen'
   where status = 'in_uitvoering' and verloopt_op < now();

  -- 3e. Idempotentie.
  select * into v_bestaand
    from public.ai_actie
   where idempotentie_sleutel = p_idempotentie
     and status in ('in_uitvoering','voltooid')
   limit 1;

  if found then
    -- Zelfde sleutel, ándere inhoud: dit is hergebruik van een sleutel om het
    -- quotum te omzeilen. Weigeren, niet stilzwijgend als duplicaat afdoen.
    if v_bestaand.verzoek_vingerafdruk is distinct from p_vingerafdruk then
      return jsonb_build_object('uitkomst','sleutel_conflict','toegestaan',false,
        'reden','sleutel_conflict','config_versie',v_versie);
    end if;
    if v_bestaand.status = 'voltooid' then
      return jsonb_build_object('uitkomst','duplicaat_voltooid','toegestaan',false,
        'actie_id',v_bestaand.id,'resultaat_ref',v_bestaand.resultaat_ref,
        'config_versie',v_versie);
    end if;
    return jsonb_build_object('uitkomst','duplicaat_in_uitvoering','toegestaan',false,
      'actie_id',v_bestaand.id,'config_versie',v_versie);
  end if;

  -- 3f. Kill switches. `heractivering_aangevraagd` is NIET actief — een verzoek
  --     zet de kraan niet alvast open.
  select status into v_switch from public.ai_kill_switch where sleutel = 'globaal';
  if v_switch is distinct from 'actief' then
    return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
      'reden','globaal_gestopt','config_versie',v_versie);
  end if;

  if p_provider is not null then
    select status into v_switch from public.ai_kill_switch where sleutel = p_provider;
    -- Onbekende provider = geen schakelaar = fail-closed.
    if v_switch is null or v_switch <> 'actief' then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','provider_gestopt','config_versie',v_versie);
    end if;
  end if;

  -- 3g. Modelallowlist, inclusief tijdelijk venster.
  if p_model is not null then
    select * into v_regel from public.ai_model_allowlist
     where provider = p_provider and model = p_model;
    if not found or not v_regel.actief then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','model_niet_toegestaan','config_versie',v_versie);
    end if;
    if v_regel.venster_start is not null then
      if now() < v_regel.venster_start or now() >= v_regel.venster_eind then
        return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
          'reden','model_buiten_venster','config_versie',v_versie);
      end if;
    end if;
  end if;

  -- 3h. Quota. Volgorde is bewust van smal naar breed: de gebruiker heeft alleen
  --     iets aan de melding over zijn eigen tegoed.
  if v_spec.bereik = 'fonds' and p_gebruiker_id is not null and v_spec.ai_acties > 0 then
    select waarde into v_limiet from public.ai_quota_config where sleutel = 'gebruiker_maand';
    if v_limiet is null then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_gebruiker','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
    select coalesce(sum(ai_acties),0) into v_gebruikt from public.ai_verbruik_log
     where maand = v_maand and gebruiker_id = p_gebruiker_id;
    if v_gebruikt + v_spec.ai_acties > v_limiet then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_gebruiker','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
  end if;

  if v_spec.bereik = 'fonds' and v_spec.ai_acties > 0 then
    select waarde into v_limiet from public.ai_quota_config where sleutel = 'fonds_maand';
    if v_limiet is null then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_fonds','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
    select coalesce(sum(ai_acties),0) into v_gebruikt from public.ai_verbruik_log
     where maand = v_maand and fonds_id = p_fonds_id;
    if v_gebruikt + v_spec.ai_acties > v_limiet then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_fonds','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
  end if;

  if v_spec.ai_acties > 0 then
    select waarde into v_limiet from public.ai_quota_config where sleutel = 'globaal_maand';
    if v_limiet is null then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_globaal','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
    select coalesce(sum(ai_acties),0) into v_gebruikt from public.ai_verbruik_log
     where maand = v_maand;
    if v_gebruikt + v_spec.ai_acties > v_limiet then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_globaal','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
  end if;

  if v_ocr > 0 then
    select waarde into v_limiet from public.ai_quota_config where sleutel = 'ocr_fonds_maand';
    if v_limiet is null then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_ocr','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
    select coalesce(sum(ocr_paginas),0) into v_gebruikt from public.ai_verbruik_log
     where maand = v_maand and fonds_id is not distinct from p_fonds_id;
    if v_gebruikt + v_ocr > v_limiet then
      return jsonb_build_object('uitkomst','geweigerd','toegestaan',false,
        'reden','quotum_ocr','config_versie',v_versie,'reset_seconden',v_reset);
    end if;
  end if;

  -- 3i. Dry-run: het antwoord op "zou dit mogen?", zonder te reserveren. Dient
  --     het UX-principe "maak blokkers vooraf zichtbaar" op de paden die zelf
  --     geen providercall doen (upload, her-indexeren).
  if p_dryrun then
    return jsonb_build_object('uitkomst','nieuw','toegestaan',true,
      'dryrun',true,'config_versie',v_versie);
  end if;

  -- 3j. Reserveren. Twee rijen, één transactie: de levenscyclus en het
  --     onaantastbare verbruiksfeit.
  insert into public.ai_actie (
    idempotentie_sleutel, verzoek_vingerafdruk, actietype,
    fonds_id, gebruiker_id, verloopt_op
  ) values (
    p_idempotentie, p_vingerafdruk, p_actietype,
    p_fonds_id, p_gebruiker_id, now() + make_interval(secs => v_spec.lease_seconden)
  )
  returning id into v_actie_id;

  insert into public.ai_verbruik_log (
    maand, actie_id, actietype, fonds_id, gebruiker_id,
    provider, model, ai_acties, ocr_paginas
  ) values (
    v_maand, v_actie_id, p_actietype, p_fonds_id, p_gebruiker_id,
    p_provider, p_model, v_spec.ai_acties, v_ocr
  );

  return jsonb_build_object('uitkomst','nieuw','toegestaan',true,
    'actie_id',v_actie_id,'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_reserveer_intern(text,uuid,uuid,boolean,text,text,integer,text,text,boolean) is
  'Atomaire AI-preflight en reservering (besluit 0180). Serialiseert met een advisory lock, '
  'ruimt verlopen acties op, toetst idempotentie, kill switches, modelallowlist en de vier '
  'maandquota, en schrijft één ai_actie + één ai_verbruik_log-regel. Fail-closed op elk '
  'onbekend of ontbrekend gegeven. NIET rechtstreeks aanroepbaar: alleen via fn_ai_preflight '
  'of fn_ai_preflight_systeem, die de identiteit zelf vaststellen.';

-- Door NIEMAND rechtstreeks aanroepbaar; de wrappers draaien als owner.
revoke all on function public.fn_ai_reserveer_intern(text,uuid,uuid,boolean,text,text,integer,text,text,boolean)
  from public, anon, authenticated, service_role;

-- ── 4. Wrapper voor de tenant-surface ───────────────────────────────────────
--  Gebruiker uit auth.uid(), fonds uit profielen. De client levert NOOIT een
--  user_id of fonds_id — dezelfde borging als schrijf_ai_interactie en
--  fn_schrijf_vergelijking.
create or replace function public.fn_ai_preflight(
  p_actietype    text,
  p_provider     text default null,
  p_model        text default null,
  p_ocr_paginas  integer default 0,
  p_idempotentie text default null,
  p_vingerafdruk text default null,
  p_dryrun       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  select p.fonds_id into v_fonds from public.profielen p where p.id = v_uid;
  if v_fonds is null then
    raise exception 'geen_fonds_voor_gebruiker' using errcode = 'P0002';
  end if;

  return public.fn_ai_reserveer_intern(
    p_actietype, v_fonds, v_uid, false,
    p_provider, p_model, p_ocr_paginas, p_idempotentie, p_vingerafdruk, p_dryrun
  );
end;
$$;

comment on function public.fn_ai_preflight(text,text,text,integer,text,text,boolean) is
  'AI-preflight voor de tenant-surface (besluit 0180). Gebruiker uit auth.uid(), fonds uit '
  'profielen — beide server-side, niet spoofbaar. SECURITY DEFINER omdat de app-surface geen '
  'service-role heeft (besluit 0066). EXECUTE ontzegd aan public/anon, teruggegeven aan authenticated.';

revoke all on function public.fn_ai_preflight(text,text,text,integer,text,text,boolean) from public, anon;
grant execute on function public.fn_ai_preflight(text,text,text,integer,text,text,boolean) to authenticated;

-- ── 5. Wrapper voor cron, worker en AQLab ───────────────────────────────────
--  Hier IS geen sessie. Het fonds komt van de job-rij, niet van een gebruiker.
--  Alleen service_role, en alleen voor actietypes die expliciet `via_systeem`
--  zijn — anders zou dit pad het gebruikersquotum kunnen omzeilen.
create or replace function public.fn_ai_preflight_systeem(
  p_actietype    text,
  p_fonds_id     uuid default null,
  p_provider     text default null,
  p_model        text default null,
  p_ocr_paginas  integer default 0,
  p_idempotentie text default null,
  p_vingerafdruk text default null,
  p_dryrun       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.fn_ai_reserveer_intern(
    p_actietype, p_fonds_id, null, true,
    p_provider, p_model, p_ocr_paginas, p_idempotentie, p_vingerafdruk, p_dryrun
  );
end;
$$;

comment on function public.fn_ai_preflight_systeem(text,uuid,text,text,integer,text,text,boolean) is
  'AI-preflight voor achtergrondwerk zonder sessie (ingest-worker, generieke curatie, AQLab). '
  'Alleen service_role; alleen actietypes die expliciet via_systeem zijn. Reserveert zonder '
  'gebruiker, dus telt voor fonds en globaal (of alleen globaal bij een platformbreed type).';

revoke all on function public.fn_ai_preflight_systeem(text,uuid,text,text,integer,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.fn_ai_preflight_systeem(text,uuid,text,text,integer,text,text,boolean)
  to service_role;

-- ── 6. Actie afronden ───────────────────────────────────────────────────────
--  Zet de levenscyclus op voltooid of mislukt. Het VERBRUIK verandert hier
--  niet: dat is al geboekt en blijft meetellen, ook als de providercall faalde.
create or replace function public.fn_ai_actie_afronden(
  p_actie_id      uuid,
  p_status        text,
  p_resultaat_ref text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if p_status not in ('voltooid','mislukt') then
    raise exception 'ai_actie_afronden: ongeldige status %', p_status using errcode = '22023';
  end if;

  update public.ai_actie a
     set status = p_status,
         resultaat_ref = coalesce(p_resultaat_ref, a.resultaat_ref)
   where a.id = p_actie_id
     and a.status = 'in_uitvoering'
     -- Een sessie mag uitsluitend haar EIGEN actie afronden. Zonder sessie
     -- (service-role, worker) geldt die beperking niet; dat pad is al
     -- afgeschermd door de executegrant.
     and (v_uid is null or a.gebruiker_id = v_uid);

  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

comment on function public.fn_ai_actie_afronden(uuid,text,text) is
  'Sluit een AI-actie af (voltooid/mislukt). Raakt het verbruikslog NIET: een geaccepteerde '
  'reservering blijft conservatief meetellen ook als de providercall faalde. Een gebruikerssessie '
  'kan alleen de eigen actie afronden.';

revoke all on function public.fn_ai_actie_afronden(uuid,text,text) from public, anon;
grant execute on function public.fn_ai_actie_afronden(uuid,text,text) to authenticated, service_role;

-- ── 7. De poort — LIVE, vlak vóór iedere providercall ───────────────────────
--  Bewust GEEN snapshot en GEEN cache. Reeds verzonden calls worden niet
--  afgebroken, maar iedere nog niet gestarte call moet de ACTUELE stand zien;
--  anders zou een stop pas werken bij het volgende verzoek. Read-only, geen
--  lock: enkelvoudige indexreads op twee kleine tabellen.
create or replace function public.fn_ai_poort_check(
  p_provider text,
  p_model    text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_switch text;
  v_regel  record;
  v_versie bigint;
begin
  select versie into v_versie from public.ai_config_versie where id = 1;
  if v_versie is null then
    return jsonb_build_object('toegestaan',false,'reden','config_ontbreekt');
  end if;

  select status into v_switch from public.ai_kill_switch where sleutel = 'globaal';
  if v_switch is distinct from 'actief' then
    return jsonb_build_object('toegestaan',false,'reden','globaal_gestopt','config_versie',v_versie);
  end if;

  select status into v_switch from public.ai_kill_switch where sleutel = p_provider;
  if v_switch is null or v_switch <> 'actief' then
    return jsonb_build_object('toegestaan',false,'reden','provider_gestopt','config_versie',v_versie);
  end if;

  if p_model is not null then
    select * into v_regel from public.ai_model_allowlist
     where provider = p_provider and model = p_model;
    if not found or not v_regel.actief then
      return jsonb_build_object('toegestaan',false,'reden','model_niet_toegestaan','config_versie',v_versie);
    end if;
    if v_regel.venster_start is not null
       and (now() < v_regel.venster_start or now() >= v_regel.venster_eind) then
      return jsonb_build_object('toegestaan',false,'reden','model_buiten_venster','config_versie',v_versie);
    end if;
  end if;

  return jsonb_build_object('toegestaan',true,'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_poort_check(text,text) is
  'LIVE poortcontrole vlak vóór iedere providercall (besluit 0180): globale switch, '
  'providerswitch en modelallowlist inclusief tijdelijk venster. Bewust zonder cache — '
  'een stop moet de eerstvolgende call raken, niet pas het volgende verzoek.';

revoke all on function public.fn_ai_poort_check(text,text) from public, anon;
grant execute on function public.fn_ai_poort_check(text,text) to authenticated, service_role;

-- ── 8. Beheertransities ─────────────────────────────────────────────────────
--  Elk één transactie. Elk vergrendelt de schakelaarrij met `select ... for
--  update`, zodat twee gelijktijdige beheerhandelingen elkaar niet kruisen.
--  Elk hoogt ai_config_versie op.
--
--  De ACTOR wordt meegegeven, niet afgeleid: op de beheer-surface is er geen
--  auth.uid() (service-role). Dat is aanvaardbaar omdat deze functies UITSLUITEND
--  voor service_role uitvoerbaar zijn en service_role alleen achter
--  withPlatform() bestaat — dáár is de identiteit al met live AAL2 en een
--  capabilitycheck vastgesteld. Wat de DB zelf afdwingt is het vier-ogenprincipe.

create or replace function public.fn_ai_switch_stoppen(
  p_sleutel text,
  p_actor   uuid,
  p_reden   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_switch record;
  v_verzoek record;
  v_versie bigint;
begin
  if length(btrim(coalesce(p_reden,''))) < 10 then
    raise exception 'stop vereist een reden van minimaal 10 tekens' using errcode = '22023';
  end if;

  select * into v_switch from public.ai_kill_switch where sleutel = p_sleutel for update;
  if not found then
    raise exception 'onbekende schakelaar %', p_sleutel using errcode = 'P0002';
  end if;

  -- Een stop annuleert een openstaand heractiveringsverzoek (FR-3). Dat gebeurt
  -- in DEZELFDE transactie: anders zou een goedkeuring ertussen kunnen glippen.
  if v_switch.open_verzoek_id is not null then
    select * into v_verzoek from public.ai_heractivering_verzoek where id = v_switch.open_verzoek_id;
    insert into public.ai_heractivering_besluit
      (verzoek_id, aangevraagd_door, besluit, besloten_door, besluit_reden)
    values (v_verzoek.id, v_verzoek.aangevraagd_door, 'vervallen', p_actor,
            'Vervallen door een nieuwe stop.');
  end if;

  update public.ai_kill_switch
     set status = 'gestopt', open_verzoek_id = null, reden = p_reden,
         gewijzigd_op = now(), gewijzigd_door = p_actor
   where sleutel = p_sleutel;

  v_versie := public.fn_ai_bump_config_versie();
  return jsonb_build_object('sleutel',p_sleutel,'status','gestopt',
    'vorige_status',v_switch.status,'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_switch_stoppen(text,uuid,text) is
  'Stopt een AI-kill-switch. Onmiddellijk effectief; annuleert in dezelfde transactie een '
  'openstaand heractiveringsverzoek. Verplichte reden. Hoogt ai_config_versie op.';

revoke all on function public.fn_ai_switch_stoppen(text,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_ai_switch_stoppen(text,uuid,text) to service_role;

create or replace function public.fn_ai_heractivering_aanvragen(
  p_sleutel text,
  p_actor   uuid,
  p_reden   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_switch  record;
  v_versie  bigint;
  v_verzoek uuid;
begin
  if length(btrim(coalesce(p_reden,''))) < 10 then
    raise exception 'een heractiveringsverzoek vereist een reden van minimaal 10 tekens'
      using errcode = '22023';
  end if;

  select * into v_switch from public.ai_kill_switch where sleutel = p_sleutel for update;
  if not found then
    raise exception 'onbekende schakelaar %', p_sleutel using errcode = 'P0002';
  end if;
  if v_switch.status <> 'gestopt' then
    raise exception 'schakelaar % staat op %, een verzoek kan alleen vanuit gestopt',
      p_sleutel, v_switch.status using errcode = '22023';
  end if;

  -- EERST ophogen, DAN de stand vastleggen. Zou het verzoek de waarde van vóór
  -- zijn eigen ophoging bewaren, dan maakte het zijn eigen compare-and-swap
  -- onmiddellijk ongeldig en kon niemand het ooit goedkeuren.
  v_versie := public.fn_ai_bump_config_versie();

  insert into public.ai_heractivering_verzoek
    (sleutel, aangevraagd_door, reden, config_versie_bij_aanvraag)
  values (p_sleutel, p_actor, p_reden, v_versie)
  returning id into v_verzoek;

  update public.ai_kill_switch
     set status = 'heractivering_aangevraagd', open_verzoek_id = v_verzoek,
         gewijzigd_op = now(), gewijzigd_door = p_actor
   where sleutel = p_sleutel;

  return jsonb_build_object('sleutel',p_sleutel,'status','heractivering_aangevraagd',
    'verzoek_id',v_verzoek,'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_heractivering_aanvragen(text,uuid,text) is
  'Vraagt heractivering aan. De schakelaar blijft NIET-ACTIEF tot een tweede beheerder '
  'goedkeurt. Legt de configuratieversie ná de eigen ophoging vast, zodat het verzoek zijn '
  'eigen compare-and-swap niet ongeldig maakt.';

revoke all on function public.fn_ai_heractivering_aanvragen(text,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_ai_heractivering_aanvragen(text,uuid,text) to service_role;

create or replace function public.fn_ai_heractivering_goedkeuren(
  p_sleutel text,
  p_actor   uuid,
  p_reden   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_switch  record;
  v_verzoek record;
  v_huidig  bigint;
  v_versie  bigint;
begin
  select * into v_switch from public.ai_kill_switch where sleutel = p_sleutel for update;
  if not found then
    raise exception 'onbekende schakelaar %', p_sleutel using errcode = 'P0002';
  end if;
  if v_switch.status <> 'heractivering_aangevraagd' or v_switch.open_verzoek_id is null then
    raise exception 'geen openstaand heractiveringsverzoek voor %', p_sleutel using errcode = '22023';
  end if;

  select * into v_verzoek from public.ai_heractivering_verzoek where id = v_switch.open_verzoek_id;

  -- Compare-and-swap op de ALGEMENE configuratieversie. Is er sinds de aanvraag
  -- ook maar iets aan de AI-configuratie gewijzigd — een nieuwe stop, een
  -- quotumwijziging of een allowlistwijziging — dan is de aanvraag beoordeeld
  -- op een andere werkelijkheid en mag hij niet activeren.
  select versie into v_huidig from public.ai_config_versie where id = 1;
  if v_huidig is distinct from v_verzoek.config_versie_bij_aanvraag then
    raise exception 'configuratie is gewijzigd sinds de aanvraag (verwacht %, is %); vraag opnieuw aan',
      v_verzoek.config_versie_bij_aanvraag, v_huidig using errcode = '40001';
  end if;

  -- Zelfgoedkeuring wordt hier én door chk_ahb_geen_self_approval geweigerd. De
  -- CHECK is de echte waarborg: die geldt ook buiten deze functie om.
  insert into public.ai_heractivering_besluit
    (verzoek_id, aangevraagd_door, besluit, besloten_door, besluit_reden)
  values (v_verzoek.id, v_verzoek.aangevraagd_door, 'goedgekeurd', p_actor, p_reden);

  update public.ai_kill_switch
     set status = 'actief', open_verzoek_id = null, reden = null,
         gewijzigd_op = now(), gewijzigd_door = p_actor
   where sleutel = p_sleutel;

  v_versie := public.fn_ai_bump_config_versie();
  return jsonb_build_object('sleutel',p_sleutel,'status','actief',
    'verzoek_id',v_verzoek.id,'aangevraagd_door',v_verzoek.aangevraagd_door,
    'goedgekeurd_door',p_actor,'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_heractivering_goedkeuren(text,uuid,text) is
  'Keurt een heractiveringsverzoek goed en zet de schakelaar op actief. Vereist een ANDERE '
  'beheerder dan de aanvrager (chk_ahb_geen_self_approval) en een onveranderde '
  'ai_config_versie sinds de aanvraag.';

revoke all on function public.fn_ai_heractivering_goedkeuren(text,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_ai_heractivering_goedkeuren(text,uuid,text) to service_role;

create or replace function public.fn_ai_heractivering_afwijzen(
  p_sleutel text,
  p_actor   uuid,
  p_reden   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_switch  record;
  v_verzoek record;
  v_versie  bigint;
begin
  select * into v_switch from public.ai_kill_switch where sleutel = p_sleutel for update;
  if not found or v_switch.status <> 'heractivering_aangevraagd' or v_switch.open_verzoek_id is null then
    raise exception 'geen openstaand heractiveringsverzoek voor %', p_sleutel using errcode = '22023';
  end if;

  select * into v_verzoek from public.ai_heractivering_verzoek where id = v_switch.open_verzoek_id;

  insert into public.ai_heractivering_besluit
    (verzoek_id, aangevraagd_door, besluit, besloten_door, besluit_reden)
  values (v_verzoek.id, v_verzoek.aangevraagd_door, 'afgewezen', p_actor, p_reden);

  -- Afwijzen laat de schakelaar GESTOPT; de oorspronkelijke stopreden blijft staan.
  update public.ai_kill_switch
     set status = 'gestopt', open_verzoek_id = null,
         gewijzigd_op = now(), gewijzigd_door = p_actor
   where sleutel = p_sleutel;

  v_versie := public.fn_ai_bump_config_versie();
  return jsonb_build_object('sleutel',p_sleutel,'status','gestopt',
    'verzoek_id',v_verzoek.id,'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_heractivering_afwijzen(text,uuid,text) is
  'Wijst een heractiveringsverzoek af. De schakelaar blijft gestopt met de oorspronkelijke reden.';

revoke all on function public.fn_ai_heractivering_afwijzen(text,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_ai_heractivering_afwijzen(text,uuid,text) to service_role;

create or replace function public.fn_ai_heractivering_intrekken(
  p_sleutel text,
  p_actor   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_switch  record;
  v_verzoek record;
  v_versie  bigint;
begin
  select * into v_switch from public.ai_kill_switch where sleutel = p_sleutel for update;
  if not found or v_switch.status <> 'heractivering_aangevraagd' or v_switch.open_verzoek_id is null then
    raise exception 'geen openstaand heractiveringsverzoek voor %', p_sleutel using errcode = '22023';
  end if;

  select * into v_verzoek from public.ai_heractivering_verzoek where id = v_switch.open_verzoek_id;

  -- Alleen de AANVRAGER trekt zijn eigen verzoek in. Een ander die er vanaf wil,
  -- wijst het af — dat is een besluit en hoort als zodanig in het spoor.
  if v_verzoek.aangevraagd_door <> p_actor then
    raise exception 'alleen de aanvrager kan het eigen verzoek intrekken' using errcode = '42501';
  end if;

  insert into public.ai_heractivering_besluit
    (verzoek_id, aangevraagd_door, besluit, besloten_door, besluit_reden)
  values (v_verzoek.id, v_verzoek.aangevraagd_door, 'ingetrokken', p_actor,
          'Ingetrokken door de aanvrager.');

  update public.ai_kill_switch
     set status = 'gestopt', open_verzoek_id = null,
         gewijzigd_op = now(), gewijzigd_door = p_actor
   where sleutel = p_sleutel;

  v_versie := public.fn_ai_bump_config_versie();
  return jsonb_build_object('sleutel',p_sleutel,'status','gestopt',
    'verzoek_id',v_verzoek.id,'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_heractivering_intrekken(text,uuid) is
  'Trekt een eigen heractiveringsverzoek in. Uitsluitend door de aanvrager zelf; dat is geen '
  'privilege-escalatie en valt daarom buiten het vier-ogenverbod.';

revoke all on function public.fn_ai_heractivering_intrekken(text,uuid) from public, anon, authenticated;
grant execute on function public.fn_ai_heractivering_intrekken(text,uuid) to service_role;

-- ── 9. Configuratiemutaties ─────────────────────────────────────────────────
--  Ook deze lopen via één transactionele RPC met eigen validatie en ophoging van
--  ai_config_versie — anders zou een quotum- of allowlistwijziging onzichtbaar
--  blijven voor de compare-and-swap bij goedkeuring.

create or replace function public.fn_ai_quota_wijzigen(
  p_sleutel text,
  p_waarde  integer,
  p_actor   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oud    integer;
  v_versie bigint;
begin
  if p_sleutel not in ('gebruiker_maand','fonds_maand','globaal_maand','ocr_fonds_maand') then
    raise exception 'onbekende quotumsleutel %', p_sleutel using errcode = '22023';
  end if;
  if p_waarde is null or p_waarde < 0 then
    raise exception 'quotum moet nul of hoger zijn' using errcode = '22023';
  end if;
  -- Bovengrens als typefout-vangnet: een quotum van tien miljoen is in deze
  -- context geen bedoelde instelling maar een misplaatste nul.
  if p_waarde > 1000000 then
    raise exception 'quotum % is onrealistisch hoog; controleer de invoer', p_waarde
      using errcode = '22023';
  end if;

  select waarde into v_oud from public.ai_quota_config where sleutel = p_sleutel;

  insert into public.ai_quota_config (sleutel, waarde, bijgewerkt, bijgewerkt_door)
  values (p_sleutel, p_waarde, now(), p_actor)
  on conflict (sleutel) do update
    set waarde = excluded.waarde, bijgewerkt = now(), bijgewerkt_door = excluded.bijgewerkt_door;

  v_versie := public.fn_ai_bump_config_versie();
  return jsonb_build_object('sleutel',p_sleutel,'oud',v_oud,'nieuw',p_waarde,
    'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_quota_wijzigen(text,integer,uuid) is
  'Wijzigt één maandquotum in één transactie, met validatie en ophoging van ai_config_versie.';

revoke all on function public.fn_ai_quota_wijzigen(text,integer,uuid) from public, anon, authenticated;
grant execute on function public.fn_ai_quota_wijzigen(text,integer,uuid) to service_role;

create or replace function public.fn_ai_allowlist_wijzigen(
  p_provider      text,
  p_model         text,
  p_actief        boolean,
  p_venster_start timestamptz default null,
  p_venster_eind  timestamptz default null,
  p_reden         text default null,
  p_actor         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_versie bigint;
begin
  if p_provider not in ('anthropic','mistral','openai') then
    raise exception 'onbekende provider %', p_provider using errcode = '22023';
  end if;
  if p_model is null or length(btrim(p_model)) = 0 then
    raise exception 'model ontbreekt' using errcode = '22023';
  end if;
  -- Een venster is heel of niet; de tabel-CHECK dekt dit ook af, maar een
  -- leesbare fout hier is beter dan een constraintviolatie in de UI.
  if (p_venster_start is null) <> (p_venster_eind is null) then
    raise exception 'een tijdelijk venster vereist zowel een begin- als een eindtijd'
      using errcode = '22023';
  end if;
  if p_venster_start is not null and p_venster_eind <= p_venster_start then
    raise exception 'de eindtijd van het venster moet na de begintijd liggen' using errcode = '22023';
  end if;
  if p_venster_start is not null and length(btrim(coalesce(p_reden,''))) < 10 then
    raise exception 'een tijdelijk venster vereist een reden van minimaal 10 tekens'
      using errcode = '22023';
  end if;

  insert into public.ai_model_allowlist
    (provider, model, actief, venster_start, venster_eind, reden, bijgewerkt, bijgewerkt_door)
  values (p_provider, p_model, p_actief, p_venster_start, p_venster_eind, p_reden, now(), p_actor)
  on conflict (provider, model) do update
    set actief = excluded.actief,
        venster_start = excluded.venster_start,
        venster_eind = excluded.venster_eind,
        reden = excluded.reden,
        bijgewerkt = now(),
        bijgewerkt_door = excluded.bijgewerkt_door;

  v_versie := public.fn_ai_bump_config_versie();
  return jsonb_build_object('provider',p_provider,'model',p_model,'actief',p_actief,
    'config_versie',v_versie);
end;
$$;

comment on function public.fn_ai_allowlist_wijzigen(text,text,boolean,timestamptz,timestamptz,text,uuid) is
  'Wijzigt één regel in de modelallowlist in één transactie. Een tijdelijk AQLab-venster vereist '
  'begin- én eindtijd plus een reden; na de eindtijd vervalt de toestemming vanzelf.';

revoke all on function public.fn_ai_allowlist_wijzigen(text,text,boolean,timestamptz,timestamptz,text,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_ai_allowlist_wijzigen(text,text,boolean,timestamptz,timestamptz,text,uuid)
  to service_role;

-- ── 10. Fail-closed verificatie ─────────────────────────────────────────────
do $$
declare
  v_naam   text;
  v_functies text[] := array[
    'fn_ai_actietype_spec','fn_ai_bump_config_versie','fn_ai_reserveer_intern',
    'fn_ai_preflight','fn_ai_preflight_systeem','fn_ai_actie_afronden','fn_ai_poort_check',
    'fn_ai_switch_stoppen','fn_ai_heractivering_aanvragen','fn_ai_heractivering_goedkeuren',
    'fn_ai_heractivering_afwijzen','fn_ai_heractivering_intrekken',
    'fn_ai_quota_wijzigen','fn_ai_allowlist_wijzigen'
  ];
  fouten text := '';
  r record;
begin
  foreach v_naam in array v_functies loop
    if not exists (
      select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = v_naam
    ) then
      raise exception 'AI-RPC-MIGRATIE FAALT: functie % ontbreekt', v_naam;
    end if;
  end loop;

  -- Gate E: elke SECURITY DEFINER-functie heeft een vast search_path.
  -- LET OP: toets op p.oid, niet op een uit pg_get_function_identity_arguments
  -- opgebouwde signatuurstring — die bevat ook de PARAMETERNAMEN en is daarmee
  -- geen geldige typesignatuur voor has_function_privilege.
  for r in
    select p.oid, p.proname, p.proconfig, p.prosecdef
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = any(v_functies)
  loop
    if not r.prosecdef then
      fouten := fouten || format('  - %s is geen SECURITY DEFINER%s', r.proname, chr(10));
    end if;
    if r.proconfig is null or not exists (
      select 1 from unnest(r.proconfig) c where c like 'search_path=%'
    ) then
      fouten := fouten || format('  - %s mist een vast search_path (gate E)%s', r.proname, chr(10));
    end if;

    -- Gate H: anon mag NERGENS EXECUTE hebben.
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      fouten := fouten || format('  - anon kan %s uitvoeren (gate H)%s', r.proname, chr(10));
    end if;
  end loop;

  -- De kern mag door NIEMAND rechtstreeks worden aangeroepen.
  if has_function_privilege('authenticated',
       'public.fn_ai_reserveer_intern(text,uuid,uuid,boolean,text,text,integer,text,text,boolean)', 'EXECUTE')
     or has_function_privilege('service_role',
       'public.fn_ai_reserveer_intern(text,uuid,uuid,boolean,text,text,integer,text,text,boolean)', 'EXECUTE') then
    fouten := fouten || '  - fn_ai_reserveer_intern is rechtstreeks aanroepbaar (moet alleen via de wrappers)' || chr(10);
  end if;

  -- De systeemwrapper mag NIET vanuit een tenantsessie bereikbaar zijn.
  if has_function_privilege('authenticated',
       'public.fn_ai_preflight_systeem(text,uuid,text,text,integer,text,text,boolean)', 'EXECUTE') then
    fouten := fouten || '  - authenticated kan fn_ai_preflight_systeem aanroepen (fonds_id zou spoofbaar worden)' || chr(10);
  end if;

  -- De beheertransities mogen NIET vanuit een tenantsessie bereikbaar zijn.
  if has_function_privilege('authenticated', 'public.fn_ai_switch_stoppen(text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_ai_heractivering_goedkeuren(text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_ai_quota_wijzigen(text,integer,uuid)', 'EXECUTE') then
    fouten := fouten || '  - een beheer-RPC is vanuit een tenantsessie aanroepbaar' || chr(10);
  end if;

  -- Positieve controle: de tenantroute MOET bij de preflight en de poort kunnen.
  if not has_function_privilege('authenticated',
       'public.fn_ai_preflight(text,text,text,integer,text,text,boolean)', 'EXECUTE') then
    fouten := fouten || '  - authenticated kan fn_ai_preflight NIET aanroepen (elke AI-route zou stukgaan)' || chr(10);
  end if;
  if not has_function_privilege('authenticated', 'public.fn_ai_poort_check(text,text)', 'EXECUTE') then
    fouten := fouten || '  - authenticated kan fn_ai_poort_check NIET aanroepen' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'AI-RPC-MIGRATIE FAALT:\n%', fouten;
  end if;

  raise notice 'AI-RPC OK: 14 functies, search_path vast, anon nergens, kern afgeschermd, wrappers bereikbaar.';
end $$;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
--
-- 1. Gate E — vast search_path op elke definer-functie (verwacht: geen rijen):
--    select p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
--     where ns.nspname='public' and p.proname like 'fn\_ai\_%' and p.prosecdef
--       and (p.proconfig is null or not exists (
--             select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
--
-- 2. Gate H — anon nergens EXECUTE (verwacht: geen rijen):
--    select p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
--     where ns.nspname='public' and p.proname like 'fn\_ai\_%'
--       and has_function_privilege('anon', p.oid, 'EXECUTE');
--
-- 3. Gedragssuite: supabase/checks/2026_08_16_ai_begrenzing.sql
-- 4. Structurele gates A–H: supabase/checks/2026_07_31_r1_structurele_gates.sql
-- ============================================================================
