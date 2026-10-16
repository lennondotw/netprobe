import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

export interface DataTableColumn<Row> {
  /** Cell renderer. Keep cells to a single line; details belong in the row's dialog. */
  cell: (row: Row) => ReactNode
  className?: string
  header: string
  id: string
  /** The column whose cell names the row; it becomes the row's keyboard target when rows open. */
  primary?: boolean
}

interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[]
  empty: ReactNode
  getRowId: (row: Row) => string
  label: string
  /** Omit for read-only lists whose rows have nothing more to show. */
  onRowOpen?: (row: Row) => void
  rows: readonly Row[]
  selectedRowId?: string | null
}

const cellBase = 'px-3 whitespace-nowrap first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6'

/** Stops a click on an in-cell control (link, button) from also opening the row. */
const isFromControl = (target: EventTarget) =>
  target instanceof Element && target.closest('a, button:not([data-row-trigger])') !== null

/**
 * A dense, multi-column record list in the spirit of a macOS detailed list view: zebra rows,
 * column separators in the header, and a persistent selection highlight. Clicking anywhere on a
 * row (or pressing Enter/Space on its primary cell) opens that row; links inside cells keep
 * their own behaviour.
 */
export const DataTable = <Row,>({
  columns,
  empty,
  getRowId,
  label,
  onRowOpen,
  rows,
  selectedRowId = null,
}: DataTableProps<Row>) => {
  if (rows.length === 0) return <>{empty}</>

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
        <tbody>
          {rows.map((row) => {
            const id = getRowId(row)
            const selected = id === selectedRowId

            return (
              <tr
                data-selected={selected || undefined}
                className={`snap h-8 cursor-default border-b border-line-subtle align-middle text-[12.5px] ${
                  selected ? 'bg-accent-soft' : 'even:bg-surface-subtle hover:bg-hover'
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
                        className='-mx-1 cursor-default rounded-sm px-1 text-left'
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
      </table>
    </div>
  )
}
