# R1b hybride zoekpad → indexwissel en herstel: draaiboek (concept, lokaal getest)

**Status: concept.** Niets hiervan is op Preview of Productie uitgevoerd. Elke fase (P1–P5, H en H4b) vraagt een **afzonderlijk, expliciet akkoord**.

De HNSW-kwaliteitspoort op echte vragen blijft **rood**: de lokale synthetische recallmatrix bewijst niets over echte embeddings of gebruikersvragen. Dit draaiboek gaat alleen over de veilige volgorde van DDL en herstel. §6 zegt wat lokaal bewezen is en wat **NO-GO** blijft.

## 0. Bestanden

| Bestand | Fase | Uitvoering |
|---|---|---|
| `supabase/checks/2026_10_09_r1b_indexstand_readonly.sql` | vóór/na elke stap | read-only, één SELECT (SQL-editor of psql) |
| `scripts/ops/r1b/_doelguard.psql` | via `\ir` in elk ops-script | weigert vóór DDL: doelomgeving, sessie, catalogus-/indexstand |
| `scripts/ops/r1b/p1-partiele-index-concurrent.psql` | P1 | psql, autocommit, directe verbinding |
| `supabase/migrations/2026_10_08_r1b_hybride_begrensd.sql` | P2 | SQL-editor; **geen** automatische doelguard (handmatige poort, §2b); **bouwt geen index**; `lock_timeout` 5 s; weigert fail-closed als de partiële index ontbreekt, ongeldig is of een afwijkende definitie heeft (ongeacht de tabelgrootte); P1 is dus verplicht. SHA-256 `1c1b996f6f2c5ac207ac10384d6d2d7ad346d79090758ddc33ac66e4b9abdea3` |
| `scripts/testdb-apply-migrations.sh` | lokale replay/CI | weigert elke niet-loopback-bestemming vóór de eerste DDL (alleen `postgresql://`/`postgres://` naar 127.0.0.1, localhost of ::1; geen query/fragment; geen `PGHOSTADDR`/`PGSERVICE`); draait vlak vóór de R1b-migratie expliciet de lokale voorbereiding P1 (`p1-…psql`, `doelomgeving=lokaal`) |
| `scripts/ops/r1b/p5-cutover-volledige-index-verwijderen.psql` | P5 | psql, autocommit, directe verbinding |
| `scripts/ops/r1b/h-volledige-index-herstel.psql` | H (H1–H3) | psql, autocommit, directe verbinding; standaard serieel |
| `supabase/rollbacks/2026_10_08_r1b_hybride_begrensd_ROLLBACK.sql` | H4a | transactioneel, `set local lock_timeout = '5s'`; **geen** automatische doelguard (handmatige poort, §2b); verwijdert **alleen de functie**; weigert zolang de volledige index niet geldig + gereed + met de oorspronkelijke definitie bestaat. SHA-256 `2969a8efea207f0519e2320df84abcff428a3b8caca724311768fb0014908b4d` |
| `scripts/ops/r1b/h4b-partiele-index-verwijderen.psql` | H4b | psql, autocommit; `DROP INDEX CONCURRENTLY`, eigen poort |
| `tests/karakterisering/r1b-draaiboek-cyclus-lokaal.sh` | lokale proef | volledige cyclus met de echte ops-scripts, EXIT-vangnet en testhaak |
| `tests/karakterisering/r1b-herstel-faalpad-lokaal.mjs` | lokale proef | afgebroken herbouw, grendels, herstel, idempotentie |
| `tests/karakterisering/r1b-cutover-concurrent-lokaal.mjs` | lokale proef | cutover + T4 zonder volledige index |

## 1. Waarom twee fasen en geen enkele transactie

- **Geen transactieblok.** `CREATE/DROP INDEX CONCURRENTLY` kan niet in een transactieblok. De SQL-editor en de Management API bieden een script met meerdere statements als één transactie aan. Elke concurrente stap draait daarom apart, via psql met een **directe** databaseverbinding, in autocommit.
- **Afbreken laat een ongeldige index achter.** Dat geldt voor `CREATE` én `DROP INDEX CONCURRENTLY`, bij een lock- of statementtimeout, annulering, geheugen of schijf.
  - `CREATE INDEX IF NOT EXISTS` slaat zo'n index stil over, en een bestaanscontrole (`to_regclass`) ziet hem als aanwezig.
  - Alle grendels eisen daarom `indisvalid AND indisready` **én** de gepinde definitie.
  - **Een afgebroken P5 kan de VOLLEDIGE index ongeldig achterlaten:** het oude pad heeft dan geen bruikbare HNSW meer ⇒ direct fase H.
  - **Een afgebroken H4b laat de partiële index ongeldig achter:** H4b opnieuw draaien.
- **Locks:**
  - Concurrent bouwen en verwijderen nemen SHARE UPDATE EXCLUSIVE; lezen en schrijven gaan door. Lokaal: 181 rollback-inserts tijdens een herbouw, maximaal 599 ms, 0 fouten.
  - Beide wachten wel op lopende transacties. `lock_timeout` 5 s (uit de guard) breekt af in plaats van onbegrensd te wachten. Lokaal brak H4b bij een open schrijftransactie na 6,1 s af.
  - **`DROP INDEX` binnen een transactie** neemt ACCESS EXCLUSIVE op `document_chunks`: alle lezers en schrijvers wachten. Daarom doet de rollback (H4a) dat **niet meer**; de partiële index gaat apart en concurrent (H4b).
- **Parallelle bouw:** lokaal faalde een parallelle herstelbouw (2 workers) op `/dev/shm` (Docker, 64 MB) met een ongeldige index als resultaat. P1 en H bouwen daarom standaard **serieel** (`max_parallel_maintenance_workers = 0`): lokaal 43–60 s tegenover ~17–19 s parallel. Bewust parallel kan met `-v bouw_parallel=2` of `-v herstel_parallel=2`. De `/dev/shm`-grootte en het geheugen op Supabase zijn **onbekend**.
- **Vrije ruimte:** een concurrente bouw vraagt tijdelijk de ruimte van een extra index.

  | Omgeving | Volledige index | Partiële index |
  |---|---|---|
  | Productie (read-only gezien op 9-10) | ~201 MB | — |
  | Lokaal | ~199 MB | ~119 MB |

  Controleer de vrije schijfruimte in het Supabase-dashboard vóór P1 en H. Minstens 2× de index plus marge; anders **stop**.

## 2. Doelverificatie vóór DDL

Er zijn twee soorten stappen, met elk een eigen poort:

- **§2a — de psql-ops-scripts (P1, P5, H, H4b):** de automatische doelguard `_doelguard.psql`, plus de handmatige stap 0.
- **§2b — P2 (migratie) en H4a (rollback):** die worden in de SQL-editor geplakt en hebben **geen** automatische doelguard. Hun eigen grendels controleren alleen de indexstand, niet de doelomgeving. Voor die twee geldt de handmatige poort van §2b.

### 2a. De psql-ops-scripts (P1, P5, H, H4b)

**Stap 0, handmatig:** de operator controleert dat de verbindingshost het **bedoelde project-ref** is (Preview `swviwoytzvaqypieqgji`, Productie `aebwiufuegsiwhwpdrfb`) en een **directe** verbinding is (poort 5432 op de databasehost, geen transactiepooler). Het project-ref is in SQL niet zichtbaar.

**Daarna dwingt `_doelguard.psql` af** (exit ≠ 0, vóór enige wijziging):
1. `-v doelomgeving=lokaal|preview|productie` en `-v fase=P1|P5|H|H4b` zijn verplicht; een onbekende waarde wordt geweigerd.
2. De rol moet `tenant_domains` volledig kunnen lezen (eigenaar of BYPASSRLS).
3. De tenantdomeinen moeten bij het doel passen:
   - **lokaal:** geen `*bestuurdersportaal.com`, en een loopback- of docker-adres;
   - **preview:** alleen `*.preview.bestuurdersportaal.com`;
   - **productie:** `*.bestuurdersportaal.com` en geen preview-host.
4. **Sessietoets:** dezelfde backend-pid vóór en na een `SET`, en de `SET` blijft staan. Een transactiepooler zakt hierop. Ook geen PostgREST-sessie (`request.jwt.claims`).
5. **Exacte catalogus- en indexstand per fase.** Een onbekende HNSW-index, een andere ongeldige index of een lopende indexbouw leidt altijd tot **stop**.

| Fase | Verwachte stand vóór de stap |
|---|---|
| P1 | volledige index geldig met gepinde definitie; géén partiële index; géén R1b-functie |
| P5 | beide indexen geldig met gepinde definitie; R1b-functie aanwezig |
| H | partiële index geldig of afwezig; volledige index afwezig, ongeldig of geldig (geldig = no-op). Een geldige volledige index met een **afwijkende** definitie ⇒ stop |
| H4b | volledige index geldig met gepinde definitie; R1b-functie al weg (H4a) |

### 2b. Handmatige poort voor P2 en H4a (geen automatische doelguard)

Direct vóór het plakken, door de uitvoerder; bij voorkeur controleert een tweede persoon mee. Elke afwijking ⇒ **stop**.

1. **Project-ref:** de URL van de SQL-editor bevat exact het bedoelde project-ref (Preview `swviwoytzvaqypieqgji`, Productie `aebwiufuegsiwhwpdrfb`).
2. **Tenantcontrole in hetzelfde editortabblad:** `select host from public.tenant_domains where actief` past bij die omgeving (Preview alleen `*.preview.bestuurdersportaal.com`; Productie geen preview-host).
3. **Pin:** `shasum -a 256` van het bestand dat je plakt is gelijk aan de pin in §0. Wijkt die af, dan niet plakken.
4. **Read-only preflight in hetzelfde tabblad:** `supabase/checks/2026_10_09_r1b_indexstand_readonly.sql`, met de verwachte stand:

   | Stap | Verwachte stand |
   |---|---|
   | P2 | `volledig_geldig = t`, `partieel_geldig = t` en `partieel_def_ok = t` (P1 is gedaan), `ongeldige_indexen = 0`, `lopende_indexbouw = 0`, `r1b_functie = 0` |
   | H4a | `volledig_geldig = t`, `volledig_def_ok = t`, `ongeldige_indexen = 0`, `lopende_indexbouw = 0` |

## 3. Releasevolgorde (elke fase apart akkoord)

| Fase | Actie | Stopregel |
|---|---|---|
| **P0** | Read-only preflight (indexstand, schijfruimte, rust, R1 A–H, V3) | `ongeldige_indexen ≠ 0`, `lopende_indexbouw ≠ 0` of te weinig ruimte ⇒ stop |
| **P1** | `p1-partiele-index-concurrent.psql` | Mislukt ⇒ partiële index ongeldig ⇒ `h4b-…psql` (ruimt op) en **stop** voor analyse |
| **P2** | Handmatige poort §2b, dan de migratie (bouwt niets; weigert zonder geldige, gepinde P1-index) | Grendel rood ⇒ stop, terug naar P1 (of H4b + P1 bij een ongeldige index) |
| **P3** | Postcheck: indexstand, R1 A–H, V3 (3 allowlistregels), T4-matrix op de nieuwe RPC | Afwijking ⇒ H4a (+ apart H4b), stop |
| **P4** | Canary: env `ZOEK_HYBRIDE_V2=on` + fondsvlag op één fonds | Zie §4: **geen vrijgavepoort** zolang beide indexen bestaan, tenzij met planbewijs |
| **P5** | Cutover: `p5-cutover-volledige-index-verwijderen.psql` | Afgebroken ⇒ volledige index mogelijk ongeldig ⇒ **direct H** |

## 4. Correctie: P4 vóór P5 bewijst geen kwaliteit zonder planbewijs

Zolang de volledige én de partiële index naast elkaar bestaan, kan de planner voor de generieke vectorarm de **volledige** index kiezen. Lokaal werd de generieke HNSW-recall juist **rood** in de stand met beide indexen. Een canary in die stand toetst dan mogelijk de verkeerde index.

**Regel:** een P4-canary telt pas als kwaliteitsbewijs als **per representatieve vraagklasse aantoonbaar is dat de nieuwe RPC de partiële index gebruikt**:
- `EXPLAIN` onder `authenticated` met een realistische generieke scope en vector toont `Index Scan using idx_chunks_embedding_generiek_r1b`;
- **en** de teller van de partiële index in `pg_stat_user_indexes.idx_scan` loopt op tijdens de canary.

Ontbreekt dat bewijs, dan is P4 **geen vrijgavepoort** en moet de volgorde opnieuw ontworpen worden. Mogelijke richtingen, elk een eigen ontwerpbesluit en geen van alle uitgevoerd:
1. **Eerst een kwaliteitsmeting met de partiële index als enige HNSW.** Bijvoorbeeld op een aparte kopie of in een tijdvenster na P5 met vlag uit, en pas daarna een canary. Dit vergt dat de oude RPC zonder volledige index aantoonbaar correct én bruikbaar blijft: lokaal 4/4 monsters gelijk en T4 groen, maar dat is een steekproef, geen bewijs.
2. **Planbinding binnen de functie,** zodat de generieke arm alleen de partiële index kan gebruiken. Dat is een nieuwe RPC-wijziging met eigen recall- en kostenmeting.
3. **P4 alleen als functionele/operationele canary** (latency, geen time-out, geen lek) en uitdrukkelijk niet als kwaliteitspoort.

## 5. Herstelvolgorde (fase H) — nooit andersom

1. **H0:** vlag uit (`ZOEK_HYBRIDE_V2` en/of fondsvlag `false`).
2. **H1–H3:**
   ```
   psql "$DB" -v ON_ERROR_STOP=1 -v doelomgeving=<…> -v fase=H -f scripts/ops/r1b/h-volledige-index-herstel.psql
   ```
   - H1 ruimt een ongeldige volledige index concurrent op.
   - H2 bouwt hem concurrent en serieel.
   - H3 eist geldig, gereed en een gelijke definitie; anders stop.
   - Is er geen enkele geldige HNSW meer, dan meldt het script een INCIDENT en gaat het toch door met herstellen. Idempotent.
3. **Controle:** indexstand `volledig_geldig = t`, `volledig_def_ok = t`, `ongeldige_indexen = 0`.
4. **H4a:** de transactionele rollback verwijdert alleen de R1b-functie (`lock_timeout` 5 s). Die weigert zelf zolang stap 3 niet groen is.
5. **H4b, eigen poort:** de partiële index concurrent verwijderen. Breekt dit af (lock), dan blijft hij ongeldig ⇒ H4b herhalen.
6. **Codewijziging:** de 3 allowlistregels en de appschakelaar via een gewone PR terugdraaien.

## 6. Wat lokaal bewezen is en wat NO-GO blijft

**Lokaal bewezen** (9-10-2026, PR0-wegwerpdatabase met 25.471 synthetische chunks, Docker, pgvector 0.8.2). Elke proef eindigde met een vingerafdruk gelijk aan vooraf: indexdefinities, functie-md5's, rijtelling en id-hash.

*Volledige draaiboekcyclus, met de echte ops-scripts:*
- 5 guard-weigeringen vóór DDL: ontbrekende doelvariabele, verkeerde doelomgeving, onverwachte stand, H4b met functie, onbekende fase;
- H4a verwijderde alleen de functie;
- H4b bij een open write brak na 6,1 s af (ongeldige index); opnieuw draaien kostte 462 ms;
- P1 43 s (serieel); P2 met grendels groen; P5 2 s;
- H4a weigert in de single-index-stand;
- H 59 s (serieel); eindstand gelijk aan de beginstand.

*Opzettelijke faalpaden in de cyclus (EXIT-vangnet):*
- een fout tijdens de open write: schrijver beëindigd, 0 resterende backends, exitcode 97 behouden;
- een fout na P5: het vangnet herstelde de volledige index via H, exitcode 97 behouden.

*Faalpad-harness:*
- een afgebroken herbouw liet een ongeldige index achter;
- de oude bestaanscontrole zou de rollback hebben toegelaten; de nieuwe grendel weigert;
- herstel H1→H3 in 60 s, met 181 inserts tijdens de bouw, maximaal 599 ms en 0 fouten;
- de oude RPC bleef gelijk en het herstel is idempotent;
- een falend herstel stopt de schrijfprobe en geeft de oorspronkelijke fout door;
- de migratie weigert een ongeldige partiële index.

*Cutover-harness:* oude RPC 4/4 gelijk zonder volledige index; T4 groen, met de negatieve controle rood op T12.

*Volledige lokale CI-DB-suite (9 oktober):* `cross-tenant-ci.sh` op een verse lokale stack: `CI-EXIT=0`, app-laag 1345/1345. De migratiereplay deed P1 expliciet vóór P2; R1 A–H inclusief D, V3 en de R1b-T4-fondsdiscipline waren groen. De R1b-T4-controle gebruikte `vector NULL` en bewijst dus alleen de FTS-/tenantgrens, niet de HNSW-arm of recall op echte gebruikersvragen.

**Niet bewezen / NO-GO voor Preview en Productie:**
- **P2 opgelost (lokaal):** de migratie bevat geen `CREATE INDEX` meer en weigert zonder een geldige, gepinde P1-index. Het remote risico van een stille blokkerende bouw is daarmee weg. P2 blijft wel afhankelijk van een geslaagde P1 en van de handmatige poort §2b.
- **Kwaliteit:** HNSW-recall op echte embeddings en vragen (rood). P4 is in de stand met twee indexen geen vrijgavepoort (§4).
- **Productie-uitvoering:** bouw- en herbouwtijd van ~200 MB HNSW op Micro, geheugen en `/dev/shm`, lockwachttijden onder echte belasting, en vrije schijfruimte. Allemaal onbekend.
- **Transactiepooler-detectie:** de sessietoets is lokaal alleen positief getoetst (directe verbinding), niet tegen een echte pooler.
- **Doelguard op remote:** de guards voor `preview` en `productie` zijn lokaal alleen als weigering getoetst, nooit als positieve doorgang op een echte omgeving.
- **Oude RPC zonder volledige index:** alleen een steekproef (4 monsters + T4), geen volledige regressie of belastingsproef.
- **Schrijfkosten:** de dubbele schrijfkosten zolang beide indexen bestaan (~3× per 1.000 generieke chunks, lokaal) zijn niet als budget geaccepteerd.
