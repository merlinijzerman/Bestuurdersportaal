# Runbook — een migratie naar productie brengen

**Doel:** één vaste gang voor het toepassen van een schemawijziging op productie, met een spoor van wat is toegepast en door wie het is goedgekeurd.
**Ontwerp:** `02 Architectuur/ONTWERPNOTITIE-MIGRATIEPROCES-v2.md` is leidend voor het waarom en voor de inrichting.
**Versie:** 1.1 · 17 augustus 2026 — §B en §C herzien na tegenlezing van de ontwerpnotitie (tweefasenpoort, goedkeuringsaantal, tweede prerequisite)

---

## ⚠ Status: twee procedures, en welke geldt

| | |
|---|---|
| **§A — Interim** | **Geldt nu.** De poort bestaat nog niet. Handmatig toepassen, met de discipline die vandaag al kan. |
| **§B — Doelgang** | Geldt **na** de inrichting uit §C. Volg deze niet eerder — de workflow bestaat dan nog niet en de ledger is dan niet gevuld. |

Deze splitsing staat er bewust. Een runbook dat een niet-bestaande workflow beschrijft, is precies het soort documentatie dat vollediger klinkt dan de implementatie is. Verwijder §A pas als §C is afgevinkt, en verschuif dan de status hierboven.

---

# §A · Interim-procedure (geldt nu)

Migraties worden met de hand in de Supabase SQL Editor geplakt. Er is geen versieregister, dus **jij bent de ledger.** Deze vijf stappen maken dat zo betrouwbaar als het zonder gereedschap kan.

### A1 · Vóór je iets aanraakt

- [ ] Het migratiebestand eindigt met een **eindcontrole**: een `DO`-block dat de beoogde eindstaat toetst en de transactie terugrolt als die niet exact klopt. Voorbeelden op `main`: `supabase/migrations/2026_07_31_r5_reindex_runs_policy.sql` en `2026_08_04_a3_governance_log_contract.sql`. Ontbreekt die, laat hem toevoegen vóór je verder gaat.
- [ ] **De eindcontrole werkt alleen binnen één transactie.** Staat er geen `begin;`/`commit;` om heen, dan rolt hij niets terug en is hij een melding, geen vangnet. Controleer beide, niet alleen het `DO`-block.
- [ ] Het bestand begint met `begin;` en eindigt met `commit;`, tenzij de operatie dat niet toestaat (`CREATE INDEX CONCURRENTLY`, sommige `ALTER TYPE`). Kan het niet transactioneel, noteer dat in het bestand mét de herstelstap.
- [ ] Er is een `_ROLLBACK.sql`-tegenhanger. Lees hem, en stel vast **wat hij niet herstelt** — een rollback die kolommen leeg terugzet is geen herstel van data.
- [ ] CI is groen op de PR (de ephemere DB + de gates).
- [ ] **Volgorderegel bewust gekozen:**
  - additieve wijziging (nieuwe kolom, nieuwe policy) → **migratie eerst, dán code**;
  - contract-stap (`DROP COLUMN`, kolom niet meer gelezen) → **code eerst, dán migratie**.
  `CLAUDE.md` r. 51 noemt alleen de eerste; de tweede is even hard.

### A2 · Toepassen

1. Open Supabase → SQL Editor op het **juiste project**. Controleer de projectnaam in de URL. Preview en Productie zijn twee projecten.
2. Plak de volledige inhoud van het bestand. Niet een deel, niet een aangepaste versie.
3. Run.
4. Lees de uitvoer. Een eindcontrole die terugrolt geeft een `raise exception` — dat is **geen** fout in de migratie, dat is de migratie die zijn werk doet.

### A3 · Direct erna, in dezelfde sessie

- [ ] Draai `supabase/checks/2026_07_31_r1_structurele_gates.sql` in dezelfde SQL Editor tegen productie. Dit is de eis uit `WERKOPDRACHT-TEMPLATE.md` bij elke wijziging aan policies, grants, `SECURITY DEFINER`-functies of het datamodel — en zonder poort is dit het enige moment waarop het gebeurt.
- [ ] Rood? Rol terug met het `_ROLLBACK`-script en stop. Niet doorgaan met de code-deploy.

### A4 · Vastleggen — dit is de stap die nu het vaakst wegvalt

Noteer in `HANDOVER.md` (of het releaselog van de betreffende release): **bestandsnaam, datum, tijd, omgeving, en de uitkomst van de gate-run.** Zonder die regel is er geen enkele bron die zegt dat deze migratie op productie is toegepast — en dat is exact waarom de reparatiemigratie van 15 augustus nodig was: drie maatregelen stonden in een migratiebestand en niet in productie.

### A5 · Code deployen

Pas na A3 groen.

---

# §B · Doelgang (na inrichting)

### B1 · Schrijven

Claude Code schrijft `supabase/migrations/<14-cijferig tijdstempel>_naam.sql`, met de eindcontrole uit A1 als slotblok. Plus de `_ROLLBACK`-variant.

### B2 · PR

CI past de migratie toe op een wegwerpdatabase en draait de gates. **Groen of rood is bekend voordat productie is aangeraakt.**

### B3 · Mergen

### B4 · Toepassen — twee fasen, want de goedkeuring komt ná het plan

Een job met `environment:` **start pas na goedkeuring**. Zou "openstaande migraties tonen" in diezelfde job staan, dan keurde je blind goed. Daarom twee jobs, en `supabase migration list` alléén is niet genoeg — dat toont versies, geen SQL.

1. GitHub → **Actions** → `migratie-productie` → **Run workflow**.
2. Vul het **commit-SHA** in (moet een voorouder van `main` zijn) en typ `MIGREER`. Run.
3. Job **`plan`** draait direct, zonder goedkeuring. Hij valideert de bevestiging en de branchrestrictie, en levert een artefact met: **de bestandslijst, de volledige SQL, en een sha256 per bestand.**
4. **Lees dat artefact.** Dit is het moment van het menselijk oog op de DDL. Staat er iets tussen dat je niet verwacht, breek af — dat is een bevinding.
5. Job **`apply`** stopt op **"Waiting for review"**. Een goedkeurder uit de environment `production-db` keurt goed.
6. `apply` verifieert de checksums tegen het artefact van `plan`, past toe met `supabase migration up`, en draait direct daarna de gates tegen productie.
7. Groen → klaar. Rood → de transactie of de eindcontrole heeft teruggerold; de log zegt waarom.

### B5 · Code deployen

---

## Faalpaden

**CI rood op de PR.** Niet mergen. De ephemere DB is er precies voor dit moment.

**De goedkeuring wordt geweigerd.** Niets is toegepast. Los de bezwaren op en start opnieuw.

**`migration up` faalt halverwege.**
1. Lees de log: welke migratie faalde, en op welk statement.
2. Draai `supabase migration list` — de ledger zegt wat wél is toegepast. **Vertrouw de ledger, niet je herinnering.**
3. Was de migratie transactioneel of had hij een eindcontrole, dan is er niets toegepast. Zo niet: pas het `_ROLLBACK`-script toe voor de migraties die wél zijn gecommit, in omgekeerde volgorde.
4. Draai de gates. Groen? Dan is de eindstaat schoon en kun je opnieuw beginnen.
5. Gates rood en rollback ontoereikend → restore uit back-up. **Let op: die route werkt op dit moment niet** (zie `../02 Architectuur/ARCHITECTUUR-REVIEW-ERRATUM-v1.2.md` §3: vijf runs, één handmatig geslaagd, Storage-objecten buiten de dump). Zolang dat zo is, is dit faalpad een dood spoor — en dat is een reden om terughoudend te zijn met niet-transactionele migraties.

**Nachtelijke driftmelding.** De read-only `supabase db diff` meldt een verschil tussen productie en de migraties.
1. Bekijk de diff. Is het een object dat in geen enkele migratie voorkomt, dan is het handmatig in het dashboard gemaakt.
2. Leg het vast in een reparatiemigratie — niet in het dashboard "even goedzetten", want dan is de volgende melding hetzelfde.
3. Volg voor de reparatie het patroon van `2026_08_04_a3_governance_log_contract.sql`: repareer alleen de feitelijk ontbrekende onderdelen, en sluit af met een eindcontrole binnen dezelfde transactie.
4. **Let op:** `db diff` heeft blinde vlekken — publications, storage buckets en sommige `security_invoker`-views. "Geen uitvoer" betekent dus niet "geen drift". Draai daarnaast de gates en de expliciete storage-/publicationquery.

---

## De ontsnappingsroute

Er komt een moment dat de workflow stuk is, of dat je in een incident één statement kwijt moet. Plakken in de SQL Editor mag dan. **Maar er hoort één stap bij:**

```bash
supabase migration repair --status applied <14-cijferige versie>
```

Daarmee blijft de ledger eerlijk. Sla je dit over, dan denkt de ledger dat de migratie openstaat, probeert de volgende `migration up` hem opnieuw, en meldt `db diff` drift die er niet is — waarna je leert de melding te negeren.

**Dit is de belangrijkste gewoonte van dit runbook.** Een ledger die soms wordt bijgehouden is slechter dan geen ledger, want je gaat hem vertrouwen.

Noteer bij elk gebruik van de ontsnappingsroute: wat, wanneer, waarom de poort niet is gebruikt, en dat de repair is uitgevoerd. In `openstaande-punten-en-risicos.md` als het structureel wordt.

---

## Wat je nooit doet

- **De baselinedump in `supabase/baseline/` wijzigen.** Elke schemawijziging is een nieuwe forward-migratie met `_ROLLBACK`.
- **Een aangepaste versie van het migratiebestand plakken.** Wat op productie draait, moet byte-identiek in de repo staan. Anders is de repo geen bron van waarheid meer en heb je drift gemaakt in plaats van gevonden.
- **Een migratie op productie toepassen die niet op een wegwerp-DB is gedraaid.**
- **Een bevinding als opgelost markeren op grond van een migratiebestand.** `CLAUDE.md` r. 27: *"een revoke, een policy of een comment in een migratiebestand bewijst niets over productie."* Alleen een gate-run of `db diff` tegen productie is bewijs.
- **De gate-run overslaan omdat "het maar een kleine wijziging" is.** Bouwen en controleren zijn twee verschillende dingen.

---

## Rollen

| Rol | Wie | Verantwoordelijk voor |
|---|---|---|
| Aanvrager | de ontwikkelaar of Claude Code-sessie | migratie + rollback + eindcontrole binnen één transactie, CI groen |
| PR-reviewer | required reviewer via branch protection | **de SQL zelf lezen** vóór de merge — eerste paar ogen |
| Goedkeurder | reviewer op environment `production-db` | het `plan`-artefact lezen, goedkeuren of afwijzen — tweede paar ogen |
| Uitvoerder | de workflow (`apply`) | checksums verifiëren, toepassen, ledger schrijven, gates draaien |

**Let op: vierogen is niet afdwingbaar met een environment alleen.** GitHub vraagt **één** goedkeuring, ook als je meerdere reviewers configureert. Meerdere reviewers instellen helpt voor *beschikbaarheid*, niet voor vierogen.

Wil je echt twee mensen: zet required reviewers op de PR via branch protection (paar ogen 1, op de SQL) **plus** de environment-goedkeuring op `apply` (paar ogen 2, op het plan). Dat zijn twee mensen op twee momenten — sterker dan twee mensen op hetzelfde moment. Zet daarnaast *prevent self-review* aan en sta geen admin-bypass toe.

---

## §C · Inrichtingschecklist — af te vinken vóór §B geldt

Uit `ONTWERPNOTITIE-MIGRATIEPROCES-v2.md` §12. De volgorde is niet vrij.

**Fase 0 — bevriezen en vastleggen (read-only, kan vandaag)**
- [ ] Handmatige productie-DDL bevroren tot fase 3 af is.
- [ ] Productiemajor vastgesteld met `SHOW server_version_num` — **niet** uit een dump, die is daar niet betrouwbaar voor.
- [ ] Schema en rollen read-only vastgelegd als *bewijsmateriaal*, nog niet als baseline. (`supabase db dump` is standaard schema-only; er is géén `--schema-only`-flag.)
- [ ] Verschillen met Preview geclassificeerd: **gewenst** / **providergebonden** / **ongewenste drift**. Een omgevingsverschil is niet automatisch drift.
- [ ] Open vraag beantwoord: waar is `2026_08_15_t14b_production_drift_repair.sql`? Die bestaat alleen lokaal, op geen remote branch — dus óf de drift staat er nog, óf er is een productiewijziging zonder repospoor.

**Fase 1 — de map opschonen, vóór het hernummeren**
- [ ] 123 `*_ROLLBACK.sql` naar `supabase/rollbacks/`. **Kritiek:** de CLI past élk geldig SQL-bestand in `supabase/migrations/` toe. Van de 282 bestanden daar zijn er 135 géén forward-migratie.
- [ ] 2 `*_seed_preview.sql` naar `supabase/seeds/preview/`.
- [ ] De 10 overige `*seed*.sql` **per bestand** geclassificeerd: referentiedata die het schema nodig heeft (→ baseline of expliciete CI-seedstap) of demonstratiedata (→ `seeds/`). De huidige runner past ze nu toe; blind weghalen breekt de test-DB.
- [ ] `scripts/testdb-apply-migrations.sh` op de nieuwe paden; de filters op `ROLLBACK`/`seed` vervallen — de mapindeling doet dat werk.
- [ ] CI-check: faalt als `supabase/migrations/` een bestand met `ROLLBACK` of `seed` bevat.
- [ ] 147 echte forward-migraties hernoemd naar `^[0-9]{14}_`, met `HERNUMMERING-2026-08.md` als mapping.
- [ ] CI-check: faalt op een naam zonder 14-cijferig tijdstempel.

**Fase 2 — één geaccepteerde baseline**
- [ ] `supabase/migrations/20260818000000_accepted_baseline.sql` — **in** de migratiemap, want `db diff` en de shadow-DB lezen alleen daar.
- [ ] Pre-baseline forwards naar `supabase/archief/migrations/`.
- [ ] Een **lege** database volledig opgebouwd uit alleen `supabase/migrations/` — dit moet slagen, anders is er geen baseline.
- [ ] Alle gates groen tegen die verse database.

**Fase 3 — ledger op precies één versie**
- [ ] `supabase migration repair --status applied 20260818000000` — **alleen die ene**, niet alle 147.
- [ ] `supabase migration list` synchroon bewezen.

**Fase 4 — prerequisites, dan de poort**
- [ ] **Versiegelijkheid** tussen productie en test-DB, of expliciet als restrisico belegd.
- [ ] **Geslaagde restore-oefening of werkende PITR-procedure, met gemeten RTO.** Een post-migratiegate kan een gecommitteerde wijziging niet terugdraaien. PR #21 raakt dit; "geslaagd" is een meting, geen commit.
- [ ] Workflow met **twee jobs**: `plan` (zonder goedkeuring, levert bestandslijst + SQL + sha256 als artefact) en `apply` (`needs: plan`, `environment: production-db`, verifieert checksums, past toe, draait gates).
- [ ] Bevestiging **werkelijk gevalideerd** (`test "$bevestiging" = "MIGREER"`), niet alleen `required: true`.
- [ ] Branchrestrictie op `main`, deployment-concurrency, *prevent self-review*, geen admin-bypass.
- [ ] Vierogen via branch protection op de PR **plus** de environment-goedkeuring — niet via meerdere environment-reviewers, want GitHub vraagt er één.
- [ ] Per-bestand `begin;`/`commit;`, met een **uitzonderingenregister** voor niet-transactionele migraties (`CREATE INDEX CONCURRENTLY`, sommige `ALTER TYPE`) en per stuk de herstelstap. `migration up` heeft géén `--single-transaction`.

**Fase 5 — driftdetectie**
- [ ] Nachtelijke `db diff` met een read-only rol; resultaat via het `CRON_SECRET`-endpoint, niet via een DB-verbinding uit CI.
- [ ] Gates A–H ernaast, en een **expliciete storage-/publicationquery** voor wat `db diff` niet ziet.

**Doorlopend**
- [ ] `_TEMPLATE.sql` met transactie-omhulling én eindcontrole-slotblok; CI-check op beide (structureel, geen gedragsbewijs).
- [ ] `CLAUDE.md` r. 51 aangevuld met de contract-richting (code eerst bij `DROP`).
- [ ] `SETUP.md` r. 27 verwijst naar de baseline in `supabase/migrations/` in plaats van naar `supabase/schema.sql`.

---

## Commando's

```bash
# Wat staat open t.o.v. productie?
supabase migration list --db-url "$PROD_DB_URL"

# Toepassen (doet de workflow; handmatig alleen via de ontsnappingsroute)
supabase migration up --db-url "$PROD_DB_URL"

# Ledger bijschrijven na handmatig plakken — VERPLICHT bij de ontsnappingsroute
supabase migration repair --status applied <versie>

# Driftdetectie, read-only
supabase db diff --db-url "$PROD_DB_URL_READONLY" --schema public,storage

# Securityeigenschappen toetsen (vult db diff aan, vervangt het niet)
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/checks/2026_07_31_r1_structurele_gates.sql

# Baseline nemen
supabase db dump --db-url "$PROD_DB_URL" --schema-only -f <pad>
```

**`db diff` en de gates toetsen verschillende dingen en vervangen elkaar niet.** `db diff` toetst *identiteit* — wijkt het schema af van de migraties. De gates toetsen *eigenschappen* — heeft elke tenanttabel een fondspredicaat, is elke `SECURITY DEFINER` gepind, heeft `anon` nergens schrijfrechten. Een consequent verkeerde policy geeft geen diff; een dashboardwijziging die de gates passeert blijft voor de gates onzichtbaar. Draai beide.
