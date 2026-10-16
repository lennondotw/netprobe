import type { ServiceInput } from '../config.ts'
import { developer } from './developer.ts'
import { network } from './network.ts'
import { platforms } from './platforms.ts'
import { tailscale } from './tailscale.ts'

/**
 * Built-in services, in display order. They only reference public, organisation-neutral
 * endpoints; anything deployment-specific (a bucket, a distribution, a deployment URL) is added
 * through config by declaring a service with the same id.
 *
 * `check: reachability` marks endpoints that answer unauthenticated requests with an error by
 * design. Such a response proves the network path works, not that the service would accept a
 * real request.
 */
export const presets: ServiceInput[] = [
  ...network,
  ...platforms.slice(0, 4),
  ...developer,
  ...tailscale,
  ...platforms.slice(4),
]
