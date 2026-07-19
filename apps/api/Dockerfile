# Multi-stage build for the single-origin deployment: the API image also contains the
# built React SPA and serves it from the same origin (see apps/api/src/app.ts), so the
# session-cookie + relative-URL flow works unchanged. Azure Container Apps runs this image;
# a GitHub Actions pipeline builds and pushes it.

FROM node:20-slim AS build
WORKDIR /repo

# Install with the workspace lockfile so contracts + api + web resolve deterministically.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

# Build the shared contracts package, then the web SPA and the API.
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @fcm/contracts \
  && npm run build -w @fcm/web \
  && npm run build -w @fcm/api

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# Production dependencies only (the SPA is prebuilt static output, so web deps are omitted).
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev

# Compiled output: contracts + API code, plus the static SPA bundle the API serves.
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist apps/web/dist

# Container Apps sets PORT; the app reads it from the environment (see config.ts).
EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]
