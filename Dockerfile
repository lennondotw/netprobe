# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.title="Netprobe" \
  org.opencontainers.image.description="Self-hosted network diagnostics: reachability, latency, jitter, throughput, and egress identity, measured from the machine it runs on." \
  org.opencontainers.image.source="https://github.com/lennondotw/netprobe" \
  org.opencontainers.image.licenses="MIT"
# curl runs HTTP probes, iputils-ping runs ICMP probes, ca-certificates gives both the same
# trust store as other clients, iproute2 sets up routing for gateway exits.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates iputils-ping iproute2 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /config \
  && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production \
  NETPROBE_HOST=0.0.0.0 \
  NETPROBE_PORT=8080 \
  NETPROBE_CONFIG=/config/netprobe.yaml \
  NETPROBE_DATA=/data/netprobe.db
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/shared ./src/shared
COPY docker/entrypoint.sh /usr/local/bin/netprobe-entrypoint
# The entrypoint starts as root only to set up gateway exits, then runs the server as `node`.
ENTRYPOINT ["netprobe-entrypoint"]
VOLUME /data
EXPOSE 8080
# Shell form so the check follows NETPROBE_PORT (host networking often needs another port).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS "http://127.0.0.1:${NETPROBE_PORT}/api/health" || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/main.ts"]
