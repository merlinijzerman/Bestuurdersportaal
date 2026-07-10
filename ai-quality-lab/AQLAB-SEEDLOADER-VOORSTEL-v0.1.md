% AQLAB Seedloader — voorstel v0.1
% Technische seed-/validatiespike · AI Output Quality & Governance Lab
% 10 juli 2026 · VOORSTEL — geen productiewijziging zonder expliciete goedkeuring

# Doel en scope

Een **seedloader** die de gevalideerde golden set (`AQLAB-SEED-STRUCTUUR-v0.2.yaml` + `AQLAB-HORIZON-FIXTURES-v0.2.md`) idempotent in de `aqlab_`-tabellen laadt — **maar pas draait nadat de seeding-gate groen is**. Dit is een ontwerp + referentie-implementatie; er wordt **niets** naar productie of Supabase geschreven zonder expliciete goedkeuring.

Uitgangspunten: geen echte fondsdata (alles synthetisch), reproduceerbaarheid via `fixture_id + versie + content_hash`, en de validatie-gate als harde voorwaarde.

# Inputs

| Bestand | Rol |
| --- | --- |
| `AQLAB-SEED-STRUCTUUR-v0.2.yaml` | fixtures, facts, checks, testcases, consistency, coverage, pre_seed_validation |
| `AQLAB-HORIZON-FIXTURES-v0.2.md` | canonical_text per fixture |
| `AQLAB-FIXTURE-HASHES-v0.1.yaml` | berekende content_hashes (na goedkeuring in te vullen) |

# Doeltabellen (mapping)

| YAML-bron | Doeltabel | Sleutel/idempotentie |
| --- | --- | --- |
| `fixtures[]` (+ hashes + canonical_text) | `aqlab_fixture_documents` | `code`/`fixture_id` + `versie` uniek; upsert op (`code`,`versie`) |
| `testcases[]` | `aqlab_test_cases` | `code` (bv. `BS-01`) uniek per testset; upsert op `code` |
| `testcases[].expected_facts` / outline / spec | `aqlab_test_cases` jsonb-velden (`verplichte_onderdelen`, `blokkadecriteria`, `broncontext_ref`) | ingebed |
| `testcases[].consistency_*` | `aqlab_test_cases.consistency_required`/`consistency_iterations` | ingebed |
| `checks[]` | seedconstante `lib/aqlab/criteria.ts` / check-registry (geen tabel in MVP) | code-seed |
| `consistency.global` / `scoring` | `lib/aqlab/consistency.ts` (config) | code-seed |

Testcases worden onder één provider-golden `aqlab_test_sets`-rij per feature gehangen (3 sets: samenvatting, vraagbeantwoording, besluitvoorbereiding).

# Loader-stappen (volgorde)

1. **Gate-check (hard):** lees `pre_seed_validation` + de vier gate-condities. Als `SEED_ALLOWED = false` → **abort** met reden. Geen enkele write.
2. **Structurele validatie (herhaal):** draai alle 271 checks (punt 1). Bij failure → abort.
3. **Hash-verificatie:** herbereken sha256 over de canonical_text van elke fixture en vergelijk met `AQLAB-FIXTURE-HASHES-v0.1.yaml`. Mismatch → abort (tekst is gewijzigd zonder versiebump).
4. **Dry-run/plan:** genereer een plan (welke rijen upsert/insert), toon diff, **schrijf niets**. Standaardmodus.
5. **Apply (alleen na expliciete `--apply` + goedkeuring):** binnen één transactie, idempotent upsert van fixtures → testsets → testcases. Append-only log naar `aqlab_log`.
6. **Post-seed-verificatie:** tel geseede rijen, verifieer bidirectionele koppelingen en dat elke testcase een resolvebare fixture + facts heeft.

# Idempotentie & herhaalbaarheid

- Upsert op natuurlijke sleutels (`fixture_id`+`versie`, testcase-`code`); tweede run zonder wijziging = no-op.
- Een fixture-tekstwijziging vereist een **nieuwe versie** (hash verandert); de loader maakt dan een nieuwe rij, laat de oude staan (historische runs blijven reproduceerbaar).
- Alles synthetisch; `synthetic = true` wordt door de loader afgedwongen (weiger niet-synthetische fixtures).

# Metrics die de runner (niet de loader) berekent

De loader seedt; de **run-/consistentie-engine** berekent de metrics. Ter voorbereiding legt de seedstructuur de velden vast. Naar aanleiding van de validatiebevindingen (rapport §3–§4):

**Stabiliteit** (bestaand): `gate_stability`, `fact_stability`, `source_stability`, `format_stability`, `score_spread`.
**Correctheid** (aanbevolen toevoeging, punt 4): `gate_pass_rate`, `fact_correctness_rate`, `source_correctness_rate`, `format_pass_rate`.
**Technisch/retrieval** (aanbevolen toevoeging, punt 3): `retrieval_stability` als aparte metric naast `source_stability`.

**Ontwerpregel (aanbevolen):** `release_eligible` alleen als stabiliteit **en** correctheid voldoen; hoge stabiliteit met lage correctheid → `consistent_but_incorrect` = blokkerend. Deze uitbreiding raakt `lib/aqlab/consistency.ts` en het datamodel-aggregaat; **vereist akkoord** (niet in dit voorstel doorgevoerd).

# `[Volgens wetgeving]`-behandeling (punt 5)

De loader markeert checks op `[Volgens wetgeving]`-cases (BS-06, BV-04, SEC-04) als **judge/human**, niet deterministisch. Label-aanwezigheid blijft deterministisch; duiding is judge/mens. Als later een synthetische wetgevingsfixture wordt toegevoegd, kan een deel deterministisch worden — de loader is daarop voorbereid via een `legal_reference_fixture`-veld (leeg in MVP).

# Veiligheids- en governance-waarborgen

- **Geen productiewijziging zonder `--apply` + expliciete goedkeuring;** default is dry-run.
- **Gate-first:** loader weigert te draaien zolang `SEED_ALLOWED = false`.
- **Alleen anon-key + RLS-conform** in het uiteindelijke pad; geen service-role in client (conform `CLAUDE.md`). De seed draait server-side/CLI onder platform-auth.
- **Append-only** logging van elke seed-actie in `aqlab_log`.
- **Synthetisch afgedwongen:** weigert fixtures met `synthetic ≠ true`.

# Referentie-implementatie (schets, niet uitgevoerd)

```python
# aqlab_seed_loader.py — REFERENTIE, draait NIET tegen productie/Supabase.
def main(apply=False):
    cfg   = load_yaml("AQLAB-SEED-STRUCTUUR-v0.2.yaml")
    fx    = parse_fixtures_md("AQLAB-HORIZON-FIXTURES-v0.2.md")
    hashes= load_yaml("AQLAB-FIXTURE-HASHES-v0.1.yaml")

    gate = check_seeding_gate(cfg["pre_seed_validation"])      # 1
    if not gate.allowed: abort(gate.reasons)

    v = run_structural_validation(cfg)                          # 2 (271 checks)
    if v.failures: abort(v.failures)

    verify_hashes(fx, hashes)                                   # 3 (recompute sha256)

    plan = build_plan(cfg, fx, hashes)                          # 4 (fixtures->testsets->testcases)
    print(plan.diff())
    if not apply:
        return  # dry-run: niets geschreven

    with transaction():                                         # 5 (alleen na goedkeuring)
        upsert_fixtures(plan.fixtures)      # aqlab_fixture_documents (synthetic=true afgedwongen)
        upsert_testsets(plan.testsets)      # 3 provider-golden sets
        upsert_testcases(plan.testcases)    # aqlab_test_cases
        append_log("aqlab_log", plan.summary)

    post_seed_verify()                                          # 6
```

# Volgende stappen

1. Sluit de vier gate-poorten (juridisch/AVG, judge-schema's, hashes invullen na tekst-freeze).
2. Beslis over de twee ontwerp-aanbevelingen (correctheidsmetrics §metrics, `retrieval_stability`).
3. Bouw de loader als CLI/spike met dry-run default; review de plan-diff.
4. Pas `--apply` uitsluitend toe na expliciete goedkeuring; verifieer post-seed.
