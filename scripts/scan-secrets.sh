#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

tracked_files="$(git ls-files)"
tracked_env="$(printf '%s\n' "$tracked_files" | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' || true)"
tracked_keys="$(printf '%s\n' "$tracked_files" | grep -Ei '\.(pem|key|p12|pfx|mobileprovision)$' || true)"
patterns='gh[pousr]_[A-Za-z0-9]{20,}|WPL_AP1\.[A-Za-z0-9._-]{20,}|AQ[A-Za-z0-9_-]{50,}|-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----'

set +e
content_matches="$(git grep -IlE "$patterns" -- . ':(exclude)package-lock.json')"
grep_status=$?
set -e

if [[ "$grep_status" -gt 1 ]]; then
  echo "Secret content scan failed with status $grep_status." >&2
  exit "$grep_status"
fi

if [[ -n "$tracked_env" || -n "$tracked_keys" || -n "$content_matches" ]]; then
  echo "Potential secret material detected in:"
  printf '%s\n' "$tracked_env" "$tracked_keys" "$content_matches" | sed '/^$/d' | sort -u
  exit 1
fi

echo "Secret scan passed."
