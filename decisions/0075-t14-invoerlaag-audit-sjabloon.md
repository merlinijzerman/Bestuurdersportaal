# 0075 — T14: beheer-invoerlaag stuurinformatie — audittrigger, atomische RPC, vast sjabloon, geen vier-ogen

- **Status:** Geaccepteerd
- **Datum:** 2026-07-17
- **Betrokkenen:** Merlin (product/plansessie Cowork; keuzes bevestigd in de Claude Code-plansessie), Claude Code (implementatie)

## Context

De stuurinformatie draaide op synthetische seed-data; het T13-periodemodel (0074) is
gebouwd mét het oog op een invoerlaag. De werkopdracht "Beheer-invoerlaag
stuurinformatie" vraagt: één beheerscherm (uitbreidbaar per tab-ticket), handmatige
invoer voor Balans/Reserves, een Excel-upload met controlescherm, en — omdat mensen
nu rechtstreeks in de feitentabellen schrijven — het dichten van het bewust
geaccepteerde T11-restrisico "mutabel zonder change-log" (0054). Drie punten stonden
open voor besluit: de rol, de sjabloonbron en de auditlog-vorm.

## Besluit

1. **Capability `stuurinformatie.manage` = voorzitter + beheerder** (bevestigd door
   Merlin). Consistent met de bestaande RLS-schrijfpolicy op de
   `fonds_stuurinfo_*`-tabellen (voorzitter/beheerder, WITH CHECK) — de DB-laag en
   de app-laag vertellen hetzelfde verhaal; geen policywijziging nodig. Drielagen:
   pagina (warn), API-routes (403), RLS (hard).
2. **Auditlog = eigen `fonds_stuurinfo_log`, gevuld door een DB-capture-trigger**
   (T8b-patroon, 0051; bevestigd door Merlin). AFTER INSERT/UPDATE op de vier
   datatabellen: atomisch met de datawrite, niet overslaanbaar vanuit code, en ook
   toekomstige ETL-/API-writes worden gelogd. Immutability via het bestaande
   `fn_log_append_only()`; géén UPDATE-/DELETE-policy. **No-op-guard**: een upsert
   die niets wijzigt logt niet (anders ~20 identieke regels per save).
   De **bron** (handmatig/upload) reist mee via een nullable kolom `invoer_bron`
   op de datarijen die de trigger naar het log kopieert — een Postgres-GUC
   overleeft PostgREST-requests niet betrouwbaar; app-level log-inserts breken de
   atomiciteit (de T8b-les). Seeds/migraties loggen met actor/bron null.
3. **Atomische save via `security invoker`-RPC `stuurinfo_balans_opslaan`**
   (profiel_opslaan-precedent, 0017): registry + 10 balans-leaves + 8 reserves +
   FG-KPI in één transactie. Losse upserts zouden bij een partiële fout precies de
   reeks↔reserve-desync achterlaten die "één bron per bedrag" moet uitsluiten.
   RLS blijft onverkort gelden; `fonds_id` komt uitsluitend uit `auth.uid()`
   (geen parameter).
4. **Balansevenwicht is een harde validatie op twee lagen**: de route weigert met
   422 (pure module hergebruikt `leidBalansAf`, zelfde tolerantie 0.005) en de RPC
   herhaalt de check in SQL (`BALANS_SLUIT_NIET`) — governance-logica niet
   uitsluitend app-side. Afgeleide velden (toetsvermogen, eigen vermogen, totalen)
   bestaan niet in de payload-vorm: een **exhaustieve key-allowlist** weigert
   onbekende én ontbrekende keys (400). De RPC toetst bovendien dat de gekoppelde
   reservestanden exact de balanswaarden zijn (`GEKOPPELDE_STAND_ONGELIJK`).
5. **Eigen vast Excel-sjabloon** (bevestigd door Merlin): kolom A = vast veldlabel,
   B = waarde, C = eenheid (informatief). Herkenning op genormaliseerd label
   (case/whitespace/diacritics/koppeltekens; exact, geen fuzzy). Sjabloonlabel
   `Overig toetsvermogen` disambigueert het DB-label "Overig". Upload is
   **parse-only**; de commit loopt via hetzelfde POST-pad als handmatige invoer
   (`invoer_bron: 'upload'`) — één schrijfpad, server hervalideert integraal.
   Onherkende labels: ⚠ in het controlescherm, nooit gecommit (geen koppel-UI in
   dit ticket). De uitvoerder-set kan later als extra mapping-variant.
6. **Geen vier-ogen (bewust, MVP)**: opslaan publiceert direct naar het dashboard.
   Het vangnet = harde balansvalidatie + Δ-signalering in het controlescherm +
   append-only auditlog. Heroverwegen vóór livegang (apart besluit/increment,
   B10-gate).
7. **Periodevolgorde deterministisch**: `volgorde = jaar*4 + kwartaal` (2026Q2 →
   8106), in de migratie ook toegepast op de bestaande registry-rijen — een later
   ingevoerde historische periode sorteert daarmee altijd correct (het
   `max+1`-alternatief faalt daar).
8. **Hardening na subagent-review (T14b, zelfde dag)**: (a) de capture-trigger
   logt de VOLLEDIGE rij (`to_jsonb` minus `bijgewerkt`) — de aanvankelijke
   subset-payload liet mutaties van `delta`/`toelichting`/`populatie_n`/
   `invoer_bron` ongelogd (audit-must-fix M1: een ongelogde `populatie_n`-mutatie
   kon de n<10-suppressie beïnvloeden); (b) de log-INSERT-policy eist
   `gebruiker_id = auth.uid()` (geen actor-spoofing); (c) de RPC weigert
   JSON-null-waarden (`ONGELDIGE_WAARDE`), dwingt de bron-allowlist af
   (`ONGELDIGE_BRON`) en negeert aangeleverde reserve-labels (vaste lijst —
   geen vrije-tekstkanaal); (d) `revoke execute from PUBLIC` op de RPC
   (én op het precedent `profiel_opslaan` — "revoke from anon" alleen was
   symbolisch omdat PUBLIC EXECUTE erft). Migratie
   `2026_07_17_t14b_stuurinfo_audit_hardening.sql` (+ROLLBACK).

## Overwogen alternatieven

- **Alleen beheerder mag invoeren** — strikter, maar dan is de DB-laag (die
  voorzitter toestaat) ruimer dan de app-laag; zou een RLS-aanscherping vergen.
  Verworpen (Merlin).
- **Uitvoerder-kolomindeling als sjabloon** — minder overtypen, maar de indeling
  is niet in de repo bekend en wijzigt buiten ons zicht. Verworpen als basis;
  later als mapping-variant mogelijk (Merlin).
- **Auditlog vanuit applicatiecode** (governance_events-patroon) — flexibeler
  context, maar omzeilbaar en niet atomisch met de datawrite (het T8-probleem dat
  T8b juist oploste). Verworpen.
- **Hergebruik `fonds_config_log`** — geen nieuwe tabel, maar dat log is voor
  config-versies (versie-bump-constraint past niet op feitendata). Verworpen.
- **Losse upserts i.p.v. RPC** — eenvoudiger TS, maar partial failure = dubbele
  waarheid tussen reeks en reserve. Verworpen.
- **Vier-ogen/vaststellingsworkflow** — bewust uitgesteld tot vóór livegang.

## Gevolgen

- **RLS/tenant:** geen wijziging aan bestaande policies. Nieuw log volgt het
  fonds-RLS-patroon (lezen eigen fonds; insert eigen fonds + rolgate; geen
  update/delete). DB-suite `supabase/checks/2026_07_17_t14_cross_tenant.sql`
  (T14a–f) bedraad in `cross-tenant-ci.sh`.
- **Audit:** het 0054-restrisico "feitentabellen mutabel zonder change-log" is
  gedicht voor de vier stuurinfo-tabellen. Bekend restpunt (zelfde vorm als
  `fonds_config_log`): een privileged rol kan via PostgREST ook direct een
  logregel inserten; het log blijft append-only en per fonds.
- **Data:** de eerste save herberekent `pct_waarde` (stand/TV×100, 1 decimaal) —
  wijkt op een enkel punt af van de handafgeronde seed (soli Horizon Q2: 3,4 vs
  3,3); binnen band, geen functioneel effect.
- **Geen DELETE:** een foutieve periode blijft in de filterlijst staan (correctie
  = overschrijven, gelogd); eventueel later een `verborgen`-vlag (nieuw ticket).
- **Uitbreidbaarheid:** tab-tickets 2–7 voegen hun eigen invoersectie én
  sjabloonsectie toe (`SJABLOON_VELDEN`) op dit fundament; de RPC-signatuur
  uitbreiden = nieuwe migratie (create-or-replace kan niet van signatuur wisselen).
- **Werkhypothese 0074 blijft open:** samenstelling toetsvermogen/compensatiedepot
  valideren met AZL/actuaris vóór echte data-invoer.

## Referenties

- Werkopdracht "Beheer-invoerlaag stuurinformatie" (plansessie Cowork, 2026-07-16)
  + mockup `stuurinformatie-beheer-invoer-mockup.html` (projectroot).
- Migratie: `supabase/migrations/2026_07_17_t14_stuurinfo_invoer_audit.sql` (+ROLLBACK).
- Code: `core/lib/stuurinfo-invoer.ts` + `stuurinfo-sjabloon.ts` (puur + sanity),
  `core/lib/stuurinfo-beheer{,-bron}.ts`, `app/api/stuurinformatie/beheer/*`,
  `app/(dashboard)/beheer/stuurinformatie/`.
- Eerdere besluiten: 0074 (T13-periodemodel), 0054 (restrisico change-log),
  0051 (T8-config-audit eigen logtabel), 0017 (security-invoker-RPC-precedent),
  0001 (append-only grondbesluit), 0055 (suppressie n<10 — leeskant ongewijzigd).
