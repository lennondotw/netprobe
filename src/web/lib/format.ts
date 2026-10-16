import type { ErrorKind, Phase, TargetInfo, TargetResult } from '../../shared/types.ts'
import type { Tone } from '../components/ui/badge.tsx'

export const formatMs = (value: number | null | undefined) => {
  if (value == null) return '—'
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} s`
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  if (value >= 100) return `${Math.round(value)} ms`
  return `${value.toFixed(1)} ms`
}

export const formatBytes = (bytes: number | null | undefined) => {
  if (bytes == null) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

/** Network speed in both units people use: Mbps for links, MB/s for files. */
export const formatRate = (bytesPerSecond: number) => ({
  mbps: `${((bytesPerSecond * 8) / 1e6).toFixed(1)} Mbps`,
  mbs: `${(bytesPerSecond / 1e6).toFixed(2)} MB/s`,
})

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })

export const formatRelative = (iso: string, now = Date.now()) => {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86_400), 'day')
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))

export const formatDuration = (start: string, end: string | null) => {
  if (!end) return '—'
  const seconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    : `${seconds.toFixed(1)} s`
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export const phaseLabel: Record<Phase, string> = {
  dns: 'DNS',
  tcp: 'TCP',
  tls: 'TLS',
  http: 'HTTP',
  transfer: 'Transfer',
}

export const errorLabel: Record<ErrorKind, string> = {
  dns_failure: 'DNS failure',
  connect_refused: 'Connection refused',
  timeout: 'Timeout',
  tls_error: 'TLS error',
  certificate: 'Certificate',
  reset: 'Connection reset',
  empty_reply: 'Empty reply',
  partial_transfer: 'Transfer interrupted',
  proxy: 'Proxy error',
  http_status: 'Unexpected status',
  size_mismatch: 'Size mismatch',
  range_unsupported: 'No range support',
  cancelled: 'Cancelled',
  other: 'Error',
}

export const describeError = (kind: ErrorKind, phase: Phase | null) => {
  // A timeout says little on its own; the phase is the useful part.
  if (kind === 'timeout' && phase) return `${phaseLabel[phase]} timeout`
  if (kind === 'reset' && phase) return `Reset during ${phaseLabel[phase]}`
  return errorLabel[kind]
}

export interface StatusView {
  label: string
  tone: Tone
}

/**
 * One status per row. A target that both succeeded and failed in the same run is reported as
 * intermittent rather than averaged into "mostly fine".
 */
export const statusOf = (target: TargetInfo, result: TargetResult | undefined): StatusView => {
  if (!result) return { label: 'Not run', tone: 'neutral' }
  if (result.status === 'pending') return { label: 'Queued', tone: 'neutral' }
  if (result.status === 'running' && !result.outcome) return { label: 'Running', tone: 'info' }
  if (result.status === 'cancelled' && !result.outcome)
    return { label: 'Cancelled', tone: 'neutral' }

  const summary = result.summary
  const ok = target.check === 'reachability' ? 'Reachable' : 'OK'
  if (target.download) {
    const single = result.downloads.find((d) => d.mode === 'single')
    if (single?.outcome === 'transferred' && result.outcome === 'transferred')
      return { label: 'Transferred', tone: 'success' }
    if (single?.outcome === 'transferred') return { label: 'Partial', tone: 'warning' }
  }
  switch (result.outcome) {
    case 'transferred':
    case 'expected':
      return { label: ok, tone: 'success' }
    case 'reachable':
      return { label: 'Unexpected', tone: 'warning' }
    case 'failed':
      if (summary && summary.failed < summary.attempts)
        return { label: 'Intermittent', tone: 'warning' }
      return { label: 'Failed', tone: 'error' }
    default:
      return { label: 'Running', tone: 'info' }
  }
}
