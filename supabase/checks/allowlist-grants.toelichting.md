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

Op 21-08-2026 is de allowlist eerst opnieuw tegen **productie** gegenereerd en
daarna geannoteerd met uitsluitend de hieronder beschreven migratieverschillen.
Dat voorkomt dat de preview-baseline (`2026_08_14_preview_public`) ongemerkt als
productiewaarheid wordt behandeld.

### Reproduceerbare telling

De SECDEF-telling telt object-OID's in `pg_proc`, dus niet unieke functienamen.
De `fonds_id`-telling telt alleen gewone en gepartitioneerde tabellen (`r`,`p`),
geen views. Beide queries zijn als `postgres` ongewijzigd op productie en de
verse CI-keten uitgevoerd:

```sql
select count(*)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;

select count(*)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and a.attname = 'fonds_id'
  and a.attnum > 0
  and not a.attisdropped;
```

De standen blijven verschillend, maar de vroegere conclusie "elf
productie-only functies" volgt er niet uit:

| stand | aantal | bron |
|---|---|---|
| pure replay van alleen de migraties | 28 | historische meting bij #78; andere keten |
| **baseline + migraties (wat CI bouwt)** | **42** | opnieuw gemeten 21-08 |
| productie | **39** | opnieuw gemeten 21-08 met dezelfde query |

Voor `fonds_id`-tabellen is de uitkomst 64 in CI en 65 op productie. De review
van de objectlijsten leverde dit op:

- **nul productie-only SECDEF-functies**;
- drie CI-only SECDEF-functies:
  `fn_platform_event_chain_assert_valid()`,
  `fn_platform_event_fork_declaration_immutable()` en
  `fn_platform_event_hash()`;
- zeven gedeelde SECDEF-functies met een andere definitiehash. De drie AQLab-
  functies en `fn_rate_limit_check()` verschillen alleen in commentaar/opmaak.
  De overige drie zijn echte versiedrift: productie heeft de geharde
  `contact_notificatie_status()` en bevriest ook `ai_leeswijzer_tekst`; CI heeft
  bij `maak_profiel()` juist de nieuwere admin-API-provisioning uit 19-08;
- één productie-only tabel: `fonds_licentie`. Schema, constraints, RLS en grants
  zijn gereviewd en komen overeen met de ontbrekende migratie
  `2026_08_15_fonds_licentie.sql` op de herstelbranch.

Regenereren begint altijd met een ongewijzigde productie-observatie in een
tijdelijk bestand; overschrijf de verwachte allowlist niet vóór de objectreview:

```bash
psql "$PROD_DATABASE_URL" -q -f scripts/gen/v3-allowlist-generate.sql \
  > /tmp/allowlist-grants.productie.tsv
diff -u supabase/checks/allowlist-grants.tsv \
  /tmp/allowlist-grants.productie.tsv
```

De ruwe productiemeting van 21-08 bevatte 752 regels. Na uitsluiting van de
operationele `drift_lezer`-policy en toepassing van de al gereviewde
migratie-annotaties bleef tegenover de vorige allowlist exact één wijziging over:
de drie rolregels voor `fonds_licentie`.

## Baseline-besluit

**Baseline = productiestand van 21-08-2026, geannoteerd naar de
migratiewaarheid.** De gate draait tegen de migratie-DB, dus de allowlist volgt
voor beoordeelde, nog niet uitgerolde delta's die stand. Onbekende productie-
objecten worden nooit automatisch geaccepteerd.

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

8. **`storage.iceberg_namespaces` / `storage.iceberg_tables` — verwijderd op 27-08-2026.**
   Deze twee Supabase-Iceberg-catalogustabellen stonden in de allowlist (gemeten
   tegen een omgeving mét de Iceberg-feature), maar ontbreken op **zowel Preview
   als Productie** — gemeten 27-08-2026: `select to_regclass('storage.iceberg_namespaces'),
   to_regclass('storage.iceberg_tables')` → `NULL, NULL` op beide. Ze worden **niet
   via een repo-migratie** aangemaakt; het is een Supabase-platformfeature die deze
   projecten niet hebben. Ze in de allowlist laten staan sloeg de V3-gate op beide
   omgevingen vals-rood ("LEK ontbrekend object"). Daarom uit de allowlist verwijderd.

   **Versie-afhankelijk aanwezig — de gate negeert hun *aanwezigheid*.** Ze ontbreken
   op Productie/Preview, maar de **ephemere CI-Supabase** (nieuwere Supabase-CLI) hééft
   ze wél. Zonder tegenmaatregel zou de gate op de CI-DB vals-rood slaan op "LEK
   onbekend object". Daarom kent de `onbekend object`-check in
   `2026_08_20_v3_grants_volledig.sql` één **smalle, expliciet benoemde** uitzondering:
   `storage.iceberg_namespaces` en `storage.iceberg_tables` worden daar overgeslagen —
   alléén deze twee, alléén in die check. Elk ander storage-object blijft exact
   gecontroleerd; hun grants (als ze aanwezig zijn) blijven RLS-/policy-gated zoals de
   rest van het platform-beheerde `storage`-schema (punt 7). Komt de feature ooit op
   Productie/Preview, dan is dat zichtbaar in de omgeving, niet als een gate-verschil.

9. **#214-a1 schrijfpoort (besluit 0194) — PRODUCTIEFIX.** `procedure_stappen` toont
   `authenticated=SELECT,INSERT,DELETE` — **geen tabel-brede UPDATE** — omdat de drie
   bewaakte kolommen (`status`, `voltooid_op`, `voltooid_door`) aan `authenticated`
   zijn onttrokken en de overige kolommen op **kolomniveau** zijn her-verleend
   (kolomgrants staan niet in `role_table_grants`, dus onzichtbaar voor V3 — bewaakt
   door `2026_08_28_p214a1_schrijfpoort.sql` + de gedragstoets `..._gedrag.sql`).
   `procedure_stappen` toont bovendien `authenticated=SELECT,INSERT` (**geen DELETE** —
   reviewbevinding, symmetrisch met besluiten), en INSERT is afgegrendeld door de
   BEFORE INSERT-trigger `trg_guard_stap_insert` (`fn_guard_stap_insert()`, revoked
   van alle rollen) die `status in (afgerond,heropend)` en `voltooid_*` bij aanmaken
   voor het clientpad weigert — anders was de UPDATE-revoke via een directe INSERT te
   omzeilen. `procedure_besluiten` toont `authenticated=SELECT,INSERT` — **geen UPDATE,
   geen DELETE**: een besluit is een vastgelegd feit, niet vrij muteerbaar of hard
   verwijderbaar door een fondslid. De schrijfpaden lopen via de SECURITY DEFINER-
   RPC's `fn_stap_afronden` / `fn_stap_activeren` / `fn_stap_heropenen`
   (`anon=-`, `authenticated=EXECUTE`, `service_role=-`). Zie `METING-RLS-reikwijdte-214.md`.

## Objecten die NIET in scope zijn

Extensiefuncties (pgvector, pg_trgm) zijn uitgesloten via `pg_depend deptype='e'`
— puur rekenkundig, geen datatoegang. `prosecdef`/`proconfig` (search_path-pinning)
valt buiten V3: dat blijft gate E in `2026_07_31_r1_structurele_gates.sql`.
Storage-policies die uitsluitend een operationele rol buiten `public`, `anon`,
`authenticated` en `service_role` noemen (zoals `drift_lezer`) vallen eveneens
buiten V3; de rol-DDL controleert die policy zelf fail-closed.

## W11 — handelingen_log (besluit 0191, migratie 2026_08_26_w11_handelingen_log.sql)

Nieuwe objecten voor de forensische tenant-handelingslog. De TSV-regels zijn na
het draaien van de migratie in Supabase gemeten met dezelfde cataloguslogica als
`scripts/gen/v3-allowlist-generate.sql`.

- **`handelingen_log`** (tabel): `anon` niets; `authenticated` alleen `SELECT`
  (RLS-policy `handelingen lezen met capability` gate't op `mag_handelingen_lezen`,
  dus deny-by-default per fonds/capability); geen `INSERT` voor `authenticated` —
  schrijven kan uitsluitend via de definer `fn_schrijf_handeling`. `service_role`
  volledig (nodig voor retentiesnoei).
- **`handelingen_lees_grants`** (tabel): deny-by-default — `anon` én
  `authenticated` niets (ook geen SELECT); uitsluitend leesbaar binnen
  `mag_handelingen_lezen()`. `service_role` volledig (grants toekennen via een
  gedocumenteerde SQL-stap door de eigenaar, geen beheer-UI).
- **`fn_schrijf_handeling(...)`**, **`mag_handelingen_lezen(uuid)`**: `anon` niets,
  `authenticated` + `service_role` `EXECUTE`. Beide `SECURITY DEFINER` met vaste
  `search_path`; `fn_schrijf_handeling` leidt fonds/gebruiker uit `auth.uid()` af.
- **`fn_handelingen_snoei()`**: service-role-only (`anon`/`authenticated` niets) —
  retentiesnoei van rijen ouder dan 90 dagen.
- **`fn_handelingen_retentie_guard()`**: trigger-functie, voor iedereen `EXECUTE`
  ingetrokken (draait in de triggercontext, niemand roept hem direct aan).

De lokale Supabase-testketen was op het moment van regenereren niet beschikbaar
(CLI/psql ontbreken en Docker draait niet). De delta is daarom rechtstreeks
tegen de gehoste preview-database gemeten. Daarbij bleek dat de oorspronkelijke
grantlijst `MAINTAIN` op `handelingen_log` via de default-ACL liet staan;
dat is vóór merge expliciet ingetrokken zodat V3's browserrol-invariant ook voor
nieuwe tabellen geldt. De definitieve meting hoort dus `authenticated=SELECT`
te tonen, zonder `MAINTAIN`.

## #183b spoor T — governance_events-ketentriggers/-RPC's (besluit 0192, migraties 2026_08_27_govevent_*.sql)

Nieuwe functies voor de bewijsketen. Regenereer de TSV met
`scripts/gen/v3-allowlist-generate.sql` tegen de Preview-DB ná het toepassen van de
migraties. Alle grants zijn `anon` niets, `authenticated` + `service_role` `EXECUTE`.

**Triggerfuncties (`SECURITY INVOKER`)** — schrijven `governance_events` bij een
mutatie op hun brontabel:
`fn_govevent_fonds()` (BEFORE INSERT, leidt `fonds_id` af — dalende autoriteit, 0192 §2b),
`fn_stemming_ketengebeurtenis()`, `fn_agendapunt_ketengebeurtenis()`,
`fn_inbreng_ketengebeurtenis()`, `fn_vergadering_ketengebeurtenis()`,
`fn_orgprofiel_ketengebeurtenis()`, `fn_stem_ketengebeurtenis()`.

**RPC (`SECURITY INVOKER`)** — `fn_document_status_zetten(uuid, text, text)`: de
statuswissel van handler #2 (besluit B), atomisch met de inzage-regel en de
ketengebeurtenis.

> **Correctie op de rationale.** `EXECUTE` voor `authenticated` is bij een
> *triggerfunctie* **niet vereist om te vuren** — een trigger draait als onderdeel van
> de DML, ongeacht een EXECUTE-grant. De grant staat er voor **consistentie** met de
> bestaande govevent-triggerfunctie `fn_govevent_hash` (die 'm óók heeft) en is
> onschadelijk: een directe aanroep van een AFTER-triggerfunctie faalt (NEW/TG_OP
> ontbreken). `anon` krijgt niets. De `fn_document_status_zetten`-RPC wordt wél direct
> aangeroepen (door de route), dus daar is `authenticated=EXECUTE` functioneel.

De notulen-RPC's (`fn_notulen_segment_bevestig`/`_verwijder`) zijn `create or replace`
van bestaande functies — hun grants blijven ongewijzigd (geen nieuwe TSV-regels). De
fonds/decision-consistentie zit niet in deze functies maar in de composite FK
`governance_events_decision_zelfde_fonds` (0192 §2e).
