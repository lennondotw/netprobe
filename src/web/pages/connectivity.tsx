import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import type { AppConfig, IpFamily, LatestResult, RunMode, TargetInfo } from '../../shared/types.ts'
import { type ResultEntry, ServiceResults } from '../components/results.tsx'
import { Callout } from '../components/ui/callout.tsx'
import { buttonClass } from '../components/ui/controls.tsx'
import { Segmented, Select, TabBar } from '../components/ui/inputs.tsx'
import { MetaList, PageHeader, Toolbar } from '../components/ui/page-header.tsx'
import { ListSkeleton } from '../components/ui/skeleton.tsx'
import { cancelRun, queryKeys, startRun, useConfig, useLatest } from '../lib/api.ts'
import { formatBytes, formatRelative } from '../lib/format.ts'
import { containerCaveat } from '../lib/runtime.ts'
import { useRunStream } from '../lib/use-run-stream.ts'

const modes = [
  { value: 'quick', label: 'Quick' },
  { value: 'download', label: 'Download' },
] as const

const ipFamilies = [
  { value: 'auto', label: 'Auto' },
  { value: 'ipv4', label: 'IPv4' },
  { value: 'ipv6', label: 'IPv6' },
] as const

export const ConnectivityPage = () => {
  const config = useConfig()
  const latest = useLatest()

  if (config.error) {
    return (
      <>
        <PageHeader title='Connectivity' />
        <Callout role='alert' title='Could not load configuration' tone='danger'>
          {config.error.message}
        </Callout>
      </>
    )
  }
  if (!config.data) {
    return (
      <>
        <PageHeader title='Connectivity' />
        <ListSkeleton />
      </>
    )
  }
  return <Connectivity config={config.data} latest={latest.data ?? []} />
}

const allCategories = 'All'

const ownRunKey = 'netprobe.ownRunId'

/**
 * The id of the run this tab started, kept for the session so a reload still knows which queued
 * or running run is its own. Storage can be unavailable (private mode); then it lives in memory.
 */
const useOwnRunId = () => {
  const [id, setId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ownRunKey)
    } catch {
      return null
    }
  })
  const update = (next: string) => {
    setId(next)
    try {
      sessionStorage.setItem(ownRunKey, next)
    } catch {
      // Not persisted; the in-memory value still works for this page.
    }
  }
  return [id, update] as const
}

/** Mirrors the server: socket probes cannot go through a proxy, downloads only run in download mode. */
const isEligible = (target: TargetInfo, mode: RunMode, viaProxy: boolean) => {
  if (mode === 'download') return target.download !== null
  if (target.download) return false
  return target.kind === 'http' || !viaProxy
}

const Connectivity = ({
  config,
  latest,
}: {
  config: AppConfig
  latest: readonly LatestResult[]
}) => {
  const queryClient = useQueryClient()
  const [chosenMode, setMode] = useState<RunMode>('quick')
  const [egressId, setEgressId] = useState(config.defaults.egressId)
  const [ipFamily, setIpFamily] = useState<IpFamily>(config.defaults.ipFamily)
  const [repeats, setRepeats] = useState(String(config.defaults.repeats))
  // Store what the user turned off, so services added to the config later start selected.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [ownRunId, setOwnRunId] = useOwnRunId()
  const [category, setCategory] = useState(allCategories)

  // The run this page started, and whatever run is executing for someone else. Runs never
  // overlap: a new run waits in the server's queue until the one ahead of it finishes.
  const own = useRunStream(ownRunId)
  const otherRunId =
    config.activeRunId && config.activeRunId !== ownRunId ? config.activeRunId : null
  const other = useRunStream(otherRunId)
  const ownBusy = own
    ? own.status === 'running' || own.status === 'queued'
    : ownRunId !== null &&
      (config.activeRunId === ownRunId || config.queuedRunIds.includes(ownRunId))
  const running = ownBusy

  // While this page's run is live it shows that run's mode, whatever the selector last held.
  const mode = ownBusy && own ? own.params.mode : chosenMode

  const start = useMutation({
    mutationFn: startRun,
    onSuccess: (run) => {
      setOwnRunId(run.id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.config })
    },
  })
  const cancel = useMutation({ mutationFn: cancelRun })

  const viaProxy = config.egress.find((e) => e.id === egressId)?.kind === 'proxy'
  const eligible = (t: TargetInfo) => isEligible(t, mode, viaProxy)

  // Categories in order of first appearance; services are shown grouped by category.
  const categories = [...new Set(config.services.map((s) => s.category))]
  const ordered = categories.flatMap((c) => config.services.filter((s) => s.category === c))
  const visibleServices =
    category === allCategories ? ordered : ordered.filter((s) => s.category === category)

  const selected = useMemo(
    () => new Set(config.services.map((s) => s.id).filter((id) => !excluded.has(id))),
    [config.services, excluded],
  )
  const selectedTargets = visibleServices
    .filter((s) => selected.has(s.id))
    .flatMap((s) => s.targets)
    .filter(eligible)
  const skippedForProxy = viaProxy
    ? visibleServices
        .filter((s) => selected.has(s.id))
        .flatMap((s) => s.targets)
        .filter((t) => !t.download && t.kind !== 'http').length
    : 0

  const run = (targetIds: string[]) =>
    start.mutate({ mode, egressId, ipFamily, repeats: Number(repeats), targetIds })

  const tabs = [allCategories, ...categories].map((value) => ({
    value,
    label: value,
    count: (value === allCategories ? ordered : ordered.filter((s) => s.category === value))
      .flatMap((s) => s.targets)
      .filter(eligible).length,
  }))

  const results = useMemo(() => {
    const map = new Map<string, ResultEntry>()
    for (const item of latest)
      map.set(item.result.targetId, { result: item.result, at: item.createdAt })
    // Someone else's live run, then this page's own run on top.
    for (const run of [other, own]) {
      if (!run || run.status === 'queued') continue
      for (const result of run.results) {
        map.set(result.targetId, {
          result,
          at: run.status === 'running' ? undefined : run.createdAt,
        })
      }
    }
    return map
  }, [latest, other, own])

  const lastRunAt = latest.reduce<string | null>(
    (max, item) => (!max || item.createdAt > max ? item.createdAt : max),
    null,
  )
  const runningRun = own?.status === 'running' ? own : other?.status === 'running' ? other : null
  const progress = runningRun
    ? {
        done: runningRun.results.filter((r) => r.status === 'done').length,
        total: runningRun.results.length,
        own: runningRun === own,
      }
    : null
  const live = own ?? other

  const estimate = selectedTargets.reduce(
    (acc, t) => {
      if (!t.download) return acc
      if (t.download.bytes == null) return { ...acc, unknown: acc.unknown + 1 }
      return { ...acc, bytes: acc.bytes + t.download.bytes * (t.download.parallel ? 2 : 1) }
    },
    { bytes: 0, unknown: 0 },
  )

  const egressOptions = config.egress.map((e) => ({
    value: e.id,
    label: e.name,
    detail: e.detail,
  }))

  return (
    <>
      <PageHeader
        leading={
          // Leading slot: switching modes shows or hides Repeats, which must not move this control.
          config.modules.downloads && (
            <Segmented
              disabled={running}
              label='Mode'
              onChange={setMode}
              options={modes}
              value={mode}
            />
          )
        }
        actions={
          <>
            <Select
              disabled={running}
              label='Egress'
              onChange={setEgressId}
              options={egressOptions}
              value={egressId}
            />
            <Select
              disabled={running}
              label='IP'
              onChange={setIpFamily}
              options={ipFamilies}
              value={ipFamily}
            />
            {mode === 'quick' && (
              <Select
                disabled={running}
                label='Repeats'
                onChange={setRepeats}
                options={['1', '3', '5', '10', '20'].map((v) => ({ value: v, label: v }))}
                value={repeats}
              />
            )}
            {ownBusy && ownRunId ? (
              <button
                className={buttonClass.secondary}
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(ownRunId)}
                type='button'
              >
                Cancel
              </button>
            ) : (
              <button
                className={buttonClass.primary}
                disabled={selectedTargets.length === 0 || start.isPending}
                onClick={() => run(selectedTargets.map((t) => t.id))}
                type='button'
              >
                <svg aria-hidden='true' className='size-3 fill-current' viewBox='0 0 12 12'>
                  <path d='M3 2.2v7.6a.5.5 0 0 0 .76.43l6.2-3.8a.5.5 0 0 0 0-.86l-6.2-3.8A.5.5 0 0 0 3 2.2Z' />
                </svg>
                Run selected ({selectedTargets.length})
              </button>
            )}
          </>
        }
        title='Connectivity'
      />
      <div className='relative'>
        <Toolbar>
          <TabBar label='Category' onChange={setCategory} options={tabs} value={category} />
        </Toolbar>
        <Toolbar>
          <MetaList>
            <span>
              {selectedTargets.length} {selectedTargets.length === 1 ? 'target' : 'targets'}
            </span>
            {skippedForProxy > 0 && (
              <span>{skippedForProxy} socket probes skipped: they cannot use a proxy</span>
            )}
            {mode === 'download' && (
              <span>
                ≈ {formatBytes(estimate.bytes)} traffic
                {estimate.unknown > 0 && ` + ${estimate.unknown} of unknown size`}
              </span>
            )}
            {live?.egress.publicIp && (
              <span>
                Egress IP <span className='font-mono text-secondary'>{live.egress.publicIp}</span>
              </span>
            )}
            {own?.status === 'queued' ? (
              <span className='text-accent-text'>
                Waiting for another test to finish
                {own.queueAhead && own.queueAhead > 1 ? ` · ${own.queueAhead} ahead` : ''}
              </span>
            ) : progress ? (
              <span className='text-accent-text'>
                {progress.own ? 'Running' : 'Another test is running'} {progress.done}/
                {progress.total}
              </span>
            ) : (
              lastRunAt && <span>Last measured {formatRelative(lastRunAt)}</span>
            )}
          </MetaList>
        </Toolbar>
        {progress && (
          <div aria-hidden='true' className='absolute inset-x-0 bottom-0 h-px overflow-hidden'>
            <div
              className='h-full bg-accent transition-[width] duration-300 ease-out'
              style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
        )}
      </div>

      {containerCaveat(config.runtime) && (
        <Callout title='Measured from inside a container' tone='warning'>
          {containerCaveat(config.runtime)}
        </Callout>
      )}
      {start.error && (
        <Callout role='alert' title='Could not start the run' tone='danger'>
          {start.error.message}
        </Callout>
      )}
      {own?.status === 'failed' && own.error && (
        <Callout role='alert' title='The run failed' tone='danger'>
          {own.error}
        </Callout>
      )}
      {live?.egress.publicIpError && (
        <Callout title='Egress IP unknown' tone='warning'>
          {live.egress.publicIpError}
        </Callout>
      )}

      <ServiceResults
        mode={mode}
        results={results}
        selection={{
          selected,
          disabled: running,
          toggle: (serviceId, checked) =>
            setExcluded((current) => {
              const next = new Set(current)
              if (checked) next.delete(serviceId)
              else next.add(serviceId)
              return next
            }),
        }}
        runService={{
          disabled: running || start.isPending,
          run: (serviceId) =>
            run(
              (config.services.find((s) => s.id === serviceId)?.targets ?? [])
                .filter(eligible)
                .map((t) => t.id),
            ),
        }}
        services={visibleServices}
      />
    </>
  )
}
