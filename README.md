# Netprobe

[![CI](https://github.com/lennondotw/netprobe/actions/workflows/ci.yml/badge.svg)](https://github.com/lennondotw/netprobe/actions/workflows/ci.yml)

Self-hosted network diagnostics: reachability, latency, jitter, throughput, and egress identity,
measured from the machine it runs on.

![Netprobe's Connectivity page: latency baselines, captive-portal checks, and UDP/QUIC probes with per-phase timings](docs/images/netprobe.png)

Open it in a browser, pick a category or a service, and press **Run**: the server you deployed it
on measures reachability, latency, jitter, and loss to about 250 built-in targets (AI apps and
APIs, GitHub, package and container registries, Linux and China mirrors, DNS, and more) and any
endpoint you add, and shows which address each site saw the request come from.

The browser only drives and displays. Every request is made by the server, so results describe
the network path of the machine Netprobe runs on: a CI runner, a build host, a home server, or
an office gateway.

## What it answers

- **Where does it fail?** Each failure is attributed to DNS, TCP, TLS, HTTP, or the transfer,
  and classified (timeout, reset, refused, certificate, interrupted transfer, unexpected status).
- **Which targets are slow or flaky?** Every target is probed several times; the table shows
  per-phase medians, a request waterfall, and how many attempts succeeded. One failure in five
  shows as _Intermittent_, never as healthy.
- **Which address does each site see?** For every site behind Cloudflare, the server reads
  that site's own `/cdn-cgi/trace` over the same exit and shows the address the site saw in an
  _Exit IP_ column. Rule-based proxies route per domain, so this can differ from site to site.
- **How fast is the download path?** Optional (off by default, since every viewer could start
  one): a few small files on speed-test hosts, over one connection and over several range-split
  connections, reported in Mbps and MB/s with the bytes received.
- **Does the exit matter?** Runs can go out through more than one exit: the system route, an
  HTTP/SOCKS proxy, another network interface, or a gateway such as a LAN side router (routed at
  the network layer, with no proxy settings). Every run records the public IP it left from.
- **What is this machine's network setup?** The Host page shows the device, OS, interfaces,
  default routes, DNS servers, proxy settings, and flags tunnels and fake-IP DNS.
- **Who does the internet think this host is?** The Egress page asks 16 independent services
  where the host's traffic comes from, groups their answers by network (so split routing through
  a rule-based proxy is visible), looks up each exit address's type and reputation, and identifies
  the DNS resolvers queries actually reach. A separate section checks the viewing browser's public
  address and WebRTC candidates.

### Built-in targets

| Category       | Services                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Network        | ICMP/TCP latency baseline, captive-portal checks, STUN and QUIC (UDP), TLS handshakes, speed-test nodes |
| DNS            | Plain DNS over UDP to public resolvers; DoT, DoH, DoH3, and DoQ                                         |
| Platforms      | Apple, Microsoft, Google, Cloudflare                                                                    |
| AI             | OpenAI, Anthropic, Google AI, xAI, other and China model providers, inference, coding tools             |
| Developer      | GitHub (web, API, storage, Packages, Pages), GitHub Actions, other forges, notarization                 |
| Packages       | npm, language registries, container registries, package CDNs, toolchains and SDKs                       |
| Mirrors        | Default Linux software sources; mirrors and registry proxies used in mainland China                     |
| Cloud          | AWS, Vercel                                                                                             |
| Tailscale      | Control plane and DERP relays (HTTPS and STUN) in nine regions                                          |
| Social & tools | Social and messaging sites; collaboration tools                                                         |
| Regional       | Mainland China sites                                                                                    |

Each service can be run on its own from its group header, or a whole category from the toolbar.

API endpoints are probed without credentials, so their healthy answer is a fixed error such as 401. Web apps behind Cloudflare's bot check (ChatGPT, Claude, Le Chat) answer 403 to every
non-browser client, so they are probed through their own `/cdn-cgi/trace`, which crosses the
same edge without the check.

### Probe types

| Scheme    | Measures                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http(s)` | Through curl: DNS, TCP, TLS, time to first byte, total; status checked against the target                                                                     |
| `icmp`    | Echo round trips through the system `ping`; loss and jitter                                                                                                   |
| `tcp`     | Connect time                                                                                                                                                  |
| `dns`     | One query over UDP; the answer is recorded, so hijacked DNS shows up                                                                                          |
| `dot`     | The same query over TLS, with connect and handshake timed separately                                                                                          |
| `stun`    | Binding request; records the public address UDP traffic leaves from                                                                                           |
| `quic`    | Version negotiation: proves a QUIC endpoint (HTTP/3, DoQ) is reachable over UDP, without a handshake                                                          |
| `tls`     | A TLS handshake by Node's OpenSSL, default (post-quantum key share, ~1.6 KB ClientHello) or `?groups=` / `?version=`; shows the negotiated protocol and group |

Socket-level probes cannot go through an HTTP or SOCKS proxy, so proxy exits run HTTP targets only.
Jitter is the mean absolute difference between consecutive round trips.

### Reading the results

| Status       | Meaning                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OK           | Every attempt returned the expected status.                                                                                                                               |
| Reachable    | A reachability-only target (e.g. an API answering 401 without credentials) answered as expected. This proves the network path, not that a real request would be accepted. |
| Transferred  | The full body arrived with the expected size.                                                                                                                             |
| Unexpected   | An HTTP response arrived, but with a different status or size.                                                                                                            |
| Intermittent | Some attempts failed and some succeeded.                                                                                                                                  |
| Failed       | No attempt got an HTTP response.                                                                                                                                          |

Failed attempts are kept as they happened; there are no silent retries.

The **Exit IP** column shows the address a site saw, with the country Cloudflare placed it in.
It appears for every site behind Cloudflare: a response carrying `cf-ray` marks the site, and
the server then reads that site's `/cdn-cgi/trace` once per run over the same exit. With a
rule-based proxy (Clash, mihomo, Surge) each domain can leave through a different node, and this
column shows which. Sites not behind Cloudflare show a dash.

When remote addresses fall in `198.18.0.0/15`, a local proxy or TUN interface in fake-IP mode is
answering DNS and terminating TCP. Netprobe flags this: DNS and TCP timings then describe the
proxy, while TLS and time-to-first-byte still include the real path.

## Running it

Netprobe is a single Node.js process that shells out to `curl` and `ping`. It runs on Linux and
macOS, natively or in Docker. Pick the setup that matches what you want to measure.

### Docker on Linux with host networking (recommended)

The container shares the host's network stack, so probes, the Egress page, and the Host page
describe the host itself, with no Docker NAT in between.

```bash
git clone https://github.com/lennondotw/netprobe && cd netprobe
cp config/netprobe.example.yaml config/netprobe.yaml   # optional
NETPROBE_PORT=8080 docker compose -f compose.host.yaml up -d --build
```

Open `http://<host>:8080`. History lives in the `netprobe-data` volume and survives rebuilds.

### Docker with bridge networking

Portable, and the only option with Docker Desktop. Traffic leaves through Docker's NAT, which
the UI points out.

```bash
docker compose up -d --build    # publishes NETPROBE_PUBLISH_PORT (default 8080)
```

### Prebuilt image

CI publishes multi-arch images (`linux/amd64`, `linux/arm64`) to the GitHub Container Registry:

```bash
docker run -d --name netprobe --network host --restart unless-stopped \
  -e NETPROBE_DOCKER_NETWORK=host -e NETPROBE_PORT=8080 \
  -v netprobe-data:/data -v "$PWD/config:/config:ro" -v /etc/os-release:/host/os-release:ro \
  ghcr.io/lennondotw/netprobe:latest
```

### Natively

Requires Node.js 24+, `curl`, and `ping`.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

[`deploy/netprobe.service`](deploy/netprobe.service) is a systemd unit for running it as a
service, and [`deploy/dev.netprobe.plist`](deploy/dev.netprobe.plist) a LaunchAgent for macOS.
On macOS, running natively is the way to measure exactly what the host sees: Docker Desktop and
OrbStack run containers in a VM with its own NAT.

### Behind a reverse proxy

Live progress uses server-sent events. Netprobe sends `X-Accel-Buffering: no`, so nginx (and
Nginx Proxy Manager) stream them without extra configuration; other proxies must not buffer
`text/event-stream` responses. See [docs/deploy.md](docs/deploy.md) for an Nginx Proxy Manager
setup, `.local` names, and a deployment checklist.

## Configuration

All configuration lives in one YAML file (`NETPROBE_CONFIG`, default `config/netprobe.yaml`).
Start from [`config/netprobe.example.yaml`](config/netprobe.example.yaml), which documents every
option. Its first line points editors that use yaml-language-server (such as VS Code with the
YAML extension) at [`config/netprobe.schema.json`](config/netprobe.schema.json), for completion
of every key and built-in id, hover documentation, and validation as you type.

```yaml
# yaml-language-server: $schema=./netprobe.schema.json
modules:
  downloads: true # throughput tests against speed-test hosts (off by default)
  host: true
  egress:
    excludeSources: [ip-api] # skip one third-party service
    dnsLeakTest: false

exits:
  - id: direct
    name: Direct
  - id: office
    name: Office proxy
    proxy: socks5h://10.0.0.2:1080
  - id: side-router # network layer: see docs/deploy.md
    name: Side router
    gateway: 192.168.1.240

presets:
  exclude: [social, github.objects] # a whole service, or one target
  excludeCategories: [Regional]

services:
  - id: internal # a new service; targets can be bare URLs
    category: Internal
    targets:
      - https://wiki.internal/
      - icmp://10.0.0.1
  - id: aws # reuse a built-in id to add or replace targets
    targets:
      - id: accelerate
        url: https://my-bucket.s3-accelerate.amazonaws.com/
        expectStatus: 403
        check: reachability
```

### Exits

Exits are listed under `exits`; the first is the default, and each run can pick another.

| Key                   | Traffic                                                                                       | Probes          |
| --------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| _(none of the below)_ | The system route                                                                              | All             |
| `proxy`               | Through an HTTP or SOCKS proxy; credentials are never shown or logged                         | HTTP only       |
| `interface`           | Bound to a network interface, such as a WireGuard tunnel                                      | All (see below) |
| `gateway`             | Through a gateway on a directly connected network, such as a side router running a proxy      | All (see below) |
| `dns`                 | Optional with `interface` or `gateway`: resolve names through this server, over the same exit | —               |

Interface and gateway exits work at the network layer, without proxy variables: in Docker the
container sets up its own policy routing at start (it needs `NET_ADMIN` and its own network
namespace), so only that exit's traffic takes the other path and the host's routing is
untouched. [docs/deploy.md](docs/deploy.md#exits-through-another-interface-or-gateway) has a
Compose example.

### Modules

| Module      | Turn off when                                                                       |
| ----------- | ----------------------------------------------------------------------------------- |
| `downloads` | Off by default. Turn on where viewers may spend about 50 MB per download run.       |
| `host`      | Others on the network should not see this machine's interfaces, routes, and DNS.    |
| `egress`    | The host must not contact third-party IP information services. Or tune its sources. |

The server rejects unknown keys and misspelled built-in ids at startup, listing every problem
with its path and a suggestion where one is close.

Targets come only from this file. The web UI cannot add or edit URLs, so anyone who can open
the page can trigger measurements but cannot make the server request arbitrary addresses.

| Variable                  | Default                | Purpose                                      |
| ------------------------- | ---------------------- | -------------------------------------------- |
| `NETPROBE_PORT`           | `8080`                 | Listen port                                  |
| `NETPROBE_HOST`           | `0.0.0.0`              | Listen address                               |
| `NETPROBE_CONFIG`         | `config/netprobe.yaml` | Config file path                             |
| `NETPROBE_DATA`           | `data/netprobe.db`     | SQLite database path                         |
| `NETPROBE_HOST_LABEL`     | hostname               | Name shown in the UI and stored with runs    |
| `NETPROBE_ENVIRONMENT`    | auto-detected          | Force `container` or `host`                  |
| `NETPROBE_DOCKER_NETWORK` | unset                  | `host` or `bridge`; set by the Compose files |

## Safety

- One run at a time: runs started by several viewers wait in a queue and start in order.
- Throughput tests are off by default. When enabled they use three 10 MB files on speed-test
  hosts, one target at a time with a per-request size cap, and the UI shows the expected traffic
  before you start.
- Quick runs only fetch small responses (HEAD where possible). The Exit IP lookup adds one
  request of a few hundred bytes per Cloudflare-fronted host per run.
- Proxy credentials and signed URL parameters are redacted before anything is stored, logged,
  or sent to the browser. Request logs contain only method, route, and status.
- Cancelling a run kills its `curl` processes.
- The Egress page sends requests to third-party IP information services (ipinfo.io, ip-api.com,
  proxycheck.io, and others) only when you press Check; they see the host's public addresses.
- There is no authentication. Expose it on a trusted network only.

## Development

```bash
pnpm dev        # API on :8080 with reload, Vite on :5173
pnpm check      # lint, format, typecheck, tests
```

Tests run the real `curl` against a local fault-injection server that resets TLS handshakes,
stalls, truncates bodies, and resets mid-transfer (`test/fault-server.ts`).

## Scope

v0.1 covers quick diagnosis over HTTP and socket probes, per-site exit addresses, optional
download throughput, proxy and network-layer exits, live progress with a shared run queue,
history, and the Host and Egress pages.
Upload tests, scheduled background probing, stability runs, run-to-run comparison, and CSV
export are planned. Apple notarization is covered at the network-path level; submitting,
waiting for a verdict, and stapling need a macOS probe and are out of scope.
