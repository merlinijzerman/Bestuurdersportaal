-- ============================================================================
-- Migratie 2026-07-09 (T8b) — config-audit als ATOMISCHE, ONOVERSLAANBARE trigger
-- ----------------------------------------------------------------------------
-- WAAROM (reviewbevindingen op de T8-config-laag):
--   (1) ATOMICITEIT — in de eerste opzet deed de app-laag twee losse statements
--       per wijziging: eerst de config-upsert, dán een aparte insert in
--       fonds_config_log. Faalde de logregel ná een geslaagde upsert, dan schoof
--       de versie op ZONDER auditregel (stil audit-gat). Deze migratie verplaatst
--       het loggen naar een AFTER-trigger op de vier config-tabellen: de logregel
--       ontstaat in DEZELFDE transactie als de wijziging en is niet meer over te
--       slaan vanuit code (borging op DB-niveau, conform de audit-guardrail).
--   (2) RACE / DUBBELE VERSIE — de versie werd read-modify-write bepaald; twee
--       gelijktijdige schrijvers konden dezelfde versie loggen. Een UNIQUE-
--       constraint (fonds_id, config_type, config_sleutel, versie) maakt de
--       tweede logregel (en daarmee, via de trigger, de hele tweede transactie)
--       ongeldig — serialisatie zonder stil verlies.
--
-- GEVOLG voor de app-laag: lib/fonds-config.ts schrijft NIET langer zelf een
-- fonds_config_log-regel (schrijfLog vervalt). De writers doen alleen de upsert
-- (met versie); de trigger legt oud→nieuw + versie vast. bijgewerkt_door blijft
-- de actor (server-side afgeleide user-id); de trigger leest de naam bij.
--
-- VOLGORDE: draait NA de basis-T8-migratie én NA backfill/demo-seed (bestandsnaam
-- 't8b' sorteert ná 't8_'), zodat die datamigraties GEEN triggerlog produceren —
-- het zijn setup-seeds, geen governance-handelingen. Alleen wijzigingen ná deze
-- migratie worden geauditeerd.
--
-- Idempotent (create or replace / drop trigger if exists / guarded add constraint).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy (migratie-eerst).
-- ROLLBACK: 2026_07_09_t8b_config_audit_trigger_ROLLBACK.sql
-- TENANT-IMPACT: additief; geen wijziging aan bestaande rijen of RLS-policies.
-- ============================================================================

begin;

-- ── 1. UNIQUE-constraint tegen dubbele versie op het auditspoor ─────────────
-- Guarded: add constraint is niet vanzelf idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fonds_config_log_versie_uniek'
  ) then
    alter table public.fonds_config_log
      add constraint fonds_config_log_versie_uniek
      unique (fonds_id, config_type, config_sleutel, versie);
  end if;
end $$;

-- ── 2. Capture-functie: mirror elke config-mutatie naar het append-only log ──
-- Dispatch op TG_TABLE_NAME → (config_type, sleutel, oud→nieuw als jsonb). Draait
-- SECURITY INVOKER (default): de RLS-insertpolicy op fonds_config_log geldt (de
-- WITH CHECK op fonds_id klopt per definitie, want new.fonds_id = eigen fonds).
create or replace function public.fn_fonds_config_capture()
returns trigger language plpgsql as $f$
declare
  v_type    text;
  v_sleutel text;
  v_oude    jsonb;
  v_nieuwe  jsonb;
  v_naam    text;
begin
  if tg_table_name = 'fonds_theming' then
    v_type := 'theming'; v_sleutel := 'tokens';
    v_nieuwe := new.tokens;
    v_oude := case when tg_op = 'UPDATE' then old.tokens else null end;
  elsif tg_table_name = 'fonds_module_manifest' then
    v_type := 'manifest'; v_sleutel := new.module_key;
    v_nieuwe := to_jsonb(new.actief);
    v_oude := case when tg_op = 'UPDATE' then to_jsonb(old.actief) else null end;
  elsif tg_table_name = 'fonds_feature_flags' then
    v_type := 'flag'; v_sleutel := new.flag_key;
    v_nieuwe := new.waarde;
    v_oude := case when tg_op = 'UPDATE' then old.waarde else null end;
  elsif tg_table_name = 'fonds_content_overrides' then
    v_type := 'override'; v_sleutel := new.sleutel;
    v_nieuwe := to_jsonb(new.waarde);
    v_oude := case when tg_op = 'UPDATE' then to_jsonb(old.waarde) else null end;
  else
    raise exception 'fn_fonds_config_capture: onverwachte tabel %', tg_table_name;
  end if;

  -- Naam-snapshot bij de actor (nullable: seeds zetten geen bijgewerkt_door).
  select naam into v_naam from public.profielen where id = new.bijgewerkt_door;

  insert into public.fonds_config_log (
    fonds_id, gebruiker_id, gebruiker_naam, config_type, config_sleutel,
    oude_waarde, nieuwe_waarde, versie
  ) values (
    new.fonds_id, new.bijgewerkt_door, v_naam, v_type, v_sleutel,
    v_oude, v_nieuwe, new.versie
  );
  return new;
end;
$f$;

-- ── 3. AFTER-triggers op de vier config-tabellen ────────────────────────────
drop trigger if exists trg_fonds_theming_audit on public.fonds_theming;
create trigger trg_fonds_theming_audit
  after insert or update on public.fonds_theming
  for each row execute procedure public.fn_fonds_config_capture();

drop trigger if exists trg_fonds_manifest_audit on public.fonds_module_manifest;
create trigger trg_fonds_manifest_audit
  after insert or update on public.fonds_module_manifest
  for each row execute procedure public.fn_fonds_config_capture();

drop trigger if exists trg_fonds_flags_audit on public.fonds_feature_flags;
create trigger trg_fonds_flags_audit
  after insert or update on public.fonds_feature_flags
  for each row execute procedure public.fn_fonds_config_capture();

drop trigger if exists trg_fonds_overrides_audit on public.fonds_content_overrides;
create trigger trg_fonds_overrides_audit
  after insert or update on public.fonds_content_overrides
  for each row execute procedure public.fn_fonds_config_capture();

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Constraint aanwezig:
--      select conname from pg_constraint where conname = 'fonds_config_log_versie_uniek';
-- 2. Vier audit-triggers aanwezig:
--      select trigger_name, event_object_table from information_schema.triggers
--       where trigger_name like 'trg_fonds_%_audit';
-- 3. Een theming-upsert produceert exact één logregel met dezelfde versie:
--      -- (via de app; oude=vorige tokens, nieuwe=nieuwe tokens, versie = row.versie)
