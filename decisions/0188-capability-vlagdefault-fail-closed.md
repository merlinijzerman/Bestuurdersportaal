# 0188 — `capabilityEnforceVoorOmgeving()` wordt fail-closed per omgeving (fase 2)

- **Status:** Voorgesteld
- **Datum:** 2026-08-24
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Vervolg op:** besluit 0186 · W7 (#153) · EPIC W (#91)

## Context

Besluit 0186 legde vast dat `ENFORCE_CAPABILITY` in W6 een **kale opt-in vlag**
is: alleen `ENFORCE_CAPABILITY=on` zet de capability-poort aan, en er is bewust
géén omgevings-default. De reden was dwingend: met 112 handlers op `"TE_BEPALEN"`
zou een omgevings-default (zoals `tenantEnforceVoorOmgeving()` die kent) de eerste
preview-deploy het hele portaal op 403 zetten.

0186 kondigde óók de flip aan: *"De flip naar fail-closed-per-omgeving hoort in
diezelfde functie thuis, en gebeurt aan het eind van deploy 3, als eigen besluit
op een eigen moment — pas nadat W7 de declaraties heeft ingevuld en `TE_BEPALEN`
is verdwenen."* Dit besluit voert dat uit.

Randvoorwaarden die nu zijn vervuld:
- **Nul `TE_BEPALEN`** — W7 (#154–#160) heeft alle 112 declaraties ingevuld, op
  `main`.
- **Contractueel bewezen** — de continue authz-matrixgate (#157) toetst op elke
  push dat de vlag-aan-toestand exact de verwachte 403-set geeft (28×403, alle op
  routes die de rol al weigeren).
- **Env-flip stabiel waargenomen** — `ENFORCE_CAPABILITY=on` is op preview én
  productie gezet; kernschermen laden per rol met 200, geen onverwachte 403's,
  geen Vercel-warnings/errors. Minimaal één werkdag observatie met echt verkeer
  gaat vooraf aan het mergen van dit besluit.

## Besluit

`capabilityEnforceVoorOmgeving()` krijgt dezelfde vorm als
`tenantEnforceVoorOmgeving()` (besluit 0042): op `production`, `preview` en
`staging` is de poort **altijd** fail-closed — ook zonder env-waarde en zelfs als
`ENFORCE_CAPABILITY` per ongeluk op `off` staat. Buiten die beschermde omgevingen
(lokaal/dev) blijft de opt-in: alleen `ENFORCE_CAPABILITY=on` zet hem daar aan.

## Overwogen alternatieven

- **De env-vlag laten volstaan (status quo na fase 1).** De poort staat aan omdat
  productie de env-waarde draagt. Verworpen als eindstaat: een configuratiefout —
  variabele weghalen, typefout, per ongeluk `off` — schakelt dan stil de
  beveiligingsgrens uit. Dat is precies wat 0042 voor de tenantgrens al afwees.
- **Ook lokaal/dev fail-closed.** Verworpen: dat blokkeert lokale ontwikkeling en
  de CI-karakterisering (`DEPLOY_TARGET=app`, geen beschermde omgeving) zonder
  veiligheidswinst — lokaal is er geen productieverkeer om te beschermen.

## Gevolgen

**Terugdraaien verandert van aard.** In productie is de env-vlag weghalen na dit
besluit **geen uitweg meer** — uitzetten vereist een codewijziging (revert van
deze PR). Dat is de bedoeling (defense in depth: config kan security niet stil
uitzetten), en de reden dat dit besluit pas ná een stabiele fase-1-periode landt.
Het omkeerbare terugvalpad van fase 1 (variabele weg + redeploy) blijft geldig
tot dit besluit is gemerged.

**Preview en staging handhaven voortaan ook zonder de env-vlag.** Beoogd. De
CI-karakterisering draait onder `DEPLOY_TARGET=app` (geen beschermde omgeving) en
blijft dus observe-only in de vlag-uit-pass; de vlag-aan-pass zet
`ENFORCE_CAPABILITY=on` expliciet. Beide blijven werken.

**Voorwaarde: `profielen.rol NOT NULL`.** Onder handhaving krijgt een profiel met
`rol IS NULL` 403 op alles (`reden: "geen-rol"`). De telling is nul op preview én
productie (W7), dus de `NOT NULL`-migratie is triviaal — maar ze hoort vóór of
mét dit besluit te landen zodat de nul-toestand gegarandeerd blijft. Aparte,
kleine PR.

**Code.** `core/lib/capability-enforce.ts` (de functie + `capabilityEnforceAan()`
die nu ook `VERCEL_ENV`/`VERCEL_TARGET_ENV`/`DEPLOY_TARGET` doorgeeft, spiegelend
op `tenant-context.ts`) en `core/lib/capability-enforce.sanity.ts` (de
W6-tegenproef is geïnverteerd naar de fase-2-assertie).

## Referenties

- `core/lib/tenant-enforce.ts::tenantEnforceVoorOmgeving` — de gespiegelde vorm (0042)
- `core/lib/capability-enforce.ts` — deze functie
- Besluiten: [[0042]] (tenant-enforce-vorm), [[0186]] (kale opt-in, flip aangekondigd)
- EPIC W #91 · W7 #153
