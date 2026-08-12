# S1 Spike — extractie + conceptbinding (wegwerp)

Empirische toets: kunnen we uit echte fondsdocumenten een **waarde extraheren én
aan het júiste concept binden**, betrouwbaar genoeg om er de documentvergelijking
(T7/T8) op te bouwen? De **binding** is het moeilijke deel — "6,0%" vinden is
triviaal; wéten dat die 6,0% de *solidariteitsreserve-bovengrens* is en niet de
ondergrens of een premie, is de bottleneck. S1 meet precies dat.

> **Wegwerpcode.** Geen productiecode, DB, RLS, UI of ingestion-pijplijn. Het
> duurzame resultaat is de **golden set** (§Golden set) + het **meetrapport** +
> een **go/no-go-advies** voor poort G1.

## Wat er hergebruikt wordt

- **Tekst-extractie = identiek aan productie:** `core/lib/document-extractie.ts`
  (`extractTekst`). PDF via unpdf/pdfjs per pagina (levert paginanummers "gratis"),
  DOCX via mammoth, PPTX via JSZip, XLSX via SheetJS. Zo test je op dezelfde tekst
  die productie ziet — anders is het resultaat niet overdraagbaar.
- **Model:** alleen Haiku (`HAIKU_MODEL` uit `core/lib/llm-modellen.ts`), via
  geforceerde tool-use (JSON-schema), `temperature: 0`. Geen Sonnet/Opus.

## Vereisten vóór je kunt meten

1. **Documenten** — leg 5–10 echte dossierstukken in `data/` (gitignored):
   transitieplan (bij voorkeur een v3/v4-paar), implementatieplan,
   pensioenreglement, financiële/actuariële analyse, evenwichtigheidsanalyse.
   Ondersteund: `.pdf`, `.docx`, `.pptx`, `.xlsx`.
2. **Golden set** — laat een domeinpersoon (actuaris/bestuursbureau, ~1–2 u)
   `golden_set.json` vullen (§Golden set). Zonder ground truth kun je niets meten.
3. **API-sleutel** — `ANTHROPIC_API_KEY`. De scripts lezen automatisch
   `mvp/.env.local`. Gebruik het bestaande platform-account onder de Anthropic-
   DPA/EU-residency-afspraken, geen privésleutel.

## Draaien (vanuit `mvp/`)

```bash
# 1. extractie: data/ → Haiku → output/units.json
./node_modules/.bin/tsx scripts/spike-s1/extract.ts

# 2. (optioneel) golden set controleren op schema-fouten
./node_modules/.bin/tsx scripts/spike-s1/valideer-golden.ts

# 3. meten + rapport: output/units.json + golden_set.json → output/meetrapport.md
./node_modules/.bin/tsx scripts/spike-s1/report.ts

# (measure.ts kan ook los draaien voor een console-samenvatting)
./node_modules/.bin/tsx scripts/spike-s1/measure.ts
```

## De concepten (gesloten start-set)

Gedefinieerd in `concepts.ts`, mét de deterministische normalisatieregels:

| concept | type | normalisatie | verwachte moeilijkheid |
|---|---|---|---|
| `solidariteitsreserve.bovengrens` | percentage | "6,0%" → `0.06` | laag |
| `transitiedatum` | date | → ISO `2028-01-01` | laag |
| `franchise` | amount | "€ 17.545" → `17545` (+ EUR) | midden |
| `invaarmethodiek` | policy_choice | enum `standaard`\|`individueel` | hoog |

De normalisatie doen wij (niet het model): het model levert alleen `value_raw` +
verbatim `evidence`; de genormaliseerde waarde is objectief toetsbaar.

## Golden set

`golden_set.json` = een JSON-array, **één record per waar voorkomen**. Zie
`golden_set.EXAMPLE.json` voor ingevulde voorbeelden. Schema per record:

| veld | verplicht | inhoud |
|---|---|---|
| `document` | ja | bestandsnaam exact zoals in `data/` |
| `concept` | ja | een van de vier canonieke sleutels hierboven |
| `type` | ja | `percentage` \| `date` \| `amount` \| `policy_choice` |
| `value_normalized` | ja | number (percentage/amount) of string (date=ISO, policy=enum) |
| `currency` | bij amount | bv. `"EUR"` |
| `page` | ja | paginanummer (of `null` als het documenttype geen pagina's kent) |
| `section` | nee | kop/sectie |
| `evidence` | ja | de letterlijke bronzin |

Draai `valideer-golden.ts` om tikfouten te vangen. `golden_set.json` staat wél in
versiebeheer (het is het duurzame resultaat en voedt later T11); `data/` en
`output/` niet.

## Meting

Match op `concept` + `document`, dan co-locatie (pagina ±1 én evidence-overlap
via Jaccard ≥ 0,5). Per concept **en** per type:

- **Extractie-recall** — welk deel van de echte voorkomens is gevonden?
- **Bindings-precision** — van wat als concept X geëxtraheerd is: welk deel is
  écht X? *(kernmetriek)*
- **Foutbindingspercentage** — waarde aan het verkeerde concept gebonden
  *(de gevaarlijke fout; automatisch gedetecteerd als de waarde co-loceert met een
  golden unit van een ánder concept)*.
- **Waarde-accuraatheid** — voor correct gebonden units: klopt de genormaliseerde
  waarde?
- **Bron-accuraatheid** — komt de `evidence` letterlijk voor in de paginatekst?
  (whitespace-ongevoelig; volledig automatisch)

## G1 — go/no-go (poort)

Precision-first. Een concepttype is **groen** bij: bindings-precision ≥ **90%**,
waarde-accuraatheid ≥ **95%**, bron-accuraatheid ≥ **90%**. Recall wordt
gerapporteerd zonder harde drempel.

- **G1 groen** (door naar T7/T8): er is een levensvatbare betrouwbare subset —
  minimaal de schone numerieke + datum-concepten halen de drempels.
- **G1 rood**: zelfs schone numerieke concepten halen de bindings-precision niet →
  eerst extractie/binding oplossen vóór T7/T8.

Het rapport geeft dit oordeel per concept + een overall advies, plus de
**faalpatronen** (met de echte tekst) als input voor het ontwerp van T7/T8.

## Bestanden

```
concepts.ts          gesloten conceptlijst + normalisatieregels
types.ts             gedeelde typen (Unit, GoldenUnit)
tekst.ts             verbatim-check + Jaccard-overlap
extract.ts           data/ → extractTekst → Haiku (schema, temp 0) → output/units.json
measure.ts           units ↔ golden → metrieken (importeerbaar + CLI)
report.ts            → output/meetrapport.md + faalpatronen
valideer-golden.ts   schema-check op golden_set.json
golden_set.json      ground truth (in VC) — nu leeg; vullen door domeinpersoon
golden_set.EXAMPLE.json  ingevuld voorbeeld
data/                gitignored: ruwe testdocumenten
output/              gitignored: units.json + meetrapport.md
```
