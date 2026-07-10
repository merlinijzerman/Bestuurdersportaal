# 0058 — AQLab-fundament: RLS-model (platform-precedent) en testset-structuur

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** Merlin (akkoord 2026-07-10, plansessie AQL-1)
- **Leidend ontwerp:** `ai-quality-lab/AI-QUALITY-LAB-TECHNISCH.md` §1–§3, werkticket `AQLAB-WERKTICKET-AQL-1-fundament-en-seed-v1.0.md`, `AQLAB-SEEDLOADER-VOORSTEL-v0.1.md`. Raakvlak: [[project_bestuurdersportaal]], ADR 0051 (append-only log), ADR 0056 (consistentie).

## Context

Werkticket AQL-1 legt het `aqlab_`-datamodel + de gate-bewaakte seedloader neer. Twee ontwerpkeuzes bleken bij verificatie tegen de echte code (CLAUDE.md-hiërarchie: code wint) af te wijken van het technisch ontwerp en zijn expliciet bevestigd vóór de bouw.

## Besluit

**1. Autorisatie/RLS volgt het platform-precedent, niet de capability-policy-tekst.** Het technisch ontwerp §3 beschrijft RLS-policies "die uitsluitend platform-capabilities toelaten" (`aqlab:beheer` e.d.). In de werkelijke codebase (`2026_06_23_platform_fundament.sql`, `lib/platform-wrapper.ts`) worden platform-capabilities **niet** in RLS-predicaten gecheckt — er bestaat geen SQL-capabilityhelper. Platform-eigen tabellen draaien **deny-by-default RLS + server-side service-role achter de capability+audit-wrapper**. AQLab is Optie A (platform-backoffice) en volgt dit patroon: RLS staat **aan** op alle 15 `aqlab_`-tabellen met **bewust geen permissive policies**; toegang loopt server-side via de service-role-wrapper. De service-role blijft **uitsluitend server-side** (CLI/wrapper), nooit in client-code — conform CLAUDE.md.

**2. Testset-structuur: 3 features, 4 testsets.** De 33 golden testcases dragen 12 `feature`-strings: 3 productfeatures (`bestuurlijke_samenvatting`, `brongebonden_vraagbeantwoording`, `besluitvoorbereiding`, elk 8 cases) + 9 SEC-cases met elk een eigen feature-string. Er worden **3 `aqlab_ai_features`** geregistreerd (de productfeatures) en **4 `aqlab_test_sets`**: drie per feature + één `security_safety`-set (`soort = security_blocking`, `feature_id = null`). Dit volgt de referentieloader en borgt de DoD-eis "security-set apart draaibaar". Dit wijkt bewust af van de letterlijke "3 testsets"-formulering in het ticket/§13.

**3. Loader in TypeScript.** De referentie `aqlab_seed_dryrun.py` is Python; de loader is herbouwd als `tsx`-CLI (`lib/aqlab/seed/*`) passend bij de repo-tooling (`sanity`/cross-tenant), met `js-yaml` als devDependency. Gate-first, dry-run default; `--apply` weigert zolang `SEED_ALLOWED = false`.

## Overwogen alternatieven

- **Capability-checks in RLS-predicaten** (ontwerp letterlijk volgen) — verworpen: vereist een niet-bestaande SQL-helper en wijkt af van elk platform-patroon; foutgevoelig en niet getest.
- **3 testsets, SEC-cases verdeeld over de featuresets** — verworpen: dan is de security/safety-set geen afzonderlijk draaibare set (DoD-eis) en vermengt security-gedrag met featurekwaliteit.
- **Loader in Python houden** — verworpen: past niet bij de TS-only CI/sanity-cultuur; extra runtime.

## Gevolgen

- **Datamodel:** geen `fonds_id` op `aqlab_`-tabellen (provider-globaal MVP); `WITH CHECK` n.v.t. maar gedocumenteerd gereserveerd voor latere fonds-scoped paden. De T3-dekkingsgate blijft groen (geen write-policy zonder `WITH CHECK`).
- **Security:** deny-by-default is aantoonbaar via `supabase/checks/2026_07_10_aqlab_cross_tenant.sql` (tenant-sessie ziet 0 rijen, tenant-write geweigerd).
- **Ontwerp-sync:** technisch §3 (RLS-matrix) moet worden bijgewerkt naar het platform-precedent; §1.2/§13 "3 testsets"/"12 criteria" bijwerken naar 4 testsets / 14 checks. Gemeld voor de ontwerp-sync-check.
- **Seeden geblokkeerd:** de vier seeding-gate-poorten (content_hash, AVG SEC-06, juridische duiding BS-06/BV-04/SEC-04, judge-schema's) staan open; `--apply` blijft geweigerd tot ze sluiten.

## Referenties

- `ai-quality-lab/AQLAB-PRE-SEED-VALIDATIERAPPORT-v0.1.md` §6 (gate).
- `supabase/migrations/2026_07_10_aqlab_{1,2,3}_*.sql`; `lib/aqlab/`.
- `decisions/0051-t8-config-audit-eigen-logtabel.md` (append-only-patroon), `decisions/0056-*` (consistentie).
