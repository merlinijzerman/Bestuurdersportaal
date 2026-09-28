-- #438 — PREVIEW ONLY rollback van het verruimde canary-generatiebudget.
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
  then raise exception '#438 max-effortrollback: verkeerde doelomgeving'; end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';
  select waarde into strict v_huidig
    from public.fonds_feature_flags
   where fonds_id = v_fonds and flag_key = 'generatie_timeout_ms'
   for update;

  if v_huidig not in ('120000'::jsonb, '240000'::jsonb) then
    raise exception '#438 max-effortrollback: onverwachte huidige waarde %', v_huidig;
  end if;

  update public.fonds_feature_flags
     set waarde = '120000'::jsonb,
         versie = versie + 1,
         bijgewerkt = now(),
         bijgewerkt_door = null
   where fonds_id = v_fonds
     and flag_key = 'generatie_timeout_ms'
     and waarde is distinct from '120000'::jsonb;
end $$;

commit;
