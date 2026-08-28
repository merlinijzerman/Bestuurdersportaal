# Handover — #183b spoor M: Preview-validatie (machine-audit)

**Voor:** GPT/Codex-sessie. **Van:** de spoor-M/T-sessie (Claude), 2026-08-27.
**Eén taak:** valideer spoor M op **Preview** zodat de hele #183b-batch bewezen is
en als één PR kan landen. Spoor T is al end-to-end op Preview bewezen; spoor M is
alleen **lokaal** geverifieerd (tsc, scanner `spoor_vereist=0`, capability-sanity
13/13) en zijn DB-migratie is **nooit op een DB gedraaid**.

> Projectconventies zijn identiek aan `HANDOVER-GPT-183B-SPOOR-T-PREVIEW-RUN.md` §1
> (repo in `mvp/`, Supabase-eerst/handmatig, meet tegen `origin` + `git fetch`, geen
> terminal-git/`main`-push). Lees die als je ze niet kent.

## 0. STOP-grenzen (hard)
- **Raak de spoor-T-bestanden niet aan** (de govevent-migraties draaien al op Preview).
- **Niet naar `main`/Productie.** Alleen Preview.
- **SQL niet stilzwijgend patchen** om een gate groen te krijgen — rapporteer letterlijk.

## 1. De artefacten
| Bestand | Wat |
|---|---|
| `supabase/migrations/2026_08_27_platform_pipeline_operate_capability.sql` (+ rollback) | Seed capability `platform.pipeline.operate` in `platform_capabilities`; **CHECK** `chk_pic_geen_machinegezag` op `platform_identity_capabilities` (structureel niet-toekenbaar). |
| `app/api/aqlab/worker/route.ts`, `app/api/internal/{afschrift,ingest,semantische-extractie}-worker/route.ts`, `app/api/platform/monitoring/snapshot/route.ts` | De 5 workers schrijven nu outcome-gescopet `platform_event_log` via `logResultGegarandeerd` (SPEC `audit:"platform-event-log"`). |
| `platform/lib/platform-capabilities.ts` / `.sanity.ts` | Nieuwe capability + `NIET_TOEKENBARE_CAPABILITIES` + invarianten (lokaal 13/13). |

Achtergrond: `decisions/0193-machinegezag-platform-pipeline-operate.md`.

## 2. Uitvoeren
1. `git fetch`; vertak van de actuele `preview`-tip. (De spoor-T-branch/PR is apart —
   deze validatie draait op dezelfde werkkopie maar raakt alleen spoor-M-bestanden.)
2. Plak `2026_08_27_platform_pipeline_operate_capability.sql` in de Preview-Supabase.
   Verwacht: schoon.
3. **Forward→rollback→forward-drill** op deze migratie (productiegelijke DB).

## 3. Verificatie (aantoonbaar)

**A. Structureel + code↔seed.**
- `2026_07_31_r1_structurele_gates.sql` → schoon.
- **DB-test 17 / code↔seed**: de union telt nu **16** capabilities; de seed in
  `platform_capabilities` moet exact meebewegen (na deze migratie). Draai de
  platform-check die code-union tegen de DB-seed toetst → schoon.
- **V3-grants-gate**: de migratie voegt géén nieuwe *grant* toe (alleen een seed-rij +
  een CHECK-constraint), dus normaliter geen nieuwe allowlist-regel. Draai de gate;
  vlagt hij toch iets, rapporteer het letterlijk.

**B. Niet-toekenbaarheid (de securitykern van 0193).**
- Probeer `platform.pipeline.operate` aan een identiteit toe te kennen
  (`insert into platform_identity_capabilities (... capability='platform.pipeline.operate' ...)`)
  → moet **falen** op de CHECK `chk_pic_geen_machinegezag`. Dit is het bewijs dat de
  capability een *soort* is, geen recht. Toon de weigering.

**C. Runtime-observatie — kan pas NA de deploy (§5), niet vanuit de SQL-editor.**
De worker-writes zitten in de ROUTE-code (`logResultGegarandeerd`), niet in een
DB-trigger. Zolang de vijf workerwijzigingen niet op de Preview-**deployment** staan,
kan `snapshot` geen `platform.pipeline.operate`-event schrijven — dat is verwacht, geen
fout. Deze observatie hoort dus ná de gecombineerde PR-naar-`preview` (§5).
- Op de deployed preview: trigger een worker die werk doet en bevestig één
  `platform_event_log`-regel met `capability='platform.pipeline.operate'`,
  `identity_id=null`, `fase='result'`. **`platform/monitoring/snapshot`** is het
  makkelijkst (POST met de `CRON_SECRET`-bearer; schrijft een snapshot en, als er
  rijen zijn, één `monitoring.snapshot.geschreven`-event). Lukt een worker met een
  lege wachtrij, bevestig dan de **outcome-regel**: lege run = **géén** event.
- **Zelfdetectie-invariant (0193 §5):** de worker-`result`-events verschijnen **niet**
  als "gat" in Signaal 14 (die filtert `fase='attempt'`). Bevestig dat de
  monitoring-gatdetector 0 nieuwe gaten telt na de worker-writes.

**D. Drager + typecheck.**
- `bash scripts/cross-tenant-ci.sh` (of minimaal `npm run gates`) → `spoor_vereist`
  blijft **0**, tsc groen, de karakteriserings-gate groen.

## 4. Rapporteren
(1) drill-uitkomst; (2) A/B/C/D met bewijs (query-uitvoer van de `platform_event_log`-
rij + de geweigerde grant); (3) elke SQL-afwijking letterlijk. Rol de testdata terug
(0 achtergebleven).

## 5. Daarna — GECOMBINEERDE PR (spoor M kan NIET als losse PR)

`audit-inventaris.json` is één geregenereerde momentopname van de héle werkkopie:
beide sporen erin. Een spoor-M-only PR zou (a) de drift-check "verse regeneratie"
breken (spoor T's routes afwezig → ander bestand) en (b) `documents/[id]/route.ts`
op klasse ONBEKEND zetten (uit `SPLIT_KLASSE` gehaald omdat de RPC hem dekt — zonder
die routewijziging valt de split-assertie om). De scanner-wijzigingen zitten dus vast
aan spoor T's routes. **Daarom: één gecombineerde feature-branch (spoor M + spoor T).**

Volgorde:
1. Combineer de hele #183b-batch op één branch → PR naar `preview` → Vercel deployt de
   workercode (én spoor T's routewijziging). Meenemen: `allowlist-grants.tsv`
   regenereren (spoor-T-functies) + `.toelichting.md`.
2. **Op de deployed preview**: de runtime-observatie C (worker → `platform_event_log`).
3. Groen → promoveer `preview` → `main`.

Vlag `ENFORCE_AUDIT=on` blijft daarna geblokkeerd door voorwaarde 3 (retentiebaan).
