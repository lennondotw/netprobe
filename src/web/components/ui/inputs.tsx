import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Select as BaseSelect } from '@base-ui/react/select'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import type { ReactNode } from 'react'

const popupMotion =
  'origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0'

interface Option<Value extends string> {
  value: Value
  label: ReactNode
  /** Secondary text shown under the label inside the menu only. */
  detail?: ReactNode
}

interface SelectProps<Value extends string> {
  label: string
  value: Value
  options: readonly Option<Value>[]
  onChange: (value: Value) => void
  disabled?: boolean
}

/** Compact select in the toolbar style: a 28px trigger with a leading muted label. */
export const Select = <Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SelectProps<Value>) => (
  <BaseSelect.Root
    disabled={disabled}
    items={options.map((o) => ({ value: o.value, label: o.label }))}
    onValueChange={(next) => {
      if (next !== null) onChange(next as Value)
    }}
    value={value}
  >
    <BaseSelect.Trigger
      aria-label={label}
      className='snap inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12.5px] font-medium text-secondary shadow-raised outline-none hover:border-line-strong hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-hover'
    >
      <span className='font-normal text-muted'>{label}</span>
      <BaseSelect.Value className='truncate' />
      <BaseSelect.Icon className='text-faint'>
        <svg
          aria-hidden='true'
          className='size-3 fill-none stroke-current stroke-[1.5]'
          viewBox='0 0 12 12'
        >
          <path
            d='m3.5 4.75 2.5-2.5 2.5 2.5m-5 2.5 2.5 2.5 2.5-2.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        alignItemWithTrigger={false}
        className='z-50 outline-none'
        sideOffset={4}
      >
        <BaseSelect.Popup
          className={`min-w-[var(--anchor-width)] rounded-lg border border-line bg-surface p-1 shadow-popup outline-none ${popupMotion}`}
        >
          <BaseSelect.List>
            {options.map((option) => (
              <BaseSelect.Item
                className='snap grid cursor-default grid-cols-[0.875rem_1fr] items-start gap-x-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-secondary outline-none select-none data-[highlighted]:bg-hover data-[highlighted]:text-foreground data-[highlighted]:duration-0'
                key={option.value}
                value={option.value}
              >
                <BaseSelect.ItemIndicator className='col-start-1 mt-[3px] text-accent-text'>
                  <svg
                    aria-hidden='true'
                    className='size-3 fill-none stroke-current stroke-[1.75]'
                    viewBox='0 0 12 12'
                  >
                    <path
                      d='m2.5 6.25 2.25 2.25 4.75-5'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                  </svg>
                </BaseSelect.ItemIndicator>
                <div className='col-start-2'>
                  <BaseSelect.ItemText className='font-medium'>{option.label}</BaseSelect.ItemText>
                  {option.detail && (
                    <div className='mt-0.5 font-mono text-[11px] text-muted'>{option.detail}</div>
                  )}
                </div>
              </BaseSelect.Item>
            ))}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
)

interface SegmentedProps<Value extends string> {
  label: string
  value: Value
  options: readonly { value: Value; label: ReactNode }[]
  onChange: (value: Value) => void
  disabled?: boolean
}

/** Single-choice segmented control. The selected segment lifts onto the surface colour. */
export const Segmented = <Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SegmentedProps<Value>) => (
  <ToggleGroup
    aria-label={label}
    className='inline-flex h-7 w-fit shrink-0 items-center rounded-md border border-line bg-surface-subtle p-0.5'
    disabled={disabled}
    onValueChange={(next) => {
      // A toggle group allows deselecting; a segmented control always keeps one value.
      const picked = next[0]
      if (picked) onChange(picked as Value)
    }}
    value={[value]}
  >
    {options.map((option) => (
      <Toggle
        className='snap inline-flex h-full min-w-14 items-center justify-center rounded-[5px] px-2.5 text-[12px] font-medium text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 data-[pressed]:bg-surface data-[pressed]:text-foreground data-[pressed]:shadow-raised'
        key={option.value}
        value={option.value}
      >
        {option.label}
      </Toggle>
    ))}
  </ToggleGroup>
)

interface CheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

export const Checkbox = ({
  checked,
  indeterminate,
  onCheckedChange,
  label,
  disabled,
}: CheckboxProps) => (
  <BaseCheckbox.Root
    aria-label={label}
    checked={checked}
    className='snap grid size-3.5 shrink-0 place-items-center rounded-[4px] border border-line-strong bg-surface text-on-accent outline-none hover:border-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 data-[checked]:border-accent data-[checked]:bg-accent data-[indeterminate]:border-accent data-[indeterminate]:bg-accent'
    disabled={disabled}
    indeterminate={indeterminate}
    onCheckedChange={(next) => onCheckedChange(next)}
  >
    <BaseCheckbox.Indicator className='flex data-[unchecked]:hidden'>
      <svg
        aria-hidden='true'
        className='size-2.5 fill-none stroke-current stroke-[2]'
        viewBox='0 0 10 10'
      >
        {indeterminate ? (
          <path d='M2.5 5h5' strokeLinecap='round' />
        ) : (
          <path d='m2 5.25 2 2 4-4.5' strokeLinecap='round' strokeLinejoin='round' />
        )}
      </svg>
    </BaseCheckbox.Indicator>
  </BaseCheckbox.Root>
)

interface TabBarProps<Value extends string> {
  label: string
  value: Value
  options: readonly { value: Value; label: ReactNode; count?: number }[]
  onChange: (value: Value) => void
}

/** View tabs for a toolbar: quiet until hovered, the selected tab lifts onto the surface. */
export const TabBar = <Value extends string>({
  label,
  value,
  options,
  onChange,
}: TabBarProps<Value>) => (
  <ToggleGroup
    aria-label={label}
    className='-mx-1 flex min-w-0 flex-wrap items-center gap-0.5'
    onValueChange={(next) => {
      const picked = next[0]
      if (picked) onChange(picked as Value)
    }}
    value={[value]}
  >
    {options.map((option) => (
      <Toggle
        className='group snap inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-[12.5px] font-medium whitespace-nowrap text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent data-[pressed]:border-line data-[pressed]:bg-surface data-[pressed]:text-foreground data-[pressed]:shadow-raised'
        key={option.value}
        value={option.value}
      >
        {option.label}
        {option.count !== undefined && (
          <span className='snap-group text-[11.5px] font-normal text-faint tabular-nums'>
            {option.count}
          </span>
        )}
      </Toggle>
    ))}
  </ToggleGroup>
)
