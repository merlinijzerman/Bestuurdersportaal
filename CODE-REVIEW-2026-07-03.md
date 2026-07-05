# Code review Bestuurdersportaal MVP — 3 juli 2026

**Scope:** volledige mvp-codebase — app/, lib/, components/, middleware, next.config, supabase/migrations (forward + rollback), schema.sql, dependencies.
**Methode:** drie parallelle deelreviews (security applicatielaag, database/RLS, codekwaliteit/architectuur); alle kritieke en hoge bevindingen zijn daarna handmatig geverifieerd tegen de code (bestand + regelnummer). Bewust openstaande werkpakketten uit SECURITY-ROUTE-A-PLAN.md (WP3/WP4/WP5) zijn alleen opgenomen als context, niet als nieuwe bevinding.
**Status:** aanbevelingenlog voor prioritering in een volgende release. Severity: Kritiek / Hoog / Middel / Laag. Per bevinding: feit vs. inschatting.
**Fixes:** de met ✅ gemarkeerde bevindingen zijn op 3 juli 2026 direct gefixt — zie `supabase/migrations/2026_07_03_security_hardening.sql` en §Fixes onderaan.

---

## Managementsamenvatting

De codebase is voor een MVP van bovengemiddelde kwaliteit: strict TypeScript zonder één `any` in ±57.000 regels, RLS aan op alle tabellen, fail-closed rate limiting, consequente HTML-escaping in het auditdossier (112× `esc()`), volledige security headers incl. CSP, service-role-key strikt beperkt tot twee lib-bestanden, en een sterk `withPlatform`-wrapperpatroon met capability-checks en audit.

Daar staan **drie kritieke gaten** tegenover: twee RLS-gaten die de tenant-isolatie — de belangrijkste guardrail — doorbreken (K1, K2) en een vrij beschrijfbaar audit-/readinessspoor (K3). Daarnaast is de append-only garantie op de meeste `*_log`-tabellen niet technisch afgedwongen (H1), faalt `tsc` op dit moment (H5) en draait er geen enkele geautomatiseerde verificatie: geen testrunner, geen CI (H6). K1–K3, H1, H3 en H5 zijn direct gefixt; de rest is gelogd voor de volgende release.

| Severity | Aantal | Waarvan direct gefixt |
|---|---|---|
| Kritiek | 3 | 3 |
| Hoog | 8 | 3 |
| Middel | 12 | 0 |
| Laag | 8 | 0 |

---

## Kritiek

### K1 ✅ — Gebruiker kan eigen `fonds_id` en `rol` wijzigen: tenant-hop + privilege-escalatie
- **Waar:** `supabase/schema.sql` r.497–499: `create policy "eigen profiel" on profielen for all using (auth.uid() = id)`. Geen enkele migratie corrigeert dit (geverifieerd over alle SQL-bestanden). **Feit.**
- **Risico:** FOR ALL zonder WITH CHECK toetst alleen `id`, niet de inhoud. Een ingelogde gebruiker kan via PostgREST zijn eigen rij UPDATEn: `rol='beheerder'` (ontgrendelt alle rolchecks in RLS én API) en `fonds_id=<ander fonds>` (tenant-hop: vrijwel alle isolatie-policies sleutelen op `(select fonds_id from profielen where id = auth.uid())`). Fonds-UUID's zijn vrij opvraagbaar via policy "fondsen lezen" `using (true)` (schema.sql r.563). Dit ondermijnt elke andere policy in het systeem.
- **Fix (uitgevoerd):** policy gesplitst in select (eigen rij + fondsgenoten via SECURITY DEFINER-helper `fn_eigen_fonds_id()`) en update (eigen rij, mét WITH CHECK); trigger `trg_profiel_bevries