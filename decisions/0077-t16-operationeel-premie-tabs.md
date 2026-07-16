# 0077 — T16: tabs 6 (Operationeel) + 7 (Premie & compensatie) — kosten als post, ultimo = balans, depot-seed-correctie

- **Status:** Geaccepteerd
- **Datum:** 2026-07-16
- **Betrokkenen:** Merlin (product/plansessie Cowork; depot-correctie en premie-KPI bevestigd in de Claude Code-plansessie), Claude Code (implementatie)

## Context

De werkopdracht "Operationeel- én Premie/compensatie-tab stuurinformatie" bouwt
tab 6 (Operationeel beleid: ontwikkeling operationele reserve met kosten als
geaggregeerde post, norm/band, kostendetail) en tab 7 (Premie- &
compensatiebeleid: premiecomponenten met % grondslag, uitputtend
compensatiedepot, meerjaren-uitputtingsprognose) als verticale plakken —
tab-weergave + beheer-invoer + seed — op het T13-periodemodel (0074) en het
T14/T15-beheerfundament (0075/0076). Prototype (`stuurinformatie-prototype.html`
tabs 6/7) leidend voor presentatie. Openstaand voor besluit: het datamodel
(reeks-/kpi-keys, twee waarden per punt), de plaats van de oper-norm/band, de
koppeling van de ultimo's aan de balans, en een seed-conflict: de T13b-balans
seedde het compensatiedepot stijgend (Q1 40 → Q2 41) terwijl het depot per
ontwerp uitputtend is (prototype: 42,4 → 41,0).

## Besluit

1. **Geen nieuwe tabellen; gedeelde ontwikkelingslogica als éne module.**
   Tab 6 = reeks `oper_mutatie` (8 punt_keys: `premie_kostenopslag`,
   `beschermingsrendement` ±, `overrendement`, `gemist_rendement_twk`,
   `twk_invaar`, `verrekening_reserves`, `overig`, `kosten` — de kosten als
   geaggregeerde negatieve post ín de ontwikkeling, conform werkopdracht) +
   kostendetail als twee reeksen `oper_kosten_realisatie`/`oper_kosten_begroot`
   (long-format kent één scalaire waarde per rij — "realisatie + begroot per
   punt" wordt dus twee reeksen met dezelfde punt_keys) + kpi's `oper_norm`/
   `oper_band_onder`/`oper_band_boven`. Tab 7 = reeksen `premie_component` (€)
   + `premie_component_pct` (% grondslag, zelfde punt_keys), `comp_mutatie`
   (6 bronnen incl. `onttrekkingen` −), `comp_uitputting_prognose` (punt_key =
   jaartal, snapshot per periode) + kpi's `comp_toekenning_jaar`,
   `comp_startomvang`, `comp_ondergrens_pct`. Totaal mutatie, primo, ultimo en
   totaal premie worden uitsluitend AFGELEID; de identieke primo→mutaties→
   ultimo-logica van beide tabs staat één keer in `stuurinfo-ontwikkeling.ts`
   (puur, sanity-getest) — geen twee kopieën die uiteen kunnen lopen.
2. **Ultimo = balans-stand (één bron).** De ultimo van tab 6 is per definitie
   de reserve-rij `operationele_reserve` (= balans-leaf `ev_toets_oper`); die
   van tab 7 de rij `compensatiedepot` (= `ev_comp`) — het soli-patroon (0076).
   Primo = stand van de voorgaande periode; oudste periode: teruggerekend.
3. **Mutatie-consistentie is HARD (soli-patroon).** Twee nieuwe
   `security invoker`-RPC's (`stuurinfo_operationeel_opslaan`,
   `stuurinfo_premie_opslaan`; T14b-gehard: geen fonds-parameter, allowlists,
   typechecks vóór casts, vaste labels, revoke PUBLIC/anon) schrijven elk hun
   sectie atomisch en weigeren als vorige stand + som(mutaties) ≠ huidige stand
   (`OPER_/COMP_MUTATIE_ONGELIJK`, tolerantie 0.005) of als de reserve-rij
   ontbreekt (`OPER_/COMP_RESERVE_ONTBREEKT` → "sla eerst de balans op").
   De RPC's raken de reserve-rijen zelf NIET (stand/pct blijven van de
   balans-save). UI blokkeert vooraf; leeslaag signaleert achteraf ontstane
   afwijkingen via een `consistent`-vlag.
4. **Norm + band operationele reserve als kpi's in € MLN — niet op de
   reserve-rij.** De reserve-rij-band is in % van de TV en voedt het tab
   1-stoplicht; de tab 6-norm/band uit het prototype zijn bedragen. Een band op
   de reserve-rij zou het tab 1-stoplicht ongevraagd van "monitoring" naar een
   bandtoets flippen. Spreiding-precedent (`uitkeringsfase_band_*`) gevolgd.
5. **Depot-seed-correctie (bevestigd door Merlin).** T13b seedde het
   compensatiedepot Q1 40 → Q2 41 (stijgend) — in strijd met het uitputtende
   karakter. De t16b-seed corrigeert Q1 naar 42,4 (horizon) binnen een
   sluitende balans (passiva `overig` 5 → 2,6; som blijft 2432) en werkt de
   gekoppelde reserve-rij bij (stand + pct 1,9); meridiaan analoog (17 → 18,6;
   `overig` 2 → 0,4). Daarmee daalt het depot zoals bedoeld (mutatie −1,4) en
   werken de prototype-mutaties verbatim. Bewuste uitzondering op het
   0076-principe "data wint van prototype": hier won de interne
   ontwerpconsistentie (uitputtend depot) van de bestaande seed.
6. **Premie-KPI = afgeleid kwartaaltotaal (bevestigd door Merlin).** De
   prototype-tegel "Totale jaarpremie € 75 mln" is niet zonder
   annualisatie-aanname uit de kwartaaldata af te leiden (19×4 = 76 ≠ 75).
   De tegel toont het afgeleide kwartaaltotaal (€ 19,0 · 31,63% v. grondslag) —
   geen aangeleverde jaarpremie-kpi die van de componenten kan gaan afwijken.
7. **€ én % per premiecomponent zijn beide aangeleverd** (uitvoerder), conform
   de werkopdracht-scope; het % wordt bewust niet uit een grondslag-kpi
   berekend (de echte splitsing en de grondslagdefinitie zijn openstaande
   valideerpunten — geen schijnzekerheid door zelf te delen).
8. **Uitputtingsprognose = aangeleverde ALM-reeks, seed/upload-only.** Geen
   handinvoer van tijdreeksen (werkopdracht-scopegrens), geen berekening of
   extrapolatie in het portaal: het ondergrens-kruisjaar is het eerste
   prognosejaar onder `ondergrens_pct × startomvang`; de "uitputting" is de
   laatste aangeleverde prognosestand. Premiedekkingsgraad en "wie compenseert
   wie" zijn bewust verwijderd (werkopdracht-besluit 7).
9. **Kostendetail (YTD) wordt bewust niet hard gekoppeld aan de geaggregeerde
   kwartaal-kostenpost** in de ontwikkeling: het detail is een aangeleverde
   YTD-uitsplitsing, de post een kwartaalmutatie (het prototype is daar zelf
   niet consistent). Alleen zachte presentatie + duidingstekst.
10. **Geaccepteerde presentatie-afwijkingen van het prototype** (ontwerp-sync-
    review): tab 7 toont depot-ontwikkeling en uitputtingsgrafiek naast elkaar
    (2-koloms i.p.v. onder elkaar); de ondergrenslijn in de grafiek is in €
    gelabeld (afgeleid bedrag) met dynamische y-as i.p.v. het vaste "40%"/60-
    30-0; de gauge-statustekst staat als duidingsnote onder de SVG; de
    kosten-barbreedte = realisatie ÷ begroot met rood overschrijdingssignaal
    (prototype-widths waren zelf inconsistent met de cijfers); % v. norm met
    1 decimaal (112,5%).

## Overwogen alternatieven

- **Oper-band op de reserve-rij** — zou tab 1 automatisch een bandtoets geven,
  maar de eenheden botsen (% van TV vs. € mln) en het stoplicht zou ongevraagd
  flippen. Verworpen (kpi-patroon).
- **Depot-standen laten staan (data wint)** — 0076-conform, maar dan stijgt
  een per ontwerp uitputtend depot dit kwartaal en klopt het bestuurlijke
  verhaal niet. Verworpen door Merlin voor de gerichte Q1-correctie.
- **Jaarpremie als aangeleverde kpi** — prototype-getrouw maar een losse
  waarde die van de componenten kan afwijken. Verworpen door Merlin.
- **% grondslag afleiden uit een grondslag-kpi** — minder invoer, maar
  contractuele percentages en gerealiseerde bedragen hoeven niet exact te
  delen; definitie grondslag onbevestigd. Verworpen.
- **Ontwikkelingslogica per tab dupliceren (soli-stijl zelfstandig)** — meer
  symmetrie met T15, maar tab 6/7 delen exact dezelfde afleiding; één generieke
  module voorkomt divergentie. Gekozen voor `stuurinfo-ontwikkeling.ts`.

## Gevolgen

- **RLS/tenant:** geen policywijziging; alle nieuwe rijen vallen onder de
  T13-policies (lezen eigen fonds; schrijven voorzitter/beheerder + WITH CHECK;
  geen delete). Twee nieuwe SECURITY INVOKER-RPC's zonder fonds-parameter.
  DB-suite `supabase/checks/2026_07_18_t16_cross_tenant.sql` (T16a–g) bedraad
  in `cross-tenant-ci.sh`; app-laag `tests/cross-tenant/t16-…test.ts`.
- **Audit:** de T14-capture-triggers dekken alle nieuwe writes automatisch;
  ook de depot-correctie in de t16b-seed wordt gelogd (actor/bron null =
  systeem/seed). De seed-ROLLBACK laat het append-only log bewust intact.
- **Demo-data-impact van de correctie:** tab 1 toont voor 2026Q1 voortaan
  compensatiedepot 42,4 en overige voorzieningen 2,6 (horizon; meridiaan
  18,6/0,4). Balansevenwicht blijft sluiten; alle overige standen ongewijzigd.
- **Volgorde-risico (geaccepteerd, zelfde als 0076):** een balans-save ná een
  oper-/premie-save kan de mutatie-relatie breken zonder hercheck; mitigatie
  via de `consistent`-vlag + zichtbaar inconsistentie-signaal op de tab.
- **UI-blokkers dekken bewust niet álle server-weigeringen** (code-review,
  geaccepteerd): negatieve norm/kosten, band onder > boven, % > 100 en
  startomvang ≤ 0 worden door validator/RPC geweigerd met een leesbare 400/422;
  de UI blokkeert alleen de hoofdscenario's vooraf (lege velden, ontbrekende
  reserve-rij, mutatie-afwijking, onparseerbare optionele velden) — de server
  is de echte grens.
- **"Vorige periode"-semantiek (zelfde als 0076, laag):** de RPC's pakken de
  recentste eerdere periode mét reserve-rij; leeslaag en beheer-UI de directe
  vorige periode. Bij een gat kunnen die verschillen (DB strenger dan UI —
  veilige richting); bewust niet gelijkgetrokken.
- **Seed-ROLLBACK verwijdert alleen seed-rijen** (`invoer_bron is null`,
  audit-review): rijen die een beheerder inmiddels via de RPC's invoerde
  blijven staan en zijn apart te beoordelen — gebruikersinvoer wordt nooit
  ongelogd weggegooid.
- **`heeftData`-randgeval (geaccepteerd, klein):** een periode met alléén
  kostendetail (tab 6) of alléén een prognose (tab 7) toont de lege staat;
  de seed vult altijd de kernreeksen, dus dit treedt in de praktijk niet op.
- **Sjabloon-upload niet uitgebreid** (0076-lijn): de tab 6/7-velden en de
  prognose-reeks komen in één samenhangende sjabloonwijziging later.
- **Werkhypotheses (compliancegevoelig, valideren met actuaris/uitvoerder vóór
  echte data):** (a) definities en structurele terugkeer van de TWK-posten
  (gemist rendement, invaarmutaties) en verrekening reserves; (b) "premie" in
  de reserve-ontwikkeling = kostenopslag; (c) kosten als geaggregeerde post in
  de ontwikkeling; (d) premiesplitsing + grondslagdefinitie; (e) hoe/of het
  depot wordt gevoed en de definities van onttrekkingen/verrekening/overig;
  (f) uitputtingsprognose-methodiek (ALM) en de ondergrens-conventie
  (% van startomvang); (g) de conceptuele koppeling opslagen → operationele
  reserve is alleen als duiding verwoord, niet als datarelatie gemodelleerd.
- **Rendement-koppeling (vervolgpunt uit de werkopdracht):**
  beschermings-/overrendement komen nu als losse waarden terug in meerdere
  reserve-ontwikkelingen én straks tab 2; herleidbaar modelleren (analoog aan
  micro-langleven ↔ tab 3) is bewust doorgeschoven naar het tab 2-ticket.

## Referenties

- Werkopdracht "Operationeel- én Premie/compensatie-tab stuurinformatie"
  (plansessie Cowork, 2026-07-16) + `stuurinformatie-prototype.html` (tabs 6/7).
- Migraties: `supabase/migrations/2026_07_18_t16_stuurinfo_oper_premie.sql`
  (RPC's) + `…_t16b_stuurinfo_oper_premie_seed.sql` (depot-correctie + seed)
  (+ ROLLBACKs).
- Code: `core/lib/stuurinfo-ontwikkeling.ts` (generieke afleiding),
  `stuurinfo-operationeel.ts`, `stuurinfo-premie.ts` (puur + sanity),
  `stuurinfo-bron.ts` (readers), `stuurinfo-invoer.ts` (validators),
  `stuurinfo-beheer{,-bron}.ts`, `app/(dashboard)/dashboard/{operationeel,premie}/`,
  `app/(dashboard)/beheer/stuurinformatie/_components/{Operationeel,Premie}Invoer.tsx`.
- Eerdere besluiten: 0074 (T13-periodemodel), 0075 (T14-invoerlaag, geen
  vier-ogen), 0076 (T15-patronen: harde consistentie, per-sectie saves,
  seed-afwegingen), 0055 (suppressie n<10).
