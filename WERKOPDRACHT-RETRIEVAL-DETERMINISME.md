# Werkopdracht: reproduceerbare retrieval — stille queryherschrijving en non-determinisme

> Overdracht van plansessie (Cowork, 06-08-2026) naar Claude Code. Plak dit als eerste bericht in een Claude Code-sessie in de repo-root. Zie `decisions/0004` en `WERKOPDRACHT-TEMPLATE.md`.
>
> **Volgorde-eis: deze opdracht gaat vóór `WERKOPDRACHT-RETRIEVAL-RECALL.md` en `WERKOPDRACHT-ANTWOORDLENGTE.md`.** De acceptatiecriteria van beide zijn niet toetsbaar zolang dezelfde vraag verschillende zoekvragen kan opleveren. Zie §Waarom dit eerst.

---

## Doel & context

Een bestuurder stelde tweemaal exact dezelfde vraag en kreeg twee verschillende bronnensets. Uit `governance_log`:

| | 15:29:32 | 15:34:04 |
|---|---|---|
| Gestelde vraag | Wat zijn onze strategische doelstellingen? | *identiek* |
| **Daadwerkelijk gezocht** | "Wat zijn de strategische doelstellingen van Stichting Pensioenfonds voor Huisartsen?" | "Strategische doelstellingen Stichting Pensioenfonds voor Huisartsen" |
| `gereformuleerd` | `true` | `true` |
| `beurten_in_draad` | 13 | 15 |
| `methode` | `hybride_rrf` | `hybride_rrf` |
| `opgehaald` / `geselecteerd` | 30 / 10 | 30 / 10 |
| `rerank_toegepast` / `drempel_gedropt` | `null` / `null` | `null` / `null` |

Zelfde gespreksdraad (`87a74d4b-…`), zelfde methode, zelfde filters, zelfde peildatum. Het enige verschil is de **herschreven zoekvraag** — en die verschilt omdat de herschrijving zelf een gesamplede modelcall is.

Het portaal belooft de bestuurder dat elke vraag wordt vastgelegd inclusief welke bron is gebruikt. Als dezelfde vraag verschillende bronnen oplevert, is "de assistent zei X op basis van bron Y" niet reproduceerbaar. **Dat is een auditprobleem, geen gebruikerservaringsprobleem.**

Tweede waarneming, uit dezelfde dag: bij *"Wat staat er in het reglement over pensioneren?"* (11:44:46) werd gezocht op *"Wat staat er in het pensioenreglement 2026 over pensioneren?"* — de herschrijving voegde twee termen toe aan een `websearch_to_tsquery`-AND-keten die toch al kansloos was. Reformulatie kan de recall dus actief verslechteren.

## Diagnose — twee defecten in één functie, plus drie latente risico's

### Defect 1: reformulatie vuurt op proxies in plaats van op afhankelijkheid

`core/lib/query-reformulatie.ts:46-67`. Twee condities uit die functie zijn in het Nederlands vrijwel altijd waar:

```ts
// Korte vragen leunen bijna altijd op eerdere context.
if (woorden.length <= 5) return true;
```

*"Wat zijn onze strategische doelstellingen?"* is exact vijf woorden en volledig zelfstandig. Elke bondige vraag in een lopende draad wordt zo herschreven.

```ts
if (woorden.some((w) => VERWIJSWOORDEN.has(w))) return true;
```

met (`:20-27`):

```ts
const VERWIJSWOORDEN = new Set([
  "dat", "die", "dit", "deze", "diens", "hun",
  "hij", "zij", "ze", "het", "hem", "haar",
  ...
```

**`het` staat erin.** Dat is het meest voorkomende woord van het Nederlands en in verreweg de meeste gevallen een lidwoord, geen anafoor. Hetzelfde geldt voor `die`, `dat` en `deze` als determinator ("dat reglement", "deze regeling"), en voor `zij`/`ze`/`haar`/`hun` in niet-verwijzend gebruik. *"Wat staat er in **het** reglement over pensioneren?"* vuurt hierop, ondanks acht woorden.

Dit is hetzelfde patroon als bij de bronkeuze-twijfelbak en de vijf-woordenregel: **een heuristiek die correleert met het probleem in plaats van het probleem te detecteren.** Inmiddels drie keer in drie verschillende modules.

### Defect 2: de herschrijving is niet reproduceerbaar

`query-reformulatie.ts:109-119` — `client.messages.create({ model, max_tokens: 150, system, messages })`. **Geen `temperature`**, dus de SDK-default. Twee identieke aanroepen kunnen twee verschillende zoekvragen opleveren, en dat is precies wat er om 15:29 en 15:34 gebeurde.

Dezelfde omissie in `core/lib/rerank.ts:175-181` — ook daar geen `temperature`, geen `top_p`. De reranker staat nu uit (`rerank_toegepast: null` in beide beurten, bevestigd), maar M3 in `WERKOPDRACHT-RETRIEVAL-RECALL.md` zet hem aan. Wordt dit niet eerst gerepareerd, dan introduceert die maatregel een tweede non-determinismebron bovenop de eerste.

**Bijvangst om te controleren:** het modulecommentaar (`query-reformulatie.ts:10-11`) spreekt van "een lichte Haiku-call", terwijl `app/api/chat/route.ts:98` `REWRITE_MODEL = "claude-sonnet-4-6"` zet. Documentatie en code lopen uiteen; stel vast welke van de twee de bedoeling is voordat je `temperature` toevoegt.

### Latent risico 3: geen deterministische tiebreaker in de hybride SQL

`supabase/migrations/2026_07_10_t10_retrieval_review_verval.sql`, drie plekken:

- r. 198 / 228-229: `row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc)` en `order by … desc limit p_kandidaten`
- r. 233 / 262-263: `row_number() over (order by dc.embedding <=> p_embedding)` en `order by … limit p_kandidaten`
- r. 285-286: `order by s.rrf desc limit p_limit`

Nergens `, dc.id` of `, dc.chunk_index`. Bij gelijke sorteersleutel plus `LIMIT` bepaalt de fysieke leesvolgorde wie de snijlijn haalt — en die verandert door een gewijzigd queryplan, VACUUM, HOT-updates of parallelle workers. De niet-hybride `zoek_chunks` **heeft** die tiebreaker wel (r. 137: `order by rang desc, c.chunk_index asc`); het is dus een omissie, geen keuze.

### Latent risico 4: `ef_search` is gelijk aan `p_kandidaten`

`2026_06_07_fase_c_embeddings.sql:28-29` legt de HNSW-index aan zonder parameters, dus pgvector-defaults. `hnsw.ef_search` wordt nergens in de repo gezet, dus 40. En `core/lib/rag.ts:910-917` geeft `p_kandidaten` niet mee, dus de RPC-default van 40 geldt.

De vector-arm vraagt dus exact zoveel rijen op als de graaf maximaal aanlevert, en past de fonds-, published- en modusfilters daar pas **ná** toe. Vullen semantisch vergelijkbare chunks die top-40 en vallen ze daarna weg, dan klapt de vector-arm in. Bovendien muteert een HNSW-graaf bij elke INSERT — de upload van 554 chunks op 06-08 om 13:20 heeft de buurlijsten veranderd, ook voor niet-verwante queries.

### Latent risico 5: je kunt achteraf niet zien uit welke arm een fragment kwam

De RPC geeft `fts_rang` en `vec_rang` terug (migratie r. 275), maar `rijNaarChunk` (`core/lib/rag.ts:794-821`) neemt alleen `rang` (de RRF-som) over. In `retrieval_meta` staat dus niet of een chunk lexicaal of vectorieel gevonden is — precies de scheiding die nodig is om risico 3 en 4 uit elkaar te houden bij een volgend incident.

## Waarom dit eerst

`WERKOPDRACHT-RETRIEVAL-RECALL.md` tabel A stelt: *"stel vraag 1, verwacht ≥2 fragmenten uit p. 22-29"*. Die vraag levert een andere zoekvraag op in een verse draad dan in een draad van vijftien beurten, en zelfs tweemaal achter elkaar in dezelfde draad niet dezelfde. Hetzelfde geldt voor tabel A in `WERKOPDRACHT-ANTWOORDLENGTE.md`, waar woordentellingen vóór en ná worden vergeleken.

Zonder reproduceerbare retrieval meten beide opdrachten ruis. Deze opdracht is dus geen los verbeterpunt maar de meetbasis onder de andere twee.

## Ontwerp

### M-R1 — `temperature: 0` op elke modelcall in de retrievalketen

- `core/lib/query-reformulatie.ts:109-119` — `temperature: 0` toevoegen.
- `core/lib/rerank.ts:175-181` — idem, vóórdat M3 uit de recall-opdracht de reranker aanzet.

Inventariseer daarnaast of er nog andere modelcalls in de keten zitten die de bronselectie beïnvloeden en die geen `temperature` zetten (denk aan de context-prefixgeneratie in `chunk-ingest.ts` — die raakt de index, niet de query, maar wel de reproduceerbaarheid van een her-extractie).

Eén regel per plek. Dit is de directe fix voor de waarneming.

### M-R2 — De reformulatie-conditie herzien

Doel: reformuleren wanneer een vraag **werkelijk niet zelfstandig te begrijpen** is, niet wanneer hij kort is of een lidwoord bevat.

Concreet, ter uitwerking in Plan-modus:

1. **Schrap of vervang `woorden.length <= 5`.** Een korte vraag is niet per definitie contextafhankelijk. Als er een lengtesignaal moet blijven, combineer het met een tweede voorwaarde (bijvoorbeeld: kort *én* geen zelfstandig naamwoord dat een onderwerp benoemt).
2. **Haal de determinator-/lidwoordvormen uit `VERWIJSWOORDEN`**, of maak de match positioneel: een demonstratief direct gevolgd door een zelfstandig naamwoord ("dat reglement", "deze regeling", "het bestuur") is een determinator en géén anafoor; alleenstaand ("wat betekent dat", "hoe zit dat") is het wél. `het` als lidwoord hoort er sowieso uit.
3. **Laat `VERVOLG_OPENERS` staan** — die lijst (`:30-33`) is wél een goed signaal en levert weinig valse treffers.

De functie is expliciet puur en deterministisch testbaar opgezet (zie het modulecommentaar r. 9-13). Dat maakt een meetset hier goedkoop; zie acceptatiecriteria.

### M-R3 — Reformulatie mag nooit destructief zijn

Ook een verbeterde heuristiek zal fout zitten. Maak daarom dat een herschrijving alleen recall kan **toevoegen**, nooit wegnemen: draai bij `gereformuleerd = true` de hybride RPC met zowel de originele vraag als de herschreven zoekvraag, en fuseer de twee kandidatensets.

De infrastructuur ligt er al — de RPC doet zelf RRF-fusie over twee armen; dit is dezelfde bewerking een niveau hoger. Kosten: één extra RPC-aanroep bij het deel van de beurten waarin daadwerkelijk geherformuleerd wordt. Dat is te overzien, en het maakt M-R2 minder kritisch: een verkeerd gevuurde reformulatie kost dan wat rekentijd in plaats van het juiste antwoord.

Alternatief dat in Plan-modus gewogen mag worden: alleen de originele vraag gebruiken voor de **FTS-arm** en de herschreven voor de **vector-arm**. Goedkoper, maar minder robuust. Motiveer de keuze.

**Let op de interactie met M1 uit `WERKOPDRACHT-RETRIEVAL-RECALL.md`** (de terugval bij een lege FTS-arm). Beide maatregelen voegen een tweede RPC-aanroep toe onder een conditie. Ontwerp ze samen, zodat één beurt nooit meer dan twee extra aanroepen doet en de meta ondubbelzinnig vastlegt welke poging het resultaat leverde.

### M-R4 — De gebruikte zoekvraag zichtbaar maken

Staat `gereformuleerd = true`, toon dan in het onderbouwingspaneel waarop daadwerkelijk gezocht is. De data zit al in `governance_log_inhoud.retrieval_meta_inhoud->>'zoekvraag'` en in de meta die de client toch al ontvangt (`route.ts:1178-1193`).

Zonder dit blijft elke toekomstige "waarom vond hij dit niet"-vraag onbeantwoordbaar voor de bestuurder zelf, en dat is precies het scenario dat deze hele analyse nodig maakte.

### M-R5 — Hygiëne: tiebreaker en `ef_search`

1. `, dc.id` toevoegen aan de drie `order by`-plekken in `zoek_chunks_hybride` (migratie r. 198, 228-229, 233, 262-263, 285-286). Nulkosten; herstelt de symmetrie met `zoek_chunks`.
2. `hnsw.ef_search` boven `p_kandidaten` zetten (bijvoorbeeld 100 tegen 40), zodat de filters niet op een uitgeputte kandidatenlijst worden losgelaten. Meet de latentie-impact.
3. `fts_rang` en `vec_rang` overnemen in `rijNaarChunk` en in `retrieval_meta` opnemen, zodat bij een volgend incident zichtbaar is uit welke arm een fragment kwam.

M-R5.1 wijzigt de RPC-body maar niet de signatuur; M-R5.2 is een sessie- of databaseparameter. Beide vergen een gate-run, zie impactklasse.

## Scope

**Wel**
- `core/lib/query-reformulatie.ts` — `temperature`, `VERWIJSWOORDEN`, de lengteconditie
- `core/lib/rerank.ts:175-181` — `temperature`
- `core/lib/rag.ts` — dubbele query + fusie (M-R3), `rijNaarChunk` uitbreiden (M-R5.3), meta-velden
- `supabase/migrations/` — nieuwe migratie met tiebreakers in `zoek_chunks_hybride`
- `hnsw.ef_search` — instelling
- `AssistentClient.tsx` / het onderbouwingspaneel — zoekvraag tonen
- Sanity-/meetsets voor `heeftReformulatieNodig`

**Niet**
- De relevantiedrempel, reranker aanzetten, jargonexpansie — dat is `WERKOPDRACHT-RETRIEVAL-RECALL.md`
- Antwoordlengte en detailniveau — dat is `WERKOPDRACHT-ANTWOORDLENGTE.md`
- De bronkeuze-wedervraag — dat is `WERKOPDRACHT-BRONKEUZE-ANTWOORD-EERST.md`
- Het reformulatiemodel vervangen; wel vaststellen welk model bedoeld is (zie Bijvangst)

## Impactklasse

**Architectuur.** De retrievalketen bepaalt welke bronnen onder een bestuurlijk advies liggen.

- **Documentatiehaak: vuurt.** `00 Overzicht en status/release-template.md`, daarna pas de marker in `doc-actualisatie-log.md`.
- **Structurele gates: VEREIST.** M-R5.1 wijzigt de body van `zoek_chunks_hybride`. Draai `supabase/checks/2026_07_31_r1_structurele_gates.sql` schoon tegen de doeldatabase. Behoud `security invoker` en de volledige filterset in beide armen — de T4/T10-poorten (fondsfilter, published-only generiek, review-verval) mogen bij het toevoegen van een tiebreaker niet per ongeluk verschuiven.
- Signatuur van beide RPC's blijft ongewijzigd; alleen de body.

## Guardrails

Naleving van `CLAUDE.md` §Niet-onderhandelbare guardrails bevestigen. Bijzondere aandacht:

1. **Fondsdiscipline blijft hard.** De tweede RPC-aanroep uit M-R3 geeft `p_fonds_id`, `p_modus`, `p_peildatum` en alle Increment G-filters identiek mee. `handhaafFondsdiscipline` draait ook over de gefuseerde set.
2. **Nooit slechter dan nu.** M-R2 en M-R3 mogen bestaande, goed werkende vervolgvragen niet breken — een echte anafoor ("en wat betekent dat voor het bestuur?") moet nog steeds correct worden opgelost. Dat is een acceptatiecriterium, geen aanname.
3. **Geen stille wijziging van het auditspoor.** M-R4 maakt zichtbaar wat er al gelogd werd; er mag geen veld verdwijnen.
4. **Bewijsbaarheid boven elegantie.** Waar een keuze bestaat tussen een compactere implementatie en een die achteraf navolgbaar is in `retrieval_meta`, wint de tweede.

## In te zetten subagents

Zie `SUBAGENTS-ONTWERP.md` §4. Minimaal `supabase-rls-reviewer` (M-R5.1 raakt de RPC), `audit-evidence-reviewer` (M-R4/M-R5.3), `ai-governance-reviewer`, `code-reviewer`, en `ontwerp-sync-reviewer` vóór merge.

## Werkmodus

Begin in **Plan-modus**. Lever eerst:

1. De uitwerking van M-R2 (welke woorden eruit, welke positionele regel, wat er met de lengteconditie gebeurt) — met de meetset uit acceptatiecriterium B erbij.
2. De keuze binnen M-R3 (dubbele RPC met fusie, of gesplitste armen) met motivering en latentieraming.
3. Het samenspel met M1 uit de recall-opdracht.
4. De baseline-meting uit acceptatiecriterium A.

**Wijzig pas na expliciet akkoord.**

## Acceptatiecriteria

### A. Reproduceerbaarheid — het hele punt

- Dezelfde vraag, **tien keer achter elkaar** in dezelfde draadstand, levert **tien keer dezelfde bronnenset** op — zelfde chunk-id's, zelfde volgorde. Toets met `retrieval_meta->'chunks'`.
- Idem voor drie vragen die wél geherformuleerd worden: de herschreven zoekvraag is tien keer identiek.
- Baseline vastleggen vóór de wijziging (dezelfde test op de huidige code), zodat de verbetering aantoonbaar is en niet alleen aannemelijk.

### B. Meetset voor `heeftReformulatieNodig`

Pure functie, dus goedkoop te toetsen. Leg vast in een sanitysuite.

**Mag NIET reformuleren** (zelfstandige vragen):

| Vraag | Vuurt vandaag op |
|---|---|
| Wat zijn onze strategische doelstellingen? | `woorden.length <= 5` |
| Wat staat er in het reglement over pensioneren? | `het` |
| Hoe hoog is de dekkingsgraad? | `woorden.length <= 5` |
| Welke besluiten heeft het bestuur genomen? | `het` |
| Wanneer gaat de Wtp-transitie in? | `de` niet, maar controleer op `woorden.length` |
| Wat is deze regeling waard bij vervroegd pensioen? | `deze` als determinator |

**MOET reformuleren** (contextafhankelijk):

| Vraag |
|---|
| En wat betekent dat voor het bestuur? |
| Kun je dat toelichten? |
| Waarom? |
| En de rest? |
| Hoe zit dat met de ledenraad? |
| Geldt dit ook voor arbeidsongeschikte deelnemers? |

Rapporteer de fractie onterechte reformulaties vóór en ná. Vandaag is die op de eerste tabel 6 van 6.

### C. Techniek

- `temperature: 0` aantoonbaar aanwezig op alle geïnventariseerde modelcalls in de keten.
- Nieuwe sanitytest die aantoont dat M-R3 bij `gereformuleerd = true` beide queries gebruikt en de sets fuseert, en dat de fondsfilters op beide aanroepen identiek zijn.
- `retrieval_meta` bevat na M-R5.3 per chunk `fts_rang` en `vec_rang`.
- Tiebreaker-migratie: bewijs dat `zoek_chunks_hybride` bij tien identieke aanroepen tien identieke resultaatsets geeft, óók onder `set max_parallel_workers_per_gather = 4`.
- Structurele gates schoon.
- `npm run sanity` volledig groen, alle suites doorlopen (les T-01, `BEVINDINGENLOG.md`).

### D. Zichtbaarheid

- Bij `gereformuleerd = true` toont het onderbouwingspaneel de gebruikte zoekvraag.
- Bij `gereformuleerd = false` verandert er niets aan de weergave.

## Definition of Done

Volg `CLAUDE.md` §Definition of Done (gezaghebbend; niet hier kopiëren). Opdracht-specifiek:

- **Decision-record:** nieuw record (`decisions/` staat op `0136`) over reproduceerbare retrieval als eis. Neem de twee log-regels van 06-08-2026 15:29 en 15:34 op als aanleiding, met de twee zoekvragen letterlijk. Verwijs naar de RAG Fase B1-oorsprong van de reformulatie.
- **Ontwerpdocument:** `RAG-VERBETERING-ONTWERP.md` bijwerken met de reformulatie-conditie, het niet-destructieve fusiepad en de determinisme-eis. `PvA-vectorless-en-hybride-retrieval.md` verwijst hiernaar.
- **Documentatiehaak** vuurt (architectuur).
- **Gates** schoon gedraaid, met bewijs.
- **Tests:** tabellen A, B en C in de bestaande suite, niet alleen in deze werkopdracht.

## Openstaande punten

Op te nemen in `00 Overzicht en status/openstaande-punten-en-risicos.md`, **elk mét eigenaar**:

1. **Het patroon achter drie heuristieken.** De bronkeuze-twijfelbak (`vraagtype.ts:911`), de reformulatie-lengteregel en de `VERWIJSWOORDEN`-lijst maken dezelfde fout: vuren op een proxy in plaats van op het probleem. Waard om als ontwerpprincipe vast te leggen voordat de vierde heuristiek geschreven wordt.
2. **Model-drift tussen commentaar en code** — `query-reformulatie.ts:10-11` zegt Haiku, `route.ts:98` zegt `claude-sonnet-4-6`.
3. **Reproduceerbaarheid over een index-mutatie heen.** Zelfs met alle maatregelen wijzigt een HNSW-graaf bij INSERT. Een bronvermelding uit maart is dus niet noodzakelijk reproduceerbaar in augustus. Dat is een inherente eigenschap, geen bug — maar hij hoort expliciet vastgelegd te worden, want het auditspoor suggereert het tegendeel.
4. **`opgehaald` is een constante (30).** Zie M6 in `WERKOPDRACHT-RETRIEVAL-RECALL.md`; hier alleen genoemd omdat de forensische analyse erop stukliep.

## Terugkoppeling

Rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's. Neem de vóór/ná-uitkomst van acceptatiecriterium A (tien identieke runs) en de meetsetfractie uit B expliciet op, plus de latentie-impact van M-R3 en van `ef_search`.
