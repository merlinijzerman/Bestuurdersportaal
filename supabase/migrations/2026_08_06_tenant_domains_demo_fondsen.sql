-- ============================================================================
-- Migratie 2026-08-06 — tenant_domains: host per demo-fonds
-- ----------------------------------------------------------------------------
-- WAAROM: elk fonds krijgt een eigen subdomein (besluit 0135). De server-side
-- tenant-resolver leidt de fondscontext af uit de request-host via deze tabel;
-- zonder rij resolveert een host als `onbekend` en zou TENANT_ENFORCE=on de
-- gebruikers van dat fonds buitensluiten. Deze seed is dus een HARDE GATE vóór
-- enforce (zelfde redenering als 2026_07_08_tenant_domains_seed.sql).
--
-- FONDSVERWIJZING VIA slug, NIET via UUID: productie-UUID's staan bewust niet in
-- de repo. Bestaat de fondsrij niet, dan inserteert dit NIETS — fail-safe, geen
-- kapotte FK, maar ook geen zichtbare fout. Draai daarom altijd de controle-
-- query onderaan; een stille no-op is hier het faalpad.
--
-- HOST GENORMALISEERD: lowercase, geen poort, geen leidende `www.` — identiek
-- contract als lib/tenant-host.ts / lib/platform-host.ts (normaliseerHost).
--
-- APP-HOST BLIJFT: `app.bestuurdersportaal.com -> horizon` wordt NIET verwijderd.
-- De waarschuwing in 2026_07_08_tenant_domains_bridge_app_host.sql ("verwijder
-- deze rij vóór fonds 2") gold voor een GEDEELDE app-host. Met een eigen
-- subdomein per fonds is die host uitsluitend van Horizon; besluit 0135 herziet
-- de reikwijdte expliciet en houdt de bestaande login-URL intact.
--
-- Idempotent (on conflict (host) do nothing). Transactioneel.
-- ROLLBACK: 2026_08_06_tenant_domains_demo_fondsen_ROLLBACK.sql
-- TENANT-IMPACT: additief; raakt geen bestaande host of policy. Zolang
-- TENANT_ENFORCE uit staat verandert dit gedrag niets — de resolver logt dan
-- alleen (observe, besluit 0041).
-- VOLGORDE: draai eerst 2026_08_06_demo_fondsen_bootstrap.sql.
-- ============================================================================

begin;

insert into public.tenant_domains (host, fonds_id, actief)
select h.host, f.id, true
  from (values
          ('pgb.bestuurdersportaal.com',                'pgb'),
          ('phenc.bestuurdersportaal.com',              'phenc'),
          ('huisartsenpensioen.bestuurdersportaal.com', 'huisartsenpensioen')
       ) as h(host, slug)
  join public.fondsen f on f.slug = h.slug
 on conflict (host) do nothing;

commit;

-- ============================================================================
-- CONTROLE — draai dit altijd na de migratie.
-- Verwacht: vijf rijen (app + horizon voor Horizon, plus de drie nieuwe).
-- Ontbreekt een van de drie, dan bestond de fondsrij niet en heeft de insert
-- stil niets gedaan → eerst de bootstrapmigratie draaien.
-- ============================================================================
-- select d.host, d.actief, f.slug, f.naam
--   from public.tenant_domains d
--   join public.fondsen f on f.id = d.fonds_id
--  order by f.slug, d.host;
