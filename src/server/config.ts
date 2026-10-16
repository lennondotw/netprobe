import { existsSync, readFileSync } from 'node:fs'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import type { EgressInfo, IpFamily, ServiceInfo, TargetInfo } from '../shared/types.ts'
import { presets } from './presets.ts'
import { redactProxy, redactUrl } from './redact.ts'

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, and dashes')

const targetSchema = z.object({
  id,
  name: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  method: z.enum(['GET', 'HEAD']).default('GET'),
  expectStatus: z.array(z.number().int().min(100).max(599)).min(1).optional(),
  check: z.enum(['reachability', 'response']).default('response'),
  followRedirects: z.boolean().optional(),
  note: z.string().optional(),
  download: z
    .object({
      /** Exact size in bytes. When set, any other size counts as a failed transfer. */
      bytes: z.number().int().positive().optional(),
      /** `range` splits the file across connections; `none` skips the multi-connection test. */
      parallel: z.enum(['range', 'none']).default('range'),
    })
    .optional(),
})

const serviceSchema = z.object({
  id,
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  targets: z.array(targetSchema).default([]),
})

const egressSchema = z.object({
  id,
  name: z.string().min(1),
  /** http://, https://, socks5:// (local DNS) or socks5h:// (proxy-side DNS). */
  proxy: z.url({ protocol: /^(https?|socks5h?|socks4a?)$/ }).optional(),
})

const configSchema = z.object({
  hostLabel: z.string().optional(),
  probe: z
    .object({
      repeats: z.number().int().min(1).max(20).default(5),
      connectTimeoutMs: z.number().int().min(500).max(60_000).default(5_000),
      timeoutMs: z.number().int().min(1_000).max(120_000).default(15_000),
      concurrency: z.number().int().min(1).max(16).default(4),
    })
    .prefault({}),
  download: z
    .object({
      connections: z.number().int().min(2).max(16).default(4),
      timeoutMs: z.number().int().min(5_000).max(600_000).default(120_000),
      /** Hard cap per request; larger files are aborted rather than downloaded. */
      maxBytes: z
        .number()
        .int()
        .positive()
        .default(200 * 1024 * 1024),
    })
    .prefault({}),
  ipFamily: z.enum(['auto', 'ipv4', 'ipv6']).default('auto'),
  /** Endpoint that echoes the caller's public IP, as `ip=` lines or a bare address. */
  egressCheckUrl: z.url().default('https://www.cloudflare.com/cdn-cgi/trace'),
  egress: z
    .array(egressSchema)
    .min(1)
    .default([{ id: 'direct', name: 'Direct' }]),
  presets: z.object({ exclude: z.array(z.string()).default([]) }).prefault({}),
  services: z.array(serviceSchema).default([]),
})

export type ConfigInput = z.input<typeof configSchema>
export type ServiceInput = z.input<typeof serviceSchema>
type TargetConfig = z.output<typeof targetSchema>

export interface ResolvedTarget extends TargetInfo {
  /** The unredacted URL. Never leaves the server. */
  rawUrl: string
  followRedirects: boolean
  parallel: 'range' | 'none'
}

export interface ResolvedEgress extends EgressInfo {
  /** The proxy URL including credentials. Never leaves the server. */
  rawProxy: string | null
}

export interface ResolvedConfig {
  hostLabel: string | null
  probe: { repeats: number; connectTimeoutMs: number; timeoutMs: number; concurrency: number }
  download: { connections: number; timeoutMs: number; maxBytes: number }
  ipFamily: IpFamily
  egressCheckUrl: string
  egress: ResolvedEgress[]
  services: (Omit<ServiceInfo, 'targets'> & { targets: ResolvedTarget[] })[]
  targets: Map<string, ResolvedTarget>
}

const resolveTarget = (
  serviceId: string,
  target: TargetConfig,
  maxBytes: number,
): ResolvedTarget => ({
  id: `${serviceId}.${target.id}`,
  serviceId,
  name: target.name,
  url: redactUrl(target.url),
  rawUrl: target.url,
  method: target.method,
  expectStatus: target.expectStatus ?? [200],
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
})

/**
 * Validate the user config and merge it over the presets. A configured service whose id matches a
 * preset adds targets to it (and may rename it); any other id defines a new service.
 */
export const resolveConfig = (input: unknown): ResolvedConfig => {
  const config = configSchema.parse(input ?? {})
  const merged = new Map<string, { name: string; description: string; targets: TargetConfig[] }>()

  for (const preset of presets) {
    if (config.presets.exclude.includes(preset.id)) continue
    const parsed = serviceSchema.parse(preset)
    merged.set(parsed.id, {
      name: parsed.name ?? parsed.id,
      description: parsed.description ?? '',
      targets: parsed.targets,
    })
  }

  for (const service of config.services) {
    const existing = merged.get(service.id)
    if (existing) {
      existing.name = service.name ?? existing.name
      existing.description = service.description ?? existing.description
      const ids = new Set(service.targets.map((target) => target.id))
      existing.targets = [...existing.targets.filter((t) => !ids.has(t.id)), ...service.targets]
    } else {
      merged.set(service.id, {
        name: service.name ?? service.id,
        description: service.description ?? '',
        targets: service.targets,
      })
    }
  }

  const services = [...merged].map(([serviceId, service]) => ({
    id: serviceId,
    name: service.name,
    description: service.description,
    targets: service.targets.map((t) => resolveTarget(serviceId, t, config.download.maxBytes)),
  }))

  const egressIds = new Set<string>()
  for (const egress of config.egress) {
    if (egressIds.has(egress.id)) throw new Error(`Duplicate egress id "${egress.id}"`)
    egressIds.add(egress.id)
  }

  return {
    hostLabel: config.hostLabel ?? null,
    probe: config.probe,
    download: config.download,
    ipFamily: config.ipFamily,
    egressCheckUrl: config.egressCheckUrl,
    egress: config.egress.map((egress) => ({
      id: egress.id,
      name: egress.name,
      proxy: egress.proxy ? redactProxy(egress.proxy) : null,
      rawProxy: egress.proxy ?? null,
    })),
    services,
    targets: new Map(services.flatMap((s) => s.targets).map((t) => [t.id, t])),
  }
}

export const loadConfig = (path: string | undefined): ResolvedConfig => {
  if (!path || !existsSync(path)) return resolveConfig({})
  const text = readFileSync(path, 'utf8')
  try {
    return resolveConfig(parseYaml(text))
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
  ...target
}: ResolvedTarget): TargetInfo => target
