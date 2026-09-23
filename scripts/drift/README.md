# #440 — Preview- en Productie-driftinventarisatie

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
klopt niet". `scripts/drift/historische-vormen.sh` speelt de huidige
repo-migratieketen stap voor stap af en legt per object de opgeleverde vormen
vast. Een match met een voorgangervorm is een aanwijzing voor een ontbrekende
schakel, geen bewijs dat juist die migratie veilig opnieuw kan worden gedraaid.
Matcht de doelvingerafdruk geen enkele vorm uit deze keten, dan is eenvoudig
achterlopen op de huidige keten weerlegd. Wat er wél staat blijft open: een
tussenrevisie van een later aangepast migratiebestand, een handmatige wijziging
of een ander herschrijfpad. De git-revisiediagnose loopt afzonderlijk via #445.

**Platform en applicatie gescheiden.** Objecten in `storage` worden door het
Supabase-platform beheerd en lopen niet mee met onze migratieketen; verschillen
daar zijn vrijwel altijd een platformversieverschil en geen gemiste migratie.
Ze worden gemeten maar apart gerapporteerd, zodat ze het signaal uit `public`
niet overstemmen.

**Verwijderende migraties, nu ook gecontroleerd.** Een contractmigratie als
`423b` dropt een oude functiesignatuur. Die werd eerst als "alleen data of
commentaar" weggezet — fout: zij is juist te meten, namelijk aan de AFWEZIGHEID
van wat zij verwijdert. Rapport 4 toetst dat nu actief voor 8 objecten. De
generator filtert daarbij in twee passes: wat een migratie dropt én meteen weer
aanmaakt, telt niet mee. Zonder die tweede pass meldde de controle 8 valse
bevindingen op een omgeving waar alles correct stond.

## Wat dit nog steeds NIET kan

- **Migraties vóór de baseline-cutoff** zitten in `supabase/baseline/` en worden
  nooit los toegepast; zij vallen buiten het oordeel.
- **Schema's buiten `public`/`storage`** (zoals `microsoft_private`) vallen buiten
  de definitievingerafdrukken. Migraties die daar hun objecten maken, komen als
  `buiten-scope-schema` in de niet-meetbare lijst. Rapport 4 toetst wel apart de
  afwezigheid van de oude `bewaar_koppeling`-signatuur uit `423b`; dat bewijst
  niet de volledige vorm van alle objecten uit `423a`/`423b`.
- **Waaróm een vorm onbekend is, zegt dit gereedschap niet.** Matcht een
  afwijkend object geen enkele historische vorm, dan meldt het rapport de
  gemeten vingerafdruk en verder niets. Een mogelijke oorzaak is dat het
  migratiebestand ná toepassing nog is herzien — `2026_09_07_microsoft_login_beleidsmodus.sql`
  kreeg vijf revisies op één dag — maar dat natrekken vraagt een replay over de
  GIT-historie van het bestand, en die bestaat nog niet.
- **Een functiehash is tekstgevoelig.** `pg_get_functiondef()` neemt ook
  commentaar en witruimte mee. Een hashverschil bewijst dus een andere
  catalogustekst, niet automatisch ander uitvoeringsgedrag; de inhoudelijke
  duiding van de drie Preview-vormen loopt onder #445. De vingerafdruklogica
  blijft in deze doeluitbreiding ongewijzigd.

## Herbouwen

```bash
bash scripts/start-ephemeral-supabase.sh
TEST_DATABASE_URL='postgresql://…' bash scripts/testdb-apply-migrations.sh
TEST_DATABASE_URL='postgresql://…' bash scripts/drift/genereer.sh
```

De generator schrijft twee volledige, zelfstandig in de SQL Editor te plakken
bestanden met **dezelfde meetbody**:

| Doel | Bestand | Verplichte doelbevestiging |
|---|---|---|
| `portal_preview` | `supabase/checks/2026_09_23_440_driftinventarisatie.generated.sql` | actieve `app.preview.bestuurdersportaal.com`, geen Productiehost |
| `portal_production` | `supabase/checks/2026_09_23_440_driftinventarisatie_productie.generated.sql` | actieve `app.bestuurdersportaal.com`, geen Previewhost |

De eerste SQL-stap weigert een verkeerd doel. Kies het bestand op grond van het
**onafhankelijk geverifieerde projectref** uit de centrale registry; een
hostrij alleen bewijst niet welk Supabase-project in de browser openstaat. Het
Productiebestand is voorbereiding, **geen opdracht om nu op Productie te
meten**. Beide bestanden zijn read-only en bevatten geen psql-metacommando's.

Opnieuw draaien na **elke** migratie die de catalogus verandert. Anders meet
het driftscript tegen een verouderde verwachting.

## Bewijzen (gemeten 23-09-2026 op een wegwerp-DB)

| Bewijs | Uitkomst |
|---|---|
| Verkeerd doel (geen Preview-fingerprint) | breekt fail-closed af — **proven-red** |
| Verkeerd doel (Preview-SQL op Productiefingerprint en andersom) | beide breken vóór rapport 1 af — **proven-red** op een ephemere DB |
| Schone referentie | 1904 van 1904 `gelijk` (1817 applicatie, 87 platform), nul valse meldingen |
| `meta_basisniveau` teruggezet naar de #367-vorm | precies dat ene object `afwijkend` |
| Functie gedropt + vreemde tabel toegevoegd | `ontbreekt` respectievelijk `onbekend`, met de juiste migratie erbij |
| `fn_access_token_hook` in de test teruggezet naar de `2026_09_06`-vorm | `afwijkend`, met de duiding dat de doelvorm overeenkomt met `2026_09_06_microsoft_login_fase1b.sql`; dit is een synthetisch herkenningsbewijs, geen conclusie over Preview |
| Afwezigheidscontrole op de referentie | 8 van 8 `correct afwezig`; de 8 drop-gevolgd-door-create-gevallen worden vooraf uitgefilterd, anders waren dat 8 valse bevindingen |
| Stapsgewijze replay | 89 van 89 migraties afgespeeld; faalt er één, dan stopt de generator met exitcode ≠ 0 in plaats van een onvolledige historie op te leveren |

## Live afwezigheidsmeting op Preview

Op 23-09-2026 om 09:43:23 UTC is uitsluitend rapport 4 op `portal_preview`
(`swviwoytzvaqypieqgji`) gedraaid, met de Preview-doelgrendel en een read-only
transactie. Alle acht verwachte verwijderde functies waren `correct afwezig`;
geen enkele stond op `NOG AANWEZIG`. Het [meetbewijs bij #440](https://github.com/merlinijzerman/Bestuurdersportaal/issues/440#issuecomment-5792619498)
legt de exacte grens vast. De ontbrekende #369-eindvorm en de drie onbekende
functievormen blijven afzonderlijk open onder #443 en #445.
