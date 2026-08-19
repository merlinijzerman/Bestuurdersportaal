# supabase/seeds/

Seeds zijn geen migraties. Ze staan hier zodat `supabase migration up` en
`supabase db diff` ze niet meenemen.

| map | inhoud | wanneer draaien |
|---|---|---|
| `preview/` | omgevingsspecifieke seeds (demo-fondsen, fictieve licenties) | uitsluitend op Preview, met de hand |
| `schema/` | de tien historische seeds, in afwachting van fase 2 — zie de classificatie hieronder | zie per bestand |

**De runner past geen enkele seed toe.** Alle twaalf sorteren vóór het
baseline-cutoff in `scripts/testdb-apply-migrations.sh`; hun inhoud zit al in de
gesquashte Preview-baseline (`supabase/baseline/`). Dat is gemeten, niet
aangenomen: de selectie van de runner is voor en na de mapherindeling
vergeleken en leverde beide keren dezelfde tien post-baseline-migraties op,
zonder seeds. Verplaatsen naar deze map veranderde daar dus niets aan.

---

## Classificatie van de tien in `schema/` (fase 1.2)

Drie categorieën, met per bestand waar het na fase 2 thuishoort.

### A. Referentiedata — hoort in de geaccepteerde baseline

Platformbrede configuratie zonder `fonds_id`, gelijk in elke omgeving, en de
applicatie doet zonder deze rijen niet wat hij hoort te doen.

| Bestand | Waarom |
|---|---|
| `2026_08_08_p4b_signalen_seed.sql` | Rijen in `platform_signaal_config`: welke monitoringsignalen bestaan, met label, eenheid, interval, venster en drempels. Geen `fonds_id`. Zonder deze rijen heeft de monitoringmodule niets te tonen. |
| `2026_08_14_invaar_requirements_seed_v2.sql` | `procedure_requirements` voor template `pf_wtp_invaarbesluit` — de standaard bewijslast bij een wettelijke procedure, gelijk voor elk fonds. De readiness-functie leest deze tabel **live**; ontbreken de rijen, dan is elke procedure ten onrechte "compleet" of ten onrechte leeg. |

### B. Vervangen — archiveren, niet in de baseline

| Bestand | Waarom |
|---|---|
| `2026_08_13_invaar_requirements_seed.sql` | v1, vervangen door de v2 hierboven (idempotent `delete` + `insert` per `template_code`). Alleen de eindtoestand hoort in de baseline; v1 is historie. Dit is de "één beslissing voor twee bestanden" uit §4 van de ontwerpnotitie. |

### C. Omgevingsspecifiek — per omgeving, nooit in een gedeelde baseline

| Bestand | Waarom |
|---|---|
| `2026_07_08_tenant_domains_seed.sql` | Seedt `horizon.bestuurdersportaal.com` → fonds `horizon`. Hosts verschillen per omgeving (preview- versus productiehosts); de ontwerpnotitie rekent previewhosts in `tenant_domains` expliciet tot de **gewenste** omgevingsverschillen. De tabel heeft per omgeving rijen nodig, maar niet dezelfde. Verplaats naar `preview/` en leg de productiehosts apart vast. |

> Let op: dit is een fail-closed pad. Resolveert een host niet, dan valt hij terug
> op `onbekend` en sluit de afdwinging iedereen buiten (besluit 0042). Een lege
> `tenant_domains` in een nieuwe omgeving is dus geen leegte maar een lockout.

### D. Demonstratiedata — blijft seed, gaat nooit naar productie

Zes bestanden, en ze vormen één keten: alles hangt aan het fictieve fonds
*Stichting Meridiaan* uit het eerste bestand, en de latere hangen aan de periodes
die `t13b` aanmaakt. Behandel ze als één geheel en behoud de volgorde.

| # | Bestand | Inhoud |
|---|---|---|
| 1 | `2026_07_09_t8_demo_fonds_seed.sql` | fictief tweede fonds + theming, feature flags, modulemanifest |
| 2 | `2026_07_10_t11_seed_synthetisch.sql` | synthetische, PII-vrije klantbeeld-aggregaten |
| 3 | `2026_07_16_t13b_stuurinfo_balans_seed.sql` | balans + reserves, 2026Q1 en Q2 — **maakt de periodes aan** |
| 4 | `2026_07_17_t15b_stuurinfo_spreiding_soli_seed.sql` | spreiding + solidariteit |
| 5 | `2026_07_18_t16b_stuurinfo_oper_premie_seed.sql` | operationeel + premie |
| 6 | `2026_07_19_t17b_stuurinfo_biometrie_seed.sql` | biometrische rendementen |

De cijfers in 4 t/m 6 zijn bewust exact sluitend gemaakt op de reservestanden uit
3. Eén bestand losknippen of herseeden breekt die consistentie stil — er komt
geen foutmelding, de getallen kloppen alleen niet meer onderling.

---

## Wat fase 2 hiermee doet

- **A** gaat op in `supabase/migrations/<baseline>.sql`; deze twee bestanden
  verhuizen daarna naar `supabase/archief/`.
- **B** verhuist direct naar `supabase/archief/`.
- **C** verhuist naar `preview/`, met een aparte productievastlegging.
- **D** blijft staan, verplaatst naar `preview/demo/`, en wordt nooit onderdeel
  van een baseline.

Onderbouwing: `02 Architectuur/ONTWERPNOTITIE-MIGRATIEPROCES-v2.1.md`, §4 en
open vraag 4.
