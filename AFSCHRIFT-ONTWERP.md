# Auditdossier-afschrift (T6) — ontwerp (as-built, fase 1)

> Bron van waarheid blijft de code + `supabase/migrations/`. Dit document beschrijft *wat en waarom* van de afschrift-module. Fase 2 (AI-leeswijzer) is voorbereid maar nog niet gebouwd.

## Doel

Een **afschrift** is een gezipte, permanent aan een proces gekoppelde auditbundel: auditdossier per besluit, een deterministische tijdlijn en auditlog uit **beide auditsporen**, alle bijgevoegde documenten, een manifest dat volledigheid + integriteit bewijst, en een begeleidende leeswijzer. Anders dan de vluchtige besluit-export is dit een vastgelegd, reproduceerbaar, herleidbaar archiefstuk (besluit [[decisions/0146]]).

## Drie lagen, strikt gescheiden

| Laag | Inhoud | Herkomst | Status | Fase |
|---|---|---|---|---|
| A — Bron | auditlog, besluiten, bewijs, documenten | database/storage | authoritatief | 1 |
| B — Afgeleid | tijdlijn, manifest, inventaris, feitenkaart | **code**, deterministisch | authoritatief, reproduceerbaar | 1 |
| C — Duiding | leeswijzer §2–4 | sjabloon (fase 1) → **AI** (fase 2) | toelichtend, niet-authoritatief | 2 |

De tijdlijn wordt **niet** door een taalmodel samengevat. De feitenkaart (`core/lib/afschrift-feitenkaart.ts`) is de scheidslijn B↔C: in fase 2 de enige modelinput en de toetssteen voor de guardrail.

## Twee auditsporen (de kerncorrectie)

De procespagina toonde tot T6 **alleen** `procedure_log` (procesniveau). Alle onderbouwing — aannames, risico's, dissent, statusovergangen — leeft in `governance_events` (besluitniveau, mét sha256-hash) en was onzichtbaar. T6 voegt beide samen:
- **Export:** `02_Tijdlijn` + `03_Auditlog` mengen beide sporen op tijdstip, met `spoor`/`bron`-kolom, `besluit_code` en `hash` waar aanwezig. `procedure_log` heeft **geen** hash — eerlijk vermeld in manifest/`INHOUDSOPGAVE.md`/leeswijzer §6.
- **UI (F2):** het "Audit-trail"-paneel toont nu beide sporen via de gedeelde labelmap `core/lib/audit-labels.ts`.

## Bundelstructuur

```
afschrift_<procescode>_<versie>_<datum>.zip
├── 00_LEESWIJZER.docx / .html   (laag B/C; statuskader verplicht op p.1)
├── 01_Auditdossier[.html | /<besluit_code>.html]   (renderAuditdossierHtml)
├── 02_Tijdlijn.html / .csv
├── 03_Auditlog.csv / .json
├── 04_Bijlagen/B01_<type>_<titel>.<ext>
├── MANIFEST.json
└── INHOUDSOPGAVE.md
```

## Datamodel & opslag

- Tabel `procedure_afschriften` (migratie `2026_08_09_procedure_afschriften.sql` + `_hardening`): RLS per `fonds_id`, gespiegelde `WITH CHECK`, **geen delete-policy** (+ no-delete-trigger), bureau-uitsluiting op INSERT + storage-read, kolom-freeze-trigger (user-sessies → alleen `ingetrokken_*`), expliciete grants (geen anon-TRUNCATE). Fase-2 `ai_*`-kolommen zijn al aangelegd.
- Private bucket `afschriften` (150 MB objectlimiet), pad `<fonds_id>/<procedure_id>/<afschrift_id>.zip`.
- Claim-RPC `afschriften_claim_jobs` (`FOR UPDATE SKIP LOCKED`, service-role-only).

## Jobmodel (besluit [[decisions/0149]])

Enqueue (`POST /afschrift`, user-RLS) valideert toegang + bureau-gate en schrijft `status='bezig'`. De cron-worker (`/api/internal/afschrift-worker`, service-role, alleen beheer-project) claimt, bouwt de bundel **fonds-gescoopt in code**, uploadt en zet `gereed`. Gezichtshoek = *fonds + rol*, benoemd in manifest + leeswijzer §6.

## Rechten

Download = toegang tot het proces (RLS) **én** niet-bureaurol. De bureau-rol ziet het afschrift wél in de lijst (met reden onbereikbaar), maar kan het niet genereren of downloaden — de storage-leespolicy sluit de rol óók uit, zodat de zip (met stemgedrag) niet langs de route-403 heen te halen is.

## Caps (ontwerpbeslissing 7)

≤40 bijlagen, ≤25 MB/bijlage, ≤150 MB ongecomprimeerd totaal. Overschrijding → bundel wél geleverd, overschrijding in `uitgesloten_items`.

## Belangrijkste bestanden

- **Libs (laag B):** `core/lib/afschrift-{types,feitenkaart,tijdlijn,manifest,docx,bundel}.ts`, `core/lib/docx-primitieven.ts` (gedeeld met `antwoord-docx.ts`, besluit 0079), `core/lib/audit-labels.ts`.
- **Worker:** `platform/lib/afschrift-orchestrator.ts` + `app/api/internal/afschrift-worker/route.ts`.
- **API:** `app/api/procedures/[id]/afschrift/route.ts` (+ `afschriften/…` lijst/download/intrekken).
- **UI:** `app/(dashboard)/procedures/_components/AfschriftenPaneel.tsx` + `StapPaneel.tsx` (stapinzage) + de procespagina.
- **Tests:** `core/lib/afschrift-*.sanity.ts` (33 tests), `tests/cross-tenant/afschrift-toegang.test.ts` (8 tests).

## Openstaand

- Fase 2 (AI-leeswijzer §2–4 + guardrail + vaststelling, ADR-4/0150).
- DB-laag cross-tenant SQL-check onder échte RLS (`supabase/checks/`), en de handmatige bundelverificatie na deploy.
- AVG/bewaartermijn (privacyfunctionaris), fondssjabloon leeswijzer (afhankelijk van T5-A6).
