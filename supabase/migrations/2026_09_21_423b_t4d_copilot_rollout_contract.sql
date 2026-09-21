-- ============================================================================
--  #423 T4-D — CONTRACT-stap (migratie B van twee)
-- ----------------------------------------------------------------------------
--  DRAAI DEZE NIET TEGELIJK MET MIGRATIE A.
--
--  Voorwaarde vóór uitvoeren, in deze volgorde:
--    1. migratie A (expand) is toegepast;
--    2. de applicatiedeploy die de NIEUWE signatuur gebruikt, is waargenomen;
--    3. er draait geen instantie meer op de oude signatuur. Toets dat aan een
--       verse koppeling: die moet een niet-lege client_id opleveren.
--
--  Zolang 2 en 3 niet zijn aangetoond blijft de oude signatuur staan. Hij is
--  veilig — hij schrijft client_id op NULL en is dus fail-closed voor de
--  Copilot-arm — alleen niet netjes. Te vroeg droppen breekt elke lopende
--  Microsoft-koppeling, ook die van Outlook en SharePoint.
--
--  IDEMPOTENT: ja.
-- ============================================================================

drop function if exists microsoft_private.bewaar_koppeling(
  uuid, uuid, text, text, text, text, text, text[], integer, text, text, text
);

-- De grant verdwijnt met de functie; expliciet niets meer in te trekken.
-- Na deze stap bestaat er nog maar één signatuur, en die schrijft altijd een
-- client-id.
do $$
begin
  if (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling') <> 1 then
    raise exception 'na de contract-stap hoort er exact één bewaar_koppeling-signatuur te bestaan';
  end if;
end $$;
