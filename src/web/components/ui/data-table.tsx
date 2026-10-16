import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { gutter } from './layout.ts'

export interface DataTableColumn<Row> {
  /** Cell renderer. Keep cells to a single line; details belong in the row's dialog. */
  cell: (row: Row) => ReactNode
  className?: string
  header: string
  id: string
  /** The column whose cell names the row; it becomes the row's keyboard target when rows open. */
  primary?: boolean
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

  return (
    <div className='overflow-x-auto'>
      <table aria-label={label} className='w-full border-collapse text-left'>
        <thead>
          <tr className='border-b border-line bg-surface-subtle'>
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
        </thead>
        {sections.map((section) => (
          <tbody aria-label={groups ? section.label : undefined} key={section.id}>
            {section.header !== null && (
              <tr className='border-b border-line bg-surface-subtle'>
                <th
                  className={`h-9 py-1.5 text-left font-normal ${gutter}`}
                  colSpan={columns.length}
                  scope='rowgroup'
                >
                  <div className='flex min-w-0 items-center gap-2 text-[12.5px] font-medium'>
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
                    <td className={`${cellBase} py-1 ${column.className ?? ''}`} key={column.id}>
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
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}
