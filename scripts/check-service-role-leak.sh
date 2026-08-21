#!/usr/bin/env bash
# ============================================================================
#  Service-role-lek-check (Increment P0 — TO §12 test 2). DEFENSE-IN-DEPTH.
# ----------------------------------------------------------------------------
#  Statische guard die afdwingt dat de platform-service-role NOOIT in client- of
#  tenant-code lekt. Drie regels:
#   1. SUPABASE_SERVICE_ROLE_KEY mag alleen in de server-only service-role-laag
#      staan (platform/lib/*), nergens anders.
#   2. platform/lib/supabase-platform.ts (de enige service-role-client) MOET met
#      `import "server-only"` beginnen.
#   3. De tenant-surface app/(dashboard)/ en elk "use client"-bestand mogen NIET
#      naar de platform-service-role-laag verwijzen.
#
#  Draai vanuit mvp/:  bash scripts/check-service-role-leak.sh
#  Exit 0 = schoon; exit 1 = lek gevonden (faal de CI / commit).
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

fouten=0
melding() { echo "  LEK: $1"; fouten=$((fouten + 1)); }

echo "[1/3] SUPABASE_SERVICE_ROLE_KEY alleen in de server-only platform-laag…"
# Toegestane vindplaatsen: de volledige server-only platform/lib-laag (service-
# role-clients + platform-libs + aqlab-seed-CLI's). Sinds D1/D1b heeft de gedeelde
# (app/publiek) surface GEEN service-role meer (host-resolutie + contact + assurance
# lopen via anon + SECURITY DEFINER-RPC's); supabase-service.ts is naar platform/lib
# verhuisd — dus uitsluitend platform/lib/.* + scripts/.
#
# Zoek bewust naar een UITVOERBARE process.env-toegang, niet naar de losse naam.
# De oude tekstzoeker markeerde ook documentatiecomments en negatieve tests als
# geheimlek. Dat maakte de gate rood zonder dat de sleutel ooit werd ingelezen.
# tests/karakterisering/* is server-only testinfra (Node-scripts, alleen CI/lokaal,
# nooit gebundeld). Het karakteriseringsharnas (W1, issue #88) seedt de wegwerp-
# test-DB via de service-role (admin.createUser/updateUserById/storage.upload) —
# dat is inherent aan het harnas. De ECHTE grens (geen service-role in een
# client-bundle) blijft volledig geborgd door [3/3] + de buildoutput-sleutelcheck.
toegestaan_regex='^(platform/lib/.*\.(ts|tsx|js|mjs)|scripts/.*|tests/karakterisering/.*\.mjs)$'

# FAIL-CLOSED (WP5-5b). Deze stap stond met `rg … || true` in de pijplijn: op een
# runner zonder ripgrep gaf hij nul treffers én exit 0, en meldde de gate dus
# "schoon" terwijl er niets was doorzocht. Een securitygate die groen wordt van
# een ontbrekende tool is erger dan geen gate. Daarom nu: rg als het kan, anders
# een gelijkwaardige grep-terugval, en als beide ontbreken een harde fout.
zoek_service_role_env() {
  local patroon='process\.env(\.SUPABASE_SERVICE_ROLE_KEY|\[[^]]*SUPABASE_SERVICE_ROLE_KEY)'
  local rc
  if command -v rg >/dev/null 2>&1; then
    rg -l \
      --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.mjs' \
      --glob '!node_modules/**' --glob '!.next/**' --glob '!_to_delete/**' \
      "$patroon" . 2>/dev/null | sed 's|^\./||'
    rc=${PIPESTATUS[0]}
  else
    echo "  (ripgrep ontbreekt — terugval op grep)" >&2
    grep -rlE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
      --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=_to_delete \
      "$patroon" . 2>/dev/null | sed 's|^\./||'
    rc=${PIPESTATUS[0]}
  fi
  # 0 = treffers, 1 = geen treffers (beide geldig). Alles daarboven is een
  # gereedschapsfout en mag NOOIT als "schoon" doorgaan.
  if [ "$rc" -gt 1 ]; then
    echo "  GEREEDSCHAPSFOUT: zoekopdracht faalde met exitcode $rc — scan niet uitgevoerd." >&2
    return 2
  fi
  return 0
}

treffers="$(zoek_service_role_env)" || {
  melding "stap [1/3] kon niet worden uitgevoerd (zie gereedschapsfout hierboven)"
  treffers=""
}
while IFS= read -r bestand; do
  [ -z "$bestand" ] && continue
  if ! [[ "$bestand" =~ $toegestaan_regex ]]; then
    melding "SUPABASE_SERVICE_ROLE_KEY in onverwacht bestand: $bestand"
  fi
done <<< "$treffers"

# Positieve controle (sentinel) op de bronscan zelf: de service-role-laag MOET
# gevonden worden. Levert de zoekopdracht nul bestanden op, dan is niet bewezen
# dat er schoon is — dan is bewezen dat er niet is gezocht.
if ! printf '%s\n' "$treffers" | grep -qE '^platform/lib/'; then
  melding "sentinel mist: geen enkel platform/lib-bestand leest SUPABASE_SERVICE_ROLE_KEY — de scan doorzocht kennelijk niets"
fi

echo "[2/3] platform/lib/supabase-platform.ts begint met import \"server-only\"…"
if [ -f platform/lib/supabase-platform.ts ]; then
  # De eerste import-statement (commentaarkop genegeerd) MOET server-only zijn.
  eerste_import="$(grep -m1 -E '^\s*import ' platform/lib/supabase-platform.ts || true)"
  if ! echo "$eerste_import" | grep -q 'import "server-only";'; then
    melding "platform/lib/supabase-platform.ts: eerste import is niet 'import \"server-only\";' (was: ${eerste_import:-<geen>})"
  fi
else
  melding "platform/lib/supabase-platform.ts ontbreekt"
fi

echo "[3/3] Tenant-surface en client-componenten verwijzen niet naar de platform-service-role…"
# 3a. (dashboard)-tenant-surface mag de platform-laag niet importeren.
if grep -rn --include='*.ts' --include='*.tsx' \
     -E "@/platform/lib/" \
     'app/(dashboard)' 2>/dev/null; then
  melding "app/(dashboard) verwijst naar de platform-service-role-laag"
fi
# 3b. Geen enkel "use client"-bestand mag de platform-service-role-laag importeren.
# Alle server-only IO-modules (supabase-platform + platform-auth/-wrapper/-audit)
# trekken de service-role-client aan; geen ervan mag in een client-bundle landen.
while IFS= read -r bestand; do
  [ -z "$bestand" ] && continue
  if grep -qE "@/platform/lib/supabase-platform|@/platform/lib/supabase-service|@/platform/lib/platform-(wrapper|audit|auth)" "$bestand"; then
    melding "client-component importeert platform-service-role-laag: $bestand"
  fi
done < <(grep -rl --include='*.ts' --include='*.tsx' \
           --exclude-dir=node_modules --exclude-dir=.next \
           '"use client"' . 2>/dev/null | sed 's|^\./||')

echo
if [ "$fouten" -eq 0 ]; then
  echo "OK: geen service-role-lek gevonden (test 2 groen)."
  exit 0
else
  echo "FAAL: $fouten lek(ken) gevonden — service-role mag niet in client/tenant-code."
  exit 1
fi
