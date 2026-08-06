# 0134 — Tekstherkenning bereikbaar maken voor fondsdocumenten (her-extract-pad)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-06
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude (uitvoering/advies)
- **Relatie:** addendum op [`0020`](./0020-ocr-engine-mistral.md) (Mistral als OCR-engine) en [`0023`](./0023-ocr-in-generieke-curatie-pipeline.md) (synchrone OCR in de generieke curatie). Interim vooruitlopend op het bouwticket *Async document-ingest + ingest-caps v1.0* (26-06-2026), waarvan tot nu toe alleen deel C (ingest-caps) is gebouwd.

## Context

Een fondsbeheerder kon een gescande PDF niet ontsluiten. De uploadroute weigerde een bestand met minder dan 100 betekenisvolle tekens hard met een 400 en het advies "maak het bestand elders doorzoekbaar en upload opnieuw".

Dat maakte de OCR-capaciteit die er wél is onbereikbaar. `extractTekstMetOcrFallback` (`core/lib/ocr.ts`, besluit 0020) draait al op drie plekken, waaronder `/api/documents/[id]/her-extract` — een gewone tenant-route, beperkt tot voorzitter/beheerder, onder RLS, met rate limit en OCR-audit, en al bedraad aan de knop "Her-indexeren" op de bibliotheekpagina. Alleen: zonder documentrij is er niets om te her-extracten. De keten was compleet op één schakel na.

Bij het uitwerken kwam een tweede, zwaarwegender probleem boven water. De uploaddrempel telde **100 tekens over het hele document**, terwijl de OCR-drempel **50 tekens per pagina** is (`heeftOcrNodig`). Een scan van 120 pagina's met 150 tekens losse tekst kwam daardoor gewoon door de controle heen, werd als praktisch leeg document geïndexeerd en meldde zich als volledig verwerkte bron. De assistent vond er niets in en niemand zag waarom. Dat is precies het faalpatroon dat bevinding H-09 (review 30-07) op het chunk-insertpad al dichtte: een half-verwerkt document dat zich als volledig presenteert.

Randvoorwaarden: `0020` houdt live synchrone OCR bewust buiten de **upload**route vanwege de Vercel-functietimeout ("Live async pas na aparte analyse"); `0023` stond het wél toe in de back-office met `maxDuration = 300` omdat dat laagfrequent is en één curator betreft. De her-extract-route heeft hetzelfde risicoprofiel als die back-office — maar zette zelf géén `maxDuration`.

## Besluit

De uploadroute weigert een PDF zonder bruikbare tekstlaag niet langer, maar **bewaart** hem — documentrij plus origineel in Storage, `geindexeerd = false`, zichtbaar in de bibliotheek als "Tekstherkenning nodig" — zodat de beheerder de bestaande her-extractie met OCR-fallback kan starten. Het detectiecriterium op dat pad wordt `heeftOcrNodig()` (per pagina) in plaats van de drempel van 100 tekens over het hele document. De her-extract-route krijgt `maxDuration = 300` plus een paginacap van 40 voor de OCR-stap.

OCR blijft daarmee **uit** de uploadroute zelf; die detecteert alleen dát tekstherkenning nodig is. `0020` blijft op dat punt ongewijzigd van kracht.

## Overwogen alternatieven

- **OCR direct in de uploadroute** (`extractTekst` vervangen door `extractTekstMetOcrFallback` + `maxDuration`) — kleinste diff, maar precies wat `0020` verwierp: het uploadpad is high-volume, en een gebruiker die vijf minuten naar een spinner kijkt terwijl er per pagina extern werk wordt gedaan, is geen acceptabele interactie. Afgevallen.
- **Wachten op de asynchrone ingest-worker** (deel A+B van het 26-06-ticket) — het structureel juiste antwoord en nog steeds de richting, maar één tot twee weken werk. De demo-omgeving voor de drie fondsen moet eerder kunnen aantonen dat tekstherkenning werkt. Afgevallen als interim, blijft de eindsituatie.
- **Document deactiveren in plaats van actief laten** (`actief = false` + `deactivatie_reden`) — volgt de H-09-lijn strikter ("een document zonder index mag niet als geldige bron in de bibliotheek staan"). Afgevallen: het kost een extra handeling, en her-extract zou het document dan moeten reactiveren, wat alleen mag bij precies die ene deactivatiereden — een conditionele reactivering die makkelijk fout gaat. Een actief document met een expliciete badge en een uitlegregel is even eerlijk en beter hanteerbaar.
- **Paginacap vóór de download controleren** op `documenten.paginas` — goedkoper, maar zou een groot document mét tekstlaag blokkeren voor gewone her-indexering. De cap hoort bij de OCR-stap, niet bij her-indexeren. Daarom pas ná de goedkope tekstlaag-extractie, wanneer bekend is of OCR überhaupt nodig is.

## Reikwijdte na review

Een adversariële review op de eerste implementatie leverde drie correcties op die het besluit inhoudelijk aanscherpen:

- **Vergaderstukken blijven de harde weigering houden.** Een upload bij een agendapunt krijgt een AI-samenvatting die het bestuur gebruikt om zich voor te bereiden. Die stap wordt in de bewaartak overgeslagen en her-extract genereert géén samenvatting, dus het stuk zou permanent "samenvatting wordt nog gegenereerd" tonen in de vergaderkaart — een stille onwaarheid op precies het pad waar bestuurders op vertrouwen. Op dat pad dus een 400 met de route naar de oplossing: eerst in de bibliotheek uploaden, daar tekstherkenning uitvoeren, daarna koppelen.
- **De paginacap geldt óók bij upload.** Anders bewaren we een scan van 120 pagina's met de belofte "kies Tekstherkenning uitvoeren", terwijl her-extract die knop gegarandeerd met 413 weigert en heruploaden op de dedup (409) stuit. Een doodlopende straat is een ergere vorm van schijnzekerheid dan een weigering.
- **De cap blokkeert alleen bij afwezige tekst.** `heeftOcrNodig` slaat ook aan op een dunne maar echte tekstlaag (bijlagenboek, tekeningenbundel, presentatie-export). Zou de cap daar hard weigeren, dan kon zo'n document van meer dan 40 pagina's via geen enkel pad meer geïndexeerd worden — een regressie ten opzichte van het oude gedrag, waar een mislukte OCR gewoon terugviel op de basistekst. De 413 vuurt daarom alleen als er óók geen bruikbare tekst is.

Kleinere correcties uit dezelfde review: generieke documenten zijn uitgesloten van de nieuwe badges (voor tenants read-only, de her-indexeerknop is daar bewust verborgen — een badge die naar een onbestaand menu-item wijst is erger dan geen badge); de uitlegregel benoemt dat voorzitter of beheerder de handeling doet in plaats van iedereen te instrueren; en het zetten van `opslag_pad` is bij een OCR-kandidaat fail-closed gemaakt, omdat het document zonder dat pad onherstelbaar is.

## Gevolgen

- **Code.** `core/lib/ingest-caps.ts`: `MAX_OCR_PAGINAS_SYNCHROON = 40`, `FOUTCODE_OCR_TE_VEEL_PAGINAS`, `STATUS_TEKSTHERKENNING_NODIG` + twee meldingen. `core/lib/ocr.ts`: `extractTekstMetOcrFallback` krijgt een optionele `maxOcrPaginas` en meldt `ocrOvergeslagen: "te_veel_paginas"` in plaats van OCR halverwege te laten afbreken; zonder optie is het gedrag ongewijzigd (bulk-/scriptpad). `app/api/documents/upload/route.ts`: nieuw criterium + bewaartak. `app/api/documents/[id]/her-extract/route.ts`: `maxDuration = 300` + cap-afhandeling. `app/(dashboard)/bibliotheek/page.tsx`: badges, knoplabel en uploadmelding.
- **Datamodel/migraties: geen.** `documenten.ocr_toegepast` en `ocr_engine` bestaan al (`2026_06_22x_ocr_audit.sql`, besluit 0020). Deze wijziging is code-only en hoeft niet migratie-eerst.
- **RLS/tenant-isolatie: ongewijzigd.** Beide routes draaien op de anon-key onder de bestaande document- en chunkpolicies. De rolgate (voorzitter/beheerder) en de rate limit `her_extract` (10/uur, `failClosed: true`, bevinding M-06) blijven zoals ze waren.
- **Audit/reproduceerbaarheid.** `ocr_toegepast`/`ocr_engine` werden al geschreven maar waren in geen enkel scherm zichtbaar. In de bibliotheek staat nu een badge "Via tekstherkenning" met een tooltip die aanraadt overgenomen getallen tegen het origineel te controleren. OCR blijft een afgeleide bewerking op ongewijzigde broninhoud (snapshot-integriteit intact).
- **Gebruikerservaring.** De uploadmelding is `⚠️` in plaats van `✅` wanneer er een vervolgstap openstaat — de upload is geslaagd, het document is niet klaar. Geen schijnzekerheid.
- **Kosten.** Mistral OCR kost $2 per 1.000 pagina's ($1 batch); een jaarverslag van 150 pagina's is circa dertig dollarcent. De rate limit is de vangrail, niet de prijs.
- **Bewust geaccepteerd / open:**
  - *Deels-gescande documenten* — de drempel is een gemiddelde over het document. Een jaarverslag met digitale tekst plus ingescande getekende verklaringen haalt dat gemiddelde en wordt niet ge-OCR'd. Bekend openstaand punt uit `0020`; op te lossen met de asynchrone worker, waar OCR per pagina kan.
  - *Eén synchrone request van maximaal vijf minuten* blijft een oneigenlijke belasting van een serverless functie. Acceptabel als interim, niet als eindsituatie.
  - *Badge-nauwkeurigheid* — een actief, niet-geïndexeerd PDF-document kan ook een eerder mislukte her-indexering zijn. De badge zegt dan "Tekstherkenning nodig" terwijl de oorzaak een andere is. De remedie is in beide gevallen dezelfde knop en her-extract past geen OCR toe als er wél een tekstlaag is, dus de gebruiker wordt niet verkeerd gestuurd. Nauwkeuriger onderscheid vraagt een reden-kolom en dus een migratie; niet proportioneel voor een interim.
  - *OCR-markering nog niet bij de bronvermelding in de chat* — bewust buiten scope gehouden. Dat vraagt `ocr_toegepast` op het bronmodel en dus ofwel een denormalisatiekolom op `document_chunks` (migratie, raakt `fn_chunk_denorm`) ofwel een extra query in de chatroute. Een ingest-fix en een wijziging in de chatketen — het gevoeligste pad, met `governance_log`, `retrieval_meta` en evals eraan — horen niet in één change. Meenemen met het asynchrone spoor.
  - *Kwaliteitsbewijs* — `0020` eiste een Fase 0-steekproef op de twee DNB-documenten vóór bulk-ingest; of die is uitgevoerd en afgetekend is niet vast te stellen. Vóór de eerste demo een handmatige steekproef doen op de demo-documenten, met specifieke controle op getallen in tabellen.
  - *DPIA/verwerkingsregister* — `0020` voerde OCR op als verwerking bij een bestaande verwerker (Mistral, EU/Parijs) in de context van generieke, publieke toezichtdocumenten en her-extract. Dit besluit maakt het pad bereikbaar voor **fondsdocumenten**: notulen, deelnemersgegevens, mogelijk bijzondere persoonsgegevens. Andere gegevenscategorie. Registerregel controleren en waar nodig uitbreiden vóór gebruik met echte fondsdata; voor de demo-omgeving met uitsluitend publieke documenten is de feitelijke blootstelling nihil, maar de capaciteit wordt wél opengezet.
- **Niet in scope:** async/queue-OCR, OCR in de uploadroute zelf, wijziging aan chunking/embedding of aan de OCR-drempel van 50 tekens per pagina.

## Verificatie

- `tsc --noEmit --skipLibCheck` = exit 0.
- `eslint` op de laaggrenzen (`core platform fondsen app`) = exit 0.
- Nieuwe suite `core/lib/ocr.sanity.ts` (11 tests) met een expliciete regressiepin op het stille faalpad: 150 tekens over 120 pagina's moet `heeftOcrNodig = true` opleveren. Zou dat ooit weer `false` worden, dan is het gat terug.
- `core/lib/ingest-caps.sanity.ts` uitgebreid van 3 naar 7 tests, waaronder de eis dat de tekstherkenning-melding een bewaar- en geen foutmelding is (suggereert de tekst een weigering, dan gaat de gebruiker onnodig opnieuw uploaden) en een tijdbudget-assertie die de cap koppelt aan het werkelijke kostenmodel: OCR is één call over het hele PDF (worst case 3 × 60 s), daarna schaalt het per pagina met een context-prefix en een embedding. Die assertie ving tijdens de bouw een eerste, onjuist gemodelleerde grens op — de cap kan niet zonder meer omhoog zolang het pad synchroon is.
- **Openstaand mensenwerk:** browsersmoke met een echte gescande PDF (upload → badge → tekstherkenning → doorzoekbaar → citaat met paginaverwijzing); pre-merge aftekening door `supabase-rls-reviewer`, `code-reviewer` en `ontwerp-sync-reviewer`.

## Referenties

- `core/lib/ocr.ts`, `core/lib/ingest-caps.ts`, `core/lib/ocr.sanity.ts`, `core/lib/ingest-caps.sanity.ts`
- `app/api/documents/upload/route.ts`, `app/api/documents/[id]/her-extract/route.ts`, `app/(dashboard)/bibliotheek/page.tsx`
- migratie `supabase/migrations/2026_06_22x_ocr_audit.sql` (auditkolommen, uit `0020`)
- `04 Technische inrichting/Bestuurdersportaal - Werkopdracht OCR voor fondsdocumenten (interim, her-extract-pad) v0.1.md`
- `04 Technische inrichting/Bestuurdersportaal - Async document-ingest en ingest-caps werkopdracht en bouwticket v1.0.md` (deel A+B openstaand)
- [`0020`](./0020-ocr-engine-mistral.md), [`0023`](./0023-ocr-in-generieke-curatie-pipeline.md)
