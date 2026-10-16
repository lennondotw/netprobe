# Netprobe

A self-hosted network diagnostics web app. Open it in a browser, pick services, and press
**Run test**: the server you deployed it on measures reachability, phase latency, and throughput
to GitHub, GitHub Actions, AWS, Vercel, Apple notarization, npm, and any HTTP(S) endpoint you add.

The browser only drives and displays. Every request is made by the server, so results describe
the network path of the machine Netprobe runs on — typically a CI runner or build host.

## What it answers

- **Where does it fail?** Each failure is attributed to DNS, TCP, TLS, HTTP, or the transfer,
  and classified (timeout, reset, refused, certificate, interrupted transfer, unexpected status).
- **Which targets are slow or flaky?** Every target is probed several times; the table shows
  per-phase medians, a request waterfall, and how many attempts succeeded. One failure in five
  shows as _Intermittent_, never as healthy.
- **How fast is the download path?** Download targets are measured over one connection and
  over several range-split connections, reported in Mbps and MB/s with the bytes received.
- **Does the exit matter?** Named HTTP/SOCKS proxies can be configured as egress options, and
  every run records the public IP it left from.

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

When remote addresses fall in `198.18.0.0/15`, a local proxy or TUN interface in fake-IP mode is
answering DNS and terminating TCP. Netprobe flags this: DNS and TCP timings then describe the
proxy, while TLS and time-to-first-byte still include the real path.

## Running it

### Docker Compose

```bash
cp config/netprobe.example.yaml config/netprobe.yaml   # optional
docker compose up -d --build
```

Open `http://<host>:8080`. History is stored in the `netprobe-data` volume and survives restarts.

### Directly on the host

Requires Node.js 24+ and `curl`.

```bash
pnpm install
pnpm build
pnpm start
```

Running on the host matters when the host routes traffic differently from containers — see
[containers vs. host](docs/deploy.md#containers-vs-host).

## Configuration

All configuration lives in one YAML file (`NETPROBE_CONFIG`, default `config/netprobe.yaml`).
[`config/netprobe.example.yaml`](config/netprobe.example.yaml) documents every option: probe
counts and timeouts, download limits, egress proxies, hiding presets, and adding targets.

Targets come only from this file. The web UI cannot add or edit URLs, so anyone who can open
the page can trigger measurements but cannot make the server request arbitrary addresses.

| Variable               | Default                | Purpose                                   |
| ---------------------- | ---------------------- | ----------------------------------------- |
| `NETPROBE_PORT`        | `8080`                 | Listen port                               |
| `NETPROBE_HOST`        | `0.0.0.0`              | Listen address                            |
| `NETPROBE_CONFIG`      | `config/netprobe.yaml` | Config file path                          |
| `NETPROBE_DATA`        | `data/netprobe.db`     | SQLite database path                      |
| `NETPROBE_HOST_LABEL`  | hostname               | Name shown in the UI and stored with runs |
| `NETPROBE_ENVIRONMENT` | auto-detected          | Force `container` or `host`               |

## Safety

- One run at a time. Downloads run one target at a time with a per-request size cap, and the UI
  shows the expected traffic before you start.
- Proxy credentials and signed URL parameters are redacted before anything is stored, logged,
  or sent to the browser. Request logs contain only method, route, and status.
- Cancelling a run kills its `curl` processes.
- There is no authentication. Expose it on a trusted network only.

## Development

```bash
pnpm dev        # API on :8080 with reload, Vite on :5173
pnpm check      # lint, format, typecheck, tests
```

Tests run the real `curl` against a local fault-injection server that resets TLS handshakes,
stalls, truncates bodies, and resets mid-transfer (`test/fault-server.ts`).

## Scope

v0.1 covers quick diagnosis, download throughput, egress selection, live progress, and history.
Upload tests, scheduled background probing, stability runs, run-to-run comparison, and CSV
export are planned. Apple notarization is covered at the network-path level; submitting,
waiting for a verdict, and stapling need a macOS probe and are out of scope.
