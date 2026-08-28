-- ==========================================================================
-- 2026-08-27 — Bewijsketen: stemmingen (besluit 0192 §5, #183b spoor T)
-- --------------------------------------------------------------------------
-- REFERENTIEPATROON voor de schone groep-A-triggers. Eén trigger dekt drie
-- handlers (#8 intrekken, #9 sluiten, #11 openen) via TG_OP + statusovergang.
-- Vereist 2026_08_27_govevent_tenantketen.sql (fonds_id + fn_govevent_fonds).
--
-- Kernkeuzes:
--  * SECURITY INVOKER — schrijft governance_events als de aanroeper; onder een
--    sessie vult/overschrijft fn_govevent_fonds fonds_id uit het profiel, onder
--    service-role accepteert het de hier gezette new.fonds_id (drietrapsregel).
--  * De brontrigger ZET fonds_id (= stemmingen.fonds_id) — zo krijgt óók een
--    service-role-schrijfpad dekking, zonder poort op de schrijver (0192 §2b iii).
--  * Semantische poort op UPDATE: alleen een échte statusovergang is een feit.
--  * GECUREERDE payload, GEEN to_jsonb(new). governance_events is permanent +
--    onveranderlijk (0191 §1-dataminimalisatie); een volledige rijdump zou elke
--    ooit-toegevoegde kolom voorgoed in de keten trekken én stilzwijgend van vorm
--    veranderen bij schemadrift (de hash dekt dan een andere structuur zonder
--    besluit). De payloadvorm is onderdeel van waarvoor je tekent. Zowel de
--    event_type-waarden ALS de veldselectie per event worden gedeclareerd in het
--    register (met drift-/collisiepoort) — dat register landt met de resterende
--    zes triggers, ná de preview-run van dit referentiepatroon.
--  * OLD wordt alleen aangeraakt achter TG_OP = 'UPDATE' (bestaat niet bij INSERT).
--  * actor_naam als momentopname (niet als live join naar een muteerbare tabel);
--    permanente naamopslag = bewuste PII-opname, geregistreerd in de DPIA-delta.
-- ==========================================================================

begin;

create or replace function public.fn_stemming_ketengebeurtenis()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_actor      uuid;
  v_nieuw      jsonb;
  v_oud        jsonb := null;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'stemming_geopend';
    v_actor      := new.geopend_door;
    v_nieuw := jsonb_build_object(
      'status',               new.status,
      'agendapunt_id',        new.agendapunt_id,
      'vraag',                new.vraag,
      'alternatieven',        new.alternatieven,
      'vereist_quorum',       new.vereist_quorum,
      'vereiste_meerderheid', new.vereiste_meerderheid
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    v_actor := new.gesloten_door;
    v_oud   := jsonb_build_object('id', old.id, 'status', old.status);  -- gewijzigd veld + identiteit
    if new.status = 'gesloten' then
      v_event_type := 'stemming_gesloten';
      v_nieuw := jsonb_build_object('status', new.status, 'uitslag', new.uitslag);
    elsif new.status = 'ingetrokken' then
      v_event_type := 'stemming_ingetrokken';
      v_nieuw := jsonb_build_object('status', new.status, 'ingetrokken_reden', new.ingetrokken_reden);
    else
      return null;                      -- andere overgang: geen ketengebeurtenis
    end if;
  else
    return null;                        -- INSERT afgehandeld boven; non-status-UPDATE: geen feit
  end if;

  insert into public.governance_events (
    fonds_id, decision_id, event_type, actor_id, actor_naam,
    object_type, object_id, oude_waarde, nieuwe_waarde
  ) values (
    new.fonds_id,                       -- brontrigger zet fonds; fn_govevent_fonds accepteert/overschrijft
    new.decision_id,
    v_event_type,
    v_actor,
    (select naam from public.profielen where id = v_actor),
    'stemming',
    new.id,
    v_oud,
    v_nieuw
  );
  return null;                          -- AFTER-trigger: returnwaarde genegeerd
end;
$$;

revoke all on function public.fn_stemming_ketengebeurtenis() from public, anon;
grant execute on function public.fn_stemming_ketengebeurtenis() to authenticated, service_role;

drop trigger if exists trg_stemming_ketengebeurtenis on public.stemmingen;
create trigger trg_stemming_ketengebeurtenis
  after insert or update on public.stemmingen
  for each row execute function public.fn_stemming_ketengebeurtenis();

commit;
