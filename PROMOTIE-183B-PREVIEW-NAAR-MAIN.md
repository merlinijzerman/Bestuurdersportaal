# Promotie `preview` → `main` — #183b (governance_events tenantketen + machinegezag-audit)

**Delta:** `origin/main..origin/preview` = **5 commits, 41 bestanden** (+2827 / −177).
**Kernpunt:** de code landt met **`ENFORCE_AUDIT` UIT** — inert op productie (schrijft audit-events,
dwingt niets af, blokkeert geen bestaande flow). De vlagwissel is een aparte latere stap, gated op de retentiebaan.

---

## Commits die meegaan

| Commit | Wat | Onderdeel van |
|---|---|---|
| `6bca94a` | Merge PR #213 | #213 |
| `dc2b7a0` | docs(0193): Voorgesteld → Vastgesteld | #213 |
| `059e0f4` | review-fixups (4 reviewers) | #213 |
| `ff5b872` | feat #183b — beide dragers 0 | #213 |
| `48571ba` | **docs(HANDOVER): +1 regel release-historie W10/W11/#183a** | **los, buiten #213** |

> `48571ba` is één documentatieregel over een eerdere release (W10/W11/#183a, al op productie).
> Onschadelijk, geen code/DB-impact — maar bewust benoemd omdat het niet uit de #183b-batch komt.

---

## 1. Migraties — **Supabase-eerst op Productie** (kritische volgorde)

Plak deze **vóór** de code-merge in de **Productie-Supabase** SQL-editor, in deze volgorde
(afhankelijkheidsgeordend; zoals bewezen op Preview). Elk heeft een rollback in `supabase/rollbacks/`.

| # | Migratie | Doet |
|---|---|---|
| 1 | `2026_08_27_govevent_hash_extensions_qualify.sql` | `fn_govevent_hash`: `digest` → `extensions.digest` (identieke hash, fix 42883 onder gepinde `search_path`) |
| 2 | `2026_08_27_doc_meta_log_hash_extensions_qualify.sql` | idem voor `fn_doc_meta_log_hash` |
| 3 | `2026_08_27_govevent_tenantketen.sql` | `fonds_id`-kolom + composite FK `(decision_id,fonds_id)→decision_objects(id,fonds_id)` MATCH SIMPLE + `fn_govevent_fonds` (SECURITY INVOKER) + asymmetrisch policy + `decision_objects_id_fonds_uniek` |
| 4 | `2026_08_27_govevent_brontabellen.sql` | 5 triggers (agendapunten, agendapunt_inbreng, vergaderingen, organisatie_profielen, stem_uitbrengingen) + grants |
| 5 | `2026_08_27_govevent_stemmingen.sql` | referentietrigger stemmingen (stemvlag staat uit → inert) |
| 6 | `2026_08_27_govevent_document_status.sql` | RPC `fn_document_status_zetten` (status + inzage + event, atomisch) |
| 7 | `2026_08_27_govevent_notulen.sql` | `fn_notulen_segment_bevestig`/`_verwijder` + event |
| 8 | `2026_08_27_platform_pipeline_operate_capability.sql` | seed capability + CHECK `chk_pic_geen_machinegezag` |

**MATCH SIMPLE is bewust:** bestaande `governance_events`-rijen hebben na stap 3 `fonds_id = NULL`
→ de FK slaat ze over, dus geen validatiefout op de productiehistorie (bewezen op Preview).

**Na het plakken, vóór de code-merge:** draai `supabase/checks/2026_07_31_r1_structurele_gates.sql`
en `supabase/checks/2026_07_08_t3_cross_tenant.sql` tegen Productie — schoon = go.

## 2. Code (7 bestanden) — deployt bij de merge

- `app/api/documents/[id]/route.ts` — PATCH roept `fn_document_status_zetten` aan (i.p.v. losse update + fail-open inzage).
- `app/api/aqlab/worker/route.ts`, `internal/afschrift-worker`, `internal/ingest-worker`,
  `internal/semantische-extractie`, `platform/monitoring/snapshot` — outcome-gescopte `logResultGegarandeerd`.
- `platform/lib/platform-capabilities.ts` (+ `.sanity.ts`) — `platform.pipeline.operate` in de union (16), niet-toekenbaar.

## 3. Gates / checks (4)

- `supabase/checks/2026_07_08_t3_cross_tenant.sql` — DEEL 2 governance_events (POSITIEF #7, NEGATIEF #6 FK, NEGATIEF #8 leesisolatie).
- `supabase/checks/2026_07_31_r1_structurele_gates.sql` — governance_events A→B (composite FK).
- `supabase/checks/allowlist-grants.tsv` (+24) + `.toelichting.md`.

## 4. Tests (3)

- `tests/karakterisering/audit-inventaris.{json,mjs,sanity.ts}` — dragers 0, anti-drift.

## 5. Besluiten & docs

- **Nieuw:** `decisions/0192` (tenantketen), `decisions/0193` (machinegezag).
- **Gewijzigd:** `decisions/0191` (§7/§8), `decisions/README.md`, `HANDOVER.md`.
- **Tickets/handovers (informatief):** `TICKET-RETENTIESNOEI-…`, `TICKET-183B-SPOOR-T-…`,
  `TICKET-GATE-ONGEKWALIFICEERDE-EXTENSIE-…`, `HANDOVER-GPT-…` (2×).

---

## Na de merge — expliciet NIET vergeten

1. **`ENFORCE_AUDIT` blijft UIT** op productie tot de retentiebaan er is (voorwaarde 3).
2. **Retentiebaan + R-06-rotatie** vóór de vlagwissel (`TICKET-RETENTIESNOEI-DRIE-APPEND-ONLY-TABELLEN.md`).
3. Post-merge smoke op productie: dezelfde 6 waarnemingen als op Preview.

---

## PR-body (klaar om te plakken bij `preview` → `main`)

> **Titel:** `promo(#183b): governance_events tenantketen + machinegezag-audit → main`
>
> `preview` → `main`. Beide auditdragers 0 (bewezen lokaal + Preview: spoor M end-to-end,
> spoor T route-smokes). **`ENFORCE_AUDIT` blijft UIT** — code landt inert, geen gedragswissel.
> 8 migraties Supabase-eerst op Productie (volgorde in `PROMOTIE-183B-PREVIEW-NAAR-MAIN.md`).
> Bevat één losse docs-commit `48571ba` (HANDOVER-release-regel, geen code/DB).
> Vervolg (apart): retentiebaan + R-06 → dán `ENFORCE_AUDIT=on`.
