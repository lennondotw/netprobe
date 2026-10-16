import { lookup, Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import { performance } from 'node:perf_hooks'

import type {
  DnsResolverObservation,
  EgressInfo,
  IdentityReport,
  IpObservation,
  Signal,
} from '../shared/types.ts'
import type { ResolvedEgress } from './config.ts'
import { fetchText, type FetchTextOptions } from './curl.ts'
import { redactText } from './redact.ts'

type Json = Record<string, unknown>
type Fields = Partial<
  Omit<IpObservation, 'sourceId' | 'source' | 'family' | 'lookup' | 'ok' | 'error' | 'latencyMs'>
>

const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {})
const text = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : null
const asnOf = (value: unknown) => {
  if (typeof value === 'number') return value
  const match = /^(?:AS)?(\d+)/i.exec(String(value ?? '').trim())
  return match ? Number(match[1]) : null
}
/** "AS13335 Cloudflare, Inc." → "Cloudflare, Inc." */
const withoutAsn = (value: unknown) => text(value)?.replace(/^AS\d+\s+/i, '') ?? null
const signal = (value: unknown): Signal =>
  typeof value === 'boolean' ? value : value === 'yes' ? true : value === 'no' ? false : null

const flags = (values: Partial<IpObservation['flags']> = {}): IpObservation['flags'] => ({
  proxy: values.proxy ?? null,
  vpn: values.vpn ?? null,
  tor: values.tor ?? null,
  hosting: values.hosting ?? null,
  mobile: values.mobile ?? null,
})

interface Source {
  id: string
  name: string
  url: string
  family: IpObservation['family']
  format: 'json' | 'trace'
  parse: (data: Json) => Fields
}

const traceFields = (data: Json): Fields => ({ ip: text(data.ip), countryCode: text(data.loc) })
const ipifyFields = (data: Json): Fields => ({ ip: text(data.ip) })
const ipleakFields = (data: Json): Fields => ({
  ip: text(data.ip),
  asn: asnOf(data.as_number),
  organization: text(data.isp_name),
  country: text(data.country_name),
  countryCode: text(data.country_code),
  region: text(data.region_name),
  city: text(data.city_name),
})

/**
 * Sources that observe the caller. Several are pinned to one IP family, so a host whose IPv4 and
 * IPv6 traffic leave differently shows both. All are free and keyless; any of them may rate-limit.
 */
const sources: Source[] = [
  {
    id: 'cloudflare-v4',
    name: 'Cloudflare',
    url: 'https://www.cloudflare.com/cdn-cgi/trace',
    family: 'ipv4',
    format: 'trace',
    parse: traceFields,
  },
  {
    id: 'cloudflare-v6',
    name: 'Cloudflare',
    url: 'https://www.cloudflare.com/cdn-cgi/trace',
    family: 'ipv6',
    format: 'trace',
    parse: traceFields,
  },
  {
    id: 'ipify-v4',
    name: 'ipify',
    url: 'https://api.ipify.org?format=json',
    family: 'ipv4',
    format: 'json',
    parse: ipifyFields,
  },
  {
    id: 'ipify-v6',
    name: 'ipify',
    url: 'https://api6.ipify.org?format=json',
    family: 'ipv6',
    format: 'json',
    parse: ipifyFields,
  },
  {
    id: 'ipleak-v4',
    name: 'ipleak.net',
    url: 'https://ipv4.ipleak.net/json/',
    family: 'ipv4',
    format: 'json',
    parse: ipleakFields,
  },
  {
    id: 'ipleak-v6',
    name: 'ipleak.net',
    url: 'https://ipv6.ipleak.net/json/',
    family: 'ipv6',
    format: 'json',
    parse: ipleakFields,
  },
  {
    id: 'ipinfo',
    name: 'ipinfo.io',
    url: 'https://ipinfo.io/json',
    family: 'auto',
    format: 'json',
    parse: (d) => ({
      ip: text(d.ip),
      asn: asnOf(d.org),
      organization: withoutAsn(d.org),
      countryCode: text(d.country),
      region: text(d.region),
      city: text(d.city),
    }),
  },
  {
    id: 'ip-api',
    name: 'ip-api.com',
    // The free tier is HTTP only.
    url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,isp,org,as,asname,mobile,proxy,hosting,query',
    family: 'auto',
    format: 'json',
    parse: (d) => ({
      ip: text(d.query),
      asn: asnOf(d.as),
      organization: text(d.asname) ?? withoutAsn(d.as),
      isp: text(d.isp),
      country: text(d.country),
      countryCode: text(d.countryCode),
      region: text(d.regionName),
      city: text(d.city),
      networkType: d.hosting === true ? 'hosting' : d.mobile === true ? 'mobile' : null,
      flags: flags({
        proxy: signal(d.proxy),
        hosting: signal(d.hosting),
        mobile: signal(d.mobile),
      }),
    }),
  },
  {
    id: 'ipapi-is',
    name: 'ipapi.is',
    url: 'https://api.ipapi.is/',
    family: 'auto',
    format: 'json',
    parse: (d) => {
      const asn = obj(d.asn)
      const company = obj(d.company)
      const location = obj(d.location)
      return {
        ip: text(d.ip),
        asn: asnOf(asn.asn),
        organization: text(asn.org),
        isp: text(company.name),
        country: text(location.country),
        countryCode: text(location.country_code),
        region: text(location.state),
        city: text(location.city),
        networkType: text(company.type) ?? text(asn.type),
        flags: flags({
          proxy: signal(d.is_proxy),
          vpn: signal(d.is_vpn),
          tor: signal(d.is_tor),
          hosting: signal(d.is_datacenter),
          mobile: signal(d.is_mobile),
        }),
      }
    },
  },
  {
    id: 'ipwho',
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    family: 'auto',
    format: 'json',
    parse: (d) => {
      const connection = obj(d.connection)
      return {
        ip: text(d.ip),
        asn: asnOf(connection.asn),
        organization: text(connection.org),
        isp: text(connection.isp),
        country: text(d.country),
        countryCode: text(d.country_code),
        region: text(d.region),
        city: text(d.city),
      }
    },
  },
  {
    id: 'ip-sb',
    name: 'IP.SB',
    url: 'https://api.ip.sb/geoip',
    family: 'auto',
    format: 'json',
    parse: (d) => ({
      ip: text(d.ip),
      asn: asnOf(d.asn),
      organization: text(d.asn_organization) ?? text(d.organization),
      isp: text(d.isp),
      country: text(d.country),
      countryCode: text(d.country_code),
      region: text(d.region),
      city: text(d.city),
    }),
  },
  {
    id: 'ipapi-co',
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    family: 'auto',
    format: 'json',
    parse: (d) => ({
      ip: text(d.ip),
      asn: asnOf(d.asn),
      organization: text(d.org),
      country: text(d.country_name),
      countryCode: text(d.country_code),
      region: text(d.region),
      city: text(d.city),
    }),
  },
  {
    id: 'geojs',
    name: 'GeoJS',
    url: 'https://get.geojs.io/v1/ip/geo.json',
    family: 'auto',
    format: 'json',
    parse: (d) => ({
      ip: text(d.ip),
      asn: asnOf(d.asn),
      organization: text(d.organization_name) ?? withoutAsn(d.organization),
      country: text(d.country),
      countryCode: text(d.country_code),
      region: text(d.region),
      city: text(d.city),
    }),
  },
  {
    id: 'ipquery',
    name: 'ipquery.io',
    url: 'https://api.ipquery.io/?format=json',
    family: 'auto',
    format: 'json',
    parse: (d) => {
      const isp = obj(d.isp)
      const location = obj(d.location)
      const risk = obj(d.risk)
      return {
        ip: text(d.ip),
        asn: asnOf(isp.asn),
        organization: text(isp.org),
        isp: text(isp.isp),
        country: text(location.country),
        countryCode: text(location.country_code),
        region: text(location.state),
        city: text(location.city),
        networkType:
          risk.is_datacenter === true ? 'hosting' : risk.is_mobile === true ? 'mobile' : null,
        flags: flags({
          proxy: signal(risk.is_proxy),
          vpn: signal(risk.is_vpn),
          tor: signal(risk.is_tor),
          hosting: signal(risk.is_datacenter),
          mobile: signal(risk.is_mobile),
        }),
        risk: typeof risk.risk_score === 'number' ? risk.risk_score : null,
      }
    },
  },
  {
    id: 'ifconfig-co',
    name: 'ifconfig.co',
    url: 'https://ifconfig.co/json',
    family: 'auto',
    format: 'json',
    parse: (d) => ({
      ip: text(d.ip),
      asn: asnOf(d.asn),
      organization: text(d.asn_org),
      country: text(d.country),
      countryCode: text(d.country_iso),
      region: text(d.region_name),
      city: text(d.city),
    }),
  },
  {
    id: 'ipip',
    name: 'IPIP.NET',
    url: 'https://myip.ipip.net/json',
    family: 'auto',
    format: 'json',
    parse: (d) => {
      const data = obj(d.data)
      const location = Array.isArray(data.location) ? (data.location as unknown[]) : []
      return {
        ip: text(data.ip),
        country: text(location[0]),
        region: text(location[1]),
        city: text(location[2]),
        isp: text(location[4]),
      }
    },
  },
  {
    id: 'myip-la',
    name: 'myip.la',
    url: 'https://api.myip.la/en?json',
    family: 'auto',
    format: 'json',
    parse: (d) => {
      const location = obj(d.location)
      return {
        ip: text(d.ip),
        country: text(location.country_name),
        countryCode: text(location.country_code),
        region: text(location.province),
        city: text(location.city),
      }
    },
  },
]

const parseTrace = (body: string): Json =>
  Object.fromEntries(
    body
      .split('\n')
      .map((line) => line.split('='))
      .filter((parts) => parts.length >= 2)
      .map(([key, ...rest]) => [key!.trim(), rest.join('=').trim()]),
  )

const empty = (
  source: { id: string; name: string },
  family: IpObservation['family'],
  lookup: boolean,
): IpObservation => ({
  sourceId: source.id,
  source: source.name,
  family,
  lookup,
  ok: false,
  error: null,
  latencyMs: null,
  ip: null,
  asn: null,
  organization: null,
  isp: null,
  country: null,
  countryCode: null,
  region: null,
  city: null,
  networkType: null,
  flags: flags(),
  risk: null,
})

const errorText = (error: unknown) =>
  redactText(error instanceof Error ? error.message : String(error))

const observe = async (
  source: Source,
  base: Omit<FetchTextOptions, 'ipFamily'>,
): Promise<IpObservation> => {
  const result = empty(source, source.family, false)
  const started = performance.now()
  try {
    const body = await fetchText(source.url, {
      ...base,
      ipFamily: source.family === 'auto' ? 'auto' : source.family,
    })
    result.latencyMs = Math.round(performance.now() - started)
    const data = source.format === 'trace' ? parseTrace(body) : obj(JSON.parse(body))
    const fields = source.parse(data)
    Object.assign(result, fields, { flags: fields.flags ?? flags() })
    result.ok = result.ip !== null && isIP(result.ip) !== 0
    if (!result.ok)
      result.error = text(data.message) ?? text(data.error) ?? 'No IP address in the response'
  } catch (error) {
    result.error = errorText(error)
  }
  return result
}

/** proxycheck.io classifies an address (Business, Residential, Hosting, VPN, …) and scores its risk. */
const proxycheck = async (
  ip: string,
  base: Omit<FetchTextOptions, 'ipFamily'>,
): Promise<IpObservation> => {
  const result = empty({ id: 'proxycheck', name: 'proxycheck.io' }, 'auto', true)
  result.ip = ip
  const started = performance.now()
  try {
    const body = await fetchText(
      `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&asn=1&risk=1`,
      {
        ...base,
        ipFamily: 'auto',
      },
    )
    result.latencyMs = Math.round(performance.now() - started)
    const data = obj(obj(JSON.parse(body))[ip])
    const type = text(data.type)
    Object.assign(result, {
      asn: asnOf(data.asn),
      organization: text(data.organisation) ?? text(data.provider),
      isp: text(data.provider),
      country: text(data.country),
      countryCode: text(data.isocode),
      region: text(data.region),
      city: text(data.city),
      networkType: type?.toLowerCase() ?? null,
      flags: flags({
        proxy: signal(data.proxy),
        vpn: type === 'VPN' ? true : data.proxy === 'no' ? false : null,
        hosting: type ? type === 'Hosting' : null,
        mobile: type ? type === 'Wireless' : null,
      }),
      risk: typeof data.risk === 'number' ? data.risk : null,
    })
    result.ok = Object.keys(data).length > 0
    if (!result.ok) result.error = 'No data for this address'
  } catch (error) {
    result.error = errorText(error)
  }
  return result
}

/** Ask the system resolver for TXT records that name the resolver the query reached. */
const whoami = async (): Promise<{
  resolvers: { method: string; ip: string; note: string | null }[]
  notes: string[]
}> => {
  const resolver = new Resolver({ timeout: 4000, tries: 1 })
  const found: { method: string; ip: string; note: string | null }[] = []
  const notes: string[] = []

  try {
    const records = (await resolver.resolveTxt('o-o.myaddr.l.google.com')).map((r) => r.join(''))
    const subnet = records.find((r) => r.startsWith('edns0-client-subnet'))
    for (const record of records) {
      if (isIP(record)) {
        found.push({
          method: 'Google (o-o.myaddr TXT)',
          ip: record,
          note: subnet ? `Forwards client subnet ${subnet.split(' ')[1] ?? ''}` : null,
        })
      }
    }
  } catch (error) {
    notes.push(`Google whoami failed: ${errorText(error)}`)
  }

  try {
    const records = await resolver.resolveTxt('whoami.ds.akahelp.net')
    const ecs = records.find((r) => r[0] === 'ecs')?.[1]
    for (const record of records) {
      if (record[0] === 'ns' && record[1] && isIP(record[1])) {
        found.push({
          method: 'Akamai (whoami TXT)',
          ip: record[1],
          note: ecs ? `Forwards client subnet ${ecs}` : null,
        })
      }
    }
  } catch (error) {
    notes.push(`Akamai whoami failed: ${errorText(error)}`)
  }
  return { resolvers: found, notes }
}

/**
 * bash.ws leak test: look up random names under a test domain through the system resolver; the
 * test's authoritative servers record which resolvers asked.
 */
const leakTest = async (base: Omit<FetchTextOptions, 'ipFamily'>) => {
  const opts = { ...base, ipFamily: 'auto' as const }
  const id = (await fetchText('https://bash.ws/id', opts)).trim()
  if (!/^[a-z0-9]+$/i.test(id)) throw new Error('Unexpected test id')
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      Promise.race([
        lookup(`${i + 1}.${id}.bash.ws`).catch(() => null),
        new Promise((done) => setTimeout(done, 3000)),
      ]),
    ),
  )
  const body = JSON.parse(
    await fetchText(`https://bash.ws/dnsleak/test/${id}?json`, opts),
  ) as unknown
  if (!Array.isArray(body)) return { resolvers: [], note: text(obj(body).error) }
  const resolvers = body
    .map(obj)
    .filter((entry) => entry.type === 'dns' && text(entry.ip))
    .map((entry) => ({ method: 'bash.ws leak test', ip: text(entry.ip)!, note: null }))
  return { resolvers, note: null }
}

/** Fill in network and location for resolver addresses with one ip-api batch call. */
const enrich = async (
  found: { method: string; ip: string; note: string | null }[],
  base: Omit<FetchTextOptions, 'ipFamily'>,
): Promise<DnsResolverObservation[]> => {
  const unique = [...new Set(found.map((f) => f.ip))].slice(0, 50)
  const details = new Map<string, Json>()
  if (unique.length > 0) {
    try {
      const body = await fetchText(
        'http://ip-api.com/batch?fields=query,country,countryCode,city,as,asname,org',
        {
          ...base,
          ipFamily: 'auto',
          method: 'POST',
          body: JSON.stringify(unique),
          headers: { 'content-type': 'application/json' },
        },
      )
      for (const entry of (JSON.parse(body) as unknown[]).map(obj)) {
        const ip = text(entry.query)
        if (ip) details.set(ip, entry)
      }
    } catch {
      // Enrichment is optional; addresses alone are still useful.
    }
  }
  return found.map((f) => {
    const d = details.get(f.ip) ?? {}
    return {
      method: f.method,
      ip: f.ip,
      asn: asnOf(d.as),
      organization: text(d.asname) ?? withoutAsn(d.as) ?? text(d.org),
      country: text(d.country),
      countryCode: text(d.countryCode),
      city: text(d.city),
      note: f.note,
    }
  })
}

/**
 * Ask many independent services where this host's traffic appears to come from, then look up the
 * quality of each distinct address and identify the DNS resolvers in use. Disagreements are the
 * point: rule-based proxies send different destinations out through different exits.
 */
export const collectIdentity = async (
  egress: ResolvedEgress,
  signal: AbortSignal,
): Promise<IdentityReport> => {
  const started = performance.now()
  const base = { proxy: egress.rawProxy, timeoutMs: 8000, signal, userAgent: 'netprobe/0.1' }

  const [observations, dnsWhoami, leak] = await Promise.all([
    Promise.all(sources.map((source) => observe(source, base))),
    whoami(),
    leakTest(base).catch((error: unknown) => ({
      resolvers: [],
      note: `Leak test failed: ${errorText(error)}`,
    })),
  ])

  const addresses = [...new Set(observations.filter((o) => o.ok).map((o) => o.ip!))].slice(0, 8)
  const lookups = await Promise.all(addresses.map((ip) => proxycheck(ip, base)))

  const notes = [...dnsWhoami.notes]
  if (leak.resolvers.length === 0) {
    notes.push(
      `${leak.note ? `${leak.note.replace(/[.\s]+$/, '')}. ` : ''}The leak test saw no queries. A local proxy with fake-IP DNS answers lookups itself and only resolves names upstream when a connection is made; the TXT methods still identify the upstream resolver.`,
    )
  }

  const publicEgress: EgressInfo = { id: egress.id, name: egress.name, proxy: egress.proxy }
  return {
    egress: publicEgress,
    collectedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    observations: [...observations, ...lookups],
    dns: {
      resolvers: await enrich([...dnsWhoami.resolvers, ...leak.resolvers], base),
      notes,
    },
  }
}
