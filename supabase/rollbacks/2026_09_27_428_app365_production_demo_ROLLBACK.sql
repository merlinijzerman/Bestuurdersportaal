-- #428 Fase 3 — uitsluitend het synthetische app365 Productionpakket terugdraaien.
-- Uitvoering vereist een apart rollbackakkoord; accounts en fondsconfig blijven staan.
begin;

do $$
declare v_fonds uuid;
begin
  if not exists (select 1 from public.tenant_domains where host='app.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains where host like '%.preview.bestuurdersportaal.com')
  then raise exception '#428 demo-rollback: doelomgeving is niet aantoonbaar Production'; end if;

  select id into strict v_fonds from public.fondsen where slug='m365-demo';
  if not exists (select 1 from public.tenant_domains
      where host='app365.bestuurdersportaal.com' and fonds_id=v_fonds and actief)
     or exists (select 1 from public.tenant_domains where host='app365.preview.bestuurdersportaal.com')
  then raise exception '#428 demo-rollback: exacte Production-hostisolatie faalt'; end if;

  delete from public.document_agendapunten where id='42800000-0000-0000-0000-000000000221' and fonds_id=v_fonds;
  delete from public.documenten where fonds_id=v_fonds and id in
    ('42800000-0000-0000-0000-000000000101','42800000-0000-0000-0000-000000000102');
  delete from public.risico_maatregelen m using public.risicos r
  where m.id='42800000-0000-0000-0000-000000000411'
    and m.risico_id=r.id and r.fonds_id=v_fonds;
  delete from public.risicos where id='42800000-0000-0000-0000-000000000401' and fonds_id=v_fonds;
  delete from public.procedures where id='42800000-0000-0000-0000-000000000301' and fonds_id=v_fonds;
  delete from public.vergaderingen where id='42800000-0000-0000-0000-000000000201' and fonds_id=v_fonds;

  update public.fonds_module_manifest
  set actief=false, versie=case when actief then versie+1 else versie end
  where fonds_id=v_fonds
    and module_key in ('ai','bibliotheek','vergaderingen','notulen','procedures','risicomatrix');
end $$;

commit;
