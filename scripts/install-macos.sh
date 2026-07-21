#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.local.linkedin-gpt-connector.plist"
LOG_DIR="$HOME/Library/Logs/linkedin-gpt-connector"
KEYCHAIN_SERVICE="linkedin-gpt-connector"
ACCESS_ACCOUNT="linkedin-access-token"
SECRET_ACCOUNT="linkedin-client-secret"

cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer supports macOS only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "$node_major" -lt 22 ]]; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

read -r -p "LinkedIn Client ID: " client_id
if [[ -z "$client_id" ]]; then
  echo "Client ID cannot be empty." >&2
  exit 1
fi

read -r -s -p "LinkedIn Client Secret (stored only in Keychain; leave blank for PKCE-only apps): " client_secret
echo
if [[ -n "$client_secret" ]]; then
  /usr/bin/security add-generic-password -U     -s "$KEYCHAIN_SERVICE"     -a "$SECRET_ACCOUNT"     -w "$client_secret" >/dev/null
fi
unset client_secret

umask 077
{
  printf 'HOST=127.0.0.1\n'
  printf 'PORT=3190\n'
  printf 'LINKEDIN_VERSION=202606\n'
  printf 'LINKEDIN_CLIENT_ID=%s\n' "$client_id"
  printf 'LINKEDIN_KEYCHAIN_SERVICE=%s\n' "$KEYCHAIN_SERVICE"
  printf 'LINKEDIN_KEYCHAIN_ACCOUNT=%s\n' "$ACCESS_ACCOUNT"
  printf 'LINKEDIN_CLIENT_SECRET_KEYCHAIN_ACCOUNT=%s\n' "$SECRET_ACCOUNT"
  printf 'LINKEDIN_OAUTH_REDIRECT_URI=http://127.0.0.1:3190/oauth/callback\n'
  printf 'LINKEDIN_OAUTH_SCOPES=openid profile email w_member_social\n'
  printf 'LINKEDIN_USE_PKCE=false\n'
} > .env
chmod 600 .env
unset client_id

npm ci
npm run build

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
node_path="$(command -v node)"
sed   -e "s|__NODE_PATH__|$node_path|g"   -e "s|__ROOT_DIR__|$ROOT_DIR|g"   -e "s|__LOG_DIR__|$LOG_DIR|g"   deploy/com.local.linkedin-gpt-connector.plist.template > "$PLIST"

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.local.linkedin-gpt-connector"

sleep 3
curl -fsS http://127.0.0.1:3190/health
echo
/usr/bin/open "http://127.0.0.1:3190/oauth/start"
echo "LinkedIn GPT Connector installed. Complete OAuth in the opened browser."
