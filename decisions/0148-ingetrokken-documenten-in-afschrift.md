# 0148 — Ingetrokken documenten in een afschrift: nooit meenemen

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman (besluit), Claude Code

## Context

`GET /api/documents/[id]/bestand` geeft bewust 410 (Gone) bij `documenten.actief = false` (bevinding H-08): een ingetrokken document is niet meer in te zien. Een afschrift dat het verleden reconstrueert zou zo'n bijlage juist wél kunnen willen, gemarkeerd als "ingetrokken op ⟨datum⟩, was geldig ten tijde van het besluit". Technisch kán de worker de bytes ophalen: de 410 zit op de app-route, niet op de storage-RLS, en de service-role-worker leest storage rechtstreeks. Dit botst dus met een bewuste beveiligingsregel en verdient een expliciet besluit — geen stille uitzondering in de zip-route.

## Besluit

Ingetrokken documenten (`actief = false`) worden **nooit** in een afschrift opgenomen — niet bij `versie=actueel` en niet bij `versie=besluitmoment`. Ze worden in `MANIFEST.json` vermeld in `uitgesloten_items` met reden `ingetrokken`, zodat de zip niet stilzwijgend onvolledig lijkt.

## Overwogen alternatieven

- **Wél meenemen bij `besluitmoment`, niet bij `actueel`** (het ticketvoorstel) — reconstrueert het besluitmoment getrouwer, maar doorbreekt H-08 en vereist een bewuste 410-bypass in het zip-pad. Verworpen door de opdrachtgever: de eenvoud en de strikte aansluiting op H-08 wegen zwaarder dan de volledigheid van het besluitmoment.
- **Altijd meenemen** — maximale reconstructie, zwakste aansluiting op de afscherming; verworpen.

## Gevolgen

- **Audit:** een besluitmoment-afschrift kan een stuk missen dat destijds wél voorlag; dat is **expliciet zichtbaar** in `uitgesloten_items` (reden `ingetrokken`), dus geen schijnzekerheid.
- **Security:** de H-08-afscherming blijft onverkort gelden; geen tweede leespad om `actief=false` heen.
- **Code:** `platform/lib/afschrift-orchestrator.ts` sluit `actief=false`-bijlagen uit vóór de download.

## Referenties

- Werkopdracht T6 v1.0, ADR-3 (voorstel herzien door opdrachtgever). Bevinding H-08 (`app/api/documents/[id]/bestand/route.ts`). [[0146-afschrift-als-vastgelegd-record]].
