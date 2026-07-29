# Werkopdracht: contextbesef in de AI-assistent

> Plansessie Cowork, 28-07-2026. Plak deze werkopdracht als eerste bericht in een
> Claude Code-sessie in de repo-root. Zie `decisions/0004` en `WERKOPDRACHT-TEMPLATE.md`.

---

**Doel & context** — het startpunt toont sinds besluit 0085 wat er voor de bestuurder
speelt: de komende vergadering, de eerstvolgende processtap, agendapunten zonder eigen
inbreng. Het chatvenster weet daar niets van. Een vraag als *"Wat is mijn volgende actie
om op te pakken?"* levert daardoor geen antwoord maar een verduidelijkingsvraag, terwijl
het antwoord letterlijk twintig pixels hoger op het scherm staat. Deze opdracht sluit dat
gat: de assistent gaat begrijpen dat een persoonlijke vraag over dit fonds gaat, en krijgt
de portaalstand mee wanneer die ertoe doet.

**Aanleiding** — waargenomen op de release van 28-07-2026: vraag *"Wat is mijn volgende
actie om op te pakken?"* → antwoord *"Wilt u dit weten voor uw fonds specifiek, of in
algemene zin?"* met twee chips.

**Verhouding tot andere opdrachten** — dit staat los van
`WERKOPDRACHT-AI-TAKEN-P2.md` (UI-werk aan startpunt en vervolgweergave). Deze opdracht
raakt classificatie en promptopbouw, heeft een eigen meetinstrument en een eigen reviewer.
Ze kunnen parallel, maar niet in dezelfde sessie.

---

## Vertrekpunt — geverifieerd tegen de code op 28-07-2026

**Oorzaak 1 — persoonlijke vragen matchen geen enkel fondssignaal.**

`core/lib/vraagtype.ts`:

```js
const FONDS_INTENT_PATRONEN: RegExp[] = [
  /\bonze\b/, /\bons\b/, /\bwij\b/,
  /\bhet bestuur\b/, /\bdit fonds\b/,
  /\beigen (?:beleid|fonds|stukken|regeling)/,
];
```

Uitsluitend **collectieve** vormen. `mijn`, `mij`, `moet ik` ontbreken. `bepaalBronIntent`
valt daardoor terug op `{ intent: "fonds", vertrouwen: "onzeker" }`, en
`moetVerduidelijken()` stuurt de chips uit `VERDUIDELIJKINGSVRAAG`.

**De verduidelijkingstak zelf is geen fout en moet blijven.** Hij is de
schijnzekerheid-guardrail: liever terugvragen dan gokken, en de onzekere fallback is
bewust "fonds" en niet "algemeen". Alleen de signaallijst is te smal.

**Oorzaak 2 — de portaalstand gaat alleen mee in agendapunt-modus.**

`app/api/chat/route.ts`:

```js
let modulesBlok = "";
if (agendapuntModusActief && profiel?.fonds_id) {
  // actieve risico's (limit 15) + lopende procedures (limit 10)
```

De comment erbij: *"Alleen in agendapunt-modus, om kosten en ruis in de overige modi te
vermijden."* Een verdedigbare keuze die nu knelt. In een gewoon gesprek weet het model
niets van lopende procedures.

**Oorzaak 3 — de opgehaalde stand is fondsbreed, niet persoonlijk.**

Ook mét dat blok haalt de route `procedures` fondsbreed op (`neq status afgerond`,
limit 10). Het startpunt berekent daarentegen `eersteStap` — de eerstvolgende stap **van
deze gebruiker**. Voor *"wat is míjn volgende actie"* is dat het verschil tussen een
bruikbaar en een algemeen antwoord.

**Beschikbaar gereedschap** — `core/lib/bronkeuze-meetset.ts` en
`core/lib/bronkeuze-classificatie.sanity.ts` ijken de classificatie al; `vraagtype.sanity.ts`
bevat de unit-assertions. De route leest al uit `profielen`, `procedures`, `agendapunten`,
`risicos`, `documenten`, `document_chunks` en `governance_log` — er hoeft geen nieuwe
tabel bij.

---

## Scope

### Stap 1 — persoonlijke signalen herkennen

Voeg een **aparte patroonklasse** toe (niet: de bestaande lijst oprekken), zodat in de
code afleesbaar blijft dat het om een andere soort signaal gaat:

```js
const PERSOONLIJK_INTENT_PATRONEN: RegExp[] = [
  /\bmijn\b/, /\bvoor mij\b/, /\bvan mij\b/,
  /\bmoet ik\b/, /\bik moet\b/,
];
```

Behandel een treffer als **fonds, vertrouwen "zeker"** — persoonlijke staat bestaat
alleen binnen dit fonds. Combinatie met een generiek signaal blijft "gecombineerd"; die
logica werkt al.

**Neem `\bik\b` niet op.** Te ruim: *"Ik wil begrijpen wat een dekkingsgraad is"* is een
algemene vraag. Alleen `ik` in combinatie met een werkwoord van verplichting.

**Verplicht:** breid `bronkeuze-meetset.ts` uit met persoonlijke vragen, inclusief
tegenvoorbeelden die **wel** algemeen moeten blijven. Zonder nieuwe meetsetregels is deze
wijziging niet aantoonbaar goed.

### Stap 2 — portaalstand meesturen, conditioneel

Maak `modulesBlok` beschikbaar buiten agendapunt-modus, maar **niet altijd**. Voorwaarde:
de vraag is persoonlijk (stap 1) of statusgericht (*"wat staat er open"*, *"hoe ver zijn
we"*, *"wat is de status"*). Bij een zuiver algemene vraag gaat er niets extra's mee, en
blijft de oorspronkelijke afweging over kosten en ruis intact.

Bepaal die conditie in `core/lib/vraagtype.ts` (naast de bestaande heuristieken), niet
inline in de route — dan is hij testbaar en herbruikbaar.

### Stap 3 — de persoonlijke stand

Voeg aan de meegestuurde context toe wat het startpunt al berekent, maar dan server-side:

- de eerstvolgende processtap **van deze gebruiker**, met deadline indien aanwezig
- agendapunten van de komende vergadering **zonder eigen inbreng**
- de komende vergadering met datum

Compact, als benoemde tekst — geen genummerde bronnen, gelijk aan hoe `modulesBlok` het
nu doet. Query's lopen via de **anon-key onder RLS op de sessie**; de persoonlijke stand
mag nooit via een fondsbrede query worden benaderd.

### Stap 4 — herkenbaarheid en toon

**4a. De stand is zichtbaar als stand, niet als bron.** Als het antwoord op de portaalstand
steunt, moet de gebruiker dat kunnen zien. Voeg in `OnderbouwingPaneel` een aparte
aanduiding toe ("portaalstand" of vergelijkbaar) — géén genummerde bron, wel expliciet
benoemd. Dit is de transparantielijn uit besluit 0071: het antwoord staat naast waar het
op steunt.

**4b. Signaleren, niet adviseren.** *"Wat is mijn volgende actie"* grenst aan advies.
`CLAUDE.md`: de assistent signaleert, vat samen en spiegelt — besluit nooit. De instructie
bij het standblok moet dus sturen op *"hier staat nog open…"* en niet op *"u moet nu X
doen"*.

> **Let op — beperkte promptwijziging.** `CLAUDE.md`: *"De AI-toon-systeemprompt in
> `app/api/chat/route.ts` is kostbaar, fijn afgesteld werk — wijzig met beleid en alleen
> op verzoek."* Dit ticket is dat verzoek, maar **uitsluitend** voor: (a) het toevoegen
> van het standblok en (b) één instructie over signaleren versus adviseren. Herformuleer
> niets anders in die prompt. Leg de exacte toevoeging in Plan-modus voor.

### Niet in scope

- De verduidelijkingstak verwijderen of versoepelen. Die blijft; alleen de signaallijst
  wordt breder.
- Nieuwe tabellen, kolommen of migraties. Alle benodigde gegevens bestaan al.
- Wijziging aan de retrieval-modus of aan `bepaalAutoBronModus`.
- Rol- of expertisegestuurde antwoorden (`bestuurlijke_rol`, `primaire_expertise_id`).
- Een LLM inzetten voor de intentieclassificatie. De heuristiek blijft puur en
  reproduceerbaar — dat is precies waarom de verduidelijkingsbeslissing nu auditeerbaar is.

---

## Besluitpunten

**1. Hoe ver gaat "statusgericht"?** Stap 2 hangt op een tweede heuristiek, en elke
heuristiek heeft randgevallen. Lever in Plan-modus de voorgestelde patronen mét
tegenvoorbeelden, zodat de grens expliciet wordt vastgesteld in plaats van gaandeweg te
ontstaan.

**2. Wat als de stand en een document elkaar tegenspreken?** Het portaal kan zeggen dat een
processtap open staat terwijl een genotuleerd besluit iets anders suggereert. Bepaal vooraf
wat dan leidend is en hoe het antwoord dat benoemt. Stilzwijgend één van beide kiezen is
schijnzekerheid.

---

## Acceptatiecriteria

1. *"Wat is mijn volgende actie om op te pakken?"* levert een inhoudelijk antwoord, geen
   verduidelijkingsvraag.
2. *"Wat zegt de Wtp over invaren?"* levert nog stééds intent `algemeen` en krijgt **geen**
   portaalstand meegestuurd (aantoonbaar, bijvoorbeeld via de promptopbouw in de log).
3. *"Wat betekent de Wtp voor mijn rol?"* levert intent `gecombineerd`.
4. `bronkeuze-meetset.ts` bevat nieuwe regels voor persoonlijke vragen én tegenvoorbeelden
   die algemeen moeten blijven; `bronkeuze-classificatie.sanity.ts` draait groen.
5. De verduidelijkingstak bestaat nog en vuurt nog steeds bij een echt ambigue vraag —
   toon minstens één voorbeeld waarbij dat terecht gebeurt.
6. Het portaalstandblok gaat **niet** mee bij een zuiver algemene vraag.
7. De persoonlijke stand komt uit query's onder RLS op de sessie; er is geen fondsbrede
   query gebruikt om iets persoonlijks te bepalen.
8. Het onderbouwingspaneel maakt zichtbaar dat de portaalstand is gebruikt, onderscheiden
   van documentbronnen.
9. Antwoorden op statusvragen formuleren wat openstaat en dragen geen besluit of opdracht
   op (steekproef van vijf antwoorden beoordeeld).
10. De AI-toon-systeemprompt is uitsluitend gewijzigd op de twee in scope genoemde punten;
    de diff toont geen herformulering elders.
11. Geen migratie, geen nieuwe tabel of kolom.
12. **Gemeten effect op tokens en tijd:** rapporteer voor een persoonlijke vraag het
    verschil in prompt-tokens en tijd-tot-eerste-token vóór en ná. Verslechtert dit meer
    dan wat de voortgangsmelding draaglijk maakt, meld dat expliciet in plaats van het te
    laten passeren.
13. `tsc --noEmit --skipLibCheck` groen; bestaande sanity-tests groen.

---

## Relevante bestanden

- `core/lib/vraagtype.ts` — `FONDS_INTENT_PATRONEN`, `bepaalBronIntent`,
  `moetVerduidelijken`, nieuwe persoonlijke en statusgerichte patronen
- `core/lib/bronkeuze-meetset.ts` + `core/lib/bronkeuze-classificatie.sanity.ts` +
  `core/lib/vraagtype.sanity.ts` — meetset en assertions
- `app/api/chat/route.ts` — `modulesBlok`-conditie, persoonlijke stand, promptblok
- `app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx` — zichtbaarheid van de stand
- `app/(dashboard)/ai/_components/Startpunt.tsx` — **referentie** voor welke gegevens de
  stand bevat (`eersteStap`, `volgendeVergadering`, agendapunten zonder inbreng); niet wijzigen

**Guardrails (zie `CLAUDE.md`)** — RLS per `fonds_id` via uitsluitend de anon-key, en voor
de persoonlijke stand RLS op de sessie; append-only audit ongemoeid; **human-in-the-loop**
(zie 4b — dit is hier het zwaarstwegende punt); geen schijnzekerheid; migratie-eerst-dan-
deploy niet van toepassing want geen migratie. Blijkt er tóch een migratie nodig, dan is
dat een signaal dat de scope verkeerd begrepen is: stop en leg voor.

**In te zetten subagents** — `ai-governance-reviewer` (verplicht: promptwijziging,
human-in-the-loop, bronherkenbaarheid), `supabase-rls-reviewer` (verplicht: nieuwe
persoonlijke query's), `code-reviewer`, en `ontwerp-sync-reviewer` vóór merge.

**Werkmodus** — begin in **Plan-modus**. Lever eerst: de voorgestelde patroonlijsten mét
tegenvoorbeelden (besluitpunt 1), de exacte tekst van de prompttoevoeging (4b), het
antwoord op besluitpunt 2, en de opzet van de meting voor criterium 12. **Wijzig pas na
expliciet akkoord.**

**Definition of Done (zie `CLAUDE.md`)** — criteria 1-13 aantoonbaar; meetset uitgebreid;
`tsc` groen; ontwerpdoc bijgewerkt + sync-check groen; `HANDOVER.md` release-historie
bijgewerkt; een `decisions/`-entry voor de verbreding van de intentieclassificatie en het
meesturen van de portaalstand — dat is een gedragswijziging in hoe de assistent bronnen
kiest, en hoort vastgelegd.

**Documentatiehaak** — dit raakt AI-gedrag en promptopbouw en is dus **geen** kleine
release. Actualiseer naast `HANDOVER.md` het functioneel ontwerp van de AI-module (§11a
bronkeuze), en beoordeel expliciet of `05 Security en compliance` bijwerking nodig heeft
vanwege de nieuwe persoonlijke query's. Werk de marker in
`00 Overzicht en status/doc-actualisatie-log.md` bij.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting,
aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact,
test/verificatie, openstaande risico's.
