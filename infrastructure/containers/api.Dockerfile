FROM node:22-bookworm-slim

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain-contracts/package.json packages/domain-contracts/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY packages/domain-contracts packages/domain-contracts
COPY apps/api apps/api

RUN pnpm --filter @must/shared-types build \
 && pnpm --filter @must/domain-contracts build \
 && pnpm --filter api prisma:generate \
 && pnpm --filter api build

ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
