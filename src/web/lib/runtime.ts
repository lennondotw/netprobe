import type { RuntimeInfo } from '../../shared/types.ts'

/**
 * Whether network measurements describe the host itself: true on the host, and in a container
 * that shares the host's network stack outside a VM.
 */
export const measuresHostNetwork = (runtime: RuntimeInfo) =>
  runtime.environment === 'host' || (runtime.dockerNetwork === 'host' && !runtime.vm)

export const measuredFrom = (runtime: RuntimeInfo) => {
  if (runtime.environment === 'host') return 'Host'
  if (runtime.vm) return 'Container in a VM'
  if (runtime.dockerNetwork === 'host') return 'Container, host network'
  if (runtime.dockerNetwork === 'bridge') return 'Container, bridge network'
  return 'Container'
}

/** Why container results may differ from the host, or null when they do not. */
export const containerCaveat = (runtime: RuntimeInfo): string | null => {
  if (measuresHostNetwork(runtime)) return null
  if (runtime.vm) {
    return 'This container runs inside a Linux VM (Docker Desktop, OrbStack, or WSL), so traffic crosses the VM’s NAT, and proxies or TUN interfaces on the host may not apply. Compare with a run on the host before drawing conclusions about the host’s own traffic.'
  }
  return 'Traffic leaves through Docker’s bridge network and its NAT. Run the container with host networking (see compose.host.yaml) to measure exactly what the host sees.'
}
