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
#  De [OPS]-regels zijn informatief en beïnvloeden de exit niet. Ze kennen drie
#  standen — OPEN (nog te doen), DONE (gemeten dat het gedaan is) en "?" (niet
#  vast te stellen). Die derde stand is er sinds #97 en is de belangrijkste: hem
#  weglaten dwingt een meetbeperking in een van de andere twee, en dan klinkt
#  "ik kon het niet lezen" als "het is niet gedaan" of, erger, als "het is oké".
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
# Een OPS-regel die inmiddels MEETBAAR is. Blijft [OPS] en blijft buiten de
# exit-code — die scheiding is bewust (#97) — maar meldt niet langer "open"
# terwijl de handeling allang verricht is.
ops_done()  { printf '  [OPS ] \033[32mDONE\033[0m  %s\n' "$1"; }
# En de derde stand, die het gevaarlijkst is om weg te laten: we KONDEN het niet
# vaststellen. Dat is iets anders dan "niet gedaan", en het hoort niet als een
# van beide te worden gepresenteerd.
ops_onbekend() { printf '  [OPS ] \033[33m  ? \033[0m  %s\n' "$1"; }

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

# — host↔fonds-enforce, wrapper-bewust (EPIC W / W3, issue #94) ---------------
#  Een route dwingt host↔fonds op twee manieren af, en beide tellen:
#    (a) klassiek — de route roept zelf `beoordeelRouteHostToegang(` aan;
#    (b) na de codemod — `withFondsRoute({ … hostGuard: true … })`, waarbij de
#        wrapper de aanroep doet.
#  Zonder (b) valt dit script vals-rood zodra een hoogrisico-route migreert; zó
#  brak `zoeken` in W3, en omdat dit script NIET in CI draait bleef dat stil.
#  Zonder de verankering hieronder zou (b) juist vals-groen zijn: `hostGuard: true`
#  is alleen bewijs als de wrapper er feitelijk iets mee doet. Daarom eerst
#  `check_wrapper_fundament` — precies zoals `toetsWrapperFundament()` dat doet
#  voor de statische guards in tests/cross-tenant/.
WRAPPER="core/lib/route-wrapper.ts"

check_wrapper_fundament() {
  local reden="" plat=""
  [ -f "$WRAPPER" ] || reden="$WRAPPER ontbreekt"
  if [ -z "$reden" ]; then
    # Op ADJACENTIE toetsen, niet op losse woorden: `spec.hostGuard` staat ook in
    # de toelichtende commentaarkop van de wrapper, en een commentaar is geen
    # handhaving. De TS-variant (toetsWrapperFundament) doet hetzelfde met een
    # regex over meerdere regels; hier plat de bron eerst tot één regel.
    # Twee valkuilen, allebei door de negatieve controle gevonden:
    #  • herestring, GEEN pipe — dit script draait met `set -o pipefail`, en
    #    `grep -q` sluit de pipe bij de eerste match → SIGPIPE op de schrijver →
    #    de hele pipeline telt als mislukt (vals-rood);
    #  • herhalingsteller ≤255 — BSD grep (macOS) weigert `.{0,300}` met
    #    "invalid repetition count(s)"; GNU grep (CI) accepteert het wél. Een
    #    ruimere marge zou dus lokaal rood en in CI groen zijn. 200 is ruim: de
    #    feitelijke afstanden zijn ~60 resp. ~130 tekens.
    #  • W4: de tak toetst sinds `hostGuard: "route-eigen"` op `=== true` i.p.v.
    #    op truthy. Het patroon stond op de letterlijke vorm `spec.hostGuard)` en
    #    viel dáárdoor rood — een terechte melding van een check die aan een
    #    schrijfwijze hing. Nu op de VERGELIJKING zelf, met beide vormen
    #    toegestaan, zodat hij de handhaving toetst en niet de spelling.
    plat=$(tr '\n' ' ' < "$WRAPPER")
    grep -Eq 'spec\.hostGuard( *=== *true)? *\).{0,200}beoordeelRouteHostToegang\(' <<<"$plat" \
      || reden="de spec.hostGuard-tak roept beoordeelRouteHostToegang niet aan"
    grep -Eq '!oordeel\.toegestaan.{0,200}status: *403' <<<"$plat" \
      || reden="een afgewezen host-oordeel leidt niet tot 403"
  fi
  if [ -z "$reden" ]; then
    repo_pass "A1 wrapper-fundament: withFondsRoute-hostGuard dwingt host↔fonds echt af"
  else
    repo_fail "A1 wrapper-fundament — $reden (dan is 'hostGuard: true' in een route geen bewijs)"
  fi
}

check_hostguard() {
  local omschrijving="$1" bestand="$2"
  if [ ! -f "$bestand" ]; then repo_fail "$omschrijving — $bestand ontbreekt"; return; fi
  if grep -q "beoordeelRouteHostToegang(" "$bestand"; then
    repo_pass "$omschrijving"; return
  fi
  # Alleen de ECHTE wrapper telt; een gelijknamige lokale functie niet.
  if grep -q 'from "@/core/lib/route-wrapper"' "$bestand" \
     && grep -Eq 'withFondsRoute\(\{[^}]*hostGuard: *true' "$bestand"; then
    repo_pass "$omschrijving (via withFondsRoute hostGuard: true)"; return
  fi
  repo_fail "$omschrijving — geen beoordeelRouteHostToegang( en geen withFondsRoute({ hostGuard: true }) in $bestand"
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
check_wrapper_fundament
for r in \
  "app/api/chat/route.ts" \
  "app/api/zoeken/route.ts" \
  "app/api/documents/upload/route.ts" \
  "app/api/documents/[id]/bestand/route.ts" \
  "app/api/decisions/[id]/auditdossier/route.ts"; do
  check_hostguard "A1 hoogrisico-route host-enforce: $r" "$r"
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
# B9 — branch protection. Dit was een HARDGECODEERDE ops_open-regel: hij meldde
# onvoorwaardelijk "nog aanzetten", ook nadat het was aangezet. Een aftekenregel
# die permanent rood staat wordt genegeerd — dat is de spiegelbeeldvariant van
# het probleem in #97 (een check die nergens draait, dus geen signaal geeft).
# Nu wordt het gemeten. Drie standen, want "kon het niet vaststellen" is iets
# anders dan "niet gedaan": zonder admin-token (o.a. de standaard GITHUB_TOKEN
# in Actions) is dit endpoint niet leesbaar, en dan zegt deze regel dat ook.
check_branch_protection() {
  # De drie uit de V4-acceptatiecriteria (#81), PLUS deze job zelf.
  #
  # Die laatste is geen netheid maar de sluiting van precies het gat waar dit
  # hele spoor over ging: `G2-aftekening (repo-side)` is sinds #97 een required
  # check, en zonder deze regel kan iemand hem morgen uit de branch protection
  # halen terwijl dit script vrolijk DONE blijft melden. Dan draait de job nog
  # wel, maar houdt hij niets meer tegen — en niemand merkt het.
  #
  # Een controle die zijn eigen afdwingbaarheid niet toetst, meet alleen zichzelf.
  local vereist=(
    "Cross-tenant isolatie (§15 T1-T14)"
    "Security baseline (Sprint 1)"
    "Code-scheiding (T9 core/platform-grens)"
    "G2-aftekening (repo-side)"
  )
  if ! command -v gh >/dev/null 2>&1; then
    ops_onbekend "B9 branch protection — niet vast te stellen: geen gh CLI beschikbaar"
    return
  fi
  local json fout
  if ! json="$(gh api repos/{owner}/{repo}/branches/main/protection 2>/tmp/g2_bp_err)"; then
    fout="$(cat /tmp/g2_bp_err 2>/dev/null)"; rm -f /tmp/g2_bp_err
    # 404 en 403 betekenen HET TEGENOVERGESTELDE van elkaar en mogen nooit op
    # dezelfde regel uitkomen: "er staat geen enkele protection op main" is een
    # BEVINDING, "ik mag het niet lezen" is een meetbeperking. Ze samenvouwen tot
    # "niet vast te stellen" laat de ernstigste stand geruststellend klinken.
    # Toets op de HTTP-STATUS en niet op de foutzin: die zin is Engels, wisselt
    # per geval ("Branch not protected" vs "Branch not found") en verschilt in
    # hoofdletters van wat je verwacht — de eerste versie van deze case matchte
    # daardoor niets en viel stilzwijgend in de "onbekend"-tak.
    case "$fout" in
      *"HTTP 404"*)
        case "$fout" in
          *"not protected"*) ops_open "B9 branch protection — er staat GEEN branch protection op main" ;;
          *)                 ops_open "B9 branch protection — branch 'main' niet gevonden op dit endpoint (naam of repo verkeerd?)" ;;
        esac ;;
      *"HTTP 403"*|*"HTTP 401"*)
        ops_onbekend "B9 branch protection — niet vast te stellen: geen leesrecht (admin-token vereist; de standaard GITHUB_TOKEN in Actions heeft dit niet)" ;;
      *)
        ops_onbekend "B9 branch protection — niet vast te stellen: onverwachte fout van het protection-endpoint" ;;
    esac
    return
  fi
  rm -f /tmp/g2_bp_err
  local contexts admins ontbreekt=""
  contexts="$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(d.get("required_status_checks",{}).get("contexts",[])))' 2>/dev/null || true)"
  admins="$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(str(d.get("enforce_admins",{}).get("enabled",False)).lower())' 2>/dev/null || echo false)"
  local v
  for v in "${vereist[@]}"; do
    printf '%s\n' "$contexts" | grep -Fxq "$v" || ontbreekt="$ontbreekt\n      - $v"
  done
  if [ -n "$ontbreekt" ]; then
    # shellcheck disable=SC2059
    printf "  [OPS ] \033[33mOPEN\033[0m  B9 branch protection — required checks ONTBREKEN:$ontbreekt\n"
    return
  fi
  if [ "$admins" != "true" ]; then
    ops_open "B9 branch protection — required checks staan aan, maar enforce_admins is UIT (een admin kan er langs)"
    return
  fi
  ops_done "B9 branch protection — ${#vereist[@]}/${#vereist[@]} required checks aanwezig, enforce_admins aan"
}
check_branch_protection

# B9b — nachtelijke driftdetectie op Productie (#65). Landde met de cron BEWUST
# uit: zonder de drie inrichtingsstappen faalt de nachtrun elke nacht, en volgens
# besluit 0185 is een rode nachtrun het alertkanaal. Een controle die elke nacht
# rood is, leert je die notificatie negeren.
#
# DONE BETEKENT HIER: ER IS EEN GESLAAGDE SCHEDULED RUN GEWEEST.
# De eerste versie van deze regel keek of er een `schedule:` in de workflow stond.
# Dat is GECONFIGUREERD, niet WERKEND — hetzelfde onderscheid als branch
# protection die bestaat versus blokkeert, en als een suite die geregistreerd is
# versus draait. Precies het verschil dat dit hele cluster steeds opnieuw
# blootlegde. Een aftekening hoort een WAARNEMING te zijn, geen bewering, dus
# vraagt deze regel de runhistorie op.
#
# Vier standen, en de vierde is er omdat "ik kon het niet vaststellen" geen van
# de andere drie mag worden.
check_drift_inrichting() {
  local wf=".github/workflows/drift-productie.yml"
  local eigenaar="technisch beheer (merlinijzerman)"
  local sinds="2026-08-21"
  local nu start dagen
  nu="$(date +%s)"
  start="$(date -j -f '%Y-%m-%d' "$sinds" +%s 2>/dev/null || date -d "$sinds" +%s 2>/dev/null || echo "")"
  if [ -n "$start" ]; then dagen="$(( (nu - start) / 86400 )) dagen"; else dagen="? dagen"; fi

  if [ ! -f "$wf" ]; then
    ops_onbekend "B9b driftdetectie — workflow $wf ontbreekt; niet vast te stellen"
    return
  fi
  if ! command -v gh >/dev/null 2>&1; then
    ops_onbekend "B9b driftdetectie — niet vast te stellen: geen gh CLI om de runhistorie te lezen"
    return
  fi

  local laatste
  if ! laatste="$(gh run list --workflow drift-productie.yml --event schedule \
                    --status success --limit 1 --json createdAt \
                    --jq '.[0].createdAt // empty' 2>/dev/null)"; then
    ops_onbekend "B9b driftdetectie — niet vast te stellen: runhistorie niet leesbaar (actions:read vereist)"
    return
  fi

  if [ -n "$laatste" ]; then
    ops_done "B9b driftdetectie Productie — geslaagde nachtrun waargenomen (${laatste%T*})"
    return
  fi

  # Geen geslaagde nachtrun. Onderscheid of de cron überhaupt aanstaat: dat
  # scheelt de lezer een zoektocht.
  if grep -qE '^[[:space:]]+- cron:' "$wf"; then
    ops_open "B9b driftdetectie Productie — cron staat AAN maar er is nog geen geslaagde nachtrun (open sinds ${sinds}, ${dagen}) — eigenaar: ${eigenaar}"
  else
    ops_open "B9b driftdetectie Productie — cron UIT, inrichting open sinds ${sinds} (${dagen}) — eigenaar: ${eigenaar}; zie DRIFT_INRICHTING_OPEN in $wf"
  fi
}
check_drift_inrichting

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
echo " [OPS]-regels tellen niet mee in de exit-code: OPEN = nog te doen,"
echo " DONE = gemeten dat het gedaan is, ? = niet vast te stellen (geen recht/tool)."
echo " zie de canonieke checklist voor de aftekening (G2-GO-NO-GO-CONTROLEKADER.md)."
echo "============================================================================"

[ "$rood" -eq 0 ]
