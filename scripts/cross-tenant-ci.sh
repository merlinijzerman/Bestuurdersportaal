#!/usr/bin/env bash
# ============================================================================
#  §15 cross-tenant testsuite — één orkestratie-entrypoint (increment T5).
# ----------------------------------------------------------------------------
#  Bundelt de VOLLEDIGE §15-matrix (T1–T14, beslisnotitie v0.4) tot één rood/
#  groen-uitkomst, zodat tenant-isolatie aantoonbaar en regressievast is vóór
#  de onboarding van fonds 2 (gate G2/T7). Dit is HET verplichte verificatie-
#  commando bij elke wijziging aan een tenant-pad (zie T3-RLS-CONTROLEKADER §7).
#
#  Wat draait, in volgorde (fail-fast — set -e):
#    [1] tsc --noEmit --skipLibCheck        — typecheck (CLAUDE.md-gate).
#    [2] app-laag §15-matrix (node:test)    — T1–T5, T8–T14 als benoemde tests,
#                                             incl. de negatieve controles.
#    [3] migraties → test-DB                — schema opbouwen (psql-apply).
#    [4] DB-laag §15-matrix (psql)          — T3+T4 write-isolatie + T6/T7
#                                             export/storage; elke "LEK:" → rood.
#
#  Negatieve controle (besluit 0046 §E, T3-kader §8): elk scenario bewijst dat
#  een geïntroduceerd lek de test ROOD maakt — app-laag via de meegeleverde
#  negatieve-controle-tests, DB-laag via het `raise exception 'LEK:…'`-patroon.
#  Zulke lek-varianten worden NOOIT naar main gecommit.
#
#  Test-DB (stap 3–4) vereist een wegwerpbare DB via de omgeving:
#     TEST_DATABASE_URL  (voorkeur)  of  DATABASE_URL  (fallback).
#  In CI levert `supabase start` die DB; daar staat XTENANT_REQUIRE_DB=1 zodat
#  het ontbreken van een DB de suite ROOD maakt (blokkerend). Lokaal zónder DB
#  draait alleen de app-laag (stap 1–2) en meldt de suite de DB-laag als
#  overgeslagen — handig voor een snelle pre-commit-check.
#
#  Gebruik lokaal (app-laag):     bash scripts/cross-tenant-ci.sh
#  Gebruik lokaal (volledig):     TEST_DATABASE_URL='postgresql://…' bash scripts/cross-tenant-ci.sh
#  In CI:                         zie .github/workflows/rls-cross-tenant.yml
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

SQL_T5="supabase/checks/2026_07_09_t5_export_storage.sql"
# Increment T6 — generieke contentlaag read-only + namespace-invariant. (Let op:
# de "T6-export"-regel hieronder is een §15-matrixlabel, niet dit increment.)
SQL_T6C="supabase/checks/2026_07_09_t6_generiek_readonly.sql"
# Increment T8 — config-/manifestlaag: cross-tenant + rolgate + append-only.
SQL_T8C="supabase/checks/2026_07_09_t8_config_cross_tenant.sql"
# Increment T10 — review-verval-gate op retrieval + generieke toestandsmachine.
SQL_T10="supabase/checks/2026_07_10_t10_review_verval.sql"
# Increment T11 — stuurinformatie/klantbeeld-data: cross-tenant + rolgate + deny-delete.
# (Let op: het "T11–14"-label in de eindsamenvatting is een §15-matrixlabel voor
#  RAG-fondsdiscipline — niet dit increment.)
SQL_T11M="supabase/checks/2026_07_10_t11_cross_tenant.sql"
# Increment T13 — stuurinfo-periodemodel + reserves: cross-tenant + rolgate + deny-delete.
SQL_T13="supabase/checks/2026_07_16_t13_cross_tenant.sql"
# Increment T14 — stuurinfo-invoerlaag: auditlog-isolatie + append-only + capture-trigger + RPC-rolgate.
SQL_T14="supabase/checks/2026_07_17_t14_cross_tenant.sql"
# Increment T15 — tabs 4/5 (spreiding/soli): soli-RPC-rolgate + eindstand-consistentie + één-bron-band.
SQL_T15="supabase/checks/2026_07_17_t15_cross_tenant.sql"
# Increment T16 — tabs 6/7 (operationeel/premie): RPC-rolgate + mutatie-consistentie + één-bron-ultimo.
SQL_T16="supabase/checks/2026_07_18_t16_cross_tenant.sql"
# Increment T17 — tab 3 (biometrie): reeks-isolatie langleven/risicodekking + één-bron-koppeling
# (soli SOLI_LANGLEVEN_ONTBREEKT; oper OPER_BIOMETRIE_/PREMIE_ONTBREEKT + som-check) + deny-delete.
SQL_T17="supabase/checks/2026_07_19_t17_cross_tenant.sql"
# AQLab (AQL-1) — provider-globale aqlab_-tabellen: RLS-aan + append-only +
# synthetic-CHECK + release-beslisregel + deny-by-default (geen tenant-lees/schrijf).
SQL_AQLAB="supabase/checks/2026_07_10_aqlab_cross_tenant.sql"
# R1 (review 2026-07-30) — structurele gates op TENANTCORRECTHEID van policies.
# De T3-gate toetst of een schrijf-policy een WITH CHECK heeft; deze gates
# toetsen of het PREDIKAAT een tenantgrens bevat. Zonder deze gates kon K-01
# (decision_dissent zonder fondsclausule) ontstaan én onopgemerkt blijven.
SQL_R1G="supabase/checks/2026_07_31_r1_structurele_gates.sql"
# AI-begrenzing (2026-08-16, besluit 0180) — quota, kill switch en modelallowlist.
# Deny-by-default op acht tabellen, append-only verbruikslog, en het gedrag uit de
# acceptatiematrix: idempotentie zonder tweede providercall, quotumgrenzen per
# gebruiker/fonds/platform, OCR als eigen grootheid, en vier-ogenheractivering
# waarbij zelfgoedkeuring OOK buiten de UI om onmogelijk is.
# NB: race-veiligheid staat bewust NIET hier — dat vergt twee echt gelijktijdige
# verbindingen; zie scripts/ai-quota-race.sh.
SQL_AIB="supabase/checks/2026_08_16_ai_begrenzing.sql"
# R1 — gedragsbewijs voor de vijf herstelde tenantgrenzen (K-01/H-01/H-02/M-01).
SQL_R1B="supabase/checks/2026_07_31_r1_tenantgrenzen.sql"
# maak_profiel — deterministische fondstoewijzing (T2/R1) plus, sinds 17-08-2026,
# de grens tegen zelfregistratie (PT-1): het fonds komt uit app-metadata, en
# fonds_id of platform in USER-metadata wordt geweigerd.
#
# Dit bestand bestond al sinds 08-07-2026 maar draaide NERGENS: scripts/g2-evidence.sh
# controleerde alleen dat het bestánd bestaat. Een test die niet draait is geen test —
# precies bevinding P1-4. Vandaar hier.
SQL_MP="supabase/checks/2026_07_08_maak_profiel_deterministisch.sql"
# Increment G (2026-06-20) — retrieval-filtering op status/bronstatus/geldigheid.
# Stond buiten CI; toegevoegd n.a.v. reviewbevinding "risico h niet volledig gedekt".
SQL_G20="supabase/checks/2026_06_20g_retrieval_filtering.sql"
# P5 (2026-08-03) — monitoringtabellen: anon/authenticated zien niets en kunnen
# niets schrijven, fn_app_error_log is niet anon-aanroepbaar, app_errors is WEL
# opschoonbaar (geen auditspoor) en platform_event_log blijft append-only.
SQL_P5="supabase/checks/2026_08_03_p5_monitoring.sql"
# T1 bureau-rol (2026-08-05) — ROLgrens BINNEN één fonds, niet tussen fondsen.
# RLS isoleert hier op fonds_id en niet op rol, dus de afscherming van
# `bestuursbureau` (geen inbreng, geen stemgedrag, niet stemmen/inbrengen/dissent)
# is een actieve predicaat-uitbreiding en geen vanzelfsprekendheid. Inclusief
# nulgrens G23: bestuurder en voorzitter gedragen zich exact als daarvoor.
SQL_BB="supabase/checks/2026_08_05_bb_rolgrenzen.sql"
# C-01 (2026-08-20) — vw_fondsleden: cross-tenant + kolomafscherming + LEES- en
# SCHRIJFrechten op de drie views in public. Deze suite bestond sinds 02-08 maar
# stond in GEEN ENKELE CI-job; daardoor bleef onopgemerkt dat `authenticated`
# INSERT/UPDATE/DELETE op de definer-view had (Supabase-default-ACL, niet uit een
# migratie) en daarmee buiten RLS om `rol` en `fonds_id` van elk profiel kon
# zetten. V10 is generiek: geen enkele view in public mag I/U/D hebben voor een
# browserrol — dat sluit de objectklasse die de gates A–H niet kennen.
SQL_VWF="supabase/checks/2026_08_02_fondsleden_cross_tenant.sql"

echo "== [1/4] tsc --noEmit --skipLibCheck =="
./node_modules/.bin/tsc --noEmit --skipLibCheck
echo "OK: typecheck groen."
echo

echo "== [2/4] app-laag §15-matrix (node:test): T1–T5, T8–T14 =="
node --import tsx --test tests/cross-tenant/*.test.ts
echo "OK: app-laag §15-matrix groen (incl. negatieve controles)."
echo

DB_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  if [ "${XTENANT_REQUIRE_DB:-0}" = "1" ]; then
    echo "FOUT: XTENANT_REQUIRE_DB=1 maar geen TEST_DATABASE_URL/DATABASE_URL gezet." >&2
    echo "  De DB-laag (T3/T4/T6/T7) is verplicht in deze context en MOET draaien." >&2
    exit 1
  fi
  echo "== DB-laag (stap 3–4) OVERGESLAGEN: geen test-DB gezet =="
  echo "  Zet TEST_DATABASE_URL voor de volledige suite (T3/T4/T6/T7 onder échte RLS)."
  echo
  echo "GROEN (app-laag). LET OP: de DB-laag draaide niet — niet volledig in deze run."
  exit 0
fi

echo "== [3/4] migraties toepassen op de test-DB =="
bash scripts/testdb-apply-migrations.sh
echo

echo "== [4/4] DB-laag §15-matrix (psql) =="
echo "-- T3 (write-isolatie) + T4 (retrieval-fondsdiscipline T11–T14) --"
bash scripts/rls-cross-tenant-test.sh
echo
echo "-- T6/T7 (export + storage cross-tenant) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T5"
echo
echo "-- T6 (generieke contentlaag read-only + namespace-invariant) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T6C"
echo
echo "-- T8 (config-/manifestlaag: cross-tenant + rolgate + append-only) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T8C"
echo
echo "-- T10 (review-verval-gate op retrieval + generieke toestandsmachine) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T10"
echo
echo "-- T11-modules (stuurinformatie/klantbeeld-data: cross-tenant + rolgate + deny-delete) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T11M"
echo
echo "-- T13 (stuurinfo-periodemodel + reserves: cross-tenant + rolgate + deny-delete) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T13"
echo
echo "-- T14 (stuurinfo-invoerlaag: auditlog + append-only + capture-trigger + RPC-rolgate) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T14"
echo
echo "-- T15 (stuurinfo tabs 4/5: soli-RPC-rolgate + eindstand-consistentie + één-bron-band) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T15"
echo
echo "-- T16 (stuurinfo tabs 6/7: oper/premie-RPC-rolgate + mutatie-consistentie + één-bron-ultimo) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T16"
echo
echo "-- T17 (stuurinfo tab 3 biometrie: reeks-isolatie + één-bron-koppeling soli/oper + deny-delete) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T17"
echo
echo "-- AQLab (aqlab_: RLS-aan + append-only + synthetic-CHECK + release-beslisregel + deny-by-default) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_AQLAB"
echo
echo "-- G20 (retrieval-filtering: status/bronstatus/geldigheidsperiode per modus) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_G20"
echo
echo "-- R1-gates (tenantcorrectheid van policies + anon + search_path) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_R1G"
echo
echo "-- R1-gedrag (decision_dissent, notificaties, inzage/metadata-log, inbreng) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_R1B"
echo
echo "-- maak_profiel (deterministisch fonds + zelfregistratiegrens PT-1) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_MP"
echo
echo "-- P5-monitoring (deny-by-default op de drie nieuwe tabellen + retentie mogelijk) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P5"
echo
echo "-- BB-rolgrenzen (bestuursbureau: 0 rijen inbreng/stemgedrag, geen schrijfpad, nulgrens G23) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_BB"
echo
echo "-- AI-begrenzing (quota, kill switch, modelallowlist, vier-ogenheractivering) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_AIB"
echo

echo "-- C-01 (vw_fondsleden cross-tenant + kolomafscherming + view-schrijfrechten) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_VWF"
echo

echo "============================================================================"
echo "GROEN: volledige §15 cross-tenant suite geslaagd (app-laag + DB-laag)."
echo "  AI-beg quota/kill switch/vier ogen            (DB-laag; race apart)"
echo "  T1–T4  host→fonds + fail-closed enforce      (app-laag)"
echo "  T5/T8  auditfonds server-side afgeleid        (app-laag guard + DB append-only)"
echo "  T9/T10 platform-routing surface-isolatie      (app-laag)"
echo "  T11–14 RAG-fondsdiscipline                     (app-laag + DB DEEL 2)"
echo "  T3-write / T6-export / T7-storage             (DB-laag onder échte RLS)"
echo "  T6-content generieke read-only + namespace    (DB-laag onder échte RLS)"
echo "  T8-config cross-tenant + rolgate + append-only (DB-laag onder échte RLS)"
echo "  T10-review verval-gate + generieke toestandsmachine (DB-laag)"
echo "  T11-modules stuurinfo/klantbeeld cross-tenant + rolgate + deny-delete (DB-laag)"
echo "  T13 stuurinfo-periodemodel + reserves cross-tenant + rolgate + deny-delete (DB-laag)"
echo "  T14 stuurinfo-invoerlaag auditlog + append-only + capture-trigger + RPC-rolgate (DB-laag)"
echo "  T15 stuurinfo tabs 4/5 soli-RPC + eindstand-consistentie + één-bron-band (DB-laag)"
echo "  T16 stuurinfo tabs 6/7 oper/premie-RPC + mutatie-consistentie + één-bron-ultimo (DB-laag)"
echo "  T17 stuurinfo tab 3 biometrie reeks-isolatie + één-bron-koppeling soli/oper + deny-delete (DB-laag)"
echo "  AQLab aqlab_ RLS-aan + append-only + synthetic + beslisregel + deny-by-default (DB-laag)"
echo "  G20  retrieval-filtering status/bronstatus/geldigheid                (DB-laag)"
echo "  R1   tenantcorrectheid van policies + anon + search_path (gates A-E)  (DB-laag)"
echo "  R1   gedragsbewijs K-01/H-01/H-02/M-01                                (DB-laag)"
echo "  MP   maak_profiel deterministisch fonds + zelfregistratiegrens PT-1   (DB-laag)"
echo "  P5   monitoringtabellen deny-by-default + RPC niet-anon + retentie    (DB-laag)"
echo "  BB   rolgrenzen bestuursbureau + nulgrens G23                          (DB-laag)"
echo "  C-01 vw_-views: cross-tenant, kolomafscherming, geen I/U/D voor browserrol (DB-laag)"
echo "============================================================================"
