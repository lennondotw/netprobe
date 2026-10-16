import type { ReactNode } from 'react'

const toneDot = {
  accent: 'bg-accent',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  error: 'bg-danger',
  neutral: 'bg-neutral',
} as const

export type Tone = keyof typeof toneDot

export const StatusDot = ({ tone }: { tone: Tone }) => (
  <span aria-hidden='true' className={`size-1.5 shrink-0 rounded-full ${toneDot[tone]}`} />
)

/**
 * Linear-style status pill: neutral chrome with a coloured dot carrying the
 * tone, so a dense column of statuses stays calm and scannable. The label is a
 * direct text child of the pill so `getByText` resolves to the pill itself.
 */
export const Badge = ({ children, tone }: { children: ReactNode; tone: Tone }) => (
  <span className='inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[11.5px] leading-none font-medium whitespace-nowrap text-secondary'>
    <StatusDot tone={tone} />
    {children}
  </span>
)
