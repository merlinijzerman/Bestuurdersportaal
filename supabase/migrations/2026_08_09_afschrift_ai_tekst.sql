-- ============================================================================
-- Migratie 2026-08-09 (fase 2) — procedure_afschriften: ai_leeswijzer_tekst
-- ----------------------------------------------------------------------------
-- Fase 2 (AI-leeswijzer) heeft één extra kolom nodig die fase 1 niet had: de
-- VASTGESTELDE §2–4-tekst moet van de enqueue-route naar de async worker. De
-- ai_*-metadata (model/promptversie/tekst-hash/vaststeller) lag al klaar; alleen
-- de tekst zelf ontbrak als kanaal. jsonb met de drie secties.
--
-- De kolom wordt óók opgenomen in de kolom-freeze-trigger: een gebruikerssessie
-- mag na aanmaken alleen ingetrokken_* wijzigen, dus ook de leeswijzertekst is
-- na INSERT bevroren (de worker draait service-role → auth.uid() IS NULL → vrij).
--
-- Additief, idempotent, transactioneel. EERST in Supabase draaien, DÁN de
-- fase-2-code deployen. ROLLBACK: 2026_08_09_afschrift_ai_tekst_ROLLBACK.sql
-- TENANT-IMPACT: geen (nullable kolom, geen policy-wijziging).
-- ============================================================================

begin;

alter table public.procedure_afschriften
  add column if not exists ai_leeswijzer_tekst jsonb;

comment on column public.procedure_afschriften.ai_leeswijzer_tekst is
  'Fase 2: de door een mens vastgestelde §2–4-leeswijzertekst {hoeVerlopen, watVastgelegd, bijzonderheden}. NULL = deterministisch sjabloon (ai_leeswijzer=false).';

-- Freeze-trigger bijwerken: ai_leeswijzer_tekst mee bevriezen voor user-sessies.
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
    or new.ai_leeswijzer_tekst    is distinct from old.ai_leeswijzer_tekst
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

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--  where table_name='procedure_afschriften' and column_name='ai_leeswijzer_tekst';
-- ============================================================================
