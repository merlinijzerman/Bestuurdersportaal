# Handover — wetsgeschiedenis A-light (foundation + I-1 structuur-ingest + R-1 bronduiding + R-2 vraagintentie)

| Veld | Waarde |
|---|---|
| **Branch** | `codex/wetsgeschiedenis-retrieval-metadata` |
| **Worktree** | `…/MVP bestuurdersportaal/mvp-wetsgeschiedenis-structure-ingest` |
| **Basis** | `origin/preview` @ `861f45d` (29-09-2026), inclusief de gemergde foundation en I-1. |
| **Functionele bron** | `WERKTICKET-WETSGESCHIEDENIS-A-LIGHT.md` en `BRONINVENTARIS-WETGEVING-EN-WETSGESCHIEDENIS-A-LIGHT.md` (in deze branch, aparte documentatiecommit). De tijdelijke agentinstructie blijft bewust buiten de PR: die bevat release-specifieke uitvoeringsafspraken. |
| **Status** | Foundation, I-1 en R-1 staan op Preview. R-1 is via PR #489 gemerged als `580304f`; alle post-mergechecks en beide vaste Preview-deployments zijn groen. Niets geïmporteerd en Productie niet gewijzigd. |
| **R-2 (#491)** | Branch `codex/491-juridische-vraagintentie` vanaf `origin/preview` @ `e71a049`, één PR naar `preview`. Observe-only juridische vraagintentie; geen migratie, geen gedragswijziging. Zie §2a. |
| **R-3 (#492)** | Branch `codex/492-juridische-routing` vanaf `origin/preview` @ `bdb92b1` (incl. R-2, PR #494), één PR naar `preview`. Centraal juridisch bronbeleid in de selectie + juridische antwoordgrens; geen migratie, geen RPC-, RLS- of grantwijziging. Zie §2b. |
| **#500** | Branch `codex/500-artikelpassage-boost` vanaf `origin/preview` @ `7c6c8a8`, één PR naar `preview`. Exacte artikelpassage: gericht kandidatenspoor binnen de bestaande RPC-filters + deterministische boost vóór het R-3-beleid; geen migratie. Zie §2c. |

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

### 2b. R-3 — actuele wet vóór wetsgeschiedenis (#492)

**As-built.** Eén pure, providerneutrale module `core/lib/retrieval/juridisch-beleid.ts`,
aangeroepen vanuit de centrale selectie (`selectie.ts` → `weegEnSelecteer`). Er is
geen route-specifieke kopie: de chatroute geeft alleen de al bepaalde
`juridischeIntentie` door.

| Onderdeel | Vorm |
|---|---|
| Doorgifte | `SelectiegrenzenPerQuery.juridischeIntentie` (orkestratie) → `selecteerEnVerrijk(…, { juridischeIntentie })`. De route zet haar alleen op de **bibliotheeksporen** (`grenzenBibliotheek` voor het ongescopete primaire spoor en de grenzen van het aanvullende spoor). Een bewust gekozen document (`primair_portaal`) of SharePoint-bron blijft ongemoeid, net als bij de actualiteitsfilter. |
| Rol van een kandidaat | `documenttype` + `wetsgeschiedenis_subtype` via de bestaande `juridischeDuiding()` (`wetsgeschiedenis.ts`). Beide velden staan op het selectiemoment al op `Bronresultaat.weergave`: `verrijkDocumentmetadata()` draait op het orkestratiepad in de adapterhook `verrijkKandidaten()` (fase 3, vóór poort en selectie, #426 D-6). **Subtype is dus beschikbaar zonder migratie of denormalisatie.** Een aangenomen amendement heeft de rol wetsgeschiedenis. Een adapter zonder documenttype (SharePoint, web) heeft geen juridische rol en houdt het bestaande gedrag. |
| Poort (review punt 1 + PR-review #496) | Eén gedeelde functie `bepaalJuridischBeleid()` stuurt zowel de selectie als de antwoordgrens/inline-melding. Poortregel per intentie: **`historische_peildatum`** opent UITSLUITEND bij `juridisch_anker` of bij `zwak_anker` zonder `fondscontext` (vertrouwen `zeker` alleen is niet genoeg, want R-2 geeft `zeker` al op een losse datum); **`geldend_recht`, `bedoeling_totstandkoming`, `geldend_recht_en_wetsgeschiedenis`** openen bij `juridisch_anker`, `zwak_anker` zonder `fondscontext`, óf vertrouwen `zeker`. Anders `null` = exact het gedrag van `onbekend` (geen melding, selectie byte-identiek). Voorbeelden poort dicht: "Welke afspraak gold op 1 januari 2022?" (peildatum/zeker, geen anker), "Wat gold er in de vorige vergadering?", "Welke afspraak gold vorig jaar?", "Welke termijn geldt voor een waardeoverdracht?". Poort open: "Wat gold op 1 januari 2022 volgens de Pensioenwet?", "Wat bepaalde artikel 150d Pensioenwet in 2021?" → uitsluiting actuele wet + melding. |
| Volgorde in de selectie | zwak-generiekfilter → bronsoortweging → regime-demotie → **juridisch beleid** → constraints/dedup/budget. De door het regime gedemoveerde bronnen (PW↔Wvb) zijn voor het juridisch beleid **vast**: zij houden hun plek onderaan, dus het beleid kan de regimeweging niet omzeilen. |

Beleid per intentie (alleen de plekken die juridische kandidaten al innamen worden
opnieuw gevuld; fonds- en niet-juridische generieke bronnen houden hun relatieve
volgorde):

| Intentie | Beleid |
|---|---|
| `geldend_recht` | Wetgeving vult de juridische plekken; wetsgeschiedenis gaat naar de staart. Is er géén wetspassage, dan verandert de volgorde niet en meldt de antwoordgrens `geen_actuele_normbasis` (bij wetsgeschiedenis, of bij een zekere normvraag ook zonder juridische bronnen — hotfix 29-09). Een niet-juridische bron zakt nooit. |
| `bedoeling_totstandkoming` | Beste wetspassage en beste wetsgeschiedenis **aaneen** op de eerste juridische plek (wet eerst); de rest in oorspronkelijke volgorde. Een niet-juridische bron zakt hoogstens één plek. |
| `geldend_recht_en_wetsgeschiedenis` | Idem kop (representatie voor beide rollen, wet eerst); daarna overige wetgeving vóór overige wetsgeschiedenis. |
| `historische_peildatum` | Actuele wetgeving wordt **uitgesloten** (ook een regime-gedemoveerde); wetsgeschiedenis blijft. Antwoordgrens `historische_wetsversie_niet_beschikbaar`, altijd (ook zonder treffers). |
| `onbekend` / poort dicht | Byte-identiek aan vóór R-3: dezelfde volgorde, dezelfde `selectie`-diagnostiek, geen nieuwe sleutels. |

**Antwoordgrens.** `juridischeAntwoordgrens(intentie, geselecteerd)` (zelfde poort)
levert gesloten typen die als bestaande inline-meldingen (`InlineMeldingType` +
vaste teksten in `vraagtype.ts`, `juridischeInlineMelding()`) in zowel de pre-stream-
als de finale meldingen van de chatroute komen, en daarmee in
`retrieval_meta.inline_meldingen`. De toon-systeemprompt en de sha256-pin in
`generatie-kern.sanity.ts` zijn **ongewijzigd**; de R-1-promptregel en -labels
blijven de modelinstructie ("wetsgeschiedenis is geen norm").

**Hotfix normbasis (29-09-2026, na de Preview-smoke).** De smoke toonde een
acceptatiegat: "Wat bepaalt artikel 150d Pensioenwet?" gaf vóór de bronimport
alleen "Geen relevante fondsdocumenten gevonden", omdat `geen_actuele_normbasis`
alleen volgde als er wél wetsgeschiedenis maar géén actuele wet was geselecteerd.
Nu geldt: zonder geselecteerde actuele wetspassage meldt de grens
`geen_actuele_normbasis` wanneer (a) er wetsgeschiedenis is geselecteerd, óf
(b) de intentie **zeker normatief** is (`geldend_recht` /
`geldend_recht_en_wetsgeschiedenis` met vertrouwen `zeker`) — ook bij nul
juridische bronnen. De eis `zeker` in tak (b) voorkomt ruis bij een onzekere
juridische vraag met fondscontext ("de Wtp-transitie voor ons fonds").
Bedoelings-, peildatum- en niet-juridische vragen zijn ongewijzigd; de selectie
zelf verandert niet. De meldingstekst verwijst niet langer naar "de
geraadpleegde wetsgeschiedenis", zodat zij ook zonder bronnen klopt. Test
R3-S2b (nul bronnen, alleen fondsbronnen, onzekere en niet-juridische
negatieven); R3-S2 (alleen wetsgeschiedenis) blijft groen; terugzetten naar de
oude conditie maakt R3-S2b rood.

**Diagnostiek (migratievrij).** Alleen als een beleid is toegepast:
`selectie.juridisch = { beleid, poort, kandidaten: {wetgeving, wetsgeschiedenis},
geselecteerd: {…}, gedemoveerd, uitgesloten }` (gesloten enums en tellingen),
`selectie.afgevallen_telling.juridisch_gedemoveerd|juridisch_uitgesloten`, en per
kandidaat in `selectie_kandidaten[].reden` de waarden `juridisch_gedemoveerd`
(valt alleen door het beleid af; contrafeitelijke selectie zonder beleid) of
`juridisch_uitgesloten`. `selectie` staat al op basisniveau in `META_BASIS` en in
`c_basis` van `meta_projectie()`, die het object als geheel doorlaat; geen
migratie. Zoals voor alle selectiediagnostiek beschrijft `selectie` het eerste
spoor.

**Census.** De nieuwe module vergroot de importgraaf van het antwoordpad
verklaarbaar van 171 naar 172 bestanden (`retrieval-contextbronnen.expected.json`,
alleen `bereikte_bestanden`); lezingen, tabelclassificatie en retrievalingangen
zijn ongewijzigd. `R2-A3` is bewust bijgewerkt: naast declaratie + vier
auditwaarden zijn precies drie doorgiftes aan de centrale juridische laag
toegestaan; elk ander gebruik (routefilter, promptblok, bronkaart) blijft rood.

### 2c. #500 — exacte artikelpassage in juridische retrieval

**Faalplek (gemeten tegen code en een lokale PG17).** De passage
"Artikelsgewijze toelichting — Artikel 150d" (MvT Wtp, p. 395) viel al vóór de
selectie weg: zij kwam niet in de kandidatenset van `zoek_chunks_hybride`.
`websearch_to_tsquery('dutch', …)` maakt van de bedoelingsvraag
`'bedoel' & 'wetgever' & 'artikel' & '150d' & 'pensioenwet'`; de artikeltekst
bevat 'bedoel'/'wetgever' niet (`@@` = false), en van de gecombineerde vraag een
AND-keten van tien termen (ook false). De vectorarm neemt de top-40 over alle
chunks (2.738 uit hetzelfde document) en is ongevoelig voor een artikelnummer;
daarna kapt `p_limit` (kandidatenpool 30) de fusie af. Een boost alleen in de
selectie had dus niets opgelost.

**Oplossing (geen migratie, geen RPC-, RLS- of grantwijziging).**

| Onderdeel | Vorm |
|---|---|
| Herkenning + poort | Nieuwe pure module `core/lib/retrieval/artikelverwijzing.ts`: `herkenArtikelnummers` ("artikel/art./artikelen 150d en 150e"), `herkenWet` (Pensioenwet → pw, Wvb → wvb), `bepaalArtikelfocus`. Poort = R-3-beleid van toepassing **én** signaal `juridisch_anker` of `zwak_anker` zonder `fondscontext`; vertrouwen `zeker` alleen telt niet. Nummers exact na normalisatie: 150 ≠ 150d ≠ 1500. |
| Doorgifte | `orkestratie.ts` berekent de focus per spoor uit `zoekvraag` + `origineleVraag`, alleen op sporen met `grenzen.juridischeIntentie` (de bibliotheeksporen). Alleen dan krijgt de adapter `RetrievalQuery.artikelfocus` (optioneel contractveld); anders exact dezelfde query-referentie. |
| Gericht kandidatenspoor (Supabase) | `rag.ts` `vulAanMetArtikelkandidaten`, aangeroepen in `supabase-adapter.ts` direct na de ranking. (1) Opzoeking onder RLS, **begrensd** (hotfix, zie hieronder): eerst `documenten` met `documenttype` wetgeving/wetsgeschiedenis en `actief` (binnen de scope, ≤ 200), daarna `document_chunks` alleen binnen die `document_id`'s, label of tekstbegin **exact in de database** via PostgREST `imatch` (`~*`) met woordgrens (`(^\|[^a-z])artikel +N([^0-9a-z]\|$)` resp. `^(artikel\|art[.]?) +N(…)`), zodat buurlabels (150, 150a–z, 1500 bij artikel 15) de passage niet uit de limiet van 50 drukken (reviewpunt PR #501); `artikelmatch` is de tweede grens. (2) Toelating: een **id-begrensde** opvraging `document_chunks?id=in.(…)` onder RLS met expliciet de `zoek_chunks`-semantiek en dezelfde frasevoorwaarde `"artikel N" OR "art N"` (`retrieval/artikeltoelating.ts`), gevolgd door `handhaafFondsdiscipline`. (3) Binnen `maxKandidaten`: nieuwe exacte passages vervangen de zwakste niet-exacte staart. Fail-open bij een fout (afbreking gaat door). |
| Boost | `selectie.ts`: ná bronsoort- en regimeweging, vóór het R-3-beleid zet `boostArtikelpassages` per document de beste exacte **juridische** passage vooraan (kopregel wint van label; max 3). Fondsdocumenten en niet-juridische bronnen nooit; regime-gedemoveerde bronnen blijven vast; een tegengesteld regime of een wettekst waarvan de titel de genoemde wet niet noemt, wordt niet geboost. R-3 bepaalt daarna de rollen: normvraag → wet vóór toelichting (MvT nooit primaire normbron, normbasismelding intact); bedoeling/gecombineerd → exacte wet + exacte MvT aaneen in de kop. |
| Contractvelden | `Bronresultaat.locator.structuurLabel` en `rang.poging = "artikelspoor"`, alleen gezet door het artikelspoor. `DocumentChunk.structuur_label`/`artikelspoor` adapterprivaat. |
| Diagnostiek | `selectie.juridisch.artikel = { verwijzingen, wet_genoemd, exact, geboost, geboost_geselecteerd, via_artikelspoor }` — alleen bij een focus; tellingen en een vlag, geen nummer of tekst. Migratievrij (subsleutel van `selectie`). |
| Census | Importgraaf 172 → 173 (de nieuwe pure module); register: `supabase-adapter.ts` importeert daarnaast `vulAanMetArtikelkandidaten` uit `rag.ts`. Lezingen (`rag.ts::document_chunks`/`documenten`, evidence) en RPC-ingangen ongewijzigd. Hotfix: 173 → 174 (`retrieval/artikeltoelating.ts`, puur, importeert de kern niet); register verder ongewijzigd. |

Continuatiechunks van een lange artikeltoelichting (zelfde label, zonder de
frase in tekst of contextprefix) worden niet via het spoor toegelaten; bij
parent-retrieval haalt de structuur-unit ze alsnog mee.

**Tests.** `tests/cross-tenant/retrieval-artikelpassage.test.ts` 21/21
(herkenning, poort, match met buurartikelen 150/150c/150e/1500/15,
bedoeling/norm/gecombineerd, regime/andere wet, fondsdocumenten, byte-identiteit,
adapter met nep-client, eind-tot-eind orkestratie + Supabase-adapter met de
nagebootste pilotsituatie, negatieve controle). Mutaties: boost uit → 5 rood;
nummergrens weg → H1 rood; poort altijd open → 3 rood; rol-eis weg → S5 rood.
Reviewronde: `#500-A4` (nep-PostgREST die `or`/`limit` echt uitvoert; >50 buurlabels vóór de passage) is rood op de oude prefix-`ilike` en groen op `imatch`; tegen echte PostgREST + PG17 vindt artikel 15 één rij van 122, artikel 1 één, artikel 150 precies de tien 150-rijen. DB-check `supabase/checks/2026_09_29_500_artikelspoor.sql` (A1–A6, onder RLS)
aangesloten in `cross-tenant-ci.sh`; zonder rol en fondsfilter → `LEK A4`.
PostgREST-syntaxis van opzoeking en toelating lokaal tegen PostgREST + PG17
bevestigd.

#### Hotfix productietime-out (29-09-2026)

**Oorzaak.** Na release PR #503 eindigden de drie 150d-pilotvragen op
Productie in `57014` (8 s `statement_timeout` van `authenticator`/
`authenticated`) in `POST /rpc/zoek_chunks` — de toelatingsstap van dit spoor
(`p_limit => 200`, `p_document_ids => …`). `zoek_chunks` is `LANGUAGE sql` met
`SET search_path` en wordt dus nooit ingelijnd (generiek plan). In het
**concrete** plan verhindert de combinatie van de RLS-policy, de functievorm
(`cross join websearch_to_tsquery`) en het niet-leakproof `@@`-predicaat het
GIN-pad: een seq scan over alle 18.418 chunks; de SELECT-policy evalueert
`auth.uid()` per rij (plus de tweede permissive ALL-policy via OR) en
`documenten` wordt in een nested loop per chunkrij opnieuw gescand. Gemeten als
authenticated: 3,9 s warm / 46k buffers (als postgres 0,3 s); een herschrijving
met direct `@@ websearch_to_tsquery($1)` bleef een seq scan (1,6 s). Het is dus
geen eigenschap van GIN onder RLS in het algemeen, maar van dit plan.

**Oplossing (geen time-out-, RLS-/policy- of migratiewijziging).** De opzoeking
is begrensd tot de juridische documenten (`idx_chunks_document`); de toelating
loopt niet meer via `zoek_chunks` maar via `document_chunks?id=in.(≤ 50)` onder
RLS. `core/lib/retrieval/artikeltoelating.ts` spiegelt de laatste
`zoek_chunks` (`2026_08_12_t4_regime_borging.sql` §7a) + `rpcFilterParams` +
`p_fonds_id` + documentscope als (a) PostgREST-filters voor alles wat op één
tabel staat en (b) een gezaghebbend predicaat met twaalf benoemde regels (ook
fonds en generiek-review, die chunk- en documentkolom combineren);
`handhaafFondsdiscipline` blijft de extra grens. Zonder `peildatum`-filter geldt
de UTC-datum van de app i.p.v. `current_date` van de database (beide UTC op
Supabase). Een toegelaten passage draagt geen relevantiescore (`rang` null).

**Bewijs.** Pariteit onder echte RLS: `2026_09_29_500_artikelspoor.sql` sectie
M — 21 matrixrijen × 11 scenario's uit
`tests/cross-tenant/fixtures/500-artikeltoelating-matrix.json`: nieuwe toelating
== `zoek_chunks` == verwacht, en elk van de 13 regels (incl. frase) weglaten
maakt een scenario rood. Dezelfde matrix in
`tests/cross-tenant/retrieval-artikeltoelating.test.ts` (predicaat,
PostgREST-filterinterpreter, negatieve controles) en lokaal tegen echte
PostgREST via supabase-js (11/11). Performance:
`2026_09_29_500_artikelspoor_performance.sql` (18.418 chunks, vector(1024) +
HNSW, GIN, drie fondsen; de queries letterlijk zoals PostgREST ze genereert):
elke run < 1 s en p95 < 500 ms onder RLS, en de oude toelating ≥ 3× zwaarder
(buffers en mediaan). Productie (read-only, 12 runs, als authenticated): het
hele spoor mediaan 47 ms, p95/max 82 ms, 1.739 buffers; de oude toelating
mediaan 500 ms, max 3,3 s (eerder 4,8 s), 46.279 buffers. MvT p.395 en de vier
Pensioenwet-150d-chunks worden gevonden en toegelaten (9/9).

**Volledige vraagketen (lokaal; Preview heeft geen juridische documenten).**
`tests/karakterisering/artikelspoor-500-keten.mjs` stuurt de drie
150d-pilotvragen en de reglementvraag als W1-bestuurder via `POST /api/chat`
(`next start`, `HYBRID_SEARCH=on`, WP4-AI- en embeddingstub) tegen de
performancefixture (aan het W1-fonds, gecommit) plus 31 concurrerende
MvT-passages met alle vraagwoorden. Alle vier ronden af zonder fout;
bedoeling: Pensioenwet 150d, dan MvT p.395 als eerste wetsgeschiedenis; norm:
vier Pensioenwet-150d-passages vóór de MvT; gecombineerd: wet, dan MvT p.395;
`artikel` = exact 9, geboost_geselecteerd 2, via_artikelspoor 9 (de exacte
passages kwamen dus uitsluitend via het spoor binnen, zoals in de pilot);
reglement zonder `selectie.juridisch.artikel`. Aangesloten als laatste pass van
`.github/workflows/karakterisering.yml` (de fixture wordt daar gecommit en zou
eerdere snapshotpasses verstoren); het draairecept staat in de scriptkop.

**Open vervolgpunt (niet uitgevoerd, apart voorstel).** De SELECT-policies op
`document_chunks`/`documenten` evalueren `auth.uid()` per rij. Het gangbare
Supabase-patroon `(select auth.uid())` maakt daar één initplan van; dat is een
RLS-wijziging met een eigen migratie, structurele gates (A–H) en V3-grants-gate,
en valt bewust buiten deze hotfix. Het zou ook de andere zoek-RPC's
(`zoek_chunks`, `zoek_chunks_hybride`) onder RLS goedkoper maken.

**Controle bij de herhaalde productiepilot.** Zie de PR-beschrijving; kern:
`retrieval_meta.selectie.juridisch.artikel` moet `exact ≥ 1` en
`geboost_geselecteerd ≥ 1` tonen, en de bronkaart p. 395.

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

### 4c. R-3 — tests (29-09-2026, lokaal)

| Test | Resultaat |
|---|---|
| `tests/cross-tenant/retrieval-juridisch-beleid.test.ts` (nieuw) | 17/17: poort positief/negatief (P1–P3, incl. byte-identiteit bij dichte poort; P4 peildatum alleen met (zwak) anker: twee negatieve vragen zonder melding en byte-identieke selectie, twee positieve met melding + uitsluiting); pure selectie wet + MvT, alleen MvT, wet + amendement, bedoeling, beide rollen, gemengde PW/Wvb, historische peildatum, fondsdocumenten, onbekende intentie (S1–S9); negatieve controle (N1); contract via `voerVolledigeRetrievalUit` met een niet-Supabase-stubadapter, routedoorgifte en migratievrije diagnostiek (C1–C3) |
| Mutatie: juridische weging geneutraliseerd | 8 van 17 rood |
| Mutatie: poort altijd open | 5 van 17 rood |
| Mutatie: peildatumverscherping weg (`zeker` telt weer) | P4 rood |
| `juridische-vraagintentie-route.test.ts` | 7/7 na de bewuste R2-A3-bijwerking |
| `retrieval-census.test.ts` | 11/11 na registerbijwerking 171 → 172 |
| retrieval-identiteit / evidence-contract / productiepaden / contract / adaptergroepen / toelatingspoort / golden-gevoeligheid / g12 / t2-4-census | 14 / 39 / 16 / 23 / 26 / 43 / 21 / 15 / 14, alle groen |
| overige: tsc, `npm run sanity`, `npm run test:unit`, volledige §15-suite, karakterisering, eslint, `npm run build` | zie de PR-beschrijving |

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
| Importgraaf antwoordpad (census) | R-1 voegt de bestaande pure juridische-duidingsmodule toe | Register bewust van 170 naar 171 bereikte bestanden; lezingen, tabelclassificatie en retrievalingangen ongewijzigd. R-2 voegt geen module toe (classifier in `vraagtype.ts`): register ongewijzigd. R-3 voegt de pure module `retrieval/juridisch-beleid.ts` toe: 171 → 172, verder ongewijzigd. |
| `document_chunks` / `fn_chunk_denorm` | Niet gewijzigd | R-1 haalt de aanvullende metadata na selectie in één batch uit `documenten`; geen migratie nodig. |

R-1 raakt gericht `app/api/chat/route.ts`, `core/lib/rag.ts` en `core/lib/retrieval/*` om
metadata te projecteren. Selectie, ranking en RPC's blijven inhoudelijk gelijk. Er is
geen overlap met Microsoft-, SharePoint-, OAuth-, tenant- of tokencode.

## 6a. V-1 — juridische rollen in de documentvergelijking (#493)

| Veld | Waarde |
|---|---|
| **Branch** | `codex/493-vergelijk-juridische-rollen` (worktree `mvp-493-vergelijk-rollen`), basis `origin/preview` @ `0361e0a` (na R-2 en R-3 gerebased) |
| **Status** | PR naar `preview` open, **niet gemerged**. Eén migratie (hieronder gemotiveerd); nog niet op `portal_preview` toegepast. Geen import, geen Productie. |

**Wat.** Per gekozen document leest de vergelijking server-side de R-1-metadata
(documenttype, subtype, dossiernummer, normgewicht, `wettelijk_regime`,
documentdatum, status/bronstatus/geldig_tot en de titel als officiële verwijzing).
Daaruit leidt de pure `vergelijk-kern.ts` een getypeerde rol per zijde af
(`VergelijkJuridischeRol`): `geldend_recht` · `wetgeving_niet_geldend` (bewust
gekozen historische/verlopen versie) · `wetgeving_status_onbekend` ·
`wetsgeschiedenis` · `niet_juridisch` · `onbekend` (metadata niet leesbaar).
Labels hergebruiken `juridischeDuiding()` en `juridischeDocumentstatusLabel()` uit
R-1; er zijn geen concurrerende labels bijgekomen. Het paar krijgt een
`verhouding` (`norm_tegenover_toelichting`, `norm_tegenover_norm`,
`toelichting_tegenover_toelichting`, `juridisch_tegenover_overig`, `onbepaald`) en
een servergeschreven toelichtingszin.

**Waar het landt.**

- *Opdracht:* alleen bij een asymmetrisch of onbepaald paar krijgt de
  Opus-systeeminstructie servergeschreven rolregels (gesloten labels, geen titel of
  documenttekst). Documentinhoud kan ze niet wijzigen; de passages blijven data in
  het gebruikersbericht. Wet↔wet en niet-juridisch↔niet-juridisch houden de
  byte-identieke opdracht (sha256-pin). De promptversie krijgt dan het achtervoegsel
  `+jur-v1` in de bestaande `comparison_run.prompt_version`.
- *Kop/uitvoer:* additief veld `juridische_duiding` op `VergelijkResultaat` (HTTP en
  chat-SSE); `VergelijkResultaatWeergave` toont vóór de bevindingen per zijde het
  label (bv. `Geldend recht` tegenover `Memorie van toelichting — wetsgeschiedenis,
  geen norm`), titel, dossier, datum, regime en normgewicht, plus de
  toelichtingszin. Een aangenomen amendement wordt expliciet verklarend en geen
  zelfstandige actuele norm genoemd. Bij twee niet-juridische documenten ontbreekt
  het veld: de respons is bytegelijk.
- *Bronnen:* de bronverwijzingen dragen al sinds R-1 documenttype, subtype, dossier,
  normgewicht en regime (verrijking in de adapter); ongewijzigd.
- *Audit/persistentie:* zie hieronder.

**Hergebruikte opslagvelden.**

| Spoor | Veld | Gebruik |
|---|---|---|
| `comparison_run` | `prompt_version` (bestaand) | `+jur-v1` wanneer de rolregels meesturen |
| `comparison_run` | `retrieval_meta` jsonb (bestaand, #369) | nieuwe sleutel `juridische_duiding = {verhouding, zijden[]}` met per zijde opaque `document_id`, rol, documenttype, subtype, dossier, normgewicht, regime en datum; geen titel, geen database-id |
| `governance_log` (chatvergelijking) | `retrieval_meta.bronversie_audit[]` (bestaand, bronniveau, via `meta_bronniveau` al volledig leesbaar) | per juridische bron documenttype/subtype/dossier/normgewicht/regime; niet-juridische bronnen ongewijzigd. Er is geen nieuwe topsleutel, dus `audit-meta.ts` en `meta_projectie` blijven ongewijzigd |
| `governance_log_inhoud.bronnen` | bestaand | draagt de R-1-verwijzingen al |

**Bewezen opslagkloof, daarom één migratie.** `fn_schrijf_vergelijking` (#369)
projecteert `p_retrieval_meta` en `p_bronnen` allowlist-gebaseerd; elke extra
sleutel verdwijnt stil. `/api/vergelijk` schrijft géén `governance_log`, dus
zonder wijziging is de juridische rol voor die route nergens duurzaam
herleidbaar. `2026_09_29_493_vergelijk_juridische_rollen.sql` vervangt uitsluitend
die functie (zelfde signatuur en ACL, grants idempotent herbevestigd, geen nieuw
object, de allowlist blijft ongewijzigd) en voegt validatie plus projectie van de
optionele sleutel toe. Een zijde met een rol anders dan `onbekend` moet via de
opaque identiteit aan een zichtbaar document binden, exact diens R-1-metadata
dragen en een rol hebben die bij het documenttype past. Een aanroeper kan dus
geen normstatus verzinnen. Zonder de sleutel is het spoor bytegelijk aan #369. De
migratie is **terugwaarts compatibel**: code vóór de migratie is veilig, want de
oude projectie laat de sleutel weg. Voorkeursvolgorde blijft: eerst de migratie op
`portal_preview`, daarna mergen. Rollback:
`supabase/rollbacks/2026_09_29_493_vergelijk_juridische_rollen_ROLLBACK.sql`.

**A-10 — gevonden defect, meegenomen.** `vergelijk-productie.ts` vormde de opaque
auditidentiteit van elke retrievalpoging met een vaste `fonds:<id>`-namespace. De
DEFINER-check verwacht voor een generiek document `generiek`. Daardoor weigerde
`fn_schrijf_vergelijking` elke vergelijking met een generiek document
(`vergelijking_vreemde_retrievalpoging`), en wetgeving en wetsgeschiedenis staan
uitsluitend generiek. De namespace komt nu uit de servergelezen documentrij. Voor
fondsdocumenten verandert er niets; DB-check J7 pint dit.

**Documentprofielread.** Per gekozen document is er één read via `leesModelcontext`
(`documentlabels`, private selector = dat document, cap 1, cancellation). De
levenscyclus is bewust niet van toepassing: de toelating gebeurde al door de
expliciete, RLS-gecontroleerde keuze (`vergelijkbare_versies`). Een historische of
inactieve voorganger valt daardoor niet weg en wordt niet `onbekend`. Bij een fout
volgt de neutrale rol `onbekend`; bij een afbreking stopt de vergelijking. Het
censusregister is bewust met één lezing bijgewerkt
(`vergelijk-productie.ts::documenten`, modelcontext + configuratie, geen evidence):
53→54 lezingen en 26→27 modelcontextlezingen. De importgraaf verandert door V-1 niet (172 bestanden
na R-3, dat `juridisch-beleid.ts` toevoegde); het F4-register is ongewijzigd.
Na de rebase is het register opnieuw uit de census berekend en exact gelijk.

**Samenloop met R-3.** Het juridisch selectiebeleid van R-3 (`juridischeIntentie`
in de spoorgrenzen) geldt alleen voor bibliotheeksporen van de chat. Het
vergelijkspoor (`maakVergelijkSpoor`) en `vergelijk-productie.ts` krijgen het nooit;
in de vergelijktak van de chatroute staat de intentie uitsluitend als auditwaarde.
Een expliciet gekozen historisch document kan dus niet door het
actualiteits- of peildatumbeleid van R-3 wegvallen. De contracttest
`V-1 × R-3` in `retrieval-productiepaden.test.ts` pint dit.

**Tests (lokaal, 29-09-2026).** tsc exit 0; `npm run test:unit` groen: sanity
"Alle resterende sanity-suites groen." en Vitest 151/151. Nieuwe sanity
`vergelijk-juridisch.sanity.ts` 17/17: wet↔MvT, wet↔amendement, wet↔wet,
niet-juridisch↔niet-juridisch (bytegelijk), ontbrekende metadata, historische
voorganger, opdrachtpin, injectie, negatieve controle en auditcontract. App-laag
1104/1104, waaronder `retrieval-productiepaden` (+4 V-1-contracttests),
`retrieval-evidence-contract` en beide censussuites. De volledige
`bash scripts/cross-tenant-ci.sh` op een eigen wegwerpstack (project
`mvp493-v1`, poorten 54621/54622) gaf **GROEN** (app- plus DB-laag, incl. V3 en
de nieuwe check J1–J7). Negatieve DB-controle: tegen de #369-definitie is J2 rood.
De migratie is tweemaal idempotent toegepast. eslint, `lint:quality:check`,
`lint:colors`, mapindeling en `npm run build` zijn groen. De karakterisering
draaide lokaal niet, omdat de seedgrendel poort 54321 pint en die poort bewust
vrij bleef voor de parallelle R-2-sessie. Die uitkomst komt uit de PR-CI.

**Open punten.** (1) Migratie op `portal_preview` toepassen en daar R1-gates plus
V3 draaien. (2) De `440-*`-drift-artefacten zijn niet geregenereerd; zoals bij
eerdere migraties gebeurt dat bij de volgende inventarisatie. De functie-md5 van de
8-argumentvariant wijzigt. (3) Een release-regel in `HANDOVER.md` volgt na de merge,
zoals bij R-1. (4) De dimensiebepaling (Haiku) blijft ongewijzigd; valt buiten
scope.

## 6b. #499 — metadatawijziging op documenten met veel chunks

**Aanleiding.** Op Productie (29-09-2026) liep het omzetten van de Pensioenwet
(968 chunks) naar `wetgeving`/`pw` op een statement-time-out; de UI meldde ten
onrechte "mogelijk een ongeldige statusovergang".

**Oorzaak (gemeten op de lokale stack, CLI 2.114.0, PG 17.6, pgvector 0.8.2).**
De platform-client praat als `service_role` via PostgREST; `service_role` heeft
zelf geen `statement_timeout`, dus de 8 s van `authenticator` geldt.
`trg_chunk_denorm_refresh` werkt synchroon alle chunks bij. Elke chunk-UPDATE is
een nieuwe tuple (geen HOT) en krijgt dus een nieuw element in elke index,
ook in de HNSW-index op `embedding vector(1024)`. Meetreeks met 1.000 chunks en
10.000 chunks in de graaf: de volledige update kost 1,4 s. Zonder HNSW is dat 38 ms,
zonder HNSW en GIN 30 ms. HNSW is dus ~97 % van de kosten. Een no-op-update
(`set documenttype = documenttype`) kostte óók 1,3 s, omdat de trigger
op de SET-lijst vuurde en de functie geen `IS DISTINCT FROM`-filter had. Met
productie-achtige rekenkracht (0,25 vCPU) gaf de tabel-PATCH via PostgREST
exact het productiebeeld: `57014` na 8,0 s. Het volledige werk kost daar 11–14 s.

**Oplossing (migratie `2026_09_30_499_generieke_metadatawijziging_timeout.sql`).**
(1) De denorm-functie herschrijft alleen afwijkende chunks. (2) De trigger krijgt een
WHEN-clausule en vuurt dus alleen bij een echte waardewijziging. (3) De nieuwe RPC
`fn_platform_generiek_document_bijwerken` draagt `statement_timeout = 120s` op haar
definitie. PostgREST hijst die waarde vóór het statement. De RPC voert de wijziging,
de chunk-denorm en de `document_metadata_log`-regels in één transactie uit. Bij
dezelfde 0,25 vCPU slaagt de RPC in 13,5 s, met 1.000/1.000 chunks consistent en
vier auditregels. `curatieBijwerken`, `curatieDepreceren`, `curatieWithdrawn` en
`curatieHerpubliceren` gebruiken de RPC. `platform/lib/generiek-mutatie-fout.ts`
onderscheidt de gebruikersmelding voor een time-out (57014), een statusovergang
(P0001), een CHECK-fout, een niet-gevonden document en een ontbrekende RPC.
De melding bevat geen interne details; de SQLSTATE gaat alleen naar het audit-effect.

**Verworpen.** Asynchrone verwerking: retrieval filtert op chunk-`bronstatus`/
`documenttype`/`wettelijk_regime`, dus een venster met inconsistente chunks zou
bijvoorbeeld een ingetrokken bron nog als actueel kunnen tonen. Een `SET` binnen de
functie verlengt het lopende statement niet. Een hogere `statement_timeout` op
`service_role`/`authenticator` zou alle platformverkeer raken. Fillfactor/HOT helpt
niet, omdat `bronstatus`, `documentstatus` en `geldig_*` geïndexeerd zijn. Denorm
uit `document_chunks` halen of embeddings splitsen is een retrievalrefactor.

**Deploy.** Voer eerst de migratie uit op `portal_preview`, deploy daarna preview,
en volg later dezelfde volgorde voor `portal_production` en `main`. Oude code (PATCH)
blijft na de migratie werken. Nieuwe code zonder migratie geeft een nette melding
("tijdelijk niet beschikbaar"), zonder gedeeltelijke wijziging. Postcheck: draai de
Pensioenwet-wijziging opnieuw via de beheerUI en controleer chunkconsistentie met de
preflight- en postcheckqueries in de PR.

**Open.** (1) De hijsing is lokaal geverifieerd op PostgREST v14.1. Controleer
de PostgREST-versie van Preview en Productie (v12.1+ hijst functie-instellingen).
(2) `curatieVervangen` zet de oude versie nog via een tabel-PATCH op
historisch; bij een groot document geldt daar nog de 8 s-grens (de fout wordt nu
genegeerd). (3) De `440-*`-drift-artefacten zijn niet geregenereerd, net als
bij eerdere migraties.

## 6c. #504 — datumvelden in de generieke curatie werden niet opgeslagen

**Aanleiding.** Productie, 29-09-2026, Pensioenwet (968 chunks): documentdatum
`2026-01-01`, geldig vanaf `2026-01-01` en volgende review `2026-12-15` stonden
zichtbaar in de invoervelden, maar opslaan gaf "Geen wijzigingen."; de kolommen
bleven NULL en er kwam geen audit.

**Oorzaak (bewezen).** "Geen wijzigingen." ontstaat alleen als de diff in
`curatieBijwerken` leeg is, dus de serveractie kreeg lege datums binnen. De
server- en DB-keten verwerken datums wél correct: `leesInvoer` → validatie → diff
geven drie wijzigingen (sanity), de RPC-allowlist bevat de datumvelden, en
`jsonb_populate_record` cast ze naar `date` (DB-check D1/D2). De fout zat in de
client. `bouwFormData` verstuurde uitsluitend de React-state. Een waarde die
zonder React-onChange in een datumveld komt, blijft zichtbaar maar komt leeg in
de FormData. Dat gebeurt bij autofill, extensies en browserautomatisering:
`el.value = …` werkt React's value-tracker bij, dus het volgende `input`-event
levert geen onChange op. Het formulierpad reproduceert dit in echte Chrome
(harness met het echte component) en in jsdom: waarde zichtbaar, FormData `""`.
Met de oude code zijn drie componenttests rood. Hoe de waarden in Productie
precies in de velden kwamen, is niet te achterhalen. Dit mechanisme geeft wel
exact het waargenomen beeld.

**Oplossing (geen migratie).** (1) Datumvelden krijgen `name` en een
`DatumInput` die ook op het native input- en blur-event synchroniseert. (2) Bij
verzenden is de zichtbare DOM-waarde van elk datumveld leidend
(`bouwCuratieFormData`). (3) De FormData-lezing en de diff staan nu als pure kern
in `platform/lib/generiek-curatie-diff.ts`. Datumkolommen worden daar als
JJJJ-MM-DD vergeleken. `documentdatum` en `geldig_vanaf` krijgen
`rag_impact=true`: ze worden naar de chunks gedenormaliseerd en `documentdatum`
is het versiebewijs van de toelatingspoort.

**Leegmaken.** Dit is toegestaan: het veld wordt NULL op het document en, voor
`documentdatum`/`geldig_vanaf`, op alle chunks, met een auditregel oud → null.
Uitzondering: bij wetsgeschiedenis blijft `documentdatum` verplicht
(`valideerJuridischeMetadata`). Leegmaken wordt daar gevalideerd geweigerd.
Let op: een wetgevingsdocument zonder `documentdatum` valt in retrieval terug op
`versiebewijs_ontbreekt` (zie open punt).

**Tests.** `tests/component/GeneriekeBibliotheekDatumvelden.component.test.tsx`
(6; drie rood op de oude code), `platform/lib/generiek-curatie-diff.sanity.ts`
(10, inclusief de pariteit tussen de app-veldlijst en de RPC-allowlist), en
DB-check `supabase/checks/2026_09_30_504_curatie_datumvelden.sql` (D0–D6: klein
document en 1.000 chunks, denorm, audit met actor en reden, identieke opslag,
leegmaken, ongeldige datum → rollback, negatieve controle zonder
denorm-trigger), aangesloten in `scripts/cross-tenant-ci.sh`.

**Postcheck Productie (na promotie).** Vul de drie datums van de Pensioenwet
opnieuw in via de beheer-UI. Verwacht "3 veld(en) bijgewerkt", 968/968 chunks
met `documentdatum`/`geldig_vanaf` = `2026-01-01` en drie auditregels. Een
tweede opslag geeft "Geen wijzigingen.".

**OPEN vervolgpunt (niet in #504).** Het zoekpad draagt `indexering_versie` en
`bestand_hash` niet mee (alleen `REFLECTIE_SELECT` doet dat; zie
`chunkAlsBronresultaat` in `core/lib/rag.ts`). Daardoor bereikt het sterke
hashbewijs de toelatingspoort (`core/lib/retrieval/toelatingspoort.ts`) nooit.
Generieke documenten zonder `documentdatum` worden geweigerd met
`versiebewijs_ontbreekt`.

## 6d. Legacy-documenten met uitgesteld WP3-scanbewijs (Refs #500)

**Oorzaak (read-only gemeten op Productie, 30-09-2026).** 14 actieve generieke
documenten (4.351 chunks, o.a. de Pensioenwet met 968 chunks, wetgeving/pw, datums
gezet) hebben `scan_resultaat = {scan:'uitgesteld_wp3'}` uit de P1-pipeline en een
geldige SHA-256. Onder `WP3_MALWARESCAN_AAN=true` eist de versiepoort
(`bewijsUitVersierij`) terecht een schoon hash-gebonden verdict, dus deze bronnen
vielen stil uit retrieval. De reaper selecteerde alleen `bestand_hash is null of
scan_resultaat is null` en pakte ze dus nooit op.

**Oplossing (geen migratie, geen beheerknop).** `platform/lib/legacy-scan.ts`:
selectie uitgebreid met de categorie *uitgesteld scanbewijs* (geldige hash, geen of
technisch verdict), met expliciete uitsluiting van negatieve statussen, negatieve
verdicts, bewijsconflicten, open jobs en een 24-uursafkoeling na een technische
mislukking. `LEGACY_SCAN_BATCH` (standaard 1, max 2) begrenst lopende legacy-scans;
`REAPER_LIMIET` is ongewijzigd. De worker scant nu **vóór** hij iets wist: bij een
technische fout blijven de chunks staan (document dicht door ontbrekend bewijs), bij
`infected`/`policy_blocked` worden ze verwijderd, bij `clean` vervangt de gewone
herindexering ze. Omdat chunks nu tijdens een storing blijven staan, zijn vijf
leeswegen gedicht die ongescande chunkinhoud nog konden lezen (dekkingsbreed pad,
reflectie, reranker vóór de poort, T8-extractie + semantische evidence,
her-indexering); zie `MALWARESCAN-WP3-ONTWERP.md` voor de tabel per leesweg.

**Selectie-uitkomst.** Productie: precies de 14 (eerste bij batch 1:
`2745d314…`, de Pensioenwet is de negende). Preview: 0 in de nieuwe categorie; de
bestaande legacyregel dekt daar 6 synthetische fondsdocumenten zonder hash/scan.

**Serialisatie (vervolg-PR).** `LEGACY_SCAN_BATCH=1` garandeerde niet één
document tegelijk: twee overlappende cron-aanroepen konden allebei "0 lopend"
lezen. Nu draagt de legacy-scanjob een `legacy_slot` (migratie
`2026_09_30_legacy_scan_slot.sql`). De partiële unieke index
`uq_dpj_legacy_slot_open` laat per slot hooguit één open job toe, voor de hele
keten tot en met finaliseer. Bewijs: `scripts/legacy-scan-overlap.mts` (echte
PostgREST, overlappende reapers, negatieve controle zonder index), aangesloten in
de cross-tenant-gate. **Volgorde:** eerst de migratie op portal_preview en
portal_production, dan de code.

**Releasecheck na de productiedeploy.**
`supabase/checks/2026_09_30_legacy_scan_wp3_releasecheck_productie.sql` (read-only,
bewust niet in CI: productiespecifiek). Eerst `pensioenwet.ok`, daarna
`samenvatting.klaar` = 14.

## 7. Volgende fasen

| # | Stap | Verwachte bestanden | Tests |
|---|---|---|---|
| R-0 | **Afgerond:** Preview-database, merge/deploy en metadata-UI-smoke volgens §3 zijn groen | — | Preview-preflight, W1–W10, R1 en V3 groen; visuele metadata-smoke 29-09-2026 groen |
| I-1 | **Afgerond en op Preview:** `structureerParlementairStuk` / `alsStructuurUnits` zijn aangesloten op de actuele worker, centrale chunkbouw en herindexering voor `documenttype='wetsgeschiedenis'` | chunking/chunk-bouw/chunk-ingest, worker, reindex en generiek pad | MvT/amendement/fallback/meerdere pagina's groen; census 11/11 |
| I-2 | Actuele PW/Wvb opnemen (BWB-id in de titel/URL); max. één actieve versie per wet via `curatieVervangen`; Wtp-Staatsblad-pdf's herclassificeren | curatiehandeling (data), eventueel een DB-check "één actieve wetgeving per regime + titel-BWB" | DB-check + Preview-controle |
| R-1 | **Afgerond en op Preview via PR #489:** documenttype, subtype, dossiernummer, normgewicht en rechtsregime lopen door naar prompt, bronkaart en audit; na-selectie batchverrijking, dus geen migratie/denormalisatie | `rag.ts`, retrievalcontract/citatie/meta, assistant-source, bronkaart | identiteit 14/14, prompt-/bronlijst-sanities groen; censusregister verklaarbaar +1 bestand en 11/11 groen; post-mergechecks en beide deploys groen |
| R-2 | **In PR (#491):** observe-only juridische vraagintentie op de effectieve vraag, vastgelegd onder `retrieval_meta.invoer.juridische_intentie`; zie §2a | `core/lib/vraagtype.ts`, `core/lib/rag.ts` (type), `app/api/chat/route.ts` | `vraagtype.test.ts` 109/109 + pariteitspin; `juridische-vraagintentie-route.test.ts` 7/7; census ongewijzigd |
| R-3 | **In PR (#492):** centraal juridisch bronbeleid met poort in de selectie (actuele wet vóór wetsgeschiedenis; beide rollen bij bedoeling; actuele wet uitgesloten bij historische peildatum) + juridische antwoordgrens via inline-meldingen; zie §2b | `core/lib/retrieval/juridisch-beleid.ts` (nieuw), `selectie.ts`, `orkestratie.ts`, `core/lib/rag.ts` (typen/commentaar), `core/lib/vraagtype.ts` (meldingen), `app/api/chat/route.ts` | `retrieval-juridisch-beleid.test.ts` 16/16 + mutaties; census 172; retrievalregressies groen |
| A-1 | **Afgerond binnen R-1:** prompt schrijft voor dat de normatieve conclusie eerst uit geldend recht komt en wetsgeschiedenis alleen uitleg/achtergrond geeft; ook een aangenomen amendement is geen zelfstandige actuele norm | `generatie-kern.ts` | `generatie-kern.sanity.ts` |
| V-1 | **Gebouwd, PR naar `preview` open (#493), nog niet gemerged:** juridische rol per zijde in opdracht, kop, bronnen en audit; generieke auditnamespace hersteld; expliciet gekozen historische documenten blijven vergelijkbaar. Zie §6a | `vergelijk-kern.ts`, `vergelijk-productie.ts`, `vergelijk-types.ts`, `VergelijkResultaatWeergave.tsx`, chatroute (bronversie-audit), migratie `2026_09_29_493_…` | `vergelijk-juridisch.sanity.ts` 17/17, `retrieval-productiepaden.test.ts` +4, DB-check J1–J7; goldens ongewijzigd |
| B-1 | **Bronweergave afgerond binnen R-1:** bronkaarten tonen geldend recht versus wetsgeschiedenis/geen norm, plus dossier en regime. Alleen het type-/subtypefilter in de bibliotheek staat nog open. | `AntwoordWeergave.tsx`, `assistant-source.ts`; later `GeneriekeBibliotheekClient.tsx` | bronlijst-/assistant-source-sanities groen; filtertest volgt |
| W-1 | Live web: `officielebekendmakingen.nl` `kst-*` niet bindend via de whitelist | `core/lib/web-whitelist.ts`, `web-retrieval.ts` | `web-whitelist.sanity.ts`, `web-retrieval.test.ts` |
| E-1 | Evaluatieset (werkticket PR 4) + Preview-pilot met bron- en antwoordcontrole | `evals/…` | evalrun op Preview |

## 8. Bevestiging

De foundationmigratie is uitsluitend op de Preview-database toegepast en structureel groen bevonden. Foundation, I-1 en R-1 draaien op de vaste Preview-hosts; R-1 vergde geen migratie. Er is geen document geüpload, vervangen of geïmporteerd; Productie is niet gewijzigd. Door de defecte Preview-antivirusscanner blijft de eerste echte bronimport een gecontroleerde Productiestap na de reguliere promotie. R-2 staat in een PR naar `preview` (observe-only, geen migratie). R-3, de afzonderlijke vergelijkingscall V-1, de bibliotheekfilter, webclassificatie en evaluatie blijven open.
