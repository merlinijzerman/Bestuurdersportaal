# S1 — G1 go/no-go-advies: extractie + conceptbinding

**Datum:** 2026-08-12 · **Spike:** S1 (extractie + binding op gesloten conceptset) ·
**Testdata:** fictief invaardossier NovaWerk (7 PDF's, `01`–`07`) ·
**Model:** Claude Haiku (geforceerde tool-use, temperature 0) ·
**Extractie:** productie-tekstlaag (`core/lib/document-extractie.ts`) ·
**Granulariteit meting:** document × concept (canonieke waarde + distractors).

---

## 1. Advies in één alinea

**G1 = GROEN — door naar T7/T8, met een afgebakende start-catalogus.** Er is een
aantoonbaar betrouwbare subset. De schone numerieke/datum-concepten
`solidariteitsreserve.bovengrens` en `franchise` halen op **alle** documenten
100% bindings-precision, 100% recall en 100% bron-accuraatheid — inclusief álle
ingebouwde distractors (signaleringsgrens 5,7%, streefzone-ondergrens 2,0%,
foutieve testdata 0,6% / € 17.455, afgeleide geldwaarde € 501 mln, vervallen
v0.7-waarden). Deze twee gaan de start-catalogus in. `invaarmethodiek` is op
gezaghebbende documenten (definitief/vastgesteld) eveneens 100%, maar wordt op
een werkdocument en een vervallen concept semantisch misleid; die neem je
**conditioneel** mee (gezag-gewogen, met menselijke review). `transitiedatum` is
de zwakke schakel (datum-overbinding, óók in een definitief stuk) en gaat pas mee
ná datum-disambiguatie.

---

## 2. Wat S1 toetste (en wat niet)

S1 toetst empirisch de moeilijkste stap onder documentvergelijking: een waarde
extraheren **én aan het juiste concept binden**. "6,0%" vinden is triviaal; wéten
dat die 6,0% de solidariteitsreserve-*bovengrens* is en niet de
signaleringsgrens, de ondergrens of een premie — dát is de bottleneck, en dat is
gemeten. De normalisatie (bv. "6,0%" → 0,06, "€ 17.545" → 17545) doen wij
deterministisch; het model levert alleen de ruwe waarde + een verbatim bronzin.

**Buiten scope (bewust):** versie-/conflictresolutie, gezag-ranking als
beslislogica, de vergelijking zelf, DB/RLS/UI. Dat is T7/T8. S1 meet alleen
extractie + binding.

---

## 3. Resultaten

**G1-drempels (precision-first):** bindings-precision ≥ 90%, bron-accuraatheid ≥
90%. Op documentniveau valt waarde-accuraatheid (≥ 95%) samen met
bindings-precision (er is één juiste waarde per cel). Recall gerapporteerd, geen
harde drempel. `C/M/S` = CORRECT / MISBOUND / SPURIOUS.

### 3a. Alle 7 documenten

| concept | type | recall | **bind-precision** | misbinding | bron | C/M/S | G1 |
|---|---|--:|--:|--:|--:|:--:|:--:|
| solidariteitsreserve.bovengrens | percentage | 100% | **100%** | 0% | 100% | 13/0/0 | 🟢 |
| franchise | amount | 100% | **100%** | 0% | 100% | 13/0/0 | 🟢 |
| transitiedatum | date | 100% | **88%** | 0% | 94% | 15/0/2 | 🔴 |
| invaarmethodiek | policy_choice | 100% | **88%** | 12% | 100% | 15/2/0 | 🔴 |
| **overall** | | **100%** | **93%** | **3%** | **98%** | 56/2/2 | |

### 3b. Alleen gezaghebbende documenten (definitief/vastgesteld: docs 01–05)

| concept | **bind-precision** | recall | C/M/S |
|---|--:|--:|:--:|
| solidariteitsreserve.bovengrens | **100%** | 100% | 11/0/0 |
| transitiedatum | **92%** | 100% | 11/0/1 |
| franchise | **100%** | 100% | 11/0/0 |
| invaarmethodiek | **100%** | 100% | 10/0/0 |

**Kern:** álle foutbindingen en bijna alle spurious zitten in het **werkdocument
(06)** en het **vervallen concept (07)** — precies het laag-gezag-materiaal dat
een echte vergelijking sowieso zou downweighten. Op gezaghebbende bronnen is 3
van de 4 concepten foutloos.

---

## 4. Per-concept oordeel

| concept | oordeel | onderbouwing |
|---|---|---|
| `solidariteitsreserve.bovengrens` | **GROEN → start-catalogus** | 100% op alles. Weerstond 5,7% (signalering), 2,0% (ondergrens), 0,6% (foutieve testdata), € 501 mln (afgeleide), 7,0% (v0.7). |
| `franchise` | **GROEN → start-catalogus** | 100% op alles. Weerstond € 17.455 en € 17.250 (distractors); normaliseerde € 17.545 / "17 545 euro" / kaal 17545 correct. |
| `invaarmethodiek` | **CONDITIONEEL GROEN** | 100% op gezaghebbende docs. Faalt alleen op (a) werkdocument 06 dat "INDIVIDUEEL" in een negatie/foutconfiguratie noemt, en (b) vervallen 07 dat zichzelf tegenspreekt. Opnemen mét gezag-weging + menselijke review op werkdocumenten/concepten. |
| `transitiedatum` | **ROOD → uitstellen** | Bindt de verkeerde datum ("1 augustus 2026" in definitief doc 04; "20 juli 2026" in doc 06). Meerdere datums per document → overbinding; treft óók een gezaghebbend stuk. Eerst datum-disambiguatie. |

---

## 5. Faalpatronen → richting voor T7/T8

1. **Datum-disambiguatie is de grootste openstaande post.** Documenten bevatten
   meerdere datums (opsteldatum, ingangsdatum, transitiedatum). De extractie
   bindt soms een niet-transitiedatum. T7/T8 heeft een expliciete
   rol/kwalificatie per datum nodig (welke datum ís de transitiedatum), niet
   alleen "een datum".
2. **Semantische polariteit bij beleidskeuzes.** "de individuele methode wordt
   **niet** toegepast" en "waarde INDIVIDUEEL … als **kritieke fout**" mogen niet
   tot binding van `individueel` leiden. Trefwoord-matching is hier te naïef; T7/T8
   moet negatie/verbod herkennen (of dit expliciet aan het model overlaten met een
   scherpere instructie + verificatie).
3. **In-document conflicten bestaan echt.** Doc 07 noemt zowel de individuele
   methode (concept v0.7) als "gewijzigd naar de standaardmethode". S1 kan zoiets
   op documentniveau niet in één canonieke waarde vangen — het is precies het
   werk van T7/T8 (versie/opvolging). De extractie deed het goede: ze bracht
   beide waarden naar boven.
4. **Bron-verankering werkt.** Bron-accuraatheid 98%: bijna elke geëxtraheerde
   waarde is terug te voeren op een verbatim bronzin. Dit is een goedkoop,
   automatisch anti-hallucinatie-signaal om in productie te behouden.
5. **Ontdubbeling nodig.** Dezelfde waarde wordt soms meermaals geëxtraheerd
   (doc 06: 4× "standaard" uit verschillende formuleringen). Onschadelijk voor
   correctheid, maar T7/T8 moet per (document, concept) ontdubbelen.

---

## 6. Gevraagde besluiten / vervolg

- **Bevestig de start-catalogus** voor T7/T8: `solidariteitsreserve.bovengrens` +
  `franchise` (onvoorwaardelijk), `invaarmethodiek` (conditioneel, gezag-gewogen
  + review).
- **Prioriteer datum-disambiguatie** vóór `transitiedatum` de catalogus haalt.
- **Neem gezag/status als eerste-klas signaal mee** in T7/T8 (de betrouwbaarheid
  correleert sterk met documentstatus: gezaghebbend ≫ werkdocument/vervallen).

---

## 7. Verantwoording en beperkingen

- **Één dossier, fictief.** Resultaten zijn indicatief, niet statistisch hard: 7
  documenten van één fictief fonds (NovaWerk), bewust met distractors geladen. Dit
  is een go/no-go-spike, geen validatiestudie. Herhaal op ≥1 echt dossier vóór
  productiebeloftes.
- **Document-niveau meting.** De oracle is per (document, concept); binding is dus
  op dat niveau gemeten, niet per exact tekstvoorkomen. Dat sluit aan op de data
  en meet de gevaarlijke fout (distractor-binding) direct.
- **Doc 07-canonical gelijkgetrokken met de documenttekst.** In lijn met "S1 =
  extractie/binding, niet versieresolutie" is 07's invaarmethodiek-canonical op
  `standaard` gezet (wat het document zelf zegt). Omdat doc 07 beide waarden noemt,
  blijft één van de twee 07-extracties per definitie "misbound" bij één canonieke
  waarde — dat is een conflict-signaal, geen bindingsfout.
- **Normalisatie is onderdeel van het resultaat.** Tussen meting 1 en 3 zijn de
  normalisatieregels verbeterd (spatie-duizendtallen "17 545", uitgeschreven
  "zes procent", kale fracties "0,06", tolerantere valuta-match). Dit zijn
  generieke regels, geen dossier-specifieke aanpassingen; ze tilden de overall
  bindings-precision van 88% naar 93%.
- **Duurzaam resultaat:** de gelabelde golden set (`golden_set.json`) blijft in
  versiebeheer en voedt later de golden dataset (T11). De spike-code is wegwerp.
