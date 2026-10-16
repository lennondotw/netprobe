import { existsSync } from 'node:fs'

import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { AppConfig, IdentityReport, RunEvent } from '../shared/types.ts'
import { publicTarget, type ResolvedConfig } from './config.ts'
import type { Store } from './db.ts'
import { collectHostInfo } from './host.ts'
import { collectIdentity } from './identity.ts'
import { RunConflictError, type Runner } from './runner.ts'

const startRunSchema = z.object({
  mode: z.enum(['quick', 'download']),
  egressId: z.string(),
  ipFamily: z.enum(['auto', 'ipv4', 'ipv6']),
  repeats: z.number().int().min(1).max(20),
  targetIds: z.array(z.string()).min(1),
})

interface AppOptions {
  config: ResolvedConfig
  store: Store
  runner: Runner
  runtime: AppConfig['runtime']
  /** Directory with the built web client; skipped when it does not exist (dev mode). */
  webRoot: string
  logger: boolean
}

export const buildApp = async ({ config, store, runner, runtime, webRoot, logger }: AppOptions) => {
  const app: FastifyInstance = Fastify({
    logger: logger
      ? {
          // Request logs carry method, route, and status only; never headers or query strings.
          serializers: {
            req: (req: { method: string; routeOptions?: { url?: string } }) => ({
              method: req.method,
              url: req.routeOptions?.url ?? 'unmatched',
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        }
      : false,
  })

  app.get('/api/health', async () => ({ ok: true }))

  app.get('/api/config', async (): Promise<AppConfig> => ({
    services: config.services.map((service) => ({
      ...service,
      targets: service.targets.map(publicTarget),
    })),
    egress: config.egress.map(({ id, name, proxy }) => ({ id, name, proxy })),
    defaults: {
      repeats: config.probe.repeats,
      ipFamily: config.ipFamily,
      egressId: config.egress[0]!.id,
    },
    limits: { maxRepeats: 20, downloadConnections: config.download.connections },
    runtime,
    activeRunId: runner.activeRunId,
  }))

  app.get('/api/latest', async () => store.latestResults())

  app.get('/api/host', async () => collectHostInfo(runtime))

  // Identity checks call many third-party services, so results are kept per egress until re-run.
  const identities = new Map<string, IdentityReport>()

  app.get('/api/identity', async (request) => {
    const { egressId } = z.object({ egressId: z.string() }).parse(request.query)
    return identities.get(egressId) ?? null
  })

  app.post('/api/identity', async (request, reply) => {
    const parsed = z.object({ egressId: z.string() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) })
    const egress = config.egress.find((e) => e.id === parsed.data.egressId)
    if (!egress) return reply.code(400).send({ error: `Unknown egress "${parsed.data.egressId}".` })
    const report = await collectIdentity(egress, AbortSignal.timeout(45_000))
    identities.set(egress.id, report)
    return report
  })

  app.get('/api/runs', async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query)
    return store.listRuns(limit)
  })

  app.post('/api/runs', async (request, reply) => {
    const parsed = startRunSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) })
    try {
      return reply.code(201).send(runner.start(parsed.data))
    } catch (error) {
      if (error instanceof RunConflictError) return reply.code(409).send({ error: error.message })
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const run = runner.activeDetail(request.params.id) ?? store.getRun(request.params.id)
    if (!run) return reply.code(404).send({ error: 'Run not found.' })
    return run
  })

  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (request, reply) => {
    if (!runner.cancel(request.params.id))
      return reply.code(409).send({ error: 'Run is not active.' })
    return { ok: true }
  })

  /**
   * Server-sent events for one run: a snapshot first, then incremental updates. Finished runs
   * get the snapshot and the closing `run` event straight away.
   */
  app.get<{ Params: { id: string } }>('/api/runs/:id/events', (request, reply) => {
    const id = request.params.id
    const detail = runner.activeDetail(id) ?? store.getRun(id)
    if (!detail) {
      void reply.code(404).send({ error: 'Run not found.' })
      return
    }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = (event: RunEvent) => raw.write(`data: ${JSON.stringify(event)}\n\n`)
    send({ type: 'snapshot', run: detail })

    const unsubscribe = runner.subscribe(id, (event) => {
      send(event)
      if (event.type === 'run' && event.run.status !== 'running') close()
    })
    if (!unsubscribe) {
      send({ type: 'run', run: detail })
      raw.end()
      return
    }
    const heartbeat = setInterval(() => raw.write(': keep-alive\n\n'), 15_000)
    let closed = false
    function close() {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe?.()
      raw.end()
    }
    request.raw.on('close', close)
  })

  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      // Hashed bundles never change; the HTML shell must always be revalidated.
      setHeaders: (reply, path) => {
        reply.header(
          'cache-control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
      },
    })
    // Client-side routes fall back to the SPA shell; unknown API paths stay 404.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/'))
        return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'Not found.' })
    })
  }

  return app
}
