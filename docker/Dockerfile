# syntax=docker/dockerfile:1
#
# One image, two roles: the `api` and `worker` compose services both run
# this image, selecting their entrypoint via `command` override.

# ---- deps: install all dependencies (incl. dev, needed to build) ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# The bundled npm version can mishandle optional platform-specific packages
# during `npm ci`; upgrading npm first avoids EBADPLATFORM false positives.
RUN npm install -g npm@11 && npm ci

# ---- build: compile TypeScript ----
FROM node:20-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: install production-only dependencies ----
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install -g npm@11 && npm ci --omit=dev

# ---- runtime: minimal final image ----
FROM node:20-bookworm-slim AS runtime
ARG COMMIT_SHA=unknown
ENV NODE_ENV=production \
    COMMIT_SHA=${COMMIT_SHA} \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY package.json ./

RUN npx playwright install --with-deps chromium \
  && groupadd --system app \
  && useradd --system --gid app --home-dir /home/app --create-home app

USER app
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/entrypoints/api.js"]
