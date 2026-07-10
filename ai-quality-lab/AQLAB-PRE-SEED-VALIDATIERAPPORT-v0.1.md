% AQLAB Pre-seed validatierapport v0.1
% Technische seed-/validatiespike · AI Output Quality & Governance Lab
% 10 juli 2026

# Samenvatting

Dit is de uitkomst van een **technische pre-seed-validatie** op de inhoudelijk akkoord bevonden set: `AQLAB-SEED-STRUCTUUR-v0.2.yaml`, `AQLAB-HORIZON-FIXTURES-v0.2.md`. Er is **geen inhoudelijke herstructurering** uitgevoerd en er zijn **geen productiewijzigingen** doorgevoerd; het rapport is read-only op de seed-artefacten.

| Onderdeel | Resultaat |
| --- | --- |
| Structurele checks (YAML) | **271 / 271 geslaagd, 0 failures** |
| Testcases | 33 ✓ |
| Fixture-ID's | 24 ✓ (over 22 secties) |
| Canonical hashes berekend | **24 / 24** ✓ (zie `AQLAB-FIXTURE-HASHES-v0.1.yaml`) |
| Seeding toegestaan? | **NEE — geblokkeerd door de seeding-gate** (4 openstaande poorten) |

De set is **technisch structureel seed-ready**: een loader kan volledig uit de YAML draaien. Seeding blijft **geblokkeerd** tot de vier gate-condities groen zijn (zie §Seeding-gate).

# 1. Structurele validatie (YAML)

Alle checks uit punt 1 van de opdracht zijn programmatisch gedraaid op `AQLAB-SEED-STRUCTUUR-v0.2.yaml`:

| Check | Uitkomst |
| --- | --- |
| YAML valide | ✓ |
| 33 testcases aanwezig | ✓ |
| 24 fixture-ID's aanwezig | ✓ |
| Alle `required_source_ids` bestaan als fixture | ✓ (per testcase per bron gecontroleerd) |
| Alle `expected_facts` fixture-scoped en resolven (`{fixture_id, fact_id}`) | ✓ |
| Alle `checks` bestaan in de check-registry | ✓ |
| Alle `review_required`-cases hebben `review_instruction` of `human_review`-check | ✓ (17 review-cases) |
| Alle `consistency_required`-cases hebben `iterations` + pass-regel | ✓ (16 cases) |
| Bidirectionele fixture-koppeling (`linked_testcases` sluitend) | ✓ |
| `excluded_source_ids` bestaan (m.u.v. bewust niet-bestaande `HORIZON-NIET-BESTAAND-XXX` voor SEC-05) | ✓ |

**Failures: geen.** De volledige machinerapportage (271 checks) staat in `preseed_report.json`.

# 2. Canonical text + content_hash

Per hashingconventie berekend (sha256 over de `canonical_text` = blockquote "Volledige synthetische tekst", LF-genormaliseerd, trailing whitespace verwijderd, exact één trailing newline, UTF-8). De bronset FIX-10 is gesplitst in drie aparte canonical_texts (Bron 1/2/3), elk met een eigen hash.

Alle **24 hashes** staan in `AQLAB-FIXTURE-HASHES-v0.1.yaml`. Voorbeelden:

- `HORIZON-CIJFERS-001` (v1): `aea4f79424fdcc97…` (308 tekens)
- `HORIZON-REGLEMENT-001` (v1): `2b3ae1f158122acb…` (422 tekens)
- `HORIZON-DOC-ACTUEEL-001` (**v2**): `00526e4143e042fa…` (192 tekens)

**Reproduceerbare bronreferentie in een run:** `fixture_id + versie + content_hash`. Deze drie samen identificeren onveranderlijk welke exacte tekst is gebruikt.

**Niet ingevuld in de bron.** De hashes zijn **berekend** maar **niet** in `AQLAB-HORIZON-FIXTURES-v0.2.md`/de seed-YAML geschreven (dat is een wijziging die expliciete goedkeuring vraagt). Bovendien zijn de hashes van de **compliance-/AVG-fixtures provisorisch**: als hun tekst na juridische/AVG-validatie wijzigt, verandert de hash en moet `versie` omhoog. Advies: vul hashes pas definitief in ná die validatie.

> **Opvolging:** de twee bevindingen hieronder (§3 en §4) zijn vastgelegd als ontwerpbesluit in **`../decisions/0056-aqlab-consistentie-correctheid-en-stability.md`**.

# 3. Bevinding — `source_stability` vs `retrieval_stability`

De huidige consistentiemeting kent één bronmetric: `source_stability` (stabiliteit van de **geciteerde/gebruikte** bronnen in de output). Punt 3 vraagt terecht een onderscheid:

- **`source_stability`** — meet of het **model** over iteraties dezelfde bron-ID's citeert/gebruikt in het antwoord. Dit meet modelgedrag.
- **`retrieval_stability`** *(nieuw, aparte technische metric)* — meet of de **retrieval-laag** over iteraties dezelfde bron-ID's/chunks teruggeeft (vóór generatie). Dit meet de infrastructuur.

Deze zijn verschillend: retrieval kan wisselen terwijl het model toch stabiel citeert, of andersom. Bij een instabiel antwoord helpt dit onderscheid de oorzaak te lokaliseren (model vs retrieval). **Aanbeveling (ontwerp, vereist akkoord):** neem `retrieval_stability` op als aparte technische metric in het consistentie-aggregaat; de seedloader reserveert het veld alvast (zie seedloader-voorstel). Dit is een **aanbeveling**, geen doorgevoerde wijziging.

# 4. Bevinding — consistent fout gedrag mag niet positief scoren

De consistentiemeting meet **stabiliteit**. Stabiliteit alleen is misleidend: een output die 5/5 iteraties **hetzelfde, maar fout** antwoordt, scoort hoog op stabiliteit. Punt 4 vraagt terecht om stabiliteit te koppelen aan **correctheid**. Voorstel voor de metrics die een run per (consistentie-)testcase moet berekenen — **stabiliteit én correctheid**:

| Metric | Meet | Type |
| --- | --- | --- |
| `gate_pass_rate` | fractie iteraties met `gate_status = passed` | correctheid |
| `fact_correctness_rate` | fractie iteraties waarin de `expected_facts` **juist** zijn (niet slechts identiek) | correctheid |
| `source_correctness_rate` | fractie iteraties met de **juiste** toegestane bronnen + labels | correctheid |
| `format_pass_rate` | fractie iteraties met alle `required_sections` | correctheid |
| `score_spread` | spreiding van `quality_score` | stabiliteit |
| `gate_stability` / `fact_stability` / `source_stability` / `format_stability` | identiek-over-iteraties | stabiliteit |

**Ontwerpregel:** een testcase is pas `consistent` én `release_eligible` als **zowel** de stabiliteitsmaten (identiek over iteraties) **als** de correctheidsmaten (pass/juist) voldoen. Een hoge stabiliteit met lage `*_correctness_rate` → **niet** vrijgeefbaar; markeer als `consistent_but_incorrect` (blokkerend). Dit voorkomt dat consistent fout gedrag positief scoort. **Aanbeveling (ontwerp, vereist akkoord)** — nog niet in de regressieset doorgevoerd, want dat zou inhoudelijke herstructurering zijn.

# 5. Bevinding — `[Volgens wetgeving]`-checks

Testcases met een `[Volgens wetgeving]`-label: **BS-06, BV-04, SEC-04**. Conform punt 5 worden checks op dit label in de MVP behandeld als **judge/mens-beoordeling**, **niet** als volledig deterministische check — er is (nog) geen synthetische wetgevingsfixture waartegen deterministisch te toetsen valt. De aanwezigheid van het label (`required_labels`) blijft deterministisch toetsbaar; de **juistheid van de wettelijke duiding** is judge/mens. Zodra later een aparte synthetische wetgevingsfixture wordt toegevoegd, kan een deel hiervan deterministisch worden. Dit is als expliciete aanname vastgelegd; de check-classificatie in de YAML (judge/human op deze cases) is hiermee consistent.

# 6. Seeding-gate (blokkerend)

Seeding is **geblokkeerd** zolang één van de volgende poorten open staat:

| Poort | Status | Toelichting |
| --- | --- | --- |
| `content_hash` placeholders bestaan | **OPEN** | hashes berekend, nog niet ingevuld (§2) |
| AVG-scope SEC-06 bevestigd | **OPEN** | juridische/FG-bevestiging vereist |
| Juridische/compliance-duiding BS-06, BV-04, SEC-04 gevalideerd | **OPEN** | juridische bevestiging vereist |
| Judge-JSON-schema's aanwezig | **OPEN** | nog niet gedefinieerd |

**`SEED_ALLOWED = false`.** De gate is als code-check opgenomen in de validatie en in het seedloader-voorstel, zodat seeding technisch niet kan starten tot alle vier groen zijn.

# 7. Failures

**Geen functionele failures.** De enige "openstaande" items zijn de vier **bewuste** gate-poorten (§6) — dat zijn geen fouten maar geplande validatiestappen. De structurele set is 271/271 groen.

# 8. Conclusie

- Structureel/technisch: **groen** (271/271, 24 hashes, executeerbare YAML).
- Inhoudelijk/juridisch: **openstaand** (AVG + compliance-duiding).
- Technisch resterend: **judge-schema's** + het invullen van de hashes.
- Twee ontwerp-aanbevelingen (correctheidsmetrics §4, `retrieval_stability` §3) die stabiliteit-zonder-correctheid en oorzaakanalyse verbeteren — ter besluitvorming, niet doorgevoerd.

**Advies: NO-GO voor seeden; GO om de vier gate-poorten te sluiten.** Volgorde: juridische/AVG-validatie → judge-schema's → hashes invullen (na tekst-freeze) → gate opnieuw draaien (dan groen) → seeden via de loader (§seedloader-voorstel).
