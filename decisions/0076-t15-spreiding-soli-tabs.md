# 0076 — T15: tabs 4 (Spreiding) + 5 (Solidariteit) — band op reserve-rij, harde eindstand-consistentie, seed volgt de data

- **Status:** Geaccepteerd
- **Datum:** 2026-07-16
- **Betrokkenen:** Merlin (product/plansessie Cowork; consistentie- en sjabloonkeuze bevestigd in de Claude Code-sessie), Claude Code (implementatie)

## Context

De werkopdracht "Spreiding- én Solidariteit-tab stuurinformatie" bouwt tab 4
(Spreidingsbeleid, model collectieve uitkeringsfase) en tab 5
(Solidariteitsbeleid, ontwikkeling solidariteitsreserve met vulling naar bron)
als verticale plakken — tab-weergave + beheer-invoer + seed — op het
T13-periodemodel (0074) en het T14-beheerfundament (0075). Het prototype
(`stuurinformatie-prototype.html` tabs 4/5) en de beheer-mockup zijn leidend
voor de presentatie. Openstaand voor besluit: het datamodel (kpi-/reeks-keys),
de plaats van de soli-bandbreedte, de omgang met de eindstand-afleiding
(begin + netto − uitdeling vs. de balans-stand) en de seedwaarden.

## Besluit

1. **Geen nieuwe tabellen.** Tab 4 = vijf kpi-rijen per periode
   (`uitkeringsfase_beschikbaar`, `_voorziening`, `_aanpassingsfactor`,
   `_band_onder`, `_band_boven`) + maandreeks `uitkeringsfase_fg_maand`
   (punt_key `'00'..'11'`, maandlabel in `label` — trend_fg-conventie).
   Tab 5 = reeks `soli_vulling` (punt_keys `premie|rendement|micro_langleven|
   overrendementsbijdrage`, ± in € mln) + kpi `soli_uitdeling`.
   Spreidingsvermogen, FG uitkeringsfase, netto vulling, begin- en eindstand
   worden uitsluitend AFGELEID in pure modules (`stuurinfo-spreiding.ts`,
   `stuurinfo-soli.ts`, sanity-getest) — geen opgeslagen duplicaat.
   De **aanpassingsfactor is invoer van de actuaris** (ABTN-formule,
   fondsspecifiek) en wordt bewust niet in het portaal nagerekend.
2. **Band solidariteitsreserve blijft uitsluitend op de reserve-rij**
   (`fonds_stuurinfo_reserve.ondergrens/bovengrens`) — bewuste afwijking van
   de werkopdracht-suggestie (kpi-rijen `soli_band_*`). De reserve-rij is al
   de éne bron voor het tab 1-stoplicht (`leidReserveStatusAf`, 0074); een
   kpi-duplicaat zou precies de dubbele waarheid zijn die het ontwerp
   verbiedt. De beheer-UI voor de grenzen verhuist van de Reserves- naar de
   Solidariteit-sectie (mockup); de balans-payload blijft de grenzen dragen
   (RPC-signatuur ongewijzigd; beide paden schrijven dezelfde rij vanuit
   dezelfde paginastate).
3. **Micro-langleven = één bron met tab 3.** Het resultaat micro-langleven dat
   de reserve voedt leeft als reeks-punt `soli_vulling.micro_langleven`; het
   latere tab 3-ticket (Biometrische rendementen) leest/schrijft ditzelfde
   punt — nooit een tweede losse invoer. Vastgelegd in migratieheader,
   UI-suffix "(± · zie tab 3)" en deze decision.
4. **Eindstand-consistentie is HARD (bevestigd door Merlin).** De soli-save
   loopt via een nieuwe `security invoker`-RPC `stuurinfo_soli_opslaan`
   (T14b-gehard patroon: geen fonds-parameter, typechecks, vaste labels,
   revoke PUBLIC/anon) die drie tabellen atomisch schrijft (4 vullingsbronnen
   + uitdeling-kpi + grenzen-UPDATE op de soli-rij — stand/pct blijven van de
   balans) en weigert als vorige stand + netto − uitdeling ≠ huidige stand
   (`SOLI_EINDSTAND_ONGELIJK`, tolerantie 0.005) of als de soli-reserve-rij
   ontbreekt (`SOLI_RESERVE_ONTBREEKT` → "sla eerst de balans op"). De UI
   blokkeert dezelfde afwijking vooraf (blokkers expliciet); de leeslaag
   signaleert een achteraf ontstane afwijking via een `consistent`-vlag op
   tab 5. Oudste periode: beginstand wordt teruggerekend (geen check mogelijk).
5. **Spreiding-save = batch-upsert, geen RPC.** Vijf kpi-rijen in één
   `upsert()`-statement (atomisch, RLS + T14-audittrigger gelden, samengestelde
   FK borgt de periode); een RPC voegt bij één tabel niets toe — de "waarde"
   van de balans-/soli-RPC is multi-tabel-atomiciteit + cross-tabel-checks.
6. **Seed: de data wint van het prototype.** T13b seedde Horizon soli 68,0
   (Q1) → 78,0 (Q2) en Meridiaan 29,0 → 34,0 — live op tab 1. Het prototype
   (beginstand 74,8 → 78,0, netto +3,2) is daarmee intern inconsistent. De
   vulling is geseed zodat begin + netto − uitdeling exact op de bestaande
   standen sluit (Horizon Q2 netto = 10,0; Meridiaan Q2 = 5,0; micro-langleven
   in Q2 negatief conform de ±-eis). Q1-balans herseeden naar het prototype is
   verworpen (raakt balansevenwicht + goedgekeurde live cijfers). De visuele
   review toetst de opmaak tegen het prototype, niet deze getallen.
7. **FG-maandreeks is seed-only; sjabloon volgt later (bevestigd door
   Merlin).** Handinvoer van de maandreeks is buiten scope (Excel-uploadticket,
   ook voor de tab 4/5-scalars in `SJABLOON_VELDEN`) — één samenhangende
   sjabloonwijziging later i.p.v. twee vlak na elkaar. De reeks beslaat
   **12 maanden eindigend op de peildatum** van de periode — bewuste afwijking
   van de prototype-maandlabels (dec-24…sep-25, 10 punten), die intern
   inconsistent waren met de eigen rapportagedatum Q2 2026.
8. **Per-sectie save-knoppen voor Spreiding en Solidariteit** naast de
   bestaande balans-savebar (die één gecombineerde balans+reserves-publicatie
   blijft). De mockup toonde één globale savebar, maar de secties zijn losse
   publicatiepaden met eigen blokkers (soli vereist een bestaande balans-save;
   spreiding niet) — één knop zou de plakken onnodig aan elkaar koppelen.

## Overwogen alternatieven

- **Band als kpi-rijen (`soli_band_onder/_boven`)** — de letterlijke
  werkopdracht-suggestie; verworpen: duplicaat van de reserve-rij die tab 1
  al voedt (acceptatiecriterium "aantoonbaar dezelfde bron" wijst dezelfde
  kant op).
- **Zachte eindstand-signalering i.p.v. harde weigering** — flexibeler bij
  invoeren in delen, maar het dashboard kan dan tijdelijk twee standen tonen.
  Verworpen (Merlin): hard, conform GEKOPPELDE_STAND_ONGELIJK (0075).
- **Q1-balans herseeden naar de prototype-standen (74,8)** — zou de
  prototype-getallen exact reproduceren, maar raakt het balansevenwicht, alle
  pct-waarden en de goedgekeurde live tab 1. Verworpen.
- **RPC ook voor de spreiding-save** — symmetrisch, maar zonder cross-tabel-
  consistentie voegt hij niets toe; een privileged rol kan kpi-rijen via
  PostgREST toch al schrijven binnen RLS. Verworpen.
- **2025Q4 seeden voor een "echte" Q1-beginstand** — vervuilt de paginabrede
  periodefilter met een verder lege periode. Verworpen; oudste periode rekent
  de beginstand terug.

## Gevolgen

- **RLS/tenant:** geen policywijziging; alle nieuwe rijen vallen onder de
  bestaande T13-policies (lezen eigen fonds; schrijven voorzitter/beheerder +
  WITH CHECK; geen delete). Nieuwe RPC SECURITY INVOKER zonder fonds-parameter.
  DB-suite `supabase/checks/2026_07_17_t15_cross_tenant.sql` (T15a–f) bedraad
  in `cross-tenant-ci.sh`; app-laag `tests/cross-tenant/t15-…test.ts`.
- **Audit:** de T14-capture-triggers dekken alle nieuwe writes automatisch
  (kpi/reeks/reserve — de `tabel`-CHECK volstaat); de t15b-seed logt met
  actor/bron null (systeem/seed, no-op-guard bij herdraaien).
- **Volgorde-risico (geaccepteerd, zichtbaar):** een balans-save ná een
  soli-save kan de eindstand-relatie breken zonder hercheck (de balans-RPC
  kent de vulling niet). Mitigatie: `consistent`-vlag + zichtbaar
  inconsistentie-signaal op tab 5. Hercheck in `stuurinfo_balans_opslaan` =
  bewust vervolgpunt (nieuwe migratie, blast radius).
- **Grenzen-dubbelpad (geaccepteerd MVP-restrisico):** de balans-payload
  draagt de grenzen nog steeds; een stale cross-sessie-balans-save kan een
  via Solidariteit gewijzigde band terugzetten (wél gelogd). Strippen uit de
  balans-payload = validator- + RPC-wijziging, benoemd als vervolgpunt.
- **`invoer_bron` op de datarij = "bron van de laatste schrijfhandeling"**
  (T14-semantiek, geldt ook voor de soli-grenzen-UPDATE): een stand ingevoerd
  via upload kan na een handmatige grenzen-save 'handmatig' op de rij dragen.
  Per-veld-herkomst leeft in het append-only log (T14b logt de volledige rij);
  de rij-kolom is een gemak, niet het auditspoor (audit-review T15, S1).
- **"Vorige periode"-semantiek (audit/code-review, laag):** de RPC pakt de
  recentste eerdere periode mét soli-rij; leeslaag en beheer-UI de directe
  vorige periode. Bij een gat (tussenperiode zonder soli-rij) kunnen die
  verschillen — in de praktijk worden periodes sequentieel gevuld; bewust
  niet gelijkgetrokken (extra query's zonder reëel scenario).
- **Werkhypotheses (compliancegevoelig, valideren met actuaris/ABTN vóór
  echte data):** (a) het collectieve-uitkeringsfase-model zelf — bij "spreiding
  op persoonlijk niveau" stop en herzie (werkopdracht); (b) band 85–115;
  (c) aanpassingsfactor wordt kant-en-klaar aangeleverd; (d) de vulregels
  (welke bronnen de reserve voeden; definities rendement vs.
  overrendementsbijdrage); (e) uitdeelregels = expliciet bestuursbesluit;
  (f) begripskwestie pct-basis: prototype zegt "% van de kapitalen", de data
  draagt `pct_basis='technische_voorziening'` — de UI rendert het label uit
  de data.

## Referenties

- Werkopdracht "Spreiding- én Solidariteit-tab stuurinformatie" (plansessie
  Cowork, 2026-07-16) + `stuurinformatie-prototype.html` (tabs 4/5) +
  `stuurinformatie-beheer-invoer-mockup.html` (secties Spreiding/Solidariteit).
- Migraties: `supabase/migrations/2026_07_17_t15_stuurinfo_spreiding_soli.sql`
  (RPC) + `…_t15b_stuurinfo_spreiding_soli_seed.sql` (+ ROLLBACKs).
- Code: `core/lib/stuurinfo-spreiding.ts`, `stuurinfo-soli.ts` (puur + sanity),
  `stuurinfo-bron.ts` (readers), `stuurinfo-invoer.ts` (validators),
  `stuurinfo-beheer{,-bron}.ts`, `app/(dashboard)/dashboard/{spreiding,solidariteit}/`,
  `app/(dashboard)/beheer/stuurinformatie/_components/{Spreiding,Solidariteit}Invoer.tsx`.
- Eerdere besluiten: 0074 (T13-periodemodel + éne stoplichtdefinitie),
  0075 (T14-invoerlaag, RPC-patroon, geen vier-ogen), 0055 (suppressie n<10),
  0017 (security-invoker-RPC-precedent).
