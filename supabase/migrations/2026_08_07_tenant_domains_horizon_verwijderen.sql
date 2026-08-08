-- ============================================================================
-- Opruiming: dode host horizon.bestuurdersportaal.com uit tenant_domains.
-- ----------------------------------------------------------------------------
-- WAAROM (besluit 0135 — "latere opruimactie", nu uitgevoerd 2026-08-07):
--   Horizon draait op app.bestuurdersportaal.com (bridge-rij 2026_07_08). De
--   per-fonds-host horizon.bestuurdersportaal.com is nooit in gebruik genomen:
--   de DNS wijst wél naar Vercel maar er hangt geen project/cert achter, dus de
--   HTTPS-handshake wordt afgebroken. De rij mapte naar hetzelfde fonds als
--   app.* en is daarmee een dode dubbel. Deze verstoorde óók de P5-uptimemeting
--   zolang APP_HOST (beheer) die host probede.
--
--   NB (buiten deze migratie, in Vercel — niet via SQL te doen): (1) beheer-
--   project APP_HOST → app.bestuurdersportaal.com; (2) de horizon A-records uit
--   Vercel DNS (Domains → bestuurdersportaal.com → DNS Records) verwijderen.
--
--   De bridge-rij app.bestuurdersportaal.com → Horizon BLIJFT staan; dit raakt
--   de app niet. Idempotent. EERST in Supabase draaien, dán deploy.
-- ROLLBACK: onderaan (herstelt de seed-rij via fondsen.slug='horizon').
-- ============================================================================

delete from public.tenant_domains
where host = 'horizon.bestuurdersportaal.com';

-- ── Verificatie (informatief) ───────────────────────────────────────────────
do $$
begin
  raise notice 'tenant_domains na opruiming: % rij(en) voor horizon.bestuurdersportaal.com.',
    (select count(*) from public.tenant_domains where host = 'horizon.bestuurdersportaal.com');
end $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Herstelt de seed uit 2026_07_08_tenant_domains_seed.sql (geen UUID in de repo).
-- insert into public.tenant_domains (host, fonds_id, actief)
-- select 'horizon.bestuurdersportaal.com', f.id, true
--   from public.fondsen f
--  where f.slug = 'horizon'
-- on conflict (host) do nothing;
