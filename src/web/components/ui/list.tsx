import type { ReactNode } from 'react'

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
