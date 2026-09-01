-- P3 / PR-D (#168) — decision_objects.status: kolomniveau-revoke. Besluit 0193.
-- ---------------------------------------------------------------------------
-- Reviewbevinding vraag 2 (BLOKKEREND). De motivering is de énige controle op een
-- besluit-met-open. Zonder deze revoke is hij leeg: RLS op decision_objects is
-- `for all` met alleen fondsisolatie (geen rol/capability, geen statusconditie), en
-- `authenticated` heeft een tabel-brede UPDATE-grant. Elk fondslid kan dan met een
-- directe PostgREST-update `status` op `besloten` zetten — buiten de route én buiten
-- fn_besluit_status_omslag om — zonder capability, motivering of het eigen slot; de
-- snapshot-trigger verzegelt er gewoon een afschrift bij.
--
-- Remedie (declaratief privilege, geen conventie/GUC — zelfde voorkeur als de
-- composite FK op governance_events): trek de tabel-brede UPDATE in en geef UPDATE
-- op álle kolommen BEHALVE `status` terug. Een tabel-brede grant kun je in Postgres
-- niet per kolom uitzonderen; daarom eerst intrekken, dan de rest her-verlenen. Een
-- directe update op `status` faalt daarna met een privilegefout (42501), ongeacht
-- wat de aanroeper meestuurt. fn_besluit_status_omslag is SECURITY DEFINER en draait
-- als owner (postgres) — die houdt het recht en blijft het enige pad naar `status`.
-- service_role en de owner blijven ongemoeid (bewust: server-/adminpaden).
--
-- Geverifieerd vóór toepassing (Q2, punt 1): het ENIGE pad dat
-- decision_objects.status als `authenticated` schreef, was de statusroute — die gaat
-- nu via de RPC. De PATCH-decisionroute weigert `status` expliciet en raakt alleen
-- de overige kolommen; migraties/seeds draaien als owner. Niets legitiems breekt.
--
-- LET OP — grant-drift: een later toegevoegde kolom valt fail-closed uit deze
-- her-grant (authenticated kan 'm niet updaten tot de grant is bijgewerkt). Dat is
-- de veilige kant, maar moet bewaakt worden. De bredere tabel-tegenhanger van dit
-- defect (procedure_stappen, procedure_besluiten, de overige decision_objects-
-- kolommen) staat als eigen tranche in #214 — NIET meeliftend op P3.
--
-- HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_28_p3d_03_status_kolomrevoke_ROLLBACK.sql

begin;

revoke update on public.decision_objects from authenticated;

grant update (
  id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, aanleiding, scope,
  governance_orgaan, vertrouwelijkheid, complexiteit, risiconiveau, mandaatgevoelig,
  toezichtgevoelig, beleidsafwijking, ai_risicoklasse, is_primary_decision,
  eigenaar_id, eigenaar_naam, template_versie, gewenste_besluitdatum,
  aangemaakt_op, laatst_gewijzigd
) on public.decision_objects to authenticated;

commit;
