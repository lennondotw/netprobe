import type { ReactNode } from 'react'

import { gutter } from './layout.ts'

interface PageHeaderProps {
  actions?: ReactNode
  title: ReactNode
}

/** The sticky 48px title bar at the top of every page. */
export const PageHeader = ({ actions, title }: PageHeaderProps) => (
  <header
    className={`sticky top-0 z-20 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-canvas/85 py-2 backdrop-blur-md ${gutter}`}
  >
    <div className='flex min-w-0 items-center gap-2'>
      <h1 className='truncate text-[14px] font-semibold tracking-[-0.01em]'>{title}</h1>
    </div>
    {actions && <div className='ml-auto flex items-center gap-2'>{actions}</div>}
  </header>
)

/** A 40px secondary bar for view tabs on the left and metadata on the right. */
export const Toolbar = ({ children }: { children: ReactNode }) => (
  <div
    className={`flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line py-1.5 ${gutter}`}
  >
    {children}
  </div>
)

/** Dot-separated metadata (repository, check time, source health). */
export const MetaList = ({ children }: { children: ReactNode }) => (
  <div className='flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted [&>*+*]:before:mr-2.5 [&>*+*]:before:text-faint [&>*+*]:before:content-["·"]'>
    {children}
  </div>
)
