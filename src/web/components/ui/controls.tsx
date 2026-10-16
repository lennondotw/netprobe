const buttonBase =
  'snap inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50'

export const buttonClass = {
  primary: `${buttonBase} bg-accent text-on-accent shadow-raised hover:bg-accent-hover`,
  secondary: `${buttonBase} border border-line bg-surface text-secondary shadow-raised hover:border-line-strong hover:bg-hover hover:text-foreground`,
  disabled: `${buttonBase} cursor-not-allowed border border-dashed border-line-strong text-faint`,
} as const

/** Inline text link inside dense rows. */
export const linkClass =
  'snap rounded-sm text-accent-text hover:text-accent-text-hover hover:underline hover:underline-offset-2'

/** Quiet link that only picks up colour on hover. */
export const quietLinkClass = 'snap rounded-sm text-muted hover:text-foreground'

export const segmentedGroupClass =
  'inline-flex h-7 w-fit shrink-0 items-center rounded-md border border-line bg-surface-subtle p-0.5'

export const segmentClass = (selected: boolean) =>
  `snap inline-flex h-full min-w-16 items-center justify-center rounded-[5px] px-2.5 text-[12px] font-medium ${
    selected
      ? 'bg-surface text-foreground shadow-raised'
      : 'text-muted hover:bg-hover hover:text-foreground'
  }`

export const tabClass = (selected: boolean) =>
  `snap inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium whitespace-nowrap ${
    selected
      ? 'border-line bg-surface text-foreground shadow-raised'
      : 'border-transparent text-muted hover:bg-hover hover:text-foreground'
  }`

/** Disclosure chevron; rotates when an ancestor `details.group` opens. */
export const Chevron = () => (
  <svg
    aria-hidden='true'
    className='size-3 shrink-0 fill-none stroke-current stroke-[1.5] text-faint transition-transform duration-100 group-open:rotate-90'
    strokeLinecap='round'
    strokeLinejoin='round'
    viewBox='0 0 12 12'
  >
    <path d='m4.5 2.5 3.5 3.5-3.5 3.5' />
  </svg>
)
