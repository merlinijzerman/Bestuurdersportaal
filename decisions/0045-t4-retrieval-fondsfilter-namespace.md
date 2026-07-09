# 0045 — Expliciete retrieval-fondsfilter + namespace-conventie (increment T4)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-08
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

Werkopdracht **T4 — RAG-tenantdiscipline** (multi-tenant T-serie, beslisnotitie
*Multi-tenant frontend en modulescheiding v0.4* §12/§15, besluit
[`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) B4):
maak de fonds-discipline op het retrievalpad **expliciet, bewijsbaar en
manipulatie-resistent als defense-in-depth NÁÁST RLS**. RLS per `fonds_id` blijft
de primaire tenant-isolatie (huispatroon 0039); T4 voegt aantoonbaarheid toe.

Bij aanvang liep de fondsgrens op de retrieval uitsluitend via RLS. De
`zoekRelevanteChunksMetMeta`-parameter `_fondsId` was **decoratief** (ongebruikt),
en drie retrievalpaden bestonden náást de RPC's: de PostgREST-fallbackcascade
(`fts_plain`/`ilike`) en `haalDocumentChunks` — allemaal RLS-only.

### Premisse-correctie (leidend voor het hele ontwerp)

De werkopdracht ging uit van **`document_chunks.fonds_id NOT NULL`**. As-built
heeft `document_chunks` **geen eigen `fonds_id`-kolom** (geverifieerd tegen
migraties 2026_06_20d, 2026_06_19e, 2026_05_30). De tenantgrens loopt via de
**join naar `documenten`**, waar `fonds_id` nullable is: `NULL` voor generiek
(`bibliotheek='generiek'`), gezet voor fonds. De veronderstelde spanning ("hoe
kan een generieke chunk fonds_id NOT NULL hebben") **bestaat niet**.

## Besluit

1. **Namespace-conventie = `bibliotheek`.** De generiek/fonds-scheiding loopt via
   de kolom `documenten.bibliotheek` (`'generiek'` | `'fonds'`), niet via een
   fonds_id op de chunk. De expliciete fondsfilter landt op `d.fonds_id` (de
   gejoinde documenten-rij). Vastgelegd in `retrieval_meta.namespace_conventie`.

2. **Expliciete fondsfilter in de RPC (`p_fonds_id`).** Beide retrieval-RPC's
   krijgen `p_fonds_id uuid default null`. Gezet ⇒ fondschunks alleen waar
   `d.fonds_id = p_fonds_id`, generieke chunks (`bibliotheek='generiek'`) als
   gedeelde read-only laag. **Additief op RLS — verruimt nooit leesrechten.**
   `default null` = exact huidig gedrag (geen regressie). Filter in de RPC zodat
   hij niet te omzeilen is.

3. **Published-only voor generiek (T13/T14), modus-onafhankelijk.** Generieke
   chunks komen alleen mee als `documentstatus='van_kracht'` EN
   `coalesce(bronstatus,'actief')='actief'`. Ingetrokken/gearchiveerd/uitgesloten
   generiek telt niet als actuele bron. Fondsdocumenten vallen **niet** onder deze
   gate (eigen lifecycle + bestaande modusfilters). Volledige status-workflow is
   T6/T10; T4 borgt alleen de retrieval-koppeling.

4. **`fonds_id` in de RPC-return.** Nodig om de app-guard betekenisvol te maken
   (`bibliotheek` alleen kan niet vaststellen wélk fonds) en om de bronversie-audit
   het toegepaste fonds per bron vast te leggen. Generiek ⇒ NULL (meteen het bewijs
   "gedeelde bron").

5. **App-laag guard op ELK pad (`handhaafFondsdiscipline`).** Defense-in-depth
   náást RLS + RPC: dropt cross-tenant/niet-published chunks en **telt** de
   droppings (`retrieval_meta.fondsdiscipline_gedropt`). >0 = signaal dat een
   onderliggende laag iets doorliet. Draait ook op de fallbackpaden en
   `haalDocumentChunks`, die niet door de RPC (met `p_fonds_id`) lopen. De
   fallback-selects leveren daarom nu `fonds_id` + document-/bronstatus mee.

6. **Fonds server-side geresolveerd, request genegeerd + gelogd.** De fonds komt
   uitsluitend uit `profiel.fonds_id` (via RLS; T1.3/besluit
   [`0042`](./0042-tenant-enforce-fail-closed-env-schakelaar.md)). Een
   request-supplied `body.fonds_id` die afwijkt wordt genegeerd, gelogd
   (`console.warn`) en vastgelegd in `retrieval_meta.body_fonds_id_genegeerd`.
   `app/api/zoeken` haalt nu óók het profiel-fonds op (was `""`), fail-closed 403.

7. **Bronversie-audit.** `retrieval_meta.bronversie_audit[]` legt per geselecteerde
   bron `document_id/bron/bibliotheek/fonds_id/documentstatus/bronstatus/documentdatum`
   vast. Append-only in `governance_log.retrieval_meta` (geen wijziging aan de
   append-only-garanties).

## Overwogen alternatieven

- **`document_chunks.fonds_id NOT NULL` toevoegen (zoals de werkopdracht suggereerde)**
  — verworpen: de premisse klopte niet; het zou een overbodige denorm-kolom +
  backfill introduceren terwijl de join naar `documenten` de grens al draagt.
  Een `CHECK`-constraint op de namespace-consistentie is een **T6-aanbeveling**.
- **Alleen RLS (geen expliciete filter)** — verworpen: voldoet niet aan de
  T4-eis van *bewijsbaarheid* en dekt de RLS-only fallbackpaden niet aantoonbaar.
- **Alleen app-guard (geen RPC-filter)** — verworpen: een filter in de RPC is
  niet te omzeilen; de app-guard alléén wel (een toekomstig codepad kan hem
  overslaan). Vandaar beide lagen.
- **Published-gate alleen in modus 'actueel'** — verworpen: T13/T14 vragen dat
  ingetrokken generiek nóóit als actuele bron surfacet, ook in modus 'alles'.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd en primair. De filter is additief en kan
  zichtbaarheid nooit verruimen; `p_fonds_id=null` = exact RLS-only gedrag.
- **Audit:** rijker `retrieval_meta` (fondsfilter, namespace, drop-telling,
  manipulatie-vlag, bronversie-audit). Zelfde append-only kanaal.
- **Datamodel/migraties:** geen chunk-/documenten-kolomwijziging. RPC-signatuur +
  return-type wijzigen → `drop function` + `create` (niet `create or replace`).
  Idempotente migratie
  [`2026_07_08_t4_retrieval_fondsfilter.sql`](../supabase/migrations/2026_07_08_t4_retrieval_fondsfilter.sql)
  (+ `_ROLLBACK`). **Migratie-first:** eerst in Supabase draaien, dán code-deploy
  (de app geeft `p_fonds_id` mee en verwacht de `fonds_id`-returnkolom).
- **Gedragswijziging (bewust):** generieke bronnen met status
  `alleen_historisch`/`gearchiveerd` of bronstatus `historisch`/`uitgesloten` die
  vandaag in modus 'alles' meekwamen, vallen voortaan weg als actuele bron.
  Fondsdocumenten ondervinden geen wijziging.
- **Verhouding T6:** namespace-`CHECK` (fonds ⇒ fonds_id NOT NULL; generiek ⇒
  fonds_id NULL) en de volledige generiek-status-workflow zijn T6/T10-scope.

## Referenties

- Migratie: [`2026_07_08_t4_retrieval_fondsfilter.sql`](../supabase/migrations/2026_07_08_t4_retrieval_fondsfilter.sql) (+ `_ROLLBACK`)
- Verificatie: [`supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql`](../supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql) (T11–T14),
  [`lib/rag-fondsdiscipline.sanity.ts`](../lib/rag-fondsdiscipline.sanity.ts) (pure guard)
- Code: [`lib/rag.ts`](../lib/rag.ts), [`app/api/chat/route.ts`](../app/api/chat/route.ts), [`app/api/zoeken/route.ts`](../app/api/zoeken/route.ts)
- Besluiten: [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) (B4),
  [`0042`](./0042-tenant-enforce-fail-closed-env-schakelaar.md) (R2 — server-side auditfonds),
  [`0044`](./0044-maak-profiel-deterministische-fondstoewijzing.md) (deterministisch profiel-fonds)
- Controlekader: [`T3-RLS-CONTROLEKADER.md`](../T3-RLS-CONTROLEKADER.md) §2
