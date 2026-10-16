import type { ServiceInput } from '../config.ts'
import { site, stun, type Target } from './helpers.ts'

/**
 * One DERP node per region, from https://login.tailscale.com/derpmap/default. Node names change
 * over time; when one stops resolving, update it from the map.
 */
const derpRegions = [
  ['nyc', 'New York', 'derp1f'],
  ['sfo', 'San Francisco', 'derp2d'],
  ['sea', 'Seattle', 'derp10b'],
  ['fra', 'Frankfurt', 'derp4f'],
  ['lhr', 'London', 'derp8e'],
  ['sin', 'Singapore', 'derp3e'],
  ['tok', 'Tokyo', 'derp7e'],
  ['hkg', 'Hong Kong', 'derp20b'],
  ['syd', 'Sydney', 'derp5e'],
] as const

const derpTargets = derpRegions.flatMap(([code, city, node]): Target[] => [
  { id: `${code}-https`, name: `${city} (HTTPS)`, url: `https://${node}.tailscale.com/derp/probe` },
  stun(`${code}-stun`, `${city} (STUN)`, `${node}.tailscale.com`),
])

export const tailscale: ServiceInput[] = [
  {
    id: 'tailscale',
    name: 'Tailscale control',
    category: 'Tailscale',
    description: 'Coordination server, login, logging, and package downloads.',
    targets: [
      { id: 'control', name: 'Control plane', url: 'https://controlplane.tailscale.com/key?v=71' },
      site('login', 'Login', 'https://login.tailscale.com/'),
      { id: 'log', name: 'Log ingestion', url: 'https://log.tailscale.io/' },
      site('pkgs', 'Packages', 'https://pkgs.tailscale.com/'),
    ],
  },
  {
    id: 'tailscale-derp',
    name: 'Tailscale DERP',
    category: 'Tailscale',
    description:
      'Relay servers over HTTPS, and STUN on UDP 3478, which clients use to find direct paths. Failing STUN with working HTTPS means traffic falls back to relays.',
    targets: derpTargets,
  },
]
