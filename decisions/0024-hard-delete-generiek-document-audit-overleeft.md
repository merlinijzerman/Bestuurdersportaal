# 0024 — Hard-delete van generiek document: FK droppen zodat het auditlog de data overleeft

- **Status:** Geaccepteerd
- **Datum:** 2026-06-24
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude (uitvoering/advies)
- **Relatie:** maakt de hard-delete uit [`0022`](./0022-increment-P1-generieke-curatie-keuzes.md)/Increment P1 mogelijk; raakt het append-only-principe uit [`0001`](./0001-append-only-audit-geen-harddelete.md) en het `document_metadata_log` uit migratie `2026_06_18_documentstatus_metadata.sql`.

## Context

Een mislukt of gedupliceerd generiek document blokkeert permanent een nieuwe upload van dezelfde inhoud: de deduplicatie is een **partiële unique index** op `bestand_hash` over álle generieke rijen (`2026_06_24_p1_generieke_curatie.sql` r.80-82), ongeacht status. De curator wilde zo'n rij definitief kunnen verwijderen (hard-delete), niet enkel intrekken (`status='alleen_historisch'`).

De toegevoegde `curatieVerwijderen`-actie werd echter door de database geweigerd. Oorzaak: elk generiek document krijgt bij aanmaak (en bij elke statuswijziging) een rij in het **append-only** `document_metadata_log`. Dat log is onveranderbaar — `before update` én `before delete`-guards werpen `'document_metadata_log is append-only'` voor álle rollen, óók service-role. De FK `document_metadata_log.document_id → documenten(id)` stond op **`ON DELETE SET NULL`**. Een document verwijderen probeert dus de logrij te UPDATE'en (id → null) → de append-only-guard weigert → de hele DELETE rolt terug.

Gevolg: **geen enkel** generiek document met audithistorie was ooit verwijderbaar, terwijl de `SET NULL`-clausule dat juist suggereerde. Een latente tegenstrijdigheid: de `SET NULL` kon door de guard nooit uitvoeren.

## Besluit

**Optie A:** de FK op `document_metadata_log.document_id` **droppen** en de kolom als kale `uuid` behouden (idempotente migratie `2026_06_24_doc_meta_log_fk_drop.sql`).

De auditrij **overleeft** daarmee de hard-delete van het document, met de oorspronkelijke `document_id` intact — precies wat een onveranderbaar auditlog hoort te doen: de audit overleeft de data. Append-only blijft volledig intact (geen UPDATE/DELETE op logrijen). De hard-delete (`curatieVerwijderen`, achter `withPlatform` + capability + twee-fasen-audit) verwijdert daarna de documentrij; chunks worden expliciet weggehaald, `document_processing_jobs` cascadeert, en de overige verwijzingen (procedures, decision `bron_document_id`, inzage/deactivatie-log, self-FK's) stonden al op `ON DELETE SET NULL`.

## Alternatieven overwogen

- **`ON DELETE CASCADE` op de FK** — verworpen: de `before delete`-guard op het log weigert ook een cascade-delete, én het zou audithistorie vernietigen (in strijd met `0001`).
- **Delete-guard relaxen voor service-role / cascade-context** — verworpen: verzwakt een kern-guardrail (append-only audit) en is lastig veilig te detecteren in een trigger.
- **Niet hard-deleten; re-upload mogelijk maken** (unique index + dedup-SELECT `mislukt`/`alleen_historisch` uitsluiten) — afgewezen als hoofdoplossing: vereist óók een migratie, laat de mislukte rij als clutter staan en geeft geen algemene "verwijder deze rij"-mogelijkheid. Blijft een latere optie als clutter hindert.
- **Trigger in-band uitzetten in de delete-actie** (`disable trigger` / `session_replication_role`) — verworpen: hacky, racy en owner/superuser-afhankelijk.

## Gevolgen

- **Datamodel:** FK `document_metadata_log_document_id_fkey` verdwijnt; `document_id` blijft een (nullable) `uuid` zonder referentiële integriteit. Auditrijen kunnen voortaan naar een niet meer bestaand document wijzen — bewust en correct voor een historisch log.
- **Audit/append-only:** ongewijzigd geborgd. De hash per logrij bevat `document_id::text`; bestaande hashes blijven kloppen. Er wordt nooit een logrij gemuteerd.
- **RLS/tenant-isolatie:** ongewijzigd. De leespolicy filtert op `fonds_id` (generiek = `null`, breed leesbaar); hard-delete loopt uitsluitend via service-role achter `withPlatform`.
- **Reproduceerbaarheid:** de verwijdering zelf wordt append-only geaudit in `platform_event_log` (attempt+result, met `titel_snapshot`, `had_origineel`, `storage_opgeruimd`).
- **Reikwijdte:** hard-delete blijft beperkt tot `bibliotheek='generiek'`. Tenant-documenten en Decision Objects blijven principieel niet hard-verwijderbaar (`0001`, CLAUDE.md).
- **Operationeel:** migratie eerst in Supabase draaien, dán de delete gebruiken (migratie-eerst-dan-deploy). De code compileert zonder de migratie, maar de delete faalt zonder.

## Referenties

- migratie `supabase/migrations/2026_06_24_doc_meta_log_fk_drop.sql`
- `document_metadata_log` + guards: `supabase/migrations/2026_06_18_documentstatus_metadata.sql` (r.331-396)
- dedup unique index: `supabase/migrations/2026_06_24_p1_generieke_curatie.sql` (r.79-82)
- `curatieVerwijderen`: `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/acties.ts`
- [`0001`](./0001-append-only-audit-geen-harddelete.md), [`0022`](./0022-increment-P1-generieke-curatie-keuzes.md)
