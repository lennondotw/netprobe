#!/bin/sh
# Starts as root only to set up policy routing for interface and gateway exits, then runs the
# server as `node`.
set -e
# Probes take the path their exit names. Proxy variables a Docker client injects into every
# container (`proxies` in ~/.docker/config.json) would only hide that, so none reach the server.
unset http_proxy https_proxy ftp_proxy all_proxy no_proxy \
  HTTP_PROXY HTTPS_PROXY FTP_PROXY ALL_PROXY NO_PROXY
if [ "$(id -u)" = 0 ]; then
  node --disable-warning=ExperimentalWarning src/server/setup-routes.ts \
    || echo "[setup-routes] continuing; the affected exits report why they cannot be used" >&2
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
fi
exec "$@"
