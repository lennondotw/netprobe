import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/server/config.ts'
import { exitRouteCommands, resolveEntries, routeFor } from '../src/server/exits.ts'
import { isEligible } from '../src/server/runner.ts'

const exits = (list: unknown[]) =>
  resolveConfig({ presets: { enabled: false }, exits: list }).egress

describe('exits', () => {
  it('describes each kind of exit without exposing proxy credentials', () => {
    const [direct, proxy, bound, gateway] = exits([
      { id: 'direct', name: 'Direct' },
      { id: 'proxy', name: 'Proxy', proxy: 'socks5h://user:pw@10.0.0.2:1080' },
      { id: 'wg', name: 'WireGuard', interface: 'wg0' },
      { id: 'router', name: 'Side router', gateway: '10.0.0.240', dns: '10.0.0.240' },
    ])
    expect(direct).toMatchObject({ kind: 'direct', detail: 'System routing' })
    expect(proxy).toMatchObject({ kind: 'proxy', detail: 'socks5h://10.0.0.2:1080' })
    expect(bound).toMatchObject({ kind: 'interface', detail: 'bound to wg0' })
    expect(gateway).toMatchObject({
      kind: 'gateway',
      detail: 'via gateway 10.0.0.240, DNS 10.0.0.240',
      dns: '10.0.0.240',
    })
  })

  it.each([
    [{ id: 'x', name: 'x', proxy: 'http://p:1', gateway: '10.0.0.1' }, 'only one of'],
    [{ id: 'x', name: 'x', proxy: 'http://p:1', dns: '1.1.1.1' }, 'dns does not apply'],
    [{ id: 'x', name: 'x', gateway: 'fe80::1' }, 'gateway'],
  ])('rejects %j', (exit, fragment) => {
    expect(() => exits([exit])).toThrow(fragment)
  })

  it('runs socket probes on routed exits but not through a proxy', () => {
    const [gateway, proxy] = exits([
      { id: 'router', name: 'Router', gateway: '10.0.0.240' },
      { id: 'proxy', name: 'Proxy', proxy: 'http://p:1' },
    ])
    const [target] = resolveConfig({
      presets: { enabled: false },
      services: [{ id: 's', targets: ['icmp://1.1.1.1'] }],
    }).targets.values()
    expect(isEligible(target!, 'quick', gateway!)).toBe(true)
    expect(isEligible(target!, 'quick', proxy!)).toBe(false)
  })

  it('fails clearly when an exit interface does not exist', () => {
    const [bound] = exits([{ id: 'wg', name: 'WireGuard', interface: 'netprobe-missing0' }])
    expect(() => routeFor(bound!, 'auto')).toThrow('does not exist')
  })

  it('builds idempotent policy routing for interface and gateway exits', () => {
    expect(exitRouteCommands(null, { interface: 'wg0', address4: '10.9.0.2' }, 1000)[0]).toEqual([
      'route',
      'replace',
      'default',
      'dev',
      'wg0',
      'table',
      '1000',
    ])
    expect(
      exitRouteCommands('10.0.0.240', { interface: 'eth1', address4: '10.0.0.243' }, 1001),
    ).toEqual([
      ['route', 'replace', 'default', 'via', '10.0.0.240', 'dev', 'eth1', 'table', '1001'],
      ['rule', 'del', 'from', '10.0.0.243', 'lookup', '1001'],
      ['rule', 'add', 'from', '10.0.0.243', 'lookup', '1001', 'priority', '1001'],
      ['rule', 'del', 'oif', 'eth1', 'lookup', '1001'],
      ['rule', 'add', 'oif', 'eth1', 'lookup', '1001', 'priority', '1001'],
    ])
  })

  it('pins a URL host to the exit resolver answer for curl', async () => {
    const resolver = async (_host: string, family: string) =>
      family === 'ipv6'
        ? { address: '2001:db8::1', family: 6 as const }
        : { address: '198.18.0.5', family: 4 as const }
    expect(await resolveEntries('https://example.com/x', resolver, 'auto')).toEqual([
      'example.com:443:198.18.0.5',
    ])
    expect(await resolveEntries('http://example.com:8080/', resolver, 'ipv6')).toEqual([
      'example.com:8080:[2001:db8::1]',
    ])
    expect(await resolveEntries('https://1.1.1.1/', resolver, 'auto')).toEqual([])
    expect(await resolveEntries('https://example.com/', null, 'auto')).toEqual([])
  })
})
