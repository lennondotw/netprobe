import { describe, expect, it } from 'vitest'

import { resolverNetworks } from '../src/shared/resolvers.ts'
import type { DnsResolverObservation } from '../src/shared/types.ts'

const resolver = (
  ip: string,
  method: string,
  asn: number,
  city: string,
): DnsResolverObservation => ({
  method,
  ip,
  asn,
  organization: `AS${asn} network`,
  country: null,
  countryCode: 'CN',
  city,
  note: null,
})

describe('resolverNetworks', () => {
  it('folds a leak test’s many resolvers into one row per network and city', () => {
    const groups = resolverNetworks([
      resolver('180.153.91.53', 'Google (o-o.myaddr TXT)', 4811, 'Shanghai'),
      resolver('180.153.91.53', 'Akamai (whoami TXT)', 4811, 'Shanghai'),
      ...Array.from({ length: 12 }, (_, i) =>
        resolver(`116.236.159.${i}`, 'bash.ws leak test', 4812, 'Shanghai'),
      ),
      resolver('162.158.185.101', 'bash.ws leak test', 13335, 'Singapore'),
    ])
    expect(groups.map((g) => [g.asn, g.resolvers.length])).toEqual([
      [4812, 12],
      [4811, 1],
      [13335, 1],
    ])
    expect(groups[1]!.methods).toEqual([
      { method: 'Google (o-o.myaddr TXT)', count: 1 },
      { method: 'Akamai (whoami TXT)', count: 1 },
    ])
    expect(groups[0]!.methods).toEqual([{ method: 'bash.ws leak test', count: 12 }])
  })
})
