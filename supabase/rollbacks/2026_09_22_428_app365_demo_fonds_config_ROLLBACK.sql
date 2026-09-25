-- #428 gedeelde rollback — disable-first, auditbehoudend.
-- De fondsrij wordt BEWUST niet verwijderd: fonds_config_log is append-only en
-- heeft ON DELETE CASCADE; verwijderen zou audit wissen. Environmentrollbacks
-- verwijderen eerst de afzonderlijke hostbinding. Gebruikte tenants blijven als
-- inert fonds bewaard.
begin;

do $$
declare v_fonds uuid;
begin
  select id into v_fonds from public.fondsen where slug = 'm365-demo';
  if v_fonds is null then return; end if;
  if exists (select 1 from public.tenant_domains where fonds_id = v_fonds)
     or exists (select 1 from public.profielen where fonds_id = v_fonds)
     or exists (select 1 from public.documenten where fonds_id = v_fonds)
  then
    raise exception '#428 rollback geblokkeerd: verwijder eerst omgevingbindings; profielen/documenten vereisen afzonderlijke retentiebeoordeling';
  end if;

  update public.fonds_microsoft_login
     set modus = 'uit', actief = false, entra_tenant_id = null
   where fonds_id = v_fonds
     and (modus <> 'uit' or actief or entra_tenant_id is not null);

  update public.fonds_integratie_profielen
     set integratieprofiel = 'eigen', microsoft_koppeling_pilot = false, bijgewerkt = now()
   where fonds_id = v_fonds
     and (integratieprofiel <> 'eigen' or microsoft_koppeling_pilot);

  update public.fonds_module_manifest
     set actief = false, versie = versie + 1, bijgewerkt = now(), bijgewerkt_door = null
   where fonds_id = v_fonds
     and module_key in ('stuurinformatie','klantbeeld','ai','bibliotheek','vergaderingen','notulen','procedures','risicomatrix')
     and actief;

  update public.fonds_feature_flags
     set waarde = 'false'::jsonb, versie = versie + 1, bijgewerkt = now(), bijgewerkt_door = null
   where fonds_id = v_fonds
     and flag_key in ('microsoft_copilot_retrieval','microsoft_sharepoint_retrieval_spike',
       'microsoft_sharepoint_fase3','microsoft_outlook_fase2a','hybride_zoeken','rerank',
       'relevantie_drempel','jargon_expansie','parent_retrieval','vraagrouter_v2',
       'vraagrouter_model','volledige_analyse_vervolg')
     and waarde is distinct from 'false'::jsonb;
end $$;

commit;
