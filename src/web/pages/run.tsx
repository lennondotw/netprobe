import { useMemo } from 'react'

import { type ResultEntry, ServiceResults } from '../components/results.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Callout } from '../components/ui/callout.tsx'
import { buttonClass, quietLinkClass } from '../components/ui/controls.tsx'
import { MetaList, PageHeader, Toolbar } from '../components/ui/page-header.tsx'
import { ListSkeleton } from '../components/ui/skeleton.tsx'
import { useConfig, useRun } from '../lib/api.ts'
import { formatDateTime, formatDuration } from '../lib/format.ts'
import { Link } from '../lib/router.tsx'
import { useRunStream } from '../lib/use-run-stream.ts'
import { runStatus } from './history.tsx'

export const RunPage = ({ id }: { id: string }) => {
  const config = useConfig()
  const stored = useRun(id)
  const pending = stored.data?.status === 'running' || stored.data?.status === 'queued'
  const live = useRunStream(pending ? id : null)
  const run = live ?? stored.data

  const results = useMemo(() => {
    const map = new Map<string, ResultEntry>()
    for (const result of run?.results ?? []) {
      map.set(result.targetId, {
        result,
        at: run?.status === 'running' ? undefined : run?.createdAt,
      })
    }
    return map
  }, [run])

  // Only the services and targets this run measured, in configuration order.
  const services = useMemo(() => {
    if (!config.data || !run) return []
    const ids = new Set(run.params.targetIds)
    return config.data.services
      .map((s) => ({ ...s, targets: s.targets.filter((t) => ids.has(t.id)) }))
      .filter((s) => s.targets.length > 0)
  }, [config.data, run])

  const title = (
    <span className='flex items-center gap-2'>
      <Link className={quietLinkClass} href='/runs'>
        History
      </Link>
      <span className='text-faint'>/</span>
      {run ? formatDateTime(run.createdAt) : 'Run'}
    </span>
  )

  if (stored.error) {
    return (
      <>
        <PageHeader title={title} />
        <Callout role='alert' title='Could not load this run' tone='danger'>
          {stored.error.message}
        </Callout>
      </>
    )
  }
  if (!run) {
    return (
      <>
        <PageHeader title={title} />
        <ListSkeleton />
      </>
    )
  }

  const missing =
    run.params.targetIds.length - services.reduce((sum, s) => sum + s.targets.length, 0)

  return (
    <>
      <PageHeader
        actions={
          <a
            className={buttonClass.secondary}
            download={`netprobe-${run.id}.json`}
            href={`/api/runs/${run.id}`}
          >
            Export JSON
          </a>
        }
        title={title}
      />
      <Toolbar>
        <Badge tone={runStatus[run.status].tone}>{runStatus[run.status].label}</Badge>
        <MetaList>
          <span>
            {run.params.mode === 'quick' ? `Quick · ${run.params.repeats} repeats` : 'Download'}
          </span>
          <span>
            {run.egress.name}
            {run.egress.proxy && (
              <span className='font-mono text-faint'> via {run.egress.proxy}</span>
            )}
          </span>
          {run.egress.publicIp && <span className='font-mono'>{run.egress.publicIp}</span>}
          <span>IP {run.params.ipFamily}</span>
          <span>
            {run.runtime.hostLabel} · {run.runtime.environment}
          </span>
          <span>{formatDuration(run.createdAt, run.finishedAt)}</span>
        </MetaList>
      </Toolbar>
      {run.status === 'queued' && (
        <Callout title='Waiting for another test to finish' tone='warning'>
          Tests run one at a time so they do not skew each other.
          {run.queueAhead && run.queueAhead > 1
            ? ` ${run.queueAhead} runs are ahead of this one.`
            : ''}
        </Callout>
      )}
      {run.error && (
        <Callout role='alert' title='The run failed' tone='danger'>
          {run.error}
        </Callout>
      )}
      {missing > 0 && (
        <Callout title={`${missing} measured targets are no longer configured`} tone='warning'>
          Their results are kept in the exported JSON.
        </Callout>
      )}
      <ServiceResults mode={run.params.mode} results={results} services={services} />
    </>
  )
}
