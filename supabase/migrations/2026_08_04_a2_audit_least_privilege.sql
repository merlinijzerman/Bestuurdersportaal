-- ============================================================================
-- Migratie 2026-08-04 (A2) — least-privilege audittoegang + transactionele
--                            verwijdering
-- ----------------------------------------------------------------------------
-- WAAROM. Twee dingen die elkaar in de weg zitten.
--
--  1. `governance_log` is via policy "fonds log" (`for all`) FONDSBREED leesbaar.
--     Elke beheerder leest de vragen van elke collega. Dat is geen rolmodel maar
--     de afwezigheid ervan, en het blokkeert een tweede fonds.
--  2. Een gebruiker kan zijn gesprek niet verwijderen. `archiveerGesprek()` zet
--     alleen een vlag; de inhoud blijft in het append-only spoor staan.
--
-- WAT DEZE MIGRATIE DOET.
--  • Capabilities op het auditspoor (deny-by-default), met een inzagelog.
--  • Een definer-view die metadata projecteert op twee niveaus: basis (geen
--    bron-ID's) en bron (wél). Rij-RLS kan geen kolommen afschermen; een
--    projectie wel — zelfde patroon en zelfde risico als vw_fondsleden
--    (besluit 0102, migratie 2026_08_02_fondsleden_view.sql).
--  • `verwijder_gesprek()`: één transactie, idempotent op request_id, met een
--    redactieregel als tegenhanger. Het auditSPOOR blijft staan; alleen de
--    INHOUD verdwijnt. Er wordt nergens een UPDATE op governance_log gedaan —
--    dat zou de append-only trigger raken.
--  • `schrijf_ai_interactie()`: één transactie voor spoor + inhoud, met het
--    fonds en de gebruiker server-side bepaald in plaats van uit de request.
--
-- TENANT-ISOLATIE IS ONGEWIJZIGD. Het fonds-scope-predicaat blijft precies wat
-- het was; er komt uitsluitend een gebruikersgebonden predicaat bovenop.
--
-- GRANT-HYGIËNE. `revoke ... from public` is op Supabase aantoonbaar NIET genoeg:
-- de default-ACL kent EXECUTE expliciet aan `anon` toe, niet via PUBLIC
-- (bevinding H-18, migratie 2026_07_31_r7_execute_grants_anon.sql). Elke functie
-- hieronder — ook de pure jsonb-helpers — krijgt daarom
-- `revoke all on function ... from public, anon` en daarna een gerichte grant.
-- Gate H van 2026_07_31_r1_structurele_gates.sql is de detectie.
--
-- Idempotent (create or replace, if not exists, drop policy/trigger if exists).
-- Transactioneel, met een fail-closed verificatieblok aan het eind.
-- ROLLBACK: 2026_08_04_a2_audit_least_privilege_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- ══ 1. Redactielog ═════════════════════════════════════════════════════════
-- Tegenhanger van elke verwijdering: WAT is verwijderd, door wie, waarom en
-- hoeveel regels. Zelf append-only — anders verplaatst het probleem zich alleen.

create table if not exists public.governance_redacties (
  id              uuid primary key default gen_random_uuid(),
  fonds_id        uuid not null references public.fondsen(id),
  uitgevoerd_door uuid references auth.users(id),
  uitgevoerd_op   timestamptz not null default now(),
  -- Uniek: maakt de verwijder-RPC idempotent bij een herhaalde of gelijktijdige
  -- aanroep (netwerkretry, dubbelklik).
  request_id      uuid not null unique,
  aanleiding      text not null
                  check (aanleiding in ('gesprek_verwijderd','retentie',
                                        'betrokkenenverzoek','beheerinterventie')),
  aantal_regels   int  not null default 0,
  -- Alleen scope-aanduiding (welk gesprek, welke periode); NOOIT inhoud.
  scope           jsonb not null default '{}'::jsonb,
  motivering      text,
  constraint motivering_bij_interventie
    check (aanleiding <> 'beheerinterventie' or motivering is not null)
);

comment on table public.governance_redacties is
  'Append-only tegenhanger van elke verwijdering van chatinhoud. Legt vast DAT '
  'er is verwijderd, door wie en met welke aanleiding — nooit WAT er stond.';

alter table public.governance_redacties enable row level security;

drop trigger if exists trg_redacties_no_update on public.governance_redacties;
create trigger trg_redacties_no_update before update on public.governance_redacties
  for each row execute function public.fn_log_append_only();
drop trigger if exists trg_redacties_no_delete on public.governance_redacties;
create trigger trg_redacties_no_delete before delete on public.governance_redacties
  for each row execute function public.fn_log_append_only();

-- ══ 2. Auditcapabilities ═══════════════════════════════════════════════════
-- DENY-BY-DEFAULT: RLS aan, GEEN ENKELE POLICY. Lezen gebeurt uitsluitend
-- binnen de definer-helpers hieronder. Toekennen gebeurt binnen dit ticket via
-- een gedocumenteerde SQL-stap door de databank-eigenaar (geen beheer-UI);
-- zie de verificatiesectie onderaan.

create table if not exists public.governance_audit_grants (
  gebruiker_id   uuid not null references auth.users(id) on delete cascade,
  fonds_id       uuid not null references public.fondsen(id) on delete cascade,
  capability     text not null
                 check (capability in ('governance_audit_read',
                                       'governance_audit_read_sources',
                                       'governance_redacties_read')),
  toegekend_door uuid,
  toegekend_op   timestamptz not null default now(),
  geldig_van     timestamptz,
  geldig_tot     timestamptz,
  motivering     text,
  primary key (gebruiker_id, fonds_id, capability)
);

comment on table public.governance_audit_grants is
  'Deny-by-default: RLS staat aan en er is BEWUST geen policy. Uitsluitend '
  'leesbaar binnen mag_audit()/mag_audit_bronnen()/mag_audit_redacties().';

alter table public.governance_audit_grants enable row level security;

-- Inzagelog: elke keer dat iemand ANDERMANS auditmetadata opvraagt.
create table if not exists public.governance_audit_inzage (
  id           uuid primary key default gen_random_uuid(),
  gebruiker_id uuid not null references auth.users(id),
  fonds_id     uuid not null references public.fondsen(id),
  tijdstip     timestamptz not null default now(),
  scope        jsonb not null default '{}'::jsonb,   -- filter/periode; nooit inhoud
  bronniveau   boolean not null default false,
  motivering   text,
  constraint motivering_bij_bronniveau
    check (bronniveau = false or motivering is not null)
);

alter table public.governance_audit_inzage enable row level security;

drop trigger if exists trg_audit_inzage_no_update on public.governance_audit_inzage;
create trigger trg_audit_inzage_no_update before update on public.governance_audit_inzage
  for each row execute function public.fn_log_append_only();
drop trigger if exists trg_audit_inzage_no_delete on public.governance_audit_inzage;
create trigger trg_audit_inzage_no_delete before delete on public.governance_audit_inzage
  for each row execute function public.fn_log_append_only();

-- ── Expliciete tabelgrants ─────────────────────────────────────────────────
-- Zie de toelichting in migratie A1: R6 kon de supabase_admin-default-ACL niet
-- dichtzetten, dus een nieuwe tabel kan opnieuw INSERT voor anon en TRUNCATE
-- meekrijgen. TRUNCATE valt buiten RLS — Postgres evalueert daarbij geen enkele
-- policy — en maakt "auditdata is niet manipuleerbaar" onhoudbaar.
revoke all on public.governance_redacties      from anon;
revoke all on public.governance_audit_grants   from anon;
revoke all on public.governance_audit_inzage   from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.governance_redacties    from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.governance_audit_inzage from authenticated;
-- governance_audit_grants is deny-by-default: authenticated krijgt zelfs geen
-- SELECT. Lezen gebeurt uitsluitend binnen de definer-helpers hieronder.
revoke all on public.governance_audit_grants from authenticated;
grant select on public.governance_redacties    to authenticated;
grant select on public.governance_audit_inzage to authenticated;

-- ══ 3. Capability-helpers ══════════════════════════════════════════════════
-- `security definer` omdat governance_audit_grants deny-by-default is: de
-- aanroeper mag zijn eigen grants niet eens lezen. `stable`, vaste search_path.

create or replace function public.mag_audit(p_fonds uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.governance_audit_grants g
     where g.gebruiker_id = auth.uid()
       and g.fonds_id     = p_fonds
       and g.capability   = 'governance_audit_read'
       and now() between coalesce(g.geldig_van, '-infinity'::timestamptz)
                     and coalesce(g.geldig_tot,  'infinity'::timestamptz)
  );
$$;

create or replace function public.mag_audit_bronnen(p_fonds uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.governance_audit_grants g
     where g.gebruiker_id = auth.uid()
       and g.fonds_id     = p_fonds
       and g.capability   = 'governance_audit_read_sources'
       and now() between coalesce(g.geldig_van, '-infinity'::timestamptz)
                     and coalesce(g.geldig_tot,  'infinity'::timestamptz)
  );
$$;

create or replace function public.mag_audit_redacties(p_fonds uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.governance_audit_grants g
     where g.gebruiker_id = auth.uid()
       and g.fonds_id     = p_fonds
       and g.capability   = 'governance_redacties_read'
       and now() between coalesce(g.geldig_van, '-infinity'::timestamptz)
                     and coalesce(g.geldig_tot,  'infinity'::timestamptz)
  );
$$;

revoke all on function public.mag_audit(uuid)          from public, anon;
revoke all on function public.mag_audit_bronnen(uuid)  from public, anon;
revoke all on function public.mag_audit_redacties(uuid) from public, anon;
grant execute on function public.mag_audit(uuid)           to authenticated;
grant execute on function public.mag_audit_bronnen(uuid)   to authenticated;
grant execute on function public.mag_audit_redacties(uuid) to authenticated;

-- ══ 4. Metadata-projectie ══════════════════════════════════════════════════
-- SPIEGEL VAN core/lib/audit-meta.ts. Wijzig nooit één van beide alleen; de
-- sanitytest core/lib/audit-meta.sanity.ts en structurele check 6 in
-- supabase/checks/2026_08_04_a_rollen_capabilities.sql bewaken de gelijkenis.
--
-- ALLOWLIST, GEEN STRIPLIJST. Rijen van vóór plateau A zijn nooit door de
-- schrijfkant gegaan: die dragen `zoekvraag`, `sources[].fragment` en
-- `scope.titels` gewoon in retrieval_meta. Een striplijst kent de sleutels van
-- gisteren niet; een allowlist laat alles wat zij niet kent vanzelf vallen. Dit
-- is daarom de ENIGE bescherming voor historische rijen.

create or replace function public.meta_projectie(p_meta jsonb, p_bron boolean)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  -- Operationele telemetrie: geen inhoud, geen bronidentiteit.
  c_basis constant text[] := array[
    'methode','opgehaald','geselecteerd','embedding_query_success','fallback_reason',
    'rerank','drempel','zwakke_bronbasis','parent',
    'toegepaste_fonds_filter','namespace_conventie','fondsdiscipline_gedropt',
    'body_fonds_id_genegeerd',
    'antwoordmodus','transformatie','bronbasis','inline_meldingen','citaties',
    'source_summary',
    'bron_intent','bron_vertrouwen','bron_modus_auto','alleen_fondsdocumenten',
    'bron_intent_override','bron_intent_bron','bron_intent_herkomst',
    'portaalstand_gebruikt',
    'profielsturing','profielsturing_aspecten','organisatieprofiel',
    'organisatieprofiel_aspecten',
    'startvraag_bron','niet_vastgesteld','verduidelijking','geen_modelcall',
    'context_geneutraliseerd','gereformuleerd',
    'duur_ms','duur_model_ms','tokens','tokendekking',
    'scope','invoer','filters','web','markeringen'
  ];
  -- BronIDENTITEIT (welk document, welke versie) — geen letterlijke tekst.
  c_bron constant text[] := array[
    'chunks','bronversie_audit','besluitbronnen','mogelijk_gerelateerd',
    'doorgrond','herkomst'
  ];
  v_toegestaan text[];
  v_uit jsonb;
  v_deel jsonb;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    return '{}'::jsonb;
  end if;

  v_toegestaan := case when p_bron then c_basis || c_bron else c_basis end;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_uit
    from jsonb_each(p_meta) e
   where e.key = any(v_toegestaan);

  -- Gemengde objecten: subsleutels van een hoger niveau alsnog verwijderen.
  -- Spiegel van SUB_NIVEAUS in core/lib/audit-meta.ts.
  if v_uit ? 'scope' and jsonb_typeof(v_uit->'scope') = 'object' then
    v_deel := (v_uit->'scope') - 'titels';            -- titels = documenttitels
    if not p_bron then v_deel := v_deel - 'document_ids'; end if;
    v_uit := jsonb_set(v_uit, '{scope}', v_deel);
  end if;

  if v_uit ? 'invoer' and jsonb_typeof(v_uit->'invoer') = 'object' then
    -- historie_hash is een vingerafdruk van de gespreksinhoud
    v_uit := jsonb_set(v_uit, '{invoer}', (v_uit->'invoer') - 'historie_hash');
  end if;

  if v_uit ? 'filters' and jsonb_typeof(v_uit->'filters') = 'object' then
    v_deel := v_uit->'filters';
    if not p_bron then v_deel := v_deel - 'procesinstantie_ids'; end if;
    v_uit := jsonb_set(v_uit, '{filters}', v_deel);
  end if;

  if v_uit ? 'web' and jsonb_typeof(v_uit->'web') = 'object' then
    v_deel := v_uit->'web';
    if not p_bron then
      v_deel := v_deel - 'gebruikte_bronnen' - 'bevraagde_domeinen';
    end if;
    v_uit := jsonb_set(v_uit, '{web}', v_deel);
  end if;

  if v_uit ? 'markeringen' and jsonb_typeof(v_uit->'markeringen') = 'object' then
    v_deel := v_uit->'markeringen';
    if not p_bron then v_deel := v_deel - 'instanties'; end if;
    v_uit := jsonb_set(v_uit, '{markeringen}', v_deel);
  end if;

  return v_uit;
end;
$$;

create or replace function public.meta_basisniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_projectie(p_meta, false);
$$;

create or replace function public.meta_bronniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_projectie(p_meta, true);
$$;

revoke all on function public.meta_projectie(jsonb, boolean) from public, anon;
revoke all on function public.meta_basisniveau(jsonb)        from public, anon;
revoke all on function public.meta_bronniveau(jsonb)         from public, anon;
grant execute on function public.meta_projectie(jsonb, boolean) to authenticated;
grant execute on function public.meta_basisniveau(jsonb)        to authenticated;
grant execute on function public.meta_bronniveau(jsonb)         to authenticated;

-- ══ 5. RLS op de nieuwe tabellen ═══════════════════════════════════════════

drop policy if exists "redacties lezen" on public.governance_redacties;
create policy "redacties lezen" on public.governance_redacties
  for select using (
    uitgevoerd_door = auth.uid()
    or public.mag_audit_redacties(fonds_id)
  );
-- Geen insert/update/delete-policy: schrijven uitsluitend via de definer-RPC.

drop policy if exists "eigen inzage lezen" on public.governance_audit_inzage;
create policy "eigen inzage lezen" on public.governance_audit_inzage
  for select using (
    gebruiker_id = auth.uid()
    or public.mag_audit_redacties(fonds_id)
  );

-- ══ 6. Herziene RLS op governance_log ══════════════════════════════════════
-- Van fondsbreed `for all` naar: lezen door de auteur óf een capabilityhouder;
-- schrijven alleen als jezelf, in je eigen fonds. Geen update/delete-policy —
-- de append-only triggers blijven als tweede laag staan.
--
-- ⚠ REGRESSIEPUNT. Dit raakt élke lezer van governance_log. De inventarisatie:
--    • app/(dashboard)/governance/page.tsx — beheerder, fondsbreed → gaat via
--      lees_governance_audit() en ziet zonder capability alleen eigen regels.
--    • app/(dashboard)/page.tsx — eigen regels ("recente vragen") → ongewijzigd
--      zichtbaar, maar leest `vraag` voortaan uit governance_log_inhoud.
--    • platform/lib/monitoring-health.ts + monitoring-queries.ts — service-role,
--      dus buiten RLS om. Ongemoeid. Wél afhankelijk van de allowlist: hun
--      sleutels moeten op basisniveau blijven (core/lib/audit-meta.sanity.ts).

drop policy if exists "fonds log" on public.governance_log;

drop policy if exists "eigen auditregels lezen" on public.governance_log;
create policy "eigen auditregels lezen" on public.governance_log
  for select using (
    gebruiker_id = auth.uid()
    or public.mag_audit(fonds_id)
  );

-- Aangescherpt t.o.v. de oude "fonds log": naast het fonds nu ook de auteur.
-- Het reguliere schrijfpad loopt via schrijf_ai_interactie() (definer, omzeilt
-- RLS); deze policy is defense-in-depth voor een eventueel direct pad.
drop policy if exists "auditregels schrijven eigen fonds" on public.governance_log;
create policy "auditregels schrijven eigen fonds" on public.governance_log
  for insert with check (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- ══ 7. `gesprekken`: `for all` splitsen, DELETE intrekken ═══════════════════
-- Verwijderen mag alleen nog via verwijder_gesprek(), zodat er altijd een
-- redactieregel tegenover staat en de inhoud in dezelfde transactie meegaat.

drop policy if exists "eigen gesprekken" on public.gesprekken;

drop policy if exists "eigen gesprekken lezen" on public.gesprekken;
create policy "eigen gesprekken lezen" on public.gesprekken
  for select using (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "eigen gesprekken aanmaken" on public.gesprekken;
create policy "eigen gesprekken aanmaken" on public.gesprekken
  for insert with check (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "eigen gesprekken bijwerken" on public.gesprekken;
create policy "eigen gesprekken bijwerken" on public.gesprekken
  for update using (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- BEWUST GEEN DELETE-POLICY. Zie public.verwijder_gesprek().

-- ══ 8. Auditweergave: definer-view + RPC ═══════════════════════════════════
-- Rij-RLS kan geen kolommen afschermen, een projectie wel. Zelfde patroon als
-- vw_fondsleden (besluit 0102) — inclusief hetzelfde risico: omdat de view
-- definer-semantiek heeft en dus RLS omzeilt, MOET de WHERE de autorisatie
-- volledig reproduceren. Zonder sessie is auth.uid() null, valt beide takken
-- weg en levert de view nul rijen (fail-closed voor anon én service-role).
--
-- `gesprek_audit_id` staat er bewust NIET in: dat is een correlatie-ID voor de
-- verwijderfunctie, geen auditgegeven.

create or replace view public.vw_governance_audit
with (security_invoker = false) as
  select
    gl.id,
    gl.gebruiker_id,
    gl.gebruiker_naam,
    gl.fonds_id,
    gl.modus,
    gl.model,
    gl.aangemaakt,
    gl.inhoud_hmac,
    gl.hmac_schema_versie,
    gl.hmac_sleutel_versie,
    -- Maakt zichtbaar DAT inhoud is verwijderd (FR-12) zonder haar te ontsluiten.
    (gli.log_id is not null) as inhoud_aanwezig,
    case
      when gl.gebruiker_id = auth.uid() or public.mag_audit_bronnen(gl.fonds_id)
        then public.meta_bronniveau(gl.retrieval_meta)
      else public.meta_basisniveau(gl.retrieval_meta)
    end as retrieval_meta
  from public.governance_log gl
  left join public.governance_log_inhoud gli on gli.log_id = gl.id
  where gl.gebruiker_id = auth.uid()
     or public.mag_audit(gl.fonds_id);

comment on view public.vw_governance_audit is
  'Auditweergave van governance_log met metadata-projectie op twee niveaus. '
  'Definer-semantiek: de WHERE reproduceert de autorisatie volledig (zelfde '
  'constructie en zelfde risico als vw_fondsleden, besluit 0102). Bevat bewust '
  'GEEN gesprek_audit_id en geen vraag/antwoord/bronnen.';

-- GEEN GRANT AAN `authenticated`. De view is het typecontract en de projectie
-- voor lees_governance_audit(), geen leessurface op zichzelf.
--
-- Zou `authenticated` hem rechtstreeks mogen lezen, dan kon een houder van
-- `governance_audit_read_sources` het spoor van collega's opvragen ZONDER
-- inzageregel en ZONDER motivering — de view past de bronniveau-projectie
-- immers toe op basis van de capability alleen. Daarmee zou de belofte "elke
-- inzage in andermans metadata wordt vastgelegd" niet waar zijn. De definer-RPC
-- leest de view namens de aanroeper en is het enige pad.
revoke all on public.vw_governance_audit from public;
revoke all on public.vw_governance_audit from anon;
revoke all on public.vw_governance_audit from authenticated;

-- Een view kan niet schrijven, dus de inzagelogging hangt aan een RPC. De
-- governanceviewer bevraagt DEZE, niet de view.
-- BRONNIVEAU IS EEN EXPLICIET VERZOEK, GEEN AUTOMATISCH GEVOLG VAN DE
-- CAPABILITY. Zou de functie bronniveau geven zodra iemand `…_read_sources`
-- heeft, dan zou elke routineweergave een motivering afdwingen — en die zou de
-- applicatie invullen met een vaste zin. Dat maakt de motiveringsplicht een
-- formaliteit. Nu vraagt de aanroeper er bewust om (`p_bronniveau => true`) en
-- levert hij een echte reden; anders wordt de projectie teruggezet op
-- basisniveau. `meta_basisniveau()` is idempotent, dus een dubbele toepassing
-- is onschadelijk.
create or replace function public.lees_governance_audit(
  p_fonds      uuid,
  p_filters    jsonb   default '{}'::jsonb,
  p_motivering text    default null,
  p_limiet     int     default 50,
  p_bronniveau boolean default false
) returns setof public.vw_governance_audit
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bron   boolean;
  v_limiet int := least(greatest(coalesce(p_limiet, 50), 1), 500);
begin
  if auth.uid() is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  -- Zonder auditcapability: alleen de eigen regels, en géén inzageregel — je
  -- eigen spoor inzien is geen inzage in dat van een ander.
  if not public.mag_audit(p_fonds) then
    return query
      select * from public.vw_governance_audit v
       where v.gebruiker_id = auth.uid()
         and v.fonds_id = p_fonds
       order by v.aangemaakt desc
       limit v_limiet;
    return;
  end if;

  v_bron := coalesce(p_bronniveau, false) and public.mag_audit_bronnen(p_fonds);

  if v_bron and (p_motivering is null or length(btrim(p_motivering)) = 0) then
    raise exception 'motivering_verplicht_bij_bronniveau' using errcode = '22023';
  end if;

  insert into public.governance_audit_inzage
    (gebruiker_id, fonds_id, scope, bronniveau, motivering)
  values
    (auth.uid(), p_fonds, coalesce(p_filters, '{}'::jsonb), v_bron,
     case when v_bron then p_motivering else null end);

  return query
    select v.id, v.gebruiker_id, v.gebruiker_naam, v.fonds_id, v.modus, v.model,
           v.aangemaakt, v.inhoud_hmac, v.hmac_schema_versie, v.hmac_sleutel_versie,
           v.inhoud_aanwezig,
           -- Eigen regels houden hun volledige projectie; die van een ander
           -- zakken terug naar basisniveau tenzij bronniveau is gevraagd én
           -- toegekend.
           case
             when v_bron or v.gebruiker_id = auth.uid() then v.retrieval_meta
             else public.meta_basisniveau(v.retrieval_meta)
           end
      from public.vw_governance_audit v
     where v.fonds_id = p_fonds
     order by v.aangemaakt desc
     limit v_limiet;
end;
$$;

revoke all on function public.lees_governance_audit(uuid, jsonb, text, int, boolean)
  from public, anon;
grant execute on function public.lees_governance_audit(uuid, jsonb, text, int, boolean)
  to authenticated;

-- ══ 9. Schrijfpad: spoor + inhoud in één transactie ════════════════════════
-- Eén aanroeppunt in plaats van de twee losse inserts in chat/route.ts. Fonds,
-- gebruiker en weergavenaam worden SERVER-SIDE bepaald uit auth.uid(); ze zijn
-- geen parameter en dus niet te spoofen vanuit de request (het probleem waar
-- core/lib/audit-fonds-guard.ts tegen beschermde, nu structureel opgelost).

create or replace function public.schrijf_ai_interactie(
  p_vraag                 text,
  p_antwoord              text    default null,
  p_bronnen               jsonb   default '[]'::jsonb,
  p_modus                 text    default 'documenten',
  p_model                 text    default null,
  p_retrieval_meta        jsonb   default '{}'::jsonb,
  p_retrieval_meta_inhoud jsonb   default '{}'::jsonb,
  p_gesprek_audit_id      uuid    default null,
  p_inhoud_hmac           text    default null,
  p_hmac_schema_versie    smallint default null,
  p_hmac_sleutel_versie   smallint default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
  v_naam  text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;
  if p_vraag is null or length(btrim(p_vraag)) = 0 then
    raise exception 'vraag_leeg' using errcode = '22023';
  end if;

  select p.fonds_id, coalesce(p.naam, u.email)
    into v_fonds, v_naam
    from public.profielen p
    join auth.users u on u.id = p.id
   where p.id = v_uid;

  if v_fonds is null then
    raise exception 'geen_fonds_voor_gebruiker' using errcode = 'P0002';
  end if;

  insert into public.governance_log (
    gebruiker_id, gebruiker_naam, fonds_id, modus, model, retrieval_meta,
    gesprek_audit_id, inhoud_hmac, hmac_schema_versie, hmac_sleutel_versie
  ) values (
    v_uid, v_naam, v_fonds, p_modus, p_model, coalesce(p_retrieval_meta, '{}'::jsonb),
    p_gesprek_audit_id, p_inhoud_hmac, p_hmac_schema_versie, p_hmac_sleutel_versie
  ) returning id into v_id;

  insert into public.governance_log_inhoud (
    log_id, vraag, antwoord, bronnen, retrieval_meta_inhoud
  ) values (
    v_id, p_vraag, p_antwoord, coalesce(p_bronnen, '[]'::jsonb),
    coalesce(p_retrieval_meta_inhoud, '{}'::jsonb)
  );

  return v_id;
end;
$$;

revoke all on function public.schrijf_ai_interactie(
  text, text, jsonb, text, text, jsonb, jsonb, uuid, text, smallint, smallint
) from public, anon;
grant execute on function public.schrijf_ai_interactie(
  text, text, jsonb, text, text, jsonb, jsonb, uuid, text, smallint, smallint
) to authenticated;

-- ══ 10. Verwijderen ════════════════════════════════════════════════════════
-- Eén transactie: inhoud weg, gesprek weg, redactieregel erbij. Het auditSPOOR
-- blijft ongemoeid — er wordt nergens een UPDATE op governance_log gedaan, dus
-- de append-only trigger komt niet in beeld en `gesprek_audit_id` blijft staan.

create or replace function public.verwijder_gesprek(
  p_gesprek_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_eigenaar uuid;
  v_fonds    uuid;
  v_aantal   int  := 0;
  v_bestaand jsonb;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;
  if p_gesprek_id is null or p_request_id is null then
    raise exception 'ongeldige_parameters' using errcode = '22023';
  end if;

  -- Serialiseer op request_id: twee gelijktijdige aanroepen met hetzelfde id
  -- leveren één redactieregel (AC-8). De unieke constraint is het vangnet, deze
  -- lock voorkomt dat de tweede aanroep überhaupt werk doet.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select jsonb_build_object('status', 'reeds_uitgevoerd', 'aantal_regels', r.aantal_regels)
    into v_bestaand
    from public.governance_redacties r
   where r.request_id = p_request_id;
  if v_bestaand is not null then
    return v_bestaand;                            -- idempotent
  end if;

  select g.gebruiker_id, g.fonds_id
    into v_eigenaar, v_fonds
    from public.gesprekken g
   where g.id = p_gesprek_id
     for update;                                  -- row lock

  if not found then
    raise exception 'gesprek_niet_gevonden' using errcode = 'P0002';
  end if;
  -- Eigenaarschap uit de RIJ, niet uit de request.
  if v_eigenaar is distinct from v_uid then
    raise exception 'geen_eigenaar' using errcode = '42501';
  end if;

  with te_verwijderen as (
    select gl.id
      from public.governance_log gl
     where gl.gesprek_audit_id = p_gesprek_id
       and gl.gebruiker_id     = v_uid
  )
  delete from public.governance_log_inhoud gli
   using te_verwijderen t
   where gli.log_id = t.id;
  get diagnostics v_aantal = row_count;

  -- Cascade ruimt alles op wat aan het gesprek hangt.
  delete from public.gesprekken where id = p_gesprek_id;

  insert into public.governance_redacties
    (fonds_id, uitgevoerd_door, request_id, aanleiding, aantal_regels, scope)
  values
    (v_fonds, v_uid, p_request_id, 'gesprek_verwijderd', v_aantal,
     jsonb_build_object('gesprek_audit_id', p_gesprek_id));

  return jsonb_build_object('status', 'verwijderd', 'aantal_regels', v_aantal);
end;
$$;

revoke all on function public.verwijder_gesprek(uuid, uuid) from public, anon;
grant execute on function public.verwijder_gesprek(uuid, uuid) to authenticated;

-- ══ 11. Fail-closed verificatie binnen dezelfde transactie ═════════════════
do $$
declare
  v_fouten text := '';
  v_n int;
begin
  -- De inhoudstabel mag GEEN append-only trigger hebben.
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.governance_log_inhoud'::regclass and not tgisinternal;
  if v_n <> 0 then
    v_fouten := v_fouten || format('  - governance_log_inhoud heeft %s trigger(s); moet 0 zijn'||chr(10), v_n);
  end if;

  -- De redactie- en inzagelogs moeten er twee hebben.
  if (select count(*) from pg_trigger
       where tgrelid = 'public.governance_redacties'::regclass and not tgisinternal) <> 2 then
    v_fouten := v_fouten || '  - governance_redacties mist append-only triggers'||chr(10);
  end if;
  if (select count(*) from pg_trigger
       where tgrelid = 'public.governance_audit_inzage'::regclass and not tgisinternal) <> 2 then
    v_fouten := v_fouten || '  - governance_audit_inzage mist append-only triggers'||chr(10);
  end if;

  -- Deny-by-default op de grants-tabel.
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='governance_audit_grants') <> 0 then
    v_fouten := v_fouten || '  - governance_audit_grants heeft een policy; moet deny-by-default zijn'||chr(10);
  end if;

  -- Geen DELETE-policy op gesprekken.
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='gesprekken' and cmd in ('DELETE','ALL')) <> 0 then
    v_fouten := v_fouten || '  - gesprekken heeft nog een DELETE- of ALL-policy'||chr(10);
  end if;

  -- De oude fondsbrede policy is weg.
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='governance_log' and policyname='fonds log') <> 0 then
    v_fouten := v_fouten || '  - policy "fonds log" bestaat nog op governance_log'||chr(10);
  end if;

  -- Alle nieuwe definer-functies hebben een vaste search_path (gate E).
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('mag_audit','mag_audit_bronnen','mag_audit_redacties',
                         'lees_governance_audit','schrijf_ai_interactie','verwijder_gesprek')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                        where c like 'search_path=%')
  ) then
    v_fouten := v_fouten || '  - een nieuwe SECURITY DEFINER-functie mist search_path'||chr(10);
  end if;

  -- De auditview is geen directe leessurface: alleen de definer-RPC leest hem,
  -- anders is inzage zonder inzageregel mogelijk.
  if has_table_privilege('authenticated', 'public.vw_governance_audit', 'SELECT')
     or has_table_privilege('anon', 'public.vw_governance_audit', 'SELECT') then
    v_fouten := v_fouten || '  - vw_governance_audit is direct leesbaar; inzage kan de logging omzeilen'||chr(10);
  end if;

  -- Geen EXECUTE voor anon op de nieuwe functies (gate H).
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('mag_audit','mag_audit_bronnen','mag_audit_redacties',
                         'meta_projectie','meta_basisniveau','meta_bronniveau',
                         'lees_governance_audit','schrijf_ai_interactie','verwijder_gesprek')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    v_fouten := v_fouten || '  - anon heeft EXECUTE op een nieuwe functie (bevinding H-18)'||chr(10);
  end if;

  if v_fouten <> '' then
    raise exception E'A2-VERIFICATIE GEFAALD:\n%', v_fouten;
  end if;
  raise notice 'A2 OK: capabilities, projectie, view en RPC''s staan; append-only en deny-by-default intact.';
end $$;

commit;

-- ══ Auditcapability toekennen (gedocumenteerde SQL-stap) ═══════════════════
-- Binnen dit ticket is er BEWUST geen beheer-UI: deny-by-default blijft en een
-- grant is een expliciete, gemotiveerde handeling van de databank-eigenaar.
-- Zonder grant ziet ook een beheerder uitsluitend zijn eigen auditregels — dat
-- is het beoogde gedrag, geen storing.
--
--   insert into public.governance_audit_grants
--     (gebruiker_id, fonds_id, capability, toegekend_door, geldig_tot, motivering)
--   values
--     ('<uuid van de auditor>', '<fonds uuid>', 'governance_audit_read',
--      '<uuid van wie toekent>', now() + interval '90 days',
--      'Jaarlijkse controle op AI-gebruik, opdracht bestuur dd. …');
--
-- Bronniveau (bron-ID's, herkomst, objectreferenties) is een APARTE capability
-- en verplicht bij elke bevraging een motivering:
--     … 'governance_audit_read_sources' …
--
-- Intrekken: geldig_tot in het verleden zetten kan niet (append-only geldt hier
-- niet, maar traceerbaarheid wel) — verwijder de rij en leg de intrekking vast
-- in het besluitregister.
--
-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. De auditview is GEEN directe leessurface — als tenant-gebruiker:
--      select * from public.vw_governance_audit;          → permission denied
--    (dat is correct: alle toegang loopt via de RPC, zodat inzage wordt gelogd)
-- 2. Als tenant-gebruiker zonder auditgrant:
--      select count(*) from public.lees_governance_audit('<fonds uuid>');
--    → alleen de eigen regels, en géén nieuwe rij in governance_audit_inzage.
-- 3. Structurele gates + rol-/capabilitytestset:
--      psql … -f supabase/checks/2026_07_31_r1_structurele_gates.sql
--      psql … -f supabase/checks/2026_08_04_a_rollen_capabilities.sql
