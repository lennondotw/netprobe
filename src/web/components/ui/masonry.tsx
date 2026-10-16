import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

export interface MasonryItem {
  id: string
  /** Relative height estimate, e.g. the number of rows a panel shows. */
  weight: number
  node: ReactNode
}

interface MasonryProps {
  items: readonly MasonryItem[]
  /** Columns are added while each can stay at least this wide (px). */
  minColumnWidth?: number
}

/** Horizontal space between columns, split around the vertical rule (px). */
const columnGap = 48

/**
 * Packs sections into columns without the gaps a row-based grid leaves. Each item goes to the
 * currently shortest column, in source order, so reading order stays close to the given order.
 * Sections in a column are separated by a rule, and columns by a vertical rule.
 */
export const Masonry = ({ items, minColumnWidth = 400 }: MasonryProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(1)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      setCount(Math.max(1, Math.floor((width + columnGap) / (minColumnWidth + columnGap))))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [minColumnWidth])

  const columns = Array.from({ length: Math.min(count, items.length) || 1 }, () => ({
    weight: 0,
    items: [] as MasonryItem[],
  }))
  for (const item of items) {
    const shortest = columns.reduce((min, column) => (column.weight < min.weight ? column : min))
    shortest.items.push(item)
    shortest.weight += item.weight
  }

  return (
    <div
      className='grid items-start'
      ref={ref}
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((column, index) => (
        <div
          className={`flex min-w-0 flex-col ${index > 0 ? 'border-l border-line-subtle' : ''}`}
          key={index}
          style={{
            paddingLeft: index > 0 ? columnGap / 2 : 0,
            paddingRight: index < columns.length - 1 ? columnGap / 2 : 0,
          }}
        >
          {column.items.map((item, position) => (
            <div className='contents' key={item.id}>
              {position > 0 && (
                <div aria-hidden='true' className='my-5 h-px shrink-0 bg-line-subtle' />
              )}
              {item.node}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
