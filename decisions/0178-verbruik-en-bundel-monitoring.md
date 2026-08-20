# 0178 — Weergave "Verbruik & bundel" (monitoring): databron, config en grenzen

- **Status:** Geaccepteerd
- **Datum:** 2026-08-15
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude Code (uitvoering/advies)
- **Relatie:** bouwt voort op de P5-monitoringtranche
  ([`2026_08_03_p5_monitoring.sql`](../supabase/migrations/2026_08_03_p5_monitoring.sql),
  `MONITORING-P5-ONTWERP.md`) en het live tokenverbruik-signaal. Uitrol volgt het
  preview-first-pad uit [`0175`](./0175-preview-productie-scheiding.md)–[`0177`](./0177-app-blijft-productie-preview-ernaast-en-beheer-gescheiden.md).
  Bron-mockup: `MOCKUP-monitoring-verbruik-bundel-v0.2.html`. Werkopdracht:
  `WERKOPDRACHT-VERBRUIK-EN-BUNDEL-MONITORING-v0.1.md`.

## Context

De back-office wil het AI-verbruik per fonds afgezet zien tegen de licentiebundel —
voor prijsstelling, klantgesprek en tijdige signalering vóór een fonds de bundel
overschrijdt. De mockup rekende bundel, pro-rata, prognose en doorbelasting
uitsluitend client-side op vier fictieve fondsen. Voor een productiewaardige
weergave moesten zes punten (B-1 t/m B-6) worden vastgelegd; ze bepaalden of dit
een UI-ticket of een datamodel-increment werd. De verificatie tegen de code:

- **`platform_signal_snapshots.meta` is ongeschikt** als bron voor cumulatief euro:
  het bevat een trend-%, een gecombineerde (in+out) 24-uurssom, geen maandbucket,
  onderdrukt het absolute getal onder de n-drempel en pruned na 180 dagen.
- **`governance_log.retrieval_meta->tokens = {in, out}`** is de append-only,
  in/out-gesplitste per-aanroepbron, met `fonds_id` + `aangemaakt`. `tokens` staat
  in de `c_basis`-allowlist (telemetrie) en blijft dus op het audit-skelet — buiten
  de inhoud-retentie (`chat/route.ts`, `2026_08_12_t3_retrieval_meta_selectie.sql`).
- **Cache-tokens zitten opgeteld in `tokens.in`** (`cache_creation + cache_read`);
  ze zijn niet apart uitsplitsbaar zonder het schrijfcontract te wijzigen.
- **`voorbereiding` en `besluit-concept` schrijven geen governance_log-regel**;
  reranker/query-reformulatie/web_search tellen niet mee → het cijfer is een
  ondergrens (pre-existent dekkingsgat, §11 P5-ontwerp).
- **Er bestond geen bundel, tarief of contract-ingangsdatum per fonds**; `fondsen`
  heeft alleen `aangemaakt` (rij-creatie).

## Besluit

1. **B-1 — Databron: pad 2, live aggregatie.** De maand-in/out per fonds wordt
   read-time afgeleid uit `governance_log.retrieval_meta->tokens`, in een
   platform-lib (`verbruik-bundel-lees.ts`) achter `withPlatformRead`. **Geen**
   nieuw verbruik-DB-object (geen materialized view, geen per-aanroep-verbruikslog).
   De leeslimiet (`LEESLIMIET`) begrenst de query; `afgekapt` markeert de undercount.
2. **B-2 — Config: nieuwe tabel `public.fonds_licentie`.** Platform-beheerd,
   deny-by-default (RLS aan, geen policy, revoke van anon/authenticated), met
   `bundel_eur_jaar`, `tarief_in_eur_mln`, `tarief_uit_eur_mln`, `contract_start`
   en `geldig_vanaf` (tegen stille herberekening van historie). Commerciële data —
   bewust **niet** via tenant-RLS aan het fonds zelf ontsloten.
3. **B-3 — Cache: niet apart in V0.2.** Cache volgt het bestaande schrijfcontract
   en zit in het input-tarief. Apart beprijzen vergt een providercontract-wijziging;
   buiten scope.
4. **B-4 — Dekkingsgat: accepteren en zichtbaar labelen.** De weergave toont het
   "indicatief"-voorbehoud prominent en presenteert de euro's nooit als hard bedrag.
   Het dichten van het gat (routes voorbereiding/besluit-concept) is een apart ticket.
5. **B-5 — Doorbelasting: alleen weergave/signaal.** Geen factureerbaar bedrag,
   geen facturatiepad. De UI-copy vermijdt bewust de indruk van een factuur
   ("Boven bundel · signaal", "niet gefactureerd").
6. **B-6 — Productiewaardig op echte data.** De weergave aggregeert live
   `governance_log`. De fictieve pilotcijfers zijn uitsluitend een **Preview-seed**
   voor de licentie-config (`2026_08_15_fonds_licentie_seed_preview.sql`); er wordt
   geen productie-verbruik naar Preview gekopieerd. De exacte mockup-scenario's
   worden bewezen door `core/lib/verbruik-bundel-core.sanity.ts`, niet door
   synthetische tokens in het append-only governance_log te schrijven.

## Impactklasse

`data` + `tenant` — uitsluitend door de nieuwe `fonds_licentie`-tabel. De
verbruik-aggregatie voegt geen DB-object toe. Gevolg: structurele gates A–H
schoon draaien tegen de doeldatabase (per omgeving) en de documentatiehaak vuurt.

## Gevolgen

- Nieuwe bestanden: `core/lib/verbruik-bundel-core.ts` (+ `.sanity.ts`),
  `platform/lib/verbruik-bundel-lees.ts`, de UI-componenten `VerbruikBundel.tsx`
  en `MonitoringWeergave.tsx` (subtab in de bestaande monitoringmodule), en de
  migraties `2026_08_15_fonds_licentie.sql` (+ ROLLBACK) en de Preview-seed.
- `fonds_licentie` draagt een eigen `fonds_id` → gate A1 slaat de tabel over en
  gate B vindt geen policy: geen register-wijziging in
  `supabase/checks/2026_07_31_r1_structurele_gates.sql` (zelfde als
  `platform_signal_snapshots`).
- De weergave is platform-only (beheer-surface), niet tenant-facing. `fonds_id`
  wordt server-side afgeleid; verbruik lekt niet tussen fondsen.

## Openstaande punten

- **OP-1** Dekkingsgat routes *voorbereiding* / *besluit-concept* → cijfers
  indicatief. *Eigenaar: Merlin (apart ticket ja/nee).*
- **OP-2** ~~Beheer-schrijf-UI voor bundel/tarief per fonds.~~ **Gebouwd (2026-08-15):**
  `app/(platform)/platform/(beveiligd)/licenties/` (page + `acties.ts` + client),
  schrijft `fonds_licentie` via `withPlatform` (capability `platform.config.manage`,
  handeling `fondslicentie.opslaan`, twee-fasen-audit), met versie-ophoging en
  `geldig_vanaf`. Resterend beleid (wie mag wijzigen, vier-ogen, geldigheidsdatum-
  governance) blijft een Merlin-keuze. *Eigenaar: Merlin.*
- **OP-3** Reproductie van het rijke mockup-scenario in de live Preview-weergave
  vergt synthetische governance_log-usage; bewust niet gedaan om het append-only
  auditspoor niet permanent te vervuilen. *Eigenaar: Merlin / techlead.*
