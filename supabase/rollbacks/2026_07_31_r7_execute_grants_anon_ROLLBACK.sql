-- ============================================================================
--  ROLLBACK 2026-07-31 — R7: EXECUTE-rechten van anon op functies in `public`
--
--  ⚠️  Dit geeft de PUBLIEKE anon-rol weer EXECUTE op alle functies in `public`,
--  inclusief de vijf SECURITY DEFINER-RPC's die RLS volledig omzeilen:
--  aqlab_claim_run_jobs (evaluatiepijplijn stilleggen), aqlab_add_run_cost
--  (kostenplafond corrumperen), aqlab_log_download (append-only auditspoor
--  vervuilen), aqlab_assurance_meetwaarden en aqlab_audit_export_bron.
--
--  Twee migraties in deze repo stellen expliciet dat anon deze functies NIET mag
--  aanroepen (2026_07_10_aqlab_4_run_jobs.sql r.128 en
--  2026_07_12_d1b_assurance_rpcs.sql r.201). Deze rollback zet dus een toestand
--  terug die het project zelf nooit heeft bedoeld — hij bestond alleen doordat
--  `revoke ... from public` de expliciete anon-grant niet raakte.
--
--  Breekt er na R7 iets, zoek dan EERST welke rol de aanroeper gebruikt en geef
--  gericht aan díe rol terug. Deze rollback is het laatste redmiddel, niet de
--  eerste stap.
-- ============================================================================

begin;

-- Alleen de expliciet versmalde functies terug naar de vorige toestand.
grant execute on function public.aqlab_claim_run_jobs(text, integer, integer) to anon, authenticated;
grant execute on function public.aqlab_add_run_cost(uuid, numeric)            to anon, authenticated;
grant execute on function public.aqlab_log_download(uuid)                     to anon;
grant execute on function public.aqlab_assurance_meetwaarden(text[])          to anon;
grant execute on function public.aqlab_audit_export_bron(uuid)                to anon;
grant execute on function public.maak_profiel()                               to anon, authenticated;
grant execute on function public.fn_profiel_bevries_kolommen()                to anon, authenticated;

-- De sweep uit deel B in één keer terugdraaien.
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('grant execute on function public.%I(%s) to anon', r.proname, r.args);
  end loop;
end $$;

commit;
