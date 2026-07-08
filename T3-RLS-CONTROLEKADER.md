# T3 — RLS-hardening en controlekader

> Increment T3 uit de multi-tenant T-serie (roadmap v0.1), uitvoering van besluit 0040.
> Leidraad: beslisnotitie multi-tenant v0.4 **§14** (blokkerende hardening-checklist vóór
> onboarding fonds 2) en **§15** (cross-tenant testmatrix). Datum: 2026-07-08.
>
> **Kernprincipe:** RLS per `fonds_id` blijft de primaire tenant-isolatie; code = rolgate
> (besluit 0039). T3 maakt van RLS een getoetst, gedocumenteerd controlekader en sluit de
> schrijfkant fail-closed.

Bronbestanden (authoritatief):
- `supabase/migrations/2026_07_08_t3_rls_with_check.sql` (+ `_ROLLBACK`)
- `supabase/migrations/2026_07_08_t3_append_only_logs.sql` (+ `_ROLLBACK`)
- `supabase/migrations/2026_07_08_t3_globale_tabellen_register.sql` (+ `_ROLLBACK`)
- `supabase/checks/2026_07_08_t3_cross_tenant.sql` + `scripts/rls-cross-tenant-test.sh`
- `.github/workflows/rls-cross-tenant.yml`

---

## 1. Policy-matrix (nulmeting → eindstaat)

De leidende zwakte was `public.governance_log` (policy `"fonds log"`): `for all using (fonds_id = …)`
**zonder** `with check`. Omdat `USING` bij INSERT niets toetst, kon een geauthenticeerde
gebruiker een auditregel met een **vreemde `fonds_id`** injecteren. Dit bleek een *patroon*:
28 schrijf-policies over 27 tabellen deelden het gebrek.

**Aanpak:** elke `for all`/`for update`-policy zonder `with check` kreeg een `with check` die de
bestaande `using`-predicaat **exact spiegelt**. Geen `USING` is verruimd/versmald — een legitieme
schrijfactie voldeed al aan `USING` en voldoet dus aan de identieke `WITH CHECK`.

### 1a. Gehard in T3 (28 policies)

| Klasse | Tabel | Policy | Isolatie-predicaat (nu ook `with check`) |
|--------|-------|--------|-------------------------------------------|
| A · direct `fonds_id` | `governance_log` ★ | `fonds log` | `fonds_id = eigen fonds` |
| A | `vergaderingen` | `fonds vergaderingen` | `fonds_id = eigen fonds` |
| A | `risicos` | `fonds risicos` | `fonds_id = eigen fonds` |
| A | `procedures` | `fonds procedures` | `fonds_id = eigen fonds` |
| A | `decision_objects` | `fonds decision_objects` | `fonds_id = eigen fonds` |
| B · parent-subquery | `agendapunten` | `fonds agendapunten` | via `vergaderingen` |
| B | `risico_maatregelen` | `fonds maatregelen` | via `risicos` |
| B | `risico_log` | `fonds risico log` | via `risicos` |
| B | `procedure_eigenaars` | `fonds proc eigenaars` | via `procedures` |
| B | `procedure_stappen` | `fonds proc stappen` | via `procedures` |
| B | `procedure_checklist` | `fonds proc checklist` | via `stappen→procedures` |
| B | `procedure_bewijs` | `fonds proc bewijs` | via `stappen→procedures` |
| B | `procedure_besluiten` | `fonds proc besluiten` | via `procedures` |
| B | `procedure_log` | `fonds proc log` | via `procedures` |
| B | `decision_assumptions` | `fonds decision_assumptions` | via `decision_objects` (loop) |
| B | `decision_risks` | `fonds decision_risks` | via `decision_objects` (loop) |
| B | `decision_conditions` | `fonds decision_conditions` | via `decision_objects` (loop) |
| B | `decision_actions` | `fonds decision_actions` | via `decision_objects` (loop) |
| B | `decision_evaluations` | `fonds decision_evaluations` | via `decision_objects` (loop) |
| B | `decision_ai_interactions` | `fonds decision_ai_interactions` | via `decision_objects` (loop) |
| B | `governance_events` | `fonds governance_events` | via `decision_objects` (loop) |
| B | `decision_audit_snapshots` | `fonds decision_audit_snapshots` | via `decision_objects` (loop) |
| C · eigenaar/rol | `agendapunt_inbreng` | `eigen inbreng wijzigen` (UPDATE) | `gebruiker_id = auth.uid()` |
| C | `decision_dissent` | `dissent zichtbaarheid write` | `bestuurder_id = auth.uid() or (voorzitter/beheerder)` |
| C | `procedure_requirements` | `req write beheerder` | `rol = 'beheerder'` (globale template) |
| C | `stemmingen` | `fonds stemmingen update` (UPDATE) | `fonds_id = eigen fonds` |
| C | `stem_uitbrengingen` | `fonds stem update` (UPDATE) | `uitgebracht_door = auth.uid()` |
| C | `notificaties` | `eigen notificaties update` (UPDATE) | `ontvanger_id = auth.uid()` |

### 1b. Al correct vóór T3 (ongemoeid)

Gesplitste of reeds-`with check`-policies: `documenten`, `document_chunks`, `gesprekken`,
`voorbereidingen`, `fonds_instellingen`, `organisatie_profielen`, `procesmodellen`,
`gremia`/`expertises`/`kritische_focusgebieden` (schrijf), `procesmodel_*`,
`document_procesinstanties`, `document_metadata_log`, `document_metadata_review_queue`,
`catalogus_log`, `stemmingen`/`stem_uitbrengingen` (insert), `agendapunt_log`,
`profiel_expertises`/`_gremia`/`_focusgebieden`, `profiel_log`, `document_inzage`,
`classificatie_voorstellen`, `reindex_runs`, `notulen_segmenten`, `notificaties` (insert),
`profielen` (gehard in 2026_07_03), `stemmingen`/`stem` (select).

### 1c. Bewust globaal/hybride (zie §5)

`fondsen`, `procedure_requirements`, `gremia`, `expertises`, `kritische_focusgebieden`,
`documenten` (generieke bibliotheek), `document_inzage`, `document_metadata_log`.

---

## 2. §14-checklist — status per punt (T3-scope)

| # | §14-eis | Status | Bewijs |
|---|---------|--------|--------|
| 1 | Policy-audit; schrijf-policies fail-closed met `WITH CHECK`; policy-matrix | ✅ | §1 + migratie `_t3_rls_with_check` |
| 2 | Views (`security_invoker`) + functies (SECURITY DEFINER-risico) geïnventariseerd | ✅ | §3 |
| 3 | Storage/downloads/exports tenant-aware | ✅ | §4 |
| 4 | Globale referentietabellen expliciet gedocumenteerd | ✅ | §5 + `COMMENT ON TABLE` |
| 5 | Service-role-inventaris (eigenaar/doel/scope/logging) | ✅ | §6 |
| 6 | Wijzigingsproces gedocumenteerd | ✅ | §7 |
| 7 | Negatieve cross-tenant tests per tenant-tabel in CI; lek laat test falen | ✅ | §8 |

**Buiten T3-scope (coördineren, niet dupliceren):** audit-bron-code in route.ts = T2/R2;
RAG-namespace/retrieval = T4; generieke content-status = T6; volledige §15-matrix-automatisering
in CI = T5; host/unknown-host = T1; `fonds_memberships` = T12; SSO = TP2.

---

## 3. Views en functies (SECURITY DEFINER / INVOKER)

**Views** — 1 view; respecteert RLS:
- `vw_dossier_status` — `security_invoker` (RLS van onderliggende tabellen dwingt isolatie af). ✅

**SECURITY DEFINER-functies (bypassen RLS) — geïnventariseerd en verantwoord:**

| Functie | Doel | Waarom DEFINER verantwoord |
|---------|------|-----------------------------|
| `maak_profiel()` | auth-signup-trigger; maakt `profielen`-rij, `fonds_id` uit user-metadata | moet als owner in `profielen` inserten op nieuwe `auth.users`; **fail-closed** op ontbrekend/onbekend fonds (migratie 2026_07_08, besluit 0044). Restrictiever, niet ruimer. |
| `fn_profiel_bevries_kolommen()` | bevriest `fonds_id`+`rol` bij zelfservice-update | BEFORE-trigger die moet vuren ongeacht caller-privileges; **alleen blokkerend** (defense-in-depth naast `WITH CHECK`). |
| `fn_rate_limit_check()` | server-side rate limiting op gedeelde teller | teller is per opzet cross-user (geen tenant-data); server-only aangeroepen. |

**SECURITY INVOKER (respecteert RLS, correct):** `zoek_chunks()` (RAG-retrieval — RLS op
`document_chunks`/`documenten` dwingt isolatie af), RPC `profiel_opslaan`,
`fn_decision_readiness_overview()`.

> Let op: `schema.sql` toont nog de **oude** `maak_profiel()`-body (`limit 1`); dat is
> gedocumenteerde achterloop — migratie 2026_07_08 is authoritatief.

---

## 4. Storage, downloads en exports

- **Bucket `documenten`** is privaat (`public = false`); leesbaar uitsluitend via RLS op
  `storage.objects`. Padconventie `<fonds_uuid>/<document_uuid>.pdf` (fonds-bibliotheek) en
  `generiek/<document_uuid>.pdf` (generieke bibliotheek). Leespolicy matcht het
  `documenten`-toegangsmodel (eigen fonds OF generiek); schrijfpolicy is eigen-fonds-pad
  (generiek is read-only voor tenants, curatie via service-role — migratie 2026_06_20e).
- **Downloads** lopen via signed URLs vanuit server-routes met de sessie van de gebruiker; de
  RLS op `storage.objects` + `document_inzage`-audit borgt dat een download buiten het eigen
  fonds wordt geweigerd (§15 T7).
- **Exports** worden server-side samengesteld uit RLS-gefilterde queries (anon-key + sessie);
  er is geen client-pad dat een `fonds_id` uit de request-body vertrouwt (§15 T5/T6).

---

## 5. Register van globale/hybride referentietabellen (§14 punt 4)

Vastgelegd in-DB via `COMMENT ON TABLE` (migratie `_t3_globale_tabellen_register`) én hier —
zodat een brede leespolicy een **bewuste, gedocumenteerde** keuze is (geen schijnzekerheid).

| Tabel | Aard | Leespolicy | Motivatie |
|-------|------|-----------|-----------|
| `fondsen` | globaal | `using(true)` | fondsenlijst voor tenant-keuze/host-resolutie; geen tenant-inhoud |
| `procedure_requirements` | globale template | `auth.uid() is not null` | fondsoverstijgende proces-vereisten; schrijf = beheerder-only (nu mét `with check`) |
| `gremia` | hybride | `fonds_id is null` OR eigen fonds | template-rijen globaal leesbaar; fonds-rijen strikt geïsoleerd |
| `expertises` | hybride | idem | idem |
| `kritische_focusgebieden` | hybride | idem | idem |
| `documenten` | hybride | eigen fonds OR `bibliotheek='generiek'` | gedeelde kennisbasis; fonds-docs geïsoleerd; insert alleen eigen fonds |
| `document_inzage` | hybride | `fonds_id is null` OR eigen fonds | inzage-audit van generieke docs fondsoverstijgend |
| `document_metadata_log` | hybride + append-only | `fonds_id is null` OR eigen fonds | idem; onveranderlijk via trigger |

---

## 6. Service-role-inventaris (§14 punt 5)

De service-role-key (`SUPABASE_SERVICE_ROLE_KEY`) omzeilt RLS en mag **nooit** in client- of
tenant-code. Statische borging: `scripts/check-service-role-leak.sh` (nu inclusief
`lib/supabase-service.ts` in de allowlist én in de client-import-guard).

| Surface | Eigenaar/laag | Doel & scope | Logging |
|---------|---------------|--------------|---------|
| `lib/supabase-platform.ts` | platform-back-office (server-only) | uitsluitend achter `withPlatform` capability+audit-wrapper; platformbeheer | via platform-audit-wrapper → `platform_event_log` (append-only) |
| `lib/supabase-service.ts` | generieke server-only machine-client | niet-tenant, niet-platform publieke schrijfpaden: `/api/contact` → `contact_aanvragen` (deny-by-default) en LEESpad `tenant_domains` (host→fonds) | applicatief per route; geen auth.uid() (machine-client) |

Beide bestanden beginnen met `import "server-only"` (client-import faalt bij build). Gebruik
blijft **beperkt en expliciet**; nieuwe service-role-paden vereisen een besluit + uitbreiding
van de leak-check-allowlist.

---

## 7. Wijzigingsproces voor RLS/policies (§14 punt 6)

Elke wijziging aan tenant-tabellen of policies volgt:

1. **Migration-first-then-deploy.** Schrijf een idempotente migratie in
   `supabase/migrations/<datum>_<naam>.sql` **met** bijbehorende `_ROLLBACK.sql` en een
   benoemde **tenant-impact** in de kop. Draai eerst in Supabase, dán code-deploy.
2. **Policy-invariant.** Elke nieuwe `for all`/`for insert`/`for update`-policy op een
   tenant-tabel krijgt een `WITH CHECK` die de tenant-/eigenaar-sleutel afdwingt. De
   structurele test (§8, DEEL 1) faalt anders in CI.
3. **Append-only audit.** Nieuwe `*_log`/audit-tabellen krijgen de before update/delete-
   immutability-trigger (patroon `fn_log_append_only()` / `fn_doc_meta_log_immutable()`).
4. **Globaal = expliciet.** Wijkt een tabel bewust af van strikte fonds-isolatie, documenteer
   dat via `COMMENT ON TABLE` én in §5 hierboven en voeg 'm toe aan de `global_allow`-lijst in
   de structurele test.
5. **Verifieer.** Draai `scripts/rls-cross-tenant-test.sh` tegen een test-DB en
   `./node_modules/.bin/tsc --noEmit --skipLibCheck`. Werk `schema.sql` (documentatie) en
   `HANDOVER.md` bij.
6. **Deploy** via GitHub Desktop (commit → push `main` → Vercel). Geen terminal-git commits.

---

## 8. Testkader (§14 punt 7 / §15)

`supabase/checks/2026_07_08_t3_cross_tenant.sql`, gedraaid door
`scripts/rls-cross-tenant-test.sh` (psql) en de non-blocking workflow
`.github/workflows/rls-cross-tenant.yml` (gated op secret `TEST_DATABASE_URL`).

- **DEEL 1 — structureel (geen seed; harde gate, draait overal).** Faalt met `raise exception`
  zodra (1a) een schrijf-policy (`ALL`/`INSERT`/`UPDATE`) op een niet-globale tabel géén
  `with check` heeft, of (1b) een van de vier audit-logs de `no_update`/`no_delete`-trigger
  mist. **Dit dekt élke tenant-tabel mechanisch, ook toekomstige** — een nieuwe tabel zonder
  `with check` laat de test onmiddellijk falen. Zo geldt "elke tenant-tabel ≥1 negatieve test"
  als afdwingbare invariant i.p.v. 55 losse inserts.
- **DEEL 2 — gedrag (self-seeding: 2 synthetische fondsen via de `maak_profiel`-trigger).**
  Representatief bewijs per isolatieklasse dat een cross-tenant schrijfpoging door RLS wordt
  **geweigerd**: governance_log (klasse A, leidend), vergaderingen (A), agendapunten onder een
  vreemde vergadering (B), notificaties (C), plus leesisolatie en een append-only UPDATE-poging.
  Een positieve controle (eigen-fonds insert slaagt) bewijst dat de policy niet over-restrictief
  is. Alles in `begin … rollback`.

**Bewijs dat een lek een test laat falen:** verwijder één `with check` uit de migratie → DEEL 1a
faalt; verwijder een append-only-trigger → DEEL 1b + DEEL 2 #6 falen; verzwak een tenant-predicaat
→ DEEL 2 laat de bijbehorende cross-tenant insert slagen en doet `raise exception 'LEK: …'`.
Elke `LEK:`/`FAALT` = non-zero psql-exit = rode CI.

> **Grens met T5:** volledige, altijd-blokkerende automatisering tegen een ephemere Supabase-DB
> (met auth/storage/pgvector) is T5-scope. Tot dan is de workflow non-blocking (skip zonder
> `TEST_DATABASE_URL`); zet het secret op een wegwerpbare test-branch-DB om 'm scherp te zetten.

---

## 9. Bevindingen en restrisico's

1. **Append-only wás niet DB-afgedwongen op 4 logtabellen** — opgelost in T3.
   `governance_log`, `risico_log`, `procedure_log`, `agendapunt_log` hadden `for all` en géén
   before update/delete-trigger (anders dan `document_metadata_log`/`platform_event_log`/
   `governance_events`). Hun append-only karakter steunde op de afwezigheid van code-paden, niet
   op de database. Gecontroleerd (2026-07-08): geen `.update()`/`.delete()` op deze tabellen in
   `lib/`/`app/`; de trigger verandert dus geen app-gedrag, maar maakt de belofte hard.
2. **`procedure_requirements` is een globale template-tabel** (geen `fonds_id`, `req read all`).
   Bewuste keuze, nu gedocumenteerd (§5) en in de test-allowlist.
3. **Restrisico (geen schijnzekerheid):** `schema.sql` loopt achter voor o.a. `decision_*`,
   `catalogus`, `platform_*`, `tenant_domains` en `maak_profiel`. De migraties zijn
   authoritatief; de banner boven `schema.sql` benoemt dit.
