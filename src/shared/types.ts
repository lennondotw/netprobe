/**
 * Types shared by the server and the web client. The server is the only writer; the client
 * treats everything here as already-validated data.
 */

export type RunMode = 'quick' | 'download'
export type IpFamily = 'auto' | 'ipv4' | 'ipv6'

/** The connection phase a failure is attributed to, in the order a request passes through them. */
export type Phase = 'dns' | 'tcp' | 'tls' | 'http' | 'transfer'

export type ErrorKind =
  | 'dns_failure'
  | 'connect_refused'
  | 'timeout'
  | 'tls_error'
  | 'certificate'
  | 'reset'
  | 'empty_reply'
  | 'partial_transfer'
  | 'proxy'
  | 'http_status'
  | 'size_mismatch'
  | 'range_unsupported'
  | 'packet_loss'
  | 'bad_response'
  | 'cancelled'
  | 'other'

/**
 * How a target is measured, taken from its URL scheme:
 * - `http`: `http(s)://` through curl, with per-phase timings and an expected status.
 * - `tcp`: `tcp://host:port`, a bare TCP connect.
 * - `dns`: `dns://server[:port]?name=…&type=A|AAAA`, one query over UDP.
 * - `dot`: `dot://server[:port]?name=…&sni=…`, the same query over TLS (DNS over TLS).
 * - `stun`: `stun://host[:port]`, a STUN binding request that reports the public mapped address.
 * - `quic`: `quic://host[:port]`, a QUIC version-negotiation exchange: proves UDP/QUIC reachability
 *   and measures round-trip time without a full handshake.
 * - `icmp`: `icmp://host`, echo requests through the system `ping`.
 */
export type ProbeKind = 'http' | 'tcp' | 'dns' | 'dot' | 'stun' | 'quic' | 'icmp'

/** An exact status code, or any code in a class. */
export type StatusMatcher = number | '2xx' | '3xx' | '4xx' | '5xx'

/**
 * How far a request got. Each level implies the ones before it:
 * - `reachable`: an HTTP response arrived (any status).
 * - `expected`: the status matched what the target declares as healthy.
 * - `transferred`: the full body arrived with the expected size (download tests only).
 */
export type Outcome = 'failed' | 'reachable' | 'expected' | 'transferred'

export interface Timings {
  /** Milliseconds from start until each phase completed, as curl reports them. */
  dns: number
  connect: number
  tls: number
  ttfb: number
  total: number
}

export interface Attempt {
  seq: number
  startedAt: string
  outcome: Outcome
  phase: Phase | null
  errorKind: ErrorKind | null
  errorMessage: string | null
  curlExit: number
  httpStatus: number | null
  httpVersion: string | null
  remoteIp: string | null
  remotePort: number | null
  /** Durations of each phase in milliseconds (not cumulative). Null when the phase never ran. */
  phases: { dns: number | null; tcp: number | null; tls: number | null; ttfb: number | null }
  totalMs: number
  bytes: number
  /** Effective URL after redirects, with credential-bearing query values redacted. */
  effectiveUrl: string | null
  /** Probe-specific result worth showing, e.g. a STUN mapped address or a DNS answer. */
  detail: string | null
}

export interface Throughput {
  connections: number
  bytes: number
  /** Seconds spent receiving the body, excluding connection setup and time to first byte. */
  transferSeconds: number
  /** Seconds from the first request to the last byte, including setup. */
  wallSeconds: number
  /** Bytes per second over `transferSeconds`. */
  bytesPerSecond: number
  /** Bytes per second over `wallSeconds`. */
  endToEndBytesPerSecond: number
}

export interface DownloadResult {
  mode: 'single' | 'multi'
  outcome: Outcome
  errorKind: ErrorKind | null
  errorMessage: string | null
  throughput: Throughput | null
  attempts: Attempt[]
}

export type TargetStatus = 'pending' | 'running' | 'done' | 'cancelled'

export interface TargetSummary {
  attempts: number
  /** Count of attempts per outcome level reached (an `expected` attempt also counts as reachable). */
  reachable: number
  expected: number
  failed: number
  /** Median phase durations across attempts that reached that phase. */
  median: {
    dns: number | null
    tcp: number | null
    tls: number | null
    ttfb: number | null
    total: number | null
  }
  min: { total: number | null }
  max: { total: number | null }
  /** Mean absolute difference between consecutive successful round trips, in ms. */
  jitter: number | null
  /** Most common failure among attempts, if any failed. */
  topError: { kind: ErrorKind; phase: Phase | null; count: number } | null
  remoteIps: string[]
  /** Distinct probe details across attempts (e.g. every STUN mapped address seen). */
  details: string[]
}

export interface TargetResult {
  targetId: string
  serviceId: string
  status: TargetStatus
  /** Worst-to-best: the lowest level every attempt reached. */
  outcome: Outcome | null
  summary: TargetSummary | null
  attempts: Attempt[]
  downloads: DownloadResult[]
}

export interface RuntimeInfo {
  hostLabel: string
  /** `container` when the server detects it runs in Docker; results may differ from the host. */
  environment: 'container' | 'host'
  platform: string
  curlVersion: string
}

export type RunStatus = 'running' | 'completed' | 'cancelled' | 'failed'

export interface EgressSnapshot {
  id: string
  name: string
  /** Proxy URL with credentials removed, or null for a direct connection. */
  proxy: string | null
  /** Public IP as seen by the configured echo endpoint, if it answered. */
  publicIp: string | null
  publicIpError: string | null
}

export interface RunParams {
  mode: RunMode
  egressId: string
  ipFamily: IpFamily
  repeats: number
  targetIds: string[]
}

export interface RunRecord {
  id: string
  createdAt: string
  finishedAt: string | null
  status: RunStatus
  params: RunParams
  egress: EgressSnapshot
  runtime: RuntimeInfo
  error: string | null
  totals: { targets: number; expected: number; reachable: number; failed: number }
}

export interface RunDetail extends RunRecord {
  results: TargetResult[]
}

export interface TargetInfo {
  id: string
  serviceId: string
  name: string
  kind: ProbeKind
  url: string
  method: 'GET' | 'HEAD'
  expectStatus: StatusMatcher[]
  /** Reachability-only targets answer with an error status by design (e.g. 401 without auth). */
  check: 'reachability' | 'response'
  /** `parallel`: whether a multi-connection (range split) measurement follows the single one. */
  download: { bytes: number | null; maxBytes: number; parallel: boolean } | null
  note: string | null
}

export interface ServiceInfo {
  id: string
  name: string
  description: string
  /** Display grouping for services, e.g. "Network" or "Developer". */
  category: string
  targets: TargetInfo[]
}

export interface EgressInfo {
  id: string
  name: string
  proxy: string | null
}

export interface AppConfig {
  services: ServiceInfo[]
  egress: EgressInfo[]
  defaults: { repeats: number; ipFamily: IpFamily; egressId: string }
  limits: { maxRepeats: number; downloadConnections: number }
  runtime: RuntimeInfo
  activeRunId: string | null
}

export interface LatestResult {
  runId: string
  createdAt: string
  egressId: string
  result: TargetResult
}

/** Server-sent events on `/api/runs/:id/events`. */
export type RunEvent =
  | { type: 'snapshot'; run: RunDetail }
  | { type: 'target'; result: TargetResult }
  | { type: 'run'; run: RunRecord }

export interface HostInterface {
  name: string
  /** Addresses in CIDR notation. */
  addresses: {
    family: 'IPv4' | 'IPv6'
    cidr: string
    scope: 'loopback' | 'link-local' | 'private' | 'public' | 'special'
  }[]
  mac: string | null
  mtu: number | null
  internal: boolean
  /** Tunnel interfaces (utun, tun, wg, tailscale): usually a VPN or a proxy in TUN mode. */
  tunnel: boolean
  /** What the interface appears to be, recognised from its addresses (e.g. "Tailscale"). */
  role: string | null
}

export interface HostProxySetting {
  label: string
  value: string
}

/** A snapshot of the machine the server runs on, as seen from the server process. */
export interface HostInfo {
  collectedAt: string
  runtime: RuntimeInfo
  system: {
    hostname: string
    model: string | null
    os: string
    kernel: string
    arch: string
    cpu: string
    cpuCount: number
    memoryBytes: number
    freeMemoryBytes: number
    uptimeSeconds: number
    loadAverage: [number, number, number]
    timezone: string
    nodeVersion: string
    curlFeatures: string[]
  }
  network: {
    gateways: { family: 'IPv4' | 'IPv6'; gateway: string; interface: string | null }[]
    dnsServers: string[]
    searchDomains: string[]
    /** What the system resolver returns for a well-known name, to spot fake-IP DNS. */
    resolverCheck: { name: string; addresses: string[]; error: string | null }
  }
  proxy: {
    system: HostProxySetting[]
    environment: HostProxySetting[]
  }
  interfaces: HostInterface[]
  /** macOS-only: the mDNSResponder resolver stack, Bonjour names, and Network Extensions. */
  macos: MacNetworkInfo | null
  /** Collectors that failed or are not supported on this platform. */
  unavailable: string[]
}

export interface MacResolver {
  /** `default` serves ordinary lookups; `domain` resolvers handle one suffix; `scoped` bind to an interface. */
  kind: 'default' | 'domain' | 'scoped'
  domain: string | null
  nameservers: string[]
  interface: string | null
  /** Resolved by multicast DNS (Bonjour) rather than a server. */
  mdns: boolean
  order: number | null
  reachable: boolean | null
}

export interface MacNetworkInfo {
  /** Bonjour name; the machine answers to `<localHostName>.local` on the LAN. */
  localHostName: string | null
  computerName: string | null
  /** Network services in priority order, as System Settings lists them. */
  serviceOrder: { name: string; enabled: boolean }[]
  resolvers: MacResolver[]
  systemExtensions: {
    name: string
    bundleId: string
    version: string
    category: string
    state: string
    enabled: boolean
  }[]
  /** VPN and Network Extension configurations (packet tunnels, proxies) and their status. */
  vpnServices: {
    name: string
    provider: string | null
    type: string
    status: string
    enabled: boolean
  }[]
}
