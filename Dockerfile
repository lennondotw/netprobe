# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24-bookworm-slim
# curl runs HTTP probes, iputils-ping runs ICMP probes, ca-certificates gives both the same
# trust store as other clients.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates iputils-ping \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /config \
  && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production \
  NETPROBE_PORT=8080 \
  NETPROBE_CONFIG=/config/netprobe.yaml \
  NETPROBE_DATA=/data/netprobe.db
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/shared ./src/shared
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/main.ts"]
