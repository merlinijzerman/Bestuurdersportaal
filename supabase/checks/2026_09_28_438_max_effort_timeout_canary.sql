-- #438 — READ-ONLY postcheck voor het Preview max-effortbudget.
do $$
declare
  v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then raise exception '#438 max-effortcheck: verkeerde doelomgeving'; end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';

  if not exists (select 1 from public.fonds_feature_flags
                  where fonds_id = v_fonds
                    and flag_key = 'generatie_timeout_ms'
                    and waarde = '240000'::jsonb)
  then raise exception '#438 max-effortcheck: m365-demo staat niet op 240000 ms'; end if;

  if exists (select 1 from public.fondsen f
              join public.fonds_feature_flags ff on ff.fonds_id = f.id
             where f.slug <> 'm365-demo'
               and ff.flag_key = 'generatie_timeout_ms'
               and ff.waarde = '240000'::jsonb)
  then raise exception '#438 max-effortcheck: 240000 ms is buiten m365-demo gezet'; end if;
end $$;
