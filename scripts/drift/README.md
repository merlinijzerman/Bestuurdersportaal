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

## Wat dit NIET kan

- **Toewijzing wijst de laatste schrijver aan, niet de ontbrekende migratie.**
  Is een functie drie keer herdefinieerd en klopt de eindvorm niet, dan meldt
  het rapport de láátste migratie als `afwijkend`. Dat is het actionabele feit
  ("de eindstand klopt niet"), maar het zegt niet wélke schakel oversloeg.
- **Migraties vóór de baseline-cutoff** zitten in `supabase/baseline/` en
  worden nooit los toegepast; zij vallen buiten het oordeel.
- **Schema's buiten `public`/`storage`** (zoals `microsoft_private`) worden niet
  gemeten. Migraties die daar hun objecten maken, komen als
  `buiten-scope-schema` in de niet-meetbare lijst.

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
| Schone referentie | 1904 van 1904 objecten `gelijk`, nul valse meldingen |
| `meta_basisniveau` teruggezet naar de #367-vorm | precies dat ene object `afwijkend` — de drift die werkelijk optrad |
| Functie gedropt + vreemde tabel toegevoegd | `ontbreekt` respectievelijk `onbekend`, met de juiste migratie erbij |
