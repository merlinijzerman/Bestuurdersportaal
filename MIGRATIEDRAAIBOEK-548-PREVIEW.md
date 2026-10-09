# #548 → Preview: migratie- en uitroldraaiboek

> **Status: VOORBEREID, NIET UITGEVOERD.** Ik (Claude Code) heb geen toegang tot `portal_preview` en heb niets op Preview of Productie toegepast. Elke stap met een wijziging vraagt een afzonderlijk akkoord:
>
> - de migratie op Preview;
> - de merge van PR #549 naar `preview`;
> - de pilot-herindexering;
> - de promotie naar `main`;
> - elke Productiestap.

**Doelomgeving van dit draaiboek:** uitsluitend Supabase Preview (`portal_preview`, project `swviwoytzvaqypieqgji`) en de Vercel-omgeving Preview (`preview-stable`). Productie staat in §7 alleen als volgorde, niet als opdracht.

---

## 0. Waarom eerst de database

De #548-code roept `fn_document_chunks_vervangen` aan op twee plekken:

- **De ingestworker:** elke nieuwe upload, fonds én generiek.
- **De herindexering.**

Deployt de code vóór de migratie, dan geeft elke chunkvervanging PGRST202. Wat er dan gebeurt:

- **Worker.** Gaat voor iedere upload in backoff (`chunk_insert`). Nieuwe documenten van álle fondsen worden dan niet meer geïndexeerd. Er gaat niets kapot (de oude chunkset blijft staan), maar de ingest staat stil.
- **Herindexering.** Geeft `mislukt` / `vervangen_mislukt`. Er wordt niets verwijderd.

De migratie zelf verandert geen bestaand gedrag. Ze voegt alleen één functie toe, die de huidige code niet aanroept. Ze kan dus veilig vóór de merge worden toegepast.

## 1. Preflight (read-only, verandert niets)

| # | Bestand | Waar | Verwachte uitkomst |
|---:|---|---|---|
| 1 | `supabase/checks/2026_10_05_548_preview_preflight_readonly.sql` | Supabase SQL Editor van **portal_preview** | `NOTICE #548 PREFLIGHT GROEN` met `[doel]`, vijf `[voorwaarde]`-regels en `[nog doen] …2026_10_05_548_chunks_atomisch_vervangen.sql` |

De preflight breekt fail-closed af in drie gevallen:

- de Preview-fingerprint ontbreekt, of er staat een productiehost (`#548 VERKEERDE DOELOMGEVING`);
- een voorwaarde ontbreekt (`#548 PREFLIGHT ROOD`). Gecontroleerd worden 28 kolommen, de CHECK-waarden voor `verwerkingsstatus` en de jobtabel, de BEFORE INSERT-denormtrigger en de RLS-schrijfpolicies;
- de functie bestaat al, maar met een afwijkende vorm.

Bij ROOD: **niet toepassen**, en eerst de oorzaak uitzoeken.

## 2. Migratie

| # | Bestand | Wat | Rollback |
|---:|---|---|---|
| 1 | `supabase/migrations/2026_10_05_548_chunks_atomisch_vervangen.sql` | Voegt `public.fn_document_chunks_vervangen(uuid, jsonb)` toe: SECURITY INVOKER, `statement_timeout = 120s`, `search_path` vast, EXECUTE voor authenticated + service_role, `revoke … from public, anon`. Gevolgd door `notify pgrst, 'reload schema'`. Idempotent. | `supabase/rollbacks/2026_10_05_548_chunks_atomisch_vervangen_ROLLBACK.sql` (pas ná het terugzetten van de code) |

Toepassen: plak het hele bestand in de SQL Editor van portal_preview (als postgres). Geen `supabase db push`: zie `scripts/testdb-apply-migrations.sh` voor het waarom.

## 3. Postcheck

| # | Bestand | Waar | Verwacht |
|---:|---|---|---|
| 1 | `supabase/checks/2026_10_05_548_chunks_atomisch_vervangen.sql` | SQL Editor | 7 rijen, allemaal `ok = true` |
| 2 | `supabase/checks/2026_10_05_548_preview_preflight_readonly.sql` (nogmaals) | SQL Editor | `[stand] fn_document_chunks_vervangen aanwezig … Niets meer te doen.` |
| 3 | `supabase/checks/2026_07_31_r1_structurele_gates.sql` | SQL Editor | OK-notices A1, A2, B, C, C2, E, F, G, H, D (verplicht na een nieuwe functie of grant) |
| 4 | `supabase/checks/2026_08_20_v3_grants_volledig.sql` | `psql "$PREVIEW_DB" -v ON_ERROR_STOP=1 -f …` vanuit de repo-root (gebruikt `\copy` van de allowlist) | Geen "onbekend object" of rechtenverschil voor `fn_document_chunks_vervangen`. Andere afwijkingen zijn bestaande Preview-drift en horen niet bij #548. |

Het gedrag onder echte RLS is al bewezen in CI: `supabase/checks/2026_10_05_548_chunks_vervangen_rls.sql`, V0–V5 groen in de job "Cross-tenant isolatie" op PR #549. Die test maakt fixtures aan en rolt terug. Hij hoort niet op Preview te draaien.

## 4. Merge naar `preview` (apart akkoord)

Voorwaarden voor de merge:

- §1–§3 zijn groen;
- alle verplichte checks op PR #549 zijn groen.

De merge zelf: PR #549 naar `preview`. Daarna moet je zien dat de Vercel-deploys `bestuurdersportaal` én `bestuurdersportaal-beheer` voor `preview-stable` op Ready staan.

## 5. Preview-smoke en pilot

**Bekende blokkade.** Volgens `00 Overzicht en status/Releases/release-juridische-indexering-2026-10-05.md` gaf de Preview-scanner vandaag `scanner_onbereikbaar`, en bleef een nieuwe testbron vóór de indexering hangen. Staat `WP3_MALWARESCAN_AAN` op Preview aan, dan geldt het volgende tot de scanner werkt (PR #534 / scanner-health valt buiten #548):

- nieuwe uploads (stap a) komen niet bij de extractie;
- de herindexering slaat documenten zonder schoon scanbewijs over (`scanbewijs_ontbreekt`).

Stap c en d werken wel op documenten die al schoon gescand en geïndexeerd zijn.

| Stap | Actie | Controle |
|---|---|---|
| a. Nieuwe ingest, beide bibliotheken | Upload in de generieke bibliotheek een PDF (bv. `kst-36067-90.pdf`) en als fondsgebruiker een DOCX | `select d.bibliotheek, c.indexering_versie, count(*) from document_chunks c join documenten d on d.id = c.document_id where d.id in (…) group by 1,2;` → beide `r2-bronblokken`; `documenten.verwerkingsstatus = 'beschikbaar'` |
| b. Pilot-herindexering (generiek) | Beheerpagina → per document "Herindexeer": amendement 36 067 nr. 90, een MvT, een document met tabellen | Geen label `%Artikel 102a%` of `%Artikel 109a%`; chunk 0 op `r2-bronblokken`; een `document_processing_jobs`-regel met stap `indexering` en foutcode `herindex:r2-bronblokken:ok`; looptijd en aantal chunks noteren voor de kosten |
| c. Volledige sectie | `/ai`: "Geef het hele artikel 150r van amendement 36 067 nr. 90" | Volledige tekst, "pagina 1–2", link naar het origineel; governance-log `methode = gerichte_documentsectie` |
| d. Oude fondsindex | Dezelfde vraag voor een bestaand fondsdocument | Melding "geïndexeerd vóór de verbeterde verwerking" plus link, geen tekst |
| e. Gewone vragen | Twee of drie inhoudelijke vragen per pilotdocument, vóór (bestaande index) en na de herindexering | Relevante passage gevonden, juiste pagina in de citatie; uitkomsten in de vóór/na-matrix |

## 6. Rollback (Preview)

1. **Code terugzetten:** een revert-PR naar `preview`.
2. **Daarna:** `supabase/rollbacks/2026_10_05_548_chunks_atomisch_vervangen_ROLLBACK.sql`.
3. **Data:** al ingevoegde `r2-bronblokken`-chunks blijven gewone, geldige chunks. Er is geen datamigratie terug nodig.

## 7. Productie (alleen de volgorde; elke stap een eigen akkoord)

1. **Promotie-PR:** `preview` → `main`, met een releasenotitie (besluit 0207) en verwijzingen naar §5.
2. **Migratie:** eerst op `portal_production` toepassen, met dezelfde preflight. Op Productie bestaat de Preview-fingerprint niet, dus de preflight breekt daar bewust af. Gebruik dan de postcheck-queries 1, 3 en 4 rechtstreeks, met een vooraf vastgestelde doelbevestiging.
3. **Merge en deploy:** pas daarna de merge naar `main` en de Production-deploy waarnemen.
4. **Pilot op Productie:** per document "Herindexeer" voor de pilotdocumenten, en vergelijken.
5. **Batch:** "Bibliotheek her-indexeren" voor de overige generieke PDF's/DOCX's in beheerste rondes. Fondsdocumenten worden niet herindexeerd.
