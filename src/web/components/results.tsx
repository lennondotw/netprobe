import type {
  Attempt,
  DownloadResult,
  RunMode,
  ServiceInfo,
  TargetInfo,
  TargetResult,
} from '../../shared/types.ts'
import {
  describeError,
  formatBytes,
  formatDateTime,
  formatMs,
  formatRate,
  formatRelative,
  hostOf,
  statusOf,
} from '../lib/format.ts'
import { Badge, StatusDot, type Tone } from './ui/badge.tsx'
import { DataTable, type DataTableColumn, type DataTableGroup } from './ui/data-table.tsx'
import { DetailDialog, DetailSection, useDetailDialog } from './ui/dialog.tsx'
import { Checkbox, Tooltip } from './ui/inputs.tsx'
import { Row, SectionLabel } from './ui/list.tsx'

export interface ResultEntry {
  result: TargetResult
  /** When the result was measured; omitted for the live run. */
  at?: string
}

const phaseBars = [
  { key: 'dns', label: 'DNS', className: 'bg-phase-dns' },
  { key: 'tcp', label: 'TCP', className: 'bg-phase-tcp' },
  { key: 'tls', label: 'TLS', className: 'bg-phase-tls' },
  { key: 'ttfb', label: 'TTFB', className: 'bg-phase-ttfb' },
] as const

type PhaseValues = Record<(typeof phaseBars)[number]['key'], number | null>

/**
 * A one-line request waterfall: each phase is a segment, scaled against the slowest request in
 * view so rows can be compared at a glance.
 */
export const Waterfall = ({
  phases,
  total,
  scale,
}: {
  phases: PhaseValues
  total: number | null
  scale: number
}) => {
  if (total == null || scale <= 0) return <span className='text-faint'>—</span>
  const parts = phaseBars.map((bar) => ({ ...bar, value: phases[bar.key] ?? 0 }))
  const rest = Math.max(total - parts.reduce((sum, p) => sum + p.value, 0), 0)
  return (
    <Tooltip
      content={
        <dl className='grid grid-cols-[auto_auto] gap-x-4 font-mono text-[11.5px]'>
          {parts.map((p) => (
            <div className='contents' key={p.key}>
              <dt className='flex items-center gap-1.5 text-muted'>
                <span className={`size-2 rounded-[2px] ${p.className}`} />
                {p.label}
              </dt>
              <dd className='text-right'>{formatMs(phases[p.key])}</dd>
            </div>
          ))}
          <dt className='text-muted'>Total</dt>
          <dd className='text-right'>{formatMs(total)}</dd>
        </dl>
      }
    >
      <span className='flex h-3 w-28 items-center' aria-label={`Total ${formatMs(total)}`}>
        <span
          className='flex h-1.5 overflow-hidden rounded-full bg-line-subtle'
          style={{ width: `${Math.max((total / scale) * 100, 2)}%` }}
        >
          {parts.map((p) =>
            p.value > 0 ? (
              <span
                className={p.className}
                key={p.key}
                style={{ width: `${(p.value / total) * 100}%` }}
              />
            ) : null,
          )}
          {rest > 0 && (
            <span className='bg-line-strong' style={{ width: `${(rest / total) * 100}%` }} />
          )}
        </span>
      </span>
    </Tooltip>
  )
}

const ErrorCell = ({ result }: { result: TargetResult | undefined }) => {
  const error = result?.summary?.topError
  if (!error) return <span className='text-faint'>—</span>
  const download = result.downloads.find((d) => d.errorKind)
  const sample =
    result.attempts.find((a) => a.errorKind === error.kind)?.errorMessage ??
    download?.errorMessage ??
    null
  const label = describeError(error.kind, error.phase)
  const count = error.count > 1 ? ` ×${error.count}` : ''
  return sample ? (
    <Tooltip content={<span className='font-mono text-[11.5px]'>{sample}</span>}>
      <span className='text-secondary'>
        {label}
        <span className='text-faint'>{count}</span>
      </span>
    </Tooltip>
  ) : (
    <span className='text-secondary'>{label}</span>
  )
}

const num = 'text-right font-mono text-[12px] tabular-nums text-secondary'

const RateCell = ({ download }: { download: DownloadResult | undefined }) => {
  if (!download) return <span className='text-faint'>—</span>
  if (!download.throughput) {
    return download.errorKind ? (
      <span className='text-faint'>{describeError(download.errorKind, null)}</span>
    ) : (
      <span className='text-faint'>—</span>
    )
  }
  const rate = formatRate(download.throughput.bytesPerSecond)
  return (
    <Tooltip
      content={`${rate.mbs} · ${formatBytes(download.throughput.bytes)} in ${download.throughput.transferSeconds}s`}
    >
      <span>{rate.mbps}</span>
    </Tooltip>
  )
}

interface Row {
  target: TargetInfo
  entry: ResultEntry | undefined
}

const columnsFor = (mode: RunMode, scale: number): DataTableColumn<Row>[] => {
  const name: DataTableColumn<Row> = {
    id: 'target',
    header: 'Target',
    primary: true,
    cell: ({ target }) => (
      <span className='flex min-w-0 items-baseline gap-2'>
        <span className='font-medium text-foreground'>{target.name}</span>
        <span className='max-w-56 truncate font-mono text-[11.5px] text-faint'>
          {hostOf(target.url)}
        </span>
      </span>
    ),
  }
  const status: DataTableColumn<Row> = {
    id: 'status',
    header: 'Status',
    cell: ({ target, entry }) => {
      const view = statusOf(target, entry?.result)
      return <Badge tone={view.tone}>{view.label}</Badge>
    },
  }
  const last: DataTableColumn<Row> = {
    id: 'last',
    header: 'Measured',
    className: 'text-right text-[12px] text-muted',
    cell: ({ entry }) =>
      entry?.at ? (
        <span title={formatDateTime(entry.at)}>{formatRelative(entry.at)}</span>
      ) : entry ? (
        'Live'
      ) : (
        '—'
      ),
  }
  const error: DataTableColumn<Row> = {
    id: 'error',
    header: 'Failure',
    cell: ({ entry }) => <ErrorCell result={entry?.result} />,
  }

  if (mode === 'download') {
    return [
      name,
      status,
      {
        id: 'size',
        header: 'Size',
        className: num,
        cell: ({ target, entry }) =>
          formatBytes(
            entry?.result.downloads[0]?.throughput?.bytes ?? target.download?.bytes ?? null,
          ),
      },
      {
        id: 'single',
        header: '1 connection',
        className: num,
        cell: ({ entry }) => (
          <RateCell download={entry?.result.downloads.find((d) => d.mode === 'single')} />
        ),
      },
      {
        id: 'multi',
        header: 'Parallel',
        className: num,
        cell: ({ entry }) => (
          <RateCell download={entry?.result.downloads.find((d) => d.mode === 'multi')} />
        ),
      },
      {
        id: 'ttfb',
        header: 'TTFB',
        className: num,
        cell: ({ entry }) => formatMs(entry?.result.summary?.median.ttfb),
      },
      error,
      last,
    ]
  }

  return [
    name,
    status,
    {
      id: 'success',
      header: 'OK',
      className: num,
      cell: ({ entry }) => {
        const s = entry?.result.summary
        if (!s || s.attempts === 0) return <span className='text-faint'>—</span>
        return (
          <span className={s.expected < s.attempts ? 'text-warning' : undefined}>
            {s.expected}/{s.attempts}
          </span>
        )
      },
    },
    ...(['dns', 'tcp', 'tls', 'ttfb'] as const).map((phase): DataTableColumn<Row> => ({
      id: phase,
      header: phase.toUpperCase(),
      className: num,
      cell: ({ entry }) => formatMs(entry?.result.summary?.median[phase]),
    })),
    {
      id: 'total',
      header: 'Total',
      className: `${num} text-foreground`,
      cell: ({ entry }) => formatMs(entry?.result.summary?.median.total),
    },
    {
      id: 'waterfall',
      header: 'Phases',
      cell: ({ entry }) => {
        const s = entry?.result.summary
        return (
          <Waterfall
            phases={s?.median ?? { dns: null, tcp: null, tls: null, ttfb: null }}
            scale={scale}
            total={s?.median.total ?? null}
          />
        )
      },
    },
    error,
    last,
  ]
}

interface ServiceResultsProps {
  services: readonly ServiceInfo[]
  mode: RunMode
  results: ReadonlyMap<string, ResultEntry>
  /** When provided, each group header gets a checkbox that includes the service in the next run. */
  selection?: {
    selected: ReadonlySet<string>
    toggle: (serviceId: string, checked: boolean) => void
    disabled: boolean
  }
}

/** Every service as a group header followed by a dense table of its targets. */
export const ServiceResults = ({ services, mode, results, selection }: ServiceResultsProps) => {
  const dialog = useDetailDialog<Row>()
  const visible = services
    .map((service) => ({
      service,
      rows: service.targets
        .filter((t) => (mode === 'download' ? t.download : !t.download))
        .map((target): Row => ({ target, entry: results.get(target.id) })),
    }))
    .filter((group) => group.rows.length > 0)

  // One scale for the whole page so waterfalls compare across services.
  const scale = Math.max(
    0,
    ...visible.flatMap((g) => g.rows.map((r) => r.entry?.result.summary?.median.total ?? 0)),
  )
  const columns = columnsFor(mode, scale)

  const groups = visible.map(({ service, rows }): DataTableGroup<Row> => {
    const counts = rows.reduce(
      (acc, row) => {
        const tone = statusOf(row.target, row.entry?.result).tone
        if (tone === 'success') acc.ok += 1
        else if (tone === 'warning' || tone === 'error') acc.bad += 1
        return acc
      },
      { ok: 0, bad: 0 },
    )
    return {
      id: service.id,
      label: service.name,
      rows,
      header: (
        <>
          {selection && (
            <Checkbox
              checked={selection.selected.has(service.id)}
              disabled={selection.disabled}
              label={`Include ${service.name}`}
              onCheckedChange={(checked) => selection.toggle(service.id, checked)}
            />
          )}
          <span>{service.name}</span>
          <span className='text-[12px] font-normal text-faint tabular-nums'>{rows.length}</span>
          <span className='hidden min-w-0 truncate font-normal text-faint xl:inline'>
            {service.description}
          </span>
          {counts.bad > 0 ? (
            <span className='ml-auto flex shrink-0 items-center gap-1.5 text-[12px] font-normal text-muted'>
              <StatusDot tone='warning' />
              {counts.bad} need attention
            </span>
          ) : counts.ok === rows.length ? (
            <span className='ml-auto flex shrink-0 items-center gap-1.5 text-[12px] font-normal text-muted'>
              <StatusDot tone='success' />
              All healthy
            </span>
          ) : null}
        </>
      ),
    }
  })

  return (
    <>
      <DataTable
        columns={columns}
        empty={null}
        getRowId={(row) => row.target.id}
        groups={groups}
        label='Targets'
        onRowOpen={dialog.show}
        selectedRowId={dialog.open ? (dialog.item?.target.id ?? null) : null}
      />
      <DetailDialog
        meta={dialog.item && <StatusBadge row={dialog.item} />}
        onOpenChange={dialog.onOpenChange}
        open={dialog.open}
        title={dialog.item?.target.name}
      >
        {dialog.item && <TargetDetail row={dialog.item} />}
      </DetailDialog>
    </>
  )
}

const StatusBadge = ({ row }: { row: Row }) => {
  const view = statusOf(row.target, row.entry?.result)
  return <Badge tone={view.tone}>{view.label}</Badge>
}

const outcomeTone: Record<Attempt['outcome'], Tone> = {
  failed: 'error',
  reachable: 'warning',
  expected: 'success',
  transferred: 'success',
}

const AttemptsTable = ({ attempts, label }: { attempts: readonly Attempt[]; label: string }) => (
  <div className='-mx-5 border-y border-line'>
    <DataTable
      columns={[
        { id: 'seq', header: '#', className: 'text-faint tabular-nums', cell: (a) => a.seq },
        {
          id: 'outcome',
          header: 'Result',
          cell: (a) => (
            <span className='flex items-center gap-1.5'>
              <StatusDot tone={outcomeTone[a.outcome]} />
              {a.errorKind
                ? describeError(a.errorKind, a.phase)
                : a.outcome === 'transferred'
                  ? 'Transferred'
                  : 'OK'}
            </span>
          ),
        },
        { id: 'status', header: 'HTTP', className: num, cell: (a) => a.httpStatus ?? '—' },
        {
          id: 'ip',
          header: 'Remote',
          className: 'font-mono text-[11.5px] text-muted',
          cell: (a) => a.remoteIp ?? '—',
        },
        { id: 'dns', header: 'DNS', className: num, cell: (a) => formatMs(a.phases.dns) },
        { id: 'tcp', header: 'TCP', className: num, cell: (a) => formatMs(a.phases.tcp) },
        { id: 'tls', header: 'TLS', className: num, cell: (a) => formatMs(a.phases.tls) },
        { id: 'ttfb', header: 'TTFB', className: num, cell: (a) => formatMs(a.phases.ttfb) },
        {
          id: 'total',
          header: 'Total',
          className: `${num} text-foreground`,
          cell: (a) => formatMs(a.totalMs),
        },
      ]}
      empty={<p className='px-5 py-3 text-[12.5px] text-muted'>No attempts yet.</p>}
      getRowId={(a) => String(a.seq)}
      label={label}
      rows={attempts}
    />
  </div>
)

const TargetDetail = ({ row }: { row: Row }) => {
  const { target, entry } = row
  const result = entry?.result
  const failures = [
    ...(result?.attempts ?? []),
    ...(result?.downloads.flatMap((d) => d.attempts) ?? []),
  ].filter((a) => a.errorMessage)

  return (
    <>
      <DetailSection>
        <dl className='grid'>
          <Row label='URL'>
            <span className='font-mono text-[11.5px] break-all select-text'>{target.url}</span>
          </Row>
          <Row label='Check'>
            {target.check === 'reachability'
              ? `Reachability — HTTP ${target.expectStatus.join('/')} proves the path, not the service`
              : `Expects HTTP ${target.expectStatus.join('/')}`}
          </Row>
          {entry?.at && <Row label='Measured'>{formatDateTime(entry.at)}</Row>}
          {result?.summary && result.summary.remoteIps.length > 0 && (
            <Row label='Remote IPs'>
              <span className='font-mono text-[11.5px]'>{result.summary.remoteIps.join(', ')}</span>
            </Row>
          )}
          {result?.summary && (
            <Row label='Total (min / median / max)'>
              <span className='font-mono text-[12px]'>
                {formatMs(result.summary.min.total)} / {formatMs(result.summary.median.total)} /{' '}
                {formatMs(result.summary.max.total)}
              </span>
            </Row>
          )}
        </dl>
        {target.note && (
          <p className='text-[12px] leading-5 text-muted select-text'>{target.note}</p>
        )}
      </DetailSection>

      {result?.downloads.map((download) => (
        <DetailSection key={download.mode}>
          <SectionLabel>
            {download.mode === 'single'
              ? 'Single connection'
              : `Parallel (${download.attempts.length} connections)`}
          </SectionLabel>
          <dl className='grid'>
            {download.throughput ? (
              <>
                <Row label='Throughput'>
                  <span className='font-mono text-[12px]'>
                    {formatRate(download.throughput.bytesPerSecond).mbps} ·{' '}
                    {formatRate(download.throughput.bytesPerSecond).mbs}
                  </span>
                </Row>
                <Row label='Including setup'>
                  <span className='font-mono text-[12px]'>
                    {formatRate(download.throughput.endToEndBytesPerSecond).mbps}
                  </span>
                </Row>
                <Row label='Received'>
                  <span className='font-mono text-[12px]'>
                    {formatBytes(download.throughput.bytes)} in{' '}
                    {download.throughput.transferSeconds}s (wall {download.throughput.wallSeconds}s)
                  </span>
                </Row>
              </>
            ) : (
              <Row label='Throughput'>Not measurable</Row>
            )}
            {download.errorKind && (
              <Row label='Problem'>{describeError(download.errorKind, null)}</Row>
            )}
          </dl>
          {download.errorMessage && (
            <p className='text-[12px] leading-5 text-muted select-text'>{download.errorMessage}</p>
          )}
          <AttemptsTable attempts={download.attempts} label='Connections' />
        </DetailSection>
      ))}

      {result && result.attempts.length > 0 && (
        <DetailSection>
          <SectionLabel>Attempts</SectionLabel>
          <AttemptsTable attempts={result.attempts} label='Attempts' />
        </DetailSection>
      )}

      {failures.length > 0 && (
        <DetailSection>
          <SectionLabel>Raw errors</SectionLabel>
          <ul className='grid gap-1 font-mono text-[11.5px] leading-5 text-secondary select-text'>
            {failures.map((a, i) => (
              <li key={i}>
                <span className='text-faint'>
                  #{a.seq} · curl {a.curlExit} ·{' '}
                </span>
                {a.errorMessage}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {!result && (
        <DetailSection>
          <p className='text-[12.5px] text-muted'>This target has not been measured yet.</p>
        </DetailSection>
      )}
    </>
  )
}
