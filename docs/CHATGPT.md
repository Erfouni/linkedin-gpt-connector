# ChatGPT and Helios usage

## Required connector

Enable the trusted `mcp mac` connector in ChatGPT. The Mac and the local agent must be online.

## Read examples

```text
Use mcp mac http_fetch to GET http://127.0.0.1:3190/oauth/status and report only connection state and scopes.
```

```text
Use the local LinkedIn Agent to read my basic profile. Do not display my email or internal member ID.
```

```text
Use GET http://127.0.0.1:3190/posts?count=20 and summarize my recent posts. If LinkedIn returns 403, report the exact missing permission.
```

## Write workflow

1. Draft content without calling LinkedIn.
2. Let the user approve the exact final text and target.
3. Call the appropriate POST endpoint with `confirmed: true`.
4. Report success only from the verified API response.

Example after approval:

```text
Publish this exact approved text through POST http://127.0.0.1:3190/posts with confirmed=true. Do not modify it.
```

## Privacy

Do not send LinkedIn tokens, secrets, private analytics, private profile fields, or raw API responses to an external model unless the user explicitly requests that exact transfer and it is necessary.
