# 0078 — T17: tab 3 (Biometrische rendementen) — reader-afleiding naar tab 5, harde koppeling naar tab 6, batch-upsert-write, opmaaklaag

- **Status:** Geaccepteerd
- **Datum:** 2026-07-19
- **Betrokkenen:** Merlin (product/plansessie Cowork; soli-koppeling = reader-afleiding en oper-koppeling = hard in de RPC bevestigd in de Claude Code-plansessie), Claude Code (implementatie)

## Context

De werkopdracht "Biometrie-tab stuurinformatie (tab 3) + generieke opmaak-upgrade"
bouwt tab 3 (Biometrische rendementen) als verticale plak — tab-weergave +
beheer-invoer + seed — op het T13-periodemodel (0074) en het T14–T16-beheer-
fundament (0075/0076/0077). Prototype (`stuurinformatie-prototype.html` tab 3)
leidend: drie sobere ontwikkelingstabellen (langleven, PP/WZP, AO/PVI) met
afgeleid netto/resultaat; de oude staafgrafiek "biometrisch resultaat naar bron"
is bewust vervallen. De tab draait om de **verrekening met de reserves**: netto
langleven → solidariteitsreserve (tab 5); resultaten PP/WZP en AO/PVI →
operationele reserve (tab 6); binnengekomen risicopremies = de risicopremie-
componenten van tab 7. Openstaand voor besluit: het bronmodel (reeks-keys), hoe
de één-bron-koppeling met tabs 5/6/7 technisch wordt geborgd (T15/0076
reserveerde het opgeslagen punt `soli_vulling.micro_langleven` als "het
biometrische resultaat"), en waar de generieke opmaak-upgrade landt.

## Besluit

1. **Geen nieuwe tabellen; twee reeks-keys.** Tab 3 = reeks `langleven`
   (3 punt_keys: `micro` ±, `macro` ±, `vrijval` ≥ 0 = opbrengst) + reeks
   `risicodekking` (2 punt_keys: `ppwzp_toegekend` ≤ 0, `aopvi_toegekend` ≤ 0)
   in de bestaande `fonds_stuurinfo_reeks` (RLS + audittriggers gelden
   automatisch). Netto langleven, resultaat PP/WZP en resultaat AO/PVI worden
   uitsluitend AFGELEID in de leeslaag (`stuurinfo-biometrie.ts`, puur, sanity-
   getest) — nooit opgeslagen (geen halve som: null zodra een bron ontbreekt).
2. **Tab 5-koppeling = reader-afleiding (vervangt de 0076-formulering).**
   Het netto langleven-resultaat is de langleven-post in de solidariteits-
   reserve-ontwikkeling. Bewust NIET meer als opgeslagen `soli_vulling.
   micro_langleven`-rij (dat zou een afgeleide waarde als data opslaan): de
   `SOLI_VULLING_DEFINITIES` bevatten voortaan 3 INVOERbronnen (premie,
   rendement, overrendementsbijdrage) + de AFGELEIDE post `langleven`
   (volgorde 3, gemarkeerd `SOLI_LANGLEVEN_POST`). De leeslaag injecteert de
   waarde uit de langleven-reeks; de RPC `stuurinfo_soli_opslaan` berekent 'm
   zelf uit die reeks en weigert een save zonder complete langleven-reeks
   (`SOLI_LANGLEVEN_ONTBREEKT`). De t17b-seed ruimt de bestaande
   `micro_langleven`-rijen op (de langleven-decompositie sommeert exact naar
   dezelfde waarde, dus alle eindstand-checks blijven kloppen).
   *Overwogen alternatief (afgeleide write):* de biometrie-save berekent netto
   en schrijft het bestaande `micro_langleven`-punt (0076-letterlijk). Verworpen:
   afgeleide waarde als data in de DB, en twee auditlog-rijen per wijziging.
3. **Tab 6-koppeling = HARD in de RPC.** De resultaten PP/WZP en AO/PVI zijn
   afgeleide mutatieregels in de operationele-reserve-ontwikkeling (na
   'Verrekening reserves', keys `resultaat_ppwzp`/`resultaat_aopvi` —
   `OPER_RESULTAAT_DEFINITIES`). `stuurinfo_operationeel_opslaan` telt ze mee in
   de consistentiecheck: `vorige stand + som(8 ingevoerde bronnen) + resultaat
   PP/WZP + resultaat AO/PVI = huidige stand` (tolerantie 0.005). De resultaten
   worden binnen de RPC afgeleid uit `premie_component` (tab 7) + `risicodekking`
   (tab 3); ontbreekt een bron terwijl de check draait → `OPER_PREMIE_ONTBREEKT`
   resp. `OPER_BIOMETRIE_ONTBREEKT`. De resultaten worden nooit als
   `oper_mutatie`-punten opgeslagen (geen dubbele opslag).
   *Overwogen alternatief (zachte dashboard-vlag):* alleen tonen, som-check
   blijft over de 8 ingevoerde bronnen. Verworpen: dan sluit de som van de
   getoonde regels niet aantoonbaar op de standen — zwakker dan de rest van de
   stuurinformatie.
4. **Tab 7-koppeling = read-only referentie.** De binnengekomen risicopremies
   zijn de BESTAANDE `premie_component`-rijen (`risico_ppwzp`; `risico_aop` +
   `risico_pvi`). Tab 3 en de biometrie-invoersectie lezen die alleen — geen
   tweede opslag, geen tweede invoer.
5. **De biometrie-save is een app-side batch-upsert (geen RPC).** De save raakt
   uitsluitend `fonds_stuurinfo_reeks` (5 rijen); één `INSERT … ON CONFLICT`-
   statement is atomisch (spreiding-precedent, 0076). Geen eigen cross-tabel-
   consistentie in de save — de doorwerking naar tabs 5/6 wordt bij de
   soli-/oper-save hard getoetst (richtingspatroon: elke save checkt tegen z'n
   ankers; latere stroomopwaartse edits worden via de `consistent`-vlag op het
   dashboard gesignaleerd). RLS-rolgate (voorzitter/beheerder + WITH CHECK) en
   de T14-audittrigger gelden onverkort; validatie via `valideerBiometrieInvoer`
   (allowlist 400; tekenconventies vrijval ≥ 0 / toegekend ≤ 0 → 422).
6. **Generieke opmaak-upgrade in de gedeelde tokenlaag.** De professionelere
   opmaak van kaarten, KPI-tegels, tabellen en de balans (prototype) landt als
   `@layer components` in `app/globals.css` — nieuwe klassen `.si-card`,
   `.si-kpi` (accentstreepje), `.si-tabel` (gearceerde kopregel + accentlijn,
   hairlines, hover, `si-totaalrij`/tfoot als gearceerde totaalbalk, `si-num`
   = tabular-nums), `.si-balansrij`/`.si-totaalbalk`, `.si-note`/`.si-req`. Eén
   nieuw schaduwtoken `--shadow-card` (ink-getint, op de warme paper-achtergrond)
   + `boxShadow.card` in `tailwind.config.ts`. Uitsluitend op de bestaande
   semantische tokens (geen prototype-hexen; de greys mappen op `app-zebra`/
   `app-line`/`app-line-strong`). Alle stuurinformatie-dashboardtabs (1, 3, 4,
   5, 6, 7 + shell) zijn van inline utility-styling naar deze klassen
   gemigreerd — één bron van waarheid, geen per-pagina-inline-styling.

## Gevolgen

- **Invoervolgorde wordt strikter:** balans → premie → biometrisch →
  solidariteit/operationeel. De beheer-UI maakt dit expliciet met blokkers
  ("vul eerst 3 · Biometrisch in", "sla eerst de balans op") vóór de save
  (UX-principe "blokkers expliciet"), naast de harde DB-weigeringen.
- **Pre-seed degradatie is correct, geen fout:** zolang de t17b-seed
  (risicodekking-rijen) niet is toegepast, tonen de tab 6-resultaatregels en
  daarmee totaal mutatie/ultimo "—" (geen halve som) i.p.v. een verkeerd getal.
  Zelfherstellend na de migratie+seed.
- **Audit:** de biometrie-writes worden automatisch door de bestaande
  T14-capture-trigger gelogd (tabel `reeks`); de t17b-opschoning (delete van
  `micro_langleven`) gebeurt als seed-owner (geen app-delete-pad; t13b-precedent).
- **Migratie-eerst:** draai `2026_07_19_t17` (RPC-replaces) → `t17b` (seed +
  herijking + opschoning) vóór de code-deploy; rollback in omgekeerde volgorde
  (seed-rollback herstelt de `micro_langleven`-rijen die de T15-functie
  verwacht, dán de functie-rollback).

## Openstaande punten (te valideren met Merlin / actuaris)

- **Kritiek (compliancegevoelig):** dat het langleven-resultaat met de
  solidariteitsreserve en de risicodekkingen (PP/WZP, AO/PVI) met de
  operationele reserve worden verrekend — bevestigen tegen de ABTN/financiële
  opzet. Labels/notes zijn zonder schijnzekerheid geformuleerd (werkhypothese).
- **Openstaand:** vrijval van kapitaal bij overlijden als aparte langleven-post
  (opbrengst) naast micro-langleven, of onderdeel daarvan — actuarieel valideren.

## Referenties

- Werkopdracht "Biometrie-tab stuurinformatie (tab 3) + generieke opmaak-upgrade"
  (plansessie Cowork); `stuurinformatie-prototype.html` tab 3.
- Migraties: `2026_07_19_t17_stuurinfo_biometrie.sql` (+ `_ROLLBACK`),
  `2026_07_19_t17b_stuurinfo_biometrie_seed.sql` (+ `_ROLLBACK`).
- Code: `core/lib/stuurinfo-biometrie.ts` (+ `.sanity.ts`), `stuurinfo-bron.ts`
  (`haalStuurinfoBiometrie`), `stuurinfo-soli.ts`, `stuurinfo-operationeel.ts`,
  `stuurinfo-invoer.ts`, `stuurinfo-beheer.ts`, `stuurinfo-beheer-bron.ts`,
  `app/(dashboard)/dashboard/biometrie/page.tsx`,
  `app/(dashboard)/beheer/stuurinformatie/_components/BiometrieInvoer.tsx`,
  `app/globals.css`, `tailwind.config.ts`.
- Tests: `core/lib/stuurinfo-biometrie.sanity.ts`,
  `tests/cross-tenant/t17-stuurinfo-biometrie.test.ts`,
  `supabase/checks/2026_07_19_t17_cross_tenant.sql`.
- Bouwt voort op 0074 (periodemodel), 0075 (beheerfundament), 0076 (soli-patroon,
  micro_langleven-reservering — hier herzien), 0077 (ontwikkelings-afleiding).
