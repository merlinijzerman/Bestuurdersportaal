# 0023 — Synchrone OCR-fallback in de generieke curatie-pipeline

- **Status:** Geaccepteerd
- **Datum:** 2026-06-24
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude (uitvoering/advies)
- **Relatie:** addendum op [`0020`](./0020-ocr-engine-mistral.md) (Mistral OCR-engine) en [`0022`](./0022-increment-P1-generieke-curatie-keuzes.md) (Increment P1, generieke curatie). Hergebruikt `lib/ocr.ts` ongewijzigd.

## Context

De generieke curatie-pipeline (`lib/generiek-pipeline.ts`, Increment P1) deed in de extractie-stap alleen de goedkope tekstlaag-extractie (`extractTekst`, unpdf/pdfjs). Een beeld-only/gescande PDF leverde nul tekst op → het document strandde op `verwerkingsstatus='mislukt'` met foutcode `geen_tekst`, en kwam de RAG-pipeline (chunk → embed → search) nooit in. De `ocr`-stap was een expliciete `overgeslagen`-job (placeholder), geen echte OCR.

Concreet gevonden bij de eerste live-upload: de **DNB Good Practice ESG-Risicobeheer Pensioenfondsen (22 pg)** — exact één van de 2 "hoogwaardige" OCR-kandidaten die `0020` al identificeerde — heeft 0 `/Font`-objecten en 44 `/Image`/`/XObject`-objecten: een beeld-PDF zonder tekstlaag. Geverifieerd met de eigen extractie (0 tekst-items op alle 22 pagina's; unpdf `extractText` → 1 teken).

`0020` zette synchrone OCR **bewust niet** in de tenant-*upload*-route, vanwege Vercel-serverless-timeouts; OCR draaide alleen in de laagfrequente `her-extract`-route (+ bulk-script). De vraag was nu: OCR ook in de generieke *upload*-pipeline?

## Besluit

We bekabelen `extractTekstMetOcrFallback` (uit `lib/ocr.ts`) in de generieke curatie-pipeline, ter vervanging van de directe `extractTekst`-aanroep. Dit is een **bewuste, begrensde afwijking** van `0020`'s "live synchrone OCR in de upload-route blijft default uit":

- De generieke curatie is **platform back-office, laagfrequent, één curator**, en draait achter `withPlatform` (service-role + capability + audit). Het risicoprofiel is gelijk aan de reeds geaccepteerde `her-extract`-route, **niet** aan de high-volume tenant-upload waarvoor `0020` synchrone OCR weerde.
- **Timeout-mitigatie:** `export const maxDuration = 300` op de curatiepagina (`generieke-bibliotheek/page.tsx`); de server-actions van die pagina erven de route-segment-limiet. Vereist het Vercel **Pro**-plan (+ fluid compute) — bevestigd aanwezig.

## Gevolgen

- **Code:** `lib/generiek-pipeline.ts` roept nu `extractTekstMetOcrFallback` aan; de `ocr`-job logt `geslaagd` als OCR is toegepast, anders `overgeslagen`. `lib/ocr.ts` en `lib/document-extractie.ts` blijven ongewijzigd.
- **Datamodel:** geen nieuwe migratie. De audit-kolommen `documenten.ocr_toegepast`/`ocr_engine` (migratie `2026_06_22x_ocr_audit.sql`, uit `0020`) worden nu ook door de generieke pipeline gevuld.
- **RLS/tenant-isolatie:** ongewijzigd. De pipeline draaide al achter `withPlatform` (service-role); geen anon-key-pad geraakt.
- **Audit/reproduceerbaarheid:** `ocr_toegepast`/`ocr_engine` per generiek document; OCR is een afgeleide bewerking op ongewijzigde broninhoud (append-only intact).
- **Bewust geaccepteerd / open:**
  - *Vercel-timeout* — gemitigeerd met `maxDuration=300` (Pro). Een extreem groot scan-document met herhaalde OCR-retries (max 4×60s) zou alsnog richting de limiet kunnen lopen; bij waarneming overstappen op async/queue.
  - *Vendor-concentratie* (Mistral voor embeddings én OCR) — al afgewogen in `0020`.
  - *Drempel 50 tekens/pg* — overgenomen uit `0020`; bij deels-gescande docs monitoren.
- **Niet in scope:** async/queue-OCR, OCR voor de tenant-upload-route (blijft `0020`-conform uit), wijziging aan chunking/embedding.

## Referenties

- `lib/generiek-pipeline.ts` (integratie), `lib/ocr.ts` (`extractTekstMetOcrFallback`)
- `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/page.tsx` (`maxDuration`)
- `app/api/documents/[id]/her-extract/route.ts` (referentiepatroon uit `0020`)
- migratie `supabase/migrations/2026_06_22x_ocr_audit.sql`
- [`0020`](./0020-ocr-engine-mistral.md), [`0022`](./0022-increment-P1-generieke-curatie-keuzes.md)
