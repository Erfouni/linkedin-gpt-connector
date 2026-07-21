# Local API

Base URL: `http://127.0.0.1:3190`

## Connection

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Local service health |
| GET | `/oauth/status` | Configuration, authorization, and requested scopes |
| GET | `/oauth/start` | Start LinkedIn OAuth in a browser |
| GET | `/oauth/callback` | Registered OAuth callback |
| GET | `/connection` | Connected member summary |
| GET | `/profile` | Basic authenticated profile |

## Posts

List posts:

```bash
curl "http://127.0.0.1:3190/posts?count=20"
```

Publish a text post only after exact user approval:

```bash
curl -X POST "http://127.0.0.1:3190/posts" \
  -H "Content-Type: application/json" \
  -d '{"commentary":"Approved final text","confirmed":true}'
```

## Comments

```bash
curl --get "http://127.0.0.1:3190/comments" \
  --data-urlencode "post_urn=urn:li:share:EXAMPLE"
```

```bash
curl -X POST "http://127.0.0.1:3190/comments" \
  -H "Content-Type: application/json" \
  -d '{"post_urn":"urn:li:share:EXAMPLE","message":"Approved comment","confirmed":true}'
```

## Creator analytics

Post metrics: `IMPRESSION`, `MEMBERS_REACHED`, `REACTION`, `COMMENT`, `RESHARE`.

Profile metrics: `PROFILE_VIEW`, `SEARCH_APPEARANCE`.

```bash
curl --get "http://127.0.0.1:3190/analytics/post" \
  --data-urlencode "post_urn=urn:li:share:EXAMPLE" \
  --data-urlencode "metric=IMPRESSION"

curl "http://127.0.0.1:3190/analytics/profile?metric=PROFILE_VIEW"
```

## Advanced official API request

Use only if a narrower endpoint does not cover the task:

```bash
curl -X POST "http://127.0.0.1:3190/linkedin/request" \
  -H "Content-Type: application/json" \
  -d '{"method":"GET","path":"/v2/userinfo","confirmed":false}'
```

Only `/v2/` and `/rest/` paths are accepted. Every non-GET request requires `confirmed: true`.

## Status handling

- `400`: invalid input or missing confirmation
- `401`: OAuth token absent/expired or optional local bearer guard failed
- `403`: LinkedIn Product/scope has not been granted
- `5xx`: local error or upstream failure
