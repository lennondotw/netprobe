import { Tooltip } from '@base-ui/react/tooltip'
import { type ReactElement, type ReactNode, useRef, useState } from 'react'

/**
 * One tooltip for the whole page. Every trigger is detached and passes its content as a payload,
 * so moving between triggers re-anchors the open popup instead of closing one and opening another.
 */
const handle = Tooltip.createHandle<ReactNode>()

/** Hover intent before the first tooltip appears. */
const openDelay = 300
/** After the pointer leaves every trigger, re-entering within this window opens instantly. */
const warmWindow = 500

/**
 * Hosts the shared tooltip. Timing: the first hover waits `openDelay` and fades in; moving between
 * triggers is instant; leaving closes immediately; coming back within `warmWindow` is instant
 * again, without the fade. The popup never takes the pointer, so it cannot cover or steal hover
 * from the rows underneath.
 */
export const TooltipHost = ({ children }: { children: ReactNode }) => {
  const closedAt = useRef(Number.NEGATIVE_INFINITY)
  // Base UI only marks delay-group opens as instant across different roots; with one shared root
  // the warm re-open has to be tracked here.
  const [warm, setWarm] = useState(false)

  return (
    <Tooltip.Provider closeDelay={0} delay={openDelay} timeout={warmWindow}>
      {children}
      <Tooltip.Root
        disableHoverablePopup
        handle={handle}
        onOpenChange={(open) => {
          if (open) setWarm(performance.now() - closedAt.current < warmWindow)
          else closedAt.current = performance.now()
        }}
      >
        {({ payload }) => (
          <Tooltip.Portal>
            <Tooltip.Positioner className='pointer-events-none z-50' sideOffset={6}>
              <Tooltip.Popup
                className={`pointer-events-none max-w-sm origin-[var(--transform-origin)] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] leading-5 text-secondary shadow-popup transition-[opacity,scale] duration-100 ease-[cubic-bezier(0.2,0,0,1)] data-[ending-style]:duration-0 data-[instant]:transition-none data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 ${
                  warm ? 'transition-none' : ''
                }`}
              >
                {payload}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

interface TooltipTriggerProps {
  content: ReactNode
  /** Override the open delay, e.g. shorter for an explicit info icon the user aims at. */
  delay?: number
  /**
   * The element that receives hover. Make it the full hit area (e.g. the table cell itself), so
   * neighbouring triggers touch and the pointer never crosses a gap between them.
   */
  render: ReactElement<Record<string, unknown>>
}

export const TooltipTrigger = ({ content, delay, render }: TooltipTriggerProps) => (
  <Tooltip.Trigger delay={delay} handle={handle} payload={content} render={render} />
)

/**
 * A small inline "i" that explains something about its row. It opens faster than cell tooltips
 * because pointing at it is deliberate. The hit area extends past the glyph without moving layout.
 */
export const InfoHint = ({ children, label }: { children: ReactNode; label: string }) => (
  <TooltipTrigger
    content={children}
    delay={100}
    render={
      <span
        aria-label={label}
        className='relative inline-flex size-3.5 shrink-0 items-center justify-center self-center rounded-full text-faint snap hover:text-secondary after:absolute after:-inset-1.5'
        role='img'
      >
        <svg aria-hidden='true' className='size-3.5' fill='none' viewBox='0 0 14 14'>
          <circle cx='7' cy='7' r='5.75' stroke='currentColor' strokeWidth='1.2' />
          <path d='M7 6.25v3.5' stroke='currentColor' strokeLinecap='round' strokeWidth='1.3' />
          <circle cx='7' cy='4.4' fill='currentColor' r='0.8' />
        </svg>
      </span>
    }
  />
)
