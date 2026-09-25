-- #428 PREVIEW ONLY: raakt uitsluitend de exacte Previewbinding.
begin;
do $$
declare v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains where host='app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains where host like '%.bestuurdersportaal.com' and host not like '%.preview.bestuurdersportaal.com')
  then raise exception '#428 verkeerde doelomgeving voor Previewrollback'; end if;
  select id into strict v_fonds from public.fondsen where slug='m365-demo';
  if exists (select 1 from public.tenant_domains where host='app365.preview.bestuurdersportaal.com' and fonds_id<>v_fonds)
  then raise exception '#428 drift: Previewhost wijst naar ander fonds'; end if;
  delete from public.tenant_domains where host='app365.preview.bestuurdersportaal.com' and fonds_id=v_fonds;
  if exists (select 1 from public.tenant_domains where host='app365.preview.bestuurdersportaal.com')
  then raise exception '#428 Previewrollback onvolledig'; end if;
end $$;
commit;
