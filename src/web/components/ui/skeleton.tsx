import { gutter } from './layout.ts'

/** A single shimmering text placeholder. Width comes from the caller. */
export const Skeleton = ({ className = 'w-64' }: { className?: string }) => (
  <div
    aria-hidden='true'
    className={`h-3 max-w-full animate-pulse rounded bg-hover ${className}`}
  />
)

const rowWidths = ['w-40', 'w-56', 'w-48', 'w-32', 'w-52']

/** Placeholder list: group headers followed by a few dense rows. */
export const ListSkeleton = ({ groups = 3, rows = 4 }: { groups?: number; rows?: number }) => (
  <div aria-hidden='true'>
    {Array.from({ length: groups }, (_, group) => (
      <div key={group}>
        <div className={`flex h-9 items-center border-b border-line bg-surface-subtle ${gutter}`}>
          <Skeleton className='w-20' />
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div
            className={`flex h-9 items-center gap-4 border-b border-line-subtle ${gutter}`}
            key={row}
          >
            <Skeleton className={rowWidths[(group + row) % rowWidths.length]} />
            <Skeleton className='ml-auto w-16' />
          </div>
        ))}
      </div>
    ))}
  </div>
)
