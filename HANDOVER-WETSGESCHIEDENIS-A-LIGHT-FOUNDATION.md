# Handover — wetsgeschiedenis A-light, foundation (vóór de Microsoft-release)

| Veld | Waarde |
|---|---|
| **Branch** | `codex/wetsgeschiedenis-a-light-foundation` (lokaal; **niet gepusht**) |
| **Worktree** | `…/MVP bestuurdersportaal/mvp-wetsgeschiedenis-foundation` |
| **Basis** | `origin/preview` @ `5e787f8` (merge #444, 23-09-2026). Keuze bevestigd door de opdrachtgever. `main` (`3fafe45`) loopt 166 commits achter. |
| **Functionele bron** | `WERKTICKET-WETSGESCHIEDENIS-A-LIGHT.md` en `BRONINVENTARIS-WETGEVING-EN-WETSGESCHIEDENIS-A-LIGHT.md` (in deze branch, aparte documentatiecommit). De tijdelijke agentinstructie blijft bewust buiten de PR: die bevat release-specifieke uitvoeringsafspraken. |
| **Status** | PR-klaar, getest, **niet gemerged, niet gedeployd, niet live gemigreerd, niets geïmporteerd.** |

## 1. Bestaand model: hergebruik en minimale uitbreiding

De vaststelling is gemeten tegen de code en de migraties op `5e787f8`.

| Behoefte | Bestaand veld / mechanisme | Besluit |
|---|---|---|
| Officiële verwijzing / publicatiekenmerk | `titel` | Hergebruik. Geen apart veld. Bij wetsgeschiedenis moet het dossiernummer in de titel staan (servervalidatie). |
| Datum | `documentdatum` | Hergebruik; verplicht bij wetsgeschiedenis. |
| Officiële link | `extern_url` (http(s)-gate `isVeiligeUrl`) | Hergebruik; verplicht bij beide juridische typen. |
| Bronorganisatie, thema | `bronorganisatie`, `thema` | Hergebruik, ongewijzigd. |
| Pensioenwet / Wvb / beide | **`wettelijk_regime`** (T4, `pw\|wvb\|beide\|algemeen`, al gedenormaliseerd naar chunks) | Hergebruik. Zie afwijking A-1: dit is het echte regimefacet, niet het vrije-tekstveld `toepassingsgebied`. |
| Normgewicht | `normgewicht` | Hergebruik. Wetsgeschiedenis staat vast op `informatief` (app én DB). |
| Status, actief/geïndexeerd, versievervanging | `status`, `bronstatus`, `actief`, `geindexeerd`, `vervangt_/vervangen_door_document_id`, actie `curatieVervangen` | Hergebruik, ongewijzigd. |
| Documenttype | `documenten.documenttype` + CHECK; al gedenormaliseerd naar `document_chunks.documenttype` | Uitgebreid met `wetgeving` en `wetsgeschiedenis`. |
| Soort parlementair stuk | — | **Nieuw:** `wetsgeschiedenis_subtype` (nullable). |
| Wetgevingsdossier | — | **Nieuw:** `dossiernummer` (nullable, genormaliseerd). |
| Tekststructuur | `document_chunks.structuur_type` / `structuur_label` (R1.1) | Hergebruik. Er komt geen nieuw chunkveld bij. |
| Audit | `withPlatform` (`platform_event_log`, twee fasen) + append-only `document_metadata_log` | Hergebruik, ongewijzigd. De nieuwe velden lopen mee in de bestaande diff. |

Niet toegevoegd, zoals de opdracht vraagt: publicatiekenmerk, behandelingsstatus, artikelregister, passage-identiteit, koppeltabel, juridische validatieworkflow, historische wetsversies, nieuw beheerscherm en nieuwe rol.

## 2. Gewijzigde en nieuwe bestanden

| Bestand | Reden |
|---|---|
| `supabase/migrations/2026_09_23_wetsgeschiedenis_a_light_foundation.sql` (nieuw) | Twee nullable kolommen, uitgebreide documenttype-CHECK, waarde-CHECKs op subtype en dossiernummer, en twee combinatie-CHECKs: juridische typen alleen generiek; wetsgeschiedenis ⇒ subtype + dossier + `informatief`. |
| `supabase/rollbacks/2026_09_23_wetsgeschiedenis_a_light_foundation_ROLLBACK.sql` (nieuw) | Fail-closed rollback: weigert zolang er juridische documenten bestaan. |
| `supabase/checks/2026_09_23_wetsgeschiedenis_foundation.sql` (nieuw) | DB-invarianten W1–W10, waaronder W8 onder echte RLS en W10 voor de denormalisatie. |
| `scripts/cross-tenant-ci.sh` | Nieuwe check aangesloten, direct na T6 (generieke contentlaag). |
| `supabase/schema.sql` | Documentatie van de nieuwe kolommen en CHECKs. |
| `core/lib/wetsgeschiedenis.ts` (nieuw) | Pure domeinlogica: typen, subtypen, labels, dossiernormalisatie en -weergave, combinatievalidatie, duiding geldend recht vs. wetsgeschiedenis. |
| `core/lib/generiek-curatie-juridisch.ts` (nieuw) | `valideerGeneriekeCuratie`: wrapper om het ongewijzigde `valideerCuratie`. Zie afwijking A-2. |
| `core/lib/wetsgeschiedenis-structuur.ts` (nieuw) | Pure, conservatieve structurering: algemeen deel, artikelsgewijze toelichting (artikel/onderdeel), amendement-wijziging/-toelichting. Levert `StructuurUnit` op. **Niet aangesloten** op de ingest. |
| `core/lib/wetsgeschiedenis.sanity.ts`, `core/lib/wetsgeschiedenis-structuur.sanity.ts` (nieuw) | 26 + 11 sanity-tests, met synthetische fixtures. |
| `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/acties.ts` | Leest de 4 velden in, valideert via de wrapper en neemt ze op in de bewerk-diff (auditspoor). `documenttype`/`wettelijk_regime` zijn `rag_impact`; subtype en dossier niet. |
| `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/_components/GeneriekeBibliotheekClient.tsx` | Velden Documenttype, Wettelijk regime en, bij wetsgeschiedenis, Soort stuk + Dossiernummer. Vooraf een melding met de vereisten. Normgewicht staat vast op Informatief bij wetsgeschiedenis. Type-/dossier-/regimeregel in de lijst. Een historisch fondstype op een bestaand generiek document blijft behouden. |
| `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/page.tsx` | Leest de 4 kolommen mee in. |

Wat niet gewijzigd is: `app/api/chat/route.ts`, `core/lib/rag.ts`, `core/lib/retrieval/*`, `core/lib/generiek-curatie.ts`, `core/lib/chunking.ts`, `core/lib/chunk-*`, `fn_chunk_denorm` en de triggers, alle RPC's, en alle Microsoft-, SharePoint-, OAuth-, tenant- en tokencode. Controle:

```bash
git diff --name-only 5e787f8
```

## 3. Migratie en deployvolgorde — **NOG NIET UITVOEREN**

Pas starten nadat de Microsoft-release op de doelbranch is geland en deze branch daarop is gerebased en opnieuw getest.

1. Rebase op de dan geldende `origin/preview`. Controleer dat er geen nieuwere migratie `documenten_documenttype_check` of `fn_chunk_denorm` wijzigt; zo ja, voeg de waardelijst samen.
2. **Preview-DB (`portal_preview`)**: eerst de controlequery uit de migratie (moet 0 zijn), dan de migratie `2026_09_23_wetsgeschiedenis_a_light_foundation.sql`.
3. Tegen Preview: `supabase/checks/2026_07_31_r1_structurele_gates.sql` en de V3-grants-gate. Er is geen nieuw object en geen grantwijziging, dus de allowlist hoeft niet te veranderen. Controleer dat.
4. Pas daarna: merge van de PR naar `preview` → Preview-deploy. De UI biedt de nieuwe waarden aan; zonder migratie falen de select en de insert.
5. Productie alleen via de reguliere promotie (akkoord opdrachtgever) en in dezelfde volgorde: eerst de migratie op `portal_production`, dan de code.

Rollback: eerst juridische documenten herclassificeren of verwijderen via de curatie, dan het rollbackscript. Het script weigert anders.

## 4. Uitgevoerde tests (lokaal, 23-09-2026)

| Test | Resultaat |
|---|---|
| `tsc --noEmit --skipLibCheck` | exit 0 |
| `npm run sanity` (alle suites, incl. 2 nieuwe) | groen: "Alle resterende sanity-suites groen." |
| `core/lib/wetsgeschiedenis.sanity.ts` | 26/26 |
| `core/lib/wetsgeschiedenis-structuur.sanity.ts` | 11/11 |
| `core/lib/generiek-curatie.sanity.ts` (regressie) | 10/10 |
| `tests/cross-tenant/retrieval-census.test.ts` | 11/11 (zie afwijking A-2) |
| `bash scripts/cross-tenant-ci.sh` volledig, lokale ephemere Supabase (CLI 2.114.0), migraties uit de repo | GROEN (exit 0), zie §4a |
| W1–W10 (nieuwe DB-check) | alle `OK` |
| eslint op gewijzigde bestanden, `lint:boundaries`, `lint:quality:check`, `lint:colors` | groen / baseline groen |
| `scripts/check-migratie-mapindeling.sh` | OK |
| Negatieve controle, idempotentie, rollback | groen, zie §4a |

Niet uitgevoerd: een live smoke tegen Preview, Productie, Microsoft of SharePoint (bewust). Ook geen visuele browsercontrole van de curatie-UI, omdat het platformpad een platform-identiteit met MFA vereist. Dit is een open punt voor de Preview-ronde.

### 4a. Volledige suite, negatieve controle en idempotentie

- **Volledige §15-suite** (`TEST_DATABASE_URL` = lokale stack, verse DB): `GROEN: volledige §15 cross-tenant suite geslaagd (app-laag + DB-laag)`. App-laag: 1025/1025. DB-laag inclusief de R1-structurele gates en de V3-grants-gate (geen allowlistwijziging nodig). De ROL-1-rolverklaring van de nieuwe check is groen.
- **Negatieve controle** (in een teruggerolde transactie):
  - zonder `documenten_wetsgeschiedenis_combinatie_check` → `LEK W2: wetsgeschiedenis met normgewicht bindend aanvaard` (rood, zoals bedoeld);
  - zonder `documenten_juridisch_generiek_check` → `LEK W7: fondsdocument als wetgeving geclassificeerd` (rood, zoals bedoeld).
- **Idempotentie**: de migratie tweemaal toegepast gaf exit 0.
- **Rollback**: met een juridisch document geweigerd (`Rollback geweigerd: 1 document(en)…`). Op een lege set: exit 0, beide kolommen weg. Opnieuw toepassen gaf exit 0; W1–W10 daarna 10× `OK`.
- De eerste suite-run was rood op `retrieval-census.test.ts` (134 → 136 bestanden in de antwoordpadgraaf). Dat is verholpen door afwijking A-2; zie §5.

## 5. Bewuste afwijkingen en open punten

- **A-1 — regime via `wettelijk_regime`, niet via `toepassingsgebied`.** De instructie noemt `toepassingsgebied` voor PW/Wvb/beide. In de code is dat een inert vrije-tekstveld. Het echte, gecontroleerde en al gedenormaliseerde regimefacet is `wettelijk_regime` (T4). Dat stond nog niet in het curatieformulier en is nu toegevoegd: optioneel voor gewone generieke documenten, verplicht (`pw|wvb|beide`) voor juridische typen. Gevolg: bij `REGIME_WEGING` aan kan een gecureerd regime het bestaande demotiegedrag voeden. Dat is bestaand retrievalgedrag op data; er is geen codewijziging.
- **A-2 — juridische validatie in een wrapper, niet in `generiek-curatie.ts`.** De eerste versie breidde `valideerCuratie` uit. Daarmee groeide de bevroren importgraaf van het antwoordpad van 134 naar 136 bestanden (`retrieval-census.test.ts` rood), omdat `rag.ts` die module importeert. Dat is een raakvlak met de retrieval-release. Daarom staat de logica nu in `generiek-curatie-juridisch.ts` en blijft `generiek-curatie.ts` byte-identiek. Post-release kan dit worden samengevoegd, met een bewuste regeneratie van het census-register.
- **A-3 — extra servereisen voor juridische typen:** een officiële URL (beide typen), plus documentdatum en dossiernummer in de titel (wetsgeschiedenis). Dit volgt uit de werkticket-eisen "kamerstuknummer, datum, officiële link". Alleen de app-laag dwingt dit af; de DB niet.
- **A-4 — subtype en dossiernummer niet gedenormaliseerd naar `document_chunks`.** `documenttype` staat al op de chunk en volstaat voor het onderscheid wet/wetsgeschiedenis. Uitbreiden vereist een wijziging aan `fn_chunk_denorm` (retrievalterrein); zie post-release stap R-1.
- **A-5 — geen type-/subtypefilter in de bibliotheeklijst.** Het werkticket noemt filters; de agentinstructie vraagt invoeren, tonen, wijzigen en auditen. De lijst toont type, dossier en regime per document. Een filter is een kleine post-releaseaanvulling (B-1).
- **A-6 — dossiernummerformaat.** Opslag: 3–6 cijfers, optioneel `-SUFFIX` (bv. `36200-XV`). Aanname: dit dekt de pilotdossiers. Controleer het tegen de broncuratielijst vóór de import.
- **A-7 — de pilotset past niet volledig in de vier verplichte subtypen (open, beslissing nodig vóór import).** De broninventaris §3.2/§3.4 noemt P0-stukken die geen van de vier subtypen zijn:
  - *Memorie van antwoord* en *nadere memorie van antwoord* (EK, 36 067 H en K);
  - *Nota van toelichting* bij het Besluit toekomst pensioenen (Stb. 2023, 217) en bij het Besluit transitietermijnen (Stb. 2025, 423). Deze stukken hebben bovendien geen Kamerstukdossier, terwijl de foundation bij wetsgeschiedenis een dossiernummer (en dat nummer in de titel) verplicht stelt.

  De *nota naar aanleiding van het nader verslag* (36 067 nr. 11) valt redelijkerwijs onder `nota_naar_aanleiding_van_het_verslag`. De instructie vraagt "minimaal" de vier subtypen, dus uitbreiden kan. **Voorstel:** additieve migratie met `memorie_van_antwoord` en `nota_van_toelichting`, en het dossiernummer optioneel voor `nota_van_toelichting` (verwijzing via Stb.-nummer in de titel). Niet uitgevoerd: dit is een scopekeuze voor de opdrachtgever.
- **A-8 — broninventaris §8 wijkt af van het werkticket.** De inventaris noemt metadatavelden `publication_reference`, `legal_status` en `amendment_status`. Het werkticket (leidend) en deze foundation voegen die bewust níet toe: de verwijzing staat in de titel, aangenomen = subtype, en de statuscontrole hoort in de broncuratielijst. Werk bij een volgende versie van de inventaris §8 bij, zodat die niet als eis wordt gelezen.

## 6. Raakvlakken met de Microsoft-release

| Raakvlak | Aard | Beheersing |
|---|---|---|
| `scripts/cross-tenant-ci.sh` | Gedeeld bestand; de release voegt checks toe aan het eind | Onze regels staan midden in het bestand (na T6). Bij een rebase-conflict: beide behouden. |
| `supabase/schema.sql` | Gedeelde documentatie | Alleen het `documenten`-blok; kans op een tekstueel conflict is klein. |
| Migratievolgorde | Onze datum 2026-09-23, naast `2026_09_23_434_adapterstand_fonds.sql` | Geen objectoverlap (alleen `documenten`-CHECKs en -kolommen). Bij een rebase de volgorde controleren. |
| Importgraaf antwoordpad (census) | Bewust **niet** geraakt | Zie A-2. |
| `document_chunks` / `fn_chunk_denorm` | Niet gewijzigd | Denormalisatie van `documenttype` loopt al; W10 bewijst dat. |

Geen overlap met `app/api/chat/route.ts`, `core/lib/rag.ts`, `core/lib/retrieval/*`, Microsoft-, SharePoint-, OAuth-, tenant- of tokencode.

## 7. Post-releasestappen (na rebase op de doelbranch)

| # | Stap | Verwachte bestanden | Tests |
|---|---|---|---|
| R-0 | Rebase + volledige hertest (§4), dan de migratie op Preview (§3) | — | `cross-tenant-ci.sh`, sanity, census |
| I-1 | Import en structuur (werkticket PR 2): `structureerParlementairStuk` → `alsStructuurUnits` aansluiten op de ingest voor `documenttype='wetsgeschiedenis'` | `core/lib/chunk-bouw.ts` of `chunk-ingest.ts`, `platform/lib/generiek-pipeline.ts` | chunk-bouw-sanity met MvT/amendement-fixture; census regenereren als de antwoordgraaf verandert |
| I-2 | Actuele PW/Wvb opnemen (BWB-id in de titel/URL); max. één actieve versie per wet via `curatieVervangen`; Wtp-Staatsblad-pdf's herclassificeren | curatiehandeling (data), eventueel een DB-check "één actieve wetgeving per regime + titel-BWB" | DB-check + Preview-controle |
| R-1 | Retrievalmetadata: subtype, dossiernummer en documenttype in het retrieval-/auditcontract; eventueel `fn_chunk_denorm` uitbreiden | nieuwe migratie (denorm), `core/lib/retrieval/contract.ts`, `selectie.ts`, meta-projectie (TS-allowlist én migratie) | `retrieval-contract.test.ts`, census, W10 aanpassen |
| R-2 | Intentherkenning geldend recht vs. bedoeling/totstandkoming | `core/lib/vraagtype.ts` (of router) | `vraagtype.test.ts` (pariteitspin bijwerken) |
| R-3 | Ranking/routing: actuele wet vóór wetsgeschiedenis bij normatieve vragen; wetsgeschiedenis alleen aanvullend | `core/lib/rag.ts`, `core/lib/retrieval/selectie.ts` | retrievalregressies + nieuwe evalcases |
| A-1 | Antwoordregels: wetsgeschiedenis nooit zelfstandig normatief ("moet/mag niet/termijn") | `app/api/chat/route.ts` / `generatie-kern.ts` (sha256-pin bewust bijwerken) | `generatie-kern.sanity.ts` |
| B-1 | Bronweergave: labels uit `juridischeDuiding` in het onderbouwing-/bronnenpaneel; filter in de bibliotheek | `OnderbouwingPaneel.tsx`, `AntwoordWeergave.tsx`, `assistant-source.ts`, `GeneriekeBibliotheekClient.tsx` | component-tests |
| W-1 | Live web: `officielebekendmakingen.nl` `kst-*` niet bindend via de whitelist | `core/lib/web-whitelist.ts`, `web-retrieval.ts` | `web-whitelist.sanity.ts`, `web-retrieval.test.ts` |
| E-1 | Evaluatieset (werkticket PR 4) + Preview-pilot met bron- en antwoordcontrole | `evals/…` | evalrun op Preview |

## 8. Bevestiging

Niets is gemerged, gepusht, gedeployd, live gemigreerd of live geïmporteerd. Migraties zijn alleen uitgevoerd op een lokale, wegwerpbare Supabase-stack (Docker, poort 54322).
