import type { RunRecord, RunStatus } from '../../shared/types.ts'
import { Badge, StatusDot, type Tone } from '../components/ui/badge.tsx'
import { Callout } from '../components/ui/callout.tsx'
import { DataTable } from '../components/ui/data-table.tsx'
import { gutter } from '../components/ui/layout.ts'
import { MetaList, PageHeader, Toolbar } from '../components/ui/page-header.tsx'
import { ListSkeleton } from '../components/ui/skeleton.tsx'
import { useRuns } from '../lib/api.ts'
import { formatDateTime, formatDuration, formatRelative } from '../lib/format.ts'
import { navigate } from '../lib/router.tsx'

export const runStatus: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'error' },
}

const ipLabel = { auto: 'Auto', ipv4: 'IPv4', ipv6: 'IPv6' } as const

const Totals = ({ run }: { run: RunRecord }) => {
  const { expected, reachable, failed, targets } = run.totals
  return (
    <span className='flex items-center gap-3 font-mono text-[12px] tabular-nums'>
      <span className='flex items-center gap-1.5' title='Healthy'>
        <StatusDot tone='success' />
        {expected}
      </span>
      <span
        className={`flex items-center gap-1.5 ${reachable ? '' : 'text-faint'}`}
        title='Unexpected response'
      >
        <StatusDot tone='warning' />
        {reachable}
      </span>
      <span className={`flex items-center gap-1.5 ${failed ? '' : 'text-faint'}`} title='Failed'>
        <StatusDot tone='error' />
        {failed}
      </span>
      <span className='text-faint'>/ {targets}</span>
    </span>
  )
}

export const HistoryPage = () => {
  const runs = useRuns()

  return (
    <>
      <PageHeader title='History' />
      <Toolbar>
        <MetaList>
          <span>{runs.data ? `${runs.data.length} runs` : 'Loading'}</span>
          <span>Click a run to see every attempt</span>
        </MetaList>
      </Toolbar>
      {runs.error && (
        <Callout role='alert' title='Could not load history' tone='danger'>
          {runs.error.message}
        </Callout>
      )}
      {!runs.data && !runs.error && <ListSkeleton groups={1} rows={8} />}
      {runs.data && (
        <DataTable
          columns={[
            {
              id: 'started',
              header: 'Started',
              primary: true,
              cell: (run) => (
                <span className='flex items-baseline gap-2'>
                  <span className='font-medium text-foreground'>
                    {formatDateTime(run.createdAt)}
                  </span>
                  <span className='text-[11.5px] text-faint'>{formatRelative(run.createdAt)}</span>
                </span>
              ),
            },
            {
              id: 'mode',
              header: 'Mode',
              cell: (run) => (run.params.mode === 'quick' ? 'Quick' : 'Download'),
            },
            {
              id: 'egress',
              header: 'Egress',
              cell: (run) => (
                <span className='flex items-baseline gap-2'>
                  {run.egress.name}
                  {run.egress.publicIp && (
                    <span className='font-mono text-[11.5px] text-faint'>
                      {run.egress.publicIp}
                    </span>
                  )}
                </span>
              ),
            },
            {
              id: 'ip',
              header: 'IP',
              className: 'text-muted',
              cell: (run) => ipLabel[run.params.ipFamily],
            },
            {
              id: 'where',
              header: 'Measured from',
              className: 'text-muted',
              cell: (run) =>
                `${run.runtime.hostLabel}${run.runtime.environment === 'container' ? ' (container)' : ''}`,
            },
            { id: 'totals', header: 'Results', cell: (run) => <Totals run={run} /> },
            {
              id: 'duration',
              header: 'Duration',
              className: 'text-right font-mono text-[12px] tabular-nums text-secondary',
              cell: (run) => formatDuration(run.createdAt, run.finishedAt),
            },
            {
              id: 'status',
              header: 'Status',
              cell: (run) => (
                <Badge tone={runStatus[run.status].tone}>{runStatus[run.status].label}</Badge>
              ),
            },
          ]}
          empty={
            <div className={`py-10 text-center text-[12.5px] text-muted ${gutter}`}>
              No runs yet. Start one from the Overview page.
            </div>
          }
          getRowId={(run) => run.id}
          label='Runs'
          onRowOpen={(run) => navigate(`/runs/${run.id}`)}
          rows={runs.data}
        />
      )}
    </>
  )
}
