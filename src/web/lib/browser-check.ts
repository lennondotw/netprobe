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
}

export interface BrowserCheck {
  checkedAt: string
  http: { source: string; ip: string | null; error: string | null }[]
  webrtc: { supported: boolean; candidates: IceCandidate[]; error: string | null }
}

const stunServers = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']

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
  }
}

/** Gather ICE candidates: what a web page can learn about this device's addresses via WebRTC. */
const gatherCandidates = async (timeoutMs = 4000): Promise<BrowserCheck['webrtc']> => {
  if (typeof RTCPeerConnection === 'undefined') {
    return { supported: false, candidates: [], error: 'WebRTC is not available in this browser.' }
  }
  const connection = new RTCPeerConnection({ iceServers: stunServers.map((urls) => ({ urls })) })
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
        if (
          parsed &&
          !candidates.some((c) => c.address === parsed.address && c.type === parsed.type)
        ) {
          candidates.push(parsed)
        }
      })
    })
    await connection.setLocalDescription(await connection.createOffer())
    await done
    return { supported: true, candidates, error: null }
  } catch (error) {
    return {
      supported: true,
      candidates,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    connection.close()
  }
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
