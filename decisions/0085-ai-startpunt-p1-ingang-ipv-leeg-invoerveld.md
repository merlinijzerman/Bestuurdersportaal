# 0085 — AI-startpunt P1: een ingang in plaats van een leeg invoerveld

- **Status:** Geaccepteerd
- **Datum:** 2026-07-28
- **Betrokkenen:** Merlin (opdrachtgever/PO), Claude (bouw)

## Context

`/ai` opende met een leeg invoerveld en vier statische `VOORGESTELDE_VRAGEN`-chips. Voor een bestuurder die het portaal een paar keer per maand opent is dat het minst behulpzame startpunt: hij moet zelf bedenken wat te vragen. Tegelijk staat de rijkste AI-functionaliteit (de agendavoorbereiding met bestuurlijke duiding en drie kritische vragen) alléén op de vergaderpagina, waar je hem moet weten te vinden. Dit is een **vindbaarheidsprobleem**, geen functionaliteitsgat.

Randvoorwaarden: geen nieuwe AI-aanroep/prompt/antwoordmodus (RLS + append-only audit + human-in-the-loop blijven ongemoeid); privacy van voorbereidingen (privé per gebruiker); geen fonds uit de URL; geen extra query-waterval bovenop de layout; `lint:colors` groen. Dit is plateau 1 (P1) van een reeks P1–P5 (zie `AI-STARTPUNT-ONTWERP.md`).

## Besluit

Twee samenhangende besluiten:

**1. Het startpunt vervangt het lege invoerveld op `/ai`.** De `VOORGESTELDE_VRAGEN`-chips worden vervangen (niet aangevuld) door een startscherm met een blok "Speelt nu voor u" (max drie server-afgeleide contextkaarten: eerstvolgende vergadering + eigen-inbreng-telling, eerstvolgende eigen actieve processtap, meest recent toegevoegd fondsdocument — lege kaarten weggelaten) en een blok "Wat wilt u doen" (drie taakknoppen die routeren of scope zetten). Het startscherm verdwijnt zodra er een bericht, een documentscope of een agendapunt-scope is; dan gedraagt `/ai` zich exact zoals voorheen.

**2. Twee ingangen naar dezelfde agendavoorbereiding — `/ai` routeert uitsluitend.** De voorbereiding is vanaf nu bereikbaar via de vergaderpagina én via de taakknop "Een agendapunt voorbereiden" op `/ai`. Die knop is een **deeplink** (`/vergaderingen/{vergaderingId}#agendapunt-{agendapuntId}`) naar het bestaande anker; er komt géén tweede implementatie van de voorbereiding bij. `AgendapuntChat`, `VoorbereidingsBlok` en `AntwoordWeergave` blijven ongewijzigd.

## Overwogen alternatieven

- **Startscherm naast de chips laten staan** — halfslachtig; het lege-invoerveld-probleem blijft. Afgewezen: de chips zijn vervangen, niet aangevuld.
- **Architectuur B — API-route (`/api/startpunt`)** die de client-component aanroept. Raakt `page.tsx` niet, maar geeft een extra round-trip, een tragere eerste weergave, zet de tenantcontrole in een tweede laag en introduceert een nieuw API-contract (zwaardere documentatiehaak). Afgewezen ten gunste van **Architectuur A — server-wrapper**: `page.tsx` wordt een server-component die de context ophaalt en de (mechanisch verhuisde) client-component `AssistentClient.tsx` rendert. Schoon en snel, geen extra round-trip.
- **`vereisModuleToegang("ai", …)` in de server-wrapper** (zoals de werkopdracht suggereerde). Afgewezen omdat er **geen `ai`-capability** bestaat en `/ai` vóór P1 **geen server-modulegate** had (de `(dashboard)`-layout dwingt auth + host→fonds al af; het manifest stuurt enkel nav-zichtbaarheid). Een `ai.view` toevoegen zou het capability-/rolmodel en de moduleregistry wijzigen, en een manifest-`notFound()` zou het gedrag wijzigen. In plaats daarvan repliceert de wrapper de huidige effectieve gate exact via een **sessie-only afleiding** (`haalFondsSessie()` binnen `getPortaalContext()`). Een echte `/ai`-modulegate is een eigen besluit en valt buiten P1.
- **Tweede implementatie van de voorbereiding op `/ai`** — snel, maar herintroduceert precies de duplicatie die 0036 accepteerde en 0079 opruimde. Principieel uitgesloten.

## Gevolgen

- **UX (positief):** `/ai` presenteert zich taakgericht in plaats van conversationeel; de bestuurder ziet meteen wat er speelt en heeft drie concrete ingangen.
- **UX (bewust geaccepteerd nadeel):** de intensieve gebruiker die direct wil typen, krijgt één extra scherm tussen zich en het invoerveld. **Mitigatie:** de taakknop "Een vrije vraag stellen" staat direct op het startscherm en zet de cursor meteen in het (altijd zichtbare) invoerveld; en het startscherm verdwijnt zodra een gesprek loopt of uit de historie wordt hersteld.
- **Onderhoud (bewust geaccepteerde schuld):** er zijn nu twee ingangen naar de agendavoorbereiding. Dat is aanvaardbaar omdat `/ai` **uitsluitend routeert** (deeplink naar het bestaande anker) en een tweede implementatie principieel is uitgesloten. Dit is de schuld die 0036 accepteerde en 0079 opruimde; die lijn wordt hier bewust vastgehouden.
- **Architectuur:** de client-component `ai/page.tsx` is mechanisch verhuisd naar `_components/AssistentClient.tsx` (diff = pad + relatieve importpaden + de `startpuntContext`-prop + de startpunt-swap). De contextqueries zijn uit `app/(dashboard)/page.tsx` geëxtraheerd naar de gedeelde helper `core/lib/portaalcontext.ts` (`React.cache()`-gededupliceerd). De homepage rendert functioneel identiek (zelfde queries, volgorde, tellingen; JSX ongewijzigd).
- **RLS/tenant-isolatie:** ongewijzigd. De helper leest uitsluitend via de anon-key-RLS-client, fonds afgeleid uit de sessie (nooit uit de URL). "Agendapunten zonder inbreng" telt uitsluitend de **eigen** inbreng — geen privacylek naar andermans inbreng/voorbereiding.
- **Audit/reproduceerbaarheid:** ongewijzigd. Geen nieuwe AI-interactie, dus geen nieuw `governance_event`.
- **Datamodel/migraties:** géén. Geen schema-, RLS- of API-contractwijziging.
- **Verificatie:** `tsc --noEmit --skipLibCheck` groen; `lint:colors`, `lint:boundaries` groen; nieuwe `portaalcontext.sanity.ts` groen (10 tests); nieuwe cross-tenant guard `tests/cross-tenant/portaalcontext-privacy.test.ts` groen (5 tests — o.a. de privacy-single-lock `.eq("gebruiker_id", …)` en de fonds-scope van de documenten-read); cross-tenant app-laag groen. De "max 1×-query-per-render"-eis is structureel geborgd (precies één call-site per oppervlak + `React.cache()`); er is bewust géén tijdelijke dev-logging achtergelaten. *Openstaand:* de authenticated browser-smoke + de 2-account-privacycheck binnen één fonds (vereist inlog). Los hiervan: `npm run sanity` is aggregaat-rood door een **pre-existing** falende `generatie-kern.sanity.ts` (faalt ook op een schone tree; buiten scope P1).

## Referenties

- Code (nieuw): `core/lib/portaalcontext.ts`, `core/lib/portaalcontext-afleiding.ts` (pure logica), `core/lib/portaalcontext.sanity.ts`, `app/(dashboard)/ai/_components/Startpunt.tsx`, `app/(dashboard)/ai/_components/AssistentClient.tsx` (verhuisd), `app/(dashboard)/ai/loading.tsx`.
- Code (gewijzigd): `app/(dashboard)/ai/page.tsx` (server-wrapper), `app/(dashboard)/page.tsx` (queries → helper).
- Ontwerp: `AI-STARTPUNT-ONTWERP.md` (plateau-indeling P1–P5).
- Eerdere besluiten: **0036** (inline agendapunt-chat — accepteerde de duplicatieschuld), **0079** (gedeelde AntwoordWeergave — ruimde die op; deze P1 houdt de "alleen routeren"-lijn vast), **0068** (zichtbare antwoordmodi teruggebracht — `besluitrijpheid`/`persoonlijke_voorbereiding` krijgen hier bewust géén knop), **0028** (agendapunt-toelichting/anker).
