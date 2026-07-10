# AI Output Quality & Governance Lab (AQLab)

Kwaliteits- en verantwoordingslaag over AI-output van het Bestuurdersportaal. Deze map bundelt alle AQLab-artefacten: ontwerp, regressieset (golden set), seed-voorbereiding, validatie en de roadmap. **Status: ontwerp + technische seed-voorbereiding; nog niet geïmplementeerd, nog niet geseed.**

> Positionering: beheersmaatregel binnen verantwoord AI-gebruik (geen prompt-speeltuin). Architectuurkeuze **Optie A** (operationele module in platform-backoffice; fonds krijgt read-only assurance-rapport). Golden set draait op **synthetische** demodata (demofonds *Horizon*) — productbrede assurance; fonds-specifieke assurance is een latere uitbreiding.

## Ontwerpdocumenten

| Bestand | Inhoud | Versie |
| --- | --- | --- |
| `AI-QUALITY-LAB-ARCHITECTUUR.md` | positionering, Optie A, lagen, datastromen, risico's | v0.3 |
| `AI-QUALITY-LAB-FUNCTIONEEL.md` | schermen, scoremodel, assurance-view, release, run-types, consistentie | v0.5 |
| `AI-QUALITY-LAB-TECHNISCH.md` | datamodel, RLS, API, services, spikes, DoD, persist_mode | v0.5 |
| `AI-Quality-Lab-bestuurssamenvatting.docx` | bestuurssamenvatting | v0.3 |

## Regressieset (golden set)

| Bestand | Inhoud |
| --- | --- |
| `AI-QUALITY-LAB-REGRESSIESET-v0.4.md` | leesbare master: 33 testcases (24 functioneel + 9 security/safety), concrete vragen + expected answer outlines, consistentiemeting |
| `AQLAB-HORIZON-FIXTURES-v0.2.md` | 22 fixture-secties / 24 fixture-ID's, synthetische Horizon-documenten + golden facts + traps + hashing/versionering |

## Seed-voorbereiding (technisch)

| Bestand | Inhoud |
| --- | --- |
| `AQLAB-SEED-STRUCTUUR-v0.2.yaml` | **executeerbare** machine-spec: fixtures, facts, checks, testcases (met vraag + outline + fixture-scoped facts), consistency (+scoring), coverage, pre_seed_validation |
| `AQLAB-FIXTURE-HASHES-v0.1.yaml` | berekende sha256-hashes per fixture (nog niet ingevuld in de bron) |
| `AQLAB-SEEDLOADER-VOORSTEL-v0.1.md` | seedloader-ontwerp (dry-run first, `--apply` na goedkeuring) |
| `aqlab_seed_dryrun.py` | draaibare **dry-run CLI-spike** (geen DB, `--apply` uitgeschakeld) |
| `AQLAB-DRYRUN-VOORBEELDOUTPUT.txt` | voorbeeldoutput van de dry-run (verwachte rode gates) |

Dry-run draaien:

```bash
cd ai-quality-lab && python3 aqlab_seed_dryrun.py   # exit 2 zolang gates rood
```

## Validatie & besluiten

| Bestand | Inhoud |
| --- | --- |
| `AQLAB-PRE-SEED-VALIDATIERAPPORT-v0.1.md` | 271/271 structurele checks groen, 24 hashes, seeding-gate (4 open poorten) |
| `AQLAB-ROADMAP.md` | 4 iteraties + werktickets tot een werkende MVP |
| `../decisions/0056-aqlab-consistentie-correctheid-en-stability.md` | ADR: consistentie = stabiliteit én correctheid; source- vs retrieval-stability |

## Seeding-gate (open poorten)

Seeding is geblokkeerd (`SEED_ALLOWED = false`) tot alle vier groen zijn:

1. `content_hash` gevuld (hashes berekend, staan klaar in het manifest).
2. AVG-scope SEC-06 juridisch/FG-bevestigd.
3. Compliance-/juridische duiding BS-06 / BV-04 / SEC-04 gevalideerd.
4. Judge-JSON-schema's gedefinieerd.

## Archief

`archief/` bevat vervangen versies (regressieset v0.1–v0.3, fixtures v0.1, seed v0.1, bestuurssamenvatting v0.2). Niet gebruiken voor implementatie.
