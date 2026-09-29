# Handover — wetsgeschiedenis A-light (foundation + I-1 structuur-ingest + R-1 bronduiding + R-2 vraagintentie)

| Veld | Waarde |
|---|---|
| **Branch** | `codex/wetsgeschiedenis-retrieval-metadata` |
| **Worktree** | `…/MVP bestuurdersportaal/mvp-wetsgeschiedenis-structure-ingest` |
| **Basis** | `origin/preview` @ `861f45d` (29-09-2026), inclusief de gemergde foundation en I-1. |
| **Functionele bron** | `WERKTICKET-WETSGESCHIEDENIS-A-LIGHT.md` en `BRONINVENTARIS-WETGEVING-EN-WETSGESCHIEDENIS-A-LIGHT.md` (in deze branch, aparte documentatiecommit). De tijdelijke agentinstructie blijft bewust buiten de PR: die bevat release-specifieke uitvoeringsafspraken. |
| **Status** | Foundation, I-1 en R-1 staan op Preview. R-1 is via PR #489 gemerged als `580304f`; alle post-mergechecks en beide vaste Preview-deployments zijn groen. Niets geïmporteerd en Productie niet gewijzigd. |
| **R-2 (#491)** | Branch `codex/491-juridische-vraagintentie` vanaf `origin/preview` @ `e71a049`, één PR naar `preview`. Observe-only juridische vraagintentie; geen migratie, geen gedragswijziging. Zie §2a. |

## 1. Bestaand model: hergebruik en minimale uitbreiding

De vaststelling is gemeten tegen de code en de migraties op `5b0f581`.

| Behoefte | Bestaand veld / mechanisme | Besluit |
|---|---|---|
| Officiële verwijzing / publicatiekenmerk | `titel` | Hergebruik. Geen apart veld. Bij wetsgeschiedenis moet het dossiernummer in de titel staan (servervalidatie). |
| Datum | `documentdatum` | Hergebruik; verplicht bij wetsgeschiedenis. |
| Officiële link | `extern_url` (http(s)-gate `isVeiligeUrl`) | Hergebruik; verplicht bij beide juridische typen. |
| Bronorganisatie, thema | `bronorganisatie`, `thema` | Hergebruik, ongewijzigd. |
| Pensioenwet / Wvb / beide | **`wettelijk_regime`** (T4, `pw\|wvb\|beide\|algemeen`, al gedenormaliseerd naar chunks) | Hergebruik. Zie afwijking A-1: dit is het echte regimefacet, niet het vrije-tekstveld `toepassingsgebied`. |
| Normgewicht | `normgewicht` | Hergebruik. Wetsgeschiedenis staat vast op `informatief` (app én DB). |
| Status, actief/geïndexeerd, versievervanging | `status`, `bronstatus`, `actief`, `geindexeerd`, `vervangt_/vervangen_door_document_id`, actie `curatieVervangen` | Hergebruik, ongewijzigd. Alleen de zichtbare labels zijn juridisch verduidelijkt: wetgeving toont geldigheid; wetsgeschiedenis publicatiestatus en nooit het label "van kracht". |
| Documenttype | `documenten.documenttype` + CHECK; al gedenormaliseerd naar `document_chunks.documenttype` | Uitgebreid met `wetgeving` en `wetsgeschiedenis`. |
| Soort parlementair stuk | — | **Nieuw:** `wetsgeschiedenis_subtype` (nullable): `memorie_van_toelichting`, `aangenomen_amendement`, `nota_van_wijziging`, `nota_naar_aanleiding_van_het_verslag`, `memorie_van_antwoord` (ook nadere MvA), `nota_van_toelichting` (AMvB). |
| Wetgevingsdossier | — | **Nieuw:** `dossiernummer` (nullable, genormaliseerd). Verplicht bij wetsgeschiedenis, behalve bij `nota_van_toelichting` (identificatie via het Staatsbladnummer in de titel). |
| Tekststructuur | `document_chunks.structuur_type` / `structuur_label` (R1.1) | Hergebruik. Er komt geen nieuw chunkveld bij. |
| Audit | `withPlatform` (`platform_event_log`, twee fasen) + append-only `document_metadata_log` | Hergebruik, ongewijzigd. De nieuwe velden lopen mee in de bestaande diff. |

Niet toegevoegd, zoals de opdracht vraagt: publicatiekenmerk, behandelingsstatus, artikelregister, passage-identiteit, koppeltabel, juridische validatieworkflow, historische wetsversies, nieuw beheerscherm en nieuwe rol.

## 2. Gewijzigde en nieuwe bestanden

| Bestand | Reden |
|---|---|
| `supabase/migrations/2026_09_23_wetsgeschiedenis_a_light_foundation.sql` (nieuw) | Twee nullable kolommen, uitgebreide documenttype-CHECK, waarde-CHECKs op subtype en dossiernummer, en twee combinatie-CHECKs: juridische typen alleen generiek; wetsgeschiedenis ⇒ subtype + `informatief` + dossier (behalve bij `nota_van_toelichting`). |
| `supabase/rollbacks/2026_09_23_wetsgeschiedenis_a_light_foundation_ROLLBACK.sql` (nieuw) | Fail-closed rollback: weigert zolang er juridische documenten bestaan. |
| `supabase/checks/2026_09_23_wetsgeschiedenis_foundation.sql` (nieuw) | DB-invarianten W1–W10, waaronder W8 onder echte RLS en W10 voor de denormalisatie. |
| `scripts/cross-tenant-ci.sh` | Nieuwe check aangesloten, direct na T6 (generieke contentlaag). |
| `supabase/schema.sql` | Documentatie van de nieuwe kolommen en CHECKs. |
| `core/lib/wetsgeschiedenis.ts` (nieuw) | Pure domeinlogica: typen, subtypen, labels, dossiernormalisatie en -weergave, combinatievalidatie, duiding geldend recht vs. wetsgeschiedenis. |
| `core/lib/generiek-curatie-juridisch.ts` (nieuw) | `valideerGeneriekeCuratie`: wrapper om het ongewijzigde `valideerCuratie`. Zie afwijking A-2. |
| `core/lib/wetsgeschiedenis-structuur.ts` (nieuw, I-1 uitgebreid) | Pure, conservatieve structurering: algemeen deel, artikelsgewijze toelichting (artikel/onderdeel), amendement-wijziging/-toelichting. Levert `StructuurUnit` op en bewaart bij PDF's de deel-/artikelcontext over paginagrenzen. |
| `core/lib/wetsgeschiedenis.sanity.ts`, `core/lib/wetsgeschiedenis-structuur.sanity.ts` (nieuw) | 34 + 13 sanity-tests, met synthetische fixtures en een meerpagina-vervolg. |
| `core/lib/chunking.ts`, `core/lib/chunk-bouw.ts`, `core/lib/chunk-ingest.ts` (I-1) | Alleen bij `documenttype='wetsgeschiedenis'` en een geldig subtype wordt de parlementaire parser gebruikt. Voor onherkende opmaak blijft de generieke structuurdetectie de fallback. Vooraf bepaalde units worden zonder tweede interpretatie gechunkt. |
| `platform/lib/ingest-orchestrator.ts` (I-1) | De actuele asynchrone worker leest documenttype en subtype mee en geeft die aan de centrale chunkbouw. Paginanummers en bestaande bronlocaties blijven behouden. |
| `core/lib/reindex.ts`, generieke herindexeeractie en `platform/lib/generiek-pipeline.ts` (I-1) | Herindexering gebruikt dezelfde juridische structurering. Het oudere synchrone generieke pad accepteert dezelfde metadata voor gedragspariteit. |
| `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/acties.ts` | Leest de 4 velden in, valideert via de wrapper en neemt ze op in de bewerk-diff (auditspoor). `documenttype`/`wettelijk_regime` zijn `rag_impact`; subtype en dossier niet. |
| `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/_components/GeneriekeBibliotheekClient.tsx` | Velden Documenttype, Wettelijk regime en, bij wetsgeschiedenis, Soort stuk + Dossiernummer. Vooraf een melding met de vereisten. Normgewicht staat vast op Informatief bij wetsgeschiedenis. Type-/dossier-/regimeregel in de lijst. Een historisch fondstype op een bestaand generiek document blijft behouden. Statuslabels onderscheiden een actuele norm van een gepubliceerde informatieve bron. |
| `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/page.tsx` | Leest de 4 kolommen mee in. |
| `tests/karakterisering/__snapshots__/w4.documents-upload.get.bestuurder.json` | Bestaand GET-contract aangevuld met de twee nieuwe nullable kolommen. De eerste GitHub-run maakte dit verschil zichtbaar; overige responsvelden bleven gelijk. |

I-1 wijzigde het antwoordpad nog niet. R-1 doet dat bewust wel: na de bestaande
retrievalselectie leest `verrijkDocumentmetadata()` in één batch het subtype,
dossiernummer en rechtsregime uit `documenten`. Die waarden lopen door het publieke
retrievalcontract, de promptkop, bronkaart en het vaste auditspoor. `fn_chunk_denorm`,
de zoek-RPC's, ranking, Microsoft-, SharePoint-, OAuth-, tenant- en tokencode blijven
ongewijzigd. De antwoordpadgraaf groeide verklaarbaar met alleen de bestaande pure
module `wetsgeschiedenis.ts`; er kwam geen tabel- of RPC-lezer bij.

### 2a. R-2 — juridische vraagintentie, observe-only (#491)

**As-built keuze.** De classifier staat ín `core/lib/vraagtype.ts` (naast
`bepaalBronIntent`), niet in een nieuwe module. Daardoor groeit de bevroren
importgraaf van het antwoordpad niet: `retrieval-census.test.ts` blijft 11/11
zonder registerbijwerking (het register blijft op 171 bereikte bestanden).

| Onderdeel | Vorm |
|---|---|
| Type | `JuridischeVraagintentie = "geldend_recht" \| "bedoeling_totstandkoming" \| "geldend_recht_en_wetsgeschiedenis" \| "historische_peildatum" \| "onbekend"` |
| Resultaat | `JuridischeVraagintentieResultaat = { intentie, vertrouwen: "zeker" \| "onzeker", signalen: JuridischSignaal[] }` — `signalen` zijn gesloten categorieën (`juridisch_anker`, `zwak_anker`, `wetsgeschiedenisbron`, `bedoeling`, `normvraag`, `normonderwerp`, `peildatum`, `datum`, `fondscontext`), nooit gematchte tekst |
| Functie | `bepaalJuridischeVraagintentie(vraag: string): JuridischeVraagintentieResultaat` — puur, deterministisch, vaste NL-patronen, geen modelcall |
| Aanroep | `app/api/chat/route.ts`: `const juridischeIntentie = bepaalJuridischeVraagintentie(effectieveVraag);` direct ná de afleiding van `effectieveVraag` (contextresolver), exact één keer per beurt |
| Audit | `retrieval_meta.invoer.juridische_intentie` in alle vier de `schrijf_ai_interactie`-regels (antwoord, vergelijking, vergelijkingsverduidelijking, bronintentie-verduidelijking) |

Beslisvolgorde: historische peildatum → bedoeling/wetsgeschiedenis + normvraag
(`geldend_recht_en_wetsgeschiedenis`) → bedoeling/wetsgeschiedenis → juridisch
anker (+ normvraag = zeker, zonder = onzeker) → ankerloze normvraag met
normonderwerp zoals "termijn" (`geldend_recht`, onzeker) → `onbekend` (onzeker).
Een STERK anker (wet-/regelgevingsnaam, wetgever, wettelijk, parlementair stuk)
telt ook met fondscontext; een ZWAK anker ("artikel 5") alleen zónder fonds-,
document- of procedurecontext. "Toelichten", "geldt" en "vergelijk" maken een
vraag nooit zelfstandig juridisch.

**Waarom `invoer` en geen nieuwe topsleutel.** Een nieuwe topsleutel in
`retrieval_meta` vereist zowel `META_BASIS` in `core/lib/audit-meta.ts` als
`c_basis` in `public.meta_projectie()` — dat is een migratie (zie de
pariteitsgate in `retrieval-toelatingspoort.test.ts`). `invoer` staat al op
basisniveau in beide allowlists en de SQL-projectie filtert daarbinnen alleen
`historie_hash`; een nieuwe subsleutel is dus migratievrij op beide leesniveaus
zichtbaar. Dit volgt het precedent van `invoer.geen_generatiecall` (Plateau 1).

**Observe-only.** `juridischeIntentie` komt in de route uitsluitend voor als
declaratie en als auditwaarde. Geen filter, ranking, selectie, promptblok,
bronkaart of antwoordtekst leest haar; de toon-systeemprompt en de sha256-pin in
`generatie-kern.sanity.ts` zijn ongewijzigd. `historische_peildatum` wordt apart
herkend, maar nog niet gerouteerd of beantwoord (de actuele wet wordt dus ook
niet als historisch antwoord gepresenteerd).

**Aansluitpunt R-3 (#492).** Gebruik de bestaande variabele `juridischeIntentie`
in `app/api/chat/route.ts`; bereken niet opnieuw. Werk dan tegelijk de negatieve
observe-only-test `R2-A3` in `tests/cross-tenant/juridische-vraagintentie-route.test.ts`
bewust bij, want die telt precies één declaratie plus vier auditregels.

## 3. Migratie en deployvolgorde

De Microsoft-release is geland; de rebase en volledige lokale hertest zijn afgerond. Stappen 1–4 zijn uitgevoerd; stap 5 blijft de harde Preview-begrenzing en stap 6 is nog niet uitgevoerd.

1. Vlak voor uitrol controleren dat `origin/preview` nog op de geteste basis staat of alleen verwachte aanvullingen bevat. De rebase op `5b0f581` gaf geen conflict of objectoverlap met `documenten_documenttype_check` of `fn_chunk_denorm`.
2. **Preview-DB (`portal_preview`)**: eerst de controlequery uit de migratie (moet 0 zijn), dan de migratie `2026_09_23_wetsgeschiedenis_a_light_foundation.sql`.
3. Tegen Preview: `supabase/checks/2026_07_31_r1_structurele_gates.sql` en de V3-grants-gate. Er is geen nieuw object en geen grantwijziging, dus de allowlist hoeft niet te veranderen. Controleer dat.
4. Pas daarna: merge van de PR naar `preview` → Preview-deploy. De UI biedt de nieuwe waarden aan; zonder migratie falen de select en de insert.
5. **Geen documentupload, vervanging of import op Preview.** De Preview-antivirusscanner werkt niet en valt bewust buiten deze opdracht. De Preview-smoke blijft daarom beperkt tot schema, rechten, bestaande data en de weergave/validatie van metadata; de upload- en ingestketen wordt daar niet beproefd.
6. Productie alleen via de reguliere promotie (akkoord opdrachtgever) en in dezelfde volgorde: eerst de migratie op `portal_production`, dan de code. De documentimport gebeurt pas daarna op Productie, waar de scanner werkt: eerst een canary van twee representatieve documenten, controle op scan, extractie, chunking, metadata en vindbaarheid, en pas dan de rest van de batch.

Rollback: eerst juridische documenten herclassificeren of verwijderen via de curatie, dan het rollbackscript. Het script weigert anders.

### 3a. Preview-databasebewijs — 28-09-2026

| Onderdeel | Uitkomst |
|---|---|
| Doel | `portal_preview` / Supabase `bestuurdersportaal-preview` (`swviwoytzvaqypieqgji`), status `ACTIVE_HEALTHY` |
| Geteste PR-head | `e1bbdb2` — alle GitHub- en Vercelchecks groen |
| Preflight | 11 documenten; 0 juridische documenten; beide nieuwe kolommen en de vier nieuwe constraints afwezig |
| Toepassing | `wetsgeschiedenis_a_light_foundation`, Supabase-migratieversie `20260928192012` |
| Postcheck | Nog steeds 11 documenten; 2 nullable tekstkolommen en 5 gevalideerde CHECKs aanwezig; 0 juridische documenten en 0 rijen met nieuwe metadata |
| Gedrags- en securitychecks | W1–W10 groen; R1 structurele gates groen; V3 grants-gate groen |
| Supabase Advisors | Gedraaid. Bestaande projectbrede meldingen blijven staan; deze migratie voegt geen tabel, functie, policy of grant toe en introduceerde geen nieuwe objectmelding. |
| Bewuste begrenzing | Geen documentupload, vervanging of import; geen Storage-mutatie; Productie niet geraakt |

### 3b. Preview metadata-UI-smoke — 29-09-2026

Uitgevoerd op `beheer.preview.bestuurdersportaal.com` met een actieve
platformidentiteit en live AAL2. De Preview-markering en alle 15 toegekende
capabilities waren zichtbaar. De generieke bibliotheek was leeg; er is geen
document geüpload, vervangen, geïmporteerd of opgeslagen.

- `Wetgeving (actuele geconsolideerde tekst)` en `Wetsgeschiedenis` zijn als
  documenttype beschikbaar.
- Wetsgeschiedenis toont alle zes subtypen, inclusief `Memorie van antwoord` en
  `Nota van toelichting (AMvB)`.
- `Nota van toelichting (AMvB)` maakt uitsluitend voor dat subtype het
  dossiernummer optioneel; terugschakelen naar `Memorie van antwoord` maakt het
  dossiernummer weer verplicht.
- Wetsgeschiedenis forceert en vergrendelt normgewicht `Informatief` en toont
  `Publicatiestatus` met `Gepubliceerd (actieve, informatieve bron)`.
- Wetgeving toont afzonderlijk `Geldigheidsstatus` met `Van kracht (actuele
  norm)` en laat een bindend normgewicht kiezen.
- Het formulier is geannuleerd zonder serveractie; de bibliotheek bleef leeg.

De upload-, scan- en ingestketen is bewust niet getest, conform §3.

## 4. Uitgevoerde tests (lokaal, 23, 28 en 29-09-2026)

| Test | Resultaat |
|---|---|
| `tsc --noEmit --skipLibCheck` | exit 0 |
| `npm run sanity` (alle suites, incl. 2 nieuwe) | groen: "Alle resterende sanity-suites groen." |
| `core/lib/wetsgeschiedenis.sanity.ts` | 34/34, inclusief de statuslabelregressie |
| `core/lib/wetsgeschiedenis-structuur.sanity.ts` | 13/13; inclusief contextbehoud over PDF-paginagrenzen |
| `core/lib/chunk-bouw.sanity.ts` | 7/7; inclusief MvT, aangenomen amendement en generieke fallback |
| `npm run test:unit` | groen; Vitest 8 suites en 151/151 tests |
| `core/lib/generiek-curatie.sanity.ts` (regressie) | 10/10 |
| `tests/cross-tenant/retrieval-census.test.ts` | 11/11 (zie afwijking A-2) |
| `bash scripts/cross-tenant-ci.sh` volledig, lokale ephemere Supabase (CLI 2.114.0), migraties uit de repo | GROEN (exit 0), zie §4a |
| W1–W10 (nieuwe DB-check) | alle `OK` |
| eslint op gewijzigde bestanden, `lint:boundaries`, `lint:quality:check`, `lint:colors` | groen / baseline groen |
| `scripts/check-migratie-mapindeling.sh` | OK |
| Negatieve controle, idempotentie, rollback | groen, zie §4a |

Voor I-1 is bewust geen live upload- of ingestsmoke uitgevoerd: de
Preview-antivirusscanner werkt niet en valt buiten scope. De testbasis is daarom
synthetisch en lokaal. De metadata-UI-smoke van de foundation is wel uitgevoerd;
zie §3b. Productie, Microsoft en SharePoint zijn voor I-1 niet geraakt.

### 4a. Volledige suite, negatieve controle en idempotentie

- **Hertest na A-7 (MvA/NvT, 23-09-2026)**: alle onderstaande controles opnieuw gedraaid op een verse lokale DB, met dezelfde uitkomst; sanity 33 + 12.
- **Volledige §15-suite na rebase (28-09-2026)** (`TEST_DATABASE_URL` = lokale stack, verse DB): `GROEN: volledige §15 cross-tenant suite geslaagd (app-laag + DB-laag)`. App-laag: 1097/1097. DB-laag inclusief W1–W10, de Microsoft-checks, de R1-structurele gates en de V3-grants-gate (geen allowlistwijziging nodig). De ROL-1-rolverklaring van de nieuwe check is groen.
- **GitHub-karakterisering:** de eerste PR-run vond exact één verwacht contractsverschil in `w4.documents-upload.get.bestuurder`: de twee nieuwe nullable documentkolommen ontbraken in het bevroren snapshot. Het snapshot is alleen met die twee `null`-velden aangevuld; dezelfde PR-gate bewaakt alle overige responsvelden.
- **Negatieve controle** (in een teruggerolde transactie):
  - zonder `documenten_wetsgeschiedenis_combinatie_check` → `LEK W2: wetsgeschiedenis met normgewicht bindend aanvaard` (rood, zoals bedoeld);
  - zonder `documenten_juridisch_generiek_check` → `LEK W7: fondsdocument als wetgeving geclassificeerd` (rood, zoals bedoeld).
  - met een te ruime dossier-uitzondering (dossier optioneel voor álle subtypen) → `LEK W3: wetsgeschiedenis zonder dossiernummer aanvaard` (rood, zoals bedoeld).
- **Idempotentie**: de migratie tweemaal toegepast gaf exit 0.
- **Rollback**: met een juridisch document geweigerd (`Rollback geweigerd: 1 document(en)…`). Op een lege set: exit 0, beide kolommen weg. Opnieuw toepassen gaf exit 0; W1–W10 daarna 10× `OK`.
- De eerste suite-run was rood op `retrieval-census.test.ts` (134 → 136 bestanden in de antwoordpadgraaf). Dat is verholpen door afwijking A-2; zie §5.

### 4b. R-2 — tests (29-09-2026, lokaal)

| Test | Resultaat |
|---|---|
| `core/lib/vraagtype.test.ts` | 109/109 (80 bestaand + 29 nieuwe `R-2`-cases: de zeven issuevoorbeelden, varianten/meervouden, 14 negatieven, determinisme, inhoudsarmheid, peildatum apart, bestaande classificatie ongewijzigd) |
| `scripts/verify-vitest-parity.mjs` | pin bijgewerkt: 80 → 109, nieuwe titel-sha256. De gesorteerde sha256 van de 80 bestaande titels is nog steeds de nulmeting `048ae929…cd0` |
| `tests/cross-tenant/juridische-vraagintentie-route.test.ts` (nieuw) | 7/7: één aanroep op de effectieve vraag, ná de resolver en vóór elk auditspoor; observe-only (R2-A3/A4, mutatiecontrole rood bij promptgebruik); opgeloste vervolgvraag = directe vraag; audit op basisniveau en SQL-projectie migratievrij |
| `retrieval-census.test.ts` | 11/11, geen registerbijwerking |
| `generatie-kern.sanity.ts` | groen; sha256-pin van de systeemprompt niet gekanteld |
| overige: tsc, `npm run sanity`, `npm run test:unit`, eslint, volledige §15-suite, `npm run build` | zie de PR-beschrijving |

## 5. Bewuste afwijkingen en open punten

- **A-1 — regime via `wettelijk_regime`, niet via `toepassingsgebied`.** De instructie noemt `toepassingsgebied` voor PW/Wvb/beide. In de code is dat een inert vrije-tekstveld. Het echte, gecontroleerde en al gedenormaliseerde regimefacet is `wettelijk_regime` (T4). Dat stond nog niet in het curatieformulier en is nu toegevoegd: optioneel voor gewone generieke documenten, verplicht (`pw|wvb|beide`) voor juridische typen. Gevolg: bij `REGIME_WEGING` aan kan een gecureerd regime het bestaande demotiegedrag voeden. Dat is bestaand retrievalgedrag op data; er is geen codewijziging.
- **A-2 — juridische validatie in een wrapper, niet in `generiek-curatie.ts`.** De eerste versie breidde `valideerCuratie` uit. Daarmee groeide de bevroren importgraaf van het antwoordpad van 134 naar 136 bestanden (`retrieval-census.test.ts` rood), omdat `rag.ts` die module importeert. Dat is een raakvlak met de retrieval-release. Daarom staat de logica nu in `generiek-curatie-juridisch.ts` en blijft `generiek-curatie.ts` byte-identiek. Post-release kan dit worden samengevoegd, met een bewuste regeneratie van het census-register.
- **A-3 — extra servereisen voor juridische typen:** een officiële URL (beide typen), plus documentdatum en dossiernummer in de titel (wetsgeschiedenis), of het Staatsbladnummer in de titel (nota van toelichting). Dit volgt uit de werkticket-eisen "kamerstuknummer, datum, officiële link". Alleen de app-laag dwingt dit af; de DB niet.
- **A-4 — OPGELOST zonder extra denormalisatie (R-1, 29-09-2026).** Subtype, dossiernummer en rechtsregime worden na selectie in dezelfde bestaande batch uit `documenten` verrijkt. Daardoor zijn zij beschikbaar voor prompt, bronweergave en audit zonder `document_chunks`, `fn_chunk_denorm`, trigger of zoek-RPC te wijzigen. Het documenttype stond al op de chunk.
- **A-5 — geen type-/subtypefilter in de bibliotheeklijst.** Het werkticket noemt filters; de agentinstructie vraagt invoeren, tonen, wijzigen en auditen. De lijst toont type, dossier en regime per document. Een filter is een kleine post-releaseaanvulling (B-1).
- **A-6 — dossiernummerformaat.** Opslag: 3–6 cijfers, optioneel `-SUFFIX` (bv. `36200-XV`). Aanname: dit dekt de pilotdossiers. Controleer het tegen de broncuratielijst vóór de import.
- **A-7 — OPGELOST (besluit opdrachtgever 23-09-2026).** Subtypen `memorie_van_antwoord` (ook voor een nadere memorie van antwoord; het onderscheid staat in de titel) en `nota_van_toelichting` zijn toegevoegd aan de bestaande foundationmigratie. Die was nog nergens uitgevoerd of gepusht, dus er is geen tweede migratie nodig. Dossiernummer is alleen optioneel bij `nota_van_toelichting`; dan moet het Staatsbladnummer in de titel staan (servervalidatie) en is de officiële URL verplicht. Beide subtypen zijn `wetsgeschiedenis` met `normgewicht = informatief` (app én DB). Bijgewerkt: CHECKs, servervalidatie, UI-opties en -hint, schema.sql, sanity-tests en DB-check W3. Audit loopt ongewijzigd mee via de bestaande diff. Oorspronkelijke bevinding: De broninventaris §3.2/§3.4 noemt P0-stukken die geen van de vier subtypen zijn:
  - *Memorie van antwoord* en *nadere memorie van antwoord* (EK, 36 067 H en K);
  - *Nota van toelichting* bij het Besluit toekomst pensioenen (Stb. 2023, 217) en bij het Besluit transitietermijnen (Stb. 2025, 423). Deze stukken hebben bovendien geen Kamerstukdossier, terwijl de foundation bij wetsgeschiedenis een dossiernummer (en dat nummer in de titel) verplicht stelt.

  De *nota naar aanleiding van het nader verslag* (36 067 nr. 11) valt onder `nota_naar_aanleiding_van_het_verslag`. De aanvankelijk voorgestelde uitbreiding met `memorie_van_antwoord` en `nota_van_toelichting` is na het besluit van de opdrachtgever in dezelfde foundationmigratie verwerkt.
- **A-8 — OPGELOST.** §8 van de broninventaris is bijgewerkt: `publication_reference` staat in `titel`, `legal_status` via `status`/`bronstatus`, `amendment_status` via subtype `aangenomen_amendement`, `dossier_number` verplicht behalve bij `nota_van_toelichting`. Oorspronkelijke bevinding: broninventaris §8 week af van het werkticket. De inventaris noemt metadatavelden `publication_reference`, `legal_status` en `amendment_status`. Het werkticket (leidend) en deze foundation voegen die bewust níet toe: de verwijzing staat in de titel, aangenomen = subtype, en de statuscontrole hoort in de broncuratielijst. Werk bij een volgende versie van de inventaris §8 bij, zodat die niet als eis wordt gelezen.
- **A-9 — OPGELOST (28-09-2026).** De generieke toestandsmachine bewaart een gepubliceerde bron technisch als `status='van_kracht'`. Dat blijft bewust ongewijzigd, maar de curatie-UI toont bij wetsgeschiedenis nu `Publicatiestatus` en `Gepubliceerd (actieve, informatieve bron)`. Alleen wetgeving toont `Geldigheidsstatus` en `Van kracht (actuele norm)`. Een regressietest voorkomt dat "van kracht" terugkeert als zichtbaar label voor wetsgeschiedenis.

## 6. Raakvlakken met de Microsoft-release

| Raakvlak | Aard | Beheersing |
|---|---|---|
| `scripts/cross-tenant-ci.sh` | Gedeeld bestand; de release heeft checks toegevoegd | Rebase was conflictvrij; de wetsgeschiedenischeck staat na T6 en de Microsoft-checks zijn behouden. Volledige suite groen. |
| `supabase/schema.sql` | Gedeelde documentatie | Alleen het `documenten`-blok; kans op een tekstueel conflict is klein. |
| Migratievolgorde | Onze datum 2026-09-23, naast `2026_09_23_434_adapterstand_fonds.sql` | Geen objectoverlap (alleen `documenten`-CHECKs en -kolommen). Bij een rebase de volgorde controleren. |
| Importgraaf antwoordpad (census) | R-1 voegt de bestaande pure juridische-duidingsmodule toe | Register bewust van 170 naar 171 bereikte bestanden; lezingen, tabelclassificatie en retrievalingangen ongewijzigd. R-2 voegt geen module toe (classifier in `vraagtype.ts`): register ongewijzigd. |
| `document_chunks` / `fn_chunk_denorm` | Niet gewijzigd | R-1 haalt de aanvullende metadata na selectie in één batch uit `documenten`; geen migratie nodig. |

R-1 raakt gericht `app/api/chat/route.ts`, `core/lib/rag.ts` en `core/lib/retrieval/*` om
metadata te projecteren. Selectie, ranking en RPC's blijven inhoudelijk gelijk. Er is
geen overlap met Microsoft-, SharePoint-, OAuth-, tenant- of tokencode.

## 7. Volgende fasen

| # | Stap | Verwachte bestanden | Tests |
|---|---|---|---|
| R-0 | **Afgerond:** Preview-database, merge/deploy en metadata-UI-smoke volgens §3 zijn groen | — | Preview-preflight, W1–W10, R1 en V3 groen; visuele metadata-smoke 29-09-2026 groen |
| I-1 | **Afgerond en op Preview:** `structureerParlementairStuk` / `alsStructuurUnits` zijn aangesloten op de actuele worker, centrale chunkbouw en herindexering voor `documenttype='wetsgeschiedenis'` | chunking/chunk-bouw/chunk-ingest, worker, reindex en generiek pad | MvT/amendement/fallback/meerdere pagina's groen; census 11/11 |
| I-2 | Actuele PW/Wvb opnemen (BWB-id in de titel/URL); max. één actieve versie per wet via `curatieVervangen`; Wtp-Staatsblad-pdf's herclassificeren | curatiehandeling (data), eventueel een DB-check "één actieve wetgeving per regime + titel-BWB" | DB-check + Preview-controle |
| R-1 | **Afgerond en op Preview via PR #489:** documenttype, subtype, dossiernummer, normgewicht en rechtsregime lopen door naar prompt, bronkaart en audit; na-selectie batchverrijking, dus geen migratie/denormalisatie | `rag.ts`, retrievalcontract/citatie/meta, assistant-source, bronkaart | identiteit 14/14, prompt-/bronlijst-sanities groen; censusregister verklaarbaar +1 bestand en 11/11 groen; post-mergechecks en beide deploys groen |
| R-2 | **In PR (#491):** observe-only juridische vraagintentie op de effectieve vraag, vastgelegd onder `retrieval_meta.invoer.juridische_intentie`; zie §2a | `core/lib/vraagtype.ts`, `core/lib/rag.ts` (type), `app/api/chat/route.ts` | `vraagtype.test.ts` 109/109 + pariteitspin; `juridische-vraagintentie-route.test.ts` 7/7; census ongewijzigd |
| R-3 | **Open (#492):** ranking/routing: actuele wet vóór wetsgeschiedenis bij normatieve vragen; wetsgeschiedenis alleen aanvullend. Sluit aan op `juridischeIntentie` in de chatroute (niet opnieuw berekenen) en past `R2-A3` bewust aan | `core/lib/rag.ts`, `core/lib/retrieval/selectie.ts`, `app/api/chat/route.ts` | retrievalregressies + nieuwe evalcases |
| A-1 | **Afgerond binnen R-1:** prompt schrijft voor dat de normatieve conclusie eerst uit geldend recht komt en wetsgeschiedenis alleen uitleg/achtergrond geeft; ook een aangenomen amendement is geen zelfstandige actuele norm | `generatie-kern.ts` | `generatie-kern.sanity.ts` |
| V-1 | Afzonderlijke vergelijkingscall: juridische metadata en rol meenemen in vergelijking/audit; expliciet gekozen historische documenten niet door een impliciet `actueel`-filter verwijderen; norm en toelichting nooit als gelijkwaardig bindend presenteren | `app/api/vergelijk/route.ts`, `core/lib/vergelijk-productie.ts`, `core/lib/vergelijk-kern.ts` | `retrieval-productiepaden.test.ts`, `retrieval-evidence-contract.test.ts`, vergelijkingsgoldens |
| B-1 | **Bronweergave afgerond binnen R-1:** bronkaarten tonen geldend recht versus wetsgeschiedenis/geen norm, plus dossier en regime. Alleen het type-/subtypefilter in de bibliotheek staat nog open. | `AntwoordWeergave.tsx`, `assistant-source.ts`; later `GeneriekeBibliotheekClient.tsx` | bronlijst-/assistant-source-sanities groen; filtertest volgt |
| W-1 | Live web: `officielebekendmakingen.nl` `kst-*` niet bindend via de whitelist | `core/lib/web-whitelist.ts`, `web-retrieval.ts` | `web-whitelist.sanity.ts`, `web-retrieval.test.ts` |
| E-1 | Evaluatieset (werkticket PR 4) + Preview-pilot met bron- en antwoordcontrole | `evals/…` | evalrun op Preview |

## 8. Bevestiging

De foundationmigratie is uitsluitend op de Preview-database toegepast en structureel groen bevonden. Foundation, I-1 en R-1 draaien op de vaste Preview-hosts; R-1 vergde geen migratie. Er is geen document geüpload, vervangen of geïmporteerd; Productie is niet gewijzigd. Door de defecte Preview-antivirusscanner blijft de eerste echte bronimport een gecontroleerde Productiestap na de reguliere promotie. R-2 staat in een PR naar `preview` (observe-only, geen migratie). R-3, de afzonderlijke vergelijkingscall V-1, de bibliotheekfilter, webclassificatie en evaluatie blijven open.
