-- ============================================================================
-- Migratie 2026-08-20 (C-01) — schrijfrechten op views intrekken
-- ----------------------------------------------------------------------------
-- WAAROM. `public.vw_fondsleden` is een DEFINER-view (`security_invoker=false`)
-- op `profielen`, met dezelfde eigenaar als de onderliggende tabel. De migratie
-- die de view aanmaakt (2026_08_02_fondsleden_view.sql) verleent uitsluitend
-- SELECT, maar in de feitelijke databasestand had `authenticated` er ook
-- INSERT, UPDATE en DELETE op. Oorzaak is niet de migratie maar het platform:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO authenticated;
--
-- Die default-ACL geldt voor ELK nieuw object in `public` — ook voor views.
-- Het `revoke all … from public` in de aanmaakmigratie raakt alleen de
-- pseudo-rol PUBLIC en haalt deze expliciete grants dus niet weg (bevinding
-- H-18, dezelfde valkuil als bij de EXECUTE-grants op functies).
--
-- WAAROM DAT ERNSTIG IS. De view is auto-updatable (één SELECT op één tabel,
-- geen join/aggregatie/DISTINCT) en heeft GEEN `WITH CHECK OPTION`. Omdat de
-- eigenaar van de view ook eigenaar van `profielen` is en `FORCE ROW LEVEL
-- SECURITY` nergens aanstaat, gelden de RLS-policies op `profielen` NIET voor
-- schrijfacties die via de view lopen. `profielen` draagt zowel `fonds_id` (de
-- tenantsleutel) als `rol` (de autorisatiesleutel). Twee paden zijn empirisch
-- nagespeeld op een niet-superuser, niet-bypassrls eigenaar:
--   1. UPDATE van de rij van een fondsgenoot naar rol='beheerder' en een vreemd
--      fonds_id — de bevriezingstrigger op profielen is BEFORE UPDATE en alleen
--      actief bij auth.uid() = old.id, en vuurt hier dus niet.
--   2. DELETE van de eigen rij + INSERT met een vreemd fonds_id — volledige
--      tenant-hop, end-to-end aangetoond.
--
-- `vw_dossier_status` heeft dezelfde grantdrift maar WEL invoker-semantiek: daar
-- is het geen RLS-bypass, alleen onbedoeld recht. Het staat hier omdat het
-- dezelfde oorzaak en dezelfde oplossing heeft. Bovendien had `anon` er SELECT
-- op zonder dat enige publieke pagina de view leest (de drie leespaden lopen
-- alle via een ingelogde sessie) — die grant gaat mee weg.
--
-- WAT DEZE MIGRATIE NIET DOET, EN WAAROM NIET.
--  • `ALTER DEFAULT PRIVILEGES` blijft ongemoeid. Dat raakt alleen TOEKOMSTIGE
--    objecten en lost het huidige probleem dus niet op; bovendien is het een
--    werkstroomwijziging (elke nieuwe tabel heeft dan een expliciete grant
--    nodig, en vergeten = kapotte feature). Die afweging hoort bij V3, waar een
--    gate je vertelt wanneer een grant ontbreekt.
--  • `FORCE ROW LEVEL SECURITY` op `profielen` blijft eruit. Dat is de
--    structurele fix en een aparte, apart testbare wijziging: V2.
--  • MAINTAIN blijft staan waar het stond. Dat recht dekt VACUUM/ANALYZE/
--    REINDEX en is geen datapad; het uit de default-ACL wegnemen hoort bij V3.
--
-- REGRESSIEBORGING. De `revoke` zelf is vijf minuten werk; zonder gekoppelde
-- controle is hij over zes weken opnieuw nodig. Daarom toetst
-- `supabase/checks/2026_08_02_fondsleden_cross_tenant.sql` sinds deze wijziging
-- óók INSERT/UPDATE/DELETE (V7–V9) én, generiek, dat GEEN ENKELE view in
-- `public` schrijfrechten heeft voor `anon`/`authenticated` (V10). Die suite is
-- tegelijk in `scripts/cross-tenant-ci.sh` geregistreerd — daarvoor draaide hij
-- in geen enkele CI-job.
--
-- Idempotent en transactioneel (revoke van een niet-bestaand recht is een no-op).
-- ROLLBACK: supabase/rollbacks/2026_08_20_c01_view_schrijfrechten_ROLLBACK.sql —
-- let op de waarschuwing in dat bestand: terugdraaien herstelt de kwetsbaarheid.
-- ============================================================================

begin;

-- ── vw_fondsleden — definer-view op profielen: RLS-bypass bij schrijven ─────
revoke insert, update, delete on public.vw_fondsleden from authenticated;
revoke all on public.vw_fondsleden from anon;
revoke all on public.vw_fondsleden from public;
-- SELECT is de bedoelde functie van de view (besluit 0102); expliciet
-- herbevestigd zodat deze migratie de gewenste eindtoestand volledig beschrijft.
grant select on public.vw_fondsleden to authenticated;

-- ── vw_dossier_status — invoker-view: geen bypass, wel onbedoeld recht ──────
revoke insert, update, delete on public.vw_dossier_status from authenticated;
revoke all on public.vw_dossier_status from anon;
revoke all on public.vw_dossier_status from public;
grant select on public.vw_dossier_status to authenticated;

-- ── vw_governance_audit — bewust ONGEWIJZIGD ───────────────────────────────
-- Deze definer-view heeft al géén grant voor anon/authenticated (migratie
-- 2026_08_04_a2_audit_least_privilege.sql trok ze alle drie in). Het enige pad
-- is de definer-RPC die de inzage logt. De controle hieronder bewaakt dat.

-- ── Verificatie in dezelfde transactie: eindtoestand of niets ──────────────
do $$
declare
  probleem text;
begin
  -- Geen schrijfrechten voor browserrollen op de twee views.
  select string_agg(format('%s heeft %s op %s', r.rol, p.recht, c.relname), '; '
                    order by c.relname, r.rol, p.recht)
    into probleem
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join lateral (values ('anon'), ('authenticated')) as r(rol)
   cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(recht)
   where c.relname in ('vw_fondsleden', 'vw_dossier_status', 'vw_governance_audit')
     and has_table_privilege(r.rol::name, c.oid, p.recht);

  if probleem is not null then
    raise exception 'C01 FAALT: schrijfrecht op view blijft staan — %', probleem;
  end if;

  -- anon leest geen van de drie views.
  select string_agg(format('anon heeft SELECT op %s', c.relname), '; ' order by c.relname)
    into probleem
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relname in ('vw_fondsleden', 'vw_dossier_status', 'vw_governance_audit')
     and has_table_privilege('anon', c.oid, 'SELECT');

  if probleem is not null then
    raise exception 'C01 FAALT: %', probleem;
  end if;

  -- Positieve controle: het bedoelde leespad blijft bestaan. Zonder deze toets
  -- zou een te brede revoke stil /procedures/nieuw en de dossieroverzichten
  -- breken en toch groen afsluiten.
  if not has_table_privilege('authenticated', 'public.vw_fondsleden', 'SELECT') then
    raise exception 'C01 FAALT: authenticated heeft geen SELECT meer op vw_fondsleden.';
  end if;
  if not has_table_privilege('authenticated', 'public.vw_dossier_status', 'SELECT') then
    raise exception 'C01 FAALT: authenticated heeft geen SELECT meer op vw_dossier_status.';
  end if;

  -- vw_governance_audit blijft dicht voor beide browserrollen.
  if has_table_privilege('authenticated', 'public.vw_governance_audit', 'SELECT') then
    raise exception 'C01 FAALT: authenticated heeft SELECT op vw_governance_audit '
                    '(hoort alleen via de definer-RPC te lopen, migratie A2).';
  end if;
end $$;

commit;

-- ── Verificatie (handmatig ná de migratie, zelfde query als de nulmeting) ───
-- select c.relname,
--        g.grantee,
--        string_agg(g.privilege_type, ',' order by g.privilege_type) as rechten
--   from information_schema.role_table_grants g
--   join pg_class c on c.relname = g.table_name
--   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--  where g.table_schema = 'public'
--    and c.relkind in ('v','m')
--    and g.grantee in ('anon','authenticated')
--  group by 1,2
--  order by 1,2;
-- Verwacht: uitsluitend vw_fondsleden|authenticated|MAINTAIN,SELECT en
--           vw_dossier_status|authenticated|MAINTAIN,SELECT. Geen anon-regel,
--           geen vw_governance_audit-regel.
