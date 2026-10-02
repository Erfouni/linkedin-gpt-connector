#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
SERVICE="linkedin-gpt-connector"
ACCOUNT="linkedin-client-secret"

echo "LinkedIn GPT Connector authorization"
read -r -s "SECRET?New LinkedIn Client Secret (leave blank to keep the current Keychain value): "
echo
if [[ -n "$SECRET" ]]; then
  if [[ ! -f dist/keychain.js ]]; then
    echo "Run Install.command first." >&2
    exit 1
  fi
  # On stdin, like the installer: a `security -w` argument is visible to every
  # local user through `ps`. printf is a builtin, so no process gets it as one.
  printf '%s' "$SECRET" | node dist/keychain.js "$SERVICE" "$ACCOUNT"
fi
unset SECRET
/usr/bin/open "http://127.0.0.1:3190/oauth/start"
echo "Complete LinkedIn authorization in the opened browser."
