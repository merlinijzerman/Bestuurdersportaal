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
#
#  WP5-CI-ontdubbeling: de workflow zet `XTENANT_FAST_LAGEN=overslaan`, omdat
#  typecheck en app-matrix in dezelfde PR al onder `g2-evidence` draaien. Deze
#  opt-out is exact en niet de standaard. `XTENANT_REQUIRE_DB=1` blijft in die
#  workflow verplicht, zodat alleen de dubbele snelle lagen vervallen en nooit
#  de echte RLS-/DB-laag.
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
# ── V4 (2026-08-20/21) — suites die geschreven waren maar nergens automatisch
#    draaiden; geïnventariseerd + geverifieerd groen tegen een schone PG17-stack
#    (ticket V4, #81). Alleen relevante, self-seeding, hard-falende suites zijn
#    hier aangesloten.
#
#    BEWUST BUITEN DEZE GATE, met reden — een uitzondering is een waarde:
#      • read-only diagnoses (f0-ingest-voorraad, t14b-driftmeting, vraagrouter-
#        preview): groen, maar ze stellen niets HARD vast; in een gate kosten ze
#        looptijd zonder bescherming toe te voegen;
#      • 2026_06_20e_verificatie_en_regressie: GEEN CI-suite maar een handmatige
#        checklist voor de Supabase SQL-editor, met placeholders (<FONDS_A_USER>);
#      • a-rollen/capabilities (#83) en t7/t8 semantisch (#84): ROOD gemeten op
#        21-08 tegen een schone stack. Aansluiten kan pas als die bevindingen
#        gesloten zijn — een rode suite aansluiten maakt de gate rood zonder dat
#        er iets nieuws beschermd wordt.
#
#    CORRECTIE 21-08: hierboven stond de fondsleden-suite als "rood/uitgesloten".
#    Dat klopt niet meer — C-01 (#76, PR #77) is gemerged en die suite is nu
#    aangesloten en groen; zie SQL_VWF hieronder.
# P3-B — rol zetten via het service-role-pad (besluit 0082, B-4): bevriezing-
# trigger laat service-role vrij, rol-CHECK weigert ongeldige waarde. ASSERT-
# gebaseerd (plpgsql.check_asserts staat in CI aan).
SQL_P3B="supabase/checks/2026_07_27_p3b_rol_service_role.sql"
# Plateau B — de reflectieflow is server-controlled (besluit 0110): client kan
# bronset/beurtteller/afronding niet sturen; dekt AC-18 en AC-24.
SQL_REFLECTIE="supabase/checks/2026_08_05_b_reflectie_flow.sql"
# T5 — comparison_results + fn_schrijf_vergelijking: RLS-isolatie, schrijfpad
# alleen via de functie, fonds server-side uit auth.uid(), tenant-guard (42501).
SQL_T5VGL="supabase/checks/2026_08_13_t5_vergelijking.sql"
# ── T3 en T4 (21-08) — de twee FUNDAMENTELE negatieve suites, en ze hadden een
#    eigen faalpatroon: ze stonden in `scripts/rls-cross-tenant-test.sh`, een
#    TWEEDE script dat in geen enkele workflow draait. CI roept uitsluitend dit
#    bestand aan. Ze waren dus niet vergeten — ze zaten in een script dat niemand
#    aanroept, en dat is moeilijker te zien dan een omissie.
#
#    Samen 23 harde `raise exception`-asserties, allebei groen gemeten tegen een
#    schone stack, allebei expliciet voor CI geschreven ("elke overtreding doet
#    raise exception → psql exit-code <> 0 → CI faalt"). Zelfde faalpatroon als
#    C-01: de detectie bestond, de gate zag hem niet.
# T3 — negatieve cross-tenant RLS-suite. DEEL 1 is structureel en seedloos: faalt
# zodra een write-policy op een tenant-tabel géén WITH CHECK heeft of een auditlog
# de append-only-trigger mist. Dekt ook toekomstige tabellen.
SQL_T3="supabase/checks/2026_07_08_t3_cross_tenant.sql"
# T4 — negatieve retrieval-fondsdiscipline: zoek_chunks(_hybride) dwingen de
# fondsgrens en de published-only-generiekregel af, en een request-supplied
# p_fonds_id surfacet nooit andermans content.
SQL_T4="supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql"
# C-01 (2026-08-20) — vw_fondsleden: cross-tenant + kolomafscherming + LEES- en
# SCHRIJFrechten op de drie views in public. Deze suite bestond sinds 02-08 maar
# stond in GEEN ENKELE CI-job; daardoor bleef onopgemerkt dat `authenticated`
# INSERT/UPDATE/DELETE op de definer-view had (Supabase-default-ACL, niet uit een
# migratie) en daarmee buiten RLS om `rol` en `fonds_id` van elk profiel kon
# zetten. V10 is generiek: geen enkele view in public mag I/U/D hebben voor een
# browserrol — dat sluit de objectklasse die de gates A–H niet kennen.
SQL_VWF="supabase/checks/2026_08_02_fondsleden_cross_tenant.sql"
# V3 — grants-gate over ALLE objectklassen (relaties, functies, buckets,
# storage-policies) tegen een expliciete allowlist in de repo. Sluit de blinde
# vlek waar C-01 in viel: gates A-H redeneren over tabellen en functies, nooit
# over views. Faalt in BEIDE richtingen — te veel én onverwacht te weinig.
SQL_V3="supabase/checks/2026_08_20_v3_grants_volledig.sql"
# #214-a1 (0194) — schrijfpoort: statische gate + gedragstoets (directe PATCH dicht).
SQL_P214A1="supabase/checks/2026_08_28_p214a1_schrijfpoort.sql"
SQL_P214A1G="supabase/checks/2026_08_28_p214a1_gedrag.sql"
# Productieherstel 01-09: bewijst zonder authfixture dat specifiek de herstelde
# BEFORE INSERT-trigger overgangsstatus en voltooiingsmetadata weigert.
SQL_P214A1_HERSTEL="supabase/checks/2026_09_01_p214a1_05_stap_insert_guard_herbevestiging.sql"
# #214-a2 (0194) — epic-only afwijkingskolommen blijven buiten authenticated UPDATE.
SQL_P214A2="supabase/checks/2026_08_29_p214a2_afwijkingskolommen_schrijfpoort.sql"
# P4 tranche 8 (#169, 0194 F) — I5 composite-FK weigert cross-fonds referenties.
SQL_P4I5="supabase/checks/2026_08_29_p4_i5_composite_fk.sql"
# P4 tranche 4 (#169) — I1: statusclaim vereist matrixfeit.
SQL_P4I1="supabase/checks/2026_08_29_p4_04_status_feitenmatrix.sql"
# #228-familie / bevinding 2b — een besluit mag ongebonden bestaan; alleen een
# gebonden approval voldoet aan de P4-status-feitenmatrix.
SQL_P2C_ONGB="supabase/checks/2026_08_31_p2c_ongebonden_besluit.sql"
# P5c (§9.3) — werkverkeer per stap: statusneutraal, I5 en auteur-/tenantgrens.
SQL_P5C_NOTITIE="supabase/checks/2026_08_30_p5c_stap_notitie_gedrag.sql"
# T2 (#304) — de voorbereiding als bewaard product. `/api/chat` schrijft hier
# voor het eerst naar een DOMEINtabel; dat vraagt om bewijs in plaats van een
# aanname. Meet: schrijfbaarheid van de eigen rij onder RLS, overschrijven via de
# unique-constraint, dat de upsert de aantekeningen van de notities-route LAAT
# STAAN, en dat de voorbereiding privé blijft — ook voor de voorzitter.
SQL_T2VB="supabase/checks/2026_09_04_t2_voorbereiding_product.sql"
# Microsoft 365 fase 1 — private tokenkluis, minimale DB-rol, secdef-paths en
# exact één fail-safe integratieprofiel per fonds.
SQL_M365F1="supabase/checks/2026_09_04_microsoft_fase1_connectorfundament.sql"
# P5d / #256 — procedure beëindigen/heropenen: rolpoort, I2, snapshot en audit.
SQL_P5D_BEEINDIGEN="supabase/checks/2026_08_31_p5d_procedure_beeindigen_gedrag.sql"
# #212 — elke browser-uitvoerbare SECURITY DEFINER heeft een aantoonbaar
# auth-/fonds-/rolslot, of staat als productbreed/trigger expliciet gemotiveerd
# op de allowlist.
SQL_SECDEF_SELF="supabase/checks/2026_08_31_secdef_self_gate.sql"
# A — rollen/capabilities + het governance_log-schrijfpad (#83). Stond op de
# V4-rodelijst; bleek geen productregressie maar een verouderde FIXTURE: de seed
# zette `naam` in app-metadata terwijl maak_profiel hem uit user-metadata leest.
# Zie de fixture-correctie in de suite zelf.
SQL_ROLCAP="supabase/checks/2026_08_04_a_rollen_capabilities.sql"
# T7/T8 — semantische laag en extractie (#84). Stonden op de V4-rodelijst omdat
# de concepts-catalogus in de test-DB leeg is: die wordt door PRE-CUTOFF
# migraties gevuld en de schema-only baseline stript data-INSERTs. De suites
# zaaien hem nu zelf, binnen hun eigen transactie.
SQL_T7SEM="supabase/checks/2026_08_12_t7_semantische_laag.sql"
SQL_T8SEM="supabase/checks/2026_08_12_t8_semantische_extractie.sql"
# Bewijs↔vereiste-binding — expliciete één-op-éénbinding, fail-closed bij
# ambiguïteit, atomische audit voor directe PostgREST-writes en snapshotdekking.
SQL_BBIND="supabase/checks/2026_08_18_bewijsbinding.sql"
# #263 — P2-indexpreflight mag een hoge drempel van een andere requirement op
# dezelfde stap niet aan een gebonden document toeschrijven.
SQL_P2_INDEX_PREFLIGHT="supabase/checks/2026_09_01_p2a_01_bewijsindex_preflight_regressie.sql"
# P2/PR-B (#167): procedure_vaststelling — binding, I1 en tenant-isolatie (0189).
SQL_VAST="supabase/checks/2026_08_25_vaststelling_binding_cross_tenant.sql"
# P3/PR-C (#168): afronden met afwijking — snapshot-pin (SQL-helft) + eigen slot (0192).
SQL_P3C="supabase/checks/2026_08_27_p3c_afwijking.sql"
# P3/PR-D (#168): atomaire besluitstatus-omslag met vastlegging (0193).
SQL_P3D="supabase/checks/2026_08_28_p3d_besluit_omslag.sql"

if [ "${XTENANT_FAST_LAGEN:-uitvoeren}" = "overslaan" ]; then
  echo "== [1–2/4] snelle lagen bewust niet herhaald =="
  echo "Typecheck en app-laag hebben g2-evidence als primaire PR-eigenaar."
  echo "De DB-laag blijft verplicht via XTENANT_REQUIRE_DB=1."
  echo
else
  echo "== [1/4] tsc --noEmit --skipLibCheck =="
  ./node_modules/.bin/tsc --noEmit --skipLibCheck
  echo "OK: typecheck groen."
  echo

  echo "== [2/4] app-laag §15-matrix (node:test): T1–T5, T8–T14 =="
  node --import tsx --test tests/cross-tenant/*.test.ts
  echo "OK: app-laag §15-matrix groen (incl. negatieve controles)."
  echo
fi

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

echo "-- T3 negatieve cross-tenant RLS (write-policies zonder WITH CHECK + append-only-triggers) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T3"
echo
echo "-- T4 retrieval-fondsdiscipline (zoek_chunks/_hybride: fondsgrens + published-only-generiek) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T4"
echo
echo "-- P3-B rol via service-role-pad (bevriezing-trigger vrij, rol-CHECK weigert ongeldig) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P3B"
echo
echo "-- Plateau B reflectieflow server-controlled (bronset/beurtteller/afronding niet client-stuurbaar) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_REFLECTIE"
echo
echo "-- T5 vergelijking (comparison_results RLS + schrijfpad-only via functie + tenant-guard) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T5VGL"
echo
echo "-- A rollen/capabilities + governance_log-schrijfpad (fonds en naam server-side) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_ROLCAP"
echo "-- T7 semantische laag (RLS op semantic_units + waardetypering + catalogus) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T7SEM"
echo
echo "-- T8 semantische extractie (gate H op de schrijffunctie + catalogus-hints) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T8SEM"
echo
echo "-- C-01 (vw_fondsleden cross-tenant + kolomafscherming + view-schrijfrechten) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_VWF"
echo
echo "-- Bewijsbinding (één-op-één, DB-validatie, atomische audit, snapshot) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_BBIND"
echo
echo "-- P2-indexpreflight (exacte sleutel + templateversie; geen same-step-vals-positief) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P2_INDEX_PREFLIGHT"
echo
echo "-- Vaststelling-binding (type/I5/cross-procedure, I1-slot, tenant-isolatie) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_VAST"
echo

echo "-- #214-a1 schrijfpoort (kolom-revoke bewaakt + gedragstoets: directe PATCH faalt, RPC werkt) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P214A1"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P214A1_HERSTEL"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P214A1G"
echo

echo "-- #214-a2 afwijkingskolommen (vier epic-kolommen fail-closed + RPC-recht) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P214A2"
echo

echo "-- Afronden met afwijking (snapshot-pin SQL-helft, eigen slot, atomaire kern) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P3C"
echo

echo "-- Besluitstatus-omslag (atomaire vastlegging, I2 DB-afgedwongen, eigen slot) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P3D"
echo

echo "-- P4 I5 (composite-FK weigert cross-fonds referentie) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P4I5"
echo

echo "-- P4 I1 (statusclaim zonder matrixfeit wordt geweigerd) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P4I1"
echo

echo "-- #228-familie (ongebonden besluit bestaat; alleen gebonden approval vervult) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P2C_ONGB"
echo

echo "-- P5c aantekeningen (statusneutraal, I5, auteur- en tenantgrens) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P5C_NOTITIE"
echo

echo "-- T2 voorbereidingen-product (eigen schrijfrecht, overschrijven, aantekeningen intact, privé) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T2VB"
echo

echo "-- Microsoft 365 F1 (private vaultrol, grants, secdef-path en fondsprofiel) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_M365F1"
echo

echo "-- P5d procedure beëindigen/heropenen (rolpoort, I2, snapshot en audit) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_P5D_BEEINDIGEN"
echo

echo "-- #212 SECURITY DEFINER zelfsloten (inventaris + auth/fonds/rol-gates) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_SECDEF_SELF"
echo

echo "-- V3 (grants-gate over alle objectklassen: relaties, functies, buckets, storage-policies) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_V3"
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
echo "  T3   negatieve cross-tenant RLS (WITH CHECK + append-only-dekking)     (DB-laag, V4)"
echo "  T4   retrieval-fondsdiscipline (fondsgrens + published-only-generiek)  (DB-laag, V4)"
echo "  P3-B rol via service-role-pad (bevriezing-trigger + rol-CHECK)         (DB-laag, V4)"
echo "  B    reflectieflow server-controlled (bronset/beurtteller/afronding)   (DB-laag, V4)"
echo "  T5   vergelijking comparison_results RLS + schrijfpad-only + guard      (DB-laag, V4)"
echo "  A    rollen/capabilities + governance_log: fonds én naam server-side      (DB-laag)"
echo "  T7   semantische laag: RLS op semantic_units + waardetypering            (DB-laag)"
echo "  T8   semantische extractie: gate H op de schrijffunctie + hints         (DB-laag)"
echo "  C-01 vw_-views: cross-tenant, kolomafscherming, geen I/U/D voor browserrol (DB-laag)"
echo "  V3   grants-gate: feitelijke rechten op alle relaties/functies == allowlist (DB-laag)"
echo "  BBIND bewijsbinding: één-op-één + DB-validatie/audit + snapshotdekking       (DB-laag)"
echo "  T2   voorbereiding-product: eigen schrijfrecht, overschrijven, notities intact (DB-laag)"
echo "============================================================================"
