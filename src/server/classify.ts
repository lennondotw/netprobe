import type {
  Attempt,
  ErrorKind,
  Outcome,
  Phase,
  TargetSummary,
  Throughput,
} from '../shared/types.ts'
import type { CurlSample } from './curl.ts'
import { redactText, redactUrl } from './redact.ts'

const ms = (seconds: number) => Math.round(seconds * 1000 * 10) / 10

/**
 * The first phase that did not complete. curl leaves a phase's timestamp at zero until it
 * finishes, so the zeros tell us where a failed request stopped.
 */
export const stalledPhase = (sample: CurlSample): Phase => {
  if (sample.timeNamelookup <= 0 && sample.timeConnect <= 0) return 'dns'
  if (sample.timeConnect <= 0) return 'tcp'
  if (sample.scheme === 'https' && sample.timeAppconnect <= 0) return 'tls'
  if (sample.timeStarttransfer <= 0) return 'http'
  return 'transfer'
}

const looksLikeReset = (message: string) =>
  /reset by peer|connection reset|SSL_ERROR_SYSCALL|unexpected eof|ECONNRESET|errno 54|errno 104/i.test(
    message,
  )

/** Map a curl exit code to a failure kind and the phase it belongs to. */
export const classifyExit = (sample: CurlSample): { kind: ErrorKind; phase: Phase } => {
  const stalled = stalledPhase(sample)
  switch (sample.exitCode) {
    case 5:
      return { kind: 'proxy', phase: 'dns' }
    case 6:
      return { kind: 'dns_failure', phase: 'dns' }
    case 7:
      return { kind: 'connect_refused', phase: 'tcp' }
    case 28:
      return { kind: 'timeout', phase: stalled }
    case 35:
      return { kind: looksLikeReset(sample.errorMessage) ? 'reset' : 'tls_error', phase: 'tls' }
    case 51:
    case 58:
    case 60:
    case 77:
    case 83:
    case 90:
    case 91:
      return { kind: 'certificate', phase: 'tls' }
    case 52:
      return { kind: 'empty_reply', phase: 'http' }
    case 16:
    case 55:
    case 56:
    case 92:
      return { kind: 'reset', phase: stalled }
    case 18:
      return { kind: 'partial_transfer', phase: 'transfer' }
    case 97:
      return { kind: 'proxy', phase: 'tcp' }
    case 63:
      return { kind: 'size_mismatch', phase: 'transfer' }
    default:
      return { kind: 'other', phase: stalled }
  }
}

interface AttemptContext {
  seq: number
  startedAt: string
  expectStatus: readonly number[]
  /** For downloads: the body must be exactly this many bytes to count as transferred. */
  expectBytes?: number | null
  /** For downloads: success requires the body to have arrived in full. */
  requireTransfer?: boolean
}

const phaseDurations = (sample: CurlSample): Attempt['phases'] => {
  const dnsDone = sample.timeNamelookup > 0 || sample.timeConnect > 0
  const tcpDone = sample.timeConnect > 0
  const tlsDone = sample.scheme === 'https' && sample.timeAppconnect > 0
  const ttfbDone = sample.timeStarttransfer > 0
  return {
    dns: dnsDone ? ms(sample.timeNamelookup) : null,
    tcp: tcpDone ? ms(sample.timeConnect - sample.timeNamelookup) : null,
    tls: tlsDone ? ms(sample.timeAppconnect - sample.timeConnect) : null,
    ttfb: ttfbDone ? ms(sample.timeStarttransfer - sample.timePretransfer) : null,
  }
}

export const toAttempt = (sample: CurlSample, context: AttemptContext): Attempt => {
  const base = {
    seq: context.seq,
    startedAt: context.startedAt,
    curlExit: sample.exitCode,
    httpStatus: sample.httpCode > 0 ? sample.httpCode : null,
    httpVersion: sample.httpVersion && sample.httpVersion !== '0' ? sample.httpVersion : null,
    remoteIp: sample.remoteIp || null,
    remotePort: sample.remotePort || null,
    phases: phaseDurations(sample),
    totalMs: ms(sample.timeTotal),
    bytes: sample.sizeDownload,
    effectiveUrl: sample.urlEffective ? redactUrl(sample.urlEffective) : null,
  }

  if (sample.aborted) {
    return {
      ...base,
      outcome: 'failed',
      phase: null,
      errorKind: 'cancelled',
      errorMessage: 'Cancelled',
    }
  }

  if (sample.exitCode !== 0) {
    const { kind, phase } = classifyExit(sample)
    // A response that arrived before the failure still proves the server was reachable.
    const outcome: Outcome = sample.httpCode > 0 ? 'reachable' : 'failed'
    return {
      ...base,
      outcome,
      phase,
      errorKind: kind,
      errorMessage: redactText(sample.errorMessage) || `curl exit ${sample.exitCode}`,
    }
  }

  if (!context.expectStatus.includes(sample.httpCode)) {
    return {
      ...base,
      outcome: 'reachable',
      phase: 'http',
      errorKind: 'http_status',
      errorMessage: `HTTP ${sample.httpCode}, expected ${context.expectStatus.join(' or ')}`,
    }
  }

  if (context.requireTransfer) {
    if (context.expectBytes != null && sample.sizeDownload !== context.expectBytes) {
      return {
        ...base,
        outcome: 'expected',
        phase: 'transfer',
        errorKind: 'size_mismatch',
        errorMessage: `Received ${sample.sizeDownload} bytes, expected ${context.expectBytes}`,
      }
    }
    return { ...base, outcome: 'transferred', phase: null, errorKind: null, errorMessage: null }
  }

  return { ...base, outcome: 'expected', phase: null, errorKind: null, errorMessage: null }
}

const outcomeRank: Record<Outcome, number> = {
  failed: 0,
  reachable: 1,
  expected: 2,
  transferred: 3,
}

/** The lowest level every attempt reached: one failed attempt makes the target failed. */
export const worstOutcome = (outcomes: readonly Outcome[]): Outcome | null => {
  if (outcomes.length === 0) return null
  return outcomes.reduce((worst, next) => (outcomeRank[next] < outcomeRank[worst] ? next : worst))
}

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
  return Math.round(value * 10) / 10
}

const present = (values: readonly (number | null)[]) =>
  values.filter((value): value is number => value !== null)

export const summarize = (attempts: readonly Attempt[]): TargetSummary => {
  const counted = attempts.filter((attempt) => attempt.errorKind !== 'cancelled')
  const reached = (level: Outcome) =>
    counted.filter((attempt) => outcomeRank[attempt.outcome] >= outcomeRank[level]).length

  const errors = new Map<string, { kind: ErrorKind; phase: Phase | null; count: number }>()
  for (const attempt of counted) {
    if (!attempt.errorKind) continue
    const key = `${attempt.errorKind}:${attempt.phase}`
    const entry = errors.get(key) ?? { kind: attempt.errorKind, phase: attempt.phase, count: 0 }
    entry.count += 1
    errors.set(key, entry)
  }
  const topError = [...errors.values()].sort((a, b) => b.count - a.count)[0] ?? null

  const totals = counted.filter((attempt) => attempt.outcome !== 'failed').map((a) => a.totalMs)

  return {
    attempts: counted.length,
    reachable: reached('reachable'),
    expected: reached('expected'),
    failed: counted.length - reached('reachable'),
    median: {
      dns: median(present(counted.map((a) => a.phases.dns))),
      tcp: median(present(counted.map((a) => a.phases.tcp))),
      tls: median(present(counted.map((a) => a.phases.tls))),
      ttfb: median(present(counted.map((a) => a.phases.ttfb))),
      total: median(totals),
    },
    min: { total: totals.length ? Math.min(...totals) : null },
    max: { total: totals.length ? Math.max(...totals) : null },
    topError,
    remoteIps: [...new Set(counted.map((a) => a.remoteIp).filter((ip): ip is string => !!ip))],
  }
}

interface TimedSample {
  sample: CurlSample
  /** Seconds between the batch start and this process being spawned. */
  offset: number
}

/**
 * Throughput over the window in which bytes were actually flowing: from the earliest first byte
 * to the latest last byte across all connections. Setup time is reported separately as wall time.
 */
export const throughputOf = (samples: readonly TimedSample[], wallSeconds: number): Throughput => {
  const bytes = samples.reduce((sum, { sample }) => sum + sample.sizeDownload, 0)
  const firstByte = Math.min(...samples.map(({ sample, offset }) => offset + sample.timeStarttransfer))
  const lastByte = Math.max(...samples.map(({ sample, offset }) => offset + sample.timeTotal))
  const transferSeconds = Math.max(lastByte - firstByte, 0.001)
  return {
    connections: samples.length,
    bytes,
    transferSeconds: Math.round(transferSeconds * 1000) / 1000,
    wallSeconds: Math.round(wallSeconds * 1000) / 1000,
    bytesPerSecond: Math.round(bytes / transferSeconds),
    endToEndBytesPerSecond: Math.round(bytes / Math.max(wallSeconds, 0.001)),
  }
}
