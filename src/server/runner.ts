import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

import type {
  Attempt,
  DownloadResult,
  EgressSnapshot,
  ExitObservation,
  HandshakeResult,
  RunDetail,
  RunEvent,
  RunParams,
  RunRecord,
  RuntimeInfo,
  TargetResult,
  TlsOffer,
} from '../shared/types.ts'
import { summarize, throughputOf, toAttempt, worstOutcome } from './classify.ts'
import type { ResolvedConfig, ResolvedEgress, ResolvedTarget } from './config.ts'
import { type CurlRequest, fetchText, runCurl } from './curl.ts'
import type { Store } from './db.ts'
import {
  type ExitBinding,
  type ExitRoute,
  resolveEntries,
  routeFor,
  unroutedMessage,
} from './exits.ts'
import { now, ProbeError, type ProbeContext, toProbeAttempt } from './probes/common.ts'
import { runPing, runSocketProbe } from './probes/index.ts'
import { redactText } from './redact.ts'
import { traceExit } from './trace.ts'

const userAgent = 'netprobe/0.1 (+https://github.com/)'

interface ActiveRun {
  record: RunRecord
  results: Map<string, TargetResult>
  abort: AbortController
  events: EventEmitter<{ event: [RunEvent] }>
  targets: ResolvedTarget[]
  egress: ResolvedEgress
}

export const isFinished = (status: RunRecord['status']) =>
  status === 'completed' || status === 'cancelled' || status === 'failed'

/**
 * Executes one run at a time and queues the rest in arrival order. Runs are serialised on purpose:
 * overlapping measurements skew each other, and the host usually has more important traffic (CI
 * jobs) than ours. Anyone can start a run at any time; it simply waits its turn.
 */
export class Runner {
  #active: ActiveRun | null = null
  readonly #queue: ActiveRun[] = []
  /** Every run that is running or queued, by id. */
  readonly #runs = new Map<string, ActiveRun>()
  readonly #config: ResolvedConfig
  readonly #store: Store
  readonly #runtime: RuntimeInfo
  /** Cloudflare traces for the current run, one per host however many targets share it. */
  #traces = new Map<string, Promise<ExitObservation | null>>()
  /** Node TLS handshakes for the current run, one series per host and offer. */
  #handshakes = new Map<string, Promise<HandshakeResult>>()

  constructor(config: ResolvedConfig, store: Store, runtime: RuntimeInfo) {
    this.#config = config
    this.#store = store
    this.#runtime = runtime
  }

  get activeRunId() {
    return this.#active?.record.id ?? null
  }

  get queuedRunIds() {
    return this.#queue.map((run) => run.record.id)
  }

  /** Snapshot of a running or queued run, or null if `id` is neither. */
  activeDetail(id: string): RunDetail | null {
    const run = this.#runs.get(id)
    if (!run) return null
    return { ...run.record, results: [...run.results.values()] }
  }

  subscribe(id: string, listener: (event: RunEvent) => void): (() => void) | null {
    const run = this.#runs.get(id)
    if (!run) return null
    run.events.on('event', listener)
    return () => run.events.off('event', listener)
  }

  start(params: RunParams): RunRecord {
    const egress = this.#config.egress.find((e) => e.id === params.egressId)
    if (!egress) throw new Error(`Unknown egress "${params.egressId}".`)
    const targets = params.targetIds.map((id) => {
      const target = this.#config.targets.get(id)
      if (!target) throw new Error(`Unknown target "${id}".`)
      return target
    })
    const eligible = targets.filter((t) => isEligible(t, params.mode, egress))
    if (eligible.length === 0) throw new Error('No selected target supports this mode and egress.')

    const record: RunRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      finishedAt: null,
      status: 'queued',
      queueAhead: null,
      params: { ...params, targetIds: eligible.map((t) => t.id) },
      egress: snapshotOf(egress),
      runtime: this.#runtime,
      error: null,
      totals: { targets: eligible.length, expected: 0, reachable: 0, failed: 0 },
    }
    const results = new Map(
      eligible.map((t): [string, TargetResult] => [
        t.id,
        {
          targetId: t.id,
          serviceId: t.serviceId,
          status: 'pending',
          outcome: null,
          summary: null,
          attempts: [],
          downloads: [],
          exit: null,
          handshakes: [],
        },
      ]),
    )
    const run: ActiveRun = {
      record,
      results,
      abort: new AbortController(),
      events: new EventEmitter(),
      targets: eligible,
      egress,
    }
    this.#runs.set(record.id, run)
    this.#queue.push(run)
    this.#publishQueue()
    if (!this.#active) this.#launchNext()
    return { ...run.record }
  }

  cancel(id: string): boolean {
    const run = this.#runs.get(id)
    if (!run) return false
    if (run === this.#active) {
      run.abort.abort()
      return true
    }
    // A queued run never started: drop it from the queue and close it out.
    this.#queue.splice(this.#queue.indexOf(run), 1)
    run.record.status = 'cancelled'
    run.record.queueAhead = null
    run.record.finishedAt = new Date().toISOString()
    for (const result of run.results.values()) result.status = 'cancelled'
    this.#store.saveRun(run.record)
    this.#runs.delete(id)
    run.events.emit('event', { type: 'run', run: { ...run.record } })
    this.#publishQueue()
    return true
  }

  /** Cancel everything and wait briefly for curl processes to exit. */
  async shutdown() {
    // Iterate over a copy: cancelling removes runs from the queue.
    for (const run of this.#queue.slice()) this.cancel(run.record.id)
    this.#active?.abort.abort()
    for (let i = 0; i < 50 && this.#active; i++) await sleep(20)
  }

  /** Tell every queued run how many runs are ahead of it. */
  #publishQueue() {
    const offset = this.#active ? 1 : 0
    this.#queue.forEach((run, index) => {
      const ahead = index + offset
      if (run.record.queueAhead === ahead && run.record.status === 'queued') return
      run.record.queueAhead = ahead
      this.#store.saveRun(run.record)
      run.events.emit('event', { type: 'run', run: { ...run.record } })
    })
  }

  #launchNext() {
    const run = this.#queue.shift()
    if (!run) return
    this.#active = run
    run.record.status = 'running'
    run.record.queueAhead = null
    this.#store.saveRun(run.record)
    run.events.emit('event', { type: 'run', run: { ...run.record } })
    this.#publishQueue()
    void this.#execute(run, run.targets, run.egress).finally(() => {
      this.#runs.delete(run.record.id)
      this.#active = null
      this.#launchNext()
      this.#publishQueue()
    })
  }

  async #execute(active: ActiveRun, targets: ResolvedTarget[], egress: ResolvedEgress) {
    const { record, abort } = active
    const emit = (event: RunEvent) => active.events.emit('event', event)
    try {
      const exit = routeFor(egress, record.params.ipFamily)
      this.#traces = new Map()
      this.#handshakes = new Map()
      record.egress = await this.#checkEgress(egress, exit, abort.signal)
      this.#store.saveRun(record)
      emit({ type: 'run', run: { ...record } })

      const work = targets.map((target) => async () => {
        if (abort.signal.aborted) return
        const result = active.results.get(target.id)!
        result.status = 'running'
        emit({ type: 'target', result: { ...result } })

        if (record.params.mode === 'download')
          await this.#download(target, egress, exit, result, abort.signal, emit)
        else await this.#probe(target, egress, exit, record.params, result, abort.signal, emit)

        result.status = abort.signal.aborted ? 'cancelled' : 'done'
        this.#store.saveResult(record.id, result)
        this.#tally(active)
        emit({ type: 'target', result: { ...result } })
      })

      // Downloads run one target at a time so they do not compete for bandwidth.
      const concurrency = record.params.mode === 'download' ? 1 : this.#config.probe.concurrency
      await pool(work, concurrency)

      record.status = abort.signal.aborted ? 'cancelled' : 'completed'
    } catch (error) {
      record.status = 'failed'
      record.error = redactText(error instanceof Error ? error.message : String(error))
    }

    for (const result of active.results.values()) {
      if (result.status === 'pending' || result.status === 'running') {
        result.status = 'cancelled'
        this.#store.saveResult(record.id, result)
      }
    }
    record.finishedAt = new Date().toISOString()
    this.#tally(active)
    this.#store.saveRun(record)
    emit({ type: 'run', run: { ...record } })
  }

  #tally(active: ActiveRun) {
    const done = [...active.results.values()].filter((r) => r.outcome !== null)
    const rank = (r: TargetResult) => r.outcome
    active.record.totals = {
      targets: active.results.size,
      expected: done.filter((r) => rank(r) === 'expected' || rank(r) === 'transferred').length,
      reachable: done.filter((r) => rank(r) === 'reachable').length,
      failed: done.filter((r) => rank(r) === 'failed').length,
    }
    this.#store.saveRun(active.record)
  }

  #request(target: ResolvedTarget, egress: ResolvedEgress, exit: ExitRoute): CurlRequest {
    return {
      interface: exit.binding?.interface ?? null,
      url: target.rawUrl,
      method: target.method,
      connectTimeoutMs: this.#config.probe.connectTimeoutMs,
      maxTimeMs: this.#config.probe.timeoutMs,
      ipFamily: exit.ipFamily,
      proxy: egress.rawProxy,
      followRedirects: target.followRedirects,
      userAgent,
      headers: target.headers,
    }
  }

  async #probe(
    target: ResolvedTarget,
    egress: ResolvedEgress,
    exit: ExitRoute,
    params: RunParams,
    result: TargetResult,
    signal: AbortSignal,
    emit: (event: RunEvent) => void,
  ) {
    const repeats = Math.max(params.repeats, target.samples)
    const context = {
      connectTimeoutMs: this.#config.probe.connectTimeoutMs,
      timeoutMs: Math.min(this.#config.probe.timeoutMs, 3_000),
      ipFamily: exit.ipFamily,
      signal,
      bind: exit.binding,
      resolver: exit.resolver,
    }

    if (target.kind === 'icmp') {
      // One ping process sends every echo at an even interval.
      const attempts = await runPing(target.rawUrl, repeats, context)
      result.attempts.push(...attempts.filter((a) => a.errorKind !== 'cancelled'))
      this.#refresh(result)
      emit({ type: 'target', result: { ...result } })
      return
    }

    const request = this.#request(target, egress, exit)
    // The host whose response came through Cloudflare, after redirects.
    let cloudflareHost: string | null = null
    for (let seq = 1; seq <= repeats; seq++) {
      if (signal.aborted) break
      const startedAt = new Date().toISOString()
      const attempt =
        target.kind === 'http'
          ? await this.#httpAttempt(request, exit, target, seq, startedAt, signal, (host) => {
              cloudflareHost = host
            })
          : exit.binding && !exit.routed
            ? unrouted(exit.binding, seq, startedAt)
            : await runSocketProbe(target.kind, target.rawUrl, { ...context, seq })
      if (attempt.errorKind !== 'cancelled') result.attempts.push(attempt)
      this.#refresh(result)
      emit({ type: 'target', result: { ...result } })
      // A short gap so repeats do not all land in the same congestion window.
      if (seq < repeats) await sleep(200, undefined, { signal }).catch(() => {})
    }

    if (cloudflareHost && !signal.aborted) {
      result.exit = await this.#trace(cloudflareHost, egress, exit, signal)
      emit({ type: 'target', result: { ...result } })
    }

    // Handshakes are socket-level: through a proxy, or on an exit sockets cannot follow, they
    // would measure a different path, so they are skipped there.
    const url = new URL(target.rawUrl)
    const socketsFollowExit = egress.kind !== 'proxy' && (!exit.binding || exit.routed)
    if (target.kind === 'http' && url.protocol === 'https:' && socketsFollowExit) {
      const endpoint = `${url.hostname}:${url.port || 443}`
      for (const offer of params.tlsHandshakes) {
        if (signal.aborted) break
        // A longer limit than other probes, so a slow handshake is not mistaken for a dropped one.
        const handshakeContext = {
          ...context,
          timeoutMs: Math.min(this.#config.probe.timeoutMs, 8_000),
        }
        result.handshakes.push(await this.#handshake(endpoint, offer, repeats, handshakeContext))
        emit({ type: 'target', result: { ...result } })
      }
    }
  }

  #handshake(
    endpoint: string,
    offer: TlsOffer,
    repeats: number,
    context: Omit<ProbeContext, 'seq'>,
  ) {
    const key = `${endpoint}|${offer}`
    let pending = this.#handshakes.get(key)
    if (!pending) {
      pending = handshakeSeries(endpoint, offer, repeats, context)
      this.#handshakes.set(key, pending)
    }
    return pending
  }

  #trace(host: string, egress: ResolvedEgress, exit: ExitRoute, signal: AbortSignal) {
    let pending = this.#traces.get(host)
    if (!pending) {
      pending = traceExit(host, {
        proxy: egress.rawProxy,
        interface: exit.binding?.interface ?? null,
        resolver: exit.resolver,
        ipFamily: exit.ipFamily,
        timeoutMs: 5_000,
        signal,
        userAgent,
      })
      this.#traces.set(host, pending)
    }
    return pending
  }

  /**
   * One curl attempt. With an exit resolver, the lookup happens here and curl gets the address
   * pinned; its time is added back as the DNS phase so the total stays honest.
   */
  async #httpAttempt(
    request: CurlRequest,
    exit: ExitRoute,
    target: ResolvedTarget,
    seq: number,
    startedAt: string,
    signal: AbortSignal,
    onCloudflare: (host: string) => void,
  ): Promise<Attempt> {
    const started = now()
    let resolve: string[]
    try {
      resolve = await resolveEntries(request.url, exit.resolver, exit.ipFamily)
    } catch (error) {
      return dnsFailure(error, seq, startedAt, started)
    }
    const lookupMs = resolve.length > 0 ? now() - started : 0
    const sample = await runCurl({ ...request, resolve }, signal)
    if (sample.cfRay && sample.urlEffective) onCloudflare(new URL(sample.urlEffective).host)
    const attempt = toAttempt(sample, {
      seq,
      startedAt,
      expectStatus: target.expectStatus,
    })
    if (lookupMs > 0) {
      const round = (value: number) => Math.round(value * 10) / 10
      attempt.phases.dns = round((attempt.phases.dns ?? 0) + lookupMs)
      attempt.totalMs = round(attempt.totalMs + lookupMs)
    }
    return attempt
  }

  async #download(
    target: ResolvedTarget,
    egress: ResolvedEgress,
    exit: ExitRoute,
    result: TargetResult,
    signal: AbortSignal,
    emit: (event: RunEvent) => void,
  ) {
    let resolve: string[]
    try {
      resolve = await resolveEntries(target.rawUrl, exit.resolver, exit.ipFamily)
    } catch (error) {
      result.attempts.push(dnsFailure(error, 1, new Date().toISOString(), now()))
      this.#refresh(result)
      emit({ type: 'target', result: { ...result } })
      return
    }
    const base: CurlRequest = {
      ...this.#request(target, egress, exit),
      resolve,
      method: 'GET',
      maxTimeMs: this.#config.download.timeoutMs,
      maxFilesize: this.#config.download.maxBytes,
    }

    // Single connection: the whole file, which also tells us its size for the range split.
    const single = await this.#downloadBatch(
      [base],
      target.download?.bytes ?? null,
      'single',
      target,
      signal,
    )
    result.downloads.push(single)
    this.#refresh(result)
    emit({ type: 'target', result: { ...result } })

    const size = single.throughput?.bytes ?? 0
    const connections = this.#config.download.connections
    if (
      signal.aborted ||
      target.parallel !== 'range' ||
      single.outcome !== 'transferred' ||
      size < connections
    )
      return

    const chunk = Math.ceil(size / connections)
    const requests = Array.from({ length: connections }, (_, i): CurlRequest => {
      const start = i * chunk
      const end = Math.min(size, start + chunk) - 1
      // A server that ignores Range replies 200 with the full length; the size cap stops it early.
      return { ...base, range: `${start}-${end}`, maxFilesize: end - start + 1 }
    })
    const multi = await this.#downloadBatch(requests, size, 'multi', target, signal)
    result.downloads.push(multi)
    this.#refresh(result)
    emit({ type: 'target', result: { ...result } })
  }

  async #downloadBatch(
    requests: CurlRequest[],
    expectBytes: number | null,
    mode: DownloadResult['mode'],
    target: ResolvedTarget,
    signal: AbortSignal,
  ): Promise<DownloadResult> {
    const batchStart = performance.now()
    const startedAt = new Date().toISOString()
    const timed = await Promise.all(
      requests.map(async (request) => {
        const offset = (performance.now() - batchStart) / 1000
        return { sample: await runCurl(request, signal), offset }
      }),
    )
    const wallSeconds = (performance.now() - batchStart) / 1000
    const expectStatus = mode === 'multi' ? [206] : target.expectStatus
    const attempts: Attempt[] = timed.map(({ sample }, i) =>
      toAttempt(sample, {
        seq: i + 1,
        startedAt,
        expectStatus,
        expectBytes: mode === 'single' ? expectBytes : null,
        requireTransfer: true,
      }),
    )

    let outcome = worstOutcome(attempts.map((a) => a.outcome)) ?? 'failed'
    let failure = attempts.find((a) => a.errorKind) ?? null
    let errorKind = failure?.errorKind ?? null
    let errorMessage = failure?.errorMessage ?? null

    if (mode === 'multi') {
      const total = timed.reduce((sum, { sample }) => sum + sample.sizeDownload, 0)
      if (attempts.some((a) => a.httpStatus === 200 || a.curlExit === 63)) {
        errorKind = 'range_unsupported'
        errorMessage =
          'The server ignored the Range header; multi-connection throughput is not measurable.'
        outcome = 'reachable'
      } else if (!failure && expectBytes !== null && total !== expectBytes) {
        errorKind = 'size_mismatch'
        errorMessage = `Received ${total} bytes across connections, expected ${expectBytes}`
        outcome = 'expected'
      }
    }

    const measurable = outcome === 'transferred' || (mode === 'single' && attempts[0]!.bytes > 0)
    return {
      mode,
      outcome,
      errorKind,
      errorMessage,
      throughput: measurable ? throughputOf(timed, wallSeconds) : null,
      attempts,
    }
  }

  #refresh(result: TargetResult) {
    if (result.downloads.length > 0) {
      result.outcome = worstOutcome(
        result.downloads.filter((d) => d.errorKind !== 'range_unsupported').map((d) => d.outcome),
      )
      result.summary = summarize(result.downloads.flatMap((d) => d.attempts))
      return
    }
    result.outcome = worstOutcome(result.attempts.map((a) => a.outcome))
    result.summary = summarize(result.attempts)
  }

  async #checkEgress(
    egress: ResolvedEgress,
    exit: ExitRoute,
    signal: AbortSignal,
  ): Promise<EgressSnapshot> {
    const snapshot = snapshotOf(egress)
    try {
      const body = await fetchText(this.#config.publicIpCheckUrl, {
        proxy: egress.rawProxy,
        interface: exit.binding?.interface ?? null,
        resolver: exit.resolver,
        ipFamily: exit.ipFamily,
        timeoutMs: this.#config.probe.timeoutMs,
        signal,
      })
      const fromTrace = /^ip=(.+)$/m.exec(body)?.[1]?.trim()
      const bare = body.trim()
      snapshot.publicIp = fromTrace ?? (/^[0-9a-f.:]+$/i.test(bare) ? bare : null)
      if (!snapshot.publicIp)
        snapshot.publicIpError = 'The echo endpoint did not return an IP address.'
    } catch (error) {
      snapshot.publicIpError = redactText(error instanceof Error ? error.message : String(error))
    }
    return snapshot
  }
}

const offerQuery: Record<TlsOffer, string> = {
  default: '',
  classic: '?groups=X25519:P-256',
  tls12: '?version=1.2',
}

/** Repeated handshakes with one offer, a short gap apart, summarised. */
const handshakeSeries = async (
  endpoint: string,
  offer: TlsOffer,
  repeats: number,
  context: Omit<ProbeContext, 'seq'>,
): Promise<HandshakeResult> => {
  const attempts: Attempt[] = []
  for (let seq = 1; seq <= repeats; seq++) {
    if (context.signal.aborted) break
    const attempt = await runSocketProbe('tls', `tls://${endpoint}${offerQuery[offer]}`, {
      ...context,
      seq,
    })
    if (attempt.errorKind !== 'cancelled') attempts.push(attempt)
    if (seq < repeats) await sleep(200, undefined, { signal: context.signal }).catch(() => {})
  }
  const ok = attempts.filter((a) => !a.errorKind)
  const times = ok.map((a) => a.phases.tls).filter((t): t is number => t !== null)
  const errors: HandshakeResult['errors'] = {}
  for (const a of attempts) if (a.errorKind) errors[a.errorKind] = (errors[a.errorKind] ?? 0) + 1
  return {
    offer,
    endpoint,
    attempts: attempts.length,
    succeeded: ok.length,
    medianMs: median(times),
    negotiated: ok[0]?.detail ?? null,
    errors,
    sampleError: attempts.find((a) => a.errorKind)?.errorMessage ?? null,
  }
}

const median = (values: number[]) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
  return Math.round(value * 10) / 10
}

const snapshotOf = (egress: ResolvedEgress): EgressSnapshot => ({
  id: egress.id,
  name: egress.name,
  kind: egress.kind,
  proxy: egress.proxy,
  detail: egress.detail,
  publicIp: null,
  publicIpError: null,
})

/** A failed lookup through the exit's own resolver, recorded like any other DNS failure. */
const dnsFailure = (error: unknown, seq: number, startedAt: string, started: number) =>
  toProbeAttempt({
    seq,
    startedAt,
    started,
    timings: { dns: null, connect: null, tls: null, response: null },
    remoteIp: null,
    remotePort: null,
    error: new ProbeError(
      'dns_failure',
      'dns',
      redactText(error instanceof Error ? error.message : String(error)),
    ),
  })

/**
 * A socket probe on a bound exit without policy routing would silently take the default route,
 * measuring the wrong path; record why it did not run instead.
 */
const unrouted = (binding: ExitBinding, seq: number, startedAt: string): Attempt => ({
  ...toProbeAttempt({
    seq,
    startedAt,
    started: now(),
    timings: { dns: null, connect: null, tls: null, response: null },
    remoteIp: null,
    remotePort: null,
    error: new ProbeError('other', null, unroutedMessage(binding)),
  }),
  totalMs: 0,
})

/**
 * Whether a target belongs in a run. Socket-level probes (ICMP, TCP, DNS, STUN, QUIC) cannot be
 * sent through an HTTP or SOCKS proxy, so they are skipped on proxy exits.
 */
export const isEligible = (
  target: ResolvedTarget,
  mode: RunParams['mode'],
  egress: ResolvedEgress,
) => {
  if (mode === 'download') return target.download !== null
  if (target.download) return false
  return target.kind === 'http' || egress.kind !== 'proxy'
}

/** Run async tasks with at most `limit` in flight. */
const pool = async (tasks: (() => Promise<void>)[], limit: number) => {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++]!
      await task()
    }
  })
  await Promise.all(workers)
}
