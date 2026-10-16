# Deploying

## Linux host with Docker

```bash
git clone https://github.com/lennondotw/netprobe && cd netprobe
cp config/netprobe.example.yaml config/netprobe.yaml   # edit as needed
NETPROBE_PORT=8080 NETPROBE_HOST_LABEL="$(hostname -s)" \
  docker compose -f compose.host.yaml up -d --build
```

`compose.host.yaml` uses host networking: measurements and the Host page describe the host,
and the port is whatever `NETPROBE_PORT` says. Pick a free one if 8080 is taken. To listen on one
interface only (say, behind a reverse proxy on the same machine), set `NETPROBE_HOST=127.0.0.1`.

`compose.yaml` is the bridge-network alternative. It publishes `NETPROBE_PUBLISH_PORT` and
works everywhere, at the cost of measuring through Docker's NAT.

## Updating

```bash
git pull
docker compose -f compose.host.yaml up -d --build
```

History is in the `netprobe-data` volume and survives rebuilds. To start fresh, remove the volume
with `docker compose -f compose.host.yaml down -v`.

## Nginx Proxy Manager

1. Run Netprobe on the host network, as above.
2. In Nginx Proxy Manager, add a **Proxy Host**:
   - Domain: the name you want, e.g. `netprobe.example.lan` (it must resolve to the proxy).
   - Scheme `http`, forward hostname: the Docker host's LAN address (or `127.0.0.1` when the
     proxy itself uses host networking), forward port: `NETPROBE_PORT`.
   - Websockets support is not needed. Live progress uses server-sent events, and Netprobe sends
     `X-Accel-Buffering: no`, so nginx does not buffer them.
3. Optionally add a TLS certificate and an access list. Netprobe has no authentication of its own.

## `.local` names

On macOS, Bonjour already advertises the machine as `<LocalHostName>.local` (`scutil --get
LocalHostName`), so `http://<LocalHostName>.local:8080` works across the LAN. On Linux the same
works once `avahi-daemon` is running.

## Containers vs. host

Docker Desktop, OrbStack, and Colima on macOS (and WSL 2 on Windows) run containers inside a Linux
VM. Container traffic crosses that VM's NAT, and proxies or TUN interfaces configured on the host
may not see it. Netprobe detects the VM and says so in the UI. On those platforms run Netprobe
natively when the host's own path is what matters.

On Linux, host networking removes the difference. With bridge networking the UI notes the extra
NAT.

## Acceptance checklist

- [ ] Another device on the LAN opens the page and starts a run.
- [ ] Two viewers starting runs at once: the second waits, then runs.
- [ ] History survives `docker compose restart`.
- [ ] Cancelling a running download stops it, and no `curl` processes remain
      (`docker compose exec netprobe pgrep curl` prints nothing).
- [ ] Logs (`docker compose logs`) contain no proxy credentials or signed URLs.
- [ ] The sidebar says "Container, host network" (or "Host"), not a VM or bridge network.
