import type { IdentityReport, IpObservation } from '../../shared/types.ts'

export interface ExitNetwork {
  key: string
  asn: number | null
  organization: string | null
  /** Addresses in this network, most widely seen first. */
  addresses: { ip: string; version: 4 | 6; seenBy: number }[]
  /** Sources that observed an address in this network themselves (lookups excluded). */
  seenBy: IpObservation[]
  lookups: IpObservation[]
  locations: string[]
  /** Distinct network types claimed by any source, with who claimed them. */
  types: { type: string; sources: string[] }[]
  /** Flags any source raised, with who raised them. */
  flags: { flag: keyof IpObservation['flags']; sources: string[] }[]
  risks: { source: string; risk: number }[]
  /** Sources pinned to a family that came back with the other one (a proxy translated it). */
  familyMismatch: string[]
}

const byCount = (values: (string | null)[]) => {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([value]) => value)
}

export const locationOf = (o: IpObservation) =>
  [o.city, o.region !== o.city ? o.region : null, o.countryCode ?? o.country]
    .filter(Boolean)
    .join(', ') || null

const versionOf = (ip: string): 4 | 6 => (ip.includes(':') ? 6 : 4)

const prefixOf = (ip: string) =>
  versionOf(ip) === 4 ? ip.split('.').slice(0, 3).join('.') : ip.split(':').slice(0, 3).join(':')

const flagNames: (keyof IpObservation['flags'])[] = ['vpn', 'proxy', 'tor', 'hosting', 'mobile']

/**
 * Group observations by the network their address belongs to. Proxies and carriers spread traffic
 * over many addresses in one network, so the network is the meaningful unit; addresses that no
 * source could place in a network are grouped on their own.
 */
export const exitNetworks = (report: IdentityReport): ExitNetwork[] => {
  const ok = report.observations.filter((o) => o.ok && o.ip)
  // Any source that knows an address's ASN decides the network for every source that saw it.
  const asnByIp = new Map<string, number>()
  for (const o of ok) if (o.asn !== null && !asnByIp.has(o.ip!)) asnByIp.set(o.ip!, o.asn)
  // Sources that report only an address: borrow the network of a known neighbour in the same
  // IPv4 /24 or IPv6 /48, which almost always belongs to the same operator.
  const asnByPrefix = new Map<string, number>()
  for (const [ip, asn] of asnByIp) asnByPrefix.set(prefixOf(ip), asn)
  for (const o of ok) {
    const borrowed = asnByPrefix.get(prefixOf(o.ip!))
    if (!asnByIp.has(o.ip!) && borrowed !== undefined) asnByIp.set(o.ip!, borrowed)
  }

  const groups = new Map<string, IpObservation[]>()
  for (const o of ok) {
    const asn = asnByIp.get(o.ip!)
    const key = asn !== undefined ? `AS${asn}` : `ip:${o.ip}`
    groups.set(key, [...(groups.get(key) ?? []), o])
  }

  return [...groups]
    .map(([key, all]): ExitNetwork => {
      const seenBy = all.filter((o) => !o.lookup)
      const types = new Map<string, string[]>()
      for (const o of all) {
        if (o.networkType) types.set(o.networkType, [...(types.get(o.networkType) ?? []), o.source])
      }
      const addresses = byCount(seenBy.map((o) => o.ip)).map((ip) => ({
        ip,
        version: versionOf(ip),
        seenBy: seenBy.filter((o) => o.ip === ip).length,
      }))
      return {
        key,
        asn: key.startsWith('AS') ? Number(key.slice(2)) : null,
        organization: byCount(all.map((o) => o.organization ?? o.isp))[0] ?? null,
        addresses,
        seenBy,
        lookups: all.filter((o) => o.lookup),
        locations: byCount(all.map(locationOf)),
        types: [...types].map(([type, sources]) => ({ type, sources: [...new Set(sources)] })),
        flags: flagNames
          .map((flag) => ({
            flag,
            sources: [...new Set(all.filter((o) => o.flags[flag] === true).map((o) => o.source))],
          }))
          .filter((f) => f.sources.length > 0),
        risks: all.filter((o) => o.risk !== null).map((o) => ({ source: o.source, risk: o.risk! })),
        familyMismatch: seenBy
          .filter(
            (o) => o.family !== 'auto' && o.family !== (versionOf(o.ip!) === 4 ? 'ipv4' : 'ipv6'),
          )
          .map((o) => o.source),
      }
    })
    .sort((a, b) => b.seenBy.length - a.seenBy.length)
}

export const networkName = (network: ExitNetwork) =>
  network.organization ?? network.addresses[0]?.ip ?? 'Unknown network'

/** The country part of a location string such as "Tokyo, JP". */
export const countryOf = (location: string) => location.split(', ').at(-1) ?? location

export const flagLabels: Record<keyof IpObservation['flags'], string> = {
  vpn: 'VPN',
  proxy: 'Proxy',
  tor: 'Tor',
  hosting: 'Hosting',
  mobile: 'Mobile',
}

export const typeLabel = (type: string) =>
  ({
    isp: 'ISP',
    hosting: 'Hosting / IDC',
    business: 'Business',
    residential: 'Residential',
    wireless: 'Mobile',
    mobile: 'Mobile',
    education: 'Education',
    government: 'Government',
    vpn: 'VPN',
  })[type.toLowerCase()] ?? type
