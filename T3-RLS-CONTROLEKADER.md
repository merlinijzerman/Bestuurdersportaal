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

### 1d. ROLgrens toegevoegd in T1 bureau-rol (11 policies, 2026-08-05)

> Migratie `2026_08_05_bestuursbureau_rol.sql`, besluit [`0128`](./decisions/0128-tenant-rol-bestuursbureau.md).
> **Dit is een andere as dan de rest van dit kader.** §1a–§1c gaan over de TENANTgrens
> (fonds A vs. fonds B). Deze elf policies dragen daarnaast een ROLgrens *binnen* één fonds.
> Dat was nodig omdat RLS hier op `fonds_id` isoleert en niet op rol: de nieuwe tenant-rol
> `bestuursbureau` zou anders alle inbreng en al het individuele stemgedrag van het eigen
> fonds lezen, én kunnen stemmen, inbrengen en dissent vastleggen.

Alle elf zijn `<bestaand predicaat> AND (select rol from public.profielen where id = auth.uid())
is distinct from 'bestuursbureau'`. Het bestaande predicaat is letterlijk ongewijzigd, dus voor
`bestuurder`/`voorzitter`/`beheerder` is het evaluatieresultaat per definitie identiek (nulgrens G23).
`is distinct from` en niet `<>`: `profielen.rol` is nullable, en `<>` zou een profiel met
`rol IS NULL` onzichtbaar maken.

| Tabel | Policies | Waarom |
|---|---|---|
| `agendapunt_inbreng` | `fonds inbreng lezen` (SELECT), `eigen inbreng schrijven` (INSERT), `eigen inbreng wijzigen` (UPDATE), `eigen inbreng verwijderen` (DELETE) | Inbreng is een bestuurlijke uiting; ondersteuning leest die niet mee en plaatst die niet (G9) |
| `stem_uitbrengingen` | `fonds stem select`, `fonds stem insert`, `fonds stem update`, `fonds stem delete` | Individueel stemgedrag (G9) |
| `stemmingen` | `fonds stemmingen insert`, `fonds stemmingen update` | Geen stemronde openen, wijzigen of sluiten |
| `decision_dissent` | `dissent zichtbaarheid write` (ALL) | Geen dissent vastleggen — de tak `bestuurder_id = auth.uid()` stond hier open |

**Bewust NIET afgeschermd:** `"fonds stemmingen select"` — de stemronde en de uitslag zijn
bestuurlijke informatie die in de notulen belandt en die het bureau nodig heeft. En
`"dissent zichtbaarheid select"` — het bureau valt daar in de niet-privileged tak en ziet alleen
formele dissent en minderheidsnotities, die per definitie in de verantwoording thuishoren.

**Gedragsbewijs:** `supabase/checks/2026_08_05_bb_rolgrenzen.sql` (draait mee in
`scripts/cross-tenant-ci.sh`), inclusief een positieve tegenhanger per afscherming — een suite die
alles blokkeert zou anders óók groen zijn.

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
generieke content-status = T6; volledige §15-matrix-automatisering
in CI = T5; host/unknown-host = T1; `fonds_memberships` = T12; SSO = TP2.

**T4 (RAG-namespace/retrieval) — geïmplementeerd (2026-07-08, besluit 0045).** De
retrieval-fondsdiscipline is nu defense-in-depth náást RLS: een expliciete
`p_fonds_id`-filter in `zoek_chunks`/`zoek_chunks_hybride` (additief; verruimt
leesrechten nooit), een published-only-gate voor generieke content (T13/T14),
een app-laag guard (`handhaafFondsdiscipline`) op élk retrievalpad incl. de
PostgREST-fallback en `haalDocumentChunks`, en rijkere `retrieval_meta`
(fondsfilter, namespace-conventie=`bibliotheek`, drop-telling, manipulatie-vlag,
bronversie-audit). Namespace-`CHECK`-constraint + generiek-status-workflow blijven
T6. Negatieve tests T11–T14: `supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql`
(zelfde runner/CI-job als T3). Premisse-correctie: `document_chunks` heeft géén
eigen `fonds_id` — de grens loopt via de join naar `documenten` (zie 0045).

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

**SECURITY INVOKER (respecteert RLS, correct):** `zoek_chunks()`/`zoek_chunks_hybride()`
(RAG-retrieval — RLS op `document_chunks`/`documenten` dwingt isolatie af; T4 voegt de
additieve `p_fonds_id`-filter + published-only-generiek toe als defense-in-depth,
zonder de INVOKER-semantiek te wijzigen), RPC `profiel_opslaan`,
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
5. **Verifieer — verplicht commando bij elk tenant-pad.** Draai de gebundelde §15-suite
   `bash scripts/cross-tenant-ci.sh` (tsc + app-laag node:test T1–T14 + DB-laag T3/T4/T6/T7
   onder échte RLS). Dit is HÉT verificatiecommando bij elke wijziging aan een host-/fonds-/
   RLS-/audit-/retrieval-/storage-pad; één rood/groen. Voor de DB-laag: zet `TEST_DATABASE_URL`
   naar een wegwerpbare test-DB (of draai lokaal een `supabase start`). Werk `schema.sql`
   (documentatie) en `HANDOVER.md` bij.
6. **Deploy** via GitHub Desktop (commit → push `main` → Vercel). Geen terminal-git commits.

---

## 8. Testkader (§14 punt 7 / §15)

**Sinds T5 (besluit 0046) is de volledige §15-matrix (T1–T14) gebundeld tot één
suite** achter `scripts/cross-tenant-ci.sh` en de workflow `.github/workflows/rls-cross-tenant.yml`
(ephemere Supabase-CLI-DB via `supabase start`; `XTENANT_REQUIRE_DB=1` maakt een ontbrekende DB rood
— test-integriteit binnen de job, geen merge-blokkade). **Fasering (besluit 0046):** de suite draait
op elke push maar is **voorlopig niet-blokkerend** (geen branch protection; de directe-push-flow naar
`main` blijft zolang er één tenant is). Omzetten naar blokkerende merge-gate = actiepunt bij
PGB-onboarding, net vóór PGB live. De suite kent twee lagen:

- **App-laag (`tests/cross-tenant/*.test.ts`, node:test + tsx).** Benoemde, 1-op-1 op §15
  herleidbare tests over de bestaande pure functies (geen duplicatie — importeert `lib/*`):
  **T1–T4** host→fonds-resolutie + fail-closed enforce (`tenant-host`/`tenant-enforce`),
  **T5/T8** auditfonds server-side afgeleid (broninspectie via `lib/audit-fonds-guard.ts`, gedeeld
  met `lib/audit-fonds.sanity.ts`), **T9/T10** platform-routing surface-isolatie (`platform-host`),
  **T11–T14** RAG-fondsdiscipline (`lib/rag`). Elk scenario heeft óf een expliciete negatieve-
  controle-test, óf een guard die aantoonbaar rood wordt op een lek (T5- en T10-negatieftests).
- **DB-laag (psql, onder échte RLS).** T3 (write-isolatie) + T4 (retrieval T11–T14) + de nieuwe
  **T6/T7** (`supabase/checks/2026_07_09_t5_export_storage.sql`): export-leesisolatie en
  storage-download/-upload-grens op `storage.objects` (incl. B13 generiek read-only). De runner
  `scripts/testdb-apply-migrations.sh` bouwt eerst het schema op (psql-apply in gesorteerde
  volgorde; `_ROLLBACK.sql` en `checks/` uitgesloten — besluit 0046, want de repo-migratienamen
  volgen niet het CLI-timestampformaat).

Onderstaande DEEL 1/DEEL 2-beschrijving betreft de T3-SQL-suite
`supabase/checks/2026_07_08_t3_cross_tenant.sql`, die via `scripts/rls-cross-tenant-test.sh`
binnen de gebundelde suite draait.

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

**T4 — retrieval-fondsdiscipline (T11–T14).** `supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql`
draait via **dezelfde runner** (`scripts/rls-cross-tenant-test.sh`) en CI-job, ná de T3-suite.
Self-seeding (2 fondsen + 5 documenten met chunks), impersoneert fonds A en roept de retrieval-RPC's
aan: **T11** (fonds A ziet nooit chunks van fonds B — `zoek_chunks` én `zoek_chunks_hybride`),
**T12** (een gespooft `p_fonds_id => B` surfacet géén B-content en onttrekt A's eigen fondsdoc aan
het resultaat — de server-side filter is leidend), **T13** (gearchiveerd generiek is geen actuele
bron), **T14** (bronstatus `uitgesloten` generiek evenmin), plus een positieve regressie (eigen fonds
+ published generiek blijven zichtbaar). Assertions toetsen op de seed-`document_id`'s zodat echte
DB-data de uitkomst niet vertroebelt. Elke `LEK:`/`FAALT`/`REGRESSIE` = non-zero psql-exit = rode CI.
De app-laag guard is los getest in `lib/rag-fondsdiscipline.sanity.ts` (pure functies, geen DB).

**Negatieve controle per scenario (besluit 0046 §E).** Elk §15-scenario bewijst dat een
geïntroduceerd lek de bijbehorende test ROOD maakt — nooit naar main gecommit:
- App-laag: T5 en T10 dragen een expliciete negatieve-controle-test; de guard-gebaseerde
  scenario's (T5/T8) tonen via `lib/audit-fonds-guard.ts` aan dat een `body.fonds_id`-lek als
  auditbron gedetecteerd wordt. Verzwak een pure functie (bv. `beoordeelToegang` fail-open) →
  de bijbehorende T-test faalt.
- DB-laag: verwijder één `with check` → DEEL 1a of de T7-dekkingscheck faalt; verzwak een
  tenant-/pad-predicaat → de bijbehorende cross-tenant insert/select slaagt en doet
  `raise exception 'LEK: …'`. Elke `LEK:`/`FAALT`/`REGRESSIE` = non-zero exit = rode CI.

> **T5 afgerond (was: T5-grens).** De in T3/T4 aangekondigde automatisering tegen een ephemere
> Supabase-DB (auth/storage/pgvector) is met T5 (besluit 0046) geleverd:
> `.github/workflows/rls-cross-tenant.yml` draait de volledige suite via `supabase start` +
> `XTENANT_REQUIRE_DB=1` op elke push. **Activering is gefaseerd:** voorlopig **niet-blokkerend**
> (geen branch protection) — omzetten naar blokkerende merge-gate is een actiepunt in de
> PGB-onboardingchecklist, net vóór PGB live (besluit 0046, "Activering/fasering"). De optie-B-
> fideliteitsrun (nachtelijk, non-blocking, tegen een gehoste test-DB) staat in
> `.github/workflows/nightly-fidelity.yml`. Branch-protection "required status check" op main is
> op dat moment een repo-adminactie buiten deze repo-files.

---

## 8b. Opvolging 31-07-2026 — waarom §8 niet volstond, en wat ervoor in de plaats komt

> Toegevoegd na de integrale review van 30-31 juli 2026. Zie `REVIEW-ADDENDUM-2026-07-31.md`
> voor de volledige bevindingen en `supabase/checks/2026_07_31_r1_structurele_gates.sql`
> voor de gates.

**De T3-gate toetste of een schrijfpolicy een `WITH CHECK` HÉÉFT, niet of het PREDIKAAT een
tenantgrens bevat.** Vijf policies passeerden daardoor de gate terwijl ze cross-tenant toegang
toestonden: `decision_dissent` (K-01), `notificaties` (H-01), `document_inzage` en
`document_metadata_log` (H-02) en `agendapunt_inbreng` (M-01). Alle vijf zijn hersteld in
`2026_07_31_r1_rls_tenantgrenzen.sql`.

**Structureel ernstiger: dit controlekader toetst de repository, niet de database.** Drie
objecten stonden in productie zonder in enige migratie voor te komen — twee wees-policies op
`document_chunks` (K-02, een ongeauthenticeerd schrijfpad naar de RAG-corpus), de ongeharde
`profielen`-policy (K-03, zelf-muteerbare `rol` en `fonds_id`) en een handgeschreven
`reindex_runs`-policy (L-08). Ze bestonden omdat er geen migratierunner is. Een controlekader
dat migratiebestanden leest, kan dat per definitie niet zien.

**Acht structurele gates vervangen de losse checklist**
(`supabase/checks/2026_07_31_r1_structurele_gates.sql`, draait in `scripts/cross-tenant-ci.sh`
en is ook rechtstreeks in de SQL-editor te plakken):

| Gate | Toetst | Ontstaan uit |
|---|---|---|
| A1 | Elke tabel met RLS zonder eigen `fonds_id` staat in het register of in de globale lijst | K-01, M-01 |
| A2 | Lees-/invoegpolicies op die tabellen noemen de parenttabel; mutatiepolicies mogen eigenaarsgebonden zijn | K-01, M-01 |
| B | Tabellen mét `fonds_id` binden aan fonds of aan `auth.uid()` | §14 |
| C | Geen SELECT-policy met `qual = 'true'` | §14 |
| C2 | Geen INSERT/UPDATE/ALL-policy met `with_check = 'true'` | K-02 |
| D | `anon` ziet nul rijen in de tenanttabellen — gedragstest mét seed, want een lege tabel slaagt vacuüm | §15 |
| E | Elke `SECURITY DEFINER`-functie heeft een gepind `search_path` | M-04 |
| F | `anon` heeft nergens schrijfrechten; geen `TRUNCATE`/`REFERENCES`/`TRIGGER` bij `anon` of `authenticated` | O-03 |
| G | Geen `FOR ALL`-policy zonder `WITH CHECK` — Postgres valt dan terug op `USING` en toetst alleen wélke rij je wijzigt | K-03 |
| H | `anon` kan geen applicatiefunctie in `public` uitvoeren, op drie publieke RPC's na | H-18 |

**Vier van die tien (C2, F, G, H) komen rechtstreeks voort uit een bevinding die het
T3-kader niet kón zien.** Het verschil zit hem in wát er getoetst wordt: `pg_policies`,
`pg_proc`, `pg_default_acl` en `information_schema.role_table_grants` in de dráaiende database
— niet de migratiebestanden. Dat onderscheid is de blijvende les van deze ronde.

**Twee grenzen van de gates, expliciet:**

- Gate D schrijft (één testfonds, twee documenten, één chunk) binnen `begin … rollback`. Zonder
  seed zou hij vacuüm slagen. Wil je geen enkele schrijfactie op productie, knip dan gate D eruit
  en draai de rest; je verliest dan de gedragsbevestiging.
- De gedragstest `2026_07_31_r1_tenantgrenzen.sql` seedt twee fondsen en drie gebruikers in
  `auth.users`. Die hoort **niet** op productie maar op een testdatabase via
  `npm run test:xtenant:ci` — en daarmee is omgevingsscheiding een randvoorwaarde voor het
  volledig kunnen uitvoeren van dit controlekader.

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
4. **Restrisico 31-07-2026 — default privileges van `supabase_admin` (bevinding O-03b).**
   `pg_default_acl` kent voor `public` twee eigenaren. De `postgres`-kant is dichtgezet
   (`2026_07_31_r6_default_privileges.sql`); de `supabase_admin`-kant geeft nieuwe tabellen nog
   steeds `anon = arwdDxtm` en nieuwe functies `anon = X`, en `postgres` is geen lid van die rol.
   Preventie is niet haalbaar met de rechten die dit project heeft; gates F en H zijn de
   detectie, maar zien het pas nádat het object bestaat. Vastgelegd als geaccepteerd,
   gedetecteerd-maar-niet-voorkomen risico in besluit `0096`.
5. **Restrisico — de gates draaien nog niet in CI.** Zolang dat handwerk is, hangt de detectie
   onder punt 4 af van eraan denken. Bevinding T-01 (een testgate die twee weken rood stond
   zonder dat iemand het zag) laat zien hoe dat afloopt. Dit is de goedkoopste openstaande
   maatregel op de hele lijst en het is repo-werk, geen leverancierswerk.
