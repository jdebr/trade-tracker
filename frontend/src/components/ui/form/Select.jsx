import { forwardRef, useMemo } from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { controlClass, invalidClass, floatingListClass } from "./styles"
import { useFieldControl } from "./fieldContext"

/**
 * Themed dropdown (Radix Select).
 *
 * options: [{ value, label, description?, group?, disabled? }]
 *   - `value` must be a non-empty string; `value=""` (or null) shows the placeholder.
 *   - Options sharing a `group` are rendered under that group's heading, in
 *     first-seen order.
 *
 * The list renders in a portal (never clipped by a dialog), is at least as wide
 * as the trigger, grows to fit its longest option, and stays on-screen.
 */
export const Select = forwardRef(function Select(
  {
    value,
    onValueChange,
    options = [],
    placeholder = "Select…",
    disabled,
    invalid,
    id,
    className,          // trigger
    contentClassName,   // floating list
    "aria-label": ariaLabel,
    renderValue,        // optional (option) => node for the trigger
    ...props
  },
  ref
) {
  const field = useFieldControl({ id, invalid })

  const sections = useMemo(() => {
    const order = []
    const byGroup = new Map()
    for (const o of options) {
      const g = o.group ?? ""
      if (!byGroup.has(g)) {
        byGroup.set(g, [])
        order.push(g)
      }
      byGroup.get(g).push(o)
    }
    return order.map((g) => ({ group: g, items: byGroup.get(g) }))
  }, [options])

  const selected = options.find((o) => o.value === value)

  return (
    <SelectPrimitive.Root value={value ?? ""} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={field.id}
        aria-label={ariaLabel}
        {...field.ariaProps}
        className={cn(
          controlClass,
          "inline-flex w-full items-center justify-between gap-2 text-left",
          "data-[placeholder]:text-muted-foreground",
          field.invalid && invalidClass,
          className
        )}
        {...props}
      >
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value placeholder={placeholder}>
            {selected && renderValue ? renderValue(selected) : undefined}
          </SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            floatingListClass,
            "min-w-[var(--radix-select-trigger-width)] max-w-[min(32rem,calc(100vw-1rem))]",
            "max-h-[min(20rem,var(--radix-select-content-available-height))]",
            contentClassName
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center text-muted-foreground">
            <ChevronUp size={13} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {sections.map(({ group, items }, i) => {
              const body = items.map((o) => <SelectItem key={o.value} option={o} />)
              if (!group) return <div key={`__${i}`}>{body}</div>
              return (
                <SelectPrimitive.Group key={group}>
                  {i > 0 && <SelectPrimitive.Separator className="my-1 h-px bg-border" />}
                  <SelectPrimitive.Label className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </SelectPrimitive.Label>
                  {body}
                </SelectPrimitive.Group>
              )
            })}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center text-muted-foreground">
            <ChevronDown size={13} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
})

function SelectItem({ option }) {
  return (
    <SelectPrimitive.Item
      value={option.value}
      disabled={option.disabled}
      className={cn(
        "relative flex cursor-pointer select-none items-start rounded-sm py-1.5 pl-7 pr-3 text-sm outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
      )}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 top-2">
        <Check size={13} aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
      <div className="flex min-w-0 flex-col">
        <span className="whitespace-nowrap">
          <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
        </span>
        {option.description && (
          <span className="text-[11px] leading-snug text-muted-foreground">{option.description}</span>
        )}
      </div>
    </SelectPrimitive.Item>
  )
}
