import { Tooltip } from '@base-ui/react/tooltip'
import { type ReactElement, type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

/** After the pointer leaves a group's triggers, re-entering within this window opens instantly. */
const warmWindow = 500

/**
 * A tooltip group: one popup root shared by every trigger with the same key, plus its own timer.
 * Inside a group the first hover waits for the open delay, moving between triggers re-anchors the
 * open popup instantly, leaving closes immediately, and coming back within `warmWindow` is instant
 * again. Groups never warm each other up, so hovering one column does not make another snap open.
 */
interface Group {
  key: string
  openDelay: number
  handle: Tooltip.Handle<ReactNode>
  isWarm: () => boolean
  subscribe: (listener: () => void) => () => void
  setOpen: (open: boolean) => void
}

const createGroup = (key: string, openDelay: number): Group => {
  const handle = Tooltip.createHandle<ReactNode>()
  const listeners = new Set<() => void>()
  let warm = false
  let cooldown: ReturnType<typeof setTimeout> | undefined
  const setWarm = (next: boolean) => {
    if (warm === next) return
    warm = next
    for (const listener of listeners) listener()
  }
  return {
    key,
    openDelay,
    handle,
    isWarm: () => warm,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setOpen: (open) => {
      clearTimeout(cooldown)
      if (open) setWarm(true)
      else cooldown = setTimeout(() => setWarm(false), warmWindow)
    },
  }
}

/** Groups are created on first use; the host mounts one root per group. */
const groups = new Map<string, Group>()
const registryListeners = new Set<() => void>()
let snapshot: Group[] = []

const groupFor = (key: string, openDelay: number) => {
  let group = groups.get(key)
  if (!group) {
    group = createGroup(key, openDelay)
    groups.set(key, group)
    snapshot = [...groups.values()]
    // Defer so a trigger rendering for the first time does not update the host mid-render.
    queueMicrotask(() => registryListeners.forEach((listener) => listener()))
  }
  return group
}

const subscribeRegistry = (listener: () => void) => {
  registryListeners.add(listener)
  return () => registryListeners.delete(listener)
}

const GroupRoot = ({ group }: { group: Group }) => {
  // Whether this opening happened while the group was warm; warm openings skip the fade.
  const [instant, setInstant] = useState(false)
  return (
    <Tooltip.Root
      disableHoverablePopup
      handle={group.handle}
      onOpenChange={(open) => {
        if (open) setInstant(group.isWarm())
        group.setOpen(open)
      }}
    >
      {({ payload }) => (
        <Tooltip.Portal>
          <Tooltip.Positioner className='pointer-events-none z-50' sideOffset={6}>
            <Tooltip.Popup
              className={`pointer-events-none max-w-sm origin-[var(--transform-origin)] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] leading-5 text-secondary shadow-popup transition-[opacity,scale] duration-100 ease-[cubic-bezier(0.2,0,0,1)] data-[ending-style]:duration-0 data-[instant]:transition-none data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 ${
                instant ? 'transition-none' : ''
              }`}
            >
              {payload}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  )
}

/** Mounts the popup root of every tooltip group. Render once, around the app. */
export const TooltipHost = ({ children }: { children: ReactNode }) => {
  const registered = useSyncExternalStore(
    subscribeRegistry,
    () => snapshot,
    () => snapshot,
  )
  return (
    <>
      {children}
      {registered.map((group) => (
        <GroupRoot group={group} key={group.key} />
      ))}
    </>
  )
}

interface TooltipTriggerProps {
  content: ReactNode
  /** Triggers with the same group share one popup and one warm-up timer. */
  group: string
  /** Delay before the group's first tooltip opens. */
  openDelay?: number
  /**
   * The element that receives hover. Make it the full hit area (e.g. the table cell itself), so
   * neighbouring triggers touch and the pointer never crosses a gap between them.
   */
  render: ReactElement<Record<string, unknown>>
}

export const TooltipTrigger = ({
  content,
  group,
  openDelay = 300,
  render,
}: TooltipTriggerProps) => {
  const entry = groupFor(group, openDelay)
  const warm = useSyncExternalStore(entry.subscribe, entry.isWarm, entry.isWarm)
  // Re-register after hot reloads or unusual mount orders; cheap when already present.
  useEffect(() => void groupFor(group, openDelay), [group, openDelay])
  return (
    <Tooltip.Trigger
      closeDelay={0}
      delay={warm ? 0 : entry.openDelay}
      handle={entry.handle}
      payload={content}
      render={render}
    />
  )
}

interface InfoHintProps {
  /** Tooltip content. */
  children: ReactNode
  label: string
  /** Visible text before the icon; it becomes part of the hover target. */
  text?: ReactNode
}

/**
 * An inline "i" (optionally after a short label) that explains something about its row. All info
 * hints form one group that opens after 0.1 s, since pointing at one is deliberate.
 *
 * The hit layer reaches 9 px above and below the 14 px icon, filling a 32 px row, and 6 px to each
 * side, half of the 12 px gap between neighbouring hints, so stacked or adjacent hints meet with no
 * dead zone while the visible size and layout stay unchanged.
 */
export const InfoHint = ({ children, label, text }: InfoHintProps) => (
  <TooltipTrigger
    content={children}
    group='info'
    openDelay={100}
    render={
      <span
        aria-label={text ? undefined : label}
        className='group relative inline-flex shrink-0 items-center gap-1 self-center after:absolute after:-inset-x-1.5 after:-inset-y-[9px]'
        role={text ? undefined : 'img'}
      >
        {text}
        <svg
          aria-hidden='true'
          className='snap-group size-3.5 shrink-0 text-faint group-hover:text-secondary'
          fill='none'
          viewBox='0 0 14 14'
        >
          <circle cx='7' cy='7' r='5.75' stroke='currentColor' strokeWidth='1.2' />
          <path d='M7 6.25v3.5' stroke='currentColor' strokeLinecap='round' strokeWidth='1.3' />
          <circle cx='7' cy='4.4' fill='currentColor' r='0.8' />
        </svg>
      </span>
    }
  />
)
