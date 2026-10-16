import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { performance } from 'node:perf_hooks'

import type { Attempt, ErrorKind, IpFamily, Phase } from '../../shared/types.ts'
import { redactText } from '../redact.ts'

export interface ProbeContext {
  seq: number
  connectTimeoutMs: number
  timeoutMs: number
  ipFamily: IpFamily
  signal: AbortSignal
}

/** Timings collected while a probe runs, in ms from the probe's start. */
export interface ProbeTimings {
  dns: number | null
  connect: number | null
  tls: number | null
  response: number | null
}

export class ProbeError extends Error {
  readonly kind: ErrorKind
  readonly phase: Phase | null

  constructor(kind: ErrorKind, phase: Phase | null, message: string) {
    super(message)
    this.kind = kind
    this.phase = phase
  }
}

export const now = () => performance.now()

const familyNumber = (family: IpFamily) => (family === 'ipv4' ? 4 : family === 'ipv6' ? 6 : 0)

/** Resolve through the system resolver, as other clients on the host would. */
export const resolve = async (
  host: string,
  family: IpFamily,
): Promise<{ address: string; family: 4 | 6; resolved: boolean }> => {
  const literal = isIP(host)
  if (literal) {
    if ((family === 'ipv4' && literal !== 4) || (family === 'ipv6' && literal !== 6)) {
      throw new ProbeError('dns_failure', 'dns', `${host} is not an ${family} address`)
    }
    return { address: host, family: literal as 4 | 6, resolved: false }
  }
  try {
    const result = await lookup(host, { family: familyNumber(family) })
    return { address: result.address, family: result.family as 4 | 6, resolved: true }
  } catch (error) {
    throw new ProbeError('dns_failure', 'dns', errorMessage(error))
  }
}

export const errorMessage = (error: unknown) =>
  redactText(error instanceof Error ? error.message : String(error))

/** Map a Node socket or TLS error to a failure kind, attributed to the phase in progress. */
export const fromNodeError = (error: unknown, phase: Phase | null): ProbeError => {
  if (error instanceof ProbeError) return error
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = errorMessage(error)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME')
    return new ProbeError('dns_failure', 'dns', message)
  if (code === 'ECONNREFUSED') return new ProbeError('connect_refused', 'tcp', message)
  if (code === 'ECONNRESET' || code === 'EPIPE') return new ProbeError('reset', phase, message)
  if (code === 'ETIMEDOUT') return new ProbeError('timeout', phase, message)
  if (/CERT|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|ERR_TLS_CERT/.test(code))
    return new ProbeError('certificate', 'tls', message)
  if (code.startsWith('ERR_SSL') || code.startsWith('ERR_TLS'))
    return new ProbeError('tls_error', 'tls', message)
  return new ProbeError('other', phase, message || code || 'Unknown error')
}

/**
 * Race a probe against its timeout and the run's abort signal. `phase` reports where the probe was
 * when time ran out, so a timeout is attributed like curl's.
 */
export const withTimeout = <T>(
  work: (track: (phase: Phase | null) => void) => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  cleanup: () => void,
): Promise<T> =>
  new Promise((resolvePromise, reject) => {
    let phase: Phase | null = 'dns'
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      cleanup()
    }
    const onAbort = () => {
      finish()
      reject(new ProbeError('cancelled', null, 'Cancelled'))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new ProbeError('timeout', phase, `No response within ${timeoutMs} ms`))
    }, timeoutMs)
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    work((next) => (phase = next)).then(
      (value) => {
        finish()
        resolvePromise(value)
      },
      (error: unknown) => {
        finish()
        reject(fromNodeError(error, phase))
      },
    )
  })

const round = (value: number) => Math.round(value * 10) / 10

interface AttemptInput {
  seq: number
  startedAt: string
  started: number
  timings: ProbeTimings
  remoteIp: string | null
  remotePort: number | null
  detail?: string | null
  error?: ProbeError | null
}

/**
 * Build an attempt from cumulative timings. Phases follow the same meaning as for HTTP: lookup,
 * connect, handshake, then waiting for the first response byte (or datagram).
 */
export const toProbeAttempt = ({
  seq,
  startedAt,
  started,
  timings,
  remoteIp,
  remotePort,
  detail = null,
  error = null,
}: AttemptInput): Attempt => {
  const { dns, connect, tls, response } = timings
  const before = (...values: (number | null)[]) => values.find((v) => v !== null) ?? 0
  const cancelled = error?.kind === 'cancelled'
  return {
    seq,
    startedAt,
    outcome: error ? 'failed' : 'expected',
    phase: error && !cancelled ? error.phase : null,
    errorKind: error?.kind ?? null,
    errorMessage: error?.message ?? null,
    curlExit: 0,
    httpStatus: null,
    httpVersion: null,
    remoteIp,
    remotePort,
    phases: {
      dns: dns === null ? null : round(dns),
      tcp: connect === null ? null : round(connect - before(dns)),
      tls: tls === null ? null : round(tls - before(connect, dns)),
      ttfb: response === null ? null : round(response - before(tls, connect, dns)),
    },
    totalMs: round(
      error ? now() - started : (response ?? tls ?? connect ?? dns ?? now() - started),
    ),
    bytes: 0,
    effectiveUrl: null,
    detail,
  }
}
