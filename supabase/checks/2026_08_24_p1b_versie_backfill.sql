-- P1b (#166) — regressie- + immutabiliteitscheck voor versievastheid (I7).
-- ---------------------------------------------------------------------------
-- Draai tegen de DOEL-DB NÁ de migratie 2026_08_24_p1b_versievastheid.sql.
-- Faalt LUID bij een fout; anders stil (alleen NOTICE's). Wijzigt niets.
--
-- Waarom een eigen check en niet de karakterisering: de karakteriseringsseed
-- draait template_code 'beleidswijziging'/'algemeen' — beide ZONDER requirement-
-- rijen. Een verkeerde versie-backfill verplaatst daar dus GEEN snapshot; die
-- harnas is voor dit pad blind. Deze check dekt precies het gat: de twee codes
-- die requirements dragen (pf_wtp_invaarbesluit@2.0.0, beleidswijziging_
-- beleggingsbeleid@1.0.0).

-- ── A. Backfill-consistentie (de "evenveel vereisten vóór en ná"-invariant).
do $$
declare
  v_null_req  int;
  v_null_proc int;
  v_mismatch  int;
  v_invaar    int;
begin
  -- (a) geen NULL template_versie op requirements
  select count(*) into v_null_req
    from public.procedure_requirements where template_versie is null;
  if v_null_req > 0 then
    raise exception 'P1b-check: % procedure_requirements zonder template_versie', v_null_req;
  end if;

  -- (a2) geen NULL op een procedure waarvan de code requirements draagt
  --   (procedures.template_versie mag null zijn in het deploy-venster, maar niet
  --    voor een bestaande procedure van een code mét requirements).
  select count(*) into v_null_proc
    from public.procedures p
   where p.template_versie is null
     and exists (
       select 1 from public.procedure_requirements r
        where r.template_code = p.template_code);
  if v_null_proc > 0 then
    raise exception 'P1b-check: % procedures zonder template_versie terwijl hun code requirements draagt', v_null_proc;
  end if;

  -- (b) per procedure: telling via code == telling via (code, versie). Nul
  --   verschil bewijst dat de drie-tabellen-backfill consistent is — een fout
  --   getagde procedure (bv. invaar op 1.0.0) zou hier code-telling <> versie-
  --   telling geven, precies de stille "lege groene bewijslast".
  select count(*) into v_mismatch
    from public.procedures p
   where p.template_versie is not null
     and (select count(*) from public.procedure_requirements r
           where r.template_code = p.template_code)
      <> (select count(*) from public.procedure_requirements r
           where r.template_code = p.template_code
             and r.template_versie = p.template_versie);
  if v_mismatch > 0 then
    raise exception 'P1b-check: % procedures waar de versie-gefilterde requirement-telling afwijkt van de code-telling (backfill inconsistent)', v_mismatch;
  end if;

  -- (c) invaar 2.0.0 draagt zijn volledige requirementset (uit de definitie: 63).
  select count(*) into v_invaar
    from public.procedure_requirements
   where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0';
  if v_invaar <> 63 then
    raise exception 'P1b-check: pf_wtp_invaarbesluit@2.0.0 heeft % requirements, verwacht 63', v_invaar;
  end if;

  raise notice 'P1b-A groen: geen null-versies, backfill consistent, invaar@2.0.0 = 63.';
end $$;

-- ── B. Immutabiliteit: elke mutatie op een gepubliceerde versie moet falen.
--   Drie negatieve controles (update / delete / insert). De trigger weigert
--   vóórdat er iets verandert; de exception wordt hier gevangen zodat de check
--   niets muteert. Verwacht is 'onveranderlijk' (I7) in de foutmelding.
do $$
begin
  -- UPDATE
  begin
    update public.procedure_requirements set label = label
     where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0';
    raise exception 'P1b-check FAALT: UPDATE op gepubliceerde versie werd NIET geweigerd';
  exception when others then
    if position('onveranderlijk' in sqlerrm) = 0 then raise; end if;
    raise notice 'UPDATE correct geweigerd.';
  end;
  -- DELETE
  begin
    delete from public.procedure_requirements
     where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0'
       and stap_volgorde = 1;
    raise exception 'P1b-check FAALT: DELETE op gepubliceerde versie werd NIET geweigerd';
  exception when others then
    if position('onveranderlijk' in sqlerrm) = 0 then raise; end if;
    raise notice 'DELETE correct geweigerd.';
  end;
  -- INSERT (een nieuwe vereiste toevoegen aan een bevroren versie)
  begin
    insert into public.procedure_requirements
      (template_code, template_versie, stap_volgorde, requirement_type, label)
    values ('pf_wtp_invaarbesluit', '2.0.0', 1, 'document', '__p1b_check_insert__');
    raise exception 'P1b-check FAALT: INSERT in gepubliceerde versie werd NIET geweigerd';
  exception when others then
    if position('onveranderlijk' in sqlerrm) = 0 then raise; end if;
    raise notice 'INSERT correct geweigerd.';
  end;
  raise notice 'P1b-B groen: update/delete/insert op gepubliceerde versie alle drie geweigerd.';
end $$;

-- ── C. Het publicatieregister is zelf append-only (ontpubliceren bestaat niet) —
--   inclusief TRUNCATE, dat de row-trigger niet vuurt maar de statement-trigger wel.
do $$
begin
  begin
    delete from public.procedure_definitie_publicatie
     where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0';
    raise exception 'P1b-check FAALT: DELETE op het publicatieregister werd NIET geweigerd';
  exception when others then
    if position('append-only' in sqlerrm) = 0 then raise; end if;
    raise notice 'Register-DELETE correct geweigerd (append-only).';
  end;
  begin
    truncate table public.procedure_definitie_publicatie;
    raise exception 'P1b-check FAALT: TRUNCATE op het publicatieregister werd NIET geweigerd (stille mass-ontpublicatie mogelijk)';
  exception when others then
    if position('append-only' in sqlerrm) = 0 then raise; end if;
    raise notice 'Register-TRUNCATE correct geweigerd (append-only).';
  end;
  raise notice 'P1b-C groen: publicatieregister is append-only (delete + truncate).';
end $$;

-- ── D. Detectiecontrole: de grendel bestaat. Een latere migratie die een trigger
--   of functie stil dropt, valt hier luid op (het hand-applied restrisico uit 0188).
do $$
declare v_ontbreekt text := '';
begin
  if to_regclass('public.procedure_definitie_publicatie') is null then
    v_ontbreekt := v_ontbreekt || ' tabel:procedure_definitie_publicatie';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_procedure_requirements_versievast') then
    v_ontbreekt := v_ontbreekt || ' fn:fn_procedure_requirements_versievast';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_publicatie_append_only') then
    v_ontbreekt := v_ontbreekt || ' fn:fn_publicatie_append_only';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_req_versievast' and not tgisinternal) then
    v_ontbreekt := v_ontbreekt || ' trigger:trg_req_versievast';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_publicatie_append_only' and not tgisinternal) then
    v_ontbreekt := v_ontbreekt || ' trigger:trg_publicatie_append_only';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_publicatie_geen_truncate' and not tgisinternal) then
    v_ontbreekt := v_ontbreekt || ' trigger:trg_publicatie_geen_truncate';
  end if;
  if v_ontbreekt <> '' then
    raise exception 'P1b-check: I7-grendel incompleet — ontbreekt:%', v_ontbreekt;
  end if;
  raise notice 'P1b-D groen: alle I7-triggers en -functies aanwezig.';
end $$;
