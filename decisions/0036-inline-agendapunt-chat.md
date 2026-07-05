# 0036 — Inline AI-assistent per agendapunt (geen navigatie naar /ai)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-05
- **Betrokkenen:** Merlin (opdrachtgever/PO), Claude (bouw)

## Context

De vergadervoorbereiding bood twee AI-instappunten die beide naar de aparte AI-pagina navigeerden (`/ai?agendapunt=` en `/ai?doc=`, besluit 0028). De bestuurder verloor daarmee de vergadercontext (agenda, stukken, inbreng) op het moment dat hij de assistent nodig had. Daarnaast gaf de automatische voorbereiding (drie kritische vragen + lenzen) onvoldoende herleidbaarheid en bestuurlijke betekenis: er was geen interactie mogelijk en bronnen waren in de UI niet zichtbaar per uitspraak. Randvoorwaarden: hergebruik van de bestaande chat-route (RLS, governance-logging, bronvalidatie), geen schemawijziging, en gesprekken moeten auditeerbaar/terugvindbaar blijven.

## Besluit

De AI-assistent wordt inline in de agendapuntkaart aangeboden (uitklapbare chat, component `AgendapuntChat`), gescoped op het agendapunt (ADR 0028-framing + gekoppelde stukken als retrieval-scope), met opslag per agendapunt in de bestaande `gesprekken`-tabel in hetzelfde payload-formaat als de AI-pagina — zodat gesprekken over en weer hervat kunnen worden.

## Overwogen alternatieven

- **Zij-paneel naast de vergaderpagina** — beste balans overzicht/interactie, maar zwaardere UI-ingreep; afgewezen voor MVP door de opdrachtgever (inline gekozen).
- **Modal/overlay** — veel gespreksruimte, maar het stuk verdwijnt uit beeld tijdens het vragen stellen.
- **Alleen link naar /ai behouden (status quo)** — vereist contextswitch; precies het probleem dat aanleiding was.
- **Rendering hergebruiken uit `ai/page.tsx`** — vermijdt duplicatie, maar vergt refactor van een bestand van ±1900 regels met regressierisico; bewust een eigen, compacte renderer gebouwd (geaccepteerde, beperkte duplicatie van marker-parsing).

## Gevolgen

- **UI**: `AgendapuntKaart` toont een uitklapbare chat i.p.v. de link; startvragen-chips (o.a. "bestuurlijke duiding"); inline `[Bron N]`-pills + uitklapbaar "Onderbouwing en bronnen"-blok per antwoord; disclaimer "AI-hulpmiddel — geen bestuurlijk advies".
- **RLS/tenant-isolatie**: ongewijzigd — zelfde `/api/chat`-route, zelfde `gesprekken`-RLS (alleen-auteur), geen migratie.
- **Audit/reproduceerbaarheid**: elke vraag blijft via de bestaande route in `governance_log` komen; gesprekken per agendapunt terugvindbaar via `document_scope->agendapunt_context->>id`.
- **Geaccepteerde schuld**: beperkte duplicatie van de marker-rendering (compacte variant) t.o.v. `ai/page.tsx`; consolidatie kan later als gedeelde component.
- **Open punt**: de automatische voorbereiding (`VoorbereidingsBlok`) is ongewijzigd; herstructurering (bestuurlijke duiding als default + bronweergave) is een volgend increment.

## Referenties

- Code: `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx` (nieuw), `AgendapuntKaart.tsx` (gewijzigd)
- Backend (hergebruik): `app/api/chat/route.ts`, `lib/agendapunt-context.ts`
- Eerdere besluiten: 0028 (agendapunt-toelichting als seed-context)
