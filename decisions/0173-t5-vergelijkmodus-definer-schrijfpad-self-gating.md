# 0173 — T5 vergelijkmodus: DEFINER-schrijfpad, self-gating deterministisch pad, geen prompt-regelset

- **Status:** Geaccepteerd
- **Datum:** 2026-08-13
- **Betrokkenen:** Merlin (product/architectuur), Claude Code (uitvoering)

## Context

T5 (epic Documentvergelijking, Fase 1) bouwt de eerste zichtbare functie op het
selectie-fundament (T1) en de semantische laag (T7/T8): een symmetrische
documentvergelijking, chat-only, als service achter een API. Binnen de bekende kaders
— tenant-isolatie/RLS ([`0169`](./0169-t7-semantische-laag-datamodelkeuzes.md)),
service-role-isolatie Variant-C ([`0066`](./0066-variant-c-cutover-optie-1.md)),
append-only reproduceerbaarheid, terugdraaibaarheid via flag, en de op sha256 gepinde
toon-prompt (CLAUDE.md) — lagen drie keuzes open die niet eenduidig uit de werkopdracht
volgden. De werkopdracht markeerde bovendien een contingentie: het deterministische
cijfer/datum-pad leunt op de T8-poorten (echt dossier + occurrence-niveau), die nog niet
zijn afgetekend.

## Besluit

1. **Schrijfpad = SECURITY DEFINER-RPC (`fn_schrijf_vergelijking`), niet de service-role.**
   De werkopdracht sprak van "service-role write", maar de vergelijking wordt getriggerd
   vanuit de interactieve chat op de app-/publiek-surface (`DEPLOY_TARGET=app`), die per
   Variant-C ([`0066`](./0066-variant-c-cutover-optie-1.md)) **geen** service-role-key
   heeft; CLAUDE.md verbiedt die key daar bovendien. De DEFINER-RPC spiegelt het bestaande
   governance-schrijfpad `schrijf_ai_interactie`: `fonds_id` wordt server-side uit
   `auth.uid()` bepaald (niet spoofbaar), `comparison_run`/`comparison_results` krijgen
   **geen** authenticated INSERT-grant (schrijven kan alleen via de functie, die als owner
   draait), en een tenant-guard weigert bevindingen die naar een document buiten het eigen
   fonds wijzen. Zelfde garantie als "service-role only" (client kan geen provenance
   vervalsen), zonder service-role op de app en zonder cross-project hop.
   *Overwogen alternatief:* compute op de app-surface, persistentie via een CRON_SECRET-
   beheer-endpoint met de echte service-role. Afgewezen: cross-project round-trip op een
   interactief pad waar de bestuurder op wacht, meer bewegende delen, geen extra garantie.

2. **Self-gating deterministisch pad achter een tweede flag.** Naast de hoofdschakelaar
   `VERGELIJKMODUS` staat er een aparte poort `VERGELIJK_DETERMINISTISCH_VERTROUWD`
   (default UIT). Zolang die uit is, valt **elke** dimensie terug op LLM-vergelijking
   (`method='llm'`), óók als beide zijden een `semantic_unit` hebben — precies de
   contingentie uit de werkopdracht, structureel gemaakt in plaats van impliciet. De poort
   gaat pas open ná het aftekenen van de twee T8-poorten (echt dossier + occurrence-niveau
   precisie, [`0171`](./0171-t8-semantische-extractie-lui-service-role-atomisch.md)).
   Extra grendel: zonder gevulde `semantic_units` (flag `SEMANTISCHE_EXTRACTIE` uit) vuurt
   het deterministische pad sowieso niet. Het deterministische pad "licht dus vanzelf op"
   zodra T8 live is én de poort bewust wordt geopend.

3. **Geen nieuwe prompt-regelset in `generatie-kern.ts`.** Het plan noemde een additief
   `SP_VERGELIJK_REGELS`. Bij de uitvoering bleek dat overbodig: een vergelijking is een
   gestructureerd service-resultaat dat door de component `VergelijkResultaatWeergave`
   wordt gerenderd, geen door het model genarreerd antwoord. Er wordt dus geen `SP_*`-set
   toegevoegd (geen dode code) en de kostbare, op sha256 gepinde toon-prompt blijft
   volledig ongemoeid.

4. **`finding_key` als expliciete T5↔T10-naad.** Eén dependency-vrije functie
   `mintFindingKey` → `fk_<sha256>` over `mode ∎ bron_document_id ∎ doel_document_id ∎
   (concept:<concept_id> | dimensie:<genormaliseerde key>)` (NUL-gescheiden,
   richtinggevoelig). T5 schrijft hem in `comparison_results`; T10 hangt
   `difference_judgements` eraan. Gepind op testvectoren + een integratietest
   (`vergelijk-t10-naad.sanity`) zodat een formaatwijziging bewust is (breekt anders de
   JOIN met bestaande oordelen).

## Gevolgen

- **Architectuur.** Pure/onzuiver-splitsing (`vergelijk-kern` pure orchestratie ↔
  `vergelijk-productie` server-only I/O), zoals `semantische-concepten` ↔
  `semantische-extractie`. De service is los van de chat testbaar (via `/api/vergelijk`).
- **Security/RLS.** Geen service-role op de app-surface; DEFINER-RPC met server-side
  fonds + tenant-guard. `comparison_results`: RLS per fonds, append-only (DB-trigger),
  authenticated read-only. Gate-check: `supabase/checks/2026_08_13_t5_vergelijking.sql`.
- **Bewust geaccepteerde grens.** Tot de T8-poorten zijn afgetekend levert T5 zijn
  cijfer/datum-verschillen via het LLM-pad (minder betrouwbaar); dat is expliciet en
  omkeerbaar met één flag.
- **Migratie eerst.** `2026_08_13_t5_vergelijking.sql` moet in Supabase draaien vóór
  code-deploy; daarna de structurele gates (A–H) + de T5-gedragstoets.
