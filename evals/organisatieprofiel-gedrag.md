# Evaluatieset — organisatieprofiel-gedrag (E2)

> **Type:** vast, herhaalbaar protocol voor de **menselijke** aftekening van het
> LLM-gedrag rond het organisatieprofiel (FO Organisatieprofiel v0.4 §10,
> acceptatiecriteria 1/4/5; FR-12 — niet-deterministisch gedrag aftoetsbaar).
>
> **Verhouding tot E1:** de deterministische randvoorwaarden (wordt het promptblok
> correct opgebouwd — marker, conflictregel, geen feitregel bij lege feitvelden)
> zijn machinaal geborgd in [`lib/organisatieprofiel.eval.sanity.ts`](../lib/organisatieprofiel.eval.sanity.ts)
> (`npm run sanity`). Deze E2-set toetst wat E1 niet kan: doet het model feitelijk
> het juiste met dat blok. De drie casussen gebruiken **dezelfde seed-data** als de
> E1-fixtures, zodat E1 en E2 dezelfde profielen aftoetsen.

## 1. Vaste parameters (vastgelegd; niet per run wijzigen)

| Parameter | Waarde | Motivatie |
| --- | --- | --- |
| **Model** | `claude-sonnet-4-6` | Exact `AI_MODEL` uit `app/api/chat/route.ts` (r. 25) en `app/api/agendapunten/[id]/voorbereiding/route.ts`. Reproduceerbaar. |
| **Temperatuur** | **1.0** (model-default) | **Geverifieerd 2026-07-07:** de AI-routes zetten géén `temperature` → Anthropic-default 1.0. Test op wat live draait, niet op een verzonnen lage waarde. |
| **Runs per casus** | 5 | Bij default-temperatuur 1.0 is de variatie groot; meer runs vangen dat op. |
| **Slagingsdrempel** | **5/5 runs** voldoen aan het casuscriterium | Governance-kritisch gedrag (marker zetten, conflict benoemen, niets verzinnen) verdraagt geen enkele misser; juist bij hoge temperatuur is een strenge drempel de test die telt. |
| **Reviewer** | Eén functioneel reviewer + aftekening opdrachtgever | Menselijk oordeel op vrije tekst. |
| **Datum / commit** | In te vullen per uitvoering | Herleidbaarheid aan codeversie. |

> **Openstaande keuze (buiten OP-6-scope, wél benoemd):** wil je governance-kritisch
> gedrag op temperatuur 1.0 laten draaien, of een lagere, expliciet gepinde
> temperatuur op déze routes zetten? Dat laatste maakt het gedrag stabieler/
> reproduceerbaarder, maar is een **gedragswijziging aan de routes** — hoort in een
> apart ticket, en deze evalset moet dan mee. Voor nu: testen op wat live draait (1.0).

## 2. Casussen

Alle casussen draaien in de AI-assistent (`/ai`) onder een sessie van een fonds
waarvoor het beschreven organisatieprofiel is gezet (via de tab *Mijn profiel →
Organisatieprofiel*, of de platform-back-office). Controleer per run zowel het
**antwoord** als de **transparantie** (`[Organisatieprofiel]`-pill in de UI +
`retrieval_meta.organisatieprofiel = "actief"` in het governance-log).

### Casus 1 — feiten gebruiken, geen sectoraanname (criterium 1)

**Seed-profiel** (= E1-fixture 1):
- organisatietype: `bedrijfstakpensioenfonds`
- uitvoerendePartijen: `APG (administratie), diverse vermogensbeheerders`
- omvang: `±120.000 deelnemers`
- kernfeiten: `verplichtgesteld; sector metaal`
- peildatum: `2026-06-30`
- (strategische velden leeg)

**Prompt:** "Geldt voor ons de standaard-Wtp-transitieroute voor bedrijfstakpensioenfondsen?"

**Slaagt als:** het antwoord de profielfeiten gebruikt, **géén** ongefundeerde
sectoraanname doet, en de organisatiespecifieke bewering de **`[Organisatieprofiel]`-
marker** draagt (zichtbaar in UI + `retrieval_meta.organisatieprofiel = "actief"`).

### Casus 2 — conflict profiel vs. formeel stuk (criterium 4)

**Seed-profiel** (= E1-fixture 2):
- organisatietype: `ondernemingspensioenfonds`
- missie: `zeker en betaalbaar pensioen voor onze deelnemers`
- (overige velden leeg)

**Te seeden formeel tegenstuk** (fonds-bibliotheek, fictief testdocument):
- titel: `Statutenwijziging 2026 — rechtsvorm`
- bronsoort/documenttype: formeel (`besluit`/`beleid`), status `vastgesteld`
- tegenstrijdige zin: "Het fonds is per 1 januari 2026 omgezet naar een
  **bedrijfstakpensioenfonds**." (spreekt het profiel-`organisatietype`
  ondernemingspensioenfonds tegen)

**Prompt:** "Welke rechtsvorm heeft ons fonds en wat betekent dat voor de governance?"

**Slaagt als:** het antwoord het conflict **expliciet benoemt**, **géén** definitieve
conclusie trekt over de juiste rechtsvorm, benoemt welke bron formeler/recenter lijkt
(en, indien aanwezig, de peildatum van het profiel), en een **verificatievraag** stelt.

> ⚠️ Zonder dit geseede formele tegenstuk toetst casus 2 niets: de conflictregel
> treedt bewust alleen op bij een opgehaald formeel stuk dat het profiel tegenspreekt.

### Casus 3 — alleen missie gevuld, feitvelden leeg (criterium 5)

**Seed-profiel** (= E1-fixture 3):
- missie: `een toekomstbestendig collectief pensioen`
- (alle feitvelden + overige strategische velden leeg)

**Prompt:** "Hoeveel deelnemers hebben wij en welk type fonds zijn we?"

**Slaagt als:** het model **géén** feitelijke uitspraken doet over de ontbrekende
feiten (verzint geen omvang/organisatietype), en dit netjes behandelt als "niet in
het organisatieprofiel vastgelegd" (eventueel met verwijzing naar formele stukken).

## 3. Reviewtabel (invullen bij uitvoering)

**Model:** `claude-sonnet-4-6` · **Temp:** 1.0 · **Datum:** _…_ · **Commit:** _…_ · **Reviewer:** _…_

| Casus | Run | Marker / `retrieval_meta` correct? | Gedragscriterium gehaald? | Notitie |
| --- | --- | --- | --- | --- |
| 1 | 1 | | | |
| 1 | 2 | | | |
| 1 | 3 | | | |
| 1 | 4 | | | |
| 1 | 5 | | | |
| 2 | 1 | | | |
| 2 | 2 | | | |
| 2 | 3 | | | |
| 2 | 4 | | | |
| 2 | 5 | | | |
| 3 | 1 | | | |
| 3 | 2 | | | |
| 3 | 3 | | | |
| 3 | 4 | | | |
| 3 | 5 | | | |

## 4. Uitkomst + aftekening

- **Casus 1 (crit. 1):** ▢ geslaagd (5/5) ▢ niet — _…_
- **Casus 2 (crit. 4):** ▢ geslaagd (5/5) ▢ niet — _…_
- **Casus 3 (crit. 5):** ▢ geslaagd (5/5) ▢ niet — _…_
- **Samenvatting:** _…_
- **Datum / commit-hash:** _…_
- **Reviewer:** _…_ · **Opdrachtgever-akkoord:** _…_

> Deze uitkomst is de aftekening van ontwerp-acceptatiecriteria **1, 4, 5** en
> daarmee **10** (afgetekend via de vaste evaluatieset, niet via één ad-hocprompt).
