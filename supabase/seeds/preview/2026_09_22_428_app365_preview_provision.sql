-- #428 PREVIEW ONLY. Runner + SQL-fingerprint zijn beide verplicht.
begin;
do $$
declare v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains where host like '%.bestuurdersportaal.com' and host not like '%.preview.bestuurdersportaal.com')
  then raise exception '#428 verkeerde doelomgeving: Preview-fingerprint ontbreekt of Production-host aangetroffen'; end if;
  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';
  if exists (select 1 from public.tenant_domains where host = 'app365.preview.bestuurdersportaal.com' and (fonds_id <> v_fonds or not actief))
  then raise exception '#428 Preview-host bestaat met verkeerde of inactieve binding'; end if;
  if exists (select 1 from public.tenant_domains where host = 'app365.bestuurdersportaal.com')
  then raise exception '#428 Production-app365-host staat in Preview'; end if;
  insert into public.tenant_domains (host, fonds_id, actief)
  values ('app365.preview.bestuurdersportaal.com', v_fonds, true)
  on conflict (host) do nothing;
  if not exists (select 1 from public.tenant_domains where host = 'app365.preview.bestuurdersportaal.com' and fonds_id = v_fonds and actief)
  then raise exception '#428 Preview-binding niet gerealiseerd'; end if;
end $$;
commit;
