#!/bin/zsh
set -euo pipefail
SERVICE="linkedin-gpt-connector"
ACCOUNT="linkedin-client-secret"

echo "LinkedIn GPT Connector authorization"
read -r -s "SECRET?New LinkedIn Client Secret (leave blank to keep the current Keychain value): "
echo
if [[ -n "$SECRET" ]]; then
  /usr/bin/security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w "$SECRET" >/dev/null
fi
unset SECRET
/usr/bin/open "http://127.0.0.1:3190/oauth/start"
echo "Complete LinkedIn authorization in the opened browser."
