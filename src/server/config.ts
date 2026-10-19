import { existsSync, readFileSync } from 'node:fs'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import type {
  EgressInfo,
  IpFamily,
  ProbeKind,
  ServiceInfo,
  StatusMatcher,
  TargetInfo,
} from '../shared/types.ts'
import { identitySourceIds } from './identity.ts'
import { presets } from './presets/index.ts'
import { redactProxy, redactUrl } from './redact.ts'

/*
 * The configuration file format. Every field carries a description: they become the hover text
 * and completion details in editors through the generated JSON Schema
 * (config/netprobe.schema.json, regenerated with `pnpm schema`).
 */

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits, and dashes')
  .describe('Lowercase letters, digits, and dashes.')

const schemeKinds: Record<string, ProbeKind> = {
  'http:': 'http',
  'https:': 'http',
  'tcp:': 'tcp',
  'dns:': 'dns',
  'dot:': 'dot',
  'tls:': 'tls',
  'stun:': 'stun',
  'quic:': 'quic',
  'icmp:': 'icmp',
}

export const kindOf = (url: string): ProbeKind => schemeKinds[new URL(url).protocol] ?? 'http'

const targetUrl = z
  .url({ protocol: /^(https?|tcp|dns|dot|tls|stun|quic|icmp)$/ })
  .describe(
    [
      'What to probe; the scheme picks the probe.',
      'http(s)://… — through curl, with DNS/TCP/TLS/TTFB timings and a status check.',
      'icmp://host — ping.',
      'tcp://host:port — TCP connect.',
      'dns://server[:port]?name=example.com&type=A — one DNS query over UDP.',
      'dot://server[:port]?name=example.com&sni=host — DNS over TLS.',
      'tls://host[:port]?groups=X25519:P-256&version=1.3 — a TLS handshake by Node (OpenSSL 3.5). Default groups include the post-quantum X25519MLKEM768 key share (a ~1.6 KB ClientHello); groups and version narrow it.',
      'stun://host[:port] — STUN binding; reports the public UDP address.',
      'quic://host[:port] — QUIC version negotiation (HTTP/3, DoQ reachability).',
    ].join('\n'),
  )

const statusMatcher = z
  .union([z.number().int().min(100).max(599), z.enum(['2xx', '3xx', '4xx', '5xx'])])
  .describe('An exact HTTP status such as 200, or a class such as "2xx".')

const targetObject = z
  .strictObject({
    id: id
      .optional()
      .describe(
        'Unique within the service. Defaults to one derived from the URL host. Reuse a built-in target id to replace it.',
      ),
    name: z.string().min(1).optional().describe('Display name. Defaults to the URL host.'),
    url: targetUrl,
    method: z
      .enum(['GET', 'HEAD'])
      .default('GET')
      .describe('HTTP method. HEAD avoids downloading page bodies.'),
    expectStatus: z
      .union([statusMatcher, z.array(statusMatcher).min(1)])
      .optional()
      .describe('Healthy HTTP status or statuses. Default 200.'),
    check: z
      .enum(['response', 'reachability'])
      .default('response')
      .describe(
        '"reachability" marks endpoints that answer with an error by design (e.g. 401 without credentials): the expected status proves the path, not that real requests would work.',
      ),
    followRedirects: z
      .boolean()
      .optional()
      .describe('Follow redirects. Default: only for downloads.'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('Extra request headers (HTTP only).'),
    samples: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Minimum attempts per run, e.g. more pings for meaningful jitter and loss.'),
    note: z.string().optional().describe('Shown in the target’s detail dialog.'),
    download: z
      .strictObject({
        bytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Exact size in bytes. When set, any other size counts as a failed transfer.'),
        parallel: z
          .enum(['range', 'none'])
          .default('range')
          .describe(
            '"range" also measures with several connections, each fetching part of the file; use "none" if the server ignores Range requests.',
          ),
      })
      .optional()
      .describe('Makes this a download target, measured in Download mode instead of Quick mode.'),
  })
  .describe('A target to probe.')

const targetSchema = z
  .union([targetUrl, targetObject])
  .describe('A target, or just its URL as a shorthand.')

const serviceSchema = z
  .strictObject({
    id: id.describe(
      'Service id. Reusing a built-in id (e.g. "aws") adds targets to that service or replaces targets with the same id.',
    ),
    name: z.string().min(1).optional().describe('Display name. Defaults to the id.'),
    description: z.string().optional().describe('One line shown next to the service name.'),
    category: z
      .string()
      .optional()
      .describe('Tab the service appears under, e.g. "Network" or a new one such as "Internal".'),
    targets: z.array(targetSchema).default([]).describe('Targets of this service.'),
  })
  .describe('A group of targets shown and run together.')

const exitSchema = z
  .strictObject({
    id: id.describe('Exit id, stored with every run. Lowercase letters, digits, and dashes.'),
    name: z.string().min(1).describe('Shown in the egress picker.'),
    proxy: z
      .url({ protocol: /^(https?|socks5h?|socks4a?)$/ })
      .optional()
      .describe(
        'http://, https://, socks5:// (DNS resolved locally), or socks5h:// (DNS resolved by the proxy). Only HTTP probes can use a proxy. Credentials in the URL are never shown or logged.',
      ),
    interface: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Bind every probe of this exit to a network interface (e.g. "wg0"), using the routes it already has. curl and ping bind to the device; socket probes bind to its address.',
      ),
    gateway: z
      .ipv4()
      .optional()
      .describe(
        'Send this exit through a gateway on a directly connected network, such as a LAN side router. In Docker the container sets up policy routing for it at start (needs the NET_ADMIN capability), so only this exit uses the gateway.',
      ),
    dns: z
      .union([z.ipv4(), z.ipv6()])
      .optional()
      .describe(
        'Resolve names for this exit with this DNS server, queried through the exit itself. Useful when the gateway hands out fake IPs and routes by domain.',
      ),
  })
  .describe(
    'A network exit runs can be sent through. Without proxy, interface, or gateway it uses the system routing.',
  )

const egressModule = z
  .strictObject({
    excludeSources: z
      .array(z.enum(identitySourceIds as [string, ...string[]]))
      .default([])
      .describe('Third-party IP information services not to query.'),
    reputation: z
      .boolean()
      .default(true)
      .describe('Look up each exit address on proxycheck.io (type, VPN/proxy flags, risk).'),
    dnsLeakTest: z
      .boolean()
      .default(true)
      .describe('Run the bash.ws DNS leak test in addition to the whoami TXT lookups.'),
    browserCheck: z
      .boolean()
      .default(true)
      .describe('Offer the WebRTC and public-address check for the browser viewing the page.'),
  })
  .describe('Egress page settings.')

const configSchema = z
  .strictObject({
    $schema: z.string().optional().describe('Path or URL of this file’s JSON Schema.'),
    hostLabel: z
      .string()
      .optional()
      .describe('Name shown in the UI and stored with each run. Defaults to the hostname.'),
    modules: z
      .strictObject({
        downloads: z
          .boolean()
          .default(false)
          .describe(
            'Download throughput tests against a few speed-test hosts (about 50 MB per run). Off by default: every viewer could start one, and they use the host’s bandwidth.',
          ),
        host: z
          .boolean()
          .default(true)
          .describe(
            'The Host page: system details, interfaces, routes, DNS, and proxy settings, visible to anyone who can open Netprobe.',
          ),
        egress: z
          .union([z.boolean(), egressModule])
          .default(true)
          .describe(
            'The Egress page: asks third-party services about this host’s public addresses. true, false, or settings.',
          ),
      })
      .prefault({})
      .describe('Turn optional parts of Netprobe on or off.'),
    probe: z
      .strictObject({
        repeats: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Default attempts per target.'),
        connectTimeoutMs: z
          .number()
          .int()
          .min(500)
          .max(60_000)
          .default(5_000)
          .describe('Connection timeout per attempt.'),
        timeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(120_000)
          .default(15_000)
          .describe('Total time limit per attempt.'),
        concurrency: z
          .number()
          .int()
          .min(1)
          .max(32)
          .default(8)
          .describe('Targets probed in parallel. Downloads always run one at a time.'),
      })
      .prefault({})
      .describe('Quick-mode probing.'),
    download: z
      .strictObject({
        connections: z
          .number()
          .int()
          .min(2)
          .max(16)
          .default(4)
          .describe('Connections for the parallel measurement.'),
        timeoutMs: z
          .number()
          .int()
          .min(5_000)
          .max(600_000)
          .default(120_000)
          .describe('Time limit per download.'),
        maxBytes: z
          .number()
          .int()
          .positive()
          .default(200 * 1024 * 1024)
          .describe('Hard cap per request; larger files are aborted rather than downloaded.'),
      })
      .prefault({})
      .describe('Download-mode limits.'),
    ipFamily: z
      .enum(['auto', 'ipv4', 'ipv6'])
      .default('auto')
      .describe('Default IP family for runs; each run can override it.'),
    publicIpCheckUrl: z
      .url()
      .default('https://www.cloudflare.com/cdn-cgi/trace')
      .describe(
        'Echoes the public IP (as `ip=` lines or a bare address); recorded with every run.',
      ),
    exits: z
      .array(exitSchema)
      .min(1)
      .default([{ id: 'direct', name: 'Direct' }])
      .describe('Network exits to compare. The first is the default.'),
    presets: z
      .strictObject({
        enabled: z
          .boolean()
          .default(true)
          .describe('Set to false to start from no built-in services at all.'),
        exclude: z
          .array(z.string())
          .default([])
          .describe(
            'Built-in services ("social") or single targets ("github.objects") to leave out.',
          ),
        excludeCategories: z
          .array(z.string())
          .default([])
          .describe('Built-in categories to leave out, e.g. "Regional".'),
      })
      .prefault({})
      .describe('The built-in services.'),
    services: z
      .array(serviceSchema)
      .default([])
      .describe(
        'Services to add, or to extend built-in services by reusing their id. Added services are listed before the built-in ones.',
      ),
  })
  .describe('Netprobe configuration.')

export { configSchema }
export type ConfigInput = z.input<typeof configSchema>
export type ServiceInput = z.input<typeof serviceSchema>
type TargetConfig = z.output<typeof targetObject>
type TargetEntry = z.output<typeof targetSchema>

export interface ResolvedTarget extends TargetInfo {
  /** The unredacted URL. Never leaves the server. */
  rawUrl: string
  followRedirects: boolean
  parallel: 'range' | 'none'
  headers: Record<string, string>
  samples: number
}

export interface ResolvedEgress extends EgressInfo {
  /** The proxy URL including credentials. Never leaves the server. */
  rawProxy: string | null
  interfaceName: string | null
  gateway: string | null
  dns: string | null
}

export interface ResolvedModules {
  downloads: boolean
  host: boolean
  /** Null when the Egress page is disabled. */
  egress: {
    excludeSources: string[]
    reputation: boolean
    dnsLeakTest: boolean
    browserCheck: boolean
  } | null
}

export interface ResolvedConfig {
  hostLabel: string | null
  modules: ResolvedModules
  probe: { repeats: number; connectTimeoutMs: number; timeoutMs: number; concurrency: number }
  download: { connections: number; timeoutMs: number; maxBytes: number }
  ipFamily: IpFamily
  publicIpCheckUrl: string
  egress: ResolvedEgress[]
  services: (Omit<ServiceInfo, 'targets'> & { targets: ResolvedTarget[] })[]
  targets: Map<string, ResolvedTarget>
}

/** "cdn.example.com:8443" → "cdn-example-com-8443" */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'target'

/** Expand the URL shorthand and fill in the id and name it implies. */
const normalizeTarget = (entry: TargetEntry): TargetConfig & { id: string; name: string } => {
  const target: TargetConfig =
    typeof entry === 'string' ? targetObject.parse({ url: entry }) : entry
  const host = new URL(target.url).host
  return { ...target, id: target.id ?? slug(host), name: target.name ?? host }
}

const resolveTarget = (
  serviceId: string,
  target: ReturnType<typeof normalizeTarget>,
  maxBytes: number,
): ResolvedTarget => {
  const expect = target.expectStatus
  const expectStatus: StatusMatcher[] =
    expect === undefined ? [200] : Array.isArray(expect) ? expect : [expect]
  return {
    id: `${serviceId}.${target.id}`,
    serviceId,
    name: target.name,
    kind: kindOf(target.url),
    url: redactUrl(target.url),
    rawUrl: target.url,
    headers: target.headers ?? {},
    samples: target.samples ?? 1,
    method: target.method,
    expectStatus,
    check: target.check,
    // Downloads usually sit behind a redirect to a CDN; probes measure the first hop only.
    followRedirects: target.followRedirects ?? Boolean(target.download),
    download: target.download
      ? {
          bytes: target.download.bytes ?? null,
          maxBytes,
          parallel: target.download.parallel === 'range',
        }
      : null,
    parallel: target.download?.parallel ?? 'none',
    note: target.note ?? null,
  }
}

/** Ids a `presets.exclude` entry may name: every built-in service, and every built-in target. */
export const presetIds = () => {
  const services = presets.map((p) => p.id)
  const targets = presets.flatMap((p) =>
    (p.targets ?? []).map((t) => `${p.id}.${normalizeTarget(targetSchema.parse(t)).id}`),
  )
  return { services, targets, categories: [...new Set(presets.map((p) => p.category ?? 'Custom'))] }
}

/** Edit distance, for "did you mean" suggestions on misspelled ids. */
const distance = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]!
}

const suggestion = (value: string, candidates: readonly string[]) => {
  const best = candidates
    .map((candidate) => ({ candidate, score: distance(value, candidate) }))
    .sort((a, b) => a.score - b.score)[0]
  return best && best.score <= Math.max(2, Math.floor(value.length / 3))
    ? `; did you mean "${best.candidate}"?`
    : ''
}

interface MergedService {
  name: string
  description: string
  category: string
  targets: ReturnType<typeof normalizeTarget>[]
}

/**
 * Validate the user config and merge it over the presets. A configured service whose id matches a
 * preset adds targets to it (replacing targets with the same id) and may rename or re-categorise
 * it; any other id defines a new service.
 */
export const resolveConfig = (input: unknown): ResolvedConfig => {
  const config = configSchema.parse(input ?? {})
  const known = presetIds()
  const excluded = new Set(config.presets.exclude)

  // Problems the schema cannot express; collected so every one is reported at once.
  const issues: z.core.$ZodIssue[] = []
  const issue = (path: (string | number)[], message: string) =>
    issues.push({ code: 'custom', path, message, input: undefined })

  config.presets.exclude.forEach((entry, index) => {
    if (!known.services.includes(entry) && !known.targets.includes(entry)) {
      issue(
        ['presets', 'exclude', index],
        `"${entry}" is not a built-in service or target${suggestion(entry, [...known.services, ...known.targets])}`,
      )
    }
  })
  config.presets.excludeCategories.forEach((entry, index) => {
    if (!known.categories.includes(entry)) {
      issue(
        ['presets', 'excludeCategories', index],
        `"${entry}" is not a built-in category${suggestion(entry, known.categories)}`,
      )
    }
  })

  const merged = new Map<string, MergedService>()
  if (config.presets.enabled) {
    for (const preset of presets) {
      const parsed = serviceSchema.parse(preset)
      const category = parsed.category ?? 'Custom'
      if (excluded.has(parsed.id) || config.presets.excludeCategories.includes(category)) continue
      merged.set(parsed.id, {
        name: parsed.name ?? parsed.id,
        description: parsed.description ?? '',
        category,
        targets: parsed.targets
          .map(normalizeTarget)
          .filter((t) => !excluded.has(`${parsed.id}.${t.id}`)),
      })
    }
  }

  config.services.forEach((service, serviceIndex) => {
    const targets = service.targets.map(normalizeTarget)
    const seen = new Set<string>()
    targets.forEach((target, targetIndex) => {
      if (seen.has(target.id)) {
        issue(
          ['services', serviceIndex, 'targets', targetIndex, 'id'],
          `duplicate target id "${target.id}" in service "${service.id}"; give one of them an explicit id`,
        )
      }
      seen.add(target.id)
    })
    const existing = merged.get(service.id)
    if (existing) {
      existing.name = service.name ?? existing.name
      existing.description = service.description ?? existing.description
      existing.category = service.category ?? existing.category
      existing.targets = [...existing.targets.filter((t) => !seen.has(t.id)), ...targets]
    } else {
      merged.set(service.id, {
        name: service.name ?? service.id,
        description: service.description ?? '',
        category: service.category ?? 'Custom',
        targets,
      })
    }
  })

  const modules: ResolvedModules = {
    downloads: config.modules.downloads,
    host: config.modules.host,
    egress:
      config.modules.egress === false
        ? null
        : config.modules.egress === true
          ? { excludeSources: [], reputation: true, dnsLeakTest: true, browserCheck: true }
          : config.modules.egress,
  }

  // Services the config adds come first: a deployment's own targets matter most to its viewers.
  const builtIn = new Set(presets.map((p) => p.id))
  const ordered = [
    ...[...merged].filter(([id]) => !builtIn.has(id)),
    ...[...merged].filter(([id]) => builtIn.has(id)),
  ]
  const services = ordered
    .map(([serviceId, service]) => ({
      id: serviceId,
      name: service.name,
      description: service.description,
      category: service.category,
      targets: service.targets
        .filter((t) => modules.downloads || !t.download)
        .map((t) => resolveTarget(serviceId, t, config.download.maxBytes)),
    }))
    .filter((service) => service.targets.length > 0)

  config.exits.forEach((exit, index) => {
    const routes = [exit.proxy, exit.interface, exit.gateway].filter(Boolean).length
    if (routes > 1) {
      issue(['exits', index], 'use only one of proxy, interface, and gateway')
    }
    if (exit.dns && exit.proxy) {
      issue(
        ['exits', index, 'dns'],
        'a proxy exit resolves names through the proxy; dns does not apply',
      )
    }
    if (config.exits.findIndex((e) => e.id === exit.id) !== index) {
      issue(['exits', index, 'id'], `duplicate exit id "${exit.id}"`)
    }
  })

  if (issues.length > 0) throw new z.ZodError(issues)

  return {
    hostLabel: config.hostLabel ?? null,
    modules,
    probe: config.probe,
    download: config.download,
    ipFamily: config.ipFamily,
    publicIpCheckUrl: config.publicIpCheckUrl,
    egress: config.exits.map((exit): ResolvedEgress => {
      const proxy = exit.proxy ? redactProxy(exit.proxy) : null
      const kind = exit.proxy
        ? 'proxy'
        : exit.gateway
          ? 'gateway'
          : exit.interface
            ? 'interface'
            : 'direct'
      const detail =
        kind === 'proxy'
          ? proxy
          : kind === 'gateway'
            ? `via gateway ${exit.gateway}`
            : kind === 'interface'
              ? `bound to ${exit.interface}`
              : 'System routing'
      return {
        id: exit.id,
        name: exit.name,
        kind,
        proxy,
        detail: exit.dns ? `${detail}, DNS ${exit.dns}` : detail,
        rawProxy: exit.proxy ?? null,
        interfaceName: exit.interface ?? null,
        gateway: exit.gateway ?? null,
        dns: exit.dns ?? null,
      }
    }),
    services,
    targets: new Map(services.flatMap((s) => s.targets).map((t) => [t.id, t])),
  }
}

export const loadConfig = (path: string | undefined): ResolvedConfig => {
  if (!path || !existsSync(path)) return resolveConfig({})
  const text = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new Error(`Invalid YAML in ${path}: ${error instanceof Error ? error.message : error}`)
  }
  try {
    return resolveConfig(parsed)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid config at ${path}:\n${z.prettifyError(error)}`)
    }
    throw error
  }
}

/** Strip server-only fields before a target or service is sent to the browser. */
export const publicTarget = ({
  rawUrl: _raw,
  followRedirects: _f,
  parallel: _p,
  headers: _h,
  samples: _s,
  ...target
}: ResolvedTarget): TargetInfo => target
