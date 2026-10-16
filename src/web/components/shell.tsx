import type { ReactNode } from 'react'

import { useConfig } from '../lib/api.ts'
import { Link, usePathname } from '../lib/router.tsx'
import { StatusDot } from './ui/badge.tsx'

const navItems = [
  {
    href: '/',
    label: 'Overview',
    icon: <path d='M2.5 13.5h11M4 11V7m4 4V3.5m4 7.5V6' />,
  },
  {
    href: '/egress',
    label: 'Egress',
    icon: (
      <>
        <circle cx='8' cy='8' r='5.75' />
        <path d='M2.25 8h11.5M8 2.25c1.6 1.7 2.4 3.6 2.4 5.75S9.6 12.05 8 13.75C6.4 12.05 5.6 10.15 5.6 8S6.4 3.95 8 2.25Z' />
      </>
    ),
  },
  {
    href: '/host',
    label: 'Host',
    icon: (
      <>
        <rect height='8.5' rx='1.5' width='12' x='2' y='2.5' />
        <path d='M5.5 13.5h5M8 11v2.5M4.5 5.5h2' />
      </>
    ),
  },
  {
    href: '/runs',
    label: 'History',
    icon: (
      <>
        <circle cx='8' cy='8' r='5.75' />
        <path d='M8 4.75V8l2 1.5' />
      </>
    ),
  },
] as const

const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

/** Where measurements come from. Shown on every page so container results are never mistaken for host results. */
const RuntimeFooter = () => {
  const { data } = useConfig()
  if (!data) return null
  const { runtime } = data
  return (
    <div className='hidden border-t border-line px-4 py-3 text-[11.5px] leading-5 text-muted lg:block'>
      <p className='truncate font-medium text-secondary' title={runtime.hostLabel}>
        {runtime.hostLabel}
      </p>
      <p className='flex items-center gap-1.5'>
        <StatusDot tone={runtime.environment === 'container' ? 'warning' : 'success'} />
        {runtime.environment === 'container'
          ? 'Measuring from a container'
          : 'Measuring from the host'}
      </p>
      <p className='truncate font-mono text-[10.5px] text-faint' title={runtime.curlVersion}>
        {runtime.curlVersion.split(' ').slice(0, 2).join(' ')}
      </p>
    </div>
  )
}

export const AppShell = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname()
  return (
    <div className='flex min-h-screen w-full flex-col lg:flex-row'>
      <div className='flex shrink-0 flex-col border-b border-line bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:border-r lg:border-b-0'>
        <div className='flex h-12 items-center gap-2.5 px-4'>
          <span
            aria-hidden='true'
            className='grid size-5 place-items-center rounded-[5px] bg-accent text-on-accent'
          >
            <svg
              className='size-3.5 fill-none stroke-current stroke-[1.6]'
              strokeLinecap='round'
              strokeLinejoin='round'
              viewBox='0 0 16 16'
            >
              <path d='M2 9.5h2.5l1.75-4.5 3.5 7 1.75-4.5H14' />
            </svg>
          </span>
          <p className='text-[13px] font-semibold'>Netprobe</p>
        </div>
        <nav aria-label='Pages' className='min-w-0 px-2 pb-1.5 lg:flex-1 lg:py-1'>
          <ul className='flex gap-0.5 lg:flex-col'>
            {navItems.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={`group snap flex h-8 items-center gap-2 rounded-md px-2 text-[13px] ${
                      active
                        ? 'bg-active font-medium text-foreground'
                        : 'text-secondary hover:bg-hover hover:text-foreground'
                    }`}
                    href={item.href}
                  >
                    <svg
                      aria-hidden='true'
                      className={`snap-group size-4 shrink-0 fill-none stroke-current stroke-[1.3] ${
                        active ? 'text-foreground' : 'text-muted group-hover:text-foreground'
                      }`}
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      viewBox='0 0 16 16'
                    >
                      {item.icon}
                    </svg>
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <RuntimeFooter />
      </div>
      <main className='flex min-w-0 flex-1 flex-col bg-canvas'>{children}</main>
    </div>
  )
}
