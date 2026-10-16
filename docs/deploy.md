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

## macOS, natively

On a Mac, run Netprobe natively rather than in Docker, which would measure through a VM.
[`deploy/dev.netprobe.plist`](../deploy/dev.netprobe.plist) is a LaunchAgent for a user with a
login session. On a shared machine such as a CI runner, pick a port its jobs are unlikely to use
and keep Node.js out of the global `PATH` if jobs should not find it: a Node.js tarball unpacked
next to the checkout works, with `ProgramArguments` pointing at it. To update:

```bash
cd ~/netprobe && git pull && pnpm install --frozen-lockfile && pnpm build
launchctl kickstart -k gui/$(id -u)/dev.netprobe
```

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

## Exits through another interface or gateway

An exit with `gateway` (or `interface`) sends its probes out of a different network path at the
network layer: no proxy settings or environment variables, so every probe kind (HTTP, ICMP, TCP,
DNS, STUN, QUIC) takes that path. A typical use is comparing the normal route with a side router
(a transparent proxy or VPN gateway on the LAN) without sending the whole host through it.

This needs the container to have its own network namespace, so use bridge networking plus a
second network that reaches the gateway, and the `NET_ADMIN` capability. At start the container
adds one routing table per such exit and rules that select it only for traffic from (or bound to)
that interface, then drops to an unprivileged user. Routing for the host and for other containers
is not touched. A `compose.override.yaml` next to `compose.yaml`:

```yaml
services:
  netprobe:
    cap_add: [NET_ADMIN]
    networks:
      default:
        gw_priority: 1 # the default route stays on the bridge
      lan:
        ipv4_address: 192.168.1.243 # a free address on the gateway's network
networks:
  lan:
    external: true # e.g. a macvlan network created with `docker network create -d macvlan …`
```

and in `config/netprobe.yaml`:

```yaml
exits:
  - id: direct
    name: Direct
  - id: side-router
    name: Side router
    gateway: 192.168.1.240
    dns: 192.168.1.240 # optional: resolve names through it too
```

If your Docker client injects proxy variables into containers (`proxies` in
`~/.docker/config.json`), the server unsets them at start; to keep them out of the container's
configuration too, set each one to an empty value under `environment` in the override.

Keep the bridge as the default network so the page stays reachable and the `direct` exit keeps
the host's route. Bound exits are IPv4 only. Without the policy routing (host networking, macOS,
or a missing capability), curl and ping still bind to the interface, but socket probes report
that they cannot be bound instead of silently taking the default route.

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
