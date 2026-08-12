# S1 Spike — extractie + conceptbinding (wegwerp)

Empirische toets: kunnen we uit fondsdocumenten een **waarde extraheren én aan
het júiste concept binden**, betrouwbaar genoeg om er de documentvergelijking
(T7/T8) op te bouwen? De **binding** is het moeilijke deel — "6,0%" vinden is
triviaal; wéten dat die 6,0% de *solidariteitsreserve-bovengrens* is en niet de
signaleringsgrens (5,7%), de streefzone-ondergrens (2,0%) of foutieve testdata
(0,6%), is de bottleneck. S1 meet precies dat.

> **Wegwerpcode.** Geen productiecode, DB, RLS, UI of ingestion-pijplijn. Het
> duurzame resultaat is de **golden set** + het **meetrapport** + een
> **go/no-go-advies** voor poort G1.

## Testdata: fictief invaardossier NovaWerk

Deze spike draait op het fictieve dossier `Fictief_invaardossier_NovaWerk_VOLLEDIG`
(7 PDF's, `01`–`07`). Het is bewust gebouwd om extractie, normalisatie en
inconsistentiedetectie te testen: elke PDF bevat de canonieke waarde **plus
distractors** (signaleringsgrens, streefzone-ondergrens, foutieve testdata,
afgeleide geldwaarden, code-tokens). `07` is een **vervallen concept** met
conflicterende waarden. De map bevat zelf een oracle (`00_ground_truth_*.json`)
die als bron voor de golden set is gebruikt.

> Fictieve data → veilig naar de Claude API. De PDF's staan in `data/`
> (gitignored); ze horen niet in de kennisbasis/RAG.

## Wat er hergebruikt wordt

- **Tekst-extractie = identiek aan productie:** `core/lib/document-extractie.ts`
  (`extractTekst`). PDF via unpdf/pdfjs per pagina (paginanummers "gratis"), DOCX
  via mammoth, PPTX via JSZip, XLSX via SheetJS. Zo test je op dezelfde tekst die
  productie ziet — anders is het resultaat niet overdraagbaar.
- **Model:** alleen Haiku (`HAIKU_MODEL` uit `core/lib/llm-modellen.ts`), via
  geforceerde tool-use (JSON-schema), `temperature: 0`. Geen Sonnet/Opus.
- **API-sleutel:** `ANTHROPIC_API_KEY`. De scripts lezen automatisch
  `mvp/.env.local` (platform-account onder de Anthropic-DPA/EU-residency).

## Draaien (vanuit `mvp/`)

```bash
# 0. documenten klaarzetten (fictief → veilig)
cp "../Archief/Fictief_invaardossier_NovaWerk_VOLLEDIG/"0[1-7]_*.pdf scripts/spike-s1/data/

# 1. extractie: data/ → Haiku → output/units.json  (7 docs × 2 pag × 4 concepten)
./node_modules/.bin/tsx scripts/spike-s1/extract.ts

# 2. (optioneel) golden set controleren op schema-fouten
./node_modules/.bin/tsx scripts/spike-s1/valideer-golden.ts

# 3. meten + rapport → output/meetrapport.md
./node_modules/.bin/tsx scripts/spike-s1/report.ts

# measure.ts kan ook los voor een console-samenvatting:
./node_modules/.bin/tsx scripts/spike-s1/measure.ts

# Na een normalisatie-wijziging (concepts.ts): hernormaliseer de BESTAANDE ruwe
# extracties zonder nieuwe API-calls (schone ablatie), dan opnieuw meten:
./node_modules/.bin/tsx scripts/spike-s1/renormaliseer.ts
./node_modules/.bin/tsx scripts/spike-s1/report.ts
```

## De concepten (gesloten start-set)

Gedefinieerd in `concepts.ts`, mét deterministische normalisatieregels. De
normalisatie doen wíj (niet het model): het model levert alleen `value_raw` +
verbatim `evidence`; de genormaliseerde waarde is objectief toetsbaar.

| concept | type | normalisatie (o.a.) | verwachte moeilijkheid |
|---|---|---|---|
| `solidariteitsreserve.bovengrens` | percentage | "6,0%"/"6%"/"0,06"/"zes procent" → `0.06` | laag |
| `transitiedatum` | date | "1 januari 2028"/"01-01-2028" → ISO `2028-01-01` | laag |
| `franchise` | amount | "€ 17.545"/"17 545 euro"/"501 miljoen" → number (+ EUR) | midden |
| `invaarmethodiek` | policy_choice | enum `standaard`\|`individueel` (via trefwoorden) | hoog |

## Golden set (document × concept)

De NovaWerk-oracle is **document-niveau**, dus `golden_set.json` bevat **één
record per (document, concept)**: de canonieke waarde die dat document noemt +
de distractor-waarden die aanwezig zijn maar NIET aan dit concept horen. Schema:

| veld | verplicht | inhoud |
|---|---|---|
| `document` | ja | bestandsnaam exact zoals in `data/` |
| `concept` | ja | een van de vier canonieke sleutels |
| `type` | ja | `percentage` \| `date` \| `amount` \| `policy_choice` |
| `canonical` | ja | genormaliseerde verwachte waarde in dit document |
| `currency` | bij amount | bv. `"EUR"` |
| `distractors` | ja | genormaliseerde waarden die NIET gebonden mogen worden |
| `status` | nee | `definitief` \| `vastgesteld` \| `werkdocument` \| `vervallen concept` |
| `authority_rank` | nee | gezag-rang uit de oracle (informatief) |

Draai `valideer-golden.ts` om tikfouten te vangen. `golden_set.json` staat wél in
versiebeheer (duurzaam resultaat, voedt later T11); `data/` en `output/` niet.

## Meting

Per geëxtraheerde unit wordt, op basis van de golden-cel `(document, concept)`,
één status bepaald:

- **CORRECT** — waarde == `canonical`.
- **MISBOUND** — waarde == een `distractor` *(de gevaarlijke fout)*.
- **SPURIOUS** — iets anders (norm-fout, afgeleide grootheid, hallucinatie).

Per concept **en** per type:

- **Extractie-recall** — fractie (document, concept)-cellen met ≥1 CORRECTe unit.
- **Bindings-precision** — `correct / geëxtraheerd` *(kernmetriek)*. Op
  documentniveau valt **waarde-accuraatheid** hiermee samen (één juiste waarde
  per cel).
- **Foutbindingspercentage** — `misbound / geëxtraheerd` *(de gevaarlijke fout)*.
- **Bron-accuraatheid** — komt de `evidence` letterlijk voor in de paginatekst?
  (whitespace-ongevoelig, volledig automatisch)

## G1 — go/no-go (poort)

Precision-first. Een concept is **groen** bij: bindings-precision ≥ **90%** en
bron-accuraatheid ≥ **90%** (waarde-accuraatheid ≥ 95% valt op documentniveau
samen met binding-precision). Recall wordt gerapporteerd zonder harde drempel.

- **G1 groen** (door naar T7/T8): er is een levensvatbare betrouwbare subset —
  minimaal de schone numerieke + datum-concepten halen de drempels.
- **G1 rood**: zelfs schone numerieke concepten halen de bindings-precision niet →
  eerst extractie/normalisatie/disambiguatie oplossen vóór T7/T8.

Het rapport geeft dit oordeel per concept + overall advies, plus de
**faalpatronen** (met de echte tekst) als input voor het ontwerp van T7/T8.

## Bestanden

```
concepts.ts          gesloten conceptlijst + normalisatieregels
types.ts             gedeelde typen (Unit, GoldenUnit)
tekst.ts             verbatim-check + Jaccard-overlap
extract.ts           data/ → extractTekst → Haiku (schema, temp 0) → output/units.json
renormaliseer.ts     herbereken normalisatie op bestaande units.json (geen API)
measure.ts           units ↔ golden → metrieken (importeerbaar + CLI)
report.ts            → output/meetrapport.md + faalpatronen
valideer-golden.ts   schema-check op golden_set.json
golden_set.json      ground truth op document×concept-niveau (in VC)
golden_set.EXAMPLE.json  ingevuld voorbeeld (nieuw schema)
data/                gitignored: ruwe testdocumenten
output/              gitignored: units.json + meetrapport.md
```
