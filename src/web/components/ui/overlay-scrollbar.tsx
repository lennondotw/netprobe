import {
  type PointerEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/** Minimum thumb length, so a very wide table still has something to grab. */
const minThumb = 24
/** How long the bar stays visible after the last scroll, like macOS overlay scrollbars. */
const lingerMs = 900

export interface ScrollSync {
  /** Called on every scroll or resize of the shared container. */
  subscribe: (listener: () => void) => () => void
  metrics: () => { scrollLeft: number; scrollWidth: number; clientWidth: number }
  scrollTo: (left: number) => void
}

/**
 * One horizontal scroll position shared by any number of overlay scrollbars. Scrollbars read it
 * and write to it; they never talk to each other, so each keeps its own hover and drag state.
 */
export const useScrollSync = (containerRef: RefObject<HTMLElement | null>) => {
  const listeners = useRef(new Set<() => void>())
  const [overflowing, setOverflowing] = useState(false)

  const sync = useMemo<ScrollSync>(
    () => ({
      subscribe: (listener) => {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
      },
      metrics: () => {
        const el = containerRef.current
        return el
          ? { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
          : { scrollLeft: 0, scrollWidth: 0, clientWidth: 0 }
      },
      scrollTo: (left) => {
        if (containerRef.current) containerRef.current.scrollLeft = left
      },
    }),
    [containerRef],
  )

  const notify = useCallback(() => {
    const { scrollWidth, clientWidth } = sync.metrics()
    setOverflowing(scrollWidth > clientWidth + 1)
    for (const listener of listeners.current) listener()
  }, [sync])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(notify)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    el.addEventListener('scroll', notify, { passive: true })
    notify()
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', notify)
    }
  }, [containerRef, notify])

  return { sync, overflowing }
}

/**
 * A slim overlay scrollbar in the macOS style, smaller: a 4 px pill that grows to 6 px while
 * hovered or dragged, over a track that only shows on hover. The visible bar stays thin while an
 * invisible 12 px band takes the pointer. Dragging the thumb scrolls; clicking the track jumps
 * there. The position comes from the shared `ScrollSync`, so every copy moves together.
 */
export const OverlayScrollbar = ({ sync }: { sync: ScrollSync }) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; startLeft: number } | null>(null)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Shown while its own section is scrolled under the pointer, then hidden once scrolling stops.
  // The other sections' bars move in step but stay hidden.
  const [scrolling, setScrolling] = useState(false)
  const lastLeft = useRef<number | null>(null)
  const pointerInSection = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const geometry = useCallback(() => {
    const { scrollLeft, scrollWidth, clientWidth } = sync.metrics()
    const track = trackRef.current?.clientWidth ?? 0
    const thumb = Math.max(minThumb, scrollWidth > 0 ? (clientWidth / scrollWidth) * track : track)
    const range = Math.max(scrollWidth - clientWidth, 0)
    const travel = Math.max(track - thumb, 0)
    return {
      scrollLeft,
      range,
      travel,
      thumb,
      offset: range > 0 ? (scrollLeft / range) * travel : 0,
    }
  }, [sync])

  // Position updates go straight to the DOM: scrolling never re-renders the table.
  useLayoutEffect(() => {
    const update = () => {
      const thumb = thumbRef.current
      if (!thumb) return
      const g = geometry()
      thumb.style.width = `${g.thumb}px`
      thumb.style.transform = `translateX(${g.offset}px)`
      if (
        pointerInSection.current &&
        lastLeft.current !== null &&
        lastLeft.current !== g.scrollLeft
      ) {
        setScrolling(true)
        clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => setScrolling(false), lingerMs)
      }
      lastLeft.current = g.scrollLeft
    }
    update()
    // The track's own width can settle after the container's (it is sized by container units).
    const observer = new ResizeObserver(update)
    if (trackRef.current) observer.observe(trackRef.current)
    const unsubscribe = sync.subscribe(update)
    return () => {
      observer.disconnect()
      unsubscribe()
      clearTimeout(hideTimer.current)
    }
  }, [sync, geometry])

  // The section is the table body this bar belongs to (or the whole table without groups).
  useLayoutEffect(() => {
    const section = trackRef.current?.closest('tbody')
    if (!section) return
    const enter = () => (pointerInSection.current = true)
    const leave = () => {
      pointerInSection.current = false
      clearTimeout(hideTimer.current)
      setScrolling(false)
    }
    section.addEventListener('pointerenter', enter)
    section.addEventListener('pointerleave', leave)
    pointerInSection.current = section.matches(':hover')
    return () => {
      section.removeEventListener('pointerenter', enter)
      section.removeEventListener('pointerleave', leave)
    }
  }, [])

  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  const onThumbDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: sync.metrics().scrollLeft,
    }
    setDragging(true)
  }

  const onThumbMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    // The release can be lost (outside the window, another app); no buttons means it is over.
    if (event.buttons === 0) return endDrag()
    const g = geometry()
    if (g.travel === 0) return
    sync.scrollTo(current.startLeft + ((event.clientX - current.startX) / g.travel) * g.range)
  }

  const onTrackDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !trackRef.current) return
    const g = geometry()
    const x = event.clientX - trackRef.current.getBoundingClientRect().left - g.thumb / 2
    sync.scrollTo((Math.min(Math.max(x, 0), g.travel) / Math.max(g.travel, 1)) * g.range)
  }

  const active = hovered || dragging
  const visible = active || scrolling
  return (
    // The visible track is 6 px tall; an invisible band reaches 6 px above and below it so the
    // bar is easy to catch without looking any bigger.
    <div
      className={`group/bar relative h-1.5 w-full touch-none transition-opacity select-none before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] ${
        visible ? 'opacity-100 duration-0' : 'opacity-0 duration-300'
      }`}
      onPointerDown={onTrackDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      ref={trackRef}
    >
      <div
        aria-hidden='true'
        className={`pointer-events-none absolute inset-0 rounded-full transition-colors ${
          active ? 'bg-foreground/[0.06] duration-0' : 'bg-transparent duration-150'
        }`}
      />
      <div
        // Instant in, fast out: state changes land at once and ease back when the pointer leaves.
        // Its own hit band matches the track's, so grabbing never misses a thin thumb.
        className={`absolute bottom-0 left-0 rounded-full transition-[height,background-color] ease-[cubic-bezier(0.2,0,0,1)] before:absolute before:inset-x-0 before:-top-2 before:-bottom-1.5 before:content-[''] ${
          dragging
            ? 'h-1.5 bg-foreground/55 duration-0'
            : active
              ? 'h-1.5 bg-foreground/40 duration-0'
              : 'h-1 bg-foreground/30 duration-150'
        }`}
        onLostPointerCapture={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={endDrag}
        ref={thumbRef}
      />
    </div>
  )
}
