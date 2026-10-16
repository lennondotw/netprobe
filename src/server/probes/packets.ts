import { randomBytes } from 'node:crypto'

/**
 * Minimal wire formats for the UDP probes: DNS queries (RFC 1035), STUN binding requests
 * (RFC 8489), and QUIC version negotiation (RFC 9000 §6). Only the fields the probes need are
 * encoded or decoded.
 */

/** Canonical (compressed, lowercase) text form of a 16-byte IPv6 address. */
const formatIpv6 = (bytes: Uint8Array) => {
  const groups = Array.from({ length: 8 }, (_, g) =>
    ((bytes[g * 2]! << 8) | bytes[g * 2 + 1]!).toString(16),
  )
  return new URL(`http://[${groups.join(':')}]/`).hostname.slice(1, -1)
}

export type DnsType = 'A' | 'AAAA'
const dnsTypeCode: Record<DnsType, number> = { A: 1, AAAA: 28 }

const rcodeNames = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED']

export const buildDnsQuery = (name: string, type: DnsType) => {
  const id = randomBytes(2).readUInt16BE(0)
  const labels = name
    .replace(/\.$/, '')
    .split('.')
    .map((label) => {
      const bytes = Buffer.from(label, 'ascii')
      return Buffer.concat([Buffer.from([bytes.length]), bytes])
    })
  const header = Buffer.alloc(12)
  header.writeUInt16BE(id, 0)
  header.writeUInt16BE(0x0100, 2) // standard query, recursion desired
  header.writeUInt16BE(1, 4) // one question
  const question = Buffer.alloc(4)
  question.writeUInt16BE(dnsTypeCode[type], 0)
  question.writeUInt16BE(1, 2) // class IN
  return { id, packet: Buffer.concat([header, ...labels, Buffer.from([0]), question]) }
}

const skipName = (buffer: Buffer, offset: number): number => {
  let at = offset
  while (at < buffer.length) {
    const length = buffer[at]!
    if (length === 0) return at + 1
    if ((length & 0xc0) === 0xc0) return at + 2 // compression pointer ends the name
    at += length + 1
  }
  throw new Error('Truncated name')
}

export interface DnsAnswer {
  rcode: string
  addresses: string[]
}

/** Parse a response to `id`; returns null for packets that are not that response. */
export const parseDnsResponse = (buffer: Buffer, id: number): DnsAnswer | null => {
  if (buffer.length < 12 || buffer.readUInt16BE(0) !== id) return null
  const flags = buffer.readUInt16BE(2)
  if ((flags & 0x8000) === 0) return null
  const rcode = rcodeNames[flags & 0x0f] ?? `RCODE${flags & 0x0f}`
  const questions = buffer.readUInt16BE(4)
  const answers = buffer.readUInt16BE(6)
  let at = 12
  for (let i = 0; i < questions; i++) at = skipName(buffer, at) + 4
  const addresses: string[] = []
  for (let i = 0; i < answers && at < buffer.length; i++) {
    at = skipName(buffer, at)
    const type = buffer.readUInt16BE(at)
    const length = buffer.readUInt16BE(at + 8)
    const data = buffer.subarray(at + 10, at + 10 + length)
    if (type === 1 && length === 4) addresses.push([...data].join('.'))
    if (type === 28 && length === 16) addresses.push(formatIpv6(data))
    at += 10 + length
  }
  return { rcode, addresses }
}

const stunMagic = 0x2112a442

export const buildStunRequest = () => {
  const transactionId = randomBytes(12)
  const packet = Buffer.alloc(20)
  packet.writeUInt16BE(0x0001, 0) // Binding Request
  packet.writeUInt16BE(0, 2)
  packet.writeUInt32BE(stunMagic, 4)
  transactionId.copy(packet, 8)
  return { transactionId, packet }
}

/** The public address the server saw, from XOR-MAPPED-ADDRESS (or legacy MAPPED-ADDRESS). */
export const parseStunResponse = (buffer: Buffer, transactionId: Buffer): string | null => {
  if (buffer.length < 20 || buffer.readUInt16BE(0) !== 0x0101) return null
  if (buffer.readUInt32BE(4) !== stunMagic || !buffer.subarray(8, 20).equals(transactionId))
    return null
  const end = Math.min(buffer.length, 20 + buffer.readUInt16BE(2))
  let mapped: string | null = null
  for (let at = 20; at + 4 <= end;) {
    const type = buffer.readUInt16BE(at)
    const length = buffer.readUInt16BE(at + 2)
    const value = buffer.subarray(at + 4, at + 4 + length)
    if ((type === 0x0020 || type === 0x0001) && value.length >= 8) {
      const xor = type === 0x0020
      const family = value[1]
      const port = value.readUInt16BE(2) ^ (xor ? stunMagic >>> 16 : 0)
      if (family === 0x01) {
        const raw = value.readUInt32BE(4) ^ (xor ? stunMagic : 0)
        const ip = [raw >>> 24, (raw >>> 16) & 255, (raw >>> 8) & 255, raw & 255].join('.')
        mapped = `${ip}:${port}`
      } else if (family === 0x02 && value.length >= 20) {
        const mask = Buffer.concat([buffer.subarray(4, 8), transactionId])
        const bytes = value.subarray(4, 20).map((b, i) => (xor ? b ^ mask[i]! : b))
        mapped = `[${formatIpv6(bytes)}]:${port}`
      }
      if (xor) return mapped
    }
    at += 4 + length + ((4 - (length % 4)) % 4)
  }
  return mapped
}

/**
 * A QUIC Initial-sized long-header packet carrying a reserved version (0x?a?a?a?a). RFC 9000
 * requires servers to answer such packets with Version Negotiation, which proves a QUIC endpoint
 * is reachable over UDP without needing a TLS handshake.
 */
export const buildQuicProbe = () => {
  const dcid = randomBytes(8)
  const scid = randomBytes(8)
  const header = Buffer.concat([
    Buffer.from([0xc0 | (randomBytes(1)[0]! & 0x0f)]),
    Buffer.from([0x1a, 0x2a, 0x3a, 0x4a]),
    Buffer.from([dcid.length]),
    dcid,
    Buffer.from([scid.length]),
    scid,
  ])
  // Servers ignore datagrams under 1200 bytes that could start a connection.
  const packet = Buffer.concat([header, randomBytes(1200 - header.length)])
  return { dcid, scid, packet }
}

/** Supported versions from a Version Negotiation reply addressed to our connection IDs. */
export const parseQuicVersionNegotiation = (buffer: Buffer, scid: Buffer): string[] | null => {
  if (buffer.length < 7 || (buffer[0]! & 0x80) === 0 || buffer.readUInt32BE(1) !== 0) return null
  let at = 5
  const dcidLength = buffer[at]!
  const dcid = buffer.subarray(at + 1, at + 1 + dcidLength)
  at += 1 + dcidLength
  const scidLength = buffer[at]!
  at += 1 + scidLength
  // The reply's destination is our source connection ID.
  if (!dcid.equals(scid)) return null
  const versions: string[] = []
  for (; at + 4 <= buffer.length; at += 4)
    versions.push(`0x${buffer.readUInt32BE(at).toString(16).padStart(8, '0')}`)
  return versions
}

const quicVersionNames: Record<string, string> = {
  '0x00000001': 'v1',
  '0x6b3343cf': 'v2',
  '0xff00001d': 'draft-29',
}

export const describeQuicVersions = (versions: readonly string[]) => {
  const known = versions.filter((v) => !/^0x.a.a.a.a$/.test(v)).map((v) => quicVersionNames[v] ?? v)
  return `QUIC ${[...new Set(known)].join(', ') || 'versions unknown'}`
}
