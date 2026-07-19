# syntax=docker/dockerfile:1
#
# One image, two roles: the `api` and `worker` compose services both run
# this image, selecting their entrypoint via `command` override.

# ---- deps: install all dependencies (incl. dev, needed to build) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# node:20-alpine bundles an npm version with a known bug mishandling
# optional platform-specific packages (e.g. esbuild's per-OS/CPU binaries)
# during `npm ci`; upgrading npm first avoids EBADPLATFORM false positives.
RUN npm install -g npm@11 && npm ci

# ---- build: compile TypeScript ----
FROM node:20-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: install production-only dependencies ----
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install -g npm@11 && npm ci --omit=dev

# ---- runtime: minimal final image ----
FROM node:20-alpine AS runtime
ARG COMMIT_SHA=unknown
ENV NODE_ENV=production \
    COMMIT_SHA=${COMMIT_SHA}

RUN apk add --no-cache git && addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY package.json ./

USER app
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/entrypoints/api.js"]
