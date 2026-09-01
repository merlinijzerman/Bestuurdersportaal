# Releasebewijs #228 bevinding 2a/2b — Preview

**Omgeving:** uitsluitend `bestuurdersportaal-preview`  
**Preview-head:** `d8821cfd87a61ebc3c573f82d99b71d9c89aad54`  
**PR:** [#258](https://github.com/merlinijzerman/Bestuurdersportaal/pull/258)  
**Waargenomen:** 31 augustus 2026, na database-eerst migratie en code-deploy

## PR, gates en deployments

- PR #258 is gemerged naar `preview`; mergecommit `d8821cf`.
- Alle PR-checks waren groen: boundaries/code-scheiding, cross-tenant, E2E,
  G2, karakterisering, security-baseline, migratiemap, kleuren en previewpoort.
- Alle merge-runs op `d8821cf` waren groen: `boundaries`,
  `rls-cross-tenant`, `security-baseline`, `g2-evidence`, `karakterisering` en
  `lint-colors`.
- Vercel op de mergecommit was groen voor zowel `bestuurdersportaal` als
  `bestuurdersportaal-beheer (preview-stable)`.

De verplichte nachtelijke fidelitycontrole is daarna expliciet opnieuw gestart
op dezelfde Preview-head. Run
[`33434436236`](https://github.com/merlinijzerman/Bestuurdersportaal/actions/runs/33434436236)
is rood op de read-only cataloguscontrole. De least-privilege- en
app-contractcontroles waren groen; de catalogushash wijzigde van
`26758bb...` naar `2e6b941...`. Vergelijking met het laatste groene bewijs
toont uitsluitend de verwachte functiedefinitiewijzigingen van
`fn_procedure_beeindigen` en `fn_procedure_heropenen` uit P5d, maar de
goedgekeurde Preview-fidelitybaseline is daarvoor nog niet bijgewerkt. Conform
de gate wordt de hash niet stilzwijgend aangepast: dit blijft een tweede
stopconditie totdat een expliciete driftreview en nieuwe Preview-validatie groen
zijn.

Op 1 september 2026 is die drift expliciet gereviewd: de volledige
catalogusmomentopname week uitsluitend af voor de reeds gevalideerde
P5d-definitie van `fn_procedure_beeindigen`. PR #261 actualiseerde alleen de
volledige driftmomentopname en de afgeleide fidelityhash. De PR, beide
Vercel-deployments en alle gates waren groen; mergecommit
`41720f126192afa1a91e613d1231ed8c680bebe4` is vervolgens opnieuw met de
read-only fidelityworkflow getoetst. Run
[`33477165971`](https://github.com/merlinijzerman/Bestuurdersportaal/actions/runs/33477165971)
is volledig groen. De fidelity-stopconditie is daarmee gesloten.

## Preview-database

Voor toepassing gaf de voorcontrole exact `63 / 0 / false`: 2.0.0 had 63
requirements, 2.0.1 had er geen en 2.0.1 was niet gepubliceerd.

`supabase/migrations/2026_08_31_zz_pf_wtp_invaarbesluit_201_approval.sql` is
vervolgens byte-identiek via de SQL Editor op Preview uitgevoerd. De editor
meldde `Success. No rows returned`.

De nacontrole gaf exact:

| 2.0.0 | 2.0.1 | juiste approval stap 1 | 2.0.1 gepubliceerd |
|---:|---:|---:|---|
| 63 | 64 | 1 | true |

De echte gedragstoets
`supabase/checks/2026_08_31_p2c_ongebonden_besluit.sql` is tegen Preview
uitgevoerd en slaagde. Daarmee zijn beide paden op de echte database bewezen:

- zonder approval: het besluit bestaat met `requirement_sleutel = null`, vervult
  niets en de statusomslag naar `besloten` wordt geweigerd;
- met exact één approval: het besluit wordt gebonden en de statusomslag slaagt.

De toets eindigde met `rollback`. De nacontrole gaf nul testfondsen, nul
testgebruikers en nul testprocedures; de gepubliceerde 64 requirements bleven
aanwezig.

## Functionele smoke op de gedeployde Preview-app

- Nieuw synthetisch proces gestart:
  `SMOKE #258 approval 2a-2b 2026-08-31`
  (`d4cef3c5-4d33-4a79-88de-962effc0d5c7`).
- De database bevestigde `template_versie = 2.0.1`.
- Op stap 1 is een synthetisch instemmend besluit vastgelegd. De UI toonde
  `Besluit ✓`; het aantal vereiste besluitmomenten daalde van 10 naar 9.
- De database bevestigde de exacte binding:
  `1|approval|Vaststellingsbesluit opdrachtontvangst en duiding`.
- Het bestaande synthetische 2.0.0-smokedossier
  `df857a4e-5f4f-40e8-80a0-be3d1e28703b` toont zijn besluit zichtbaar als
  `Ongebonden besluit · vervult geen vereiste`; de database bevestigde
  `requirement_sleutel = null`.
- Een nieuw ongebonden besluit en de weigering van de statusomslag zijn in de
  echte, terugrolbare DB-gedragstoets bewezen. Er is geen klantdossier aangepast
  of kunstmatig gebonden om de smoke te laten slagen.

## Releasegrenzen

- De diff `main..preview` bevat geen codewijziging die
  `ENFORCE_CAPABILITY` raakt; de bestaande, kale opt-in blijft buiten deze
  release.
- Productie is in deze Preview-fase niet aangeraakt.
- Beoogde productievolgorde zodra de vereiste EPIC-P-baseline aanwezig is:
  migratie 2.0.1 eerst, aantallen/publicatie controleren, daarna exact
  de definitieve volledig groene Preview-head naar `main`, vervolgens
  productie-smoke, gates en
  driftcontrole.

## Productievoorcontrole — stopuitkomst

Op 31 augustus 2026 is uitsluitend een alleen-lezen voorcontrole uitgevoerd op
Supabase-project `aebwiufuegsiwhwpdrfb` (`main · Production`). Er is geen
productiemigratie uitgevoerd en geen code naar productie gepromoveerd.

De voorcontrole toont dat de aanname “productie staat al na EPIC-P stap 33” niet
klopt:

- `public.procedure_requirements` bevat 63 historische requirements voor
  `pf_wtp_invaarbesluit`, maar heeft nog geen kolom `template_versie`;
- `public.procedure_definitie_publicatie` bestaat nog niet;
- de bedoelde approval op stap 1 komt in de onvervangen set nul keer voor;
- `supabase_migrations.schema_migrations` bevat uitsluitend
  `20260817085826 remote_schema`.

Git bevestigt daarnaast dat `main` op
`34f1a492e443e67be06e6752c14bc08c407fd1d4` staat en een zuivere voorouder is
van Preview-head `d8821cfd87a61ebc3c573f82d99b71d9c89aad54`: `main` heeft nul
eigen commits en loopt 174 commits achter. Er is geen productie-PR geopend en
de diff bevat geen wijziging aan `ENFORCE_CAPABILITY`.

Daarom kan `2026_08_31_zz_pf_wtp_invaarbesluit_201_approval.sql` niet veilig als
losse productiemigratie worden toegepast: hij vereist de schema- en I7-basis van
`2026_08_24_p1b_versievastheid.sql` en de daaropvolgende EPIC-P-reeks. De
release blijft gestopt vóór iedere productiewijziging. Eerst moeten stappen
2–34 uit het productiedraaiboek, inclusief hun metingen en tussenijkpunten, als
één apart goedgekeurd productie-uitrolvenster worden voorbereid en uitgevoerd;
pas daarna kan de expliciete go/no-go voor stap 35 worden gevraagd.

Omdat de release vóór het uitrolvenster is gestopt, is nog geen nieuw
productieherstelpunt gemaakt. Dat herstelpunt moet pas direct voor de later
goedgekeurde migratiereeks worden aangemaakt, zodat het niet verouderd is bij
daadwerkelijke uitvoering.
