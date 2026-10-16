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
  | 'cancelled'
  | 'other'

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
  /** Most common failure among attempts, if any failed. */
  topError: { kind: ErrorKind; phase: Phase | null; count: number } | null
  remoteIps: string[]
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
  url: string
  method: 'GET' | 'HEAD'
  expectStatus: number[]
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
