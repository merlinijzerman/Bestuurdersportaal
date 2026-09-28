-- #438 — PREVIEW ONLY rollback van de m365-demo-vergelijkcanary.
-- Zet daarnaast VERGELIJKMODUS uit of verwijder VERGELIJK_FONDS_ID uit de
-- preview-stable runtimeconfiguratie.

begin;

do $$
declare
  v_fonds uuid;
  v_huidig jsonb;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then raise exception '#438 vergelijkrollback: verkeerde doelomgeving'; end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';

  select waarde into v_huidig
    from public.fonds_feature_flags
   where fonds_id = v_fonds and flag_key = 'vergelijkmodus'
   for update;

  if found and v_huidig is distinct from 'true'::jsonb then
    raise exception '#438 vergelijkrollback: onverwachte huidige waarde %', v_huidig;
  end if;

  delete from public.fonds_feature_flags
   where fonds_id = v_fonds
     and flag_key = 'vergelijkmodus'
     and waarde = 'true'::jsonb;
end $$;

commit;
