-- #428 Fase 3 — read-only self-check van het synthetische Production-demopakket.
begin read only;

do $$
declare v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains where host='app.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains where host like '%.preview.bestuurdersportaal.com')
  then raise exception '#428 demo-check: doelomgeving is niet aantoonbaar Production'; end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';
  if not exists (select 1 from public.tenant_domains
      where host='app365.bestuurdersportaal.com' and fonds_id=v_fonds and actief)
     or exists (select 1 from public.tenant_domains where host='app365.preview.bestuurdersportaal.com')
  then raise exception '#428 demo-check: exacte Production-hostisolatie faalt'; end if;

  if (select count(*) from public.fonds_module_manifest
      where fonds_id = v_fonds and actief
        and module_key in ('home','ai','bibliotheek','vergaderingen','notulen',
          'procedures','risicomatrix','beheer','governance','assurance')) <> 10
     or exists (select 1 from public.fonds_module_manifest
      where fonds_id = v_fonds and actief
        and module_key not in ('home','ai','bibliotheek','vergaderingen','notulen',
          'procedures','risicomatrix','beheer','governance','assurance'))
  then raise exception '#428 demo-check: actieve modulematrix wijkt af'; end if;

  if (select count(*) from public.documenten
      where fonds_id = v_fonds and id in
        ('42800000-0000-0000-0000-000000000101','42800000-0000-0000-0000-000000000102')
        and titel like 'SYNTHETISCH — %' and geindexeerd and actief) <> 2
  then raise exception '#428 demo-check: documenten ontbreken of wijken af'; end if;

  if (select count(*) from public.document_chunks c join public.documenten d on d.id=c.document_id
      where d.fonds_id = v_fonds and c.id in
        ('42800000-0000-0000-0000-000000000111','42800000-0000-0000-0000-000000000112')
        and c.tekst like 'SYNTHETISCH%') <> 2
  then raise exception '#428 demo-check: documentchunks ontbreken of wijken af'; end if;

  if not exists (select 1 from public.vergaderingen where id='42800000-0000-0000-0000-000000000201' and fonds_id=v_fonds)
     or (select count(*) from public.agendapunten where vergadering_id='42800000-0000-0000-0000-000000000201') <> 2
  then raise exception '#428 demo-check: vergadering of agenda ontbreekt'; end if;

  if not exists (select 1 from public.procedures where id='42800000-0000-0000-0000-000000000301' and fonds_id=v_fonds)
     or not exists (select 1 from public.risicos where id='42800000-0000-0000-0000-000000000401' and fonds_id=v_fonds)
  then raise exception '#428 demo-check: procedure of risico ontbreekt'; end if;

  if exists (select 1 from public.fonds_feature_flags where fonds_id=v_fonds
      and flag_key like 'microsoft_%' and waarde <> 'false'::jsonb)
     or exists (select 1 from public.fonds_microsoft_login
      where fonds_id=v_fonds and (modus <> 'uit' or actief or entra_tenant_id is not null))
  then raise exception '#428 demo-check: Microsoft staat niet volledig uit'; end if;
end $$;

select jsonb_build_object(
  'omgeving', 'production',
  'fonds', 'm365-demo',
  'host', 'app365.bestuurdersportaal.com',
  'synthetische_documenten', 2,
  'vergaderingen', 1,
  'agendapunten', 2,
  'procedures', 1,
  'risicos', 1,
  'microsoft', 'uit'
) as app365_demo_check;

rollback;
