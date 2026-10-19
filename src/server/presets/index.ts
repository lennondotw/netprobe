import type { ServiceInput } from '../config.ts'
import { ai } from './ai.ts'
import { cloud } from './cloud.ts'
import { developer } from './developer.ts'
import { mirrors } from './mirrors.ts'
import { network } from './network.ts'
import { packages } from './packages.ts'
import { platforms } from './platforms.ts'
import { tailscale } from './tailscale.ts'

/**
 * Built-in services, in display order; categories appear in the order of their first service.
 * They only reference public, organisation-neutral endpoints; anything deployment-specific (a
 * bucket, a distribution, a deployment URL) is added through config by declaring a service with
 * the same id.
 *
 * `check: reachability` marks endpoints that answer unauthenticated requests with an error by
 * design. Such a response proves the network path works, not that the service would accept a
 * real request.
 */
export const presets: ServiceInput[] = [
  ...network,
  ...platforms.slice(0, 4),
  ...ai,
  ...developer,
  ...packages,
  ...mirrors,
  ...cloud,
  ...tailscale,
  ...platforms.slice(4),
]
