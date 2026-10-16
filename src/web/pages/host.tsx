import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import type { HostInfo, HostInterface, MacNetworkInfo, MacResolver } from '../../shared/types.ts'
import { StatusDot } from '../components/ui/badge.tsx'
import { Callout } from '../components/ui/callout.tsx'
import { buttonClass } from '../components/ui/controls.tsx'
import { DataTable } from '../components/ui/data-table.tsx'
import { gutter } from '../components/ui/layout.ts'
import { Row, SectionLabel } from '../components/ui/list.tsx'
import { Masonry } from '../components/ui/masonry.tsx'
import { MetaList, PageHeader, Toolbar } from '../components/ui/page-header.tsx'
import { ListSkeleton } from '../components/ui/skeleton.tsx'
import { InfoHint } from '../components/ui/tooltip.tsx'
import { ApiError } from '../lib/api.ts'
import { formatBytes, formatRelative, isFakeIp } from '../lib/format.ts'
import { measuredFrom, measuresHostNetwork } from '../lib/runtime.ts'

const fetchHost = async (): Promise<HostInfo> => {
  const response = await fetch('/api/host')
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`)
  return (await response.json()) as HostInfo
}

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

const mono = 'font-mono text-[12px]'

/** A titled block of key/value rows; blocks flow into columns on wide screens. */
const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className='grid content-start gap-1.5'>
    <SectionLabel>{title}</SectionLabel>
    <dl className='grid'>{children}</dl>
  </section>
)

const Empty = ({ children }: { children: ReactNode }) => (
  <span className='text-faint'>{children}</span>
)

const List = ({ values }: { values: readonly string[] }) =>
  values.length === 0 ? (
    <Empty>None</Empty>
  ) : (
    <span className='grid justify-items-end gap-0.5'>
      {values.map((value) => (
        <span className={mono} key={value}>
          {value}
        </span>
      ))}
    </span>
  )

const FakeDnsHint = () => (
  <InfoHint label='Fake-IP DNS'>
    <span className='grid max-w-72 gap-1'>
      <span className='font-medium text-foreground'>Fake-IP DNS (198.18.0.0/15)</span>
      <span className='text-muted'>
        A local proxy answers DNS with placeholder addresses and maps them back to real hosts when
        connections arrive, so DNS and TCP timings on this machine describe that proxy.
      </span>
    </span>
  </InfoHint>
)

const scopeOrder = { public: 0, private: 1, special: 2, 'link-local': 3, loopback: 4 } as const

const interfaceGroup = (iface: HostInterface) => {
  if (iface.internal) return 'loopback'
  if (iface.tunnel) return 'tunnel'
  return iface.addresses.some((a) => a.scope !== 'link-local') ? 'active' : 'link-local'
}

const groupLabels = {
  active: 'Active',
  tunnel: 'Tunnels (VPN, TUN proxies)',
  'link-local': 'Link-local only',
  loopback: 'Loopback',
} as const

export const HostPage = () => {
  const host = useQuery({ queryKey: ['host'], queryFn: fetchHost, staleTime: 30_000 })
  const data = host.data

  const header = (
    <PageHeader
      actions={
        <button
          className={buttonClass.secondary}
          disabled={host.isFetching}
          onClick={() => void host.refetch()}
          type='button'
        >
          Refresh
        </button>
      }
      title='Host'
    />
  )

  if (host.error) {
    return (
      <>
        {header}
        <Callout role='alert' title='Could not read host information' tone='danger'>
          {host.error.message}
        </Callout>
      </>
    )
  }
  if (!data) {
    return (
      <>
        {header}
        <ListSkeleton groups={2} rows={6} />
      </>
    )
  }

  const { system, network, proxy, runtime } = data
  const tunnelNames = new Set(data.interfaces.filter((i) => i.tunnel).map((i) => i.name))
  const tunnelRoutes = network.gateways.filter((g) => g.interface && tunnelNames.has(g.interface))
  const fakeResolver = network.resolverCheck.addresses.some(isFakeIp)
  const groups = (['active', 'tunnel', 'link-local', 'loopback'] as const)
    .map((group) => ({
      id: group,
      label: groupLabels[group],
      header: (
        <>
          <span>{groupLabels[group]}</span>
          <span className='text-[12px] font-normal text-faint tabular-nums'>
            {data.interfaces.filter((i) => interfaceGroup(i) === group).length}
          </span>
        </>
      ),
      rows: data.interfaces.filter((i) => interfaceGroup(i) === group),
    }))
    .filter((group) => group.rows.length > 0)

  return (
    <>
      {header}
      <Toolbar>
        <MetaList>
          <span>{system.hostname}</span>
          <span>{measuredFrom(runtime)}</span>
          <span>Collected {formatRelative(data.collectedAt)}</span>
        </MetaList>
      </Toolbar>

      {runtime.environment === 'container' && !measuresHostNetwork(runtime) && (
        <Callout title='This is the container’s view' tone='warning'>
          Interfaces, routes, DNS, and proxy settings below belong to the container, not the machine
          it runs on. Use host networking, or run Netprobe on the host, to see the host’s network
          configuration.
        </Callout>
      )}
      {tunnelRoutes.length > 0 && (
        <Callout
          title={`Default route goes through a tunnel (${[...new Set(tunnelRoutes.map((r) => r.interface))].join(', ')})`}
          tone='warning'
        >
          A VPN or a proxy in TUN mode is carrying all traffic. Measurements describe the path
          through that tunnel.
        </Callout>
      )}

      <div className={`py-5 ${gutter}`}>
        <Masonry
          items={[
            {
              id: 'system',
              weight: 9,
              node: (
                <Panel title='System'>
                  <Row label='Hostname'>
                    <span className={mono}>{system.hostname}</span>
                  </Row>
                  <Row label='Model'>{system.model ?? <Empty>Unknown</Empty>}</Row>
                  <Row label='Operating system'>{system.os}</Row>
                  <Row label='Architecture'>{system.arch}</Row>
                  <Row label='CPU'>
                    {system.cpu} · {system.cpuCount} cores
                  </Row>
                  <Row label='Memory'>
                    {formatBytes(system.memoryBytes)} · {formatBytes(system.freeMemoryBytes)} free
                  </Row>
                  <Row label='Load (1/5/15 min)'>
                    <span className={mono}>{system.loadAverage.join(' / ')}</span>
                  </Row>
                  <Row label='Uptime'>{formatUptime(system.uptimeSeconds)}</Row>
                  <Row label='Time zone'>{system.timezone}</Row>
                </Panel>
              ),
            },
            {
              id: 'network',
              weight:
                4 +
                network.gateways.length +
                network.dnsServers.length +
                network.resolverCheck.addresses.length,
              node: (
                <Panel title='Network'>
                  {network.gateways.length === 0 ? (
                    <Row label='Default route'>
                      <Empty>Unknown</Empty>
                    </Row>
                  ) : (
                    network.gateways.map((route) => (
                      <Row key={route.family} label={`Default route (${route.family})`}>
                        <span className={mono}>
                          {route.gateway}
                          {route.interface && (
                            <span className='text-faint'> via {route.interface}</span>
                          )}
                        </span>
                      </Row>
                    ))
                  )}
                  <Row label='DNS servers'>
                    <span className='flex items-start justify-end gap-1.5'>
                      <List values={network.dnsServers} />
                      {network.dnsServers.some(isFakeIp) && <FakeDnsHint />}
                    </span>
                  </Row>
                  <Row label='Search domains'>
                    <List values={network.searchDomains} />
                  </Row>
                  <Row label={`Resolves ${network.resolverCheck.name}`}>
                    {network.resolverCheck.error ? (
                      <span className='text-danger'>{network.resolverCheck.error}</span>
                    ) : (
                      <span className='flex items-start justify-end gap-1.5'>
                        <List values={network.resolverCheck.addresses} />
                        {fakeResolver && <FakeDnsHint />}
                      </span>
                    )}
                  </Row>
                </Panel>
              ),
            },
            {
              id: 'proxy',
              weight: 3 + proxy.system.length + proxy.environment.length,
              node: (
                <Panel title='Proxy'>
                  {proxy.system.length === 0 && proxy.environment.length === 0 && (
                    <Row label='Configured proxies'>
                      <Empty>None</Empty>
                    </Row>
                  )}
                  {proxy.system.map((setting) => (
                    <Row key={setting.label} label={`System ${setting.label}`}>
                      <span className={`${mono} select-text`}>{setting.value}</span>
                    </Row>
                  ))}
                  {proxy.environment.map((setting) => (
                    <Row key={setting.label} label={setting.label}>
                      <span className={`${mono} select-text`}>{setting.value}</span>
                    </Row>
                  ))}
                  <p className='pt-1 text-[12px] leading-5 text-muted'>
                    Netprobe ignores these: each run uses the egress chosen on the Connectivity
                    page. A TUN-mode proxy shows up as a tunnel interface and default route instead.
                  </p>
                </Panel>
              ),
            },
            {
              id: 'runtime',
              weight: 8,
              node: (
                <Panel title='Runtime'>
                  <Row label='Measuring from'>{measuredFrom(runtime)}</Row>
                  <Row label='Kernel'>
                    <span className={`${mono} block max-w-80 truncate`} title={system.kernel}>
                      {system.kernel}
                    </span>
                  </Row>
                  <Row label='Node.js'>
                    <span className={mono}>{system.nodeVersion}</span>
                  </Row>
                  <Row label='curl'>
                    <span className={mono}>
                      {runtime.curlVersion.split(' ').slice(0, 2).join(' ')}
                    </span>
                  </Row>
                  <Row label='curl features'>
                    <span
                      className={`${mono} block max-w-80 text-right whitespace-normal text-muted select-text`}
                    >
                      {system.curlFeatures.join(' ') || '—'}
                    </span>
                  </Row>
                  {data.unavailable.length > 0 && (
                    <Row label='Not collected'>
                      <span className='text-muted'>{data.unavailable.join(', ')}</span>
                    </Row>
                  )}
                </Panel>
              ),
            },
            ...(data.macos
              ? [
                  {
                    id: 'macos',
                    weight: 5,
                    node: (
                      <Panel title='macOS'>
                        <Row label='Bonjour name'>
                          <span className={mono}>
                            {data.macos.localHostName ? `${data.macos.localHostName}.local` : '—'}
                          </span>
                        </Row>
                        <Row label='Computer name'>
                          {data.macos.computerName ?? <Empty>Unknown</Empty>}
                        </Row>
                        <Row label='Service order'>
                          <span className='block max-w-80 text-right whitespace-normal'>
                            {data.macos.serviceOrder.map((service, index) => (
                              <span
                                className={service.enabled ? undefined : 'text-faint'}
                                key={service.name}
                              >
                                {index > 0 && <span className='text-faint'> › </span>}
                                {service.name}
                              </span>
                            ))}
                          </span>
                        </Row>
                      </Panel>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>

      {data.macos && <MacSections mac={data.macos} />}

      <TableHeading>Interfaces</TableHeading>
      <DataTable
        columns={[
          {
            id: 'name',
            header: 'Interface',
            cell: (iface) => (
              <span className='flex items-center gap-2'>
                <span className={`${mono} font-medium text-foreground`}>{iface.name}</span>
                {iface.role && (
                  <span className='inline-flex h-4 items-center rounded-[4px] border border-line px-1 text-[10.5px] leading-none text-muted'>
                    {iface.role}
                  </span>
                )}
              </span>
            ),
          },
          {
            id: 'addresses',
            header: 'Addresses',
            className: 'w-full',
            cell: (iface) =>
              iface.addresses.length === 0 ? (
                <Empty>—</Empty>
              ) : (
                <span className='flex flex-wrap gap-x-3 gap-y-0.5 py-0.5 whitespace-normal'>
                  {[...iface.addresses]
                    .sort(
                      (a, b) =>
                        scopeOrder[a.scope] - scopeOrder[b.scope] ||
                        a.family.localeCompare(b.family),
                    )
                    .map((a) => (
                      <span
                        className={`${mono} ${a.scope === 'link-local' || a.scope === 'loopback' ? 'text-faint' : 'text-secondary'}`}
                        key={a.cidr}
                      >
                        {a.cidr}
                      </span>
                    ))}
                </span>
              ),
          },
          {
            id: 'mac',
            header: 'MAC',
            className: `${mono} text-muted`,
            cell: (iface) => iface.mac ?? '—',
          },
          {
            id: 'mtu',
            header: 'MTU',
            className: `${mono} text-right text-secondary tabular-nums`,
            cell: (iface) => iface.mtu ?? '—',
          },
        ]}
        empty={null}
        getRowId={(iface) => iface.name}
        groups={groups}
        label='Network interfaces'
      />
    </>
  )
}

/** A heading bar above a full-width table. */
const TableHeading = ({ children }: { children: ReactNode }) => (
  <div
    className={`flex h-10 items-center border-t border-b border-line text-[12.5px] font-medium ${gutter}`}
  >
    {children}
  </div>
)

const resolverGroups: { kind: MacResolver['kind']; label: string }[] = [
  { kind: 'default', label: 'Default resolvers' },
  { kind: 'domain', label: 'Per-domain resolvers' },
  { kind: 'scoped', label: 'Scoped to an interface' },
]

/** macOS routes lookups through mDNSResponder, which can hold many resolvers at once. */
const MacSections = ({ mac }: { mac: MacNetworkInfo }) => {
  const extensions = [
    ...mac.systemExtensions.map((ext) => ({
      id: `ext:${ext.bundleId}`,
      group: 'extensions' as const,
      name: ext.name,
      identifier: ext.bundleId,
      kind: `${ext.category} extension · ${ext.version}`,
      state: ext.state,
      healthy: ext.enabled && /activated/.test(ext.state),
    })),
    ...mac.vpnServices.map((vpn) => ({
      id: `vpn:${vpn.name}:${vpn.provider ?? ''}`,
      group: 'vpn' as const,
      name: vpn.name,
      identifier: vpn.provider ?? '—',
      kind: vpn.type,
      state: vpn.enabled ? vpn.status : `${vpn.status} (disabled)`,
      healthy: vpn.status === 'Connected',
    })),
  ]

  return (
    <>
      <TableHeading>DNS resolvers (mDNSResponder)</TableHeading>
      <DataTable
        columns={[
          {
            id: 'domain',
            header: 'Domain',
            cell: (r) =>
              r.domain ? (
                <span className={`${mono} text-foreground`}>{r.domain}</span>
              ) : (
                <span className='text-muted'>All names</span>
              ),
          },
          {
            id: 'servers',
            header: 'Nameservers',
            className: 'w-full',
            cell: (r) =>
              r.mdns ? (
                <span className='text-muted'>Multicast DNS (Bonjour)</span>
              ) : r.nameservers.length ? (
                <span className={`${mono} text-secondary`}>{r.nameservers.join(', ')}</span>
              ) : (
                <Empty>—</Empty>
              ),
          },
          {
            id: 'interface',
            header: 'Interface',
            className: `${mono} text-muted`,
            cell: (r) => r.interface ?? '—',
          },
          {
            id: 'reach',
            header: 'Reachable',
            cell: (r) =>
              r.mdns || r.reachable === null ? (
                <Empty>—</Empty>
              ) : (
                <span className='flex items-center gap-1.5'>
                  <StatusDot tone={r.reachable ? 'success' : 'error'} />
                  {r.reachable ? 'Yes' : 'No'}
                </span>
              ),
          },
        ]}
        empty={null}
        getRowId={(r) =>
          `${r.kind}:${r.domain ?? ''}:${r.interface ?? ''}:${r.nameservers.join(',')}`
        }
        groups={resolverGroups
          .map(({ kind, label }) => {
            const rows = mac.resolvers.filter((r) => r.kind === kind)
            return {
              id: kind,
              label,
              rows,
              header: (
                <>
                  <span>{label}</span>
                  <span className='text-[12px] font-normal text-faint tabular-nums'>
                    {rows.length}
                  </span>
                </>
              ),
            }
          })
          .filter((group) => group.rows.length > 0)}
        label='DNS resolvers'
      />

      <TableHeading>Network extensions & VPN</TableHeading>
      <DataTable
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (row) => <span className='font-medium text-foreground'>{row.name}</span>,
          },
          {
            id: 'identifier',
            header: 'Identifier',
            className: `${mono} text-muted`,
            cell: (row) => row.identifier,
          },
          { id: 'kind', header: 'Type', className: 'text-secondary', cell: (row) => row.kind },
          {
            id: 'state',
            header: 'State',
            className: 'w-full',
            cell: (row) => (
              <span className='flex items-center gap-1.5'>
                <StatusDot tone={row.healthy ? 'success' : 'neutral'} />
                {row.state}
              </span>
            ),
          },
        ]}
        empty={
          <p className={`py-3 text-[12.5px] text-muted ${gutter}`}>
            No system extensions or VPN configurations.
          </p>
        }
        getRowId={(row) => row.id}
        groups={[
          { id: 'extensions', label: 'System extensions' },
          { id: 'vpn', label: 'VPN & Network Extension configurations' },
        ]
          .map((group) => {
            const rows = extensions.filter((row) => row.group === group.id)
            return {
              ...group,
              rows,
              header: (
                <>
                  <span>{group.label}</span>
                  <span className='text-[12px] font-normal text-faint tabular-nums'>
                    {rows.length}
                  </span>
                </>
              ),
            }
          })
          .filter((group) => group.rows.length > 0)}
        label='Network extensions and VPN configurations'
      />
    </>
  )
}
