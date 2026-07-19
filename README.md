# Fantasy Baseball AI Co-Manager

Slice 1: a skeleton UI plus an end-to-end authenticated Yahoo Fantasy request. You sign in with Yahoo, and the app renders your MLB leagues from a real, authenticated Yahoo Fantasy API call. Read-only (`fspt-r`).

This is a vertical slice of [plan-of-record.MD](./plan-of-record.MD). See [Slice 1 scope](#scope) for what is and isn't included.

## Architecture (this slice)

- `packages/contracts` - shared DTOs + zod schemas used by both apps (the only source of boundary types).
- `apps/api` - Express + TypeScript. Owns the Yahoo OAuth (`fspt-r`) flow and a read-only `GET /api/me/leagues` endpoint. Tokens live behind a `TokenStore` interface: encrypted-at-rest file store for local dev (AES-256-GCM via `TOKEN_ENC_KEY`), in-memory in production until the Cosmos + Key Vault backend lands. Access tokens are refreshed proactively (before expiry, single-flight per session) so parallel Yahoo reads don't race per-call refreshes.
- `apps/web` - React + Vite + TypeScript. App shell (Home / Chat / Rosters / Stats), a Connect Yahoo flow, and a My Leagues view.

The Vite dev server terminates HTTPS (Yahoo requires an https redirect URI) and proxies `/auth` and `/api` to the API, so everything is first-party to `https://localhost:5173` and the session cookie survives the OAuth redirect.

```
Browser (https://localhost:5173)
  -> Vite dev server (HTTPS, proxy)
       /auth/*  -> API (http://localhost:8787)
       /api/*   -> API (http://localhost:8787)
API -> Yahoo OAuth + Fantasy API (fspt-r, read-only)
```

## Prerequisites

- Node.js 20+.
- A Yahoo app (see below) with Fantasy Sports **Read** permission.

## 1. Register a Yahoo app

Create an app at https://developer.yahoo.com/apps/create/ with these values:

| Field             | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Application Name  | anything (the word "Yahoo" is not allowed in the name/description) |
| Description       | e.g. "Fantasy baseball assistant chatbot (read-only)"              |
| Homepage URL      | `https://localhost:5173`                                           |
| Redirect URI(s)   | `https://localhost:5173/auth/yahoo/callback`                       |
| OAuth Client Type | Confidential Client (this app has a server + client secret)        |
| API Permissions   | Fantasy Sports -> **Read**                                         |

The Redirect URI must match `YAHOO_REDIRECT_URI` in your `.env` exactly. Copy the generated Client ID and Client Secret.

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, a long random `SESSION_SECRET`, and `TOKEN_ENC_KEY` (a base64-encoded 32-byte key that encrypts your persisted Yahoo tokens at rest; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Keep `TOKEN_ENC_KEY` stable across restarts or saved tokens can't be decrypted (you'd just re-login). `TOKEN_REFRESH_SKEW_SECONDS` (default 300) controls how early access tokens are refreshed before expiry. Defaults for the URLs/ports already match the Yahoo values above. `.env` is gitignored - never commit it.

## 3. Install and generate a local HTTPS cert

```bash
npm install
npm run gen:cert
```

`gen:cert` writes a self-signed cert to `certs/` (gitignored). Browsers show a one-time trust warning for self-signed certs; accept it, or for a warning-free experience generate the cert with [mkcert](https://github.com/FiloSottile/mkcert) instead:

```bash
mkcert -install
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1
```

## 4. Run

```bash
npm run dev
```

- Web: https://localhost:5173
- API: http://localhost:8787 (proxied; you normally only visit the web URL)

## Verify the slice end to end

1. Open https://localhost:5173 and accept the cert warning if prompted.
2. Click **Connect Yahoo**, complete Yahoo login, and grant read access.
3. You are returned to the app, which lists your MLB leagues (a live authenticated Yahoo Fantasy call).
4. **Disconnect** clears the session.

## AI co-manager chat

The Chat page talks to a read-only AI co-manager (`POST /api/chat`). The model calls
read-only tools that fetch your league data (rosters, standings, matchups, team/player
stats, free agents) and enrich player references with the free public MLB Stats API
(real season stats + recent transactions as "news"). Two of those tools sharpen its
judgement: `get_player_advanced_stats` returns expected/advanced "luck" metrics (AVG vs
xBA, SLG vs xSLG, xwOBA, BABIP, K%/BB% or K/9 etc.) with a buy-low/sell-high read, and
`get_bullpen_roles` infers a team's closer/setup hierarchy from recent relief usage so
save/hold advice names the pitcher actually getting the chances. Tool results are trimmed
to compact snapshots and the tool-call loop is bounded, so token spend stays predictable.

The advanced/expected stats also surface in the UI. The player-focus card renders them as
percentile-colored rank tiles (same coloring as the scoring card), and the Player Stats page
has a **Scoring / Advanced** toggle that swaps the grid + compare view to the expected-stat
columns, ranked and colored by percentile against the same player pool. Advanced stats are
season-scoped, so the trend/range controls are hidden in that mode. Both read from
`GET /api/me/leagues/:leagueId/advanced-stats`, which mirrors the `/stats` shape (Yahoo keeps
owning identity/rank/ownership; only the numbers are swapped for MLB expected stats) and is
cached per league. Percentile direction for these columns comes from an explicit
`higherIsBetter` flag on each `StatColumn` (e.g. lower xBA is better for pitchers).

The LLM provider is chosen by `CHAT_PROVIDER`:

- `mock` (default): a deterministic, offline provider. No key, no network - ideal for dev
  and tests. It routes your question to the right tools and answers from real (mock-mode)
  league data.
- `azure`: real Azure OpenAI (gpt-4o-mini). Requires the `AZURE_OPENAI_*` env vars.

### Provision Azure OpenAI (one-time, Azure Portal)

1. Create a resource group (any name, e.g. `rg-fcm-ai`) in a region that offers Azure
   OpenAI (e.g. East US 2).
2. Create an **Azure OpenAI** resource in that group (pricing tier S0); wait for it to
   finish deploying.
3. Open the resource in **Azure AI Foundry** -> **Deployments** -> deploy the
   `gpt-4o-mini` model and name the deployment `gpt-4o-mini`.
4. On the resource's **Keys and Endpoint** blade, copy **Endpoint** and **KEY 1**.

### Run the real bot locally

In `.env` (gitignored - never commit):

```bash
CHAT_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-azure-openai-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-10-21
```

Then `npm run dev`, open the Chat page, pick a league, and ask things like "what
categories should I target?", "who should I drop?", or "any free-agent pitchers to
stream?". Leave `CHAT_PROVIDER` unset (or `mock`) to run fully offline.

## Deploy to Azure (single-origin Container App)

The first production deployment ships one Azure Container App that serves **both** the
built React SPA and the Express API from a single origin, so the relative-URL + session
cookie flow works unchanged. `apps/api/Dockerfile` builds that combined image (contracts +
web bundle + API). Yahoo OAuth is the only auth; the app runs a single always-on replica
(`min = max = 1`, no scale-to-zero), so a container restart just means users re-login
(tokens/sessions are in-memory in production).

### Production environment variables

Set these on the Container App. Mark the first group as **secrets** (never plain env):

- Secrets: `YAHOO_CLIENT_SECRET`, `SESSION_SECRET`, and `AZURE_OPENAI_API_KEY` (only when `CHAT_PROVIDER=azure`).
- Plain: `NODE_ENV=production`, `YAHOO_CLIENT_ID`, `YAHOO_REDIRECT_URI=https://<fqdn>/auth/yahoo/callback`, `WEB_APP_URL=https://<fqdn>`, `DATA_MODE=live`, `STATS_SOURCE=yahoo`, `CHAT_PROVIDER` (+ `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` when azure).

`<fqdn>` is the Container App's `*.azurecontainerapps.io` hostname, known only after the
app is created. `PORT` is injected by Container Apps (read by `config.ts`); `TOKEN_ENC_KEY`
is **not** needed in production (the in-memory token store does not encrypt at rest).

### One-time provisioning (Azure Portal, in order)

1. Resource group (e.g. `rg-fcm`).
2. (If `CHAT_PROVIDER=azure`) Azure OpenAI resource + `gpt-4o-mini` deployment (see the section above); copy the endpoint + key.
3. Container Apps Environment (auto-creates a Log Analytics workspace).
4. Container App: external ingress on the app port, `min = max = 1`, an HTTP health probe on `GET /health`, and the env vars/secrets above. Bootstrap with any placeholder image for the first create.
5. Copy the app FQDN, register `https://<fqdn>/` (homepage) and `https://<fqdn>/auth/yahoo/callback` (redirect URI) on the Yahoo app, then set `YAHOO_REDIRECT_URI` / `WEB_APP_URL` and restart.

### Automated deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs on push to `main`: it builds the image with
`apps/api/Dockerfile`, pushes it to GitHub Container Registry (GHCR) tagged with the commit
SHA, logs into Azure via OIDC (no stored cloud secrets), and runs `az containerapp update
--image ...`. App secrets live only on the Container App - the workflow sets the image, never
secrets. See the workflow header for the required repo variables (`AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_CONTAINERAPP_NAME`).

## Scripts

- `npm run dev` - run web + API together.
- `npm run dev:api` / `npm run dev:web` - run one side.
- `npm run gen:cert` - generate the local HTTPS cert.
- `npm test` - unit/component tests across all workspaces.
- `npm run lint` - ESLint + Prettier check.
- `npm run typecheck` - TypeScript checks across all workspaces.
- `npm run build` - build all workspaces.

## Scope

Included: skeleton UI shell, Yahoo OAuth (`fspt-r`), one authenticated read-only endpoint, typed contracts, tests.

Deferred to later slices (see plan-of-record): Entra External ID sign-in; the production Cosmos + Key Vault token backend and a durable session store (local dev already persists tokens encrypted-at-rest via the file store, but Container Apps filesystems are ephemeral, so true prod durability lands with this slice); the private league allowlist; MLB enrichment; the AI co-manager; caching; and Azure deployment. The app never calls Yahoo write endpoints.
