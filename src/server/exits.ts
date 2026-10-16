import { spawnSync } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { isIP } from 'node:net'
import { networkInterfaces, platform } from 'node:os'

import type { IpFamily } from '../shared/types.ts'
import type { ResolvedEgress } from './config.ts'
import { buildDnsQuery, parseDnsResponse } from './probes/packets.ts'

/**
 * Where an exit's traffic leaves from: the interface, and its addresses for source binding.
 * Bound exits are IPv4 only: policy routing is set up for the IPv4 address.
 */
export interface ExitBinding {
  interface: string
  address4: string | null
  address6: string | null
}

export class ExitError extends Error {}

const toInt = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0

const inSubnet = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split('/')
  if (!base || isIP(base) !== 4 || isIP(ip) !== 4) return false
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (toInt(ip) & mask) === (toInt(base) & mask)
}

/** The IPv4 address of a named interface. */
const addressesOf = (name: string): ExitBinding | null => {
  const entries = networkInterfaces()[name]
  if (!entries) return null
  const v4 = entries.find((e) => e.family === 'IPv4' && !e.internal)
  return { interface: name, address4: v4?.address ?? null, address6: null }
}

/** The interface whose connected IPv4 subnet contains `gateway`. */
export const interfaceFacing = (gateway: string): string | null => {
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (
      entries?.some(
        (e) => e.family === 'IPv4' && !e.internal && e.cidr && inSubnet(gateway, e.cidr),
      )
    ) {
      return name
    }
  }
  return null
}

/**
 * Resolve the binding for an exit at the moment it is used, so interfaces that come up after the
 * server starts still work. Direct and proxy exits have none.
 */
export const bindingFor = (egress: ResolvedEgress): ExitBinding | null => {
  if (egress.kind === 'interface') {
    const binding = addressesOf(egress.interfaceName!)
    if (!binding) throw new ExitError(`Interface "${egress.interfaceName}" does not exist here.`)
    return binding
  }
  if (egress.kind === 'gateway') {
    const name = interfaceFacing(egress.gateway!)
    if (!name)
      throw new ExitError(`No interface is on the same network as gateway ${egress.gateway}.`)
    return addressesOf(name)
  }
  return null
}

/**
 * One DNS query to the exit's resolver, sent from the exit's own address so it takes the same
 * route as the probe that follows. Returns null when the exit has no resolver of its own.
 */
export const resolveViaExit = async (
  egress: ResolvedEgress,
  binding: ExitBinding | null,
  host: string,
  family: IpFamily,
  timeoutMs = 3000,
): Promise<{ address: string; family: 4 | 6 } | null> => {
  if (!egress.dns || isIP(host)) return null
  const type = family === 'ipv6' ? 'AAAA' : 'A'
  const server = egress.dns
  const serverFamily = isIP(server) === 6 ? 6 : 4
  const local = serverFamily === 6 ? binding?.address6 : binding?.address4
  const { id, packet } = buildDnsQuery(host, type)

  return new Promise((resolve, reject) => {
    const socket = createSocket(serverFamily === 6 ? 'udp6' : 'udp4')
    const timer = setTimeout(() => {
      socket.close()
      reject(new ExitError(`DNS server ${server} did not answer for ${host}`))
    }, timeoutMs)
    socket.on('message', (message) => {
      const answer = parseDnsResponse(message, id)
      if (!answer) return
      clearTimeout(timer)
      socket.close()
      const address = answer.addresses[0]
      if (answer.rcode !== 'NOERROR' || !address) {
        reject(new ExitError(`${server} returned ${answer.rcode} for ${host}`))
      } else {
        resolve({ address, family: type === 'AAAA' ? 6 : 4 })
      }
    })
    socket.on('error', (error) => {
      clearTimeout(timer)
      socket.close()
      reject(error)
    })
    socket.bind({ address: local ?? undefined, port: 0 }, () => socket.send(packet, 53, server))
  })
}

export type ExitResolver = (
  host: string,
  family: IpFamily,
) => Promise<{ address: string; family: 4 | 6 } | null>

/** How a run reaches the network through its exit, worked out once when the run starts. */
export interface ExitRoute {
  binding: ExitBinding | null
  /** The exit's own resolver; null means the system resolver. */
  resolver: ExitResolver | null
  /** The requested family, narrowed to what a bound exit has addresses for. */
  ipFamily: IpFamily
  /**
   * Whether policy routing sends traffic from the binding's address out of its interface. Without
   * it a socket bound to that address still follows the default route, so only curl and ping,
   * which bind to the device itself, can use the exit.
   */
  routed: boolean
}

/** Whether an `ip rule` selects a table for traffic from this address (Linux only). */
const policyRouted = (address: string) => {
  if (platform() !== 'linux') return false
  const result = spawnSync('ip', ['-4', 'rule', 'show'], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.includes(`from ${address} lookup`)
}

export const unroutedMessage = (binding: ExitBinding) =>
  `Sockets cannot be bound to ${binding.interface} here: no policy routing for ${binding.address4}. ` +
  'Run Netprobe in Docker with the NET_ADMIN capability, which sets it up (see docs/deploy.md).'

/**
 * Work out an exit's route for a run. A bound exit only carries the families it has an address
 * for: letting the other family fall back to the default route would measure the wrong path.
 */
export const routeFor = (egress: ResolvedEgress, family: IpFamily): ExitRoute => {
  const binding = bindingFor(egress)
  const resolver: ExitResolver | null = egress.dns
    ? (host, f) => resolveViaExit(egress, binding, host, f)
    : null
  if (!binding) return { binding, resolver, ipFamily: family, routed: true }
  const has4 = binding.address4 !== null
  const has6 = binding.address6 !== null
  const missing = (family === 'ipv4' && !has4) || (family === 'ipv6' && !has6) || (!has4 && !has6)
  if (missing) {
    const wanted = family === 'auto' ? 'an IP' : `an ${family === 'ipv4' ? 'IPv4' : 'IPv6'}`
    throw new ExitError(`Interface ${binding.interface} has no ${wanted} address for this exit.`)
  }
  const ipFamily = family === 'auto' && has4 !== has6 ? (has4 ? 'ipv4' : 'ipv6') : family
  const routed = binding.address4 !== null && policyRouted(binding.address4)
  // The exit's DNS server is reached with a plain socket, so it needs the routing too.
  if (resolver && !routed) throw new ExitError(unroutedMessage(binding))
  return { binding, resolver, ipFamily, routed }
}

/**
 * curl `--resolve` entries that pin a URL's host to the exit resolver's answer, so curl skips the
 * system resolver. Redirects to other hosts still resolve through the system.
 */
export const resolveEntries = async (
  url: string,
  resolver: ExitResolver | null,
  family: IpFamily,
): Promise<string[]> => {
  if (!resolver) return []
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return []
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  const answer = await resolver(host, family)
  if (!answer) return []
  return [`${host}:${port}:${answer.family === 6 ? `[${answer.address}]` : answer.address}`]
}

/** Routing table and rule priority for the exit at this position in the config. */
export const exitTable = (index: number) => 1000 + index

/**
 * The `ip` commands that send an exit's traffic, and only its traffic, out of its interface: a
 * table whose default route is the gateway (or the interface itself, for tunnels), chosen for
 * packets from the interface's address or bound to the interface. Running them twice leaves the
 * same state.
 */
export const exitRouteCommands = (
  gateway: string | null,
  binding: { interface: string; address4: string | null },
  table: number,
): string[][] => {
  const t = String(table)
  const via = gateway ? ['via', gateway] : []
  const commands = [['route', 'replace', 'default', ...via, 'dev', binding.interface, 'table', t]]
  const selectors = [
    ...(binding.address4 ? [['from', binding.address4]] : []),
    ['oif', binding.interface],
  ]
  for (const selector of selectors) {
    // Drop an earlier copy first so a restart does not stack duplicate rules.
    commands.push(['rule', 'del', ...selector, 'lookup', t])
    commands.push(['rule', 'add', ...selector, 'lookup', t, 'priority', t])
  }
  return commands
}
