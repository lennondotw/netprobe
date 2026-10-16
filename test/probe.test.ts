import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toAttempt } from '../src/server/classify.ts'
import { type CurlRequest, runCurl } from '../src/server/curl.ts'
import { type FaultServers, startFaultServers } from './fault-server.ts'

let servers: FaultServers

beforeAll(async () => {
  servers = await startFaultServers()
})
afterAll(async () => {
  await servers.close()
})

const request = (url: string, overrides: Partial<CurlRequest> = {}): CurlRequest => ({
  url,
  method: 'GET',
  connectTimeoutMs: 2000,
  maxTimeMs: 3000,
  ipFamily: 'auto',
  proxy: null,
  followRedirects: false,
  userAgent: 'netprobe-test',
  ...overrides,
})

const probe = async (url: string, overrides: Partial<CurlRequest> = {}, expectStatus = [200]) => {
  const sample = await runCurl(request(url, overrides), new AbortController().signal)
  return toAttempt(sample, { seq: 1, startedAt: new Date().toISOString(), expectStatus })
}

describe('classification against real curl', () => {
  it('reports a healthy response as expected, with phase timings', async () => {
    const attempt = await probe(`${servers.http}/ok`)
    expect(attempt).toMatchObject({ outcome: 'expected', errorKind: null, httpStatus: 200 })
    expect(attempt.phases.tcp).not.toBeNull()
    expect(attempt.phases.tls).toBeNull()
  })

  it('separates an HTTP error from a network failure', async () => {
    const attempt = await probe(`${servers.http}/status/500`)
    expect(attempt).toMatchObject({ outcome: 'reachable', errorKind: 'http_status', phase: 'http' })
  })

  it('accepts an error status when the target declares it as expected', async () => {
    const attempt = await probe(`${servers.http}/status/500`, {}, [500])
    expect(attempt.outcome).toBe('expected')
  })

  it('detects a refused connection in the TCP phase', async () => {
    const attempt = await probe(`${servers.closed}/`)
    expect(attempt).toMatchObject({ outcome: 'failed', errorKind: 'connect_refused', phase: 'tcp' })
  })

  it('detects a reset during the TLS handshake', async () => {
    const attempt = await probe(`${servers.tlsReset}/`)
    expect(attempt.outcome).toBe('failed')
    expect(attempt.phase).toBe('tls')
    expect(['reset', 'tls_error']).toContain(attempt.errorKind)
  })

  it('attributes a timeout to the phase that stalled', async () => {
    const attempt = await probe(`${servers.http}/slow`, { maxTimeMs: 1000 })
    expect(attempt).toMatchObject({ outcome: 'failed', errorKind: 'timeout', phase: 'http' })
  })

  it('detects a truncated body as a partial transfer', async () => {
    const attempt = await probe(`${servers.http}/truncate`)
    expect(attempt).toMatchObject({
      outcome: 'reachable',
      errorKind: 'partial_transfer',
      phase: 'transfer',
    })
  })

  it('detects a reset in the middle of the body', async () => {
    const attempt = await probe(`${servers.http}/reset-mid-body`)
    expect(attempt.outcome).toBe('reachable')
    expect(attempt.phase).toBe('transfer')
    expect(['reset', 'partial_transfer']).toContain(attempt.errorKind)
  })

  it('reports cancellation instead of a network failure', async () => {
    const controller = new AbortController()
    const pending = runCurl(
      request(`${servers.http}/slow`, { maxTimeMs: 10_000 }),
      controller.signal,
    )
    setTimeout(() => controller.abort(), 200)
    const sample = await pending
    const attempt = toAttempt(sample, { seq: 1, startedAt: '', expectStatus: [200] })
    expect(attempt.errorKind).toBe('cancelled')
  })

  it('rejects a download whose size differs from the declared size', async () => {
    const sample = await runCurl(
      request(`${servers.http}/bytes/2048`),
      new AbortController().signal,
    )
    const attempt = toAttempt(sample, {
      seq: 1,
      startedAt: '',
      expectStatus: [200],
      expectBytes: 4096,
      requireTransfer: true,
    })
    expect(attempt).toMatchObject({ outcome: 'expected', errorKind: 'size_mismatch' })
  })
})
