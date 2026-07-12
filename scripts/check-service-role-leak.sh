#!/usr/bin/env bash
# ============================================================================
#  Service-role-lek-check (Increment P0 — TO §12 test 2). DEFENSE-IN-DEPTH.
# ----------------------------------------------------------------------------
#  Statische guard die afdwingt dat de platform-service-role NOOIT in client- of
#  tenant-code lekt. Drie regels:
#   1. SUPABASE_SERVICE_ROLE_KEY mag alleen in de server-only service-role-laag
#      staan (platform/lib/* + core/lib/supabase-service.ts), nergens anders.
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
# Toegestane vindplaatsen (T9 fase 2): de volledige platform/lib-laag (service-
# role-client + platform-libs + aqlab-seed-CLI's) en de generieke service-client.
# core/lib/supabase-service.ts is BEWUST tijdelijk core (contact + tenant-domains
# gebruiken hem nog); D1 (RPC-migratie) verhuist hem naar platform/lib — scherp
# deze regel dan aan tot uitsluitend platform/lib/.*.
toegestaan_regex='^(platform/lib/.*\.ts|core/lib/supabase-service\.ts|scripts/.*)$'
while IFS= read -r bestand; do
  [ -z "$bestand" ] && continue
  if ! [[ "$bestand" =~ $toegestaan_regex ]]; then
    melding "SUPABASE_SERVICE_ROLE_KEY in onverwacht bestand: $bestand"
  fi
done < <(grep -rl --include='*.ts' --include='*.tsx' \
           --exclude-dir=node_modules --exclude-dir=.next \
           'SUPABASE_SERVICE_ROLE_KEY' . 2>/dev/null | sed 's|^\./||')

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
     -E "@/platform/lib/|@/core/lib/supabase-service" \
     'app/(dashboard)' 2>/dev/null; then
  melding "app/(dashboard) verwijst naar de platform-service-role-laag"
fi
# 3b. Geen enkel "use client"-bestand mag de platform-service-role-laag importeren.
# Alle server-only IO-modules (supabase-platform + platform-auth/-wrapper/-audit)
# trekken de service-role-client aan; geen ervan mag in een client-bundle landen.
while IFS= read -r bestand; do
  [ -z "$bestand" ] && continue
  if grep -qE "@/platform/lib/supabase-platform|@/core/lib/supabase-service|@/platform/lib/platform-(wrapper|audit|auth)" "$bestand"; then
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
