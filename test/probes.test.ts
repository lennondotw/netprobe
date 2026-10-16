import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { type AddressInfo, createServer, type Server } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { jitterOf, statusMatches } from '../src/server/classify.ts'
import { runPing, runSocketProbe } from '../src/server/probes/index.ts'

const context = (overrides: Partial<{ timeoutMs: number }> = {}) => ({
  seq: 1,
  connectTimeoutMs: 1000,
  timeoutMs: overrides.timeoutMs ?? 1500,
  ipFamily: 'ipv4' as const,
  signal: new AbortController().signal,
})

let tcp: Server
let tcpPort: number
let udp: UdpSocket
let udpPort: number
let silent: UdpSocket
let silentPort: number

/** One UDP responder that plays DNS, STUN, or QUIC depending on what it receives. */
const respond = (message: Buffer, reply: (data: Buffer) => void, port: number) => {
  if (
    message.length >= 20 &&
    message.readUInt16BE(0) === 0x0001 &&
    message.readUInt32BE(4) === 0x2112a442
  ) {
    // STUN binding success with XOR-MAPPED-ADDRESS 203.0.113.7:port.
    const response = Buffer.alloc(32)
    response.writeUInt16BE(0x0101, 0)
    response.writeUInt16BE(12, 2)
    message.copy(response, 4, 4, 20)
    response.writeUInt16BE(0x0020, 20)
    response.writeUInt16BE(8, 22)
    response.writeUInt8(0x01, 25)
    response.writeUInt16BE(port ^ 0x2112, 26)
    response.writeUInt32BE((((203 << 24) | (0 << 16) | (113 << 8) | 7) ^ 0x2112a442) >>> 0, 28)
    return reply(response)
  }
  if (message.length >= 1200 && (message[0]! & 0x80) !== 0) {
    // QUIC: echo connection IDs back swapped, offer v1.
    const dcidLength = message[5]!
    const dcid = message.subarray(6, 6 + dcidLength)
    const scidLength = message[6 + dcidLength]!
    const scid = message.subarray(7 + dcidLength, 7 + dcidLength + scidLength)
    const version = Buffer.alloc(4)
    version.writeUInt32BE(1)
    return reply(
      Buffer.concat([
        Buffer.from([0x80, 0, 0, 0, 0, scid.length]),
        scid,
        Buffer.from([dcid.length]),
        dcid,
        version,
      ]),
    )
  }
  // DNS: answer the question with 192.0.2.1.
  const response = Buffer.concat([
    message,
    Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 1]),
  ])
  response.writeUInt16BE(0x8180, 2)
  response.writeUInt16BE(1, 6)
  reply(response)
}

beforeAll(async () => {
  tcp = createServer((socket) => socket.end())
  await new Promise<void>((done) => tcp.listen(0, '127.0.0.1', done))
  tcpPort = (tcp.address() as AddressInfo).port

  udp = createSocket('udp4')
  udp.on('message', (message, info) =>
    respond(message, (data) => udp.send(data, info.port, info.address), info.port),
  )
  await new Promise<void>((done) => udp.bind(0, '127.0.0.1', done))
  udpPort = udp.address().port

  silent = createSocket('udp4')
  await new Promise<void>((done) => silent.bind(0, '127.0.0.1', done))
  silentPort = silent.address().port
})

afterAll(() => {
  tcp.close()
  udp.close()
  silent.close()
})

describe('socket probes', () => {
  it('measures a TCP connect', async () => {
    const attempt = await runSocketProbe('tcp', `tcp://127.0.0.1:${tcpPort}`, context())
    expect(attempt).toMatchObject({ outcome: 'expected', remoteIp: '127.0.0.1' })
    expect(attempt.phases.tcp).not.toBeNull()
  })

  it('reports a refused TCP connect', async () => {
    const closed = createServer()
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done))
    const port = (closed.address() as AddressInfo).port
    await new Promise<void>((done) => closed.close(() => done()))
    const attempt = await runSocketProbe('tcp', `tcp://127.0.0.1:${port}`, context())
    expect(attempt).toMatchObject({ outcome: 'failed', errorKind: 'connect_refused', phase: 'tcp' })
  })

  it('resolves a name over UDP DNS', async () => {
    const attempt = await runSocketProbe(
      'dns',
      `dns://127.0.0.1:${udpPort}?name=example.com`,
      context(),
    )
    expect(attempt).toMatchObject({ outcome: 'expected', detail: '192.0.2.1' })
  })

  it('reads the mapped address from STUN', async () => {
    const attempt = await runSocketProbe('stun', `stun://127.0.0.1:${udpPort}`, context())
    expect(attempt.outcome).toBe('expected')
    expect(attempt.detail).toMatch(/^Mapped 203\.0\.113\.7:\d+$/)
  })

  it('detects a QUIC endpoint through version negotiation', async () => {
    const attempt = await runSocketProbe('quic', `quic://127.0.0.1:${udpPort}`, context())
    expect(attempt).toMatchObject({ outcome: 'expected', detail: 'QUIC v1' })
  })

  it('times out when nothing answers over UDP', async () => {
    const attempt = await runSocketProbe(
      'stun',
      `stun://127.0.0.1:${silentPort}`,
      context({ timeoutMs: 300 }),
    )
    expect(attempt).toMatchObject({ outcome: 'failed', errorKind: 'timeout' })
  })
})

describe('ping', () => {
  it('records one attempt per echo', async () => {
    const attempts = await runPing('icmp://127.0.0.1', 3, context())
    expect(attempts).toHaveLength(3)
    expect(attempts.every((a) => a.outcome === 'expected')).toBe(true)
  })
})

describe('helpers', () => {
  it('matches status classes', () => {
    expect(statusMatches(['2xx', '3xx'], 204)).toBe(true)
    expect(statusMatches(['2xx'], 301)).toBe(false)
    expect(statusMatches([401], 401)).toBe(true)
  })

  it('computes jitter from consecutive samples', () => {
    expect(jitterOf([10, 20, 10])).toBe(10)
    expect(jitterOf([10])).toBeNull()
  })
})
