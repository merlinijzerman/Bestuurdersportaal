# #214-a1 — beoordeelbaar pakket (schrijfpoort op procedure_stappen/besluiten)

**Branch:** `fix/214a1-schrijfpoort-main` (op `origin/main` a187b4a). **Besluit:** [`0194`](decisions/0194-214a-schrijfpoort-en-p4-statusbesluiten.md). **Meting:** [`METING-RLS-reikwijdte-214.md`](METING-RLS-reikwijdte-214.md).
**Aard:** productiefix, standalone van EPIC P. **#210:** één gedragsverandering — niet bundelen.

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

## 7. Restpunten (bewust, geen blocker)

- `heropend_op` en `herbevestiging_nodig` blijven direct schrijfbaar door `authenticated` (buiten de drie bewaakte kolommen, per 0194-scope). Inert: zonder `status`-recht kan een fondslid geen heropening forgen. Beide reviewers noemden het low-impact; te verscherpen op jouw woord.
- Het bredere #214-restant (overige `decision_objects`-kolommen, de andere fonds-only tabellen) blijft open in #214.
