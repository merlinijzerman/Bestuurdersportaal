#!/usr/bin/env bash
# Blokkeer herkenbare, hoog-risico secrets in door git gevolgde bestanden.
#
# Dit is bewust een smalle, deterministische CI-gate naast provider-side secret
# scanning: alleen patronen met voldoende entropie worden gemarkeerd, zodat
# documentatievoorbeelden zoals `sk-ant-...` geen vals alarm geven. De scan leest
# uitsluitend `git ls-files`; genegeerde lokale .env-bestanden vallen erbuiten.
set -euo pipefail
cd "$(dirname "$0")/.."

patroon='(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}|sk-(ant-|proj-)?[0-9A-Za-z_-]{20,}|sb_secret_[0-9A-Za-z_-]{20,}|eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)'

echo "Gevolgde bestanden controleren op bekende secretpatronen…"
treffers="$(git grep -nEI "$patroon" -- ':!package-lock.json' ':!*.map' || true)"

if [ -n "$treffers" ]; then
  echo "FAAL: mogelijk geheim aangetroffen in een gevolgd bestand:" >&2
  # Toon alleen bestand en regelnummer; nooit de gevonden geheime waarde.
  printf '%s\n' "$treffers" | cut -d: -f1-2 | sort -u >&2
  echo "Verwijder/roteer het geheim en controleer de gitgeschiedenis." >&2
  exit 1
fi

echo "OK: geen herkenbare committed secrets gevonden."
