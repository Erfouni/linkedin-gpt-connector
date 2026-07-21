# Security

## Secret handling

Never commit or paste any of the following into source code, chat, issues, pull requests, screenshots, or logs:

- LinkedIn Client Secret
- LinkedIn access or refresh tokens
- OAuth authorization codes or verification URLs
- GitHub tokens, SSH private keys, or local bearer keys
- A real `.env` file

The installer stores the LinkedIn Client Secret and access token in macOS Keychain under the `linkedin-gpt-connector` service. The Client ID is not a secret and is stored in the local ignored `.env`.

If a secret is ever exposed, rotate it at the provider. Removing it from the latest commit is not sufficient.

## Network boundary

The service must bind only to `127.0.0.1` or `::1`. Do not expose port 3190 directly to a LAN or the internet. If remote access is later required, add an authenticated gateway, TLS, rate limiting, and an independent security review.

## Public writes

The API requires `confirmed: true` for every non-GET advanced request and for publishing posts or comments. A client should set it only after the user explicitly approves the exact content and target.

## Reporting

Do not open a public issue containing a vulnerability or credential. Use a private repository security advisory or contact the repository owner privately.
