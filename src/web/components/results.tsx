import type {
  Attempt,
  DownloadResult,
  ExitObservation,
  RunMode,
  ProbeKind,
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
  isFakeIp,
  statusOf,
} from '../lib/format.ts'
import { Badge, StatusDot, type Tone } from './ui/badge.tsx'
import { DataTable, type DataTableColumn, type DataTableGroup } from './ui/data-table.tsx'
import { DetailDialog, DetailSection, useDetailDialog } from './ui/dialog.tsx'
import { Checkbox } from './ui/inputs.tsx'
import { Row, SectionLabel } from './ui/list.tsx'
import { InfoHint } from './ui/tooltip.tsx'

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

const hasTiming = (total: number | null, scale: number): total is number =>
  total != null && scale > 0

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
  if (!hasTiming(total, scale)) return <span className='text-faint'>—</span>
  const parts = phaseBars.map((bar) => ({ ...bar, value: phases[bar.key] ?? 0 }))
  const rest = Math.max(total - parts.reduce((sum, p) => sum + p.value, 0), 0)
  return (
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
  )
}

const WaterfallDetail = ({ phases, total }: { phases: PhaseValues; total: number }) => (
  <dl className='grid grid-cols-[auto_auto] gap-x-4 font-mono text-[11.5px]'>
    {phaseBars.map((bar) => (
      <div className='contents' key={bar.key}>
        <dt className='flex items-center gap-1.5 text-muted'>
          <span className={`size-2 rounded-[2px] ${bar.className}`} />
          {bar.label}
        </dt>
        <dd className='text-right'>{formatMs(phases[bar.key])}</dd>
      </div>
    ))}
    <dt className='text-muted'>Total</dt>
    <dd className='text-right'>{formatMs(total)}</dd>
  </dl>
)

const topErrorOf = (result: TargetResult | undefined) => {
  const error = result?.summary?.topError
  if (!error) return null
  const sample =
    result.attempts.find((a) => a.errorKind === error.kind)?.errorMessage ??
    result.downloads.find((d) => d.errorKind)?.errorMessage ??
    null
  return { ...error, sample }
}

const kindLabel: Record<ProbeKind, string> = {
  http: 'HTTP',
  tcp: 'TCP',
  dns: 'DNS',
  dot: 'DoT',
  tls: 'TLS',
  stun: 'STUN',
  quic: 'QUIC',
  icmp: 'ICMP',
}

const KindTag = ({ kind }: { kind: ProbeKind }) => (
  <span className='inline-flex h-4 shrink-0 items-center self-center rounded-[4px] border border-line px-1 font-mono text-[10px] leading-none text-muted'>
    {kindLabel[kind]}
  </span>
)

const hasFakeIp = (detail: string) => detail.split(/[\s,]+/).some(isFakeIp)

/**
 * Fake-IP proxies hand out 198.18.0.0/15 addresses from their own DNS and terminate connections
 * locally. The hint explains what that does to this row's numbers.
 */
const FakeIpHint = ({
  target,
  result,
}: {
  target: TargetInfo
  result: TargetResult | undefined
}) => {
  const summary = result?.summary
  if (!summary) return null
  const fakeAnswers = summary.details.filter(hasFakeIp)
  const fakeRemote = summary.remoteIps.filter(isFakeIp)
  if (fakeAnswers.length === 0 && fakeRemote.length === 0) return null

  const explanation =
    target.kind === 'dns' || target.kind === 'dot'
      ? 'The resolver answered with a fake IP, so queries to it are intercepted by a local proxy before they leave this machine.'
      : target.kind === 'http'
        ? 'This name resolved to a fake IP. A local proxy answers DNS and terminates TCP, so DNS and TCP times describe that proxy; TLS and TTFB still include the real path.'
        : 'This name resolved to a fake IP, so the probe reached a local proxy rather than the remote host.'

  return (
    <InfoHint label='Fake-IP address'>
      <span className='grid max-w-72 gap-1'>
        <span className='font-medium text-foreground'>Fake IP (198.18.0.0/15)</span>
        <span className='font-mono text-[11.5px]'>
          {[...fakeRemote, ...fakeAnswers].join(', ')}
        </span>
        <span className='text-muted'>{explanation}</span>
      </span>
    </InfoHint>
  )
}

/** The most common failure, or for healthy probes the detail they reported (mapped address, answer). */
const DetailCell = ({ result }: { result: TargetResult | undefined }) => {
  const error = topErrorOf(result)
  if (!error) {
    const detail = result?.summary?.details[0]
    if (!detail) return <span className='text-faint'>—</span>
    return (
      <span className='block max-w-56 truncate font-mono text-[11.5px] text-muted'>{detail}</span>
    )
  }
  return (
    <span className='text-secondary'>
      {describeError(error.kind, error.phase)}
      {error.count > 1 && <span className='text-faint'> ×{error.count}</span>}
    </span>
  )
}

const num = 'text-right font-mono text-[12px] tabular-nums text-secondary'

const RateCell = ({ download }: { download: DownloadResult | undefined }) => {
  if (!download) return <span className='text-faint'>—</span>
  if (!download.throughput) {
    return (
      <span className='text-faint'>
        {download.errorKind ? describeError(download.errorKind, null) : '—'}
      </span>
    )
  }
  return formatRate(download.throughput.bytesPerSecond).mbps
}

const rateDetail = (download: DownloadResult | undefined) => {
  if (!download?.throughput) return null
  const { bytes, bytesPerSecond, transferSeconds } = download.throughput
  return `${formatRate(bytesPerSecond).mbs} · ${formatBytes(bytes)} in ${transferSeconds}s`
}

/** The address the site saw, with the country Cloudflare placed it in. */
const ExitCell = ({ exit }: { exit: ExitObservation | null | undefined }) =>
  exit ? (
    <span className='flex min-w-0 items-baseline gap-1.5'>
      <span className='max-w-40 truncate font-mono text-[11.5px] text-secondary'>{exit.ip}</span>
      {exit.loc && <span className='text-[11px] text-faint'>{exit.loc}</span>}
    </span>
  ) : (
    <span className='text-faint'>—</span>
  )

const exitDetail = (exit: ExitObservation | null | undefined) =>
  exit ? (
    <div className='grid gap-0.5'>
      <span>
        {exit.host} saw this request from <span className='font-mono'>{exit.ip}</span>
      </span>
      <span className='text-muted'>
        Cloudflare {exit.colo ?? 'data centre unknown'}
        {exit.loc && `, address located in ${exit.loc}`}
      </span>
    </div>
  ) : null

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
        {target.kind !== 'http' && <KindTag kind={target.kind} />}
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
    id: 'detail',
    header: 'Detail',
    cell: ({ entry }) => <DetailCell result={entry?.result} />,
    tooltip: ({ entry }) => {
      const sample = topErrorOf(entry?.result)?.sample
      if (sample) return <span className='font-mono text-[11.5px]'>{sample}</span>
      const details = entry?.result.summary?.details ?? []
      if (details.length === 0) return null
      return (
        <div className='grid gap-0.5'>
          {details.map((d) => (
            <span className='font-mono text-[11.5px]' key={d}>
              {d}
            </span>
          ))}
        </div>
      )
    },
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
        tooltip: ({ entry }) =>
          rateDetail(entry?.result.downloads.find((d) => d.mode === 'single')),
      },
      {
        id: 'multi',
        header: 'Parallel',
        className: num,
        cell: ({ entry }) => (
          <RateCell download={entry?.result.downloads.find((d) => d.mode === 'multi')} />
        ),
        tooltip: ({ entry }) => rateDetail(entry?.result.downloads.find((d) => d.mode === 'multi')),
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
      cell: ({ target, entry }) =>
        phase === 'dns' ? (
          // The hint sits left of the number so right-aligned values still line up.
          <span className='flex items-center justify-end gap-1.5'>
            <FakeIpHint result={entry?.result} target={target} />
            {formatMs(entry?.result.summary?.median.dns)}
          </span>
        ) : (
          formatMs(entry?.result.summary?.median[phase])
        ),
    })),
    {
      id: 'total',
      header: 'Total',
      className: `${num} text-foreground`,
      cell: ({ entry }) => formatMs(entry?.result.summary?.median.total),
    },
    {
      id: 'jitter',
      header: 'Jitter',
      className: num,
      cell: ({ entry }) => formatMs(entry?.result.summary?.jitter),
    },
    {
      id: 'waterfall',
      header: 'Phases',
      tooltip: ({ entry }) => {
        const s = entry?.result.summary
        return s && hasTiming(s.median.total, scale) ? (
          <WaterfallDetail phases={s.median} total={s.median.total} />
        ) : null
      },
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
    {
      id: 'exit',
      header: 'Exit IP',
      cell: ({ entry }) => <ExitCell exit={entry?.result.exit} />,
      tooltip: ({ entry }) => exitDetail(entry?.result.exit),
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
  /** When provided, each group header gets a button that runs just that service. */
  runService?: { run: (serviceId: string) => void; disabled: boolean }
}

/** Every service as a group header followed by a dense table of its targets. */
export const ServiceResults = ({
  services,
  mode,
  results,
  selection,
  runService,
}: ServiceResultsProps) => {
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
          ) : (
            <span className='ml-auto' />
          )}
          {runService && (
            <button
              className='snap -my-1 -mr-1.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-normal text-muted hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
              disabled={runService.disabled}
              onClick={() => runService.run(service.id)}
              type='button'
            >
              <svg aria-hidden='true' className='size-2.5 fill-current' viewBox='0 0 12 12'>
                <path d='M3 2.2v7.6a.5.5 0 0 0 .76.43l6.2-3.8a.5.5 0 0 0 0-.86l-6.2-3.8A.5.5 0 0 0 3 2.2Z' />
              </svg>
              Run
            </button>
          )}
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

const checkDescription = (target: TargetInfo) => {
  switch (target.kind) {
    case 'icmp':
      return 'ICMP echo through the system ping'
    case 'tcp':
      return 'TCP connect, no data sent'
    case 'dns':
      return 'One DNS query over UDP; the answer is shown as the detail'
    case 'dot':
      return 'DNS query over TLS (port 853)'
    case 'tls':
      return 'TLS handshake by Node’s OpenSSL; the detail shows the protocol and key exchange group'
    case 'stun':
      return 'STUN binding request; reports the public address UDP leaves from'
    case 'quic':
      return 'QUIC version negotiation: proves UDP reachability of a QUIC endpoint, without a handshake'
    case 'http':
      return target.check === 'reachability'
        ? `Reachability — HTTP ${target.expectStatus.join('/')} proves the path, not the service`
        : `Expects HTTP ${target.expectStatus.join('/')}`
  }
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

/**
 * Every attempt column, with the value it shows. Columns that are empty for every attempt (no
 * detail, no HTTP status for a socket probe, …) are dropped so the table fits the dialog.
 */
const AttemptsTable = ({ attempts, label }: { attempts: readonly Attempt[]; label: string }) => {
  const present = (value: (a: Attempt) => unknown) => attempts.some((a) => value(a) != null)
  const optional: Record<string, (a: Attempt) => unknown> = {
    status: (a) => a.httpStatus,
    detail: (a) => a.detail,
    ip: (a) => a.remoteIp,
    dns: (a) => a.phases.dns,
    tcp: (a) => a.phases.tcp,
    tls: (a) => a.phases.tls,
    ttfb: (a) => a.phases.ttfb,
  }
  const columns: DataTableColumn<Attempt>[] = (
    [
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
        id: 'detail',
        header: 'Detail',
        className: 'font-mono text-[11.5px] text-muted',
        cell: (a) => a.detail ?? '—',
      },
      {
        id: 'ip',
        header: 'Remote',
        className: 'font-mono text-[11.5px] text-muted',
        cell: (a) => (
          <span className='block max-w-48 truncate' title={a.remoteIp ?? undefined}>
            {a.remoteIp ?? '—'}
          </span>
        ),
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
    ] satisfies DataTableColumn<Attempt>[]
  ).filter((column) => {
    const value = optional[column.id]
    return value === undefined || present(value)
  })
  return (
    <div className='-mx-5 border-y border-line'>
      <DataTable
        columns={columns}
        empty={<p className='px-5 py-3 text-[12.5px] text-muted'>No attempts yet.</p>}
        getRowId={(a) => String(a.seq)}
        label={label}
        rows={attempts}
      />
    </div>
  )
}

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
          <Row label='Check'>{checkDescription(target)}</Row>
          {entry?.at && <Row label='Measured'>{formatDateTime(entry.at)}</Row>}
          {result?.summary && result.summary.remoteIps.length > 0 && (
            <Row label='Remote IPs'>
              <span className='font-mono text-[11.5px]'>{result.summary.remoteIps.join(', ')}</span>
              {result.summary.remoteIps.some(isFakeIp) && (
                <span className='block text-[11.5px] text-muted'>
                  Fake-IP range: answered by a local proxy
                </span>
              )}
            </Row>
          )}
          {result?.summary && result.summary.attempts > 0 && (
            <Row label='Loss / jitter'>
              <span className='font-mono text-[12px]'>
                {Math.round((result.summary.failed / result.summary.attempts) * 100)}% /{' '}
                {formatMs(result.summary.jitter)}
              </span>
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
