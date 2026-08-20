FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
# apps/api's postinstall runs `prisma generate`, needed because apps/web's e2e test
# helpers import @prisma/client's generated types (resolved from the same pnpm
# virtual-store entry apps/api uses) -- the schema must be present before install runs.
COPY apps/api/prisma apps/api/prisma
COPY packages/ui/package.json packages/ui/package.json
COPY packages/domain-contracts/package.json packages/domain-contracts/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile

COPY packages/ui packages/ui
COPY apps/web apps/web

# next.config.ts's rewrites() reads API_URL when `next build` computes the routing
# manifest, not at container start — it must be set here, not just at `docker run` time.
ARG API_URL=http://api:3000
ENV API_URL=$API_URL

# NEXT_PUBLIC_SENTRY_DSN is inlined into the client bundle at build time. The other
# three are only used by withSentryConfig() to upload source maps during this build;
# omit them and the build proceeds without source map upload (no error).
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG SENTRY_AUTH_TOKEN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN

RUN pnpm --filter @must/ui build \
 && pnpm --filter web build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
USER node
EXPOSE 3001
CMD ["node", "server.js"]
