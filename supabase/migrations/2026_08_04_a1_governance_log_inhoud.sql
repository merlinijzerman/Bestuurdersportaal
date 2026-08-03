-- ============================================================================
-- Migratie 2026-08-04 (A1) — scheiding van auditSPOOR en chatINHOUD
-- ----------------------------------------------------------------------------
-- WAAROM. `governance_log` draagt vandaag zowel het append-only auditspoor als
-- de chatinhoud (`vraag`, `antwoord`, `bronnen`). Die vermenging heeft twee
-- gevolgen die elkaar versterken:
--
--   1. Een gebruiker kan zijn gesprek niet écht verwijderen. `archiveerGesprek()`
--      zet alleen `gearchiveerd = true`; de vraag blijft in het auditspoor staan
--      en de append-only trigger verbiedt DELETE.
--   2. De policy "fonds log" is `for all` op fondsniveau: iedere collega — in de
--      praktijk elke beheerder — leest de vragen van alle anderen.
--
-- Deze migratie is de EXPAND-stap van een expand/contract-operatie. Zij voegt
-- alleen toe. De kolommen `vraag`, `antwoord` en `bronnen` blijven bestaan tot
-- de code aantoonbaar naar de nieuwe tabel schrijft; pas dan volgt de contract-
-- stap (2026_08_04_a3_governance_log_contract.sql). Andersom breekt elke
-- chatinteractie, want `vraag` is nu NOT NULL.
--
-- ⚠ DEZE TABEL KRIJGT BEWUST GEEN APPEND-ONLY TRIGGER ⚠
-- `fn_log_append_only()` staat op governance_log, risico_log, procedure_log,
-- agendapunt_log en aqlab_log. Wie `governance_log_inhoud` daar "voor de
-- consistentie" aan toevoegt, breekt het hele ontwerp: deze tabel MOET
-- verwijderbaar zijn — dat is haar bestaansreden. Het auditspoor blijft
-- append-only; alleen de inhoud is dat niet. Bewaakt door structurele check 2 in
-- supabase/checks/2026_08_04_a_rollen_capabilities.sql.
--
-- LET OP — de allowlist doet het echte werk. `retrieval_meta` draagt zélf inhoud
-- (`zoekvraag` = de vraag van de gebruiker, `sources[].fragment` = letterlijke
-- documenttekst, `scope.titels`, `terugval`, `jargon_expansie`). Alleen de drie
-- kolommen verplaatsen zou de scheiding cosmetisch maken. De splitsing gebeurt
-- bij het schrijven in core/lib/audit-meta.ts en bij het lezen in
-- meta_basisniveau()/meta_bronniveau() (migratie A2).
--
-- Idempotent (create ... if not exists, add column if not exists, drop policy
-- if exists + create). Transactioneel.
-- ROLLBACK: 2026_08_04_a1_governance_log_inhoud_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- ── 1. De inhoudstabel ──────────────────────────────────────────────────────
-- `on delete restrict` en niet `cascade`: een auditregel wordt nooit verwijderd,
-- dus de FK mag nooit een pad openen waarlangs dat alsnog gebeurt. De inhoud
-- gaat weg door een DELETE op DEZE tabel, niet op de ouder.

create table if not exists public.governance_log_inhoud (
  log_id                uuid primary key
                        references public.governance_log(id) on delete restrict,
  vraag                 text not null,
  antwoord              text,
  bronnen               jsonb not null default '[]'::jsonb,
  -- Het deel van retrieval_meta dat letterlijke tekst draagt en dus met het
  -- gesprek meegaat: zoekvraag, sources, terugval, jargon_expansie,
  -- scope.titels, invoer.historie_hash. Zie core/lib/audit-meta.ts.
  retrieval_meta_inhoud jsonb not null default '{}'::jsonb
);

comment on table public.governance_log_inhoud is
  'Chatinhoud bij een auditregel. VERWIJDERBAAR — bewust GEEN append-only '
  'trigger (dat zou het ontwerp breken). Verwijdering loopt uitsluitend via '
  'public.verwijder_gesprek(); er is geen delete-policy. Het spoor zelf blijft '
  'in public.governance_log en blijft append-only.';

comment on column public.governance_log_inhoud.retrieval_meta_inhoud is
  'Inhoudsdragende sleutels uit retrieval_meta (zoekvraag, sources, terugval, '
  'jargon_expansie, scope.titels, invoer.historie_hash). Classificatie in '
  'core/lib/audit-meta.ts; gespiegeld door meta_basisniveau()/meta_bronniveau().';

alter table public.governance_log_inhoud enable row level security;

-- RLS: uitsluitend SELECT, uitsluitend de auteur.
--
-- De USING-tekst noemt `governance_log` letterlijk. Dat is niet toevallig: gate
-- A1/A2 van 2026_07_31_r1_structurele_gates.sql eist voor een RLS-tabel zonder
-- eigen `fonds_id` een geregistreerde oudertabel, en toetst met substring-
-- matching of het predicaat die ouder noemt. De registratie is toegevoegd in
-- dezelfde gates-file.
--
-- Geen INSERT-policy: schrijven gebeurt uitsluitend via schrijf_ai_interactie()
-- (definer, migratie A2). Geen UPDATE-policy: inhoud wordt niet gecorrigeerd.
-- Geen DELETE-policy: verwijderen loopt via verwijder_gesprek() (definer), zodat
-- er altijd een redactieregel tegenover staat.
drop policy if exists "eigen loginhoud lezen" on public.governance_log_inhoud;
create policy "eigen loginhoud lezen" on public.governance_log_inhoud
  for select using (
    log_id in (
      select gl.id
        from public.governance_log gl
       where gl.gebruiker_id = auth.uid()
         and gl.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- Expliciete tabelgrants in plaats van vertrouwen op de default-ACL. R6
-- (2026_07_31_r6_default_privileges.sql) zet die ACL in, maar kon de
-- supabase_admin-kant niet dichtzetten: een tabel die door DIE rol wordt
-- aangemaakt krijgt opnieuw de volledige grant, inclusief INSERT voor anon en
-- TRUNCATE — en TRUNCATE valt volledig buiten RLS. Gate F is de detectie;
-- dit is de preventie. Kost niets en haalt de aanname weg.
revoke all on public.governance_log_inhoud from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.governance_log_inhoud from authenticated;
grant select on public.governance_log_inhoud to authenticated;

-- ── 2. Backfill ─────────────────────────────────────────────────────────────
-- Idempotent via `on conflict do nothing`. `retrieval_meta_inhoud` blijft leeg:
-- historische rijen dragen hun inhoudsleutels nog in governance_log.
-- retrieval_meta en worden bij het LEZEN afgeschermd door de allowlist-projectie
-- (meta_basisniveau/meta_bronniveau). Bewust geen UPDATE op de append-only
-- tabel — zie het restrisico in 00 Overzicht en status/openstaande-punten.

insert into public.governance_log_inhoud (log_id, vraag, antwoord, bronnen)
select gl.id, gl.vraag, gl.antwoord, coalesce(gl.bronnen, '[]'::jsonb)
  from public.governance_log gl
 where gl.vraag is not null
on conflict (log_id) do nothing;

-- ── 3. `vraag` nullable maken ───────────────────────────────────────────────
-- Vanaf code v1 schrijft de route de tekst niet meer naar deze kolom. Zolang de
-- kolom NOT NULL is, zou dat elke insert breken. De kolom zelf verdwijnt pas in
-- de contract-stap.

alter table public.governance_log alter column vraag drop not null;

-- ── 4. Correlatie- en integriteitskolommen ──────────────────────────────────

alter table public.governance_log
  add column if not exists gesprek_audit_id    uuid,
  add column if not exists inhoud_hmac         text,
  add column if not exists hmac_schema_versie  smallint,
  add column if not exists hmac_sleutel_versie smallint;

comment on column public.governance_log.gesprek_audit_id is
  'Correlatie-ID naar het gesprek waarin deze interactie plaatsvond. BEWUST GEEN '
  'foreign key: ON DELETE SET NULL wordt door PostgreSQL als UPDATE uitgevoerd en '
  'botst met fn_log_append_only(); ON DELETE CASCADE zou het auditspoor '
  'verwijderen. De waarde blijft na verwijdering van het gesprek bestaan en geeft '
  'geen toegang tot verwijderde inhoud. Null voor interacties van vóór plateau A '
  '— die zijn daardoor niet door de gebruiker te verwijderen.';

comment on column public.governance_log.inhoud_hmac is
  'HMAC-SHA-256 over de canonieke vorm {schema_version, question, answer}, '
  'berekend in de applicatielaag (core/lib/audit-hmac.ts) met een geheime '
  'serversleutel. Blijft bestaan als de inhoud is verwijderd, zodat een '
  'voorgelegde tekst achteraf toetsbaar blijft. Genuanceerde bewijswaarde: hij '
  'bevestigt een AANGEBODEN tekst, reconstrueert niets, en bewijst niets tegen '
  'wie de sleutel heeft. Null wanneer geen sleutel is geconfigureerd.';

-- Partieel: alleen rijen die daadwerkelijk aan een gesprek hangen. Draagt de
-- lookup in verwijder_gesprek().
create index if not exists idx_govlog_gesprek_audit
  on public.governance_log(gesprek_audit_id)
  where gesprek_audit_id is not null;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. Backfill compleet — moet 0 teruggeven:
--      select count(*) from public.governance_log gl
--       where gl.vraag is not null
--         and not exists (select 1 from public.governance_log_inhoud i
--                          where i.log_id = gl.id);
-- 2. GEEN append-only trigger op de inhoudstabel — moet 0 teruggeven:
--      select count(*) from pg_trigger
--       where tgrelid = 'public.governance_log_inhoud'::regclass and not tgisinternal;
-- 3. Append-only op het spoor is ONGEWIJZIGD — moet 2 teruggeven:
--      select count(*) from pg_trigger
--       where tgrelid = 'public.governance_log'::regclass and not tgisinternal;
-- 4. Geen foreign key van governance_log naar gesprekken — moet 0 teruggeven:
--      select count(*) from pg_constraint
--       where conrelid = 'public.governance_log'::regclass and contype = 'f'
--         and confrelid = 'public.gesprekken'::regclass;
-- 5. `vraag` is nullable:
--      select is_nullable from information_schema.columns
--       where table_name = 'governance_log' and column_name = 'vraag';   → YES
