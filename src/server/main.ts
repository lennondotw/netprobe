import { existsSync } from 'node:fs'
import { hostname, platform, release } from 'node:os'
import { resolve } from 'node:path'

import type { RuntimeInfo } from '../shared/types.ts'
import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { curlVersion } from './curl.ts'
import { Store } from './db.ts'
import { Runner } from './runner.ts'

const env = process.env
const port = Number(env.NETPROBE_PORT ?? 8080)
const host = env.NETPROBE_HOST ?? '0.0.0.0'
const configPath = env.NETPROBE_CONFIG ?? resolve('config/netprobe.yaml')
const dataPath = env.NETPROBE_DATA ?? resolve('data/netprobe.db')
const webRoot = resolve(import.meta.dirname, '../../dist/web')

const config = loadConfig(configPath)

/**
 * Inside Docker on macOS or Windows traffic crosses an extra VM and NAT layer, so every run
 * records where it was measured from. NETPROBE_ENVIRONMENT overrides the detection.
 */
const detectEnvironment = (): RuntimeInfo['environment'] => {
  if (env.NETPROBE_ENVIRONMENT === 'container' || env.NETPROBE_ENVIRONMENT === 'host') {
    return env.NETPROBE_ENVIRONMENT
  }
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv') ? 'container' : 'host'
}

const dockerNetwork = (): RuntimeInfo['dockerNetwork'] =>
  env.NETPROBE_DOCKER_NETWORK === 'host' || env.NETPROBE_DOCKER_NETWORK === 'bridge'
    ? env.NETPROBE_DOCKER_NETWORK
    : null

const runtime: RuntimeInfo = {
  hostLabel: env.NETPROBE_HOST_LABEL || config.hostLabel || hostname(),
  environment: detectEnvironment(),
  dockerNetwork: dockerNetwork(),
  // Docker Desktop, OrbStack, and WSL 2 run containers in a Linux VM with their own NAT.
  vm: /linuxkit|orbstack|microsoft|wsl/i.test(release()),
  platform: `${platform()} ${release()}`,
  curlVersion: await curlVersion(),
}

const store = new Store(dataPath)
store.failInterruptedRuns()
const runner = new Runner(config, store, runtime)
const app = await buildApp({ config, store, runner, runtime, webRoot, logger: true })

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await runner.shutdown()
  await app.close()
  store.close()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ port, host })
app.log.info(
  {
    config: existsSync(configPath) ? configPath : 'built-in presets only',
    environment: runtime.environment,
    targets: config.targets.size,
  },
  'netprobe ready',
)
