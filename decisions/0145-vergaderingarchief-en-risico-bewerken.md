# 0145 — Vergaderingarchief, risico's bewerkbaar, en een onleesbare heatmap hersteld

- **Status:** Geaccepteerd
- **Datum:** 2026-08-07
- **Betrokkenen:** Merlin IJzerman (product/opdrachtgever)

## Context

Drie losse waarnemingen die bij nader inzien allemaal hetzelfde patroon hebben: een scherm dat werkt bij vijf objecten en stilzwijgend faalt bij vijftig.

**1. De vergaderingenlijst kapte al af.** De wens was een archief zodat afgelopen vergaderingen niet oneindig in de lijst blijven staan. Bij het lezen van de code bleek het probleem groter: `afgelopen.slice(0, 10)` — een **stille cap**. Vergadering elf en verder waren op die pagina al onvindbaar, zonder dat er iets op het scherm stond dat aangaf dat er meer was. Dat is erger dan een te lange lijst: een te lange lijst is zichtbaar, een afgekapte niet.

**2. Een aangemaakt risico was onherstelbaar.** Er bestond alleen `POST /api/risicos` en `[id]/sluiten`; geen PATCH. Een verkeerd ingeschatte kans, een tikfout in de titel of een gewijzigde eigenaar kon alleen worden "gecorrigeerd" door het risico te sluiten en opnieuw aan te maken. Dat knipt de geschiedenis van dat risico in tweeën en maakt het logboek onbruikbaar voor de vraag die een risicomatrix moet beantwoorden: hoe heeft dit risico zich ontwikkeld?

**3. De tekst in de heatmap was feitelijk onleesbaar.** De risico-pil gebruikte `bg-err` met `text-err-ink` — donkerrood op donkerrood. Nagerekend op de waarden in `app/globals.css`:

| pill | contrast | WCAG 1.4.3 (4,5:1) |
|---|---|---|
| hoog | **1,24:1** | ✗ |
| middel | **1,30:1** | ✗ |
| laag | **1,26:1** | ✗ |

De tokenlaag bedoelt `-ink` expliciet als tekst óp de `-tint`, niet op de DEFAULT — dat staat zo in de commentaren bij de tokens. Met `-ink` op `-tint` wordt het 8,09 / 7,16 / 7,50. Dit is dus geen ontwerpkeuze maar een correctie op een verkeerd gebruikte token. Daarnaast toonde de cel `slice(0, 2)` plus "+N meer" in een vaste hoogte: bij veel risico's zag je per cel hooguit twee namen en was de rest niet bereikbaar vanuit de heatmap.

## Besluit

1. **Vergaderingen zijn handmatig te archiveren**, via twee eigen kolommen (`gearchiveerd_op`, `gearchiveerd_door`) en niet via een vierde statuswaarde. Het archief is een uitklapbaar blok onderaan de lijst. De stille cap van tien vervalt.
2. **Archiveren mag pas als de vergaderdatum verstreken is**, ongeacht status, en is omkeerbaar. Iedereen binnen het fonds mag het.
3. **Een actief risico is bewerkbaar** via `PATCH /api/risicos/[id]`, met **redenplicht op de weging** (kans, impact, niveau, niveau_handmatig) en niet daarbuiten.
4. **De heatmap-pil krijgt `-ink` op `-tint`**, en de cel toont het **aantal** met een klik die de volledige lijst van die cel opent. Legenda en verdeling worden uitklapbaar.

## Overwogen alternatieven

- **Archiveren als vierde statuswaarde (`status = 'gearchiveerd'`).** Afgewezen. `status` modelleert de voortgang van de voorbereiding (gepland → in_voorbereiding → afgerond); archivering staat daar los van en zegt iets over zichtbaarheid. Als vierde waarde zou een afgeronde vergadering bij archivering de informatie verliezen dát ze afgerond was — precies wat je later wilt terugzien. Bijkomend: de CHECK-constraint op `status` blijft nu ongemoeid en bestaande rijen worden niet geraakt.
- **Automatisch archiveren na X maanden.** Afgewezen: dan verdwijnt materiaal buiten het zicht van het bestuur zonder dat iemand daarvoor koos. Handmatig, omkeerbaar en met auditregel is de eerlijker vorm.
- **Archiveren pas toestaan bij status `afgerond`.** Afgewezen: een vergadering die nooit netjes is afgerond zou dan eeuwig in de lijst blijven staan — de aanleiding van dit besluit. De datum is het criterium.
- **Archiveren beperken tot voorzitter/beheerder.** Overwogen en niet gekozen (opdrachtgever): archiveren verwijdert niets, is omkeerbaar en laat een auditregel achter, wat het een lichte handeling maakt. Het **wijzigen** van de vergaderkop houdt wél zijn bestaande rolmodel (aanmaker + voorzitter/beheerder); die twee zijn bewust níet gelijkgetrokken.
- **Archiveren toevoegen aan de bestaande `PATCH /api/vergaderingen/[id]`.** Afgewezen: die route weigert élke wijziging aan een afgeronde vergadering ("het verslagleggingsobject ligt dan vast"). Terecht voor titel en datum — maar het is juist de afgeronde vergadering die je wilt archiveren. Archivering daaronder schuiven zou die governance-regel moeten verzwakken. Een eigen route houdt beide scherp.
- **Redenplicht bij élke risicowijziging.** Afgewezen: een tikfout in een titel corrigeren levert dan lege motiveringen op ("typo"), wat het auditspoor eerder vervuilt dan verrijkt. De redenplicht ligt op de velden die de plek in de heatmap bepalen — dezelfde gedachte als `GOVERNANCE_KRITIEKE_VELDEN` bij documenten.
- **Niveau overnemen zoals de client het aanlevert.** Afgewezen: dan kan een client het niveau losweken van kans × impact zonder dat daar bewust voor gekozen is. Het niveau wordt server-side afgeleid, tenzij `niveau_handmatig` aanstaat. Vastgelegd als regressiepin.
- **Heatmapcellen laten meegroeien met de inhoud.** Afgewezen: bij ongelijke verdeling wordt het raster scheef en past het niet meer op één scherm, terwijl juist de rastervorm de leesbaarheid draagt. Vaste hoogte, aantal als primaire drager, klik voor de lijst.
- **De volledige lijst per cel in een tooltip.** Afgewezen: werkt niet op tablet en is niet toetsenbordtoegankelijk. De lijst klapt daarom onder het raster uit, en de cel is een `<button>` zodat hij vanzelf bereikbaar en aankondigbaar is.

## Gevolgen

**RLS / tenant-isolatie.** Geen wijziging. Geen nieuwe tabellen, policies, grants of `SECURITY DEFINER`-functies; de structurele gates zijn niet vereist. Beide nieuwe routes doen naast RLS een expliciete fondscheck, zodat een verkeerde tenant een leesbare 403 krijgt in plaats van een stille 404 uit de policy.

**Datamodel / migraties.** **Eén migratie**, `2026_08_07_vergadering_archiveren.sql` (+ ROLLBACK): twee kolommen op `vergaderingen`, een partiële index op de niet-gearchiveerde rijen, en een verbreding van de CHECK op `vergadering_log.event_type` met twee eigen eventtypes. **Handmatig in de Supabase SQL-editor te draaien vóór de code-deploy** — daarna faalt anders elke SELECT op de nieuwe kolommen. Het risico-deel vereist géén migratie: `risico_log.event_type` heeft geen CHECK.

**Audit / reproduceerbaarheid.** Uitgebreid op twee plekken. Archiveren en terughalen schrijven een append-only regel in `vergadering_log` met een **eigen** eventtype (`vergadering_gearchiveerd` / `vergadering_gedearchiveerd`), zodat "de kop is aangepast" en "de vergadering is uit de lijst gehaald" in het log uit elkaar te houden zijn; de payload draagt een titel-snapshot zodat de regel zelfstandig leesbaar blijft. Een risicowijziging schrijft `risico_gewijzigd` met de volledige diff (oud → nieuw per veld), leesbare veldlabels, de motivering en de vlag `raakt_weging` — die vlag maakt later filterbaar wélke wijzigingen de bestuurlijke weging hebben geraakt. Beide best-effort: een mislukte logregel mag een geslaagde mutatie niet verhullen, maar wordt wel zichtbaar gemaakt in de serverlog.

**Toegankelijkheid.** Drie pillen gaan van ~1,3:1 naar ~7,5:1. De heatmapcel wordt een `<button>` en daarmee toetsenbordbereikbaar; de uitgeklapte lijst staat onder het raster in plaats van in een tooltip.

**Gebruikers- en beheerervaring.** De vergaderingenlijst toont voortaan **alles** wat niet gearchiveerd is — bij een fonds met veel historie kan die lijst dus eerst langer worden voordat er is gearchiveerd. Dat is bewust: liever zichtbaar te lang dan onzichtbaar afgekapt. De archiveerknop verschijnt alleen als archiveren daadwerkelijk mag; bij een komende vergadering staat er geen knop die een foutmelding oplevert (UX-principe "maak vereisten en blokkers expliciet"). In de bewerkmodal verschijnt het motiveringsveld zodra de weging wordt aangeraakt, met de uitleg erbij — niet als foutmelding erna.

**Bewust geaccepteerde schuld.** Een **gesloten** risico blijft onwijzigbaar: het archief legt vast hoe het bestuur het destijds heeft gewogen, en dat achteraf bijstellen zou die vastlegging waardeloos maken. Heropenen bestaat daarmee (nog) niet als handeling. Verder: de vergaderingenpagina haalt nog steeds alle vergaderingen in één query op; bij een fonds met honderden vergaderingen wordt het archief-array groot ook als het blok dicht staat. Dezelfde afweging als bij de bibliotheek (besluit 0140) — server-side filteren is daar de eerste echte stap.

## Referenties

- `core/lib/vergadering-archief.ts` + `.sanity.ts` — archiveerregels en de driedeling van de lijst (11 tests)
- `core/lib/risico-wijziging.ts` + `.sanity.ts` — weegvelden, redenplicht, niveau-afleiding en diff (20 tests)
- `supabase/migrations/2026_08_07_vergadering_archiveren.sql` (+ ROLLBACK)
- `app/api/vergaderingen/[id]/archief/route.ts`, `app/api/risicos/[id]/route.ts`
- `app/(dashboard)/vergaderingen/_components/VergaderingenLijst.tsx`
- `app/(dashboard)/risicomatrix/_components/Heatmap.tsx`, `ZijpaneelBlok.tsx`, `RisicoEditModal.tsx`
- Besluit [`0097`](./0097-tokens-mark-en-app-line-control.md) — de tokenrollen (`-ink` hoort op `-tint`) waarvan de heatmap afweek
- Besluit [`0140`](./0140-bibliotheek-tabelweergave-en-classificatie-bij-aanlevering.md) — zelfde patroon: een scherm dat stil faalt bij schaal
