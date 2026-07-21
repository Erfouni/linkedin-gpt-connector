#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

tracked_env="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' || true)"
tracked_keys="$(git ls-files | grep -Ei '\.(pem|key|p12|pfx|mobileprovision)$' || true)"
patterns='gh[pousr]_[A-Za-z0-9]{20,}|WPL_AP1\.[A-Za-z0-9._-]{20,}|AQ[A-Za-z0-9_-]{50,}|-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----'
content_matches="$(git grep -IlE "$patterns" -- . ':(exclude)package-lock.json' || true)"

if [[ -n "$tracked_env" || -n "$tracked_keys" || -n "$content_matches" ]]; then
  echo "Potential secret material detected in:"
  printf '%s\n' "$tracked_env" "$tracked_keys" "$content_matches" | sed '/^$/d' | sort -u
  exit 1
fi

echo "Secret scan passed."
