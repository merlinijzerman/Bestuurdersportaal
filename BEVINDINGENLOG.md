# Bevindingenlog code review — op te pakken in volgende iteraties

**Datum:** 3 juli 2026
**Herkomst:** code review 3 juli 2026 (`CODE-REVIEW-2026-07-03.md`) + onafhankelijke hercheck van de kritieke/hoge categorieën op 3 juli 2026.
**Doel:** werkvoorraad voor volgende iteraties. Per bevinding: status, feit vs. inschatting, actie en acceptatiecriteria.

## ⚠️ Belangrijk vooraf: status van de oorspronkelijke review

1. **Het reviewrapport is afg

---

> **Let op — dit bestand is afgekapt.** De tekst hierboven eindigt midden in een zin
> ("Het reviewrapport is afg…"). Dat is geen weergavefout: het bestand is 455 bytes en de
> volledige bevindingenlijst van 3 juli 2026 is nergens compleet bewaard gebleven. Zie
> `mvp-beperkingen.md` §4. De hieronder gedocumenteerde ronde van 30-31 juli heeft de
> kritieke bevindingen uit die review alsnog geadresseerd — zie de opmerking bij K-03.

---

# Bevindingenlog integrale review 30-31 juli 2026

**Datum:** 31 juli 2026
**Herkomst:** integrale code-, architectuur- en securityreview van 30 juli 2026 (63 bevindingen),
gevolgd door herstel en **live verificatie tegen de productiedatabase** op 31 juli 2026.
**Volledig verslag:** `REVIEW-ADDENDUM-2026-07-31.md`. Besluit: `decisions/0096`.

## Wat deze ronde anders maakt

Het reviewrapport toetste de repository. De impliciete aanname daarbij — dat de migraties in de
repo ook op productie stonden — bleek onjuist. Er is geen migratierunner; migraties worden
handmatig in de SQL-editor geplakt. **Vier van de zes bevindingen hieronder bestaan uitsluitend
daardoor**, en geen ervan was zichtbaar zonder de database zelf te bevragen.

## Bevindingen uit de live verificatie

| ID | Ernst | Bevinding | Status |
|---|---|---|---|
| K-02 | Kritiek | Twee wees-policies op `document_chunks` (`chunks schrijven`, INSERT, `TO public`, `with_check = true`), in geen enkele migratie aanwezig. Permissive policies worden ge-OR'd, dus de parentgebonden schrijfpolicy was irrelevant: iedereen met de publieke anon-key kon chunks invoegen onder een willekeurig `document_id`, ook van een ander fonds, waarna die tekst als `[Bron N]` wordt geciteerd. Beïnvloeding van bestuurlijke advisering, ongeauthenticeerd uitvoerbaar | Gedicht — `2026_07_31_r2_wees_policies_document_chunks.sql` |
| K-03 | Kritiek | `profielen` stond in de ongeharde toestand: één `FOR ALL`-policy met alleen `USING (auth.uid() = id)`, `with_check = null`. Postgres valt dan voor de schrijfkant terug op `USING`, dat alleen de rij-identiteit toetst — `rol` en `fonds_id` waren zelf-muteerbaar. Migratie `2026_07_03_profielen_rls_hardening.sql` was nooit gedraaid. Dit is dezelfde bevinding als CR-K1 uit de review van 3 juli, waarvan tot nu toe werd aangenomen dat hij was opgelost | Gedicht — `2026_07_31_r3_profielen_rls_herstel.sql` |
| H-18 | Hoog | Vijf `SECURITY DEFINER`-RPC's ongeauthenticeerd aanroepbaar: `aqlab_claim_run_jobs`, `aqlab_add_run_cost`, `aqlab_log_download`, `aqlab_assurance_meetwaarden`, `aqlab_audit_export_bron`. Oorzaak: Supabase' default-ACL kent EXECUTE expliciet aan `anon` toe, niet via `PUBLIC` — het idioom `revoke … from public` haalde dus een recht weg dat er niet was | Gedicht — `2026_07_31_r7_execute_grants_anon.sql` |
| O-03 | Hoog (was Observatie) | `anon` hield alle rechten op alle tabellen in `public`, inclusief `TRUNCATE`, dat door RLS niet wordt afgedekt en de append-only auditsporen leegbaar maakt. Systemische oorzaak onder K-02 | Gedicht — `2026_07_31_r4_grant_hygiene.sql` |
| O-03b | Hoog | De `supabase_admin`-kant van `pg_default_acl` is niet te wijzigen door `postgres`. Nieuwe objecten van die eigenaar krijgen de volle grant terug | **Geaccepteerd restrisico** — besluit `0096`; detectie via gate F en H |
| L-08 | Laag | `reindex_runs` droeg een handgeschreven policy met een andere naam dan de migratie en zonder expliciete `WITH CHECK`. Geen escalatiepad (`fonds_id` staat zelf in de `USING`-expressie), wel drift | Gedicht — `2026_07_31_r5_reindex_runs_policy.sql` |
| T-01 | Hoog | `npm run sanity` stond sinds 15 juli rood op een verouderde prompt-hash. Het script stopte bij de eerste rode, waardoor **45 suites twee weken niet draaiden** — waaronder `pii-gate`, `rate-limit`, `tenant-enforce`, `rag-fondsdiscipline` en `platform-wrapper`. Na herstel bleken alle 45 groen | Gedicht — script draait nu alles door; CI-afdwinging staat nog open |

## Het patroon

Vier van de zeven bevindingen zijn dezelfde faalvorm: **de maatregel bestond, deed zijn werk, en
de uitkomst kwam nergens terecht.** K-02 en K-03: de migratie stond in de repo en was nooit
gedraaid. T-01: de gate vuurde correct en niemand las het resultaat. H-18 is de scherpste
variant — twee migraties bevatten een `revoke`, een comment die de maatregel beschrijft
(*"Geen EXECUTE voor anon/authenticated: uitsluitend de service-role draait de worker"*) en een
codereview die er overheen is gegaan, terwijl de maatregel niet bestond.

Het reviewuitgangspunt luidde *"ontbrekend bewijs betekent niet automatisch dat een
beheersmaatregel bestaat"*. H-18 is de omgekeerde en lastigere variant: **aanwezig bewijs
betekende hier evenmin dat de maatregel bestond.** Daarom toetsen de acht structurele gates
(`supabase/checks/2026_07_31_r1_structurele_gates.sql`) de uitkomst in `pg_policies`, `pg_proc`,
`pg_default_acl` en `information_schema.role_table_grants` — niet de intentie in een
migratiebestand.

## Openstaande werkvoorraad uit deze ronde

| # | Actie | Prioriteit |
|---|---|---|
| 1 | Structurele gates in CI opnemen (voorwaarde onder besluit 0096) | P1 |
| 2 | Migratierunner invoeren; repo en productie aantoonbaar gelijk | P1 — blocker vóór fonds 2 |
| 3 | Omgevingsscheiding: preview draait nu tegen de productiedatabase | P1 — blocker vóór fonds 2 |
| 4 | Branch protection op `main` | P1 |
| 5 | Rotatie `ANTHROPIC_API_KEY` + `git log --all -- .env.vercel-now` | P1 |
| 6 | Storage-policy `documenten storage lezen`, tak `generiek`: `auth.uid() is not null` toevoegen (handmatig in dashboard) | P2 |
| 7 | Harde cap tijdens documentextractie (het decompressiebudget vertrouwt nu de ZIP-header) | P2 |
| 8 | Tweede beheerder aanstellen — na R3 kan niemand zichzelf nog promoveren | P2 — bestuurlijk |
| 9 | `authenticated` per functie versmallen (R7 hield dat bewust ongewijzigd) | P3 |
| 10 | Vier AQLab-consolepagina's naar `withPlatformRead` (H-15, restant) | P3 |
