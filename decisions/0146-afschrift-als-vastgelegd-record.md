# 0146 — Auditdossier-afschrift als vastgelegd record

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering)

## Context

De bestaande export `GET /api/decisions/[id]/auditdossier` levert een vluchtige HTML/JSON-weergave van één besluit: een zwervende kopie in iemands Downloads-map, niet herleidbaar en niet reproduceerbaar. Een accountant, IT-auditor of DNB heeft een complete, zelfstandig leesbare bundel over het **hele proces** nodig, met een controleerbare herkomst. Randvoorwaarden: append-only audit (0001), tenant-isolatie per `fonds_id`, snapshot-integriteit, en AVG (het afschrift bevat stemgedrag per bestuurslid).

## Besluit

Een auditdossier-afschrift (T6) wordt **permanent aan het proces gekoppeld** als een vastgelegd record (`procedure_afschriften` + private bucket `afschriften`), niet als een vluchtige download geleverd. Het is een gezipte, reproduceerbare, herleidbare archiefbundel; intrekken kan (statuswijziging met reden en actor), verwijderen niet.

## Overwogen alternatieven

- **Vluchtige download blijven leveren** — geen bewaartermijn, geen herleidbaarheid, geen bewijs van volledigheid; verworpen omdat dat precies het auditprobleem laat bestaan.
- **Afschrift als documentrij (`documenten`)** — "gratis" UI, maar het lekt naar de RAG-pijplijn; apart besloten in [[0147-afschriften-buiten-documenten]].

## Gevolgen

- **Datamodel:** nieuwe tenant-tabel `procedure_afschriften` (RLS per `fonds_id`, geen delete-policy) + private bucket met objectlimiet. Migratie `2026_08_09_procedure_afschriften.sql` (+ hardening).
- **Audit/reproduceerbaarheid:** elk afschrift draagt een manifest met per-bestand sha256, een `inhoud_hash`, snapshot-hashes en een expliciete uitsluitingslijst. Aanmaken/downloaden/intrekken worden gelogd in `procedure_log`.
- **AVG/bewaartermijn (bewust geaccepteerde schuld):** permanent bewaren maakt dit archiefvorming i.p.v. een zwervende kopie — juridisch verdedigbaarder, maar het moet in verwerkingsregister en DPIA landen, inclusief de omgang met een verwijderverzoek van een bestuurslid wiens stemgedrag erin staat. **Openstaand voor de privacyfunctionaris** (dit besluit beslist dat niet).

## Referenties

- Werkopdracht T6 v1.0 (2026-08-09).
- `supabase/migrations/2026_08_09_procedure_afschriften.sql`, `core/lib/afschrift-bundel.ts`.
- Besluiten 0001 (append-only), [[0147-afschriften-buiten-documenten]], [[0148-ingetrokken-documenten-in-afschrift]], [[0149-service-role-afschrift-worker]].
