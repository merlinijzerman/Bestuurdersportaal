-- ============================================================================
-- Migratie 2026-08-09 (hardening) — T6 procedure_afschriften: grants + freeze
-- ----------------------------------------------------------------------------
-- Volgt op 2026_08_09_procedure_afschriften.sql na de RLS-review. Drie punten:
--
--  H1 (blocker) — Expliciete tabelgrants i.p.v. vertrouwen op de default-ACL.
--    R6 zet de ACL in, maar kon de supabase_admin-kant niet dichtzetten: een
--    tabel die door DIE rol wordt aangemaakt krijgt opnieuw de volledige grant,
--    inclusief INSERT voor anon en TRUNCATE — en TRUNCATE valt VOLLEDIG buiten
--    RLS én vuurt de BEFORE DELETE-trigger niet. Dat zou de append-only-borging
--    van een permanent archiefstuk (stemgedrag!) omzeilen. Gate F is de
--    detectie; dit is de preventie (precedent 2026_08_04_a1_governance_log_inhoud).
--
--  M1 — Kolombevriezing. De UPDATE-policy is kolombreed; de ENIGE bedoelde
--    user-UPDATE is intrekken (ingetrokken_*). Zonder deze trigger kan een
--    fonds-lid sha256/opslag_pad/status/lease overschrijven en zo de integriteit
--    of de worker-claim manipuleren. Trigger bevriest alles behalve ingetrokken_*
--    voor sessies met een auth.uid() (de worker draait service-role → auth.uid()
--    IS NULL → vrij). Precedent: fn_profiel_bevries_kolommen (2026_07_03).
--
--  M2 — Bureau-rol óók van UPDATE uitsluiten (was al van INSERT + storage-read
--    uitgesloten). De bureau-rol ondersteunt, muteert niet.
--
-- Idempotent. Transactioneel. EERST in Supabase draaien, DÁN code-deploy.
-- ROLLBACK: 2026_08_09_procedure_afschriften_hardening_ROLLBACK.sql
-- GATES ná deze migratie: gate F (grants) moet schoon zijn.
-- ============================================================================

begin;

-- ── H1. Expliciete tabelgrants (anon dicht; authenticated: select/insert/update) ─
revoke all on public.procedure_afschriften from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.procedure_afschriften from authenticated;
grant select, insert, update on public.procedure_afschriften to authenticated;

-- ── M2. UPDATE-policy opnieuw, nu mét bureau-uitsluiting ────────────────────
drop policy if exists "fonds afschriften bijwerken" on public.procedure_afschriften;
create policy "fonds afschriften bijwerken" on public.procedure_afschriften
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

-- ── M1. Kolombevriezing: user-sessies mogen alleen ingetrokken_* wijzigen ────
-- Service-role (auth.uid() IS NULL) en tabel-eigenaar blijven vrij, zodat de
-- worker status/opslag/sha256/lease kan schrijven. Elke ándere kolomwijziging
-- vanuit een ingelogde sessie is een integriteitsschending → 42501.
create or replace function public.fn_afschrift_bevries_kolommen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;  -- service-role / owner: vrij (worker-bouw)
  end if;
  if (
       new.procedure_id           is distinct from old.procedure_id
    or new.fonds_id               is distinct from old.fonds_id
    or new.versie                 is distinct from old.versie
    or new.trigger_status         is distinct from old.trigger_status
    or new.aanleiding             is distinct from old.aanleiding
    or new.status                 is distinct from old.status
    or new.poging                 is distinct from old.poging
    or new.lease_tot              is distinct from old.lease_tot
    or new.laatste_fout           is distinct from old.laatste_fout
    or new.opslag_pad             is distinct from old.opslag_pad
    or new.sha256                 is distinct from old.sha256
    or new.bytes                  is distinct from old.bytes
    or new.bestandsaantal         is distinct from old.bestandsaantal
    or new.bevat_stemgedrag       is distinct from old.bevat_stemgedrag
    or new.gebouwd_onder_rol      is distinct from old.gebouwd_onder_rol
    or new.uitgesloten_items      is distinct from old.uitgesloten_items
    or new.waarschuwingen         is distinct from old.waarschuwingen
    or new.dossier_stand_event_id is distinct from old.dossier_stand_event_id
    or new.dossier_stand_op       is distinct from old.dossier_stand_op
    or new.ai_leeswijzer          is distinct from old.ai_leeswijzer
    or new.ai_model               is distinct from old.ai_model
    or new.ai_promptversie        is distinct from old.ai_promptversie
    or new.ai_tekst_hash          is distinct from old.ai_tekst_hash
    or new.ai_vastgesteld_door    is distinct from old.ai_vastgesteld_door
    or new.ai_vastgesteld_op      is distinct from old.ai_vastgesteld_op
    or new.aangemaakt_op          is distinct from old.aangemaakt_op
    or new.aangemaakt_door        is distinct from old.aangemaakt_door
    or new.id                     is distinct from old.id
  ) then
    raise exception
      'procedure_afschriften: vanuit een gebruikerssessie is alleen intrekken (ingetrokken_*) toegestaan'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_afschrift_bevries_kolommen on public.procedure_afschriften;
create trigger trg_afschrift_bevries_kolommen
  before update on public.procedure_afschriften
  for each row execute function public.fn_afschrift_bevries_kolommen();

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. Grants dicht (geen INSERT/TRUNCATE voor anon):
--      select grantee, privilege_type from information_schema.role_table_grants
--       where table_name='procedure_afschriften' order by grantee, privilege_type;
--    → anon: geen; authenticated: SELECT/INSERT/UPDATE.
-- 2. Freeze-trigger aanwezig:
--      select trigger_name from information_schema.triggers
--       where event_object_table='procedure_afschriften' and event_manipulation='UPDATE';
-- 3. Als ingelogde tenant-gebruiker: een UPDATE op sha256/status faalt (42501);
--    een UPDATE die alleen ingetrokken_reden zet, slaagt.
-- 4. Draai gate F uit supabase/checks/2026_07_31_r1_structurele_gates.sql — schoon.
-- ============================================================================
