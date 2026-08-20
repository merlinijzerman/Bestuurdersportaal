#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

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
retry_delay_seconds="${B2_DOWNLOAD_RETRY_DELAY_SECONDS:-5}"

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
[[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] && [ "$retry_delay_seconds" -le 300 ] || {
  echo "B2-download geweigerd: ongeldige retrywachttijd." >&2
  exit 64
}
if [ -n "$expected_bytes" ]; then
  [[ "$expected_bytes" =~ ^[1-9][0-9]*$ ]] || { echo "B2-download geweigerd: ongeldige verwachte grootte." >&2; exit 64; }
fi
if [ -n "$expected_sha256" ]; then
  [[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "B2-download geweigerd: ongeldige verwachte checksum." >&2; exit 64; }
fi

partial_path="${destination}.partial"
error_path="${destination}.download-error"

classify_download_error() {
  local error_file="$1"

  if grep -Eiq \
    'unable to locate credentials|no credentials|invalidaccesskeyid|signaturedoesnotmatch|accessdenied|expiredtoken|invalidtoken|forbidden|\(403\)|status code: 403' \
    "$error_file"; then
    printf '%s' "auth_or_permission"
  elif grep -Eiq \
    'nosuchkey|no such key|does not exist|not found|nosuchbucket|\(404\)|status code: 404' \
    "$error_file"; then
    printf '%s' "object_missing"
  elif grep -Eiq \
    'permanentredirect|invalid endpoint|endpoint url must|parameter validation failed|invalid bucket name|unknown options|invalid choice|expected one argument' \
    "$error_file"; then
    printf '%s' "client_configuration"
  elif grep -Eiq \
    'could not connect to the endpoint url|connect timeout|read timeout|operation timed out|connection reset|connection (was )?closed|temporary failure|name or service not known|network is unreachable|ssl validation failed' \
    "$error_file"; then
    printf '%s' "transient_transport"
  elif grep -Eiq \
    'requesttimeout|request timeout|slowdown|throttl|too many requests|serviceunavailable|internalerror|internal server error|\(429\)|\(500\)|\(502\)|\(503\)|\(504\)|status code: (429|500|502|503|504)' \
    "$error_file"; then
    printf '%s' "transient_service"
  else
    printf '%s' "unknown"
  fi
}

is_retryable_category() {
  case "$1" in
    transient_transport|transient_service|integrity_size_mismatch|integrity_checksum_mismatch)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

cleanup_download_state() {
  rm -f -- "$partial_path" "$error_path"
}
trap cleanup_download_state EXIT

failure_category="unknown"
aws_exit=0
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  rm -f -- "$destination" "$partial_path" "$error_path"

  if aws s3 cp "$source_uri" "$partial_path" \
    --endpoint-url "$endpoint" --only-show-errors --no-progress \
    >/dev/null 2>"$error_path"; then
    actual_bytes="$(wc -c < "$partial_path" | tr -d '[:space:]')"
    if [ -n "$expected_bytes" ] && [ "$actual_bytes" != "$expected_bytes" ]; then
      failure_category="integrity_size_mismatch"
      aws_exit=0
    elif [ -n "$expected_sha256" ] && \
      [ "$(sha256sum "$partial_path" | awk '{print $1}')" != "$expected_sha256" ]; then
      failure_category="integrity_checksum_mismatch"
      aws_exit=0
    else
      mv -- "$partial_path" "$destination"
      rm -f -- "$error_path"
      exit 0
    fi
  else
    aws_exit=$?
    failure_category="$(classify_download_error "$error_path")"
  fi

  rm -f -- "$destination" "$partial_path" "$error_path"
  if ! is_retryable_category "$failure_category"; then
    echo "B2_DOWNLOAD_FAILED:$failure_category (aws_exit=$aws_exit); fout is niet retrybaar." >&2
    exit 1
  fi

  if [ "$attempt" -lt "$max_attempts" ]; then
    backoff_seconds=$((retry_delay_seconds * (2 ** (attempt - 1))))
    echo "B2_DOWNLOAD_RETRY:$failure_category; poging $attempt/$max_attempts, volgende poging over ${backoff_seconds}s." >&2
    sleep "$backoff_seconds"
  fi
done

echo "B2_DOWNLOAD_FAILED:$failure_category; limiet van $max_attempts gecontroleerde pogingen bereikt." >&2
exit 1
