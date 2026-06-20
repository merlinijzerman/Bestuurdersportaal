# 0011 — Increment D: notulen op agendapuntniveau — de vijf uitvoeringskeuzes

- **Status:** Geaccepteerd + gebouwd + live (2026-06-20) — vastgesteld in Plan-modus vóór de bouw (akkoord Merlin); migratie op live Supabase gedraaid en code gedeployed op 20-06-2026 ná de vier pre-merge subagent-reviews
- **Datum:** 2026-06-20
- **Betrokkenen:** Merlin IJzerman
- **Scope:** Increment D (notulen op agendapuntniveau, bron = upload)

## Context

Het bouwticket voor Increment D (`04 Technische inrichting/Bestuurdersportaal - Increment D werkopdracht en bouwticket v1.0.md`) legt vijf uitvoeringskeuzes expliciet vast. Elk raakt een randvoorwaarde: correctheid van de denormalisatie die de agendapuntbron voedt, append-only audit, RLS/tenant-isolatie, human-in-the-loop (alleen bevestigde segmenten geïndexeerd) en "geen schijnzekerheid" (concept vs. vastgesteld). Leidend blijft "bij twijfel wint de code + migraties" (`CLAUDE.md`). D leunt op Increment E (denorm `fn_chunk_denorm` + chunk-trigger) en C (documentstatus-model).

## Besluit

1. **API-naamgeving — Nederlands `/api/notulen/…`.** Consistent met `/api/dossiers`; alleen de documenten-routes zijn Engels (decisions/0009). Routes: `POST /api/notulen/[id]/segmenteer`, `POST /api/notulen/segmenten/[id]/bevestig`, `PATCH/DELETE /api/notulen/segmenten/[id]`.
2. **Indexeringsmodel — segmentchunks vervangen whole-document-chunks (transactioneel).** Bij de eerste bevestiging van een segment worden de whole-document-chunks van het notulendocument verwijderd en de segmentchunks neergezet, in één transactie via een RPC (`security invoker`, RLS blijft gelden). Geen retrieval-de-dup. Onbevestigde segmenten produceren nooit chunks; nooit-gesegmenteerde notulen behouden hun whole-document-chunks. **Na de audit-review (zie onder) doet de RPC ook de auditregel in dezelfde transactie**; functies: `fn_notulen_segment_bevestig`/`_ontbevestig`/`_verwijder`.
3. **Auditlog — hergebruik `document_metadata_log`.** Bevestiging/correctie/ont-bevestiging/verwijdering/segmenteren landen append-only met `wijzig_type='notulen_segment'` (oud→nieuw + reden). Geen aparte audittabel.
4. **Segmentatie — regelgebaseerd starten (geen AI-call).** `lib/notulen.ts` met kopdetectie (genummerd / "Agendapunt N" / titel-overlap) + nummer-/titelmatch tegen de agendapunten van de vergadering. Deterministisch, auditbaar, puur testbaar (precedent `lib/classificatie.ts`/`lib/vraagtype.ts`). AI-variant is een latere optimalisatie achter dezelfde interface.
5. **E-trigger-fix — COALESCE in `fn_chunk_denorm_before_insert()`.** De E-trigger overschreef `agendapunt_id`/`vergadering_id` altijd met de documentwaarde; voor segmentchunks zetten we die velden per segment (de agendapunt van het segment kán afwijken van het document). `new.agendapunt_id := coalesce(new.agendapunt_id, v.agendapunt_id)` (idem vergadering_id) behoudt de per-segment-waarde; de overige denorm blijft hard uit het document. **Harde voorwaarde** — anders dragen segmentchunks de verkeerde agendapuntcontext.

## Bouwverfijningen (vastgesteld in Plan-modus, bevestigd door Merlin)

- **Geen `vaststellingsdatum`-kolom.** Die bestaat niet op `documenten`; de actieve-besluitbron-gate reduceert tot `documenten.status='vastgesteld'` (hergebruik C-statusmodel, geen nieuw statusveld). Defense-in-depth: zowel de `bevestig`-route als de RPC weigeren indexering als de notulen niet vastgesteld zijn. Hierdoor krijgen concept-notulen nooit segmentchunks → "concept ≠ actieve bron" (regressie 4) zónder de retrieval-RPC's te wijzigen (statusfilter blijft Increment G).
- **Nieuwe kolom `document_chunks.notulen_segment_id`** (additief, nullable, `on delete cascade`). Onmisbaar om segmentchunks van whole-document-chunks te onderscheiden voor keuze 2; cascade ruimt segmentchunks op bij het verwijderen van een segment. Niet letterlijk in het ticket, maar noodzakelijk gevolg van keuze 2.
- **Bronvermelding-verrijking via één gebatchte vervolgquery** (`verrijkNotulenChunks` in `lib/rag.ts`), níét via een RPC-uitbreiding. De retrieval-RPC's (`zoek_chunks`/`zoek_chunks_hybride`) leveren geen vergadering/agendapunt en blijven ongewijzigd; de verrijking draait ná retrieval, vóór `maakContext`. Label: "Vastgestelde notulen [vergadering], agendapunt N — [titel]" (pure `notulenBronLabel`, testbaar).

## Pre-merge subagent-reviews (20-06-2026)

Vier reviewers vóór merge (conform werkopdracht; `ai-governance-reviewer` niet vereist — regelgebaseerd, geen nieuwe AI-stap):
- **`supabase-rls-reviewer`** — akkoord, geen blocking: RLS op `notulen_segmenten` per `fonds_id` (using + with check), segmentchunks erven de "fonds chunks"-policy, RPC's `security invoker` (geen service-role), integriteitstrigger dekt cross-fonds-koppeling.
- **`ontwerp-sync-reviewer`** — in sync, geen overclaiming; alleen een cosmetische correctie op het TO §2.5 pseudo-schema (verwerkt) en de `vaststellingsdatum`-discrepantie correct geadresseerd.
- **`code-reviewer`** — geen blocking; aanbevolen punten verwerkt: `rpcError.message`-lek verwijderd, lege-segment-guard (geen whole-document-chunks weggooien zonder vervanging).
- **`audit-evidence-reviewer`** — **NO-GO opgelost.** Bevinding (R2-precedent uit 0010): mutatie en auditlog zaten niet in één transactie en de log-fout werd niet gecontroleerd → een onomkeerbare bron-mutatie (chunk-vervanging/-verwijdering) kon ongelogd blijven. **Fix:** de governance-kritieke, onomkeerbare paden (bevestigen/ont-bevestigen/verwijderen) draaien nu via RPC's die mutatie + chunk-opruiming + append-only audit **atomair** doen (`fn_notulen_segment_bevestig`/`_ontbevestig`/`_verwijder` + helper `fn_notulen_segment_audit`). Correcties (titel/agendapunt/tekst) zijn beperkt tot **onbevestigde** segmenten (reversibel, geen chunks; per-veld gelogd met error-check) — een bevestigd segment is immutable tot ont-bevestiging, wat divergentie tussen bron en log uitsluit. Segmenteren checkt nu de log-fout (reversibel/herhaalbaar).

## Overwogen alternatieven

- **Engelse routes onder `/api/documents/...`** — verworpen: D is een eigen functioneel domein (notulen), NL-conventie zoals `/api/dossiers`.
- **Whole-document- én segmentchunks naast elkaar met retrieval-de-dup** — verworpen: dubbele bron, retrievalgedrag zou moeten wijzigen (buiten scope), en de-dup is foutgevoeliger dan transactioneel vervangen.
- **Aparte `notulen_segment_log`-audittabel** — verworpen: `document_metadata_log` is append-only, gehasht en RLS-gescoped; een tweede tabel dupliceert dat.
- **AI-segmentatie meteen** — uitgesteld: B6 = half-automatisch; regelgebaseerd is auditbaar en deterministisch testbaar, en houdt het DPIA-oppervlak klein (geen documenttekst naar een model).
- **Statusfilter in de retrieval toevoegen voor "concept ≠ bron"** — uitgesteld naar Increment G; de indexerings-gate (alleen vastgestelde notulen) dekt het binnen D zonder retrievalwijziging.

## Gevolgen

- **Datamodel/migraties:** `2026_06_20d_notulen_segmenten.sql` (+ ROLLBACK): tabel `notulen_segmenten` (RLS per `fonds_id`), integriteitstrigger (`documenttype=notulen` + agendapunt↔vergadering + fondsconsistentie), COALESCE-fix op `fn_chunk_denorm_before_insert()`, kolom `document_chunks.notulen_segment_id`, en de RPC `fn_notulen_indexeer_segment`. Additief + idempotent; migratie-eerst-dan-deploy.
- **RLS/tenant-isolatie:** `notulen_segmenten` per `fonds_id` (anon-key, nooit service-role); segmentchunks via de bestaande "fonds chunks"-policy (join op `documenten`). Geen cross-fonds-koppeling (integriteitstrigger).
- **Audit/reproduceerbaarheid:** alle schrijfacties append-only in `document_metadata_log` (`wijzig_type='notulen_segment'`).
- **AI-governance:** geen nieuwe AI-stap (regelgebaseerd) → `ai-governance-reviewer` niet vereist; wél `supabase-rls-reviewer`, `audit-evidence-reviewer`, `code-reviewer`, `ontwerp-sync-reviewer` vóór merge.
- **Bewust geaccepteerde schuld:** rollback van D herstelt geen whole-document-chunks die bij de eerste bevestiging zijn verwijderd (her-indexeer via her-extract). Splitsen/samenvoegen verloopt via correctie + verwijderen/segmenteren; een dedicated "handmatig nieuw segment"-route is een latere toevoeging.

## Referenties

- `04 Technische inrichting/Bestuurdersportaal - Increment D werkopdracht en bouwticket v1.0.md`.
- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel ontwerp v1.2.md` §8 (Module 6).
- `04 Technische inrichting/Bestuurdersportaal - Doorontwikkeling v2 technisch ontwerp v1.2.md` §2.5.
- `mvp/decisions/0006` (B6 half-automatisch), `0007`/`0008` (fondsconsistentie), `0009` (Engelse documenten-routes), `0010` (E-denorm + `fn_chunk_denorm`).
- Code: `supabase/migrations/2026_06_20d_notulen_segmenten.sql`, `lib/notulen.ts`, `lib/rag.ts` (`verrijkNotulenChunks`/`maakContext`), `app/api/notulen/**`, `app/(dashboard)/notulen/**`, `lib/capabilities.ts`.
