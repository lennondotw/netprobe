import type { ReactNode } from 'react'

import { gutter } from './layout.ts'

interface EmptyStateProps {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}

/**
 * Stands in for a list that has no rows yet. It reads as part of the list (row background and
 * divider) and reserves about five rows of height, so the section does not collapse into what
 * looks like a footer and does not jump much when results arrive.
 */
export const EmptyState = ({ title, children, action }: EmptyStateProps) => (
  <div
    className={`flex min-h-40 flex-col items-center justify-center gap-1.5 border-b border-line-subtle bg-surface-subtle py-6 text-center ${gutter}`}
  >
    <p className='text-[12.5px] font-medium text-secondary'>{title}</p>
    {children && <p className='max-w-md text-[12px] leading-5 text-muted'>{children}</p>}
    {action && <div className='mt-2'>{action}</div>}
  </div>
)
