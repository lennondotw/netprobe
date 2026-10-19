import { publicStunServers } from '../../shared/stun.ts'

/**
 * Checks that run in the viewer's browser, so they describe the device the page is open on, not
 * the host that runs Netprobe.
 */

export interface IceCandidate {
  type: 'host' | 'srflx' | 'prflx' | 'relay'
  protocol: string
  address: string
  /** Browsers hide local addresses behind random `.local` names unless permissions allow more. */
  obfuscated: boolean
  /** STUN servers that reported this address (public candidates only). */
  servers: string[]
}

export interface BrowserCheck {
  checkedAt: string
  http: { source: string; ip: string | null; error: string | null }[]
  webrtc: {
    supported: boolean
    candidates: IceCandidate[]
    /** Every STUN server asked, and whether it answered. */
    stun: { name: string; answered: boolean }[]
    error: string | null
  }
}

const parseCandidate = (line: string): IceCandidate | null => {
  // candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> …
  const parts = line.replace(/^candidate:/, '').split(' ')
  const typeIndex = parts.indexOf('typ')
  const address = parts[4]
  const type = parts[typeIndex + 1]
  if (!address || typeIndex < 0 || !type) return null
  return {
    type: type as IceCandidate['type'],
    protocol: (parts[2] ?? '').toLowerCase(),
    address,
    obfuscated: address.endsWith('.local'),
    servers: [],
  }
}

/** Candidates one connection gathers with a single STUN server (or none). */
const gatherWith = async (
  server: string | null,
  timeoutMs: number,
): Promise<{ candidates: IceCandidate[]; error: string | null }> => {
  const connection = new RTCPeerConnection({ iceServers: server ? [{ urls: server }] : [] })
  const candidates: IceCandidate[] = []
  try {
    connection.createDataChannel('netprobe')
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      connection.addEventListener('icecandidate', (event) => {
        if (!event.candidate) {
          clearTimeout(timer)
          resolve()
          return
        }
        const parsed = parseCandidate(event.candidate.candidate)
        if (parsed) candidates.push(parsed)
      })
    })
    await connection.setLocalDescription(await connection.createOffer())
    await done
    return { candidates, error: null }
  } catch (error) {
    return { candidates, error: error instanceof Error ? error.message : String(error) }
  } finally {
    connection.close()
  }
}

/**
 * Gather ICE candidates: what a web page can learn about this device's addresses via WebRTC.
 * Each STUN server gets its own connection, so every public address is attributed to the
 * servers that saw it; behind split routing they can disagree.
 */
const gatherCandidates = async (timeoutMs = 5000): Promise<BrowserCheck['webrtc']> => {
  if (typeof RTCPeerConnection === 'undefined') {
    return {
      supported: false,
      candidates: [],
      stun: [],
      error: 'WebRTC is not available in this browser.',
    }
  }
  const perServer = await Promise.all(
    publicStunServers.map(async (server) => ({
      server,
      ...(await gatherWith(`stun:${server.host}:${server.port}`, timeoutMs)),
    })),
  )
  const candidates: IceCandidate[] = []
  for (const { server, candidates: found } of perServer) {
    for (const candidate of found) {
      const isPublic = candidate.type === 'srflx' || candidate.type === 'prflx'
      const existing = candidates.find(
        (c) =>
          c.address === candidate.address &&
          c.type === candidate.type &&
          c.protocol === candidate.protocol,
      )
      const entry = existing ?? candidate
      if (!existing) candidates.push(candidate)
      if (isPublic && !entry.servers.includes(server.name)) entry.servers.push(server.name)
    }
  }
  const stun = perServer.map(({ server, candidates: found }) => ({
    name: server.name,
    answered: found.some((c) => c.type === 'srflx' || c.type === 'prflx'),
  }))
  const error = perServer.every((p) => p.error) ? (perServer[0]?.error ?? null) : null
  return { supported: true, candidates, stun, error }
}

const httpSources = [
  { source: 'ipify (IPv4)', url: 'https://api.ipify.org?format=json' },
  { source: 'ipify (IPv6)', url: 'https://api6.ipify.org?format=json' },
  { source: 'ipinfo.io', url: 'https://ipinfo.io/json' },
]

const fetchIp = async ({ source, url }: (typeof httpSources)[number]) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' })
    const body = (await response.json()) as { ip?: unknown }
    return { source, ip: typeof body.ip === 'string' ? body.ip : null, error: null }
  } catch (error) {
    return { source, ip: null, error: error instanceof Error ? error.message : String(error) }
  }
}

export const runBrowserCheck = async (): Promise<BrowserCheck> => {
  const [http, webrtc] = await Promise.all([
    Promise.all(httpSources.map(fetchIp)),
    gatherCandidates(),
  ])
  return { checkedAt: new Date().toISOString(), http, webrtc }
}

/** Public addresses WebRTC exposes that the browser's ordinary HTTP traffic does not show. */
export const webrtcLeaks = (check: BrowserCheck) => {
  const seen = new Set(check.http.map((h) => h.ip).filter(Boolean))
  return check.webrtc.candidates.filter(
    (c) => (c.type === 'srflx' || c.type === 'prflx') && !c.obfuscated && !seen.has(c.address),
  )
}
