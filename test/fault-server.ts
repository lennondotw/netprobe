import { createServer as createHttpServer } from 'node:http'
import {
  type AddressInfo,
  createServer as createTcpServer,
  type Server,
  type Socket,
} from 'node:net'

/**
 * Local servers that misbehave in specific, repeatable ways, so the classifier can be tested
 * against real curl processes instead of hand-written samples.
 */
export interface FaultServers {
  /** HTTP: `/ok`, `/status/500`, `/slow` (never answers), `/truncate`, `/reset-mid-body`, `/bytes/:n`. */
  http: string
  /** Accepts TCP, then resets the connection as soon as the client speaks (a TLS ClientHello). */
  tlsReset: string
  /** A port with nothing listening. */
  closed: string
  close: () => Promise<void>
}

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  )

export const startFaultServers = async (): Promise<FaultServers> => {
  const sockets = new Set<Socket>()
  const track = (server: Server) =>
    server.on('connection', (socket: Socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })

  const http = createHttpServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/ok') return res.end('ok')
    if (url === '/status/500') {
      res.statusCode = 500
      return res.end('boom')
    }
    if (url === '/slow') return // never respond
    if (url === '/truncate') {
      // Declare more than we send, then close cleanly: curl reports a partial transfer.
      res.writeHead(200, { 'content-length': '1000' })
      res.write('x'.repeat(100))
      setTimeout(() => res.socket?.destroy(), 50)
      return
    }
    if (url === '/reset-mid-body') {
      res.writeHead(200, { 'content-length': '100000' })
      res.write('x'.repeat(1000))
      setTimeout(() => res.socket?.resetAndDestroy(), 50)
      return
    }
    const bytes = /^\/bytes\/(\d+)$/.exec(url)
    if (bytes) {
      const total = Number(bytes[1])
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '')
      if (range) {
        const start = Number(range[1])
        const end = Math.min(Number(range[2]), total - 1)
        res.writeHead(206, {
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${total}`,
        })
        return res.end(Buffer.alloc(end - start + 1))
      }
      res.writeHead(200, { 'content-length': String(total) })
      return res.end(Buffer.alloc(total))
    }
    res.statusCode = 404
    res.end()
  })
  track(http)

  const tlsReset = createTcpServer((socket) => {
    socket.once('data', () => socket.resetAndDestroy())
  })
  track(tlsReset)

  // Grab a free port, then release it so connecting there is refused.
  const placeholder = createTcpServer()
  const closedPort = await listen(placeholder)
  await new Promise<void>((resolve) => placeholder.close(() => resolve()))

  const httpPort = await listen(http)
  const tlsPort = await listen(tlsReset)

  return {
    http: `http://127.0.0.1:${httpPort}`,
    tlsReset: `https://127.0.0.1:${tlsPort}`,
    closed: `http://127.0.0.1:${closedPort}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await Promise.all(
        [http, tlsReset].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      )
    },
  }
}
