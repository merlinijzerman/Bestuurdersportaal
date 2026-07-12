#!/usr/bin/env bash
# ============================================================================
#  G2 go/no-go — evidence-consolidatie per §18-criterium (increment T7, 0049).
# ----------------------------------------------------------------------------
#  Doel: de go/no-go-review (gate G2, aansluiting fonds 2/PGB) een MECHANISCHE
#  controle maken voor het repo-deel. Dit script haalt/bevestigt per toetsbaar
#  §18-criterium (A1–A8) + de aanvullend-blokkerende B9/B10 de bewijsreferentie
#  die IN DE REPO/CI leeft: suite groen, migraties aanwezig, resolver op de
#  hoogrisico-entrypoints, guards groen, gate-besluit vastgelegd.
#
#  HARDE SCHEIDING (geen schijnzekerheid — huispatroon CLAUDE.md):
#   [REPO ]  mechanisch verifieerbaar hier/CI → dit script bepaalt PASS/FAIL.
#   [OPS  ]  vereist een LIVE-handeling of MENSBESLUIT (migratie op live,
#            TENANT_ENFORCE=on op live, seeds, demo/prod-scheiding, branch
#            protection aanzetten, de aftekening zelf). Dit script claimt hier
#            NOOIT groen — het toont enkel de openstaande bewijseis + eigenaar.
#
#  Exit-code: 0 als ALLE [REPO]-checks slagen (het mechanische deel is rond).
#  De [OPS]-regels zijn informatief (verwacht-open) en beïnvloeden de exit niet.
#
#  Canonieke aftekening blijft de checklist:
#    ../02 Architectuur/Bestuurdersportaal - T7 G2 go-no-go checklist v0.1.md
#  Repo-side leidraad: G2-GO-NO-GO-CONTROLEKADER.md (repo-root).
#
#  Gebruik:
#    bash scripts/g2-evidence.sh            # repo-checks (snel, geen DB)
#    bash scripts/g2-evidence.sh --suite    # + volledige cross-tenant-ci.sh
#                                           #   (vereist TEST_DATABASE_URL / DB)
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

RUN_SUITE=0
[ "${1:-}" = "--suite" ] && RUN_SUITE=1

groen=0
rood=0

# — helpers ------------------------------------------------------------------
repo_pass() { printf '  [REPO] \033[32mPASS\033[0m  %s\n' "$1"; groen=$((groen+1)); }
repo_fail() { printf '  [REPO] \033[31mFAIL\033[0m  %s\n' "$1"; rood=$((rood+1)); }
ops_open()  { printf '  [OPS ] \033[33mOPEN\033[0m  %s\n' "$1"; }

# Faalt als één van de opgegeven paden ontbreekt.
check_files() {
  local omschrijving="$1"; shift
  local ontbreekt=""
  for f in "$@"; do [ -e "$f" ] || ontbreekt="$ontbreekt $f"; done
  if [ -z "$ontbreekt" ]; then repo_pass "$omschrijving"; else repo_fail "$omschrijving — ontbreekt:$ontbreekt"; fi
}

# Faalt als het patroon niet in het bestand voorkomt.
check_grep() {
  local omschrijving="$1" patroon="$2" bestand="$3"
  if [ -f "$bestand" ] && grep -q "$patroon" "$bestand"; then repo_pass "$omschrijving";
  else repo_fail "$omschrijving — '$patroon' niet in $bestand"; fi
}

echo "============================================================================"
echo " G2 go/no-go — evidence-consolidatie (repo-side)   $(date +%Y-%m-%d)"
echo "============================================================================"

echo
echo "A. P0-criteria (§18)"
echo "----------------------------------------------------------------------------"

# A1 — Tenant-resolver (T1) op de entrypoints + fail-closed enforce-schakelaar.
check_files "A1 resolver/enforce-modules aanwezig" \
  core/lib/tenant-host.ts core/lib/tenant-context.ts core/lib/tenant-enforce.ts core/lib/tenant-route-guard.ts
check_grep  "A1 pagina-chokepoint (dashboard-layout) achter enforce" \
  "beoordeelToegang" "app/(dashboard)/layout.tsx"
for r in \
  "app/api/chat/route.ts" \
  "app/api/zoeken/route.ts" \
  "app/api/documents/upload/route.ts" \
  "app/api/documents/[id]/bestand/route.ts" \
  "app/api/decisions/[id]/auditdossier/route.ts"; do
  check_grep "A1 hoogrisico-route host-enforce: $r" "beoordeelRouteHostToegang" "$r"
done
ops_open "A1 TENANT_ENFORCE=on op PRODUCTIE + seeds gedraaid — ops (lockout-risico, mens beslist ná observatievenster)"

# A2 — R1 fonds-toewijzing deterministisch.
check_files "A2 R1 deterministische maak_profiel-check aanwezig" \
  supabase/checks/2026_07_08_maak_profiel_deterministisch.sql

# A3 — R2 auditfonds server-side afgeleid + regressie-guard.
check_files "A3 R2 auditfonds-guard + sanity aanwezig" \
  core/lib/audit-fonds-guard.ts core/lib/audit-fonds.sanity.ts

# A4 — RLS-hardening (T3): migraties + controlekader.
check_files "A4 T3 RLS-hardening-migraties aanwezig" \
  supabase/migrations/2026_07_08_t3_rls_with_check.sql \
  supabase/migrations/2026_07_08_t3_append_only_logs.sql \
  supabase/migrations/2026_07_08_t3_globale_tabellen_register.sql \
  T3-RLS-CONTROLEKADER.md

# A5 — RAG-tenantdiscipline (T4): migratie in de repo.
check_files "A5 T4 retrieval-fondsfilter-migratie aanwezig" \
  supabase/migrations/2026_07_08_t4_retrieval_fondsfilter.sql
ops_open "A5 T4-migratie DRAAIEN op live Supabase vóór deploy — ops (migratie-first)"

# A6 — Dataclassificatie generic/fund_specific operationeel (as-built 'bibliotheek').
check_grep "A6 bibliotheek-namespace as-built in retrieval" "bibliotheek" "core/lib/rag.ts"

# A7 — Demo/productie-scheiding (B6). Bewust buiten T7-scope (apart ticket).
ops_open "A7 demo/productie-scheiding NIET aangetoond — apart increment (grootste gat); mensbesluit/ops"

# A8 — R3-gate geformaliseerd.
check_files "A8 gate-besluit 0049 vastgelegd" decisions/0049-t7-g2-go-no-go-gate.md

echo
echo "B. Aanvullend blokkerend (besluit 0049)"
echo "----------------------------------------------------------------------------"

# B9 — cross-tenant suite blokkerend.
check_files "B9 workflow + orkestratie aanwezig" \
  .github/workflows/rls-cross-tenant.yml scripts/cross-tenant-ci.sh
check_grep  "B9 CI: ontbrekende DB → rood (geen stille skip)" "XTENANT_REQUIRE_DB" ".github/workflows/rls-cross-tenant.yml"
check_grep  "B9 gepinde required-status-check-naam" "Cross-tenant isolatie" ".github/workflows/rls-cross-tenant.yml"
ops_open "B9 branch protection 'required status check' AANZETTEN op main — repo-admin-handeling"

# B10 — T6 gedeelde contentlaag opgeleverd.
check_files "B10 T6 beheerkenmerken-migratie + read-only-check aanwezig" \
  supabase/migrations/2026_07_09_t6_generiek_beheerkenmerken.sql \
  supabase/checks/2026_07_09_t6_generiek_readonly.sql

echo
echo "Groene draad — mechanische verificatie draaien"
echo "----------------------------------------------------------------------------"

# tsc (CLAUDE.md-gate).
if ./node_modules/.bin/tsc --noEmit --skipLibCheck >/tmp/g2_tsc.log 2>&1; then
  repo_pass "tsc --noEmit --skipLibCheck exit 0"
else
  repo_fail "tsc — zie /tmp/g2_tsc.log"; fi

# App-laag §15-matrix (node:test) — snel, geen DB.
if npm run --silent test:xtenant >/tmp/g2_xtenant.log 2>&1; then
  repo_pass "app-laag §15-matrix (T1-T14) groen"
else
  repo_fail "app-laag §15-matrix — zie /tmp/g2_xtenant.log"; fi

# Pure guards.
if npm run --silent sanity >/tmp/g2_sanity.log 2>&1; then
  repo_pass "core/lib + platform/lib *.sanity.ts guards groen"
else
  repo_fail "sanity-guards — zie /tmp/g2_sanity.log"; fi

if [ "$RUN_SUITE" = "1" ]; then
  echo
  echo "Volledige cross-tenant suite (app-laag + DB-laag) — vereist test-DB"
  echo "----------------------------------------------------------------------------"
  if bash scripts/cross-tenant-ci.sh; then
    repo_pass "volledige §15 cross-tenant suite groen (incl. DB-laag)"
  else
    repo_fail "volledige cross-tenant suite ROOD"; fi
fi

echo
echo "============================================================================"
echo " Repo-side (mechanisch):  $groen groen, $rood rood."
echo " [OPS]-regels zijn verwacht-open en wachten op mensbesluit/ops-handeling —"
echo " zie de canonieke checklist voor de aftekening (G2-GO-NO-GO-CONTROLEKADER.md)."
echo "============================================================================"

[ "$rood" -eq 0 ]
