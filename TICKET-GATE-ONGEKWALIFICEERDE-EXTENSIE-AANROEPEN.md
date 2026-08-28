# Gate-gat — ongekwalificeerde extensie-aanroepen vanuit `public`-functies

| | |
|---|---|
| **Type** | Nieuwe structurele gate (kandidaat) |
| **Prioriteit** | P2 — geen actief lek, wél een klasse latente breuken (2× bevestigd) |
| **Herkomst** | #183b spoor T preview-runs 2026-08-27 — **twee keer**: `fn_govevent_hash` en `fn_doc_meta_log_hash`, beide `42883` |
| **Raakt** | `supabase/checks/2026_07_31_r1_structurele_gates.sql` (naast GATE E) |

## Het patroon

`fn_govevent_hash` riep `digest()` **ongekwalificeerd** aan. Dat werkte jarenlang,
omdat elke aanroeper tot nu toe `extensions` in zijn `search_path` had (de
`authenticated`-rol via PostgREST). Het faalde pas toen een **brontabel-trigger met
een gepinde `search_path`** (`public, pg_temp` — 0182-hardening) de hash-trigger
**geneste** aanriep: die erft de gepinde path, mist `extensions`, en vindt `digest`
niet → `42883: function digest(text, unknown) does not exist`.

Gefixt door te kwalificeren (`extensions.digest`, migratie
`2026_08_27_govevent_hash_extensions_qualify.sql`). Maar dat repareert één functie.

## Waarom dit een klasse is, geen incident

- **GATE E vangt het niet.** Die pint de `search_path` van `SECURITY DEFINER`-functies.
  `fn_govevent_hash` is een gewone **invoker**-triggerfunctie — buiten Gate E's scope.
- **Elke invoker-functie in `public` die een extensie-functie ongekwalificeerd
  aanroept** is een tijdbom: hij werkt tot hij geneste wordt aangeroepen vanuit een
  functie met een gepinde path zonder dat schema. Naarmate meer functies hun path
  pinnen (0182-lijn, terecht), groeit de kans dat zo'n latente aanroep afgaat.
- Het is **niet met een run te betrappen** tenzij precies dat gestapelde pad wordt
  uitgevoerd — zoals hier, pas bij de echte trigger-observatie.

## Voorgestelde gate

Een catalogusgate (postgres-rol, seedloos, naast GATE E) die per functie in
`public` de body inspecteert op **ongekwalificeerde aanroepen van functies die
alleen in `extensions` (of een ander niet-`public`/`pg_catalog` schema) bestaan** —
bv. `digest`, `gen_salt`, `crypt`, `uuid_generate_v4`, en de pgvector-/pgcrypto-set.
Rood als een `public`-functie zo'n naam ongekwalificeerd gebruikt **en** geen
`search_path` heeft die het schema bevat.

Praktische afbakening (te bepalen bij uitvoering):
- Bron: `pg_proc.prosrc` + `pg_proc.proconfig` (de `search_path`-pin, indien aanwezig).
- Whitelist: namen die óók in `pg_catalog` bestaan (bv. `encode`, `now`) zijn altijd
  veilig en vallen buiten scope.
- Begin desnoods smal: alleen de bekende `extensions`-functies (pgcrypto/pgvector/
  uuid-ossp), zodat de gate geen valse alarmen op ingebouwde functies geeft.

## Acceptatiecriteria

- [ ] Gate detecteert een `public`-functie die een `extensions`-only functie
      ongekwalificeerd aanroept zonder passende `search_path` → rood (PROVEN-RED
      met een synthetische functie).
- [ ] Bestaande codebase schoon ná de `fn_govevent_hash`-fix (anders: bevindingen,
      elk apart gekwalificeerd — geen gate-versoepeling).
- [ ] Aangesloten in `scripts/cross-tenant-ci.sh` / de structurele-gate-set (anders
      draait hij niet — de `fondsleden`/`g2-evidence`-les).

## Volledige inventaris (gemeten 2026-08-27)

Functies in `public` met een **ongekwalificeerde** `digest()`:
`fn_govevent_hash` (gefixt), `fn_doc_meta_log_hash` (gefixt — #183b-bereikbaar via de
notulen-RPC), `fn_bron_whitelist_log_hash`, `fn_decision_snapshot`. (`fn_platform_event_hash`
is al gekwalificeerd sinds 2026_08_15.) De laatste twee zijn **niet** bereikbaar vanuit
#183b spoor T (geen van mijn triggers/RPC's schrijft `bron_whitelist_log` of een
decision-snapshot geneste onder een gepinde path), dus ze blijven bewust ongemoeid —
maar ze zijn de volgende die afgaan zodra een pinnend pad ze bereikt. Dit ticket dicht
de klasse; tot dan zijn zij de bekende openstaanders.

## Niet nu (maar de klasse is nu 2× bevestigd)

Dit blokkeert #183b spoor T niet (beide bereikbare functies zijn gefixt). Maar dat het
patroon binnen één traject **twee keer** afging, is het argument om de gate te bouwen
in plaats van door te gaan met per-run patchen. Los ticket, eigen preview-run.
