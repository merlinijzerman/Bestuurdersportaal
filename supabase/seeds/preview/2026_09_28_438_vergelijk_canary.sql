-- #438 — PREVIEW ONLY: activeer de gestructureerde vergelijkservice voor m365-demo.
-- De runtime blijft daarnaast begrensd door VERGELIJKMODUS=on en
-- VERGELIJK_FONDS_ID=<m365-demo-id>. Productie en andere fondsen blijven uit.
-- ROLLBACK: ../../rollbacks/2026_09_28_438_vergelijk_canary_ROLLBACK.sql

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
  then
    raise exception '#438 vergelijkcanary: uitsluitend portal_preview';
  end if;

  select id into strict v_fonds
    from public.fondsen
   where slug = 'm365-demo' and naam = 'Bestuurdersportaal M365 Demo';

  select waarde into v_huidig
    from public.fonds_feature_flags
   where fonds_id = v_fonds and flag_key = 'vergelijkmodus'
   for update;

  if found and v_huidig is distinct from 'true'::jsonb then
    raise exception '#438 vergelijkcanary: onverwachte bestaande waarde %', v_huidig;
  end if;

  insert into public.fonds_feature_flags (fonds_id, flag_key, waarde, versie, bijgewerkt_door)
  values (v_fonds, 'vergelijkmodus', 'true'::jsonb, 1, null)
  on conflict (fonds_id, flag_key) do nothing;

  if not exists (select 1 from public.fonds_feature_flags
                  where fonds_id = v_fonds
                    and flag_key = 'vergelijkmodus'
                    and waarde = 'true'::jsonb)
  then
    raise exception '#438 vergelijkcanary: eindstand niet bereikt';
  end if;
end $$;

commit;
