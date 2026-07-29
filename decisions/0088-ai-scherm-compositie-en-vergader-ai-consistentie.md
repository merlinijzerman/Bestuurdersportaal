# 0088 — AI-scherm-compositie (samengevoegde kopbalk) + vergader-AI gelijkgetrokken

- **Status:** Geaccepteerd
- **Datum:** 2026-07-29
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude Code (uitvoering)

## Context

Na de huisstijl-tranche (0084) en het AI-startpunt (0085) oogde het AI-scherm (`/ai`)
onrustig: drie kopbalken (topbar + brongebruik + antwoordmodus, samen ~200px chrome)
vóór de eerste inhoud, twee contentbreedtes boven elkaar (bubbel tot schermrand vs.
kaarten op 768px) en twee kaarttalen in één blok. De opdracht (plansessie 28-07) vroeg
de compositie op één lijn te brengen met de goedgekeurde referentiemockup, zónder
kleurtokens te wijzigen.

Eén onderdeel is een governance-keuze en geen smaakkwestie: de balken **brongebruik**
en **antwoordmodus** maken zichtbaar waaróp een antwoord steunt (transparantielijn van
0068 "antwoordmodi terug naar Auto + Sparren" en 0071 "agendavoorbereiding streaming +
bronmelding"). Ze samenvoegen/wegstoppen wint hoogte maar kost afleesbaarheid — bij een
bestuurdersportaal weegt dat zwaar.

Randvoorwaarden: geen tokenwaarde wijzigen (0084, geen dark mode), tokenlaag blijft de
enige bron van waarheid, geen RLS-/audit-/datamodelimpact, human-in-the-loop en
bronvermelding ongemoeid.

Tijdens de bouw zijn in dezelfde sessie enkele consistentie- en leesbaarheidskeuzes
toegevoegd, en is de **vergader-AI** (`AgendapuntChat`) opnieuw gelijkgetrokken met
`/ai` — in het verlengde van 0079 ("agenda-assistent gedeelde weergave").

## Besluit

De drie kopbalken op `/ai` worden **één balk** waarin brongebruik een **compacte chip
met zichtbare stand** is ("Bron: automatisch / alleen fondsdocumenten", met de
aanpas-popover en het collectief-signaal behouden) en de antwoordmodus als segmented
control **zichtbaar blijft** — governance-transparantie blijft dus intact, alleen de
volzin wordt een chip. Verder wordt de presentatie van AI-antwoorden **ontblokt**
(platte tekst op het canvas i.p.v. een wit kaartje; alleen de gebruikersbubbel houdt
een bubbel), en worden `/ai` en de **vergader-AI** consistent gemaakt, inclusief de
gefaseerde **statusweergave** (0087) via een gedeeld component.

## Overwogen alternatieven

- **Kopbalken behouden (structuur ongewijzigd)** — eerder de juiste keuze tijdens de
  kleurtranche, maar hier is rust het doel; ~200px chrome vóór de inhoud is de grootste
  bron van onrust. Verworpen.
- **Volledig samenvoegen én brongebruik/antwoordmodus achter een popover verbergen** —
  wint de meeste hoogte, maar verbergt de governance-informatie. Verworpen wegens
  afleesbaarheid (0068/0071).
- **Middenpad: één balk met bron-chip-met-stand + zichtbare antwoordmodus** — wint
  ~160px zonder informatieverlies. **Gekozen.**
- **Vergader-AI presentatie los laten van `/ai`** — zou opnieuw divergeren (het euvel
  dat 0079 juist ophief). Verworpen; in plaats daarvan de gedeelde weergave uitgebreid
  (ontblokt antwoord, tabel-rendering, en de statusweergave via een gedeeld component
  `Voortgang.tsx`).

## Gevolgen

- **UX:** rustiger AI-scherm; gedeelde contentkolom (1020px, mockup `.wrap`) zodat
  bubbels en startpuntkaarten dezelfde randen delen; uniforme kaartbehandeling met
  hover-elevatie; serif-startpuntkop ("Waar werkt u nu aan, {voornaam}?") vervangt de
  begroetingsbubbel op de lege staat; AI-avatar verwijderd; dubbele bron-uitleg uit de
  begroeting; markdown-tabellen renderen nu als echte tabel binnen de kolom.
- **Governance/transparantie:** brongebruik en antwoordmodus blijven zichtbaar en
  bedienbaar; de volledige bron-uitleg staat in de chip-tooltip. Geen informatieverlies
  t.o.v. 0068/0071.
- **Consistentie:** de vergader-AI (`AgendapuntChat`) toont AI-antwoorden ontblokt, met
  een wit paneel zodra uitgeklapt, en de gefaseerde statusweergave van `/ai` (0087) voor
  de agenda-**vervolgvragen** (zie reikwijdte hieronder). De statuslogica (type + pure
  reducer + weergave) leeft nu in het gedeelde
  `app/(dashboard)/ai/_components/Voortgang.tsx`, zodat `/ai` en de agenda niet opnieuw
  uiteenlopen (verlengstuk van 0079/0087).
- **Overige UX (klein):** de hele agendapunt-kop is klikbaar om uit/in te klappen (met
  `stopPropagation` op de knoppen erin); de "Lees samenvatting"-inhoud staat ontblokt op
  de kaartachtergrond; in de documentbibliotheek is de **Fondsbibliotheek** de
  standaard-eerste tab.
- **Tokens:** enige toevoeging is `--shadow-card-hover` in `app/globals.css` (zelfde
  ink-basis als `--shadow-card`) + mapping `boxShadow["card-hover"]` in
  `tailwind.config.ts`. **Geen** bestaande tokenwaarde gewijzigd; geen dark mode;
  `npm run lint:colors` groen.
- **Geen** impact op RLS/tenant-isolatie, audit/reproduceerbaarheid, datamodel of
  migraties. Human-in-the-loop, bronvermelding en append-only audit ongemoeid.
- **Reikwijdte statusweergave (bewust):** de gefaseerde statusregels verschijnen in de
  agenda-context alleen bij de **vervolgvragen die via `/api/chat` lopen** — die route
  stuurt `{type:"progress"}`-fase-events (0087). De **rijke voorbereidingsgeneratie**
  (`app/api/agendapunten/[id]/voorbereiding/route.ts`) stuurt uitsluitend
  `meta → delta → done/error` en dus géén fase-events; daar toont `VoortgangWeergave` de
  fallback (typ-indicator). Beide componenten delen wél dezelfde weergavecode, zodat de
  status identiek is zodra fase-events binnenkomen. De voorbereidingsroute later óók
  fase-events laten sturen is een mogelijk vervolgpunt. De begroetingsbubbel verschijnt
  in een lopend gesprek nog wel als platte tekst (alleen op de lege staat vervangen door
  de serif-kop).
- **Tests:** `pasVoortgangToe` in `Voortgang.tsx` is een pure, gedrags-behoudende
  extractie van de voorheen inline (en ongeteste) reducer-/renderlogica uit
  `AssistentClient`, en valt buiten de risicocategorieën uit `CLAUDE.md`
  (stemming/readiness/procedurestatus/audit/permissie/stuurinfo/AI-validatie). Daarom
  bewust geen aparte sanity-test; gedrag geborgd via `tsc` groen, de eindreview en
  browser-smoke. Een sanity-test vergt eerst de reducer naar `core/lib/` te verplaatsen
  (de `npm run sanity`-runner scant alleen `core/lib`/`platform/lib`) — genoteerd als
  optioneel vervolgpunt.

## Referenties

- Code: `app/(dashboard)/ai/_components/AssistentClient.tsx`, `Startpunt.tsx`,
  `AntwoordWeergave.tsx`, `Voortgang.tsx` (nieuw);
  `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx`, `AgendapuntKaart.tsx`;
  `app/(dashboard)/bibliotheek/page.tsx`; `app/globals.css`; `tailwind.config.ts`.
- Besluiten: [`0084`](./0084-huisstijl-t1-violet-accent-teal-fase-lichte-nav.md),
  [`0085`](./0085-ai-startpunt-p1-ingang-ipv-leeg-invoerveld.md),
  [`0087`](./0087-ai-voortgang-zichtbaar-foutcontract-en-niet-gelogd.md),
  [`0068`](./0068-antwoordmodi-terug-naar-auto-en-sparren.md),
  [`0071`](./0071-agendavoorbereiding-streaming-en-bronmelding.md),
  [`0079`](./0079-agenda-assistent-gedeelde-weergave.md).
- Referentiemockup: `03 Functioneel ontwerp/Designrichtingen portaal/startpunt-flow.html`
  — staat **buiten** de git-repo, één niveau boven `mvp/` in de projectmap (niet
  repo-relatief resolvebaar vanuit `mvp/`).
