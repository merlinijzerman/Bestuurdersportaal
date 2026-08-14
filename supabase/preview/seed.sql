-- Preview-only omgevingsseed. Niet opnemen in de algemene migratiereeks:
-- Productie mag deze hosts nooit krijgen.
--
-- Voorwaarden:
--   1. alle reguliere migraties zijn succesvol toegepast;
--   2. auth.users en storage.objects zijn leeg;
--   3. Meridiaan en de drie fonds-previewtenants bestaan.

begin;

do $$
declare
  ontbrekende_slugs text[];
begin
  if exists (select 1 from auth.users) then
    raise exception 'Preview-seed geweigerd: auth.users is niet leeg';
  end if;
  if exists (select 1 from storage.objects) then
    raise exception 'Preview-seed geweigerd: storage.objects is niet leeg';
  end if;

  select array_agg(v.slug order by v.slug)
    into ontbrekende_slugs
    from (values
      ('meridiaan'),
      ('pgb'),
      ('phenc'),
      ('huisartsenpensioen')
    ) as v(slug)
   where not exists (select 1 from public.fondsen f where f.slug = v.slug);

  if ontbrekende_slugs is not null then
    raise exception 'Preview-seed geweigerd; ontbrekende fondsen: %',
      ontbrekende_slugs;
  end if;
end $$;

-- In het geïsoleerde Preview-project horen uitsluitend Previewhosts. Dit wist
-- ook productiehost-seeds die noodzakelijk in de gedeelde migratiereeks staan.
delete from public.tenant_domains;

insert into public.tenant_domains (host, fonds_id, actief)
select h.host, f.id, true
  from (values
    ('app.preview.bestuurdersportaal.com',                'meridiaan'),
    ('pgb.preview.bestuurdersportaal.com',                'pgb'),
    ('phenc.preview.bestuurdersportaal.com',              'phenc'),
    ('huisartsenpensioen.preview.bestuurdersportaal.com', 'huisartsenpensioen')
  ) as h(host, slug)
  join public.fondsen f on f.slug = h.slug;

do $$
declare
  werkelijk integer;
begin
  select count(*) into werkelijk from public.tenant_domains where actief;
  if werkelijk <> 4 then
    raise exception 'Preview-seed ongeldig: verwacht 4 actieve hosts, kreeg %',
      werkelijk;
  end if;

  if exists (
    select 1 from public.tenant_domains
     where host not like '%.preview.bestuurdersportaal.com'
  ) then
    raise exception 'Preview-seed ongeldig: niet-Previewhost aanwezig';
  end if;
end $$;

commit;
