# Security

## Secret handling

Never commit or paste any of the following into source code, chat, issues, pull requests, screenshots, or logs:

- LinkedIn Client Secret
- LinkedIn access or refresh tokens
- OAuth authorization codes or verification URLs
- GitHub tokens, SSH private keys, or local bearer keys
- A real `.env` file

The installer stores the LinkedIn Client Secret and access token in macOS Keychain under the `linkedin-gpt-connector` service. The Client ID is not a secret and is stored in the local ignored `.env`.

A process's arguments are readable by every other user on the machine for as long as it runs, so a secret passed as one is not private. The OAuth token exchange therefore runs in-process over HTTPS: the Client Secret travels in the request body or an `Authorization: Basic` header, and the authorization code in the request body. Keep any new provider call in-process for the same reason instead of shelling out to `curl`.

If a secret is ever exposed, rotate it at the provider. Removing it from the latest commit is not sufficient.

## Network boundary

The service must bind only to `127.0.0.1` or `::1`. Do not expose port 3190 directly to a LAN or the internet. If remote access is later required, add an authenticated gateway, TLS, rate limiting, and an independent security review.

Binding to loopback does not stop a web page open in a local browser from reaching the port: with DNS rebinding, the page re-resolves its own domain to 127.0.0.1 and its requests then arrive from a loopback socket. The service therefore also refuses every request, except `GET /health`, whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` (any port). Address the agent by one of those names, and keep the check in front of any route you add.

## Public writes

The API requires `confirmed: true` for every non-GET advanced request and for publishing posts or comments. A client should set it only after the user explicitly approves the exact content and target.

## Reporting

Do not open a public issue containing a vulnerability or credential. Use a private repository security advisory or contact the repository owner privately.
