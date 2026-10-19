import type { ExitObservation } from '../shared/types.ts'
import { fetchText, type FetchTextOptions } from './curl.ts'

/**
 * Read Cloudflare's `/cdn-cgi/trace` answer: `key=value` lines describing the request as
 * Cloudflare saw it. Null when the body is not one (the host is not behind Cloudflare).
 */
export const parseTrace = (host: string, body: string): ExitObservation | null => {
  const values = new Map(
    body
      .split('\n')
      .map((line) => line.trim().split('='))
      .filter((parts): parts is [string, string] => parts.length === 2 && parts[0] !== ''),
  )
  const ip = values.get('ip')
  if (!ip || !values.has('colo')) return null
  return { host, ip, colo: values.get('colo') ?? null, loc: values.get('loc') ?? null }
}

/**
 * Ask a site behind Cloudflare which address the request came from, over the same exit as the
 * probe. Rule-based proxies pick a route per domain, so this can differ from site to site.
 */
export const traceExit = async (
  host: string,
  options: FetchTextOptions,
): Promise<ExitObservation | null> => {
  try {
    return parseTrace(host, await fetchText(`https://${host}/cdn-cgi/trace`, options))
  } catch {
    // A site that blocks the path or fails here has no observation; its probe result says why.
    return null
  }
}
