# 0165 — Vier reflectie-ingangen in plaats van acht

- **Status:** Geaccepteerd (impl.; B-opt tranche 2a/2b)
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (opdrachtgever), ontwikkeling
- **Herziet:** ontwerp v1.0 §9.3 (de acht reflectie-ingangen)

## Context

De acht ingangen uit v1.0 §9.3 vroegen de bestuurder zijn aarzeling te classificeren vóórdat hij hem had verwoord — precies de volgorde die niet werkt — en ze overlapten ("ik twijfel aan de onderbouwing" en "ik mis informatie" zijn in de praktijk vaak hetzelfde moment). Acht knoppen lezen als een taxonomie, niet als een uitnodiging (VOORSTEL §A/§B).

## Besluit

Terug naar **vier** ingangen: `mis_iets` ("Ik mis iets"), `twijfel` ("Ik twijfel"), `risico` ("Ik zie een risico"), `overtuigt` ("Dit overtuigt mij"). Elk met één regel subtekst die het onderscheid draagt; vier brede knoppen onder elkaar, geen iconen, geen kleuraccent (FR-22). De fijnmazigheid van de acht keert terug als verdiepings-**richting** binnen guardrails (tranche 3), niet als aparte knop.

Datamapping oud→nieuw (bevroren in `core/lib/reflectie-flow.ts` `INGANG_MAPPING_OUD_NAAR_NIEUW` en uitgevoerd door migratie `2026_08_12_bopt2_reflectie_ingangen.sql`):

| Oud | Nieuw |
|---|---|
| informatie_ontbreekt, alternatief | `mis_iets` |
| onderbouwing, evenwichtigheid, uitlegbaarheid, niet_te_plaatsen | `twijfel` |
| uitvoeringsrisico | `risico` |
| overtuiging | `overtuigt` |

## De vierde ingang (`risico`) blijft staan

VOORSTEL §B legde een verwijdercriterium vast: `risico` gaat eruit wanneer bij de gebruikerstoets **beide** doen — zichtbare aarzeling tussen "Ik twijfel" en "Ik zie een risico" **én** dezelfde vervolgvraag. Omdat de gebruikerstoets voor deze optimalisatie bewust is overgeslagen ([[0164]]), kan dat criterium niet worden waargenomen. `risico` **blijft daarom staan** — dat is de veilige default (verwijderen vergt beide criteria). Dit blijft een aandachtspunt voor een post-hoc toets.

## Overwogen alternatieven

- **Drie ingangen** (het oorspronkelijke advies): `risico` weglaten. Verworpen door de opdrachtgever (12-08-2026): "ik zie een risico" is psychologisch geen twijfel, en afwezigheid van een knop laat geen sporen na terwijl aanwezigheid dat wél doet — met vier kan een toets waarnemen of de vierde zijn plaats verdient.
- **Acht behouden.** Verworpen: de taxonomie is het probleem dat deze optimalisatie oplost.

## Gevolgen

- Migratie `2026_08_12_bopt2_reflectie_ingangen.sql` (+ROLLBACK): CHECK 8→4 met datamapping; `create or replace reflectie_transitie` met de nieuwe ingang-allowlist. Gates A–H + de B-checksuite verplicht tegen de doeldatabase.
- **Sequencing:** de migratie zet de CHECK op vier waarden en breekt daarmee de nu-live 8-ingang-code; bopt2 en de tranche-2-code deployen samen.
- Verlies van fijnmazigheid (uitlegbaarheid/evenwichtigheid als aparte ingang) is aanvaard; ze keren terug als richting in tranche 3. Blijft een post-hoc-toetspunt.

## Referenties

- `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §B · ontwerp v1.0 §9.3
- [[0164]] (waiver gebruikerstoets), [[0112]], [[0110]]
