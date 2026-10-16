import { readFileSync } from 'node:fs'

import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { buildSchema, renderSchema, schemaPath } from '../scripts/schema.ts'
import { median, summarize, worstOutcome } from '../src/server/classify.ts'
import { loadConfig, resolveConfig } from '../src/server/config.ts'
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
    expect(config.modules).toMatchObject({ downloads: true, host: true })
    expect(config.modules.egress).toMatchObject({ reputation: true, dnsLeakTest: true })
  })

  it('adds targets to a preset service and leaves out excluded services and targets', () => {
    const config = resolveConfig({
      presets: { exclude: ['vercel', 'github.objects'] },
      services: [
        { id: 'aws', targets: [{ id: 'cdn', name: 'My CDN', url: 'https://cdn.example.com/' }] },
      ],
    })
    expect(config.services.find((s) => s.id === 'vercel')).toBeUndefined()
    expect(config.targets.get('aws.cdn')?.name).toBe('My CDN')
    expect(config.targets.get('aws.s3-global')).toBeDefined()
    expect(config.targets.get('github.objects')).toBeUndefined()
    expect(config.targets.get('github.web')).toBeDefined()
  })

  it('excludes whole categories, or every preset', () => {
    const noRegional = resolveConfig({ presets: { excludeCategories: ['Regional'] } })
    expect(noRegional.services.some((s) => s.category === 'Regional')).toBe(false)
    const none = resolveConfig({
      presets: { enabled: false },
      services: [{ id: 'mine', targets: ['https://example.com/'] }],
    })
    expect(none.services.map((s) => s.id)).toEqual(['mine'])
  })

  it('expands URL shorthands and single-status expectations', () => {
    const config = resolveConfig({
      presets: { enabled: false },
      services: [
        {
          id: 'mine',
          targets: [
            'https://wiki.example.com/',
            'icmp://10.0.0.1',
            { url: 'https://api.example.com/', expectStatus: '4xx' },
          ],
        },
      ],
    })
    expect(config.targets.get('mine.wiki-example-com')).toMatchObject({
      name: 'wiki.example.com',
      kind: 'http',
      expectStatus: [200],
    })
    expect(config.targets.get('mine.10-0-0-1')?.kind).toBe('icmp')
    expect(config.targets.get('mine.api-example-com')?.expectStatus).toEqual(['4xx'])
  })

  it('drops download targets when downloads are disabled', () => {
    const config = resolveConfig({ modules: { downloads: false } })
    expect([...config.targets.values()].some((t) => t.download)).toBe(false)
  })

  it('accepts the egress module as a boolean or settings', () => {
    expect(resolveConfig({ modules: { egress: false } }).modules.egress).toBeNull()
    expect(
      resolveConfig({ modules: { egress: { excludeSources: ['ip-api'], reputation: false } } })
        .modules.egress,
    ).toEqual({
      excludeSources: ['ip-api'],
      reputation: false,
      dnsLeakTest: true,
      browserCheck: true,
    })
  })

  it('never exposes proxy credentials in the public exit list', () => {
    const config = resolveConfig({
      exits: [{ id: 'proxy', name: 'Proxy', proxy: 'http://user:pw@proxy.local:8080' }],
    })
    expect(config.egress[0]?.proxy).toBe('http://proxy.local:8080')
  })

  it.each([
    [{ egress: [] }, 'egress'],
    [{ probe: { repeat: 3 } }, 'repeat'],
    [{ presets: { exclude: ['githb'] } }, 'githb'],
    [{ presets: { excludeCategories: ['Nowhere'] } }, 'Nowhere'],
    [{ exits: [{ id: 'Bad Id', name: 'x' }] }, 'lowercase'],
    [{ services: [{ id: 'x', targets: ['https://a.com/', 'https://a.com/'] }] }, 'duplicate'],
  ])('rejects %j with a message naming the problem', (input, fragment) => {
    expect(() => resolveConfig(input)).toThrow(fragment)
  })
})

describe('example config and schema', () => {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(buildSchema())

  it('ships a schema that matches the code', () => {
    // If this fails, run `pnpm schema` and commit the result.
    expect(readFileSync(schemaPath, 'utf8')).toBe(renderSchema())
  })

  it('parses the example as shipped', () => {
    const config = loadConfig('config/netprobe.example.yaml')
    expect(config.egress[0]?.id).toBe('direct')
  })

  it('validates the example, including its commented-out sections', () => {
    const text = readFileSync('config/netprobe.example.yaml', 'utf8')
    // Uncomment the example blocks ("#  " / "  # ") to check them too.
    const expanded = text
      .replace(/^services: \[\]$/m, 'services:')
      .replace(/^# {2}(\S.*|  .*)$/gm, '  $1')
      .replace(/^ {2}# (- id: |  \S)/gm, '  $1')
    const parsed = parseYaml(expanded) as Record<string, unknown>
    expect(Array.isArray(parsed.services)).toBe(true)
    expect((parsed.services as unknown[]).length).toBeGreaterThan(2)
    expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true)
    expect(() => resolveConfig(parsed)).not.toThrow()
  })

  it('agrees with the server on what is invalid', () => {
    for (const input of [{ probe: { repeat: 3 } }, { modules: { egress: 'yes' } }, { exits: [] }]) {
      expect(validate(input)).toBe(false)
      expect(() => resolveConfig(input)).toThrow()
    }
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
  detail: null,
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
