# #434 T4-F → Preview: migratiedraaiboek

> **Status: VOORBEREID, NIET UITGEVOERD.** Dit draaiboek beschrijft wat er moet
> gebeuren. Er is nog geen afzonderlijk Preview-uitvoeringsakkoord, en zonder dat
> akkoord wordt geen enkele stap hieronder uitgevoerd. De merge van PR #437 is
> een tweede, losstaand akkoord.

**Doelomgeving:** uitsluitend Supabase Preview (`portal_preview`).
**Productie blijft buiten dit draaiboek**, evenals Copilot-flags, consent,
billing en live Retrieval-calls.

---

## 0. Doelbevestiging — vóór élke stap opnieuw

De bestandsnamen dragen bewust geen Supabase-CLI-timestamp: handmatig toepassen
in de SQL-editor, niet via `supabase db push` (zie
`scripts/testdb-apply-migrations.sh` voor het waarom).

Controleer vóór iedere actie projectref, actor en Vercel-environment. De
preflight in stap 1 dwingt de doelbevestiging bovendien in SQL af: hij breekt
fail-closed af zodra de Preview-fingerprint ontbreekt of er een productiehost in
`tenant_domains` staat. Die fingerprint is dezelfde als in
`supabase/seeds/preview/2026_09_22_428_app365_preview_provision.sql`.

**Proven-red vastgelegd:** op een wegwerp-DB zónder die fingerprint breekt de
preflight af met `#434 VERKEERDE DOELOMGEVING`. De verkeerde-doeltest is dus
aantoonbaar rood, niet alleen bedoeld.

---

## 1. Preflight (read-only, verandert niets)

| # | Bestand | Wat het doet |
|---:|---|---|
| 1 | `supabase/checks/2026_09_23_434_preview_preflight_readonly.sql` | Bevestigt het doel, toetst de voorwaarden en meldt **welke** van de twee migraties nog moeten worden toegepast. Geen insert, update, delete, DDL of `set role`. |

De preflight meldt per regel `[doel]`, `[stand]`, `[aanwezig]`, `[0119]` en
`[nog doen]`, en werpt bij een halve of omgekeerde stand. Verwachte uitkomst op
Preview vóór uitrol: **beide** migraties staan onder `[nog doen]`.

De regel `[0119]` telt de bestaande `governance_audit_read`-grants en zegt er
expliciet bij dat dit draaiboek dat aantal niet wijzigt. Zie stap 6.

---

## 2. De twee migraties, in deze volgorde

**DB vóór code, voor beide.** De projectiefuncties draaien op het LEESPAD
(`vw_governance_audit`, `lees_governance_audit`); het schrijfpad
`schrijf_ai_interactie()` bewaart `retrieval_meta` ongewijzigd. Deployt de code
eerst, dan schrijft zij `meta.adapters` terwijl de oude projectie die sleutel
stil wegfiltert — geen storing, wel verlies van precies de diagnostiek waar deze
tranche om draait.

| # | Migratie | Wat doet hij | Code | Rollback |
|---:|---|---|---|---|
| 1 | `supabase/migrations/2026_09_22_434_meta_adapters.sql` | Voegt `meta_adapters_projectie(jsonb)` toe (gesloten vormcontrole, werpt bij een ongeldige vorm) en herdefinieert `meta_basisniveau`/`meta_bronniveau` zodat zij `adapters` doorlaten. `meta_projectie()` blijft bytegelijk en wordt niet aangeraakt. | DB vóór code. | `supabase/rollbacks/2026_09_22_434_meta_adapters_ROLLBACK.sql` |
| 2 | `supabase/migrations/2026_09_23_434_adapterstand_fonds.sql` | Voegt `fn_adapterstand_fonds(integer)` toe: het leespad van de beheerstand, onder het auditbeleid van besluit 0119 (zie 0214). | DB vóór code. | `supabase/rollbacks/2026_09_23_434_adapterstand_fonds_ROLLBACK.sql` |

**De volgorde is dwingend:** migratie 2 roept `meta_adapters_projectie()` aan.
De preflight in stap 1 en 4 meldt een omgekeerde stand expliciet als
`VOLGORDEFOUT`.

---

## 3. Controles ná toepassing

De gedragssuites schrijven binnen een transactie die terugrolt en gebruiken een
psql-metacommando (`\set`). Dat is prima voor CI en een wegwerp-DB, maar
**ongeschikt voor de Preview SQL-editor** — zelfde afweging als bij #423.

| Na stap | Controle | Waar |
|---|---|---|
| Migratie 1 | `supabase/checks/2026_09_22_434_meta_adapters.sql` | CI / wegwerp-DB |
| Migratie 2 | `supabase/checks/2026_09_23_434_adapterstand_fonds.sql` | CI / wegwerp-DB |
| Beide | `supabase/checks/2026_09_23_434_preview_preflight_readonly.sql` | **Preview SQL-editor** |

Op Preview is de preflight dus zowel de voor- als de nacontrole: ná toepassing
hoort hij `[nog doen] niets` te melden en groen af te sluiten.

---

## 4. Herstelpad

Beide rollbacks zijn los uitvoerbaar en in omgekeerde volgorde:

1. `2026_09_23_434_adapterstand_fonds_ROLLBACK.sql` — dropt
   `fn_adapterstand_fonds`. De beheerstand valt daarna terug op het
   RLS-beperkte tabelpad en **labelt zichzelf `eigen_beurten`**; zij claimt dus
   niet alsnog fondsbreed te zijn. Het leesrecht op `governance_log` verandert
   hierdoor niet.
2. `2026_09_22_434_meta_adapters_ROLLBACK.sql` — zet de wrappers terug naar hun
   #368-vorm en dropt `meta_adapters_projectie`. Daarna valt `adapters` weer
   stil uit de leesprojectie.

**Risico dat expliciet benoemd hoort te worden:** na migratie 1 WERPT de
projectie op een ongeldige `adapters`-vorm in plaats van de sleutel stil weg te
laten. Dat is de bewuste keuze van deze tranche (zie besluit 0214 en de kop van
de migratie), maar het betekent dat één kapotte auditregel de governance-lezing
voor die resultaatset laat falen. De TypeScript-validator is fail-closed vóór het
wegschrijven en historische rijen kunnen de sleutel niet dragen, dus dit kan
alleen ontstaan door een schrijfpad buiten de applicatie om. Gebeurt dat toch,
dan is rollback 2 het onmiddellijke herstel.

---

## 5. Codedeploy

Pas ná stap 2–4 groen. De code werkt ook zónder migratie 2 — dan valt het
leespad terug en toont de pagina eerlijk "alleen uw eigen beurten" — maar dat is
een vangnet voor volgordefouten, geen beoogde eindtoestand.

---

## 6. Wat dit draaiboek NIET doet

- **Geen `governance_audit_read` toekennen.** Niet aan wie dan ook, en zeker niet
  om de fondsbrede pagina gevuld te krijgen. Zonder grant hoort de pagina
  "alleen uw eigen beurten" te tonen; dat is het beoogde eindgedrag (besluit
  0119, bevestigd in 0214) en geen tijdelijke toestand.
- **Geen Productie.** Geen enkele stap hierboven raakt Productie.
- **Geen Copilot-activering**, geen tokenbron, geen consent-, billing-,
  permission- of featureflagwijziging, en geen live Retrieval-call. De
  exacte-canarymeting met `Zandloperbaken 12` blijft een afzonderlijke
  activeringsvoorwaarde en hoort niet bij T4-F.
- **Geen #433.** Die statuscorrectie blijft buiten PR #437 en buiten dit
  draaiboek.

---

## 7. Akkoordmomenten

1. **Vóór toepassing op Preview** — afzonderlijk akkoord vereist. Dit draaiboek
   is de voorbereiding, niet de toestemming.
2. **Vóór merge van PR #437** — opnieuw een afzonderlijk akkoord, ná bevestiging
   van onveranderde head, groene checks en scope.
