import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/server/config.ts'
import { Store } from '../src/server/db.ts'
import { Runner } from '../src/server/runner.ts'
import type { RunEvent, RunParams } from '../src/shared/types.ts'
import { type FaultServers, startFaultServers } from './fault-server.ts'

let servers: FaultServers

beforeAll(async () => {
  servers = await startFaultServers()
})
afterAll(async () => {
  await servers.close()
})

const setup = () => {
  const config = resolveConfig({
    presets: { enabled: false },
    publicIpCheckUrl: `${servers.http}/ok`,
    services: [{ id: 'local', targets: [{ id: 'ok', url: `${servers.http}/ok` }] }],
  })
  const store = new Store(':memory:')
  const runner = new Runner(config, store, {
    hostLabel: 'test',
    environment: 'host',
    platform: 'test',
    curlVersion: 'test',
  })
  return { runner, store }
}

const params: RunParams = {
  mode: 'quick',
  egressId: 'direct',
  ipFamily: 'auto',
  repeats: 2,
  targetIds: ['local.ok'],
}

const waitFor = async (check: () => boolean, timeoutMs = 10_000) => {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('run queue', () => {
  it('queues concurrent runs and starts each when the one ahead finishes', async () => {
    const { runner, store } = setup()
    const first = runner.start(params)
    const second = runner.start(params)
    const third = runner.start(params)

    expect(first.status).toBe('running')
    expect(second).toMatchObject({ status: 'queued', queueAhead: 1 })
    expect(third).toMatchObject({ status: 'queued', queueAhead: 2 })
    expect(runner.activeRunId).toBe(first.id)
    expect(runner.queuedRunIds).toEqual([second.id, third.id])

    // The queued run hears when it moves up and when it starts.
    const seen: RunEvent[] = []
    runner.subscribe(third.id, (event) => seen.push(event))

    await waitFor(() => store.getRun(third.id)?.status === 'completed')
    const runs = [first, second, third].map((r) => store.getRun(r.id)!)
    expect(runs.map((r) => r.status)).toEqual(['completed', 'completed', 'completed'])
    // Never overlapping: each run finished before the next was created as running.
    expect(runs[0]!.finishedAt! <= runs[1]!.finishedAt!).toBe(true)
    const statuses = seen.flatMap((e) =>
      e.type === 'run' ? [`${e.run.status}:${e.run.queueAhead}`] : [],
    )
    expect(statuses).toContain('queued:1')
    expect(statuses).toContain('running:null')
    expect(statuses.at(-1)).toBe('completed:null')
  })

  it('cancels a queued run without ever starting it', async () => {
    const { runner, store } = setup()
    const first = runner.start(params)
    const second = runner.start(params)
    expect(runner.cancel(second.id)).toBe(true)

    expect(store.getRun(second.id)).toMatchObject({ status: 'cancelled', queueAhead: null })
    expect(runner.queuedRunIds).toEqual([])
    await waitFor(() => store.getRun(first.id)?.status === 'completed')
    // The cancelled run's targets were never measured.
    expect(store.getRun(second.id)?.results.every((r) => r.attempts.length === 0)).toBe(true)
  })
})
