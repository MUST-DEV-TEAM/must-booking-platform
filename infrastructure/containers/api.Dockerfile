FROM node:22-bookworm-slim

WORKDIR /workspace
RUN corepack enable

# node:22-bookworm-slim ships without openssl, so Prisma cannot detect a libssl
# version and falls back to a guessed engine at every startup. This is a single
# stage image, so installing it here also covers the runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
# apps/api's postinstall runs `prisma generate`, which needs the schema present
# before `pnpm install` runs below -- copy it ahead of the dependency-caching install.
COPY apps/api/prisma apps/api/prisma
COPY packages/domain-contracts/package.json packages/domain-contracts/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY packages/domain-contracts packages/domain-contracts
COPY apps/api apps/api

# V8 sizes its default heap from physical memory and ignores swap, so this step
# OOMs (exit 134) on a small host. Cap it explicitly rather than inherit that.
RUN export NODE_OPTIONS=--max-old-space-size=3072 \
 && pnpm --filter @must/shared-types build \
 && pnpm --filter @must/domain-contracts build \
 && pnpm --filter api build

ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
