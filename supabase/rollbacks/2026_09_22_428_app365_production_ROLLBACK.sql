-- #428 PRODUCTION ONLY: raakt uitsluitend de exacte Productionbinding.
begin;
do $$
declare v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains where host='app.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains where host like '%.preview.bestuurdersportaal.com')
  then raise exception '#428 verkeerde doelomgeving voor Productionrollback'; end if;
  select id into strict v_fonds from public.fondsen where slug='m365-demo';
  if exists (select 1 from public.tenant_domains where host='app365.bestuurdersportaal.com' and fonds_id<>v_fonds)
  then raise exception '#428 drift: Productionhost wijst naar ander fonds'; end if;
  delete from public.tenant_domains where host='app365.bestuurdersportaal.com' and fonds_id=v_fonds;
  if exists (select 1 from public.tenant_domains where host='app365.bestuurdersportaal.com')
  then raise exception '#428 Productionrollback onvolledig'; end if;
end $$;
commit;
