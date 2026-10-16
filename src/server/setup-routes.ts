/**
 * Policy routing for interface and gateway exits, run as root by the container entrypoint before
 * the server drops to an unprivileged user. Each exit gets its own table, so only that exit's
 * traffic leaves through it and every other route in the container stays as Docker set it up.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { loadConfig } from './config.ts'
import { bindingFor, ExitError, exitRouteCommands, exitTable } from './exits.ts'

const env = process.env
const config = loadConfig(env.NETPROBE_CONFIG ?? resolve('config/netprobe.yaml'))
const exits = config.egress.flatMap((egress, index) =>
  egress.kind === 'gateway' || egress.kind === 'interface' ? [{ egress, index }] : [],
)

const log = (message: string) => console.log(`[setup-routes] ${message}`)

if (exits.length > 0 && env.NETPROBE_DOCKER_NETWORK === 'host') {
  // With host networking these rules would change the host's routing for everything on it.
  log(
    'Interface and gateway exits need the container to have its own network; skipping on host ' +
      'networking. Run the container on a bridge plus a network that reaches the gateway.',
  )
  process.exit(0)
}

let failed = false
for (const { egress, index } of exits) {
  let binding
  try {
    binding = bindingFor(egress)!
  } catch (error) {
    log(`${egress.id}: ${error instanceof ExitError ? error.message : String(error)}`)
    failed = true
    continue
  }
  if (!binding.address4) {
    log(`${egress.id}: ${binding.interface} has no IPv4 address`)
    failed = true
    continue
  }
  const table = exitTable(index)
  for (const args of exitRouteCommands(egress.gateway, binding, table)) {
    const result = spawnSync('ip', args, { encoding: 'utf8' })
    // Deleting a rule that is not there is the normal first-start case.
    if (result.status !== 0 && args[1] !== 'del') {
      log(`${egress.id}: ip ${args.join(' ')} failed: ${result.stderr.trim() || result.error}`)
      if (/Operation not permitted/.test(result.stderr))
        log('Add the NET_ADMIN capability to the container (cap_add: [NET_ADMIN]).')
      failed = true
    }
  }
  log(
    `${egress.id}: ${binding.address4} on ${binding.interface} → ` +
      `${egress.gateway ?? 'the interface'}, table ${table}`,
  )
}
// The server still starts: the affected exit reports its own error, the others keep working.
process.exit(failed ? 1 : 0)
