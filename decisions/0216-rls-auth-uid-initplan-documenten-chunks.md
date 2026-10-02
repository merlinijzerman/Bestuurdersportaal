# 0216 — RLS op `documenten`/`document_chunks`: `auth.uid()` als InitPlan, verder niets

- **Status:** Geaccepteerd voor Preview; Productie na apart akkoord
- **Datum:** 2026-10-02
- **Betrokkenen:** opdrachtgever (acceptatiecriteria #505), Claude Code (implementatie)

## Context

Bij de diagnose van de retrieval-time-out (#500, PR #516) bleek dat elke `zoek_chunks`-aanroep onder
RLS de hele `document_chunks`-tabel scant en per rij `auth.uid()` evalueert. Die functie leest
`request.jwt.claims` en parset de jsonb volledig, dus de kosten per rij schalen met de omvang van
de JWT. Met een realistische JWT (~0,9 kB) zat één aanroep op Productie rond of boven de
`statement_timeout` van 8 s (57014); de FTS-keten doet er tot vier na elkaar. Eerdere metingen
gebruikten een JWT van ~0,1 kB en zagen dit niet.

Randvoorwaarden van de opdrachtgever: exact dezelfde tenanttoegang, geen samenvoeging of
verruiming van policies, meting met een productie-realistische JWT, rollback getest, eerst
Preview.

## Besluit

De zes policies op `documenten` en `document_chunks` krijgen uitsluitend een andere
expressievorm: elke `auth.uid()` wordt `(select auth.uid())`, ook binnen de
profiel-fonds-lookup. Naam, command, PERMISSIVE, rollen (`public`) en de predicaten van USING en
WITH CHECK blijven gelijk (migratie `2026_10_02_505_rls_auth_uid_initplan.sql`).

## Overwogen alternatieven

- **`TO authenticated` i.p.v. `public`** — niet gedaan. Het is een reikwijdtewijziging, geen
  vormwijziging: `anon` heeft SELECT-grants op beide tabellen en valt nu onder dezelfde policies
  (de pariteitscheck legt vast dat een anon-JWT mét `sub` dezelfde rijen ziet als die gebruiker);
  ook `portaal_beperkt`, `ai_gateway` en toekomstige rollen zouden anders behandeld worden. Dat
  aantonen voor álle aanroepers is meer werk dan het oplevert: de InitPlan-winst hangt er niet van
  af.
- **De permissive ALL-policy `chunks write eigen fonds` opsplitsen in INSERT/UPDATE/DELETE** —
  niet in deze wijziging (opdracht: geen herstructurering). Gemeten: met #505 voegt zij bij
  SELECT een tweede gehashte subplan toe; het effect is in de PR-meting gerapporteerd
  ("zonder ALL-policy"). Kandidaat voor een eigen issue met eigen pariteitsbewijs.
- **Alleen de `zoek_chunks`-RPC's herschrijven** (bv. een vooraf bepaalde fonds-id of SECURITY
  DEFINER) — verworpen: dat verplaatst de tenantgrens uit RLS naar functiecode, terwijl de oorzaak
  in de policy zit en ook directe PostgREST-selects raakt.
- **Alle 166 overige policies met een kale `auth.uid()` meenemen** — buiten scope; elk vraagt een
  eigen pariteitsbewijs. Ze zijn geïnventariseerd in de PR en in `T3-RLS-CONTROLEKADER.md` §8c.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd, aangetoond met
  `supabase/checks/2026_10_02_505_rls_initplan_tenantpariteit.sql` (8 actoren × 27 uitkomsten,
  VÓÓR = NA, catalogus genormaliseerd identiek, drie negatieve controles rood). De migratie voert
  dezelfde catalogusvergelijking fail-closed uit in haar eigen transactie.
- **Performance:** de JWT-parse gebeurt één keer per statement; de kosten per aanroep worden
  vrijwel onafhankelijk van de JWT-omvang (cijfers in de PR en `HANDOVER.md`).
- **#500-hotfix:** de volscanbegrenzing (`ARTIKELFOCUS_VOLSCANBEGRENZING`) blijft staan. Haar
  negatieve controle draait in de karakterisering voortaan onder de RLS-kosten van vóór #505
  (rollbackscript tijdelijk toegepast), anders heeft zij niets meer te begrenzen.
- **Grants/datamodel:** geen. V3-allowlist ongewijzigd.
- **Drift/fidelity:** de policyvingerafdrukken veranderen bewust; na toepassing op een gehoste
  omgeving de bijbehorende pin herijken (Preview-fidelity, daarna de productiedriftpin).
- **Rollback:** `supabase/rollbacks/2026_10_02_505_rls_auth_uid_initplan_ROLLBACK.sql` herstelt de
  exacte teksten van vóór #505 (getest: migratie → rollback → migratie, pariteit in elke stand).

## Referenties

- Issue #505 (en de meetcomment van 02-10-2026), #500, PR #516.
- `supabase/migrations/2026_10_02_505_rls_auth_uid_initplan.sql`
- `supabase/checks/2026_10_02_505_rls_initplan_tenantpariteit.sql`
- `tests/karakterisering/rls-505-meting.mjs`, `tests/karakterisering/artikelspoor-500-budget.mjs`
- `T3-RLS-CONTROLEKADER.md` §8c
