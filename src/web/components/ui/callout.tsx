import type { ReactNode } from 'react'

import { StatusDot } from './badge.tsx'
import { gutter } from './layout.ts'

const calloutTone = {
  warning: 'bg-warning-soft',
  danger: 'bg-danger-soft',
} as const

interface CalloutProps {
  children?: ReactNode
  label?: string
  role?: 'alert'
  title: ReactNode
  tone: keyof typeof calloutTone
  trailing?: ReactNode
}

/** Full-bleed notice row. The dot and tinted background carry the severity. */
export const Callout = ({ children, label, role, title, tone, trailing }: CalloutProps) => (
  <aside
    aria-label={label}
    className={`flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line py-2.5 ${gutter} ${calloutTone[tone]}`}
    role={role}
  >
    <span className='mt-[5px]'>
      <StatusDot tone={tone === 'danger' ? 'error' : tone} />
    </span>
    <div className='min-w-0 flex-1'>
      <div className='text-[12.5px] font-medium text-foreground'>{title}</div>
      {children && (
        <div className='mt-0.5 text-[12px] leading-5 text-muted select-text'>{children}</div>
      )}
    </div>
    {trailing}
  </aside>
)
