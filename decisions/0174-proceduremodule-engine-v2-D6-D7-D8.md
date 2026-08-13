# 0174 — Proceduremodule-engine v2: parallelle activatie (D6), aanpasbare vereisten (D7), fasebeschrijving als data (D8)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-13
- **Betrokkenen:** Merlin (product/architectuur), Claude Code (uitvoering)
- **Bron:** `PROCEDURE-ENGINE-V2-ONTWERP.md` (leidend), `03 Functioneel ontwerp/Procesontwerp-invaarprocedure-SPH-v0.1.md`; sluit aan op [`0002`](./0002-generieke-proceduremodule-definitie-als-data.md) (definitie als data), [`0001`](./0001-append-only-audit-geen-harddelete.md)/0024 (append-only), [`0049`](./0049-go-no-go-gate.md) (go/no-go-gate).

## Context

De invaarprocedure (Wtp, SPH) is complex, iteratief en niet-synchroon: meerdere stappen lopen parallel, toezichtvragen heropenen eerdere stappen, en tijdens de rit ontstaan nieuwe bewijslast-eisen. De bestaande engine nam **sequentieel** aan (auto-activeer de volgende stap), legde vereisten **vast** in de template, en kende fasen alleen als lichtgewicht tag. Dit werkdeel (WO-1) bouwt de canonieke invaardefinitie én maakt de engine parallel-by-default, met aanpasbare vereisten en per-fonds fasebeschrijving.

Bij codeverificatie bleek het leidende ontwerp op drie punten vóór te lopen op de werkelijkheid; die zijn hieronder als gedwongen aanpassingen vastgelegd.

## Besluit

**D6 — Afhankelijkheidsgestuurde, parallelle activatie.**
- Nieuw stap-statusmodel `geblokkeerd/actief/afgerond/heropend` als **superset** van de bestaande CHECK (legacy `open` blijft geldig; lopende procedures veranderen niet van gedrag — snapshot-integriteit).
- `blokkerende_afhankelijkheden int[]` op `procedure_stappen` (leeg = geen gate). Eén pure, idempotente functie `herberekenActiveerbaarheid()` vervangt "activeer de volgende op volgorde". Bij start worden **alle** dep-loze stappen tegelijk `actief`.
- **Heropenen** van een afgeronde stap (voorzitter/beheerder, verplichte motivering, append-only `governance_event`); afhankelijke afgeronde stappen worden **niet** teruggezet maar gemarkeerd `herbevestiging_nodig` (geen cascade-churn — OB-E1).
- De invaardefinitie declareert **bewust geen** afhankelijkheden: alle 12 stappen zijn vanaf de start activeerbaar; de besluitdiscipline ligt bij de readiness-ladder en de go/no-go-gate ([`0049`](./0049-go-no-go-gate.md)).

**D7 — Aanpasbare checklist en bewijslast.**
- Instantie-scoped `procedure_requirement_instance` (eigen `fonds_id` → fonds-RLS + WITH CHECK; schrijven voorzitter/beheerder). `procedure_requirements` blijft de **template**-bron.
- Herkomst (`bron`) + soft-deactivate (`actief`) op `procedure_checklist` en op de instantie-requirements (append-only; deactiveren i.p.v. verwijderen).
- **Readiness-unie**: `fn_decision_readiness_check` én `buildEvidenceLijst` lezen de **UNION** van template-requirements en **actieve** instantie-requirements. Template- en instantie-rijen zijn disjunct → `union all` zonder dedup; geen dubbeltelling.
- Een **blokkerende** vereiste deactiveren kan alleen **met motivering** (REQ-006), nooit stil. Elke mutatie schrijft precies één `governance_event`.
- De twee types `external_submission` en `consultation` (proceduremodule v0.2) zijn aan de DB-enum toegevoegd en worden via de `document`-logica in readiness/evidence afgehandeld; targetmapping: `consultation` telt vanaf besluitrijp, `external_submission`+`consultation` vanaf verantwoordingsrijp. (Nodig omdat een handmatig toegevoegde `consultation` anders wél in beeld maar niet in functie is — het D7-doel.)

**D8 — Fasebeschrijving als data, per fonds overschrijfbaar.**
- Globale `procedure_template_fasen` (gedeelde `generieke_beschrijving` per `template_code`) + fonds-gescopete `procedure_fase_beschrijving_override`. Leeslogica fail-safe: `coalesce(override[fonds,fase], generieke default)`. `fase_code` op stappen.

**Canonieke definitie.**
- `definities/pensioenfondsen/pf_wtp_invaarbesluit@2.0.0.json` als bron; een lichte, eigen validator (schema + DAG + fase-refs) draait onder `npm run sanity` — **geen zod** (repo-ethos "geen extra runtime-dep"; het doel is een gevalideerde definitie, zod is slechts een middel). De requirements-seed wordt **deterministisch uit de JSON gegenereerd** met een drift-sanity die borgt dat DB-seed en definitie niet uiteenlopen.

### Gedwongen aanpassingen t.o.v. het leidende ontwerp (codeverificatie)
- **B1 — Geen template-tabellen.** `procedure_templates`/`procedure_template_stappen` bestaan niet; templates leven als code/JSON, requirements zijn op `template_code` gesleuteld. Daarom: geen `alter procedure_template_stappen`; D8-tabellen op **`template_code`** (niet `template_id`); `blokkerende_afhankelijkheden`/`fase_code` leven in de definitie en worden bij start meegesnapshot op `procedure_stappen`.
- **B2 — `voltooid_op` hergebruikt** i.p.v. een nieuwe `afgerond_op` (kolom bestond al).
- **B3 — Requirements zijn niet geversioneerd/gesnapshot**; readiness leest live per `template_code`. v2.0.0 wordt onder dat code geseed (er is geen live v1.0.0 om te beschermen). Snapshot-integriteit geldt voor stappen/checklist (wél gesnapshot), niet voor requirements — bestaande engine-eigenschap.
- **B4 — Geen zod** (zie boven).

## Alternatieven

- **Harde terugzetting van afhankelijke stappen bij heropenen** (cascade) — afgewezen: cascade-churn + audit-ruis; `herbevestiging_nodig` is het niet-blokkerende alternatief (OB-E1).
- **`decision_id`-kolom op een gesnapshotte requirements-tabel** i.p.v. aparte instantietabel — afgewezen: `procedure_requirements` blijft bewust de template-bron (OB-E2).
- **Universele I–VI-fasenlijst** — afgewezen: fasen verschillen per procedure; daarom per template (OB-E3).
- **Gedeelde invaardefinitie i.p.v. SPH-variant** — afgewezen: afwijkende opdrachtgever (beroepspensioenvereniging) + FPR (OB-E4). De engine-uitbreidingen zijn wél generiek.
- **Zod toevoegen** — afgewezen conform repo-ethos; lichte eigen validator gekozen.

## Gevolgen

- Nieuwe tabellen (`procedure_requirement_instance`, `procedure_template_fasen`, `procedure_fase_beschrijving_override`) + kolommen op `procedure_stappen`/`procedure_checklist`; RLS/policies + governance-events. De structurele gates (A–H) moeten schoon draaien; `procedure_template_fasen` is in de A1-globaal-lijst geregistreerd; `fn_decision_readiness_check` herstelt na `create or replace` zijn grants (Gate H, les OP-C5/C13).
- **Parallel-by-default is de expliciete inversie** t.o.v. proceduremodule-ontwerp v0.2 (dat sequentieel was); dit moet via `ontwerp-sync-reviewer` terug in v0.2 (revisielog).
- UI-consumptie (meerdere actieve stappen, fasebeschrijving, toevoeg-affordances, `herbevestiging_nodig`-signaal) is **WO-2** — leunt op dit datamodel.
- Compliance-punten O1–O5 en ontwerp-punten OB-E1..E4 zijn belegd in `00 Overzicht en status/openstaande-punten-en-risicos.md` mét eigenaar.
