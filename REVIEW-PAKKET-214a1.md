# #214-a1 — beoordeelbaar pakket (schrijfpoort op procedure_stappen/besluiten)

**Branch:** `fix/214a1-schrijfpoort-main`; via PR #225 gemerged in `preview` als `54d0052`. **Besluit:** [`0194`](decisions/0194-214a-schrijfpoort-en-p4-statusbesluiten.md). **Meting:** [`METING-RLS-reikwijdte-214.md`](METING-RLS-reikwijdte-214.md).
**Aard:** productiefix, standalone van EPIC P. **#210:** één gedragsverandering — niet bundelen.
**Release-status 29-08-2026:** volledig toegepast en functioneel geverifieerd op Preview; Productie is nog niet vrijgegeven of gewijzigd.

## 1. Wat het dicht

`procedure_stappen` en `procedure_besluiten` zijn `for all`-fonds-only met tabel-brede `authenticated`-rechten en geen trigger. Vandaag op productie kan **elk fondslid** met één directe PostgREST-call:
- een stap op `afgerond` zetten met een vervalste `voltooid_door` (UPDATE **of** INSERT), en
- een besluit hard verwijderen (DELETE).

Dat is een verantwoordingsfeit dat iedereen kan vervalsen. a1 sluit dat: de bewaakte kolommen worden aan `authenticated` onttrokken en de legitieme schrijfpaden lopen via SECURITY DEFINER-RPC's die als owner draaien, `voltooid_door = auth.uid()` server-zetten, en de status-machine + fondsgrens afdwingen.

## 2. Bestaande paden die de bewaakte kolommen als `authenticated` schrijven — en hun bestemming

Getraceerd tot de client-constructor (`createServerSupabase()` = anon-key + JWT = `authenticated`; alle routes gebruiken `ctx.supabase`).

| Pad (file:line) | Schrijft | Bestemming in a1 |
|---|---|---|
| `app/api/procedures/[id]/stappen/[stapId]/route.ts:91` (normale afronding) | `status='afgerond', voltooid_op, voltooid_door` | → RPC `fn_stap_afronden` |
| `…/route.ts:135` (handmatig activeren) | `status='actief'` | → RPC `fn_stap_activeren` |
| `…/stappen/[stapId]/heropenen/route.ts:61` + `:120` (compensatie) | `status='heropend'/'afgerond'`, `heropend_op` | → RPC `fn_stap_heropenen` (atomair) |
| `core/lib/procedure-activatie-cascade.ts:95` + `:113` (D6 + legacy cascade) | `status='actief'` | → RPC `fn_stap_activeren` |
| `app/api/procedures/route.ts:144` (aanmaak) | `status` (open/geblokkeerd/actief), nooit `voltooid_*` | blijft INSERT; afgegrendeld door de INSERT-poort (zie 3) |
| `procedure_besluiten` | **geen** `authenticated` UPDATE/DELETE-pad bestaat (alleen INSERT + reads) | UPDATE+DELETE ingetrokken, niets omgelegd |

Owner/`service_role`-paden (migraties, seeds) blijven ongemoeid.

## 3. Wat er in de migraties zit (4 migraties + 4 rollbacks)

- **`p214a1_01_stap_schrijf_rpcs.sql`** — drie SECURITY DEFINER-RPC's `fn_stap_afronden` / `fn_stap_activeren` / `fn_stap_heropenen` (`revoke all … from public, anon, service_role; grant execute … to authenticated`). `voltooid_door` server-gezet; fondsgrens uit `auth.uid()`, niet uit een parameter; heropenen schrijft status + herbevestiging + `governance_events` + procedure-status + log **atomair** (vervangt de best-effort compensatie).
- **`p214a1_02_kolomrevoke_stappen.sql`** — `revoke update on procedure_stappen`, her-grant van de 13 niet-bewaakte kolommen; bewaakt = `status, voltooid_op, voltooid_door`. Plus **`revoke delete`** (reviewbevinding).
- **`p214a1_03_kolomrevoke_besluiten.sql`** — `revoke update, delete on procedure_besluiten`.
- **`p214a1_04_stap_insert_guard.sql`** — BEFORE INSERT-poort `fn_guard_stap_insert`: weigert voor het clientpad (`current_user in authenticated/anon`) `status in (afgerond,heropend)` en niet-lege `voltooid_*` bij aanmaken (sluit INSERT-forging).

**Rollbacks:** `supabase/rollbacks/2026_08_28_p214a1_0{1,2,3,4}_*_ROLLBACK.sql` — elk draait zijn migratie terug (RPC's droppen; grants/DELETE herstellen; trigger droppen), met een expliciete waarschuwing dat rollback het defect heropent.

**Toepassingsvolgorde:** migratie **01** (RPC's) → **code-deploy** (routes roepen RPC's) → migraties **02+03+04** (revokes + INSERT-poort). Afwijkend van de standaard "migratie eerst" omdat de revoke ná de code-deploy moet, anders breekt nog-live oude code.

## 4. Reviewuitkomsten (twee reviewers, 28-08)

**Beide: geen blocker.**

**supabase-rls-reviewer** — het revoke/RPC-mechanisme is correct en volledig (UPDATE-forging + besluiten UPDATE/DELETE dicht; RPC's veilig: `search_path` gepind + alles schema-gekwalificeerd, fondsgrens uit `auth.uid()`, `voltooid_door` server-gezet, execute alleen `authenticated`, heropen-atomariteit klopt). **Vond dat de defectklasse zonder verscherping half open was** en beide gaten zijn in a1 gedicht:
- INSERT-forging (nieuwe stap direct `afgerond` + vervalste `voltooid_door`) → INSERT-poort `p214a1_04`.
- `procedure_stappen`-DELETE niet ingetrokken (asymmetrisch) → `revoke delete` in `p214a1_02`.

**code-reviewer** — de reroute is trouw; RPC-parameters kloppen op elke call-site; de heropen-collapse behoudt elk neveneffect en de weggehaalde compensatie is echt overbodig door de transactie-atomariteit; `audit-inventaris.json` byte-identiek geregenereerd (94 handlers, 0 gaten), classificatie `fn_stap_heropenen`→bewijsketen / `fn_stap_afronden`→domein correct. Twee nits toegepast (42501→403 uitgelijnd; geen 'stap_gestart'-log bij een gefaalde activering).

## 5. Gedragstoets — bewijst het gedrag (niet de intentie)

`supabase/checks/2026_08_28_p214a1_gedrag.sql`, onder échte RLS als `authenticated`, in `begin…rollback`. Groen betekent: elk VERBODEN statement dat toch slaagt raise't 'LEK'. Scenario's:

| | Bewijst |
|---|---|
| A / A2 | directe UPDATE op `status` / `voltooid_door` → **42501** |
| B | `fn_stap_afronden` slaagt en zet `voltooid_door = auth.uid()` (server, niet vervalsbaar) |
| E | INSERT van een stap als `afgerond` + `voltooid_door` → **42501** (INSERT-poort) |
| F | directe DELETE van een afgeronde stap → **42501** |
| H | `fn_stap_afronden` op een stap in een **ander fonds** → **42501** (fondsgrens) |
| — | `fn_stap_activeren` zet een geblokkeerde stap op actief (legitiem pad) |
| G | een **bestuurder** die `fn_stap_heropenen` aanroept → **42501** (rolgate) |
| C | directe UPDATE naar `heropend` → 42501; `fn_stap_heropenen` (voorzitter) werkt |
| D | `procedure_besluiten` directe UPDATE **en** DELETE → **42501** |

## 6. Verificatiestatus

- `tsc --noEmit --skipLibCheck` = 0.
- `npm run sanity` = alle suites groen (incl. de geregenereerde audit-inventaris-gate).
- Gate + gedragstoets groen in een lokale Postgres 17 (migraties applyen schoon; de gate faalt vóór en slaagt ná de revokes — beide waargenomen).
- **Migratie-replaycheck:** de énige tabel-brede UPDATE-grant op deze twee tabellen staat in de baseline (14-08); geen migratie tússen de baseline en a1, of ná a1, verleent hem opnieuw → de revoke is het laatste woord onder een volledige replay.
- Gate + gedragstoets aangesloten op `scripts/cross-tenant-ci.sh` (draait bij jou preview-eerst onder de volledige §15-keten).

### Preview-acceptatie 29-08-2026

- Handmatige volgorde uitgevoerd: migratie `01` → code-deploy `54d0052` → migraties `02` → `03` → `04`; iedere SQL-run eindigde met `Success. No rows returned`.
- Vaste Preview-deployments van gebruikersapp en beheerportaal stonden groen op dezelfde mergecommit vóór de revokes werden toegepast.
- UI-smoke als Preview-beheerder op `app.preview.bestuurdersportaal.com`: procedure `SMOKE #214-a1 schrijfpoort 2026-08-29` (`9b157ac7-ff6e-44c2-93de-57910552bb43`) rondde stap 1 af; voortgang werd `1 van 5` en stap 2 werd automatisch actief.
- UI-smoke besluitpad: procedure `SMOKE #214-a1 besluitpad 2026-08-29` (`df857a4e-5f4f-40e8-80a0-be3d1e28703b`) legde een formeel besluit vast; na herladen waren formulering en motivering zichtbaar.
- Uitkomst: beide legitieme `authenticated`-schrijfpaden werken na de revokes; geen aanwijzing dat een resterend app-pad rechtstreeks naar de bewaakte stapkolommen schrijft.

## 7. Productiepoort en integratievolgorde

**Stop vóór Productie:** de PR `preview` → `main` mag worden voorbereid, maar merge, migraties en deploy wachten op afzonderlijk expliciet akkoord.

- Productie gebruikt dezelfde volgorde als Preview: `01` → code-deploy → `02` → `03` → `04` → UI-smokes.
- **Niet combineren met de `ENFORCE_CAPABILITY`-flip** (#210 / besluit 0186). Valt die flip in hetzelfde releasewindow, dan schuift één van beide wijzigingen door.
- Na de productie-uitrol is de tweesignalen-driftcontrole verplicht: `DRIFT_PROD_URL=… DRIFT_PREVIEW_URL=… bash scripts/drift-vergelijk.sh`. Alleen groen op zowel Productie-versus-pin als Preview-versus-Productie sluit het migratierondje af; niet vooraf pinnen om een afwijking weg te schrijven.
- Daarna eerst `epic/proceduremodule-v2` rebasen op `main` mét a1. Vervolgens de gecombineerde staat uit `wip/214-epic-gecombineerd` terughalen en a2 dun/additief op de epic schrijven. Pas daarna `feat/p4-status-feitenmatrix` op de bijgewerkte epic rebasen en tranche 4 uitvoeren. a1 niet eerder afzonderlijk in P4 integreren: dat creëert twee invoerroutes.

## 8. Restpunten (bewust, geen blocker)

- `heropend_op` en `herbevestiging_nodig` blijven direct schrijfbaar door `authenticated` (buiten de drie bewaakte kolommen, per 0194-scope). Inert: zonder `status`-recht kan een fondslid geen heropening forgen. Beide reviewers noemden het low-impact; te verscherpen op jouw woord.
- Het bredere #214-restant (overige `decision_objects`-kolommen, de andere fonds-only tabellen) blijft open in #214.
