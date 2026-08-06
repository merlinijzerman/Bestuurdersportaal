# 0129 — T2: bureau-stand produceren + Word-export (toon, taak, export-logging, B-6-markering)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-05
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Werkopdracht:** T2, plateau A — `04 Technische inrichting/Bestuurdersportaal - Werkopdracht T2 - Bureau-assistent produceren en Word-export v1.0.md`
- **Ontwerp:** `03 Functioneel ontwerp/Bestuurdersportaal - Rol Bestuursbureau ontwerp v0.3.md` (hernoemd van v0.1 bij T3), §6 / §6.3 / §6.4 / §7.7 / §9
- **Bouwt op:** [`0128`](./0128-tenant-rol-bestuursbureau.md) (rol + capabilities, T1), [`0098`](./0098-kopieren-uit-de-chat-zonder-logging.md) (herkomst als constructie), [`0079`](./0079-agenda-assistent-gedeelde-weergave.md) (geen tweede renderer), [`0089`](./0089-ai-taken-p2-voorbeeldvragen-en-document-doorgronden.md) (AI-taken-patroon)

## Context

T1 leverde de rol `bestuursbureau` met de capabilities `ai.deskresearch` en `ai.stukvoorbereiding`, maar
liet die bewust **onbedraad**. De assistent is tot nu toe uitsluitend een spiegelende gesprekspartner die
géén concepttekst produceert. Voor het bureau — dat de stukken *maakt* die het bestuur beoordeelt — is dat
het verkeerde gereedschap.

T2 bedraadt `ai.stukvoorbereiding`: de producerende bureau-stand (toon + de taak "Een stuk voorbereiden")
en de Word-export van het resultaat. `ai.deskresearch` en alles rond webbronnen blijven in T4.

Harde randvoorwaarde (nulgrens G23): een bestuurder, voorzitter of beheerder krijgt na dit increment
**exact hetzelfde antwoord op exact dezelfde vraag** als daarvoor.

## Besluit

1. **Tweede toonfamilie `TOON_BLOK_BUREAU`, additief.** Register gelijk (u-vorm, professioneel, geen
   corporate floskels; afkortingen/anti-fabricage onverkort). Wijkt op drie punten af (ontwerp §6.1):
   koppen zijn de norm, de AI levert concept ter bewerking, en de afsluiting benoemt expliciet wat nog
   niet onderbouwd is. Toegepast via één default-**uitgeschakelde** parameter `bureauToon` in
   `bouwStatischeInstructies`/`bouwSysteemBlokken`; alleen de stuk-taak zet hem `true`. `TOON_BLOK` en alle
   `SP_*` blijven **byte-voor-byte** ongewijzigd. Er komt **geen zevende antwoordmodus** bij — de stuk-taak
   draait in de basis-modus `feitelijk`.

2. **Taak "Een stuk voorbereiden" (`core/lib/stukvoorbereiding.ts`), patroon van `doorgrond.ts`.** Vier
   stuksoorten (oplegger · bestuursnotitie · memo · toelichting), elk met **vaste secties** (geen
   sectie-picker → halveert de promptmatrix en de evallast). De verplichte slotsectie **"Aannames en open
   punten"** (G13) staat bewust NIET in de per-stuksoort-lijst maar wordt door `bouwStukInstructie()`
   altijd toegevoegd — daarmee **niet uitzetbaar** (klasse D). De instructie staat in de
   **gebruikersprompt**, niet in `SP_*` (CLAUDE.md-guardrail).

3. **Guardrail-verruiming (B-3/§6.3).** De regel "geen aanbeveling" vervalt voor de bureau-stand: een
   voorstel mag, maar **uitsluitend als voorstel ván het bureau áán het bestuur**, nooit als besluit of
   eigen oordeel. Wat niet uit de bronnen te onderbouwen is, komt onder de slotsectie en wordt **niet met
   algemene kennis ingevuld** (G8). Daarom draait de taak op de strikte `SP_DOCUMENTEN_REGELS` (alleen
   `[Bron N]` uit de geselecteerde stukken), niet op `combineren`. Server-side capability-gate (G2/FR-21):
   zonder `ai.stukvoorbereiding` wordt de taak volledig genegeerd — geen instructie, geen bureau-toon.

4. **`retrieval_meta.bureau`** (taak, stuksoort, secties, bronbereik, promptvariant, rol_context) —
   geclassificeerd als `bron` in `core/lib/audit-meta.ts` én in de SQL-spiegel `meta_projectie()`. Geen
   nieuw event-type; meelift op het bestaande append-only `governance_log`.

5. **Word-export (`.docx`) op dezelfde AST, geen tweede renderer (§9).** `core/lib/antwoord-docx.ts` loopt
   over de `Blok[]`-AST uit `antwoord-parser.ts` en hergebruikt de bronnenlijst-/herkomstconstructie uit
   `antwoord-klembord.ts`. Gebouwd met de reeds aanwezige dependency **`jszip`** (een .docx is een zip van
   WordprocessingML) — géén nieuwe runtime-dep. Echte `w:tbl`-tabellen, `[Bron N]` als letterlijke tekst,
   verplichte bronnenlijst en de **bureau-herkomstregel** (§6.4, eigen anker `HERKOMST_ANKER_BUREAU`). De
   schrijffunctie **weigert** een document zonder herkomstanker (0098-patroon). Geverifieerd door de
   gegenereerde .docx terug te lezen met `mammoth`: echte tabel + literal `[Bron N]` + herkomst.

6. **Word-export wordt gelogd (B-4/G16) in een APARTE append-only tabel `governance_export_log`.** Bewust
   niet in `governance_log`: een export is geen vraag/antwoord-interactie, en meeliften zou de
   interactie- en P5-telemetrie vervuilen. Schrijven kan uitsluitend via de SECURITY DEFINER-RPC
   `log_word_export()` — gebruiker/fonds server-side uit `auth.uid()`, met een **rol-backstop
   `bestuursbureau`** die de capability-mapping spiegelt. **Geen documenttekst** (die staat al in het
   interactielog). De route `/api/ai/stuk-export` logt **vóór** het bestand wordt teruggegeven: geen
   export zonder auditregel.

7. **B-6 — markering "AI-ondersteund voorbereid", zelfverklaard.** Nieuwe kolom
   `documenten.ai_ondersteund_voorbereid` + badge op de agendapuntkaart. Het bureau vinkt het aan
   (`documents.metadata.update`, server-gate `/api/documents/[id]/ai-markering`). Omdat T2 géén werkruimte/
   conceptbeheer kent (dat is plateau B), bestaat er geen automatische keten van een gedownload .docx naar
   het later geüploade stuk; de zelfverklaarde markering (klasse D) is de bewuste MVP-keuze — conform de
   twee mitigatielagen §7.7 (markering op het stuk + zichtbaarheid voor het bestuur).

8. **`core/lib/capabilities-map.ts` afgesplitst.** De pure mapping (`Capability`, `ROL_CAPABILITIES`,
   `rolHeeftCapability`) is uit `capabilities.ts` gehaald, dat via `createServerSupabase` `next/headers`
   (server-only) meesleept. Client-componenten importeren nu de pure module; `capabilities.ts`
   her-exporteert alles, dus elke server-import blijft ongewijzigd.

## Overwogen alternatieven

- **Een aparte bureau-antwoordmodus** — afgewezen: dat is een zevende modus die het risico op nulgrens-
  drift vergroot. Een default-uitgeschakelde toon-vlag raakt geen enkele bestaande call-site.
- **`SP_COMBINEREN_REGELS` als basis voor de stuk-taak** — afgewezen: die regels staan algemene-kennis-
  aanvulling toe, wat direct botst met G8 ("gaten niet met algemene kennis dichten"). De strikte
  documentenregels dwingen G8 af.
- **De export in `governance_log` loggen via `schrijf_ai_interactie`** — afgewezen: die RPC eist
  vraag/antwoord en modelleert een interactie; een export erin persen vervuilt de interactie-query's en de
  P5-tokentelemetrie.
- **De export client-side bouwen (zoals de klembordkopie)** — afgewezen: dan is de capability-gate een
  clientcheck en kan het loggen worden overgeslagen. Server-side bouwen + eerst loggen maakt beide hard.
- **Een `docx`/`officegen`-library** — niet nodig: `jszip` staat er al en de AST-walk is klein en
  volledig onder eigen controle (past bij "geen tweede renderer").

## Gevolgen

- **Nulgrens G23 — aangetoond met diff-bewijs.** `generatie-kern.sanity.ts`: de zeven bestaande sha256-pins
  (`TOON_BLOK`, `NIEUW_*`, `SP_SPARRING`, `SP_REFLECTIE_*`, `static_feitelijk/sparring_combineren`,
  `dyn_block`) blijven **groen**; twee nieuwe pins (`TOON_BLOK_BUREAU`, `static_bureau_documenten`) plus een
  vangrail dat `bureauToon=false` byte-identiek is aan voorheen. Geen wijziging aan bronintentie, drempels,
  reformulatie, rerank of contextselectie. De formele regressiepoort op de bestuurders-evalset is T3.
- **Audit-logging:** `governance_export_log` (nieuw, append-only) + `retrieval_meta.bureau`
  (bron-niveau). `meta_projectie()` in SQL is meegespiegeld; `audit-meta.sanity.ts` bewaakt de parity.
- **Datamodel/migraties:** `2026_08_05_t2_bureau_stukvoorbereiding.sql` (+ `_ROLLBACK.sql`). Idempotent,
  transactioneel, met een fail-closed verificatieblok. `schema.sql` als documentatie bijgewerkt.
- **Verificatie groen:** `tsc --noEmit --skipLibCheck` = 0; `npm run sanity` = alle suites groen (incl.
  nieuwe `stukvoorbereiding`- en `antwoord-docx`-suites); `next build` = 0 (client/server-boundary intact,
  beide nieuwe API-routes gecompileerd).
- **Openstaand:**
  - **Migratie nog niet tegen de database gedraaid** (`psql`/`docker`/Supabase-CLI ontbreken op de
    werkplek — zelfde patroon als 0128/OP-B2). De migratie + het fail-closed verificatieblok zijn
    geschreven; `supabase/checks/2026_07_31_r1_structurele_gates.sql` (gates A–H) draait pas in CI of bij
    handmatige uitvoering ná het plakken van de migratie.
  - **Handmatige Word-smoke-test** (bureau-account → stuk voorbereiden → Word openen in échte Word) staat
    nog open; programmatisch is de .docx-geldigheid aangetoond via `mammoth`.
  - **Evals (tweede toonfamilie) + de nulgrens-regressiepoort** → T3.
  - **Deskresearch-taak + web-bronbereik** bouwen voort op deze bureau-stand → T4.

## Referenties

- Code (nieuw): `core/lib/stukvoorbereiding.ts` (+ `.sanity.ts`), `core/lib/antwoord-docx.ts`
  (+ `.sanity.ts`), `core/lib/capabilities-map.ts`, `app/api/ai/stuk-export/route.ts`,
  `app/api/documents/[id]/ai-markering/route.ts`, `app/(dashboard)/ai/_components/StukVoorbereiden.tsx`.
- Code (gewijzigd): `core/lib/generatie-kern.ts` (+ `.sanity.ts`), `core/lib/antwoord-klembord.ts`,
  `core/lib/audit-meta.ts` (+ `.sanity.ts`), `core/lib/rag.ts` (`RetrievalMeta`), `core/lib/capabilities.ts`,
  `app/api/chat/route.ts`, `app/(dashboard)/ai/_components/AssistentClient.tsx` + `Startpunt.tsx`,
  `app/(dashboard)/vergaderingen/_components/AgendapuntKaart.tsx` + `.../[id]/page.tsx`.
- Migratie: `supabase/migrations/2026_08_05_t2_bureau_stukvoorbereiding.sql` (+ `_ROLLBACK.sql`);
  documentatie in `supabase/schema.sql`.
