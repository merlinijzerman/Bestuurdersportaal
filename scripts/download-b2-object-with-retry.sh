#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -lt 3 ] || [ "$#" -gt 5 ]; then
  echo "Gebruik: download-b2-object-with-retry.sh <s3-uri> <doelpad> <endpoint> [verwachte-bytes] [verwachte-sha256]" >&2
  exit 64
fi

source_uri="$1"
destination="$2"
endpoint="$3"
expected_bytes="${4:-}"
expected_sha256="${5:-}"
download_root="${MANAGED_RESTORE_ROOT:?MANAGED_RESTORE_ROOT ontbreekt}"
max_attempts="${B2_DOWNLOAD_MAX_ATTEMPTS:-3}"
retry_delay_seconds="${B2_DOWNLOAD_RETRY_DELAY_SECONDS:-2}"

[[ "$source_uri" == s3://* ]] || { echo "B2-download geweigerd: ongeldige bron." >&2; exit 64; }
[[ "$download_root" == /* && "$destination" == "$download_root"/* ]] || {
  echo "B2-download geweigerd: doel ligt niet binnen versleutelde runneropslag." >&2
  exit 64
}
[[ "$destination" != *"/../"* && "$destination" != *"/./"* ]] || {
  echo "B2-download geweigerd: niet-genormaliseerd doelpad." >&2
  exit 64
}
[[ "$max_attempts" =~ ^[1-5]$ ]] || { echo "B2-download geweigerd: ongeldige retrylimiet." >&2; exit 64; }
[[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] || { echo "B2-download geweigerd: ongeldige retrywachttijd." >&2; exit 64; }
if [ -n "$expected_bytes" ]; then
  [[ "$expected_bytes" =~ ^[1-9][0-9]*$ ]] || { echo "B2-download geweigerd: ongeldige verwachte grootte." >&2; exit 64; }
fi
if [ -n "$expected_sha256" ]; then
  [[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "B2-download geweigerd: ongeldige verwachte checksum." >&2; exit 64; }
fi

partial_path="${destination}.partial"
error_path="${destination}.download-error"
cleanup_download_state() {
  rm -f -- "$partial_path" "$error_path"
}
trap cleanup_download_state EXIT

last_error=""
last_error_category="unknown"
summarize_download_error() {
  if grep -qiE 'AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|ExpiredToken' "$error_path"; then
    last_error_category="credentials-or-permissions"
  elif grep -qiE 'NoSuchBucket|NoSuchKey|NotFound' "$error_path"; then
    last_error_category="object-not-found"
  elif grep -qiE 'Could not connect|timed out|timeout|Connection' "$error_path"; then
    last_error_category="network-or-timeout"
  elif grep -qiE 'PermanentRedirect|endpoint' "$error_path"; then
    last_error_category="endpoint"
  else
    last_error_category="provider-error"
  fi
  last_error="$(tr '\\n' ' ' < "$error_path" 2>/dev/null \
    | sed -E \
        -e 's#s3://[^[:space:]]+#s3://[REDACTED_OBJECT]#g' \
        -e 's#https?://[^[:space:]]+#https://[REDACTED_ENDPOINT]#g' \
        -e 's/(AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AWS_SESSION_TOKEN)([=:])[[:space:]]*[^[:space:]]+/\\1\\2[REDACTED]/g' \
    | cut -c1-600 || true)"
}

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  rm -f -- "$destination" "$partial_path" "$error_path"

  if aws s3 cp "$source_uri" "$partial_path" \
    --endpoint-url "$endpoint" --only-show-errors --no-progress \
    >/dev/null 2>"$error_path"; then
    valid=true
    actual_bytes="$(wc -c < "$partial_path" | tr -d '[:space:]')"
    if [ -n "$expected_bytes" ] && [ "$actual_bytes" != "$expected_bytes" ]; then
      valid=false
    fi
    if [ -n "$expected_sha256" ] && \
      [ "$(sha256sum "$partial_path" | awk '{print $1}')" != "$expected_sha256" ]; then
      valid=false
    fi
    if [ "$valid" = true ]; then
      mv -- "$partial_path" "$destination"
      rm -f -- "$error_path"
      exit 0
    else
      last_error_category="integrity"
      last_error="Downloaded object failed the configured byte or SHA-256 validation."
    fi
  else
    summarize_download_error
  fi

  rm -f -- "$destination" "$partial_path" "$error_path"
  if [ "$attempt" -lt "$max_attempts" ]; then
    echo "B2-downloadpoging $attempt/$max_attempts mislukt; gecontroleerde retry volgt." >&2
    sleep "$retry_delay_seconds"
  fi
done

echo "B2-download definitief mislukt na $max_attempts gecontroleerde pogingen." >&2
echo "B2-foutcategorie: $last_error_category" >&2
if [ -n "$last_error" ]; then
  echo "B2-foutdetail: $last_error" >&2
else
  echo "B2-foutdetail: geen providerfout beschikbaar." >&2
fi
exit 1
