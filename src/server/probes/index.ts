import { spawn } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { connect as connectTcp, type Socket } from 'node:net'
import { platform } from 'node:os'
import { connect as connectTls, type TLSSocket } from 'node:tls'

import type { Attempt, ProbeKind } from '../../shared/types.ts'
import {
  localAddressFor,
  now,
  ProbeError,
  type ProbeContext,
  type ProbeTimings,
  resolve,
  toProbeAttempt,
  withTimeout,
} from './common.ts'
import {
  buildDnsQuery,
  buildQuicProbe,
  buildStunRequest,
  type DnsType,
  describeQuicVersions,
  parseDnsResponse,
  parseQuicVersionNegotiation,
  parseStunResponse,
} from './packets.ts'

const defaultPorts: Partial<Record<ProbeKind, number>> = {
  dns: 53,
  dot: 853,
  tls: 443,
  stun: 3478,
  quic: 443,
}

interface Endpoint {
  host: string
  port: number
  params: URLSearchParams
}

const endpointOf = (kind: ProbeKind, raw: string): Endpoint => {
  const url = new URL(raw)
  return {
    // URL keeps brackets around IPv6 literals; sockets want the bare address.
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port ? Number(url.port) : (defaultPorts[kind] ?? 0),
    params: url.searchParams,
  }
}

/** Runs one probe attempt and always returns an attempt; failures are recorded, not thrown. */
const attempt = async (
  context: ProbeContext,
  run: (
    timings: ProbeTimings,
    started: number,
    track: (phase: 'dns' | 'tcp' | 'tls' | 'http' | null) => void,
    remote: { ip: string | null; port: number | null },
    onCleanup: (fn: () => void) => void,
  ) => Promise<string | null>,
): Promise<Attempt> => {
  const startedAt = new Date().toISOString()
  const started = now()
  const timings: ProbeTimings = { dns: null, connect: null, tls: null, response: null }
  const remote = { ip: null as string | null, port: null as number | null }
  const cleanups: (() => void)[] = []
  try {
    const detail = await withTimeout(
      (track) => run(timings, started, track, remote, (fn) => cleanups.push(fn)),
      context.timeoutMs,
      context.signal,
      () => cleanups.forEach((fn) => fn()),
    )
    return toProbeAttempt({
      seq: context.seq,
      startedAt,
      started,
      timings,
      remoteIp: remote.ip,
      remotePort: remote.port,
      detail,
    })
  } catch (error) {
    return toProbeAttempt({
      seq: context.seq,
      startedAt,
      started,
      timings,
      remoteIp: remote.ip,
      remotePort: remote.port,
      error: error instanceof ProbeError ? error : new ProbeError('other', null, String(error)),
    })
  }
}

const lookupStep = async (
  endpoint: Endpoint,
  context: ProbeContext,
  timings: ProbeTimings,
  started: number,
  remote: { ip: string | null; port: number | null },
) => {
  const target = await resolve(endpoint.host, context.ipFamily, context.resolver)
  if (target.resolved) timings.dns = now() - started
  remote.ip = target.address
  remote.port = endpoint.port || null
  return target
}

const tcpProbe = (endpoint: Endpoint, context: ProbeContext) =>
  attempt(context, async (timings, started, track, remote, onCleanup) => {
    const target = await lookupStep(endpoint, context, timings, started, remote)
    track('tcp')
    await new Promise<void>((done, fail) => {
      const socket: Socket = connectTcp({
        host: target.address,
        port: endpoint.port,
        family: target.family,
        localAddress: localAddressFor(context, target.family),
      })
      onCleanup(() => socket.destroy())
      socket.once('connect', () => {
        timings.connect = now() - started
        timings.response = timings.connect
        done()
      })
      socket.once('error', fail)
    })
    return null
  })

const dnsName = (endpoint: Endpoint) => endpoint.params.get('name') ?? 'example.com'
const dnsType = (endpoint: Endpoint, family: 4 | 6): DnsType => {
  const type = endpoint.params.get('type')?.toUpperCase()
  if (type === 'A' || type === 'AAAA') return type
  return family === 6 ? 'AAAA' : 'A'
}

const describeAnswer = (answer: { rcode: string; addresses: string[] }) => {
  if (answer.rcode !== 'NOERROR')
    throw new ProbeError('bad_response', 'http', `DNS ${answer.rcode}`)
  return answer.addresses.length ? answer.addresses.slice(0, 2).join(', ') : 'NOERROR, no address'
}

/** DNS over TLS: connect, handshake, then one length-prefixed query on the stream. */
const dotProbe = (endpoint: Endpoint, context: ProbeContext) =>
  attempt(context, async (timings, started, track, remote, onCleanup) => {
    const target = await lookupStep(endpoint, context, timings, started, remote)
    const { id, packet } = buildDnsQuery(dnsName(endpoint), dnsType(endpoint, target.family))
    track('tcp')
    return new Promise<string>((done, fail) => {
      const servername = endpoint.params.get('sni') ?? (target.resolved ? endpoint.host : undefined)
      // TCP first, bound to the exit's address, then TLS over it: the TLS options have no
      // local address of their own.
      const raw: Socket = connectTcp({
        host: target.address,
        port: endpoint.port,
        family: target.family,
        localAddress: localAddressFor(context, target.family),
      })
      // `host` is what the certificate is checked against when there is no SNI name.
      const socket: TLSSocket = connectTls({
        socket: raw,
        host: target.address,
        servername,
        ALPNProtocols: ['dot'],
      })
      onCleanup(() => {
        socket.destroy()
        raw.destroy()
      })
      raw.once('connect', () => {
        timings.connect = now() - started
        track('tls')
      })
      raw.once('error', fail)
      socket.once('secureConnect', () => {
        timings.tls = now() - started
        track('http')
        const framed = Buffer.alloc(2 + packet.length)
        framed.writeUInt16BE(packet.length, 0)
        packet.copy(framed, 2)
        socket.write(framed)
      })
      let received = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        if (timings.response === null) timings.response = now() - started
        received = Buffer.concat([received, chunk])
        if (received.length < 2 || received.length < 2 + received.readUInt16BE(0)) return
        const answer = parseDnsResponse(received.subarray(2, 2 + received.readUInt16BE(0)), id)
        if (!answer) return fail(new ProbeError('bad_response', 'http', 'Unexpected DNS response'))
        try {
          done(describeAnswer(answer))
        } catch (error) {
          fail(error)
        }
      })
      socket.once('error', fail)
      socket.once('end', () =>
        fail(new ProbeError('reset', 'http', 'Connection closed before a response')),
      )
    })
  })

/** Send one datagram and wait for the first reply that `parse` accepts. */
const udpExchange = (
  endpoint: Endpoint,
  context: ProbeContext,
  build: (family: 4 | 6) => { packet: Buffer; parse: (reply: Buffer) => string | null },
) =>
  attempt(context, async (timings, started, track, remote, onCleanup) => {
    const target = await lookupStep(endpoint, context, timings, started, remote)
    const { packet, parse } = build(target.family)
    track(null)
    return new Promise<string>((done, fail) => {
      const socket = createSocket(target.family === 6 ? 'udp6' : 'udp4')
      onCleanup(() => socket.close())
      socket.on('message', (message, info) => {
        if (info.address !== target.address) return
        let detail: string | null
        try {
          detail = parse(message)
        } catch (error) {
          return fail(error)
        }
        if (detail === null) return
        timings.response = now() - started
        done(detail)
      })
      socket.once('error', fail)
      // Bind first when the exit has an address, so the datagram leaves through it.
      socket.bind({ address: localAddressFor(context, target.family), port: 0 }, () =>
        socket.send(packet, endpoint.port, target.address, (error) => {
          if (error) fail(error)
        }),
      )
    })
  })

const dnsProbe = (endpoint: Endpoint, context: ProbeContext) =>
  udpExchange(endpoint, context, (family) => {
    const { id, packet } = buildDnsQuery(dnsName(endpoint), dnsType(endpoint, family))
    return {
      packet,
      parse: (reply) => {
        const answer = parseDnsResponse(reply, id)
        return answer ? describeAnswer(answer) : null
      },
    }
  })

const stunProbe = (endpoint: Endpoint, context: ProbeContext) =>
  udpExchange(endpoint, context, () => {
    const { transactionId, packet } = buildStunRequest()
    return {
      packet,
      parse: (reply) => {
        const mapped = parseStunResponse(reply, transactionId)
        return mapped === null ? null : `Mapped ${mapped}`
      },
    }
  })

const quicProbe = (endpoint: Endpoint, context: ProbeContext) =>
  udpExchange(endpoint, context, () => {
    const { scid, packet } = buildQuicProbe()
    return {
      packet,
      parse: (reply) => {
        const versions = parseQuicVersionNegotiation(reply, scid)
        return versions === null ? null : describeQuicVersions(versions)
      },
    }
  })

/** Run one attempt of a socket-level probe. */
const tlsVersions = { '1.2': 'TLSv1.2', '1.3': 'TLSv1.3' } as const

/**
 * A TLS handshake made by Node's own OpenSSL, the way Node tools (npm, pnpm, Vercel, actions)
 * connect. Without `groups` it offers OpenSSL 3.5's default key shares, including the
 * post-quantum hybrid X25519MLKEM768, so the ClientHello is about 1.6 KB and spans several TCP
 * segments; some transparent proxies and middleboxes reset such handshakes. `groups` (an OpenSSL
 * group list such as `X25519:P-256`) and `version` (`1.2` or `1.3`) narrow the offer.
 */
const tlsProbe = (endpoint: Endpoint, context: ProbeContext) =>
  attempt(context, async (timings, started, track, remote, onCleanup) => {
    const target = await lookupStep(endpoint, context, timings, started, remote)
    track('tcp')
    return new Promise<string>((done, fail) => {
      const servername = endpoint.params.get('sni') ?? (target.resolved ? endpoint.host : undefined)
      const groups = endpoint.params.get('groups')
      const version = tlsVersions[endpoint.params.get('version') as keyof typeof tlsVersions]
      const raw: Socket = connectTcp({
        host: target.address,
        port: endpoint.port,
        family: target.family,
        localAddress: localAddressFor(context, target.family),
      })
      const socket: TLSSocket = connectTls({
        socket: raw,
        host: target.address,
        servername,
        ...(groups ? { ecdhCurve: groups } : {}),
        ...(version ? { minVersion: version, maxVersion: version } : {}),
      })
      onCleanup(() => {
        socket.destroy()
        raw.destroy()
      })
      raw.once('connect', () => {
        timings.connect = now() - started
        track('tls')
      })
      raw.once('error', fail)
      socket.once('secureConnect', () => {
        timings.tls = now() - started
        const key = socket.getEphemeralKeyInfo()
        const group = key && 'name' in key ? key.name : null
        done([socket.getProtocol(), group].filter(Boolean).join(' · '))
      })
      socket.once('error', fail)
    })
  })

export const runSocketProbe = (
  kind: ProbeKind,
  url: string,
  context: ProbeContext,
): Promise<Attempt> => {
  const endpoint = endpointOf(kind, url)
  switch (kind) {
    case 'tcp':
      return tcpProbe(endpoint, context)
    case 'dot':
      return dotProbe(endpoint, context)
    case 'tls':
      return tlsProbe(endpoint, context)
    case 'dns':
      return dnsProbe(endpoint, context)
    case 'stun':
      return stunProbe(endpoint, context)
    case 'quic':
      return quicProbe(endpoint, context)
    default:
      throw new Error(`${kind} is not a socket probe`)
  }
}

/**
 * ICMP echo through the system `ping`, which is setuid or capability-enabled where raw sockets
 * need privileges. One process sends every echo, so gaps between them stay even; each echo becomes
 * one attempt and a missing reply is recorded as packet loss.
 */
export const runPing = async (
  url: string,
  count: number,
  context: Omit<ProbeContext, 'seq'>,
): Promise<Attempt[]> => {
  const host = endpointOf('icmp', url).host
  const startedAt = new Date().toISOString()
  const started = now()
  let address: string
  let family: 4 | 6
  try {
    const target = await resolve(host, context.ipFamily, context.resolver)
    address = target.address
    family = target.family
  } catch (error) {
    const failure =
      error instanceof ProbeError ? error : new ProbeError('dns_failure', 'dns', String(error))
    return [
      toProbeAttempt({
        seq: 1,
        startedAt,
        started,
        timings: { dns: null, connect: null, tls: null, response: null },
        remoteIp: null,
        remotePort: null,
        error: failure,
      }),
    ]
  }

  const darwin = platform() === 'darwin'
  const waitMs = Math.min(context.timeoutMs, 2000)
  const command = family === 6 && darwin ? 'ping6' : 'ping'
  const args = ['-n', '-c', String(count), '-i', '0.2']
  if (family === 6 && !darwin) args.push('-6')
  // Bind to the exit's interface: -I on Linux (iputils), -b (boundif) on macOS.
  if (context.bind) args.push(darwin ? '-b' : '-I', context.bind.interface)
  // Per-reply wait: milliseconds on macOS, seconds on Linux. ping6 on macOS has no such flag.
  if (!(family === 6 && darwin))
    args.push('-W', darwin ? String(waitMs) : String(Math.ceil(waitMs / 1000)))
  args.push(address)

  const output = await new Promise<{ stdout: string; error: string | null }>((done) => {
    const child = spawn(command, args, { signal: context.signal, killSignal: 'SIGKILL' })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (error) =>
      done({ stdout, error: context.signal.aborted ? 'Cancelled' : error.message }),
    )
    child.on('close', () => done({ stdout, error: stderr.trim() || null }))
  })

  const replies = new Map<number, number>()
  for (const match of output.stdout.matchAll(/icmp_seq=(\d+).*?time[=<]([\d.]+)\s*ms/g)) {
    replies.set(Number(match[1]), Number(match[2]))
  }
  // macOS numbers echoes from 0, Linux from 1.
  const firstSeq = darwin ? 0 : 1
  const unavailable =
    replies.size === 0 && output.error && !/100(\.0)?% packet loss/.test(output.stdout)

  return Array.from({ length: count }, (_, i) => {
    const time = replies.get(firstSeq + i)
    const timings: ProbeTimings = { dns: null, connect: null, tls: null, response: time ?? null }
    if (time !== undefined) {
      return toProbeAttempt({
        seq: i + 1,
        startedAt,
        started,
        timings,
        remoteIp: address,
        remotePort: null,
      })
    }
    const error = context.signal.aborted
      ? new ProbeError('cancelled', null, 'Cancelled')
      : unavailable
        ? new ProbeError('other', null, output.error ?? 'ping failed')
        : new ProbeError('packet_loss', null, `No echo reply within ${waitMs} ms`)
    return {
      ...toProbeAttempt({
        seq: i + 1,
        startedAt,
        started,
        timings,
        remoteIp: address,
        remotePort: null,
        error,
      }),
      totalMs: waitMs,
    }
  })
}
