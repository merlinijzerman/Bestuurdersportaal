# Runbook — V3 MAINTAIN intrekken op Production-Supabase

**Migratie:** [`supabase/migrations/2026_08_20_v3_maintain_revoke.sql`](../supabase/migrations/2026_08_20_v3_maintain_revoke.sql)
**Aard:** productie-grantwijziging (least-privilege) — **aparte autorisatie vereist**, uitvoering door de eigenaar.
**Aanleiding:** de V3-grantscheck op Productie (27-08-2026) meldt MAINTAIN op de browserrollen: `anon` 93 relaties · `authenticated` 114. Los van W11; W11's eigen tabel is al MAINTAIN-vrij.

---

## 1. Wat en waarom (kort)

De Supabase-default-ACL kent `anon`/`authenticated` **MAINTAIN** toe op elk `public`-object (PG17: VACUUM · ANALYZE · CLUSTER · REINDEX · REFRESH MATVIEW · LOCK TABLE). **Geen datapad**, maar nergens nodig voor een browserrol — dezelfde "kader groeit langs reeds gemaakte fouten"-blinde vlek als C-01/H-18. De C-01-migratie schoof dit expliciet naar V3.

De migratie doet twee dingen; **stap 2 is de belangrijke**:
1. MAINTAIN intrekken op alle bestaande `public`-relaties voor anon + authenticated;
2. de **default-ACL corrigeren** (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres`), zodat toekomstige objecten het niet meer erven. Zonder stap 2 keert de drift terug bij het volgende nieuwe object.

**Scope:** alleen `public`, alleen anon + authenticated. `service_role` behoudt MAINTAIN; `storage` (Supabase-beheerd) blijft ongemoeid.

## 2. Risico en impact

- **Geen outage, geen app-impact.** Browserrollen draaien nooit VACUUM/ANALYZE/REINDEX/LOCK TABLE; dat doet `postgres`/autovacuum. Revoken raakt geen enkel applicatiepad.
- **Self-verifying + transactioneel.** De migratie eindigt met een `do`-blok dat de eindstand telt en een **exception** werpt als anon/authenticated nog MAINTAIN houden → de hele transactie rolt terug, niets verandert. Eindtoestand of niets.
- **Idempotent.** `revoke` van een niet-bestaand recht is een no-op; herhaald draaien is veilig.

## 3. Vooraf

- Uitvoeren in de **SQL Editor van het Production-project**, als rol **`postgres`** (de SQL-Editor-default). Stap 2 (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres`) moet dezelfde grantor `postgres` noemen om de bestaande ACL-entry te raken — draai je als een andere rol, dan mist stap 2 zijn doel.
- Deze wijziging raakt géén code en géén deploy. Ze staat los van de #183a-promotie.

## 4. Stappen

### 4a. Nulmeting (bevestig de startstand)

```sql
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','v','m','p','f')
       and has_table_privilege('anon', c.oid, 'MAINTAIN')) as anon_maintain,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','v','m','p','f')
       and has_table_privilege('authenticated', c.oid, 'MAINTAIN')) as auth_maintain;
```

Verwacht: rond **93 / 114** (jouw meting). > 0 bevestigt dat er iets in te trekken valt.
NB: de migratiekop noemt een oudere baseline (118/120, stand 20-08); dat de actuele stand lager is, is prima — de migratie toetst op **0/0**, grantor-onafhankelijk, niet op een deltagetal.

### 4b. Uitvoeren

Plak de **volledige inhoud** van [`2026_08_20_v3_maintain_revoke.sql`](../supabase/migrations/2026_08_20_v3_maintain_revoke.sql) in de SQL Editor en voer uit.

**Geslaagd** = de transactie commit en de `NOTICE` verschijnt:
> `V3-MAINTAIN OK: anon en authenticated hebben nergens in public nog MAINTAIN.`

**Mislukt** = een `raise exception 'V3-MAINTAIN FAALT: …'`; de transactie rolt terug, de databasestand is ongewijzigd. Onderzoek de melding (bv. een relkind buiten scope) vóór een nieuwe poging — herhaald draaien is veilig.

### 4c. Naverificatie (onafhankelijk)

1. Draai **4a** opnieuw → verwacht **0 / 0**.
2. Draai de volledige V3-grants-gate tegen Productie:
   [`supabase/checks/2026_08_20_v3_grants_volledig.sql`](../supabase/checks/2026_08_20_v3_grants_volledig.sql) → verwacht
   `V3 GRANTS-GATE OK: … incl. MAINTAIN-hygiëne …`.
3. Draai ter afsluiting de R1-structurele gates ([`2026_07_31_r1_structurele_gates.sql`](../supabase/checks/2026_07_31_r1_structurele_gates.sql)) — verwacht A–H schoon, zoals na W11.

## 5. Rollback

**Er is geen rollback-bestand, en dat is bewust.** Een revoke terugdraaien = MAINTAIN her-toekennen aan de browserrollen — precies de bevinding die deze migratie sluit. Alleen als een concreet, gelegitimeerd applicatiepad ooit MAINTAIN op een specifieke relatie zou vereisen (geen enkel pad doet dat vandaag), geef je dat recht **gericht op dat object aan `service_role`**, nooit breed aan anon/authenticated.

## 6. Nazorg

- Actualiseer de V3-baseline-annotatie op Productie (de gate verwacht 0/0 MAINTAIN op de browserrollen).
- Sluit het V3-MAINTAIN-punt (issue #80) met de nulmeting-vóór (93/114) en de nameting-na (0/0) als bewijs.
- Deze stap staat los van #183a; noteer hem als eigen release-/besluitregel, niet onder de #183a-promotie.
