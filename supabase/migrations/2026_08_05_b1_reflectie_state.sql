-- ============================================================================
-- Migratie 2026-08-05 (B1) — server-controlled reflectiestatus + bevroren bronset
-- ----------------------------------------------------------------------------
-- WAAROM. Plateau B voegt een gespreksvorm toe waarin een bestuurder hardop
-- twijfelt. Vier gedragswijzigingen (G1-G4 in de chatlaag) hangen aan de vraag
-- "loopt er nu een reflectie?". Zou de client dat antwoord geven, dan kan hij
-- ook de bronset kiezen waarop de assistent zich baseert, de beurtteller
-- terugzetten, of een reflectie afronden die nooit is gevoerd.
--
-- WAAROM EEN APARTE TABEL EN GEEN KOLOM OP `gesprekken`. `gesprekken` wordt
-- client-side beschreven met de anon-key en de gebruiker heeft UPDATE-recht op
-- de eigen rij (policy "eigen gesprekken" is `for all`). RLS werkt op rij-niveau,
-- niet op kolom-niveau: een statuskolom dáár zou dus gewoon door de browser te
-- zetten zijn. Tabelrechten kunnen wél worden afgeschermd. Deze tabel krijgt
-- daarom UITSLUITEND een SELECT-policy; muteren kan alleen via
-- public.reflectie_transitie(). Zie besluit 0110 en acceptatiecriterium AC-18.
--
-- ⚠ GEEN REFLECTIEMARKERING, NERGENS (besluit 0112) ⚠
-- Deze tabel is de enige plek waar staat dát er gereflecteerd wordt, en dat is
-- bewust ingeperkt: auteur-only leesbaar, in geen enkele fondsbreed leesbare
-- projectie, en hij verdwijnt met het gesprek (cascade hieronder). Wie hier een
-- teller, een geschiedenis of een view "voor het inzicht" aan toevoegt, maakt
-- zichtbaar dat een specifieke bestuurder op een specifiek moment twijfelde over
-- een specifiek onderwerp. Dat is precies het chilling effect dat de functie zou
-- moeten wegnemen. Er komt ook GEEN waarde in `governance_log.modus` of in
-- `retrieval_meta`; de allowlist in core/lib/audit-meta.ts houdt dat fail-closed.
--
-- ⚠ GEEN APPEND-ONLY TRIGGER ⚠ Deze tabel MOET muteerbaar en verwijderbaar
-- zijn — een statusmachine die niet van status kan wisselen is geen
-- statusmachine. De mutatie loopt via de definer-functie; het auditspoor
-- (governance_log) blijft onaangeroerd append-only.
--
-- BRONSETHASH — AFWIJKING VAN HET TECHNISCH ONTWERP §6.2. Het TO schrijft een
-- hash over `document_id + ':' + versie_id + ':' + passage_id` plus
-- `document_scope_hash`. Die velden bestaan niet: er is geen versie-id, de
-- passage heet `chunks[].id`, en er is `scope.document_ids[]` in plaats van een
-- scope-hash. Bovendien is `sources[]` sinds plateau A geclassificeerd als
-- META_INHOUD en verhuisd naar governance_log_inhoud, dus de bronset kan er niet
-- uit worden afgeleid. Wat wél in het append-only spoor blijft is `chunks` en
-- `scope.document_ids` (beide META_BRON). De hash gebruikt die twee. Gespiegeld
-- in core/lib/bronset.ts en vastgepind in core/lib/bronset.sanity.ts.
--
-- `jsonb_exists(...)` in plaats van de `?`-operator: SQL-clients lezen `?` als
-- parameterplaceholder (les uit plateau A, OP-A8).
--
-- Idempotent (create ... if not exists, create or replace, drop policy if exists
-- + create). Transactioneel.
-- ROLLBACK: 2026_08_05_b1_reflectie_state_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- pgcrypto levert digest() voor de bronsethash. Staat er al sinds
-- 2026_05_07_decision_object.sql; deze regel is op Supabase dus een no-op.
--
-- LET OP: hij installeert de extensie NIET opnieuw in `public`. Op Supabase staat
-- pgcrypto in het schema `extensions`, en `if not exists` laat dat zo. Elke
-- functie met een gepinde search_path die `digest()` aanroept, moet `extensions`
-- daarin opnemen — zie de uitgebreide toelichting bij reflectie_bronset_hash().
create extension if not exists "pgcrypto";

-- ── 1. De flowstatus ────────────────────────────────────────────────────────
-- Eén rij per gesprek. `on delete cascade` op gesprek_id is de hele
-- implementatie van AC-24: verwijder_gesprek() doet een DELETE op `gesprekken`
-- en ruimt de flowstatus daarmee mee op, zonder dat die functie hoeft te weten
-- dat plateau B bestaat.

create table if not exists public.gesprek_reflectie_state (
  gesprek_id               uuid primary key
                           references public.gesprekken(id) on delete cascade,
  gebruiker_id             uuid not null references auth.users(id) on delete cascade,
  fonds_id                 uuid not null references public.fondsen(id),
  status                   text not null default 'niet_actief'
                           check (status in ('niet_actief','ingang_gekozen','verdieping_1',
                                             'verdieping_2','verdieping_3',
                                             'conceptweergave','afgerond')),
  ingang                   text
                           check (ingang is null or ingang in
                             ('informatie_ontbreekt','onderbouwing','uitvoeringsrisico',
                              'evenwichtigheid','alternatief','uitlegbaarheid',
                              'niet_te_plaatsen','overtuiging')),
  beurt                    smallint not null default 0 check (beurt >= 0 and beurt <= 3),
  -- Bewust GEEN foreign key naar governance_log: die logregel mag later
  -- inhoudloos zijn (de gebruiker verwijdert zijn inhoud), en een FK zou een
  -- afhankelijkheid leggen op iets wat mag verdwijnen. Zelfde redenering als bij
  -- governance_log.gesprek_audit_id (besluit 0120).
  bronset_log_id           uuid,
  reflectie_bronset_versie text,
  gestart_op               timestamptz,
  bijgewerkt_op            timestamptz not null default now()
);

comment on table public.gesprek_reflectie_state is
  'Server-controlled status van de reflectiedialoog (plateau B, besluit 0110). '
  'AUTEUR-ONLY leesbaar; muteren uitsluitend via public.reflectie_transitie(). '
  'Verdwijnt met het gesprek (cascade). Staat in geen enkele fondsbreed '
  'leesbare projectie — besluit 0112 verbiedt elke reflectiemarkering.';

comment on column public.gesprek_reflectie_state.reflectie_bronset_versie is
  'sha256 over de gesorteerde, ontdubbelde lijst <document_id>:<chunk_id> uit '
  'governance_log.retrieval_meta.chunks, plus "#" en de gesorteerde '
  'scope.document_ids. NULL = geen bronset; de assistent reflecteert dan '
  'uitsluitend op het antwoord en de woorden van de gebruiker (FR-55). '
  'Verlaat de privéchat nooit (FR-69) en is iets anders dan '
  'publicatie_bronset_versie uit plateau C. Spiegel: core/lib/bronset.ts.';

alter table public.gesprek_reflectie_state enable row level security;

-- RLS: uitsluitend SELECT, uitsluitend de eigenaar, binnen het eigen fonds.
--
-- De tabel heeft een eigen `fonds_id`, dus gate B van
-- 2026_07_31_r1_structurele_gates.sql is van toepassing (niet gate A): het
-- predicaat moet `fonds_id` tegen het profiel van de aanroeper binden. Dat doet
-- het. Er is bewust GEEN insert/update/delete-policy — dat is wat AC-18
-- afdwingbaar maakt.
drop policy if exists "eigen reflectiestatus lezen" on public.gesprek_reflectie_state;
create policy "eigen reflectiestatus lezen" on public.gesprek_reflectie_state
  for select using (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Expliciete tabelgrants in plaats van vertrouwen op de default-ACL. R6
-- (2026_07_31_r6_default_privileges.sql) zet die ACL in, maar kon de
-- supabase_admin-kant niet dichtzetten: een tabel die door DIE rol wordt
-- aangemaakt krijgt opnieuw de volledige grant, inclusief INSERT voor anon en
-- TRUNCATE — en TRUNCATE valt volledig buiten RLS. Gate F is de detectie;
-- dit is de preventie. Zelfde patroon als migratie A1.
revoke all on public.gesprek_reflectie_state from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.gesprek_reflectie_state from authenticated;
grant select on public.gesprek_reflectie_state to authenticated;

-- ── 2. Bronsethash — spiegel van core/lib/bronset.ts ────────────────────────
-- Apart en IMMUTABLE zodat hij zonder tabeltoegang toetsbaar is: de checksuite
-- kan hem direct aanroepen en tegen de TypeScript-pin leggen.
--
-- `collate "C"` is niet cosmetisch. De standaardcollatie van de database
-- sorteert taalkundig (en negeert daarbij leestekens), waardoor de volgorde zou
-- afwijken van Array.prototype.sort() in JavaScript — dat is codepoint-sortering.
-- Twee implementaties van dezelfde hash die anders sorteren, geven stil
-- verschillende hashes.
--
-- ⚠ `extensions` MOET in de search_path (hersteld 05-08-2026) ⚠
-- Op Supabase leeft `pgcrypto` in het schema `extensions`, niet in `public`.
-- Deze functie is de EERSTE in deze codebase die zowel een gepinde search_path
-- heeft (gate E) als `digest()` aanroept: de bestaande hash-triggers in
-- 2026_05_07_decision_object.sql en 2026_06_23_platform_fundament.sql pinnen hun
-- search_path helemaal niet en vinden `digest` daarom via de sessie-default, die
-- `extensions` wél bevat. Met alleen `public, pg_temp` faalt de functie op
--     ERROR 42883: function digest(text, unknown) does not exist
-- Vandaar `public, extensions, pg_temp`: nog steeds een gepinde search_path (gate
-- E blijft groen), maar mét het schema waar de extensie werkelijk staat. Werkt
-- ook wanneer pgcrypto wél in `public` is geïnstalleerd — dat schema staat er al
-- vóór. `pg_temp` blijft bewust als laatste, zodat een tijdelijk object niets kan
-- overschaduwen.

create or replace function public.reflectie_bronset_hash(p_retrieval_meta jsonb)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  with paren as (
    select distinct (c->>'document_id') || ':' || (c->>'id') as paar
      from jsonb_array_elements(
             case
               when jsonb_typeof(coalesce(p_retrieval_meta->'chunks', 'null'::jsonb)) = 'array'
               then p_retrieval_meta->'chunks'
               else '[]'::jsonb
             end
           ) as c
     where nullif(c->>'id', '') is not null
       and nullif(c->>'document_id', '') is not null
  ),
  scope as (
    select distinct s as doc_id
      from jsonb_array_elements_text(
             case
               when jsonb_typeof(coalesce(p_retrieval_meta#>'{scope,document_ids}', 'null'::jsonb)) = 'array'
               then p_retrieval_meta#>'{scope,document_ids}'
               else '[]'::jsonb
             end
           ) as s
     where nullif(s, '') is not null
  )
  select case
           when (select count(*) from paren) = 0 then null
           else encode(
                  digest(
                    coalesce((select string_agg(paar, '|' order by paar collate "C") from paren), '')
                    || '#' ||
                    coalesce((select string_agg(doc_id, ',' order by doc_id collate "C") from scope), ''),
                    'sha256'
                  ),
                  'hex'
                )
         end;
$$;

comment on function public.reflectie_bronset_hash(jsonb) is
  'Versiehash over de bevroren reflectiebronset. Gesorteerd en ontdubbeld, dus '
  'ongevoelig voor de rangorde waarin de retrieval de chunks teruggaf. NULL bij '
  'nul bruikbare chunks. Exact gespiegeld in core/lib/bronset.ts en vastgepind '
  'in core/lib/bronset.sanity.ts — wijkt een van beide af, dan is dat een bug.';

revoke all on function public.reflectie_bronset_hash(jsonb) from public, anon;
grant execute on function public.reflectie_bronset_hash(jsonb) to authenticated;

-- ── 3. De toestandsmachine ──────────────────────────────────────────────────
-- DE ENIGE schrijfweg naar gesprek_reflectie_state.
--
-- Hardening, één voor één (spiegel van verwijder_gesprek uit plateau A):
--   • vaste search_path                        → set search_path = public, pg_temp
--   • geen dynamische SQL                      → geen `execute` in de body
--   • EXECUTE ingetrokken van PUBLIC ÉN anon   → zie de revoke onderaan
--   • auth.uid() intern bepaald                → v_uid, geen parameter
--   • fonds uit de rij, niet van de client     → uit public.gesprekken
--   • concurrency                              → for update op de statusrij
--   • status opnieuw uitgelezen                → v_status uit de DB, nooit uit de body
--
-- FR-67: de gevraagde transitie wordt gevalideerd tegen de OPNIEUW UITGELEZEN
-- actuele status. Een clientwaarde is nooit leidend — de client geeft alleen een
-- ACTIE door, nooit een gewenste einddstatus.

create or replace function public.reflectie_transitie(
  p_gesprek_id     uuid,
  p_actie          text,
  p_ingang         text default null,
  p_bronset_log_id uuid default null
) returns public.gesprek_reflectie_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_eigenaar     uuid;
  v_fonds        uuid;
  v_status       text;
  v_beurt        smallint;
  v_bijgewerkt   timestamptz;
  v_nieuw_status text;
  v_nieuwe_beurt smallint;
  v_meta         jsonb;
  v_versie       text;
  v_bestaat      boolean;
  v_rij          public.gesprek_reflectie_state;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  if p_actie is null or p_actie not in ('start','antwoord','concept','afronden','afbreken') then
    raise exception 'ongeldige_actie' using errcode = '22023';
  end if;

  -- Eigenaarschap komt uit `gesprekken`, niet uit de parameters. Row lock zodat
  -- het gesprek niet onder de transitie vandaan verwijderd kan worden.
  select g.gebruiker_id, g.fonds_id into v_eigenaar, v_fonds
    from public.gesprekken g
   where g.id = p_gesprek_id
   for update;

  if not found then
    raise exception 'gesprek_niet_gevonden' using errcode = 'P0002';
  end if;
  if v_eigenaar is distinct from v_uid then
    raise exception 'geen_eigenaar' using errcode = '42501';
  end if;

  -- De actuele status, opnieuw uitgelezen en vergrendeld.
  select s.status, s.beurt, s.bijgewerkt_op
    into v_status, v_beurt, v_bijgewerkt
    from public.gesprek_reflectie_state s
   where s.gesprek_id = p_gesprek_id
   for update;

  v_bestaat := found;
  if not v_bestaat then
    v_status     := 'niet_actief';
    v_beurt      := 0;
    v_bijgewerkt := now();
  end if;

  -- Een gewone chatbeurt roept `afbreken` aan. Bestaat er nog geen statusrij,
  -- dan liep er ook geen reflectie: dan géén rij aanmaken. Anders zou elk
  -- gesprek waarin nooit is gereflecteerd tóch een rij in deze tabel krijgen —
  -- en dat is precies het soort registratie dat besluit 0112 wil vermijden.
  if p_actie = 'afbreken' and not v_bestaat then
    v_rij.gesprek_id    := p_gesprek_id;
    v_rij.gebruiker_id  := v_uid;
    v_rij.fonds_id      := v_fonds;
    v_rij.status        := 'niet_actief';
    v_rij.beurt         := 0;
    v_rij.bijgewerkt_op := now();
    return v_rij;
  end if;

  -- FAIL-SAFE (FR-57, TO §6.1). Een status die langer dan 24 uur stil heeft
  -- gelegen telt niet meer. Werkhypothese uit besluit 0122, gevalideerd in de
  -- gebruikerstoets. Liever een reflectie die opnieuw gestart moet worden dan
  -- een chat die morgen onverwacht in reflectiemodus staat.
  if v_status <> 'niet_actief' and v_bijgewerkt < now() - interval '24 hours' then
    v_status := 'niet_actief';
    v_beurt  := 0;
  end if;

  -- ── Transitietabel (TO §6.1 / v1.0 §9.4) ─────────────────────────────────
  -- Spiegel van core/lib/reflectie-flow.ts. Elke combinatie die hieronder niet
  -- voorkomt, valt door naar `ongeldige_transitie`.
  v_nieuwe_beurt := v_beurt;

  if p_actie = 'afbreken' then
    -- Kan vanuit elke status; ook vanuit `niet_actief` (dan is het een no-op).
    -- Wordt óók getriggerd door een gewone chatbeurt via de normale invoerbalk.
    v_nieuw_status := 'niet_actief';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'start' then
    if v_status <> 'niet_actief' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    if p_ingang is null or p_ingang not in
       ('informatie_ontbreekt','onderbouwing','uitvoeringsrisico','evenwichtigheid',
        'alternatief','uitlegbaarheid','niet_te_plaatsen','overtuiging') then
      raise exception 'ongeldige_ingang' using errcode = '22023';
    end if;
    v_nieuw_status := 'ingang_gekozen';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'antwoord' then
    -- ⚠ CORRECTIE OP TO §6.1. Het TO laat `verdieping_3 + antwoord` toe én zegt
    -- "bij beurt ≥ 3 verplicht conceptweergave". Die twee sluiten elkaar uit:
    -- omdat `beurt` het aantal gegeven antwoorden telt, zou `verdieping_3` dan
    -- onbereikbaar zijn. Opgelost door het beurtplafond leidend te maken — het
    -- derde antwoord landt in `verdieping_3`, een vierde bestaat niet. Netto
    -- maximaal drie verdiepingsantwoorden, precies zoals v1.0 §9.6 vraagt.
    -- Spiegel: core/lib/reflectie-flow.ts.
    if v_status not in ('ingang_gekozen','verdieping_1','verdieping_2') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    -- De beurtteller kan ALLEEN omhoog; de client levert hem niet aan.
    v_nieuwe_beurt := (v_beurt + 1)::smallint;
    if v_nieuwe_beurt > 3 then
      raise exception 'beurtplafond_bereikt' using errcode = '22023';
    end if;
    if v_status = 'ingang_gekozen' then
      v_nieuw_status := 'verdieping_1';
    elsif v_status = 'verdieping_1' then
      v_nieuw_status := 'verdieping_2';
    else
      v_nieuw_status := 'verdieping_3';
    end if;

  elsif p_actie = 'concept' then
    -- Zowel wanneer de assistent na beurt 1 of 2 al genoeg heeft, als wanneer
    -- het beurtplafond is bereikt. Verhoogt de beurt niet.
    if v_status not in ('verdieping_1','verdieping_2','verdieping_3') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'afronden' then
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'afgerond';
  end if;

  -- ── Bevroren bronset (B-4), uitsluitend bij `start` ───────────────────────
  -- De logregel moet van DEZE gebruiker én DIT gesprek zijn. Dat is wat "een
  -- willekeurige bronset kiezen" uit AC-18 onmogelijk maakt: een log-id uit een
  -- ander gesprek of van een andere gebruiker levert hier geen rij op.
  if p_actie = 'start' and p_bronset_log_id is not null then
    select gl.retrieval_meta into v_meta
      from public.governance_log gl
     where gl.id               = p_bronset_log_id
       and gl.gebruiker_id     = v_uid
       and gl.gesprek_audit_id = p_gesprek_id;

    if not found then
      raise exception 'bronset_niet_van_dit_gesprek' using errcode = '42501';
    end if;

    v_versie := public.reflectie_bronset_hash(coalesce(v_meta, '{}'::jsonb));
  end if;

  insert into public.gesprek_reflectie_state as s
    (gesprek_id, gebruiker_id, fonds_id, status, ingang, beurt,
     bronset_log_id, reflectie_bronset_versie, gestart_op, bijgewerkt_op)
  values
    (p_gesprek_id, v_uid, v_fonds, v_nieuw_status,
     case when p_actie = 'start' then p_ingang else null end,
     v_nieuwe_beurt,
     case when p_actie = 'start' then p_bronset_log_id else null end,
     case when p_actie = 'start' then v_versie else null end,
     case when p_actie = 'start' then now() else null end,
     now())
  on conflict (gesprek_id) do update
     set status                   = excluded.status,
         beurt                    = excluded.beurt,
         bijgewerkt_op            = now(),
         -- Ingang en bronset worden UITSLUITEND bij `start` gezet en bij
         -- `afbreken` gewist. Een vervolgactie kan ze niet vervangen — dat zou
         -- de bevriezing waardeloos maken.
         ingang                   = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.ingang
                                      else s.ingang
                                    end,
         bronset_log_id           = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.bronset_log_id
                                      else s.bronset_log_id
                                    end,
         reflectie_bronset_versie = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.reflectie_bronset_versie
                                      else s.reflectie_bronset_versie
                                    end,
         gestart_op               = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.gestart_op
                                      else s.gestart_op
                                    end
  returning * into v_rij;

  return v_rij;
end;
$$;

comment on function public.reflectie_transitie(uuid, text, text, uuid) is
  'DE ENIGE schrijfweg naar gesprek_reflectie_state (besluit 0110, AC-18). '
  'Valideert de gevraagde ACTIE tegen de opnieuw uitgelezen actuele status '
  '(FR-67); de client geeft nooit een gewenste einddstatus door. Beurtteller '
  'kan alleen omhoog; bronset alleen bij `start`, en alleen uit een '
  'governance_log-rij van dezelfde gebruiker én hetzelfde gesprek. Fail-safe: '
  'een status ouder dan 24 uur telt als niet_actief (FR-57).';

-- `revoke ... from public` alléén is op Supabase NIET genoeg: de default-ACL
-- kent EXECUTE expliciet aan `anon` en `authenticated` toe, niet via PUBLIC.
-- Zonder de `, anon` is deze definer-functie ongeauthenticeerd aanroepbaar en
-- omzeilt hij RLS volledig (bevinding H-18). Gate H bewaakt dit.
revoke all on function public.reflectie_transitie(uuid, text, text, uuid) from public, anon;
grant execute on function public.reflectie_transitie(uuid, text, text, uuid) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 0. In welk schema staat pgcrypto? Verwacht 'extensions' op Supabase. Staat er
--    iets anders, controleer dan of dat schema in de search_path van
--    reflectie_bronset_hash() staat — anders faalt hij op 42883:
--      select n.nspname from pg_extension e
--        join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto';
-- 1. Alleen een SELECT-policy op de statustabel — moet 1 rij met cmd='SELECT':
--      select policyname, cmd from pg_policies
--       where schemaname='public' and tablename='gesprek_reflectie_state';
-- 2. Geen append-only trigger op de statustabel — moet 0 teruggeven:
--      select count(*) from pg_trigger
--       where tgrelid='public.gesprek_reflectie_state'::regclass and not tgisinternal;
-- 3. Cascade vanaf gesprekken bestaat — moet 'c' teruggeven:
--      select confdeltype from pg_constraint
--       where conrelid='public.gesprek_reflectie_state'::regclass and contype='f'
--         and confrelid='public.gesprekken'::regclass;
-- 4. anon heeft geen EXECUTE op de definer-functie — moet false teruggeven:
--      select has_function_privilege('anon',
--        'public.reflectie_transitie(uuid,text,text,uuid)', 'execute');
-- 5. search_path is gepind — moet {search_path=public,\ pg_temp} bevatten:
--      select proconfig from pg_proc
--       where oid = 'public.reflectie_transitie(uuid,text,text,uuid)'::regprocedure;
-- 6. De bronsethash komt overeen met de TypeScript-pin uit bronset.sanity.ts —
--    moet fcd8476d5c09046ce515097823c58a0005a2cbfe7796617d4a883f3d8832140a geven:
--      select public.reflectie_bronset_hash('{
--        "chunks":[{"id":"c-bbb","document_id":"doc-2"},
--                  {"id":"c-aaa","document_id":"doc-1"},
--                  {"id":"c-ccc","document_id":"doc-1"}],
--        "scope":{"document_ids":["doc-2","doc-1"]}}'::jsonb);
-- 7. Volledige gedragstoets: supabase/checks/2026_08_05_b_reflectie_flow.sql
