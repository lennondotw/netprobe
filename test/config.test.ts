import { describe, expect, it } from 'vitest'

import { median, summarize, worstOutcome } from '../src/server/classify.ts'
import { resolveConfig } from '../src/server/config.ts'
import { redactProxy, redactUrl } from '../src/server/redact.ts'
import type { Attempt } from '../src/shared/types.ts'

describe('redaction', () => {
  it('removes signing parameters but keeps the rest of a presigned URL', () => {
    const url = redactUrl(
      'https://bucket.s3.amazonaws.com/file?X-Amz-Signature=abc&X-Amz-Credential=key&part=1',
    )
    expect(url).not.toContain('abc')
    expect(url).not.toContain('=key')
    expect(url).toContain('part=1')
  })

  it('drops proxy credentials', () => {
    expect(redactProxy('socks5h://user:secret@10.0.0.2:1080')).toBe('socks5h://10.0.0.2:1080')
  })
})

describe('config', () => {
  it('loads presets with no config', () => {
    const config = resolveConfig({})
    expect(config.services.map((s) => s.id)).toContain('github')
    expect(config.egress).toEqual([{ id: 'direct', name: 'Direct', proxy: null, rawProxy: null }])
  })

  it('appends configured targets to a preset service and hides excluded presets', () => {
    const config = resolveConfig({
      presets: { exclude: ['vercel'] },
      services: [
        { id: 'aws', targets: [{ id: 'cdn', name: 'My CDN', url: 'https://cdn.example.com/' }] },
      ],
    })
    expect(config.services.find((s) => s.id === 'vercel')).toBeUndefined()
    expect(config.targets.get('aws.cdn')?.name).toBe('My CDN')
    expect(config.targets.get('aws.s3-global')).toBeDefined()
  })

  it('never exposes proxy credentials in the public egress list', () => {
    const config = resolveConfig({
      egress: [{ id: 'proxy', name: 'Proxy', proxy: 'http://user:pw@proxy.local:8080' }],
    })
    expect(config.egress[0]?.proxy).toBe('http://proxy.local:8080')
  })

  it('rejects invalid ids with a readable error', () => {
    expect(() => resolveConfig({ egress: [{ id: 'Bad Id', name: 'x' }] })).toThrow()
  })
})

const attempt = (overrides: Partial<Attempt>): Attempt => ({
  seq: 1,
  startedAt: '',
  outcome: 'expected',
  phase: null,
  errorKind: null,
  errorMessage: null,
  curlExit: 0,
  httpStatus: 200,
  httpVersion: '2',
  remoteIp: '1.1.1.1',
  remotePort: 443,
  phases: { dns: 1, tcp: 10, tls: 20, ttfb: 30 },
  totalMs: 61,
  bytes: 0,
  effectiveUrl: null,
  ...overrides,
})

describe('summaries', () => {
  it('keeps a single failure visible even when other attempts succeed', () => {
    const attempts = [
      attempt({}),
      attempt({ outcome: 'failed', errorKind: 'reset', phase: 'tls', totalMs: 5 }),
      attempt({}),
    ]
    expect(worstOutcome(attempts.map((a) => a.outcome))).toBe('failed')
    const summary = summarize(attempts)
    expect(summary).toMatchObject({ attempts: 3, expected: 2, failed: 1 })
    expect(summary.topError).toEqual({ kind: 'reset', phase: 'tls', count: 1 })
    // Failed attempts do not drag the latency median down.
    expect(summary.median.total).toBe(61)
  })

  it('computes medians for odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})
