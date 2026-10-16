# Deploying

## On a LAN host with Docker

```bash
git clone <this repository> netprobe && cd netprobe
cp config/netprobe.example.yaml config/netprobe.yaml   # edit as needed
NETPROBE_HOST_LABEL="$(hostname -s)" docker compose up -d --build
```

The container publishes port 8080 on the host (`NETPROBE_PUBLISH_PORT` changes it). On macOS,
Bonjour already advertises the host as `<LocalHostName>.local`, so other machines on the LAN can
open `http://<LocalHostName>.local:8080` with no extra setup. Find the name with:

```bash
scutil --get LocalHostName
```

On Linux the same works once `avahi-daemon` is running. A dedicated name such as
`netprobe.local` needs an extra mDNS record published by the host (for example
`dns-sd -P netprobe _http._tcp local 8080 netprobe.local <host-ip>` on macOS); it is not
required.

## Updating

```bash
git pull
docker compose up -d --build
```

History is in the `netprobe-data` volume and survives rebuilds. To start fresh:
`docker compose down -v`.

## Containers vs. host

Docker Desktop, OrbStack, and Colima on macOS run containers inside a Linux VM. Container
traffic crosses that VM's NAT, and proxies or TUN interfaces configured on macOS may or may not
see it. CI jobs on the same machine usually run on the host, so a container measurement can
disagree with what the jobs experience.

Every run records where it was measured from, and the UI warns when the server runs in a
container. When validating a deployment:

1. Run a quick test from the container.
2. Run the same test on the host: `pnpm install && pnpm build && NETPROBE_PORT=8081 pnpm start`.
3. Compare the egress IP and remote IPs in both runs. If they differ, the container is not on the
   same path as the host, and host-mode results are the ones that describe CI.

## Acceptance checklist

- [ ] Another device on the LAN opens `http://<host>.local:8080` and starts a run.
- [ ] A quick run completes; history shows it after `docker compose restart`.
- [ ] Cancelling a running download stops it, and no `curl` processes remain
      (`docker compose exec netprobe pgrep curl` prints nothing).
- [ ] `docker compose logs` contains no proxy credentials or signed URLs.
- [ ] Egress IP and remote IPs from the container match a host-mode run, or the difference is
      understood.
- [ ] Existing proxy and CI configuration on the host is untouched.
