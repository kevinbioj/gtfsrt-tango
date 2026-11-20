FROM node:26.13.1-alpine AS base
WORKDIR /app

# ---

FROM base AS dependencies_base

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ---

FROM dependencies_base AS builder

RUN pnpm install --frozen-lockfile

COPY ./src/ ./src/
COPY tsconfig.json ./
RUN pnpm build

# ---

FROM dependencies_base AS production_dependencies

RUN pnpm install --frozen-lockfile --prod

# ---

FROM base AS runtime
ENV NODE_ENV=production

RUN apk add --no-cache tini

COPY --from=production_dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist/ ./dist

EXPOSE 3000
CMD ["/sbin/tini", "--", "node", "/app/dist/index.js"]
