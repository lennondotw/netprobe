import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react'

/** A minimal history router: the app has three routes and needs nothing more. */
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export const navigate = (to: string) => {
  if (to === window.location.pathname) return
  window.history.pushState(null, '', to)
  for (const listener of listeners) listener()
  window.scrollTo(0, 0)
}

export const usePathname = () =>
  useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/',
  )

export const Link = ({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
  <a
    {...props}
    href={href}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0
      )
        return
      event.preventDefault()
      navigate(href)
    }}
  />
)
