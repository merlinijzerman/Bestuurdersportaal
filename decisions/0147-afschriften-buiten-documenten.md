# 0147 — Afschriften buiten `documenten` (eigen tabel, eigen bucket)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman, Claude Code

## Context

Het lag voor de hand een afschrift als rij in `documenten` te registreren: dat geeft "gratis" de bestaande bibliotheek-UI, inzage en storage. Maar `documenten` voedt de ingest-, chunk- en embeddingpijplijn (`lib/rag.ts`, de curatie-worker). Alles wat daar binnenkomt wordt op termijn doorzoekbaar via de AI-assistent.

## Besluit

Afschriften komen **niet** in `documenten`. Ze krijgen een eigen tabel (`procedure_afschriften`), een eigen private bucket (`afschriften`) en een eigen UI-paneel. Dit is een harde eis, geen voorkeur.

## Overwogen alternatieven

- **Documentrij + `bibliotheek`-vlag om ingest over te slaan** — één gemiste of later teruggedraaide vlag zet een auditzip met notulen, stemgedrag en dissent alsnog de retrievalindex in. Dat lek draai je niet terug; verworpen.
- **Eigen tabel + eigen bucket** — kost een migratie en een paneel, maar sluit het lek constructief. Gekozen.

## Gevolgen

- **RLS/tenant-isolatie:** eigen deny-by-default-tabel + storage-policy, los van de documenten-policies. Geen raakvlak met de RAG-tenantdiscipline (0045).
- **Audit:** afschriften kunnen nooit onbedoeld door de AI-assistent worden geciteerd — de scheiding is structureel, niet procedureel.
- **Beheerlast (geaccepteerd):** een tweede opslag- en rechtenpad naast `documenten`.

## Referenties

- Werkopdracht T6 v1.0, ADR-2.
- `supabase/migrations/2026_08_09_procedure_afschriften.sql` (bucket `afschriften`), besluit 0045 (RAG-fondsfilter), [[0146-afschrift-als-vastgelegd-record]].
