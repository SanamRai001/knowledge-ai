ARG NODE_VERSION=22.14.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV CI=true

COPY package.json package-lock.json ./
RUN test "$(node --version)" = "v22.14.0" \
  && test "$(npm --version)" = "10.9.2" \
  && npm ci

COPY tsconfig.json vite.config.ts index.html metadata.json server.ts worker.ts ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
COPY assets ./assets

RUN npm run build
RUN npm prune --omit=dev \
  && npm cache clean --force

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server/persistence/migrations ./server/persistence/migrations

USER node
EXPOSE 3000

CMD ["node", "dist/private/server.cjs"]
