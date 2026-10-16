#!/bin/sh
# Starts as root only to set up policy routing for interface and gateway exits, then runs the
# server as `node`.
set -e
if [ "$(id -u)" = 0 ]; then
  node --disable-warning=ExperimentalWarning src/server/setup-routes.ts \
    || echo "[setup-routes] continuing; the affected exits report why they cannot be used" >&2
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
fi
exec "$@"
