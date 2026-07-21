#!/bin/zsh
set -e
cd "$(dirname "$0")"
chmod +x scripts/*.sh Authorize.command
./scripts/install-macos.sh
echo
echo "Installation finished. Complete LinkedIn authorization in the browser."
read -k 1 "?Press any key to close..."
echo
