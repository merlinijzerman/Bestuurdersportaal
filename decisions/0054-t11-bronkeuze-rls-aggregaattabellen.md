# 0054 — T11: stuurinformatie/klantbeeld op tenant-veilige RLS-aggregaattabellen

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** Ontwikkeling (T11-werkopdracht), Merlin (bronkeuze-akkoord)
- **Leidend ontwerp:** beslisnotitie multi-tenant v0.4 §13 + vaststelling 2026-07-08
  (klantbeeld zonder deelnemer-persoonsgegevens → geen DPIA/`restricted`)

## Context

De modules stuurinformatie (`app/(dashboard)/dashboard`) en klantbeeld
(`app/(dashboard)/klantbeeld`) draaiden als **statische demo-constanten** in de
pagina/`lib/klantbeeld-data.ts`: geen fonds-RLS op de cijfers, niet
config-gedreven, geen scheiding tussen twee fondsen. T11 vraagt: beide modules
generiek/config-gedreven per fonds op één codebase, onder fonds-RLS +
server-side rolgate, zónder deelnemer-persoonsgegevens.

De keuze was **waar de aggregaatcijfers leven**:
1. RLS-tabellen in Supabase, geseed met synthetische aggregaatdata per fonds.
2. Code-level per-fonds providers (data in `lib/fondsen/<slug>`), alleen
   selectie/labels via config.

## Besluit

**Optie 1 — tenant-veilige RLS-aggregaattabellen.** Drie nieuwe tabellen,
deny-by-default RLS per `fonds_id` volgens het T8-patroon (lezen = eigen fonds;
schrijven = voorzitter/beheerder + `WITH CHECK`; géén delete-policy):

- `fonds_stuurinfo_kpi` — headline KPI-tegels.
- `fonds_stuurinfo_reeks` — trend/balans/deelnemer-status (long format).
- `fonds_klantbeeld_cohort` — cohort-aggregaten per leeftijd (`aantal` = populatie_n).

**Harde scopegrens (v0.4 §13 / 2026-07-08): geen deelnemer-persoonsgegevens.**
Alle rijen zijn aggregaat/cohort/fonds-niveau; er is bewust géén individu-
identificator (geen `deelnemer_id`/naam/bsn/geboortedatum). Een structuurtest
(`tests/cross-tenant/t11-modules.test.ts`) faalt als zo'n kolom verschijnt.
Komt deelnemer-PII ooit in beeld, dan **herleeft de go/no-go uit v0.4 §13** en is
T11 niet langer dekkend.

**Presentatie/content-differentiatie** (KPI-volgorde, signaleringen,
vergaderingen, werkgever-basisparameters, segmenten) staat in
`fonds_module_manifest.config` (jsonb) — óók tenant-geïsoleerd via de
manifest-RLS. Numerieke FEITEN in de RLS-datatabellen; PRESENTATIE/CONTENT in de
config. De maandreeksen (cohort-projectie, werkgevers/inning) zijn een
deterministische, illustratieve afleiding van de aggregaten (`lib/klantbeeld-data.ts`),
geen individuele deelnemergegevens.

**Databron blijft synthetisch** (Horizon + demo-fonds Meridiaan), met bewust
verschillende waarden. Een ETL naar echte (geaggregeerde) administratiedata valt
buiten T11 (apart ticket indien nodig).

## Overwogen alternatieven

- **Code-level per-fonds providers** — afgewezen: geen echte fonds-RLS op de
  cijfers, waardoor de cross-tenant negatieve test (acceptatiecriterium 5) en de
  "twee fondsen aantoonbaar gescheiden"-eis (criterium 1) kunstmatig/zwak worden.
- **Deelnemer-detailtabellen** — buiten scope en bewust uitgesloten: zou de DPIA/
  `restricted`-controls (veldautorisatie, inzagelogging, masking) doen herleven
  (v0.4 §13).

## Gevolgen

- **Security/tenant:** de cijfers vallen onder fonds-RLS; cross-tenant leesisolatie
  + rolgate + deny-delete zijn bewezen in
  `supabase/checks/2026_07_10_t11_cross_tenant.sql`.
- **Privacy-by-design:** aantoonbaar geen deelnemer-PII (datamodel + structuurtest);
  kleine-populatie-suppressie op de populatie-tellers (zie [[0055-t11-suppressiedrempel-n10]]).
- **Config-gedreven:** twee fondsen verschillen via data (seed) én config, zonder
  fonds-forks; consistent met de T8-config-laag en de `core`/`fondsen`-boundaries.
- **Migratie-eerst:** nieuwe tabellen + seed draaien eerst in Supabase, dán
  code-deploy.
