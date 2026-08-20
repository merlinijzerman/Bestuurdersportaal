-- ============================================================================
-- ROLLBACK 2026-08-09 (fase 2) — procedure_afschriften: ai_leeswijzer_tekst
-- ----------------------------------------------------------------------------
-- Draai alleen als de fase-2-code NIET meer gedeployed is. Herstelt de
-- freeze-trigger naar de fase-1-vorm (zonder ai_leeswijzer_tekst) en dropt de
-- kolom. Idempotent.
-- ============================================================================

begin;

-- Freeze-trigger terug naar de vorm zonder ai_leeswijzer_tekst (fase-1-hardening).
create or replace function public.fn_afschrift_bevries_kolommen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
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

alter table public.procedure_afschriften drop column if exists ai_leeswijzer_tekst;

commit;
