import { Dialog } from '@base-ui/react/dialog'
import { type ReactNode, useRef, useState } from 'react'

interface DetailDialogProps {
  children: ReactNode
  /** Status shown next to the title. */
  meta?: ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  title: ReactNode
}

/**
 * Read-only detail modal. Opens snappily (fade + slight scale) and closes a touch faster, in
 * keeping with the instant-in, fast-out interaction rhythm.
 */
export const DetailDialog = ({ children, meta, onOpenChange, open, title }: DetailDialogProps) => {
  // Focus the popup itself rather than its first control, so opening from a row click does not
  // paint a focus ring on the close button; Tab still reaches every control in order.
  const popupRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop className='fixed inset-0 z-40 bg-black/25 transition-opacity duration-150 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:opacity-0 dark:bg-black/55' />
        <Dialog.Popup
          initialFocus={popupRef}
          ref={popupRef}
          className='fixed top-1/2 left-1/2 z-50 flex max-h-[min(85vh,52rem)] w-[min(calc(100vw-2rem),44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] outline-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0'
        >
          <header className='flex min-h-12 shrink-0 items-center gap-3 border-b border-line px-5'>
            <Dialog.Title className='min-w-0 truncate font-mono text-[13px] font-medium'>
              {title}
            </Dialog.Title>
            {meta}
            <Dialog.Close
              aria-label='Close'
              className='snap -mr-1.5 ml-auto grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-foreground'
            >
              <svg
                aria-hidden='true'
                className='size-3.5 fill-none stroke-current stroke-[1.5]'
                strokeLinecap='round'
                viewBox='0 0 14 14'
              >
                <path d='m3.5 3.5 7 7m0-7-7 7' />
              </svg>
            </Dialog.Close>
          </header>
          <div className='min-h-0 overflow-y-auto'>{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A bordered block inside a detail dialog; consecutive sections are separated by a rule. */
export const DetailSection = ({ children }: { children: ReactNode }) => (
  <section className='grid gap-2.5 border-t border-line px-5 py-3.5 first:border-t-0 last:pb-7'>
    {children}
  </section>
)

/**
 * Open state for a list whose rows open a detail dialog. It keeps the last opened item after the
 * dialog closes, so the exit animation still has content and the row stays highlighted like a
 * macOS list selection.
 */
export const useDetailDialog = <Item,>() => {
  const [item, setItem] = useState<Item | null>(null)
  const [open, setOpen] = useState(false)

  return {
    item,
    onOpenChange: setOpen,
    open,
    show: (next: Item) => {
      setItem(next)
      setOpen(true)
    },
  }
}
