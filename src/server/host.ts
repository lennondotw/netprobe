import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import {
  arch,
  cpus,
  freemem,
  hostname,
  loadavg,
  networkInterfaces,
  platform,
  release,
  totalmem,
  uptime,
  version,
} from 'node:os'

import type {
  HostInfo,
  HostInterface,
  HostProxySetting,
  MacNetworkInfo,
  MacResolver,
  RuntimeInfo,
} from '../shared/types.ts'
import { redactProxy } from './redact.ts'

const darwin = platform() === 'darwin'

/** Run a read-only system command; resolves to null when it is missing or fails. */
const run = (command: string, args: string[]): Promise<string | null> =>
  new Promise((done) => {
    execFile(command, args, { timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      done(error ? null : stdout),
    )
  })

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const osName = async () => {
  if (darwin) {
    const out = await run('sw_vers', [])
    const name = /ProductName:\s*(.+)/.exec(out ?? '')?.[1]?.trim()
    const ver = /ProductVersion:\s*(.+)/.exec(out ?? '')?.[1]?.trim()
    const build = /BuildVersion:\s*(.+)/.exec(out ?? '')?.[1]?.trim()
    if (name && ver) return `${name} ${ver}${build ? ` (${build})` : ''}`
  }
  const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(read('/etc/os-release') ?? '')?.[1]
  return pretty ?? `${platform()} ${release()}`
}

const deviceModel = async () => {
  if (darwin) return (await run('sysctl', ['-n', 'hw.model']))?.trim() || null
  const vendor = read('/sys/class/dmi/id/sys_vendor')?.trim()
  const product = read('/sys/class/dmi/id/product_name')?.trim()
  return [vendor, product].filter(Boolean).join(' ') || null
}

const ipv4Private =
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/

const scopeOf = (
  family: 'IPv4' | 'IPv6',
  address: string,
): HostInterface['addresses'][number]['scope'] => {
  if (family === 'IPv4') {
    if (address.startsWith('127.')) return 'loopback'
    if (address.startsWith('169.254.')) return 'link-local'
    if (/^198\.1[89]\./.test(address)) return 'special'
    return ipv4Private.test(address) ? 'private' : 'public'
  }
  const lower = address.toLowerCase()
  if (lower === '::1') return 'loopback'
  if (lower.startsWith('fe80')) return 'link-local'
  if (/^f[cd]/.test(lower)) return 'private'
  return 'public'
}

const mtus = async (): Promise<Map<string, number>> => {
  const result = new Map<string, number>()
  if (darwin) {
    for (const match of (await run('ifconfig', ['-a']))?.matchAll(
      /^(\S+): flags=.*\smtu (\d+)/gm,
    ) ?? []) {
      result.set(match[1]!, Number(match[2]))
    }
    return result
  }
  if (existsSync('/sys/class/net')) {
    for (const name of readdirSync('/sys/class/net')) {
      const mtu = Number(read(`/sys/class/net/${name}/mtu`))
      if (mtu) result.set(name, mtu)
    }
  }
  return result
}

/** Recognise interfaces by their addresses, since tunnel interface names are generic (utunN). */
const roleOf = (addresses: string[]): string | null => {
  if (
    addresses.some(
      (a) => /^fd7a:115c:a1e0:/i.test(a) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a),
    )
  )
    return 'Tailscale'
  if (addresses.some((a) => /^198\.1[89]\./.test(a))) return 'Proxy TUN (fake-IP)'
  return null
}

const tunnelName = /^(utun|tun|tap|wg|tailscale|ipsec|ppp|zt)/

const interfaces = async (): Promise<HostInterface[]> => {
  const mtu = await mtus()
  return Object.entries(networkInterfaces())
    .map(([name, entries = []]): HostInterface => ({
      name,
      addresses: entries.map((entry) => {
        const family = entry.family === 'IPv6' ? 'IPv6' : 'IPv4'
        return { family, cidr: entry.cidr ?? entry.address, scope: scopeOf(family, entry.address) }
      }),
      // Placeholder MACs (all zero, or 02:00:… when the OS hides the real one) carry no information.
      mac: entries.find((e) => e.mac && !/^0[02]:00:00:00:00:00$/.test(e.mac))?.mac ?? null,
      mtu: mtu.get(name) ?? null,
      internal: entries.every((e) => e.internal),
      tunnel: tunnelName.test(name),
      role: roleOf(entries.map((e) => e.address)),
    }))
    .sort(
      (a, b) =>
        Number(a.internal) - Number(b.internal) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    )
}

const gateways = async (): Promise<HostInfo['network']['gateways']> => {
  if (darwin) {
    const parse = (out: string | null, family: 'IPv4' | 'IPv6') => {
      if (!out) return []
      const iface = /interface:\s*(\S+)/.exec(out)?.[1] ?? null
      const gateway = /gateway:\s*(\S+)/.exec(out)?.[1]
      // A route bound to an interface without a gateway (typical for TUN) is still the default.
      return iface || gateway
        ? [{ family, gateway: gateway ?? 'interface route', interface: iface }]
        : []
    }
    const [v4, v6] = await Promise.all([
      run('route', ['-n', 'get', 'default']),
      run('route', ['-n', 'get', '-inet6', 'default']),
    ])
    return [...parse(v4, 'IPv4'), ...parse(v6, 'IPv6')]
  }
  const routes: HostInfo['network']['gateways'] = []
  for (const line of (read('/proc/net/route') ?? '').split('\n').slice(1)) {
    const [iface, destination, gateway] = line.trim().split(/\s+/)
    if (destination !== '00000000' || !gateway || !iface) continue
    const bytes =
      gateway
        .match(/../g)
        ?.reverse()
        .map((h) => parseInt(h, 16)) ?? []
    routes.push({ family: 'IPv4', gateway: bytes.join('.'), interface: iface })
  }
  for (const line of (read('/proc/net/ipv6_route') ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] !== '0'.repeat(32) || parts[1] !== '00') continue
    const hex = parts[4] ?? ''
    if (/^0+$/.test(hex)) continue
    const groups = hex.match(/.{4}/g)?.map((g) => parseInt(g, 16).toString(16)) ?? []
    routes.push({ family: 'IPv6', gateway: groups.join(':'), interface: parts[9] ?? null })
  }
  return routes
}

const dnsConfig = async () => {
  if (darwin) {
    const out = (await run('scutil', ['--dns'])) ?? ''
    // The first section is the resolver configuration ordinary lookups use.
    const main = out.split('DNS configuration (for scoped queries)')[0] ?? ''
    const servers = [...main.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map((m) => m[1]!)
    const search = [...main.matchAll(/search domain\[\d+\]\s*:\s*(\S+)/g)].map((m) => m[1]!)
    return { servers: [...new Set(servers)], search: [...new Set(search)] }
  }
  const conf = read('/etc/resolv.conf') ?? ''
  return {
    servers: [...conf.matchAll(/^nameserver\s+(\S+)/gm)].map((m) => m[1]!),
    search: [...conf.matchAll(/^search\s+(.+)$/gm)].flatMap((m) => m[1]!.trim().split(/\s+/)),
  }
}

const resolverCheck = async (name: string) => {
  try {
    const results = await lookup(name, { all: true })
    return { name, addresses: results.map((r) => r.address), error: null }
  } catch (error) {
    return { name, addresses: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/** System proxy settings. On macOS this is what apps using the system network stack follow. */
const systemProxy = async (): Promise<HostProxySetting[]> => {
  if (!darwin) return []
  const out = (await run('scutil', ['--proxy'])) ?? ''
  const value = (key: string) => new RegExp(`\\b${key}\\s*:\\s*(.+)`).exec(out)?.[1]?.trim()
  const settings: HostProxySetting[] = []
  for (const [label, prefix] of [
    ['HTTP', 'HTTP'],
    ['HTTPS', 'HTTPS'],
    ['SOCKS', 'SOCKS'],
  ] as const) {
    if (value(`${prefix}Enable`) === '1') {
      settings.push({
        label: `${label} proxy`,
        value: `${value(`${prefix}Proxy`) ?? '?'}:${value(`${prefix}Port`) ?? '?'}`,
      })
    }
  }
  if (value('ProxyAutoConfigEnable') === '1') {
    settings.push({
      label: 'Auto-config (PAC)',
      value: value('ProxyAutoConfigURLString') ?? 'enabled',
    })
  }
  if (value('ProxyAutoDiscoveryEnable') === '1')
    settings.push({ label: 'Auto-discovery (WPAD)', value: 'enabled' })
  const exceptions = /ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/.exec(out)?.[1]
  if (exceptions && settings.length > 0) {
    const list = [...exceptions.matchAll(/:\s*(\S+)/g)].map((m) => m[1]!)
    if (list.length) settings.push({ label: 'Bypass', value: list.join(', ') })
  }
  return settings
}

const environmentProxy = (): HostProxySetting[] =>
  Object.entries(process.env)
    .filter(([key, value]) => /^(https?|all|no|ftp)_proxy$/i.test(key) && value)
    .map(([key, value]) => ({
      label: key,
      value: /^no_proxy$/i.test(key) ? value! : /:\/\//.test(value!) ? redactProxy(value!) : value!,
    }))

/** Every resolver mDNSResponder knows about, from both sections of `scutil --dns`. */
const parseResolvers = (out: string): MacResolver[] => {
  const [main = '', scoped = ''] = out.split('DNS configuration (for scoped queries)')
  const parseSection = (text: string, isScoped: boolean) =>
    text
      .split(/\n(?=resolver #\d+)/)
      .filter((block) => block.startsWith('resolver #'))
      .map((block): MacResolver => {
        const field = (name: string) =>
          new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'm').exec(block)?.[1]?.trim()
        const domain = field('domain') ?? null
        const reach = field('reach')
        return {
          kind: isScoped ? 'scoped' : domain ? 'domain' : 'default',
          domain,
          nameservers: [...block.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map((m) => m[1]!),
          interface: /if_index\s*:\s*\d+\s*\(([^)]+)\)/.exec(block)?.[1] ?? null,
          mdns: /options\s*:.*\bmdns\b/.test(block),
          order: field('order') ? Number(field('order')) : null,
          reachable: reach ? !/Not Reachable/.test(reach) : null,
        }
      })
  return [...parseSection(main, false), ...parseSection(scoped, true)]
}

const extensionCategories: Record<string, string> = {
  network_extension: 'Network',
  endpoint_security_extension: 'Endpoint security',
  driver_extension: 'Driver',
}

const parseSystemExtensions = (out: string): MacNetworkInfo['systemExtensions'] => {
  const extensions: MacNetworkInfo['systemExtensions'] = []
  let category = 'Other'
  for (const line of out.split('\n')) {
    const section = /^--- com\.apple\.system_extension\.(\S+)/.exec(line)
    if (section) {
      category = extensionCategories[section[1]!] ?? section[1]!
      continue
    }
    const row = /^(\*?)\t(\*?)\t(\S+)\t(\S+) \(([^)]*)\)\t(.+?)\t\[(.+)\]$/.exec(line)
    if (row) {
      extensions.push({
        enabled: row[1] === '*',
        bundleId: row[4]!,
        version: row[5]!,
        name: row[6]!,
        state: row[7]!,
        category,
      })
    }
  }
  return extensions
}

const parseVpnServices = (out: string): MacNetworkInfo['vpnServices'] =>
  out
    .split('\n')
    .map((line) => /^(\*?)\s*\(([^)]+)\)\s+\S+\s+(\S+)\s+(?:\(([^)]+)\)\s+)?"([^"]+)"/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      enabled: m[1] === '*',
      status: m[2]!,
      type: m[3]!,
      provider: m[4] ?? null,
      name: m[5]!,
    }))

const parseServiceOrder = (out: string) =>
  [...out.matchAll(/^\((\d+|\*)\)\s+(.+)$/gm)].map((m) => ({
    name: m[2]!.trim(),
    enabled: m[1] !== '*',
  }))

const macNetwork = async (): Promise<MacNetworkInfo> => {
  const [dns, extensions, vpn, order, localHostName, computerName] = await Promise.all([
    run('scutil', ['--dns']),
    run('systemextensionsctl', ['list']),
    run('scutil', ['--nc', 'list']),
    run('networksetup', ['-listnetworkserviceorder']),
    run('scutil', ['--get', 'LocalHostName']),
    run('scutil', ['--get', 'ComputerName']),
  ])
  return {
    localHostName: localHostName?.trim() || null,
    computerName: computerName?.trim() || null,
    serviceOrder: parseServiceOrder(order ?? ''),
    resolvers: parseResolvers(dns ?? ''),
    systemExtensions: parseSystemExtensions(extensions ?? ''),
    vpnServices: parseVpnServices(vpn ?? ''),
  }
}

/**
 * Collect a snapshot of the host. Every collector is independent and best-effort: a missing tool
 * or unsupported platform leaves that part empty and is listed in `unavailable`.
 */
export const collectHostInfo = async (runtime: RuntimeInfo): Promise<HostInfo> => {
  const unavailable: string[] = []
  const guard = async <T>(label: string, fallback: T, work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch {
      unavailable.push(label)
      return fallback
    }
  }

  const [os, model, ifaces, routes, dns, resolver, sysProxy, features, macos] = await Promise.all([
    guard('OS version', `${platform()} ${release()}`, osName),
    guard('Device model', null, deviceModel),
    guard('Interfaces', [], interfaces),
    guard('Default routes', [], gateways),
    guard('DNS configuration', { servers: [], search: [] }, dnsConfig),
    resolverCheck('example.com'),
    guard('System proxy', [], systemProxy),
    guard('curl features', [], async () => {
      const out = (await run('curl', ['--version'])) ?? ''
      return /^Features:\s*(.+)$/m.exec(out)?.[1]?.trim().split(/\s+/) ?? []
    }),
    darwin ? guard('macOS network details', null, macNetwork) : Promise.resolve(null),
  ])

  if (routes.length === 0) unavailable.push('Default routes')
  if (dns.servers.length === 0) unavailable.push('DNS servers')

  const cpuList = cpus()
  return {
    collectedAt: new Date().toISOString(),
    runtime,
    system: {
      hostname: hostname(),
      model,
      os,
      kernel: `${version()} ${release()}`,
      arch: arch(),
      cpu: cpuList[0]?.model.trim() ?? 'unknown',
      cpuCount: cpuList.length,
      memoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      uptimeSeconds: Math.round(uptime()),
      loadAverage: loadavg().map((n) => Math.round(n * 100) / 100) as [number, number, number],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nodeVersion: process.version,
      curlFeatures: features,
    },
    network: {
      gateways: routes,
      dnsServers: dns.servers,
      searchDomains: dns.search,
      resolverCheck: resolver,
    },
    proxy: { system: sysProxy, environment: environmentProxy() },
    interfaces: ifaces,
    macos,
    unavailable: [...new Set(unavailable)],
  }
}
