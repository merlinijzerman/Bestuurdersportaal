# allowlist-grants.tsv — toelichting en afwijkingen

Machine-leesbare bron van waarheid voor de **V3-grants-gate**
(`2026_08_20_v3_grants_volledig.sql`). Eén regel per `(object, rol)`; kolommen:
`sectie ⇥ schema ⇥ object ⇥ klasse ⇥ rol ⇥ rechten`. `rechten='-'` betekent geen
recht. De verzameling distinct objecten ís het objectregister (drijft de regel
"onbekend object").

## ROL — waarmee genereren en toetsen

**`postgres`, en met dezelfde rol in beide.** De gate vraagt met
`has_table_privilege(<rol>, …)` *naar* de rechten van `anon`, `authenticated` en
`service_role`; hij meet dus niet ALS die rollen maar OVER hen, en daarvoor is de
volledige catalogus nodig. Genereer je als `postgres` en toets je later als een
beperkte rol, dan mist de gate structureel wat de allowlist wél bevat — en dat
verschil is stil. Zie de `-- ROL:`-regel bovenin de suite, bewaakt door `ROL-1`.

## Herkomst en regenereren

> ⚠️ **DEZE ALLOWLIST IS NOG NIET GELDIG ALS BASIS VOOR DE GATE.**
> Zij is gegenereerd uit wat "de schone migratiestand" heet, en dat is iets
> anders dan het klinkt.

Gegenereerd uit de **schone migratiestand** (baseline `2026_08_14_preview_public`
+ alle post-cutoff-migraties, inclusief de C-01-cleanup en de V3-MAINTAIN-revoke).

**Het probleem: die baseline is een dump van PREVIEW, geen model uit de
migraties.** `supabase/baseline/2026_08_14_preview_public.sql` is op 14-08-2026
als schema-only dump uit het Preview-project getrokken en bevat zelf 32
`SECURITY DEFINER`-vermeldingen. Wat de testketen opbouwt is dus
*Preview-van-14-08 + latere migraties* — niet wat de repo beschrijft, en niet
productie. Genereer je de allowlist daaruit, dan codificeer je de
ongedocumenteerde objecten van Preview als de verwachte toestand.

Drie standen, alle drie gemeten en alle drie verschillend
(`SECURITY DEFINER`-functies in `public`):

| stand | aantal | bron |
|---|---|---|
| pure replay van alleen de migraties | 28 | Bevinding A bij #78, 20-08 |
| **baseline + migraties (wat CI bouwt)** | **42** | gemeten 21-08 op een verse stack |
| productie | 39 | Bevinding A bij #78, 20-08 |

Ook `fonds_id`-tabellen lopen uiteen: 63 (pure replay) / 64 (baseline+migraties)
/ 65 (productie).

**Voor het regenereren geldt daarom:**

1. genereer tegen **productie**, niet tegen de testketen — anders is de gate een
   toets op een model in plaats van op de werkelijkheid;
2. doe dat pas **ná** de inventarisatie van de definer-functies die alleen in
   productie bestaan (Bevinding A). Zonder die inventarisatie verklaar je
   ongereviewde objecten tot verwachte toestand — precies wat de gate zou moeten
   vinden;
3. de getallen van Bevinding A zijn van 20-08 en zijn met een eenvoudige telling
   op de huidige keten **niet reproduceerbaar** (28 versus de 42 hierboven). Doe
   de telling opnieuw en leg de méthode vast, zodat "elf productie-only functies"
   een meting is en geen overlevering.
Dat is exact de stand waartegen de gate in CI draait (ephemere Supabase-DB in
`scripts/cross-tenant-ci.sh`). Regenereren na een bewuste grant-/objectwijziging:

```bash
# tegen de schone migratie-DB (supabase start + testdb-apply-migrations.sh):
psql "$TEST_DATABASE_URL" -q -f scripts/gen/v3-allowlist-generate.sql \
  > supabase/checks/allowlist-grants.tsv
```

## Baseline-besluit

**Baseline = productie-stand, geannoteerd naar de migratiewaarheid** (besluit V3,
27-08-… zie issue). De preview↔productie-vergelijking (drift-bewijs bij het issue)
gaf één feature-cluster verschil; die annotaties staan hieronder. De gate draait
tegen de migratie-DB, dus de allowlist volgt die stand; de nog-niet-uitgerolde
delta is een deploy-actiepunt op productie, geen gate-afwijking.

## Afwijkingen van "de saaie standaard" — met reden

De saaie standaard voor een tenant-tabel is: `anon=SELECT` (of `-`),
`authenticated=SELECT,INSERT,UPDATE,DELETE`, `service_role=` alle rechten incl.
MAINTAIN. Afwijkingen die bewust in de allowlist staan:

1. **MAINTAIN-hygiëne (V3-remediatie).** `anon` en `authenticated` hebben nergens
   in `public` MAINTAIN — dat is door `2026_08_20_v3_maintain_revoke.sql`
   ingetrokken (Supabase-default-ACL kende het breed toe: anon op 118/123,
   authenticated op 120). `service_role` behoudt MAINTAIN, net als bij gate F de
   vertrouwde backend-rol.

2. **Platform-event-chain (in migratie, nog niet in productie).** De vier objecten
   `platform_event_chain_state`, `platform_event_fork_declarations`,
   `fn_platform_event_chain_assert_valid(...)`,
   `fn_platform_event_fork_declaration_immutable(...)` staan in de allowlist met
   **geen enkel grant** voor alle drie rollen (deny-by-default append-only
   platformregisters). Ze bestaan in preview/migraties maar nog niet in productie
   → **deploy-actiepunt productie**.

3. **`fn_platform_event_hash()` gehard (geen grants).** In productie draagt deze
   trigger-functie nog `authenticated`/`service_role` EXECUTE (on-gehardende
   default); de allowlist legt de gehardende migratiestand vast (geen grants) →
   **deploy-actiepunt productie** (grant strippen).

4. **C-01-views.** `vw_fondsleden`, `vw_dossier_status`: `authenticated=SELECT`,
   `anon=-`. `vw_governance_audit`: beide `-` (alleen via de definer-RPC).
   `service_role` volledig. De gate bewaakt dit dubbel: als grant-vergelijking én
   als expliciete C-01-regel (geabsorbeerd uit V10).

5. **Deny-by-default tabellen** (`platform_signaal_config`, `rate_limit_events`,
   `fonds_licentie`, `governance_audit_grants`, e.d.): `anon=-`, `authenticated=-`,
   `service_role=` subset of alle rechten. Bewuste keuze; niet elk service_role-
   recht is volledig (bv. `ai_config_versie`=`SELECT,UPDATE`,
   `ai_heractivering_besluit`=`SELECT,INSERT`).

6. **Read-only-generiek** (`concepts`, `comparison_run`, `extraction_run`,
   `semantic_units`, `governance_log_inhoud`, …): `anon=-`, `authenticated=SELECT`,
   `service_role` volledig. Global-by-design codelijsten/afgeleide content.

7. **`storage`-schema is Supabase-beheerd — bewust geaccepteerd.**
   `storage.objects`, `storage.buckets`, `storage.buckets_analytics` kennen
   `anon` én `authenticated` **alle** tabelrechten toe (incl. TRUNCATE), en ~20
   `storage.*`-functies zijn anon-EXECUTE. Dit is de Supabase-platformdefault, RLS-
   /policy-gated (zie de `STGPOL`-regels). Ze staan in de allowlist zodat de gate
   niet vals-rood slaat bij elke platform-upgrade; **wijzigt Supabase deze stand,
   dan is dat zichtbaar als een gate-verschil** — precies de bedoeling. Een
   striktere afscherming van het storage-schema is een apart, later besluit.

## Objecten die NIET in scope zijn

Extensiefuncties (pgvector, pg_trgm) zijn uitgesloten via `pg_depend deptype='e'`
— puur rekenkundig, geen datatoegang. `prosecdef`/`proconfig` (search_path-pinning)
valt buiten V3: dat blijft gate E in `2026_07_31_r1_structurele_gates.sql`.
