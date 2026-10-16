import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { gutter } from './layout.ts'
import { OverlayScrollbar, useScrollSync } from './overlay-scrollbar.tsx'
import { TooltipTrigger } from './tooltip.tsx'

export interface DataTableColumn<Row> {
  /** Cell renderer. Keep cells to a single line; details belong in the row's dialog. */
  cell: (row: Row) => ReactNode
  className?: string
  header: string
  id: string
  /** The column whose cell names the row; it becomes the row's keyboard target when rows open. */
  primary?: boolean
  /**
   * Hover detail for the cell. The whole cell is the hover target, so tooltip cells in adjacent
   * rows and columns touch with no gap between them. Return null for cells with nothing to add.
   */
  tooltip?: (row: Row) => ReactNode
}

export interface DataTableGroup<Row> {
  id: string
  /** Content of the full-width group header row, like Linear's status groups. */
  header: ReactNode
  label: string
  rows: readonly Row[]
}

interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[]
  empty: ReactNode
  getRowId: (row: Row) => string
  label: string
  /** Omit for read-only lists whose rows have nothing more to show. */
  onRowOpen?: (row: Row) => void
  /** Either flat rows or groups; groups render inside the same table so every column lines up. */
  rows?: readonly Row[]
  groups?: readonly DataTableGroup<Row>[]
  selectedRowId?: string | null
}

const cellBase = 'px-3 whitespace-nowrap first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6'

/** Stops a click on an in-cell control (link, button, checkbox) from also opening the row. */
const isFromControl = (target: EventTarget) =>
  target instanceof Element &&
  target.closest('a, button:not([data-row-trigger]), [role="checkbox"]') !== null

/**
 * A dense, multi-column record list in the spirit of a macOS detailed list view: zebra rows,
 * column separators in the header, and a persistent selection highlight. Clicking anywhere on a
 * row (or pressing Enter/Space on its primary cell) opens that row; links inside cells keep
 * their own behaviour.
 *
 * Groups share one `<table>`, so the browser sizes each column from every row in the list rather
 * than per group, and stacked groups always align.
 */
export const DataTable = <Row,>({
  columns,
  empty,
  getRowId,
  label,
  onRowOpen,
  rows,
  groups,
  selectedRowId = null,
}: DataTableProps<Row>) => {
  const sticky = useStickyHeader()
  const scroll = useScrollSync(sticky.containerRef)
  const sections: readonly DataTableGroup<Row>[] = groups ?? [
    { id: 'all', header: null, label, rows: rows ?? [] },
  ]
  if (sections.every((section) => section.rows.length === 0)) return <>{empty}</>

  const openFromRow = (event: MouseEvent<HTMLTableRowElement>, row: Row) => {
    if (!onRowOpen || isFromControl(event.target)) return
    onRowOpen(row)
  }

  const openFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, row: Row) => {
    if (!onRowOpen || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onRowOpen(row)
  }

  const headerCells = (
    <tr>
      {columns.map((column) => (
        <th
          className={`${cellBase} relative h-7 text-[11.5px] font-medium text-muted after:absolute after:inset-y-1.5 after:right-0 after:w-px after:bg-line last:after:hidden ${column.className ?? ''}`}
          key={column.id}
          scope='col'
        >
          {column.header}
        </th>
      ))}
    </tr>
  )

  return (
    <div>
      {/*
       * The visible header. It sits outside the horizontal scroll container so it can stick below
       * the page header (a scroll container would capture it), and mirrors the table's measured
       * column widths and horizontal scroll position.
       */}
      <div
        aria-hidden='true'
        className='sticky top-[var(--page-header-height,0px)] z-10 overflow-hidden border-b border-line bg-surface-subtle'
      >
        <table
          className='table-fixed border-collapse text-left'
          ref={sticky.headerRef}
          style={{ width: sticky.tableWidth || undefined }}
        >
          {sticky.widths.length === columns.length && (
            <colgroup>
              {sticky.widths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          )}
          <thead>{headerCells}</thead>
        </table>
      </div>
      {/* Native scrollbar hidden: each section gets an overlay scrollbar instead. */}
      <div
        className='@container overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        onScroll={sticky.onScroll}
        ref={sticky.containerRef}
      >
        <table
          aria-label={label}
          className='w-full border-collapse text-left'
          ref={sticky.tableRef}
        >
          {/* The real header: sizes and labels the columns, but takes no height. */}
          <thead className='[visibility:collapse]'>{headerCells}</thead>
          {sections.map((section) => (
            <tbody aria-label={groups ? section.label : undefined} key={section.id}>
              {section.header !== null && (
                <tr className='border-b border-line bg-surface-subtle'>
                  <th
                    className='h-9 p-0 text-left font-normal'
                    colSpan={columns.length}
                    scope='rowgroup'
                  >
                    {/*
                     * Pinned to the scroll container's visible width, so trailing controls stay in
                     * view when the table is wider than the screen and scrolls sideways.
                     */}
                    <div
                      className={`sticky left-0 flex w-[100cqw] min-w-0 items-center gap-2 py-1.5 text-[12.5px] font-medium ${gutter}`}
                    >
                      {section.header}
                    </div>
                  </th>
                </tr>
              )}
              {section.rows.map((row, index) => {
                const id = getRowId(row)
                const selected = id === selectedRowId
                // Zebra by position within the group, so the group header row does not shift it.
                const zebra = index % 2 === 1 ? 'bg-surface-subtle' : ''

                return (
                  <tr
                    data-selected={selected || undefined}
                    className={`snap h-8 border-b border-line-subtle align-middle text-[12.5px] ${
                      selected ? 'bg-accent-soft' : `${zebra} hover:bg-hover`
                    }`}
                    key={id}
                    onClick={(event) => openFromRow(event, row)}
                  >
                    {columns.map((column) => (
                      <Cell
                        className={`${cellBase} py-1 ${column.className ?? ''}`}
                        key={column.id}
                        tooltip={column.tooltip?.(row) ?? null}
                        tooltipGroup={`cell:${column.id}`}
                      >
                        {column.primary && onRowOpen ? (
                          <button
                            aria-haspopup='dialog'
                            data-row-trigger=''
                            className='-mx-1 rounded-sm px-1 text-left'
                            onKeyDown={(event) => openFromKeyboard(event, row)}
                            type='button'
                          >
                            {column.cell(row)}
                          </button>
                        ) : (
                          column.cell(row)
                        )}
                      </Cell>
                    ))}
                  </tr>
                )
              })}
              {scroll.overflowing && (
                // A zero-height row whose bar overlays the section's bottom edge, pinned to the
                // visible width. Every section's bar shows the same position.
                <tr aria-hidden='true'>
                  <td className='h-0 p-0' colSpan={columns.length}>
                    <div className='sticky left-0 h-0 w-[100cqw]'>
                      <div className={`absolute inset-x-0 bottom-0 ${gutter}`}>
                        <OverlayScrollbar sync={scroll.sync} />
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  )
}

/** Cells of one column share a tooltip group, so moving along a column is instant but moving to
 * another column's tooltips waits again. */
const Cell = ({
  children,
  className,
  tooltip,
  tooltipGroup,
}: {
  children: ReactNode
  className: string
  tooltip: ReactNode
  tooltipGroup: string
}) =>
  tooltip === null ? (
    <td className={className}>{children}</td>
  ) : (
    <TooltipTrigger
      content={tooltip}
      group={tooltipGroup}
      render={<td className={className}>{children}</td>}
    />
  )

/**
 * Keeps the detached sticky header in step with the table: column widths (measured from the
 * collapsed real header, which the browser still lays out) and horizontal scroll position.
 */
const useStickyHeader = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const headerRef = useRef<HTMLTableElement>(null)
  const [layout, setLayout] = useState<{ widths: number[]; tableWidth: number }>({
    widths: [],
    tableWidth: 0,
  })

  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const measure = () => {
      const cells = [...(table.tHead?.rows[0]?.cells ?? [])]
      const widths = cells.map((cell) => cell.getBoundingClientRect().width)
      const tableWidth = table.getBoundingClientRect().width
      setLayout((current) =>
        current.tableWidth === tableWidth &&
        current.widths.length === widths.length &&
        current.widths.every((w, i) => w === widths[i])
          ? current
          : { widths, tableWidth },
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    measure()
    return () => observer.disconnect()
  })

  const onScroll = () => {
    const header = headerRef.current
    const container = containerRef.current
    if (header && container) header.style.transform = `translateX(${-container.scrollLeft}px)`
  }

  return { containerRef, tableRef, headerRef, onScroll, ...layout }
}
