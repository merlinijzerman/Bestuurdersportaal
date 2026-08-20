# 0186 — Gedeelde kolomlijsten alleen bij herhaling

- **Status:** Geaccepteerd
- **Datum:** 2026-08-20
- **Betrokkenen:** Merlin IJzerman

## Context

De codebase kende tot nu toe geen enkele geëxporteerde kolomlijst: alle Supabase-projecties gaven hun kolommen inline mee aan `.select()`. Bij de voorbereiding van de eenheidsdimensie (V0, ticket bij plateau 1) was het voorstel om de projecties van `documenten`, `procedures`, `risicos` en `vergaderingen` samen te trekken tot vier constanten, zodat `eenheid_id` later op vier plekken kon worden toegevoegd in plaats van op ruim negentig.

Meting tegen de codebase liet zien dat die aanname niet houdbaar is. De 93 kolomlijsten van die vier objecten bestaan uit **76 unieke kolomsets**; bij `documenten` alleen al 41 unieke sets over 50 plekken. Het zijn overwegend smalle, doelgebonden projecties — `select("opslag_pad")` in het ingestpad, `select("agendapunt_id")` in de portaalcontext. Ze samentrekken tot één gedeelde lijst haalt op elke callsite méér kolommen op dan nu, en dat is een gedragswijziging, geen opruiming.

Daarnaast bleek de veronderstelde winst voor de eenheidsdimensie grotendeels afwezig: vijf van de acht lijst- en detailqueries van deze objecten gebruiken al `select("*")` en krijgen een nieuwe kolom automatisch mee.

De vraag werd daarmee een andere: niet "hoe trekken we alles samen", maar "wanneer verdient een kolomlijst een naam".

## Besluit

Een kolomlijst wordt een geëxporteerde constante in `core/lib/kolommen.ts` zodra dezelfde set **op twee of meer plekken** voorkomt **én de set een eigen betekenis heeft**. Komt een set één keer voor, dan blijft hij inline bij zijn callsite.

## Overwogen alternatieven

- **Eén gedeelde kolomlijst per object** (het oorspronkelijke voorstel) — verworpen. Verbreedt vrijwel elke projectie en verandert daarmee wat er over de lijn gaat, inclusief projecties die een API-response voeden. Dat is precies wat dit voorwerk niet mocht doen.
- **Een constante voor élke herhaalde set, ook micro-selects** (`id, titel` 5×, `id, fonds_id` 5×) — verworpen. Die callsites hebben toevallig dezelfde twee kolommen nodig, niet dezelfde bedoeling. Een gedeelde naam suggereert een samenhang die er niet is en koppelt callsites die los van elkaar horen te evolueren; `id, titel` is ter plekke bovendien leesbaarder dan een verwijzing.
- **Niets doen** — verworpen. Er komen met de eenheidsdimensie nieuwe projecties bij. Zonder afspraak vooraf groeit het aantal gekopieerde kolomlijsten mee, en dan is dezelfde opruiming later duurder.

## Gevolgen

- Vier objectconstanten plus twee voor `organisatie_profielen` in `core/lib/kolommen.ts`; acht callsites verwijzen ernaar. De opgehaalde kolommen zijn byte-identiek aan de situatie ervoor, programmatisch nagerekend tegen de `main`-versie van elk bestand.
- **RLS/tenant-isolatie:** geen impact. Dit raakt uitsluitend de projectie (welke kolommen), niet de selectie (welke rijen); die blijft volledig bij de policies.
- **Audit/reproduceerbaarheid:** geen impact; geen enkele gelogde actie verandert.
- **Datamodel/migraties:** geen. Nul wijzigingen in `supabase/`.
- De twee gelijknamige `PROFIEL_KOLOMMEN`-constanten waren **niet identiek**: de platformpagina las `fonds_id` mee, de API-route niet. Ze zijn daarom niet samengevoegd maar gesplitst in een basis (`ORGANISATIEPROFIEL_KOLOMMEN`) en een afgeleide variant (`…_MET_FONDS`). Samenvoegen zou `fonds_id` hebben toegevoegd aan de response van `GET /api/organisatieprofiel`. De naam is bewust gekwalificeerd naar `ORGANISATIEPROFIEL_*`, omdat `profielen` (persoonlijk gebruikersprofiel) een andere tabel is dan `organisatie_profielen`.
- **Bewust geaccepteerd:** de overige circa 480 inline projecties in de codebase blijven staan, evenals de vijf `select("*")`-queries. Die laatste betekenen dat een nieuwe kolom automatisch meelift naar de client; bij het toevoegen van `eenheid_id` (P1-4) moet per geval worden getoetst of dat gewenst is.
- **Valkuil bij onderhoud:** elke constante moet één stringliteral blijven. `supabase-js` leidt het rijtype af uit het literal type van het select-argument; een opgeknipte lijst (`"a, b" + "c, d"`) verdampt tot `string` en laat het rijtype terugvallen op `GenericStringError`. Dit is tijdens de uitvoering daadwerkelijk opgetreden en wordt nu in het bestand zelf toegelicht.

## Referenties

- `core/lib/kolommen.ts` — de constanten en het criterium.
- `core/lib/kolommen.sanity.ts` — bewaakt de scheiding basis/variant en de vorm van elke lijst.
- Ticket *V0 · Voorbereiding eenheidsdimensie* v0.2, §1 en §0-correcties 1–3.
