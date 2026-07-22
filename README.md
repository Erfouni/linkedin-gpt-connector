# LinkedIn GPT Connector

A local-only macOS bridge that lets ChatGPT, Helios, or another trusted MCP client call LinkedIn's official APIs without exposing LinkedIn credentials to the model.

## Architecture

```text
ChatGPT / Helios
      |
      | mcp mac -> http_fetch
      v
http://127.0.0.1:3190
      |
      | OAuth 2.0 access token from macOS Keychain
      v
LinkedIn official APIs
```

The service binds to loopback only. It does not automate linkedin.com, use browser cookies, scrape pages, or bypass LinkedIn product approval.

## Capabilities

- Check OAuth state and granted scopes
- Read the authenticated basic profile
- List authored posts when LinkedIn grants the required read access
- Publish a public text post
- Read and create comments when approved scopes permit it
- Read member post and profile analytics when approved
- Send an advanced request to an official `/v2/` or `/rest/` endpoint

All non-GET operations require `confirmed: true`.

## Requirements

- macOS
- Node.js 22+
- ChatGPT with the `mcp mac` connector enabled
- A LinkedIn Developer App
- Redirect URL registered as `http://127.0.0.1:3190/oauth/callback`
- LinkedIn Products/scopes approved for the operations you need

## Quick start

1. Clone this repository on the always-on Mac.
2. Double-click `Install.command` or run:

   ```bash
   chmod +x Install.command Authorize.command scripts/*.sh
   ./Install.command
   ```

3. Enter the LinkedIn Client ID locally. Enter the Client Secret only in the hidden Terminal prompt. The secret is stored in macOS Keychain.
4. Complete LinkedIn consent in the browser.
5. Verify:

   ```bash
   curl http://127.0.0.1:3190/health
   curl http://127.0.0.1:3190/oauth/status
   ```

No domain, VPS, tunnel, or HTTPS certificate is required for this local architecture.

## Use from ChatGPT or Helios

Ask the model to call `mcp mac.http_fetch` against the local agent. Example:

```text
Check my LinkedIn connection using GET http://127.0.0.1:3190/oauth/status.
```

See [docs/CHATGPT.md](docs/CHATGPT.md), [docs/API.md](docs/API.md), and the [Persian guide](docs/USAGE_FA.md).

## Permissions and 403 responses

Configured endpoints are not proof of API authorization. LinkedIn may require Community Management approval for post-history reads, feed actions, and these analytics scopes:

- `r_member_postAnalytics`
- `r_member_profileAnalytics`
- relevant member/organization social-feed permissions

When LinkedIn returns HTTP 403, obtain the required Product/scope through the LinkedIn Developer Portal. Do not work around the restriction with scraping or session cookies.

## Security

- Access token and Client Secret stay in macOS Keychain.
- `.env`, logs, build output, private keys, and local data are ignored.
- The server rejects non-loopback traffic.
- OAuth state expires after ten minutes.
- Public writes require explicit confirmation.
- CI runs TypeScript checks and a repository secret scan.

Read [SECURITY.md](SECURITY.md) before changing deployment or exposing the service.

## Verification

Run the same checks used by CI before proposing a change:

```bash
npm ci
npm run scan:secrets
npm test
npm run audit:high
```

The test suite exercises the loopback boundary, normalized LinkedIn API path
allowlist, write-confirmation rule, post-count normalization, and real local HTTP
responses without using live credentials or calling LinkedIn.

## Licensing and provenance

This repository does not currently include an open-source license. Public
visibility is not permission to reuse or redistribute the code. See
[NOTICE.md](NOTICE.md) for the factual Git-history boundary; the notice does not
grant rights or claim a copyright transfer.
