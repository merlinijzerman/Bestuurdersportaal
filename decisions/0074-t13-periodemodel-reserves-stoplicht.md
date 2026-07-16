# 0074 — T13: periodemodel via registry, reserve-tabel met afgeleide stoplichtstatus

- **Status:** Geaccepteerd
- **Datum:** 2026-07-16
- **Betrokkenen:** Merlin (product/plansessie Cowork), Claude Code (implementatie)

## Context

De Balans-tab van het bestuurdersdashboard (AZL-lijn, "Plan uitbreiding stuurinformatie")
vraagt drie dingen die T11 niet had: (1) een **periodemodel** — huidig vs. voorgaand
kwartaal met een paginabrede periodefilter; (2) een volwaardig **Overzicht reserves**
met ABTN-grenzen en stoplicht; (3) een **herstructureerde balans** (activa 2 posten;
passiva-hiërarchie eigen vermogen → toetsvermogen + solidariteitsreserve +
compensatiedepot) met expliciet balansevenwicht. Randvoorwaarden: fonds-RLS per
`fonds_id` (T11-patroon), geen deelnemer-PII, geen schijnzekerheid, en een latere
beheer-/invoerlaag (handmatig + Excel-upload) die op het datamodel moet kunnen bouwen.

## Besluit

1. **Periodemodel = registry + periode-kolommen.** Nieuwe tabel
   `fonds_stuurinfo_periode` (fonds_id, periode '2026Q2', peildatum, bron, volgorde)
   is de bron van waarheid voor welke rapportageperiodes bestaan;
   `fonds_stuurinfo_kpi` en `fonds_stuurinfo_reeks` kregen een verplichte
   `periode`-kolom in de PK én een samengestelde FK naar de registry
   (afdwingbaar leidend). Bestaande rijen zijn gebackfilled naar '2026Q1'.
2. **Reserves in een eigen tabel zonder status-kolom.** `fonds_stuurinfo_reserve`
   (stand, pct_basis/pct_waarde, optionele onder-/bovengrens, volgorde). De
   stoplichtstatus wordt uitsluitend **afgeleid** in de leeslaag — geen dubbele
   waarheid tussen data en presentatie.
3. **Eén stoplichtdefinitie:** status = stand (pct) t.o.v. de band. Geen band →
   *monitoring* (neutraal, geen kleur); binnen band → *ok* (groen); onder de
   ondergrens → rood; boven de bovengrens → **oranje** (te veel buffer is een
   aandachtspunt, geen acuut tekort). Band aanwezig maar stand% onbekend →
   *monitoring* (geen schijnzekerheid). Alleen de solidariteitsreserve heeft nu
   een formele band (1,5–5,0%, ABTN); alle overige reserves zijn bewust bandloos.
4. **Subtotalen en balansevenwicht zijn afgeleid, nooit data.** Alleen leaf-posten
   staan in `fonds_stuurinfo_reeks` (taxonomie `balans_activa`/`balans_passiva`);
   toetsvermogen, eigen vermogen, totalen en het evenwicht (totaal activa =
   totaal passiva) berekent de pure module `core/lib/stuurinfo-balans.ts`.
   De richting per post volgt uit de twee periodewaarden — geen delta-kolom.
5. **Twee bewuste descopes t.o.v. het plan-doc** ("Plan uitbreiding stuurinformatie
   (AZL-lijn)", status ontwerp/werkhypothese): de **reserve-interactiematrix** is
   geschrapt (plansessie-besluit in de werkopdracht) en de **FG-trendgrafiek** is
   van de Balans-tab verwijderd (plansessie-keuze; de trenddata blijft in de DB —
   het homepage-managementsamenvattingsticket bepaalt of hij daar terugkeert).

## Overwogen alternatieven

- **Alleen een periode-kolom, geen registry** — minder tabellen, maar de filterlijst
  zou uit distinct-waarden komen en de invoerlaag (periode + peildatum + bron +
  status per periode; de beheer-mockup toont "+ Nieuwe periode aanmaken…") zou de
  registry later alsnog nodig hebben. Verworpen.
- **Status-kolom op de reserve-tabel** — maakt de invoerlaag "compleet", maar
  introduceert een tweede waarheid die uit de pas kan lopen met de grenzen.
  Verworpen; status blijft afgeleid.
- **Subtotalen (toetsvermogen/eigen vermogen) als data-rijen** — spiegelt het
  AZL-rapport, maar dan kan de hiërarchie intern niet meer sluiten zonder
  validatielaag. Verworpen; leaf-only + afleiding.
- **Boven bovengrens = rood** — symmetrisch, maar actuarieel is een te volle
  reserve een evenwichtigheids-/beleidsvraag, geen acuut risico. Oranje gekozen.

## Gevolgen

- **RLS/tenant:** beide nieuwe tabellen volgen het T11-patroon (lezen = eigen fonds;
  schrijven = voorzitter/beheerder + WITH CHECK; geen delete-policy). De
  `?periode=`-URL-parameter is géén tenant-vector: hij wordt gevalideerd tegen de
  eigen registry (onbekend → nieuwste periode); fonds_id blijft server-side.
  DB-suite: `supabase/checks/2026_07_16_t13_cross_tenant.sql`.
- **Datamodel/migraties:** PK-verbreding op twee bestaande tabellen
  (`2026_07_16_t13_stuurinfo_periode_reserve.sql`); de oude T11-balanstaxonomie
  (bescherming/overrendement/liquide, cohort-ppv, losse reserve-/overig-reeksen) is
  door de seed (`2026_07_16_t13b_…`) vervangen door de AZL-structuur; cohortdetail
  verhuist naar tab 2 (later ticket).
- **Werkhypothese (compliancegevoelig, bewust open):** de samenstelling van het
  toetsvermogen (MVEV/operationeel/overig) en de plaatsing van het compensatiedepot
  ónder eigen vermogen komen uit de AZL-referentie en zijn **niet actuarieel
  gevalideerd**; idem de vraag of MVEV-/operationele reserve later een formele band
  (→ stoplicht) krijgen. Valideren met AZL/actuaris vóór echte data-invoer.
- **Geaccepteerde schuld:** de feitentabellen blijven mutabel zonder change-log
  (restrisico uit 0054 blijft); de oude stuurinfo-reeksen (trend, deelnemer-status)
  staan alleen nog op periode 2026Q1 en worden door de nieuwe pagina niet gelezen —
  het homepage-samenvattingsticket bepaalt hun toekomst.

## Referenties

- Werkopdracht "Balans-tab stuurinformatie" (plansessie Cowork, 2026-07-16) +
  `Plan uitbreiding stuurinformatie (AZL-lijn).md` + `stuurinformatie-prototype.html`.
- Migraties: `supabase/migrations/2026_07_16_t13_stuurinfo_periode_reserve.sql`,
  `…_t13b_stuurinfo_balans_seed.sql` (+ ROLLBACKs).
- Code: `core/lib/stuurinfo-balans.ts` (pure afleiding + sanity),
  `core/lib/stuurinfo-bron.ts` (reader), `app/(dashboard)/dashboard/`.
- Eerdere besluiten: 0054 (T11-bronkeuze), 0055 (suppressie n<10), 0050 (T8-registry).
