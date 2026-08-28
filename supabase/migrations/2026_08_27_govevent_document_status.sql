-- ==========================================================================
-- 2026-08-27 — fn_document_status_zetten (besluit B, #183b spoor T, handler #2)
-- --------------------------------------------------------------------------
-- documenten krijgt GEEN gepoorte tabeltrigger. Reden (besluit B): een payload-
-- lezende scannerheuristiek zou FAIL-OPEN crediteren (`actief: true` op een al-
-- actief document noemt `actief` maar verandert hem niet → geen event, wel
-- "gedekt"). Daarom loopt de statuswissel via deze RPC; de scanner crediteert
-- via RPC_TRAIL — een deactivatiepad dat de RPC omzeilt krijgt géén krediet en de
-- poort gaat rood (fail-closed, de goede kant).
--
-- De RPC doet ATOMISCH wat handler #2 nu in drie losse stappen doet (gemeten
-- tegen documents/[id]/route.ts): (1) de status-UPDATE (actief-flip +
-- gedeactiveerd_*), (2) de document_inzage-regel — die stond in de route als een
-- kale, ONGECONTROLEERDE insert (fail-open); nu in dezelfde transactie —, en
-- (3) de governance_events-ketengebeurtenis. SECURITY INVOKER: dezelfde RLS als de
-- route vandaag; de rol-/24u-autorisatie blijft in de route (business-logica).
-- Actor uit auth.uid() (anti-spoof), niet uit een parameter.
-- ==========================================================================

begin;

create or replace function public.fn_document_status_zetten(
  p_document_id uuid,
  p_actie       text,     -- 'deactiveren' | 'reactiveren'
  p_reden       text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_naam   text;
  v_titel  text;
  v_fonds  uuid;
  v_oud    boolean;
  v_nieuw  boolean;
begin
  if v_uid is null then
    raise exception 'fn_document_status_zetten vereist een geauthenticeerde gebruiker' using errcode = '28000';
  end if;
  if p_actie not in ('deactiveren','reactiveren') then
    raise exception 'onbekende actie: %', p_actie;
  end if;
  select naam into v_naam from public.profielen where id = v_uid;
  select titel, fonds_id, actief into v_titel, v_fonds, v_oud
    from public.documenten where id = p_document_id;
  if not found then
    raise exception 'document niet gevonden' using errcode = 'P0002';
  end if;

  v_nieuw := (p_actie = 'reactiveren');

  -- 1. Status-UPDATE (actief-flip).
  if p_actie = 'deactiveren' then
    update public.documenten
       set actief = false, gedeactiveerd_op = now(), gedeactiveerd_door = v_uid, deactivatie_reden = p_reden
     where id = p_document_id;
  else
    update public.documenten
       set actief = true, gedeactiveerd_op = null, gedeactiveerd_door = null, deactivatie_reden = null
     where id = p_document_id;
  end if;

  -- 2. Inzage-log (was fail-open in de route; nu atomisch).
  insert into public.document_inzage (
    document_id, document_titel_snapshot, fonds_id, gebruiker_id, gebruiker_naam, actie, reden
  ) values (
    p_document_id, v_titel, v_fonds, v_uid, v_naam,
    case when p_actie = 'deactiveren' then 'gedeactiveerd' else 'gereactiveerd' end, p_reden
  );

  -- 3. Bewijsketen. fonds_id = documentfonds; fn_govevent_fonds overschrijft uit het
  --    profiel op het sessiepad (gelijk). decision_id NULL ⇒ composite FK slaat over.
  insert into public.governance_events (
    fonds_id, event_type, actor_id, actor_naam, object_type, object_id, oude_waarde, nieuwe_waarde
  ) values (
    v_fonds,
    case when p_actie = 'deactiveren' then 'document_gedeactiveerd' else 'document_gereactiveerd' end,
    v_uid, v_naam, 'document', p_document_id,
    jsonb_build_object('actief', v_oud),
    jsonb_build_object('actief', v_nieuw, 'reden', p_reden, 'titel', v_titel)
  );
end;
$$;

revoke all on function public.fn_document_status_zetten(uuid, text, text) from public, anon;
grant execute on function public.fn_document_status_zetten(uuid, text, text) to authenticated, service_role;

commit;
