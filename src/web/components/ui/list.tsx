import type { ReactNode } from 'react'

import { gutter } from './layout.ts'

interface GroupHeaderProps {
  children: ReactNode
  count?: ReactNode
  trailing?: ReactNode
}

/** Header for a block of list rows, like Linear's status groups. */
export const GroupHeader = ({ children, count, trailing }: GroupHeaderProps) => (
  <div
    className={`flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface-subtle py-1.5 ${gutter}`}
  >
    <div className='flex min-w-0 items-center gap-2 text-[12.5px] font-medium'>{children}</div>
    {count !== undefined && <span className='text-[12px] text-faint tabular-nums'>{count}</span>}
    {trailing && <div className='ml-auto flex items-center gap-2'>{trailing}</div>}
  </div>
)

/** A key/value property row, the list equivalent of a `<dt>`/`<dd>` pair. */
export const Row = ({ children, label }: { children: ReactNode; label: string }) => (
  <div className='snap -mx-2 flex min-h-8 items-center justify-between gap-4 rounded-md px-2 py-1 hover:bg-hover'>
    <dt className='shrink-0 font-sans text-[12.5px] text-muted'>{label}</dt>
    <dd className='min-w-0 text-right text-[12.5px] text-secondary'>{children}</dd>
  </div>
)

/** Small label used above property lists. */
export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className='text-[11.5px] font-medium text-muted'>{children}</p>
)
