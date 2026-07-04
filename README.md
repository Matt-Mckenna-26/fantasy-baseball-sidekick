# Fantasy Baseball AI Co-Manager

Slice 1: a skeleton UI plus an end-to-end authenticated Yahoo Fantasy request. You sign in with Yahoo, and the app renders your MLB leagues from a real, authenticated Yahoo Fantasy API call. Read-only (`fspt-r`).

This is a vertical slice of [plan-of-record.MD](./plan-of-record.MD). See [Slice 1 scope](#scope) for what is and isn't included.

## Architecture (this slice)

- `packages/contracts` - shared DTOs + zod schemas used by both apps (the only source of boundary types).
- `apps/api` - Express + TypeScript. Owns the Yahoo OAuth (`fspt-r`) flow and a read-only `GET /api/me/leagues` endpoint. Tokens live behind a `TokenStore` interface (in-memory for now).
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

Fill in `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, and a long random `SESSION_SECRET`. Defaults for the URLs/ports already match the Yahoo values above. `.env` is gitignored - never commit it.

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

Deferred to later slices (see plan-of-record): Entra External ID sign-in, Cosmos/Key Vault token persistence, the private league allowlist, MLB enrichment, the AI co-manager, caching, and Azure deployment. The app never calls Yahoo write endpoints.
