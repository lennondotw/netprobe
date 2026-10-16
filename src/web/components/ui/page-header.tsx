import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { gutter } from './layout.ts'

interface PageHeaderProps {
  actions?: ReactNode
  /**
   * Controls placed right after the title. Use this slot for a control whose own use changes the
   * other controls (e.g. a mode switch that hides a field): anchored on the left, it never moves
   * while it is being operated.
   */
  leading?: ReactNode
  title: ReactNode
}

/**
 * The sticky title bar at the top of every page. Its height (48px, more when its controls wrap)
 * is published as --page-header-height so sticky table headers can sit right below it.
 */
export const PageHeader = ({ actions, leading, title }: PageHeaderProps) => {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const header = ref.current
    if (!header) return
    const root = document.documentElement
    const observer = new ResizeObserver(() =>
      root.style.setProperty('--page-header-height', `${header.offsetHeight}px`),
    )
    observer.observe(header)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--page-header-height')
    }
  }, [])
  return (
    <header
      className={`sticky top-0 z-20 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-canvas/85 py-2 backdrop-blur-md ${gutter}`}
      ref={ref}
    >
      <div className='flex min-w-0 items-center gap-2'>
        <h1 className='truncate text-[14px] font-semibold tracking-[-0.01em]'>{title}</h1>
      </div>
      {leading && <div className='flex min-w-0 flex-wrap items-center gap-2'>{leading}</div>}
      {actions && (
        <div className='ml-auto flex min-w-0 flex-wrap items-center gap-2'>{actions}</div>
      )}
    </header>
  )
}

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
