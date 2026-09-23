# #440 — Preview-driftinventarisatie

Meet welke migraties uit `supabase/migrations/` werkelijk op een doelomgeving
zijn toegepast. Nodig omdat de migraties geen CLI-timestamp dragen, handmatig
worden toegepast en **geen migratiehistorie** achterlaten: de database is de
enige bron van waarheid over wat er draait.

## Twee lagen, en waarom de eerste niet genoeg is

**Laag 1 — bestaan.** Welke objecten horen er te zijn, en welke ontbreken.
Begrensd tot exact de scope die de V3-allowlist beheert: schema's `public` en
`storage`. Buiten die scope is "onbekend object" geen bevinding maar ruis.

**Laag 2 — definitie.** Van elk object een vingerafdruk over de werkelijke
definitie: functiebody inclusief volatility en `search_path`, kolomvorm,
viewquery, policypredicaat, RLS-stand, triggerdefinitie, indexdefinitie en
check-constraints.

Laag 2 bestaat omdat laag 1 de drift zou hebben gemist die op Preview
werkelijk optrad. De auditprojecties van #367/#368 ontbraken, maar
`meta_basisniveau` **bestond gewoon, met de juiste rechten** — alleen met een
verouderde body. Bestaan en rechten meten had daar niets gevonden.

De **rechten** worden hier bewust niet gemeten: dat doet de V3-grants-gate al,
en twee bronnen voor hetzelfde feit is precies waar drift begint.

## Oordeel per migratie

| Oordeel | Betekenis |
|---|---|
| `aanwezig` | al haar meetbare objecten bestaan en komen overeen |
| `ontbreekt` | ten minste één van haar objecten bestaat niet |
| `afwijkend` | alle objecten bestaan, maar ten minste één definitie wijkt af |
| `niet vast te stellen` | zij laat geen meetbaar catalogusspoor na — **met reden** |

De vier redenen worden gegenereerd, niet geraden: `later-herdefinieerd`,
`buiten-scope-schema`, `alleen-rechten`, `alleen-data-of-commentaar`. Een
migratie die niet te meten is, hoort dat te zeggen in plaats van als
`aanwezig` door te glippen.

## Drie lagen, na de eerste meting op Preview

De meting op `portal_preview` van 23-09 leverde drie verbeteringen op die geen
van alle cosmetisch waren.

**Laag 3 — historische vormen.** De eerste versie kon alleen zeggen "de eindvorm
klopt niet", niet wélke schakel ontbrak. `scripts/drift/historische-vormen.sh`
speelt de keten nu migratie voor migratie af en legt per object elke vorm vast
die ooit is opgeleverd. Een afwijkend object wordt daarmee geduid: *"doel draagt
nog de vorm van `2026_09_06_microsoft_login_fase1b.sql`"* — en dus is
`2026_09_07` de ontbrekende migratie. Herkent de historie de vorm niet, dan is
het géén achterstand maar een handmatige wijziging op de doelomgeving: een
andere bevinding, en een ergere.

**Platform en applicatie gescheiden.** Objecten in `storage` worden door het
Supabase-platform beheerd en lopen niet mee met onze migratieketen; verschillen
daar zijn vrijwel altijd een platformversieverschil en geen gemiste migratie.
Ze worden gemeten maar apart gerapporteerd, zodat ze het signaal uit `public`
niet overstemmen.

**Verwijderende migraties.** Een contractmigratie als `423b` dropt een oude
functiesignatuur. Die werd eerst als "alleen data of commentaar" weggezet — dat
was fout: zij is juist te meten, namelijk aan de AFWEZIGHEID van wat zij
verwijdert. Categorie `verwijdert-objecten` noemt nu het gedropte object.

## Wat dit nog steeds NIET kan

- **Migraties vóór de baseline-cutoff** zitten in `supabase/baseline/` en worden
  nooit los toegepast; zij vallen buiten het oordeel.
- **Schema's buiten `public`/`storage`** (zoals `microsoft_private`) worden niet
  gemeten. Migraties die daar hun objecten maken, komen als
  `buiten-scope-schema` in de niet-meetbare lijst — `423a`/`423b` zijn daar het
  voorbeeld van, en moesten met de hand worden geverifieerd.
- **De afwezigheid die `verwijdert-objecten` belooft, wordt nog niet getoetst.**
  De categorie benoemt wat er weg hoort te zijn; het script controleert dat niet
  actief. Dat is de volgende stap, geen opgeloste stap.

## Herbouwen

```bash
bash scripts/start-ephemeral-supabase.sh
TEST_DATABASE_URL='postgresql://…' bash scripts/testdb-apply-migrations.sh
TEST_DATABASE_URL='postgresql://…' bash scripts/drift/genereer.sh
```

Opnieuw draaien na **elke** migratie die de catalogus verandert. Anders meet
het driftscript tegen een verouderde verwachting.

## Bewijzen (gemeten 23-09-2026 op een wegwerp-DB)

| Bewijs | Uitkomst |
|---|---|
| Verkeerd doel (geen Preview-fingerprint) | breekt fail-closed af — **proven-red** |
| Schone referentie | 1904 van 1904 `gelijk` (1817 applicatie, 87 platform), nul valse meldingen |
| `meta_basisniveau` teruggezet naar de #367-vorm | precies dat ene object `afwijkend` |
| Functie gedropt + vreemde tabel toegevoegd | `ontbreekt` respectievelijk `onbekend`, met de juiste migratie erbij |
| `fn_access_token_hook` teruggezet naar de `2026_09_06`-vorm | `afwijkend`, **met de duiding "doel draagt nog de vorm van `2026_09_06_microsoft_login_fase1b.sql`"** — de ontbrekende schakel wordt dus benoemd |
| Stapsgewijze replay | 89 van 89 migraties afgespeeld; faalt er één, dan stopt de generator met exitcode ≠ 0 in plaats van een onvolledige historie op te leveren |
