-- ============================================================================
--  2026_08_05_t2_bureau_stukvoorbereiding.sql
--  T2 (plateau A) — bureau-stand: Word-export-logging + B-6-markering + de
--  audit-allowlist-spiegeling voor retrieval_meta.bureau.
-- ----------------------------------------------------------------------------
--  Idempotent en transactioneel. Vier wijzigingen, elk met een eigen reden:
--
--   1. `documenten.ai_ondersteund_voorbereid` — de B-6-markering (besluit T2/B-6):
--      een zelfverklaarde vlag dat een stuk AI-ondersteund is voorbereid, zodat
--      het bestuur op de agendapuntkaart ziet wát het beoordeelt (ontwerp §7.7).
--
--   2. `meta_projectie()` — `bureau` toevoegen aan de BRON-allowlist. Dit is de
--      SQL-spiegel van core/lib/audit-meta.ts (META_BRON). Zonder deze wijziging
--      zou de leesprojectie de nieuwe sleutel op basisniveau tonen of (voor oude
--      rijen) juist niet — beide fout. Wijzig deze lijst NOOIT los van audit-meta.ts.
--
--   3. `governance_export_log` — een APARTE, append-only logtabel voor
--      Word-exports (besluit B-4/G16). Bewust niet in `governance_log`: een export
--      is geen vraag/antwoord-interactie, en meeliften zou de interactie- en
--      P5-telemetrie vervuilen. Geen documenttekst — die staat al in het
--      interactielog.
--
--   4. `log_word_export()` — de enige schrijfweg naar (3). SECURITY DEFINER,
--      gebruiker/fonds server-side uit auth.uid() (niet spoofbaar), met een
--      rol-backstop: alleen `bestuursbureau` mag loggen. Dat spiegelt de
--      capability-mapping (ai.stukvoorbereiding hangt uitsluitend aan die rol);
--      wijzigt die mapping, dan MOET deze check mee (zie capabilities.ts).
--
--  Handhavingsklasse: (1) klasse D, (3)+(4) klasse H (RLS + definer + append-only).
-- ============================================================================

begin;

-- ── 1. B-6 — markering op documenten ────────────────────────────────────────
alter table public.documenten
  add column if not exists ai_ondersteund_voorbereid boolean not null default false;

comment on column public.documenten.ai_ondersteund_voorbereid is
  'T2/B-6 — zelfverklaarde markering dat dit stuk AI-ondersteund is voorbereid '
  '(bureau-stand). Zichtbaar voor het bestuur op de agendapuntkaart. Zetten valt '
  'onder documents.metadata.update; het is een herkomstmarkering, geen besluit.';

-- ── 2. meta_projectie() — `bureau` in de BRON-allowlist (spiegel audit-meta.ts) ─
-- Volledige herdefinitie (create or replace): identiek aan 2026_08_04_a2, met als
-- ENIGE inhoudelijke wijziging 'bureau' toegevoegd aan c_bron.
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
  -- T2: 'bureau' toegevoegd (taak/stuksoort/secties/bronbereik/promptvariant/
  -- rol_context — identiteit, geen documenttekst).
  c_bron constant text[] := array[
    'chunks','bronversie_audit','besluitbronnen','mogelijk_gerelateerd',
    'doorgrond','bureau','herkomst'
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

revoke all on function public.meta_projectie(jsonb, boolean) from public, anon;
grant execute on function public.meta_projectie(jsonb, boolean) to authenticated;

-- ── 3. Append-only export-log ───────────────────────────────────────────────
create table if not exists public.governance_export_log (
  id                uuid primary key default uuid_generate_v4(),
  gebruiker_id      uuid references auth.users(id),
  gebruiker_naam    text,
  fonds_id          uuid references public.fondsen(id),
  -- correlatie met het gesprek waaruit het concept kwam; geen FK (analoog aan
  -- governance_log.gesprek_audit_id, besluit 0120): de client mag verwijderen
  -- zonder het exportspoor te breken.
  gesprek_audit_id  uuid,
  taak              text not null default 'stukvoorbereiding',
  stuksoort         text,
  promptvariant     text,
  -- bronidentiteit (document_id/titel/vindplaats), GEEN documenttekst (B-4).
  bronnen           jsonb not null default '[]',
  aangemaakt        timestamptz default now()
);

create index if not exists idx_export_fonds on public.governance_export_log(fonds_id);
create index if not exists idx_export_tijd  on public.governance_export_log(aangemaakt desc);

alter table public.governance_export_log enable row level security;

-- Append-only: blokkeer UPDATE en DELETE voor ALLE rollen (huispatroon).
create or replace function public.fn_export_log_immutable()
returns trigger language plpgsql as $f$
begin
  raise exception 'governance_export_log is append-only';
end;
$f$;

drop trigger if exists trg_export_log_no_update on public.governance_export_log;
create trigger trg_export_log_no_update
  before update on public.governance_export_log
  for each row execute procedure public.fn_export_log_immutable();

drop trigger if exists trg_export_log_no_delete on public.governance_export_log;
create trigger trg_export_log_no_delete
  before delete on public.governance_export_log
  for each row execute procedure public.fn_export_log_immutable();

-- GEEN insert/update/delete-policy: schrijven kan uitsluitend via de definer-RPC
-- log_word_export() hieronder. Lezen: eigen fonds én de audit-leescapability,
-- exact zoals governance_log (hergebruikt de bestaande definer-helper mag_audit).
drop policy if exists "export log select" on public.governance_export_log;
create policy "export log select" on public.governance_export_log
  for select using (public.mag_audit(fonds_id));

revoke all on public.governance_export_log from public, anon;
grant select on public.governance_export_log to authenticated;

-- ── 4. log_word_export() — de enige schrijfweg ──────────────────────────────
-- SECURITY DEFINER: gebruiker/fonds/naam server-side uit auth.uid(), niet
-- spoofbaar. Rol-backstop: alleen `bestuursbureau` mag loggen (defense in depth
-- náást de route-gate rolHeeftCapability('ai.stukvoorbereiding')). Deze rol-check
-- SPIEGELT de capability-mapping in core/lib/capabilities.ts — verandert die
-- mapping, dan MOET deze functie mee.
create or replace function public.log_word_export(
  p_gesprek_audit_id uuid  default null,
  p_stuksoort        text  default null,
  p_promptvariant    text  default null,
  p_bronnen          jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
  v_naam  text;
  v_rol   text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  select p.fonds_id, coalesce(p.naam, u.email), p.rol
    into v_fonds, v_naam, v_rol
    from public.profielen p
    join auth.users u on u.id = p.id
   where p.id = v_uid;

  if v_fonds is null then
    raise exception 'geen_fonds_voor_gebruiker' using errcode = 'P0002';
  end if;

  -- Backstop: spiegelt ROL_CAPABILITIES (ai.stukvoorbereiding → bestuursbureau).
  if v_rol is distinct from 'bestuursbureau' then
    raise exception 'geen_stukvoorbereiding' using errcode = '42501';
  end if;

  insert into public.governance_export_log (
    gebruiker_id, gebruiker_naam, fonds_id, gesprek_audit_id,
    taak, stuksoort, promptvariant, bronnen
  ) values (
    v_uid, v_naam, v_fonds, p_gesprek_audit_id,
    'stukvoorbereiding', p_stuksoort, p_promptvariant,
    coalesce(p_bronnen, '[]'::jsonb)
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_word_export(uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_word_export(uuid, text, text, jsonb) to authenticated;

-- ── Fail-closed verificatie binnen dezelfde transactie ──────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='documenten'
       and column_name='ai_ondersteund_voorbereid'
  ) then
    raise exception 'T2-verificatie: documenten.ai_ondersteund_voorbereid ontbreekt';
  end if;

  if not exists (
    select 1 from pg_class where relname='governance_export_log' and relnamespace='public'::regnamespace
  ) then
    raise exception 'T2-verificatie: governance_export_log ontbreekt';
  end if;

  if has_function_privilege('anon', 'public.log_word_export(uuid, text, text, jsonb)', 'EXECUTE') then
    raise exception 'T2-verificatie: anon heeft EXECUTE op log_word_export (H-18)';
  end if;

  -- meta_projectie moet `bureau` nu als bron-sleutel behouden.
  if (public.meta_bronniveau('{"bureau":{"taak":"stukvoorbereiding"}}'::jsonb)) -> 'bureau' is null then
    raise exception 'T2-verificatie: bureau valt uit de bron-allowlist van meta_projectie';
  end if;
  if (public.meta_basisniveau('{"bureau":{"taak":"stukvoorbereiding"}}'::jsonb)) ? 'bureau' then
    raise exception 'T2-verificatie: bureau lekt naar het basisniveau (moet bron zijn)';
  end if;

  raise notice 'T2-verificatie: OK (kolom, export-log, definer-privilege, meta-allowlist).';
end $$;

commit;
