# 0192 — P3: zwaarte, afwijking-capability en de I7-veilige kolomomzetting

- **Status:** Geaccepteerd
- **Datum:** 2026-08-27
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)

## Context

P3 ([#168](https://github.com/merlinijzerman/Bestuurdersportaal/issues/168)) doet drie dingen aan de proceduremodule: het maakt van `verplicht` + `blokkerend` één **zwaarte**-veld, het voegt een capability toe om bij het afronden een gemotiveerde **afwijking** vast te leggen, en het ontmantelt de readiness-ladder (het richtingsbesluit daarvoor is [[0187]]). Dit besluit legt vast wat na **PR-A** (capability-declaratie) en **PR-B** (zwaarte + `besluitmoment_stap`, booleans → afgeleide kolommen) is besloten en gebouwd; **PR-C** (afwijking) en **PR-D** (readiness weg) volgen erna en dragen hun eigen detailkeuzes.

Twee dingen dwongen dit besluit scherper te zijn dan een gewone kolomtoevoeging.

Ten eerste raakt de zwaarte-omzetting recht de **onveranderlijkheid van een gepubliceerde definitie** ([[0188]], I7): `procedure_requirements` draagt de trigger `trg_req_versievast` die élke row-DML op een rij van een gepubliceerde `(template_code, template_versie)` weigert. Een gewone backfill (`update … set zwaarte = …`) zou daarop afbreken op de gepubliceerde invaar- en beleidswijzigingsdefinities.

Ten tweede bleek de eerste verificatie een **vals-negatief**: de prod-gelijke stub bouwt vanaf een schema-only baseline, dus er stonden geen gepubliceerde requirement-rijen, en de I7-trigger had niets te bewaken. De migratie leek groen terwijl zij op productie zou afbreken. Dat is geen incident maar een **klasse** — elke migratie die het bevroren pad raakt, kan zo stil groen worden bevonden.

## Besluit

**1. Rolbesluit — `procedures.afwijking.vastleggen` alleen voor voorzitter en bestuurder.**
De nieuwe capability wordt toegekend aan **voorzitter** en **bestuurder**, en bewust *niet* aan **beheerder** en **bestuursbureau**. Afwijken bij het afronden is een bestuurlijke handeling van wie het besluit draagt; de beheerder (techniek/inrichting) en het bureau (voorbereiding) hebben daar geen rol in. De capability is in PR-A alleen gedeclareerd en toegekend — **nul route, nul gedrag**: geen enkele handler poort erop, dus de W7-autorisatiematrix beweegt niet (bevestigd: de statische matrix is byte-identiek aan de code). Zij wordt pas dragend in PR-C.

**2. `zwaarte` vervangt `verplicht` + `blokkerend`.**
Eén veld met drie waarden — `optioneel` / `vereist` / `kritiek` — vervangt het tweetal booleans (§5.1). De afbeelding is: `verplicht=false → optioneel`; `verplicht=true, blokkerend=false → vereist`; `verplicht=true, blokkerend=true → kritiek`. De onzin-combinatie `verplicht=false, blokkerend=true` bestaat niet als zwaarte en wordt **niet stil genormaliseerd**: zowel de migratie-pre-flight als de schrijfroute weigeren haar expliciet (§5.1). De twee booleans blijven als **afgeleide (`generated`) leeskolommen** bestaan (`verplicht = zwaarte <> 'optioneel'`, `blokkerend = zwaarte = 'kritiek'`), zodat alle bestaande leescode ongewijzigd blijft werken; `zwaarte` is de enige schrijfkant. `besluitmoment_stap int` komt als kolom in PR-B mee (leeg = huidig gedrag); de **telling** erop hoort bij PR-D en de import-invulling bij fase C.

**3. De omzetting gebeurt I7-veilig via tijdelijk-`generated` + `drop expression`, niet via row-DML.**
De zwaarte-waarden worden gevuld door de kolom eerst als `generated always as (…) stored` toe te voegen — DDL berekent de waarde per rij, óók voor de bevroren rijen, want DDL vuurt de row-trigger niet — en daarna met `alter column … drop expression` om te zetten naar een gewone, schrijfbare kolom die die waarden behoudt. Dezelfde vorm draagt de omzetting van `verplicht`/`blokkerend` naar afgeleide kolommen (eigen migratie + rollback) en de rollback zelf. Zo blijft **I7 volledig aan**; er is geen moment waarop de trigger uitstaat.

**4. Het bevroren pad wordt mechanisch afgedwongen bij verificatie (klasse-remedie).**
`scripts/testdb-i7-fixture.sql` zet minstens één gepubliceerde templateversie met requirement-rijen (alle drie de zwaartes) + een dossier neer. Het protocol — baseline bouwen, fixture toepassen, dán de tranche-FRF (rollback → forward) draaien — hoort **bij het landen van elke tranche**, niet bij het geheugen. Breekt een migratie af op I7, dan doet zij row-DML op een gepubliceerde rij en moet zij worden herschreven (zoals hierboven), niet door I7 te onderdrukken.

## Overwogen alternatieven

- **Row-DML-backfill met I7 tijdelijk uit** — verworpen. Het onderdrukken van de onveranderlijkheidstrigger, al is het één transactie lang, opent precies het window dat [[0188]] dichttimmert. De DDL-route bereikt hetzelfde resultaat zonder dat window.
- **`verplicht`/`blokkerend` hard verwijderen** — verworpen voor nu: te veel leescode leest ze. Als afgeleide kolommen behouden houdt PR-B puur additief in gedrag; een latere opruiming kan de kolommen alsnog laten vallen als de leeskant is omgezet.
- **De onzin-combo stil naar `kritiek`/`optioneel` promoveren** — verworpen: `verplicht=false, blokkerend=true` is niet lossless en verdient een mens, geen stille keuze. Vandaar de harde weigering aan beide kanten.
- **Vertrouwen op de bestaande stub-verificatie** — verworpen als enige borging: die gaf juist het vals-negatief. De fixture is de structurele tegenhanger.

## Gevolgen

- **Retroactieve klasse-controle uitgevoerd.** P1b ([#166](https://github.com/merlinijzerman/Bestuurdersportaal/issues/166)) is **veilig**: de backfills draaien vóór de trigger wordt aangemaakt en vóór de publicatie. P2 ([#167](https://github.com/merlinijzerman/Bestuurdersportaal/issues/167)) is **veilig**: nul row-DML op `procedure_requirements` (P2 schrijft alleen naar `decision_*`, `besluiten`, `vaststelling`, `bewijs`). P3 was de enige echte botsing, en die is nu I7-veilig.
- **De gate deed zijn werk.** Op de samengevoegde epic vielen de gedragstoetsen `bewijsbinding` en `vaststelling-binding` rood: zij insertten nog `verplicht`/`blokkerend`, nu `generated`-kolommen. Beide zijn omgezet naar de zwaarte-schrijfkolom en weer groen — exact het klasse-van-falen dat [[0190]] bedoelt te vangen.
- **Twee onveranderlijke artefacten, vóór P6 te adresseren.** De afschriftquery over preview en productie was niet schoon maar **leeg** (0 snapshots; 1 afschrift gereed). Twee vondsten worden losse benoemde items en mogen niet stil blijven staan: [#207](https://github.com/merlinijzerman/Bestuurdersportaal/issues/207) — één productie-afschrift dat blijft staan — en [#208](https://github.com/merlinijzerman/Bestuurdersportaal/issues/208) — `decision_audit_snapshots` is leeg, wat ook P4 raakt. Beide zijn P6-blokkers.
- **Naar P4 doorgeschoven:** §5.2 (de leeskant/telling die zwaarte volledig benut) én §6.3 (heropenen-ter-correctie) horen bij P4, niet bij deze tranche.
- **Fase C (importer):** de definitie-importer moet `zwaarte` gaan schrijven in plaats van de twee booleans; `besluitmoment_stap` wordt daar ingevuld.
- **P2-tranche-schuld opgeruimd.** Het volledig draaien van de karakterisering op de epic hoestte twee reeds-rode gates op die niet door P3 kwamen (geverifieerd op de pre-P3-epic-tip): de W7-handlerteller (112 → 113 door de P2-koppelroute) en de ontbrekende `-- ROL:`-regel in de vaststelling-checksuite. Beide zijn rechtgezet zodat de app-laag-gate op de epic groen is.

## Referenties

- Migraties: `supabase/migrations/2026_08_27_p3b_01_zwaarte.sql`, `…_p3b_02_booleans_generated.sql` (+ rollback). Fixture: `scripts/testdb-i7-fixture.sql`. Helper: `core/lib/requirement-zwaarte.ts`.
- Aanleiding en kaders: [[0187]] (readiness vervalt), [[0188]] (I7 / versievastheid), [[0189]] (vervulling via gebonden feit), [[0190]] (lokale gateset ving de check-breuk).
- EPIC [#164](https://github.com/merlinijzerman/Bestuurdersportaal/issues/164), P3 [#168](https://github.com/merlinijzerman/Bestuurdersportaal/issues/168), P4 [#169](https://github.com/merlinijzerman/Bestuurdersportaal/issues/169), P6 [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171).
- Openstaand vóór P6: [#207](https://github.com/merlinijzerman/Bestuurdersportaal/issues/207), [#208](https://github.com/merlinijzerman/Bestuurdersportaal/issues/208).
