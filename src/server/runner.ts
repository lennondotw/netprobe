import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

import type {
  Attempt,
  DownloadResult,
  EgressSnapshot,
  RunDetail,
  RunEvent,
  RunParams,
  RunRecord,
  RuntimeInfo,
  TargetResult,
} from '../shared/types.ts'
import { summarize, throughputOf, toAttempt, worstOutcome } from './classify.ts'
import type { ResolvedConfig, ResolvedEgress, ResolvedTarget } from './config.ts'
import { type CurlRequest, fetchText, runCurl } from './curl.ts'
import type { Store } from './db.ts'
import { runPing, runSocketProbe } from './probes/index.ts'
import { redactText } from './redact.ts'

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
      egress: {
        id: egress.id,
        name: egress.name,
        proxy: egress.proxy,
        publicIp: null,
        publicIpError: null,
      },
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
      record.egress = await this.#checkEgress(egress, record.params, abort.signal)
      this.#store.saveRun(record)
      emit({ type: 'run', run: { ...record } })

      const work = targets.map((target) => async () => {
        if (abort.signal.aborted) return
        const result = active.results.get(target.id)!
        result.status = 'running'
        emit({ type: 'target', result: { ...result } })

        if (record.params.mode === 'download')
          await this.#download(target, egress, record.params, result, abort.signal, emit)
        else await this.#probe(target, egress, record.params, result, abort.signal, emit)

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

  #request(target: ResolvedTarget, egress: ResolvedEgress, params: RunParams): CurlRequest {
    return {
      url: target.rawUrl,
      method: target.method,
      connectTimeoutMs: this.#config.probe.connectTimeoutMs,
      maxTimeMs: this.#config.probe.timeoutMs,
      ipFamily: params.ipFamily,
      proxy: egress.rawProxy,
      followRedirects: target.followRedirects,
      userAgent,
      headers: target.headers,
    }
  }

  async #probe(
    target: ResolvedTarget,
    egress: ResolvedEgress,
    params: RunParams,
    result: TargetResult,
    signal: AbortSignal,
    emit: (event: RunEvent) => void,
  ) {
    const repeats = Math.max(params.repeats, target.samples)
    const context = {
      connectTimeoutMs: this.#config.probe.connectTimeoutMs,
      timeoutMs: Math.min(this.#config.probe.timeoutMs, 3_000),
      ipFamily: params.ipFamily,
      signal,
    }

    if (target.kind === 'icmp') {
      // One ping process sends every echo at an even interval.
      const attempts = await runPing(target.rawUrl, repeats, context)
      result.attempts.push(...attempts.filter((a) => a.errorKind !== 'cancelled'))
      this.#refresh(result)
      emit({ type: 'target', result: { ...result } })
      return
    }

    const request = this.#request(target, egress, params)
    for (let seq = 1; seq <= repeats; seq++) {
      if (signal.aborted) break
      const startedAt = new Date().toISOString()
      const attempt =
        target.kind === 'http'
          ? toAttempt(await runCurl(request, signal), {
              seq,
              startedAt,
              expectStatus: target.expectStatus,
            })
          : await runSocketProbe(target.kind, target.rawUrl, { ...context, seq })
      if (attempt.errorKind !== 'cancelled') result.attempts.push(attempt)
      this.#refresh(result)
      emit({ type: 'target', result: { ...result } })
      // A short gap so repeats do not all land in the same congestion window.
      if (seq < repeats) await sleep(200, undefined, { signal }).catch(() => {})
    }
  }

  async #download(
    target: ResolvedTarget,
    egress: ResolvedEgress,
    params: RunParams,
    result: TargetResult,
    signal: AbortSignal,
    emit: (event: RunEvent) => void,
  ) {
    const base: CurlRequest = {
      ...this.#request(target, egress, params),
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
    params: RunParams,
    signal: AbortSignal,
  ): Promise<EgressSnapshot> {
    const snapshot: EgressSnapshot = {
      id: egress.id,
      name: egress.name,
      proxy: egress.proxy,
      publicIp: null,
      publicIpError: null,
    }
    try {
      const body = await fetchText(this.#config.publicIpCheckUrl, {
        proxy: egress.rawProxy,
        ipFamily: params.ipFamily,
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

/**
 * Whether a target belongs in a run. Socket-level probes (ICMP, TCP, DNS, STUN, QUIC) cannot be
 * sent through an HTTP or SOCKS proxy, so they only run on a direct egress.
 */
export const isEligible = (
  target: ResolvedTarget,
  mode: RunParams['mode'],
  egress: ResolvedEgress,
) => {
  if (mode === 'download') return target.download !== null
  if (target.download) return false
  return target.kind === 'http' || egress.rawProxy === null
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
