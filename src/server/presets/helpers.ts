import type { ServiceInput } from '../config.ts'

/** The object form of a target (presets never use the URL shorthand). */
export type Target = Exclude<NonNullable<ServiceInput['targets']>[number], string>

/**
 * A website or web app. HEAD keeps homepages from being downloaded on every attempt, and any 2xx
 * or 3xx counts: the question is whether the site answers, not which page it serves.
 */
export const site = (
  id: string,
  name: string,
  url: string,
  extra: Partial<Target> = {},
): Target => ({
  id,
  name,
  url,
  method: 'HEAD',
  expectStatus: ['2xx', '3xx'],
  ...extra,
})

/**
 * An endpoint that answers unauthenticated requests with a fixed error by design (401, 404, …).
 * The expected error proves the path; it says nothing about whether real requests would succeed.
 */
export const reachability = (
  id: string,
  name: string,
  url: string,
  expectStatus: Target['expectStatus'],
  extra: Partial<Target> = {},
): Target => ({ id, name, url, expectStatus, check: 'reachability', ...extra })

/** Latency probes take more samples so jitter and loss mean something. */
export const ping = (id: string, name: string, host: string): Target => ({
  id,
  name,
  url: `icmp://${host}`,
  samples: 10,
})

export const tcp = (
  id: string,
  name: string,
  host: string,
  port: number,
  note?: string,
): Target => ({
  id,
  name,
  url: `tcp://${host}:${port}`,
  note,
})

export const udpDns = (
  id: string,
  name: string,
  server: string,
  query = 'example.com',
): Target => ({
  id,
  name,
  url: `dns://${server}?name=${query}`,
})

export const dot = (id: string, name: string, server: string, sni?: string): Target => ({
  id,
  name,
  url: `dot://${server}?name=example.com${sni ? `&sni=${sni}` : ''}`,
})

export const stun = (id: string, name: string, host: string, port = 3478): Target => ({
  id,
  name,
  url: `stun://${host}:${port}`,
})

export const quic = (
  id: string,
  name: string,
  host: string,
  port = 443,
  note?: string,
): Target => ({
  id,
  name,
  url: `quic://${host}:${port}`,
  note,
})

/**
 * A web app behind Cloudflare's bot check, which answers 403 to every non-browser client. The
 * site's own `/cdn-cgi/trace` crosses the same edge without the check, so it stands in for the
 * page: a 200 proves the path, and the trace shows the address the site saw.
 */
export const edge = (
  id: string,
  name: string,
  host: string,
  extra: Partial<Target> = {},
): Target => ({
  id,
  name,
  url: `https://${host}/cdn-cgi/trace`,
  note: 'Cloudflare challenges non-browser clients on the page itself; its edge trace answers.',
  ...extra,
})
