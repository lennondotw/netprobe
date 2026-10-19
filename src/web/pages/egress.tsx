import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import type { AppConfig, IdentityReport, IpObservation } from '../../shared/types.ts'
import { Badge, StatusDot } from '../components/ui/badge.tsx'
import { Callout } from '../components/ui/callout.tsx'
import { buttonClass } from '../components/ui/controls.tsx'
import { DataTable } from '../components/ui/data-table.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Select } from '../components/ui/inputs.tsx'
import { gutter } from '../components/ui/layout.ts'
import { Row, SectionLabel } from '../components/ui/list.tsx'
import { Masonry } from '../components/ui/masonry.tsx'
import { MetaList, PageHeader, Toolbar } from '../components/ui/page-header.tsx'
import { ListSkeleton } from '../components/ui/skeleton.tsx'
import { InfoHint } from '../components/ui/tooltip.tsx'
import { ApiError, useConfig } from '../lib/api.ts'
import { type BrowserCheck, runBrowserCheck, webrtcLeaks } from '../lib/browser-check.ts'
import { formatMs, formatRelative } from '../lib/format.ts'
import {
  countryOf,
  type ExitNetwork,
  exitNetworks,
  flagLabels,
  locationOf,
  networkName,
  type ResolverNetwork,
  resolverNetworks,
  typeLabel,
} from '../lib/identity.ts'

const mono = 'font-mono text-[12px]'

const getIdentity = async (egressId: string) => {
  const response = await fetch(`/api/identity?egressId=${encodeURIComponent(egressId)}`)
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`)
  return (await response.json()) as IdentityReport | null
}

const postIdentity = async (egressId: string) => {
  const response = await fetch('/api/identity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ egressId }),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new ApiError(
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `HTTP ${response.status}`,
    )
  }
  return body as IdentityReport
}

const Panel = ({
  title,
  hint,
  children,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
}) => (
  <section className='grid content-start gap-1.5'>
    <span className='flex items-center gap-1.5'>
      <SectionLabel>{title}</SectionLabel>
      {hint}
    </span>
    <dl className='grid'>{children}</dl>
  </section>
)

const Sources = ({ names }: { names: string[] }) => (
  <span className='text-muted'>{[...new Set(names)].join(', ')}</span>
)

const riskTone = (risk: number) => (risk >= 67 ? 'error' : risk >= 34 ? 'warning' : 'success')

export const EgressPage = () => {
  const config = useConfig()
  if (!config.data) {
    return (
      <>
        <PageHeader title='Egress' />
        <ListSkeleton groups={2} rows={5} />
      </>
    )
  }
  return <Egress config={config.data} />
}

const Egress = ({ config }: { config: AppConfig }) => {
  const queryClient = useQueryClient()
  const [egressId, setEgressId] = useState(config.defaults.egressId)
  const stored = useQuery({
    queryKey: ['identity', egressId],
    queryFn: () => getIdentity(egressId),
  })
  const check = useMutation({
    mutationFn: postIdentity,
    onSuccess: (report) => queryClient.setQueryData(['identity', report.egress.id], report),
  })
  const browser = useMutation({ mutationFn: runBrowserCheck })
  const report = stored.data ?? null

  return (
    <>
      <PageHeader
        actions={
          <>
            <Select
              disabled={check.isPending}
              label='Egress'
              onChange={setEgressId}
              options={config.egress.map((e) => ({
                value: e.id,
                label: e.name,
                detail: e.detail,
              }))}
              value={egressId}
            />
            <button
              className={buttonClass.primary}
              disabled={check.isPending}
              onClick={() => check.mutate(egressId)}
              type='button'
            >
              {check.isPending ? 'Checking…' : report ? 'Check again' : 'Check'}
            </button>
          </>
        }
        title='Egress'
      />
      <Toolbar>
        <MetaList>
          <span>
            Public address, network, reputation, and DNS resolvers as outside services see this host
          </span>
          {report && <span>Collected {formatRelative(report.collectedAt)}</span>}
          {report && <span>{(report.durationMs / 1000).toFixed(1)} s</span>}
        </MetaList>
      </Toolbar>

      {check.error && (
        <Callout role='alert' title='The check failed' tone='danger'>
          {check.error.message}
        </Callout>
      )}

      {stored.isPending && <ListSkeleton groups={1} rows={4} />}
      {!stored.isPending && !report && !check.isPending && (
        <EmptyState title='No check yet'>
          Asks about 16 independent services where this host’s traffic appears to come from, looks
          up the reputation of each address they report, and identifies the DNS resolvers in use.
          Each check sends a few small requests to those services.
        </EmptyState>
      )}
      {check.isPending && !report && <ListSkeleton groups={2} rows={5} />}
      {report && <Report report={report} />}

      {config.modules.browserCheck && (
        <BrowserSection
          onRun={() => browser.mutate()}
          pending={browser.isPending}
          result={browser.data ?? null}
        />
      )}
    </>
  )
}

/** A section's title bar, the same height as the toolbar, above a full-width table. */
const SectionBar = ({
  title,
  hint,
  meta,
  top = true,
}: {
  title: string
  hint?: ReactNode
  meta?: ReactNode
  /** False directly under the toolbar, whose bottom border already separates them. */
  top?: boolean
}) => (
  <div
    className={`flex h-10 items-center gap-2 border-b border-line text-[12.5px] font-medium ${top ? 'border-t' : ''} ${gutter}`}
  >
    <span>{title}</span>
    {hint}
    {meta && <span className='font-normal text-muted'>{meta}</span>}
  </div>
)

/** The first address in full, the rest as a count; the hover lists every one. */
const Addresses = ({ ips }: { ips: readonly string[] }) => (
  <span className='flex items-baseline gap-1.5'>
    <span className={`${mono} text-secondary`}>{ips[0] ?? '—'}</span>
    {ips.length > 1 && <span className='text-[12px] text-faint'>+{ips.length - 1}</span>}
  </span>
)

const addressList = (ips: readonly string[]) =>
  ips.length > 1 ? (
    <span className='grid gap-0.5'>
      {ips.map((ip) => (
        <span className='font-mono text-[11.5px]' key={ip}>
          {ip}
        </span>
      ))}
    </span>
  ) : null

const networkMeta = (asn: number | null, location: string | null | undefined) =>
  [asn ? `AS${asn}` : null, location].filter(Boolean).join(' · ')

const resolverSummary = (groups: readonly ResolverNetwork[]) => {
  const addresses = groups.reduce((sum, g) => sum + g.resolvers.length, 0)
  return `${addresses} address${addresses === 1 ? '' : 'es'} in ${groups.length} network${groups.length === 1 ? '' : 's'}`
}

const Report = ({ report }: { report: IdentityReport }) => {
  const networks = exitNetworks(report)
  const resolvers = resolverNetworks(report.dns.resolvers)
  const failed = report.observations.filter((o) => !o.ok)
  const exitCountries = new Set(networks.flatMap((n) => n.locations.map(countryOf)))
  const resolverCountries = new Set(
    report.dns.resolvers.map((r) => r.countryCode).filter((c): c is string => !!c),
  )
  const dnsElsewhere = [...resolverCountries].some((c) => !exitCountries.has(c))
  const answered = report.observations.filter((o) => !o.lookup && o.ok).length
  const asked = report.observations.filter((o) => !o.lookup).length

  return (
    <>
      <SectionBar
        hint={
          networks.length > 1 ? (
            <InfoHint label='Several exit networks'>
              <span className='grid max-w-72 gap-1'>
                <span className='font-medium text-foreground'>
                  Traffic leaves through {networks.length} networks
                </span>
                <span className='text-muted'>
                  Services disagree about where this host’s traffic comes from. A rule-based proxy
                  or policy routing sends different destinations out through different exits.
                </span>
              </span>
            </InfoHint>
          ) : undefined
        }
        meta={`${answered}/${asked} sources answered`}
        title='Exit networks'
        top={false}
      />
      <DataTable
        columns={[
          {
            id: 'network',
            header: 'Network',
            cell: (n) => (
              <span className='flex items-baseline gap-2'>
                <span className='font-medium text-foreground'>{networkName(n)}</span>
                <span className='text-[12px] text-faint'>{networkMeta(n.asn, n.locations[0])}</span>
              </span>
            ),
          },
          {
            id: 'addresses',
            header: 'Addresses',
            cell: (n) => <Addresses ips={n.addresses.map((a) => a.ip)} />,
            tooltip: (n) => addressList(n.addresses.map((a) => a.ip)),
          },
          {
            id: 'seen',
            header: 'Seen by',
            className: 'text-right text-secondary',
            cell: (n) => `${n.seenBy.length}/${asked}`,
            tooltip: (n) => <Sources names={n.seenBy.map((o) => o.source)} />,
          },
          {
            id: 'type',
            header: 'Type',
            className: 'text-secondary',
            cell: (n) =>
              n.types.length === 0 ? (
                <span className='text-faint'>—</span>
              ) : (
                n.types.map((t) => typeLabel(t.type)).join(', ')
              ),
            tooltip: (n) =>
              n.types.length === 0 ? null : (
                <span className='grid gap-0.5'>
                  {n.types.map((t) => (
                    <span key={t.type}>
                      {typeLabel(t.type)}: <Sources names={t.sources} />
                    </span>
                  ))}
                </span>
              ),
          },
          {
            id: 'flags',
            header: 'Flags',
            className: 'w-full text-secondary',
            cell: (n) =>
              n.flags.length === 0 ? (
                <span className='text-faint'>—</span>
              ) : (
                n.flags.map((f) => flagLabels[f.flag]).join(', ')
              ),
            tooltip: (n) =>
              n.flags.length === 0 ? null : (
                <span className='grid gap-0.5'>
                  {n.flags.map((f) => (
                    <span key={f.flag}>
                      {flagLabels[f.flag]}: <Sources names={f.sources} />
                    </span>
                  ))}
                </span>
              ),
          },
          {
            id: 'risk',
            header: 'Risk',
            className: 'text-right font-mono text-[12px]',
            cell: (n) => {
              if (n.risks.length === 0) return <span className='text-faint'>—</span>
              const risk = Math.max(...n.risks.map((r) => r.risk))
              return (
                <span className='inline-flex items-center gap-1.5'>
                  <StatusDot tone={riskTone(risk)} />
                  {risk}
                </span>
              )
            },
            tooltip: (n) =>
              n.risks.length === 0 ? null : (
                <span className='grid gap-0.5'>
                  {n.risks.map((r) => (
                    <span key={r.source}>
                      {r.source}: {r.risk}
                    </span>
                  ))}
                </span>
              ),
          },
        ]}
        empty={<span className='text-muted'>No source reported an address</span>}
        getRowId={(n) => n.key}
        label='Exit networks'
        rows={networks}
      />

      <SectionBar
        hint={
          dnsElsewhere ? (
            <InfoHint label='DNS resolves elsewhere'>
              <span className='grid max-w-72 gap-1'>
                <span className='font-medium text-foreground'>
                  DNS leaves from {[...resolverCountries].join(', ')}
                </span>
                <span className='text-muted'>
                  Traffic exits in {[...exitCountries].join(', ') || 'another country'}, but names
                  are resolved by servers elsewhere. Sites that log resolvers can see that location
                  (a DNS leak).
                </span>
              </span>
            </InfoHint>
          ) : undefined
        }
        meta={resolverSummary(resolvers)}
        title='DNS resolvers'
      />
      <DataTable
        columns={[
          {
            id: 'network',
            header: 'Network',
            cell: (g) => (
              <span className='flex items-baseline gap-2'>
                <span className='font-medium text-foreground'>
                  {g.organization ?? 'Unknown network'}
                </span>
                <span className='text-[12px] text-faint'>{networkMeta(g.asn, g.location)}</span>
              </span>
            ),
          },
          {
            id: 'count',
            header: 'Resolvers',
            className: 'text-right text-secondary',
            cell: (g) => g.resolvers.length,
          },
          {
            id: 'addresses',
            header: 'Addresses',
            cell: (g) => <Addresses ips={g.resolvers.map((r) => r.ip)} />,
            tooltip: (g) => addressList(g.resolvers.map((r) => r.ip)),
          },
          {
            id: 'methods',
            header: 'Found by',
            className: 'w-full text-secondary',
            cell: (g) =>
              g.methods.map((m) => (m.count > 1 ? `${m.method} ×${m.count}` : m.method)).join(', '),
          },
          {
            id: 'note',
            header: 'Note',
            className: 'text-muted',
            cell: (g) => g.notes.join('; ') || '—',
          },
        ]}
        empty={<span className='text-muted'>No resolver identified</span>}
        getRowId={(g) => g.key}
        label='DNS resolvers'
        rows={resolvers}
      />
      {report.dns.notes.length > 0 && (
        <div className={`grid gap-1 py-3 ${gutter}`}>
          {report.dns.notes.map((note) => (
            <p className='text-[12px] leading-5 text-muted select-text' key={note}>
              {note}
            </p>
          ))}
        </div>
      )}

      <SectionBar title='Sources' />
      <SourceTable failed={failed} networks={networks} />
    </>
  )
}

const familyLabel = { auto: 'Auto', ipv4: 'IPv4', ipv6: 'IPv6' } as const

const SourceTable = ({
  networks,
  failed,
}: {
  networks: ExitNetwork[]
  failed: IpObservation[]
}) => (
  <DataTable
    columns={[
      {
        id: 'source',
        header: 'Source',
        cell: (o) => (
          <span className='flex items-center gap-2'>
            <span className={o.lookup ? 'text-secondary' : 'font-medium text-foreground'}>
              {o.source}
            </span>
            {o.lookup && <span className='text-[11.5px] text-faint'>lookup</span>}
          </span>
        ),
      },
      {
        id: 'family',
        header: 'Requested',
        className: 'text-muted',
        cell: (o) => (o.lookup ? '—' : familyLabel[o.family]),
      },
      {
        id: 'address',
        header: 'Address',
        className: `${mono} text-secondary`,
        cell: (o) =>
          o.ip ? (
            <span className='flex items-center gap-1.5'>
              {o.ip}
              {!o.lookup &&
                o.family !== 'auto' &&
                o.family !== (o.ip.includes(':') ? 'ipv6' : 'ipv4') && (
                  <InfoHint label='Address family changed'>
                    <span className='grid max-w-72 gap-1'>
                      <span className='font-medium text-foreground'>
                        Requested {familyLabel[o.family]}, left as{' '}
                        {o.ip.includes(':') ? 'IPv6' : 'IPv4'}
                      </span>
                      <span className='text-muted'>
                        The request was pinned to one family, but the service saw the other:
                        something on the path, usually a proxy, translated it.
                      </span>
                    </span>
                  </InfoHint>
                )}
            </span>
          ) : (
            '—'
          ),
      },
      {
        id: 'network',
        header: 'Network',
        cell: (o) =>
          o.ok ? (
            <span>
              {o.asn ? <span className={`${mono} text-muted`}>AS{o.asn} </span> : null}
              {o.organization ?? o.isp ?? <span className='text-faint'>—</span>}
            </span>
          ) : (
            <span className='block max-w-96 truncate text-muted'>{o.error}</span>
          ),
        tooltip: (o) =>
          !o.ok && o.error ? <span className='font-mono text-[11.5px]'>{o.error}</span> : null,
      },
      {
        id: 'location',
        header: 'Location',
        className: 'text-secondary',
        cell: (o) => locationOf(o) ?? '—',
      },
      {
        id: 'type',
        header: 'Type',
        className: 'text-secondary',
        cell: (o) => (o.networkType ? typeLabel(o.networkType) : '—'),
      },
      {
        id: 'flags',
        header: 'Flags',
        cell: (o) => {
          const raised = (Object.keys(o.flags) as (keyof IpObservation['flags'])[]).filter(
            (f) => o.flags[f] === true,
          )
          const reported = Object.values(o.flags).some((v) => v !== null)
          if (raised.length === 0)
            return <span className='text-faint'>{reported ? 'None' : '—'}</span>
          return raised.map((f) => flagLabels[f]).join(', ')
        },
      },
      {
        id: 'risk',
        header: 'Risk',
        className: 'text-right font-mono text-[12px] tabular-nums',
        cell: (o) =>
          o.risk === null ? (
            <span className='text-faint'>—</span>
          ) : (
            <span className='inline-flex items-center gap-1.5'>
              <StatusDot tone={riskTone(o.risk)} />
              {o.risk}
            </span>
          ),
      },
      {
        id: 'latency',
        header: 'Latency',
        className: 'text-right font-mono text-[12px] tabular-nums text-secondary',
        cell: (o) => formatMs(o.latencyMs),
      },
    ]}
    empty={null}
    getRowId={(o) => `${o.sourceId}:${o.family}:${o.ip ?? ''}`}
    groups={[
      ...networks.map((network) => ({
        id: network.key,
        label: networkName(network),
        rows: [...network.seenBy, ...network.lookups],
        header: (
          <>
            <span>{networkName(network)}</span>
            <span className='truncate font-normal text-muted'>
              {network.asn ? `AS${network.asn}` : ''}
              {network.locations[0] ? ` · ${network.locations[0]}` : ''}
            </span>
            <span className='text-[12px] font-normal text-faint tabular-nums'>
              {network.seenBy.length}
            </span>
          </>
        ),
      })),
      ...(failed.length > 0
        ? [
            {
              id: 'failed',
              label: 'No answer',
              rows: failed,
              header: (
                <>
                  <span>No answer</span>
                  <span className='text-[12px] font-normal text-faint tabular-nums'>
                    {failed.length}
                  </span>
                </>
              ),
            },
          ]
        : []),
    ]}
    label='Sources'
  />
)

const candidateTypes = {
  host: 'Local',
  srflx: 'Public (STUN)',
  prflx: 'Public (peer)',
  relay: 'Relay',
} as const

const BrowserSection = ({
  result,
  pending,
  onRun,
}: {
  result: BrowserCheck | null
  pending: boolean
  onRun: () => void
}) => {
  const leaks = result ? webrtcLeaks(result) : []
  const exposedLocal =
    result?.webrtc.candidates.filter((c) => c.type === 'host' && !c.obfuscated) ?? []
  return (
    <>
      <div
        className={`flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t border-b border-line py-1.5 ${gutter}`}
      >
        <span className='text-[12.5px] font-medium'>This browser</span>
        <span className='text-[12px] text-muted'>
          WebRTC and HTTP checks from the device viewing this page — not the host
        </span>
        <button
          className={`${buttonClass.secondary} ml-auto`}
          disabled={pending}
          onClick={onRun}
          type='button'
        >
          {pending ? 'Checking…' : result ? 'Check again' : 'Check this browser'}
        </button>
      </div>
      {!result && (
        <EmptyState
          title={pending ? 'Checking this browser…' : 'This browser has not been checked'}
        >
          Shows the public address this device uses over HTTP and the addresses WebRTC exposes to
          any web page, which can differ when a VPN or proxy only covers part of its traffic. Runs
          in your browser and contacts ipify, ipinfo.io, and public STUN servers.
        </EmptyState>
      )}
      {result && (
        <>
          <div className={`py-5 ${gutter}`}>
            <Masonry
              items={[
                {
                  id: 'http',
                  weight: 1 + result.http.length,
                  node: (
                    <Panel title='Public address over HTTP'>
                      {result.http.map((h) => (
                        <Row key={h.source} label={h.source}>
                          {h.ip ? (
                            <span className={mono}>{h.ip}</span>
                          ) : (
                            <span className='text-faint'>No answer</span>
                          )}
                        </Row>
                      ))}
                    </Panel>
                  ),
                },
                {
                  id: 'webrtc',
                  weight: 3,
                  node: (
                    <Panel title='WebRTC'>
                      <Row label='Verdict'>
                        {!result.webrtc.supported ? (
                          <span className='text-muted'>Not available</span>
                        ) : leaks.length > 0 ? (
                          <Badge tone='warning'>
                            Reveals {leaks.length} other address{leaks.length > 1 ? 'es' : ''}
                          </Badge>
                        ) : (
                          <Badge tone='success'>No extra public address</Badge>
                        )}
                      </Row>
                      {result.webrtc.stun.length > 0 && (
                        <Row label='STUN servers'>
                          {result.webrtc.stun.filter((s) => s.answered).length} of{' '}
                          {result.webrtc.stun.length} answered
                        </Row>
                      )}
                      <Row label='Local addresses'>
                        {exposedLocal.length > 0 ? (
                          <span className={mono}>
                            {exposedLocal.map((c) => c.address).join(', ')}
                          </span>
                        ) : (
                          <span className='text-muted'>Hidden behind mDNS names</span>
                        )}
                      </Row>
                      {result.webrtc.error && (
                        <p className='pt-1 text-[12px] text-muted select-text'>
                          {result.webrtc.error}
                        </p>
                      )}
                    </Panel>
                  ),
                },
              ]}
            />
          </div>
          {result.webrtc.candidates.length > 0 && (
            <DataTable
              columns={[
                {
                  id: 'type',
                  header: 'Candidate',
                  cell: (c) => (
                    <span className='font-medium text-foreground'>
                      {candidateTypes[c.type] ?? c.type}
                    </span>
                  ),
                },
                {
                  id: 'address',
                  header: 'Address',
                  className: `${mono} text-secondary`,
                  cell: (c) =>
                    c.obfuscated ? (
                      <span className='text-muted'>{c.address} (mDNS)</span>
                    ) : (
                      c.address
                    ),
                },
                {
                  id: 'protocol',
                  header: 'Protocol',
                  className: 'uppercase text-muted',
                  cell: (c) => c.protocol,
                },
                {
                  id: 'servers',
                  header: 'Seen by',
                  className: 'text-muted',
                  cell: (c) =>
                    c.servers.length === 0
                      ? '—'
                      : c.servers.length <= 3
                        ? c.servers.join(', ')
                        : `${c.servers.slice(0, 3).join(', ')} +${c.servers.length - 3}`,
                  tooltip: (c) =>
                    c.servers.length > 3 ? <span>Seen by {c.servers.join(', ')}</span> : null,
                },
                {
                  id: 'note',
                  header: 'Note',
                  className: 'w-full text-muted',
                  cell: (c) =>
                    leaks.includes(c)
                      ? 'Not seen over HTTP: websites can learn this address through WebRTC'
                      : c.obfuscated
                        ? 'Local address hidden by the browser'
                        : '—',
                },
              ]}
              empty={null}
              getRowId={(c) => `${c.type}:${c.address}:${c.protocol}`}
              label='WebRTC candidates'
              rows={result.webrtc.candidates}
            />
          )}
        </>
      )}
    </>
  )
}
