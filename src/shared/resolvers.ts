import type { DnsResolverObservation } from './types.ts'

export interface ResolverNetwork {
  key: string
  asn: number | null
  organization: string | null
  location: string | null
  countryCode: string | null
  resolvers: DnsResolverObservation[]
  /** How the resolvers were found, with how many each method found. */
  methods: { method: string; count: number }[]
  notes: string[]
}

/**
 * Resolvers grouped by network and city. A leak test often reports dozens of addresses from one
 * resolver farm; what matters is which networks and places answer, and how many.
 */
export const resolverNetworks = (
  resolvers: readonly DnsResolverObservation[],
): ResolverNetwork[] => {
  const groups = new Map<string, ResolverNetwork>()
  for (const r of resolvers) {
    const location = [r.city, r.countryCode].filter(Boolean).join(', ') || null
    const key = `${r.asn ?? r.organization ?? r.ip}|${location ?? ''}`
    const group = groups.get(key) ?? {
      key,
      asn: r.asn,
      organization: r.organization,
      location,
      countryCode: r.countryCode,
      resolvers: [],
      methods: [],
      notes: [],
    }
    if (!group.resolvers.some((x) => x.ip === r.ip)) group.resolvers.push(r)
    const method = group.methods.find((m) => m.method === r.method)
    if (method) method.count++
    else group.methods.push({ method: r.method, count: 1 })
    if (r.note && !group.notes.includes(r.note)) group.notes.push(r.note)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.resolvers.length - a.resolvers.length)
}
