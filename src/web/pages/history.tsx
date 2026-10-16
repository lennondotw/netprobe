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

type TotalsKey = keyof RunRecord['totals']
type Widths = Record<TotalsKey, number>

const digits = (n: number) => String(n).length

/**
 * Digits each part of the results column needs, taken from the widest value of that part in the
 * list, so every row reserves the same space per part and the parts line up.
 */
const widthsOf = (runs: readonly RunRecord[]): Widths => {
  const widest = (key: TotalsKey) => Math.max(1, ...runs.map((run) => digits(run.totals[key])))
  return {
    expected: widest('expected'),
    reachable: widest('reachable'),
    failed: widest('failed'),
    targets: widest('targets'),
  }
}

/** A right-aligned count in a box sized for `width` digits of a monospace font. */
const Count = ({ value, width }: { value: number; width: number }) => (
  <span className='inline-block text-right' style={{ width: `${width}ch` }}>
    {value}
  </span>
)

const Totals = ({ run, widths }: { run: RunRecord; widths: Widths }) => {
  const { expected, reachable, failed, targets } = run.totals
  return (
    <span className='flex items-center gap-3 font-mono text-[12px] tabular-nums'>
      <span className='flex items-center gap-1.5' title='Healthy'>
        <StatusDot tone='success' />
        <Count value={expected} width={widths.expected} />
      </span>
      <span
        className={`flex items-center gap-1.5 ${reachable ? '' : 'text-faint'}`}
        title='Unexpected response'
      >
        <StatusDot tone='warning' />
        <Count value={reachable} width={widths.reachable} />
      </span>
      <span className={`flex items-center gap-1.5 ${failed ? '' : 'text-faint'}`} title='Failed'>
        <StatusDot tone='error' />
        <Count value={failed} width={widths.failed} />
      </span>
      <span className='flex items-center gap-1.5 text-faint'>
        /
        <Count value={targets} width={widths.targets} />
      </span>
    </span>
  )
}

export const HistoryPage = () => {
  const runs = useRuns()
  const widths = widthsOf(runs.data ?? [])

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
            {
              id: 'totals',
              header: 'Results',
              cell: (run) => <Totals run={run} widths={widths} />,
            },
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
