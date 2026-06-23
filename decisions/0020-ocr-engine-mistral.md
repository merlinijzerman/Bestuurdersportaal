# 0020 — OCR-engine voor beeld-only PDF's: Mistral OCR

- **Status:** Geaccepteerd
- **Datum:** 2026-06-22
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder + compliance-akkoord), Claude (uitvoering/advies)
- **Relatie:** losse iteratie uit de roadmap (`06 Roadmap/…v1.0.md §2`, "OCR als aparte iteratie") en de AI-assistent-kwaliteitsroadmap (OCR blijft apart). Bulk-ingest van de generieke set verloopt via service-role conform [`0006`](./0006-doorontwikkeling-v2-beslispunten-B1-B10.md) (B13).

## Context

Een deel van het te migreren corpus en toekomstige tenant-uploads zijn beeld-only PDF's zonder tekstlaag. De huidige extractie (`lib/document-extractie.ts`, unpdf/pdfjs) leest daar nul tekst uit, waardoor het document niet de RAG-pipeline (chunk → embed → hybride search) in komt; de upload-route weigert zo'n bestand nu hard. We hebben een OCR-fallback nodig die alleen aanslaat als de goedkope tekstlaag te dun is.

Meting (app-engine unpdf, 22-06, 161 unieke docs): 94 OK (58%) tekstlaag aanwezig · 47 OCR-nodig (29%) beeld-only · 20 CORRUPT (12%) "Invalid PDF structure" (OCR helpt níét → re-download). Van de 47 OCR-kandidaten zijn er slechts **2 hoogwaardig** (DNB Good Practice ESG-risicobeheer, 22 pg; DNB Naleving Sanctiewet, 7 pg); de overige 45 zijn Pensioenfederatie-magazines zonder normatieve inhoud. De directe inhoudelijke winst is dus klein en geconcentreerd, maar de pipeline is generiek herbruikbaar.

Randvoorwaarden die meewegen: AVG/datalokatie (pensioendata), DPIA/verwerkersregister, draaibaarheid op Vercel-serverless (geen native binaries), audit/herleidbaarheid, en kosten.

## Besluit

Voor OCR van beeld-only PDF's gebruiken we **Mistral OCR (`mistral-ocr-latest`)**, aangeroepen via een gedeeld extractiepad `extractTekstMetOcrFallback` dat eerst de tekstlaag probeert en alleen bij een te dunne uitkomst (< 50 betekenisvolle tekens/pagina) terugvalt op OCR. De OCR-output is exact een `ExtractieResultaat` (één segment per pagina), zodat het chunking-/embedding-contract en de bronvermelding "pag. X" ongewijzigd blijven — dit is **geen embed-laag-wijziging**.

## Overwogen alternatieven

- **Claude vision (Anthropic)** — staat al in de DPIA, maar vereist eerst een PDF→afbeelding-renderstap per pagina (native deps, geheugen, broos op Vercel-serverless). Niet gekozen: meer bouwwerk en VS-gehost. Blijft terugvaloptie als het besluit kantelt (alles bij één leverancier).
- **Tesseract / ocrmypdf** — gratis, maar native binaries draaien niet op Vercel-serverless; zou een tweede OCR-pad vergen. Afgevallen voor het live/her-extract-pad; mogelijk nog als gratis bulk-fallback in het migratiescript.
- **Niets doen (beeld-only blijven weigeren)** — verworpen: de 2 hoogwaardige DNB-docs en toekomstige scans zouden permanent buiten de RAG vallen.

> **Correctie t.o.v. eerste framing:** "geen nieuwe sub-processor" is géén onderscheidend argument — zowel Mistral (embeddings) als Anthropic (samenvattingen) staat al in het register. Doorslaggevend is de **engineering-frictie**: Mistral OCR slikt een PDF rechtstreeks in (base64/Files-API) en geeft per pagina markdown terug, 1-op-1 op onze segment-per-pagina-structuur. Bijkomend: EU-residency (Parijs), doel-gebouwd model (layout/tabellen, NL), en lage kosten ($2/1.000 pg standaard, $1/1.000 batch; scope < $2).

## Gevolgen

- **Nieuw bestand** `lib/ocr.ts` (Mistral-client + `heeftOcrNodig` + `extractTekstMetOcrFallback`); `lib/document-extractie.ts` blijft ongewijzigd (eenrichtingsafhankelijkheid).
- **Datamodel:** additieve, nullable audit-kolommen op `documenten` (`ocr_toegepast boolean`, `ocr_engine text`) — idempotente migratie + ROLLBACK; eerst in Supabase, dan code. Geen RLS-wijziging.
- **RLS/tenant-isolatie:** ongewijzigd. Her-extract blijft anon-key + RLS; de bulk-ingest van de generieke set draait via service-role (B13), buiten de tenant-uploadroute (die generiek met 403 weigert). Geen tenant-UI-pad in deze iteratie.
- **Audit/reproduceerbaarheid:** `ocr_toegepast`/`ocr_engine` per document; OCR is een afgeleide bewerking op bestaande broninhoud (origineel blijft ongewijzigd, past binnen append-only).
- **DPIA/register:** nieuwe verwerking (OCR) bij bestaande verwerker (Mistral, EU); registerregel toevoegen, geen nieuwe DPA nodig.
- **Bewust geaccepteerd / open:**
  - *Vendor-concentratie* — embeddings én OCR bij Mistral; een storing/prijswijziging raakt twee schakels. Terugval: Claude vision / Tesseract (gedocumenteerd).
  - *OCR-kwaliteit op eigen NL-documenten* is niet hard te claimen → **Fase 0-steekproef** op de 2 DNB-docs vóór bulk-ingest is vereist.
  - *Vercel-timeout/omvang* — live synchrone OCR in de upload-route blijft default uit; bulk via Node-script (geen timeout), her-extract laagfrequent + AbortController-timeout. Live async pas na aparte analyse.
  - *Drempel 50 tekens/pg* is grof voor deels-gescande docs; monitoren en desnoods bijstellen.
- **Niet in scope:** re-download van de 20 CORRUPTE PDF's, gestructureerde tabel-/afbeelding-extractie, wijziging aan chunking/embedding.

## Referenties

- `lib/ocr.ts`, `lib/document-extractie.ts`, `lib/embeddings.ts` (stijlreferentie raw fetch + retry/backoff)
- `app/api/documents/[id]/her-extract/route.ts` (integratie van de fallback + audit-update)
- migratie `supabase/migrations/2026_06_22x_ocr_audit.sql` (+ ROLLBACK)
- bulk-migratiescript `scripts/migrate-generiek.mjs` (apart bouwticket #12)
- [`0006`](./0006-doorontwikkeling-v2-beslispunten-B1-B10.md) B13 (generiek via service-role)
