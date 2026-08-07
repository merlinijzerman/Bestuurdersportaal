# 0140 — Bibliotheek: tabelweergave met stille normaal, en classificatie bij aanlevering

- **Status:** Geaccepteerd
- **Datum:** 2026-08-07
- **Betrokkenen:** Merlin IJzerman (product/opdrachtgever)

## Context

Twee problemen die op dezelfde plek samenkomen — de documentbibliotheek — maar van verschillende orde zijn.

**Het zichtbare probleem: badge-soep.** De documentrij kon tot **twaalf** badges tegelijk tonen. Die badges mengden drie ongelijksoortige dimensies: classificatie (`Intern`, `PDF`, `van_kracht`), technische toestand (`✓ Geïndexeerd`, `Verwerken…`, `Via tekstherkenning`) en levensloop (`Gedeactiveerd`, `Vervallen`). Doorslaggevend: **de meeste badges meldden de nórmale toestand.** `✓ Geïndexeerd` stond bij vrijwel elk document en droeg daarmee nul informatie — terwijl het document waar het júist níet staat het enige is dat aandacht vraagt. Dat document was het moeilijkst te vinden. Daar kwam bij dat `van_kracht` een ruwe databasewaarde was die ongefilterd op het scherm belandde, en dat een rij van ±96 px hoog op een normaal scherm zes documenten liet zien.

**Het onzichtbare probleem: een RAG-risico bij aanlevering.** Het uploadformulier zette geen `documenttype` en geen `bronstatus`. Voor documenttype betekende dat: elk geüpload document belandde in de restgroep "Zonder type" en zette de review-vlag. Voor bronstatus is het ernstiger. `documenten.bronstatus` blijft NULL bij insert, en **NULL is in `document-status-transities.ts` gelijk aan `actief`**. Een archiefdocument dat met besluit [`0136`](./0136-statusverklaring-bij-ingest.md) als "van kracht" werd aangeleverd — terecht, want het wás van kracht — werd daarmee stilzwijgend een **actuele bron voor de AI-assistent**. De assistent kan dan een verouderd beleidsstuk citeren alsof het geldend is, mét bronvermelding. Dat is geen invulveldje maar een governance-risico dat pas zichtbaar wordt als een bestuurder een verkeerd antwoord krijgt.

De aanleiding is concreet: er wordt een bestaand documentarchief in het portaal geladen.

## Besluit

1. **De bibliotheeklijst wordt een tabel met vaste kolommen**, waarbij een document dat in orde is **géén statusbadge** toont. Alleen afwijkingen krijgen beeldoppervlak ("stille normaal, luide uitzondering"). Bestandstype staat vooraan als kleurloze kolom; de kolom "Bron" bestaat alleen op de generieke tab.
2. **Statusteksten worden geherformuleerd van oordeel naar toestand**, vastgelegd in drie regels (zie hieronder) en bevroren in een sanity-test.
3. **`documenttype` wordt verplicht bij een bibliotheekupload** en optioneel op de andere uploadpaden (vergaderstuk, bewijsstuk).
4. **`bronstatus` wordt verklaarbaar bij aanlevering**, via **dezelfde transitietabel, capability en redenplicht** als een latere wijziging.
5. **Grote groepen tonen "toon er meer", geen paginering.**

### De drie formuleringsregels

| | was | wordt |
|---|---|---|
| 1. Benoem de **toestand**, geen oordeel | Verwerking mislukt · Geweigerd · Gedeactiveerd | Niet verwerkt · Niet geaccepteerd · Inactief |
| 2. Geen **jargon uit het datamodel** | Nog niet verrijkt | Metadata onvolledig / Type ontbreekt |
| 3. Geen **impliciete belofte** | Nog niet doorzoekbaar · Tekstherkenning nodig | Niet doorzoekbaar · Geen tekstlaag |

Regel 1 heeft een inhoudelijke grond: de bestuurder die dit leest heeft het bestand vaak zelf aangeleverd. "Mislukt" en "geweigerd" leggen impliciet schuld bij hem, terwijl de oorzaak doorgaans een eigenschap van het bestand is. Regel 3 telt omdat "nog niet" belooft dat het vanzelf goedkomt — precies niet het geval: er is een handeling voor nodig.

De handelingsaanwijzing verhuist naar de tooltip. Het label moet scanbaar zijn over tientallen rijen; de instructie hoort bij het ene document waar je op stilstaat.

## Overwogen alternatieven

- **Metadata achter hover verbergen** (de oorspronkelijke vraag). Deels overgenomen, met een harde grens: hover is geschikt voor **detail** (paginatelling, datum), nooit voor **uitzondering**. Zou "Niet verwerkt" achter hover verdwijnen, dan moet je over zestig documenten muizen om te vinden wat stuk is — dan is precies de informatie die ertoe doet onvindbaar geworden. Bovendien werkt hover niet op touch en is het zonder `:focus-visible` niet toetsenbord-toegankelijk. Vandaar niet "verplaatsen" maar **weglaten**: toon een signaal alleen bij afwijking. Dat haalt ~80% van de badges weg zonder informatieverlies.
- **Master-detailpaneel** (lijst links, alle metadata rechts). Lost het badgeprobleem structureel op en biedt ruimte aan velden die nu nergens passen (geldigheidsduur, normgewicht, verwerkingshistorie). Niet nu gekozen: het kost altijd een klik vóór je detail ziet en valt weg op een smal scherm. Blijft open voor het moment dat het metadatamodel verder uitdijt.
- **Paginering boven 50 documenten per groep.** Afgewezen. Paginering breekt zoeken (een bestuurder die "herstelplan" typt verwacht een resultaat, geen pagina 3), breekt Ctrl+F en breekt printen/exporteren. Bovendien is een fondsbibliotheek doorgaans 50–300 documenten, niet 10.000. Belangrijker: het **echte** schaalprobleem zit niet in de weergave — `haalDocumenten()` haalt álle documenten in één fetch op en filtert client-side. Paginering verbergt dat en lost het niet op. Zie "Bewust geaccepteerd" hieronder.
- **`documenttype` overal verplicht, ook bij vergaderstukken en bewijsstukken.** Afgewezen: die stromen tonen de vraag niet, en er automatisch `bijlage` van maken zou een classificatie verzinnen die we niet kennen — in strijd met de guardrail "geen schijnzekerheid". Die paden houden `null`, exact zoals vóór dit besluit.
- **`bronstatus` bij aanlevering zonder capability-check.** Afgewezen, en dit is het scherpste punt van dit besluit: bronstatus heeft een eigen transitietabel met capability `documents.bronstatus.change` en redenplicht. Die bij aanlevering overslaan maakt van upload een **achterdeur** om precies die governance te omzeilen — upload in plaats van wijzig, en de poort geldt niet meer. De aanlevering wordt daarom doorgerekend als een gewone overgang vanaf de impliciete beginwaarde `actief`. Ditzelfde patroon staat al bij de statusverklaring (besluit 0136).
- **`actief_na_vaststelling` aanbieden bij aanlevering.** Afgewezen: die waarde is een *gevolg* van een statusovergang (capability `afgeleid`) en hoort niet met de hand gezet te worden. De keuzelijst wordt daarom **afgeleid uit de transitietabel** in plaats van handmatig opgesomd, zodat dit niet per ongeluk kan terugkeren.

## Gevolgen

**RLS / tenant-isolatie.** Geen wijziging. Geen nieuwe tabellen, policies, grants of `SECURITY DEFINER`-functies; de structurele gates zijn niet vereist.

**Datamodel / migraties.** **Geen migratie.** `documenten.documenttype` en `documenten.bronstatus` bestaan sinds `2026_06_18_documentstatus_metadata.sql`, inclusief hun CHECK-constraints. De statustrigger `trg_document_status_overgang` vuurt op `before update of status` en raakt een INSERT dus niet.

**Audit / reproduceerbaarheid.** Uitgebreid. Naast de bestaande statusregel (0136) schrijft de uploadroute nu ook een regel voor `documenttype` (`wijzig_type='metadata'`, `rag_impact=true`) en voor `bronstatus` (`wijzig_type='bronstatus'`, `rag_impact` uit de transitietabel). Alle drie dragen `oude_waarde='upload'` — dát is het kenmerk waaraan je in het log ziet dat de waarde bij **aanlevering** is verklaard en niet later gewijzigd. De auditregels zijn best-effort (falen blokkeert de upload niet), gelijk aan 0136.

**Gebruikers- en beheerervaring.** Uploaden kost één extra keuze (documenttype) en biedt één extra keuze (bronstatus). Daar staat tegenover dat de restgroep "Zonder type" en een deel van de review-achterstand niet meer ontstaan. De lijst gaat van ±6 naar ~17 documenten per scherm.

**Auditmarkering blijft staan.** "Via tekstherkenning" is verkort tot "Tekstherkenning" maar blijft **zichtbaar in de rij**. Besluit [`0020`](./0020-ocr-engine-mistral.md)/[`0134`](./0134-ocr-voor-fondsdocumenten-her-extract-pad.md) vraagt dat een bestuurder die een getal overneemt kan zien dat er een herkenningsstap tussen bron en citaat zit. Verplaatsen naar een detailpaneel of tooltip is daarmee een **besluitwijziging**, geen weergavekeuze. Vastgelegd als sanity-test.

**Bewust geaccepteerde schuld.** `haalDocumenten()` haalt nog steeds alle documenten in één fetch op en filtert client-side. "Toon er meer" beperkt wat er *getekend* wordt, niet wat er *opgehaald* wordt. Bij een fonds dat richting 500+ documenten groeit is server-side zoeken en filteren de eerste echte stap; pas daarna is paginering of virtualisatie aan de orde.

**Negatief gevolg.** De kolom "Bron" verdwijnt uit de fondsbibliotheek. Wie op bron wil scannen binnen het eigen fonds kan dat niet meer visueel; de waarde blijft wel vastgelegd, filterbaar en zichtbaar op de generieke tab (waar hij juist de meest informatieve kolom is).

## Referenties

- `core/lib/document-bijzonderheden.ts` + `.sanity.ts` — afleiding en formulering van de bijzonderheden (20 tests)
- `core/lib/document-ingest-classificatie.ts` + `.sanity.ts` — classificatie bij aanlevering (15 tests)
- `app/api/documents/upload/route.ts` — server-side poort en auditregels
- `app/(dashboard)/bibliotheek/page.tsx` — tabelweergave en uploadformulier
- `core/lib/document-status-transities.ts` — `BRONSTATUS_TRANSITIES`, bron van waarheid voor de poort
- Besluit [`0136`](./0136-statusverklaring-bij-ingest.md) — statusverklaring bij ingest, hetzelfde patroon
- Besluit [`0097`](./0097-tokens-mark-en-app-line-control.md) — kleur nooit de enige drager; de stipvormen (rond/ruit/vierkant) zijn de tweede drager
- Mockup `MOCKUP-bibliotheek-tabel-v0.3.html` (projectmap) — de goedgekeurde variant
