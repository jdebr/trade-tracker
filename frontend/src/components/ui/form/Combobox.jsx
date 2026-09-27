import { useId, useRef, useState } from "react"
import * as Popover from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"
import { controlClass, invalidClass, floatingListClass } from "./styles"
import { useFieldControl } from "./fieldContext"

/**
 * Type-to-filter text input with a fuzzy-ranked suggestion list.
 *
 * Props:
 *   value          - controlled string value
 *   onChange(val)  - called when the user types or picks an option
 *   options        - [{ symbol, name }] OR [string] (group mode)
 *   placeholder    - input placeholder
 *   allowNew       - show "+ Create 'X'" for unmatched input
 *   className      - wrapper classes (sizing)
 *
 * The list renders in a portal (Radix Popover) so a scrolling dialog can't
 * clip it, is at least as wide as the input and grows to fit long names, and
 * Escape closes just the list — not an enclosing dialog.
 */

function scoreMatch(option, query) {
  const q = query.toLowerCase()
  const sym = (option.symbol || option).toLowerCase()
  const name = (option.name || "").toLowerCase()

  if (sym === q) return 100
  if (sym.startsWith(q)) return 80
  if (sym.includes(q)) return 60
  if (name.includes(q)) return 40
  return 0
}

const keyOf = (opt) => (opt.__isNew ? "__new" : opt.symbol || opt)

export function Combobox({
  value,
  onChange,
  options = [],
  placeholder = "Search…",
  allowNew = false,
  className,
  invalid,
  id,
  "aria-label": ariaLabel,
}) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const anchorRef = useRef(null)
  const listId = useId()

  const query = value || ""
  const q = query.trim()
  const filtered = q
    ? options
        .map((opt) => ({ opt, score: scoreMatch(opt, q) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ opt }) => opt)
    : options

  const exactMatch = options.some((opt) => (opt.symbol || opt).toLowerCase() === q.toLowerCase())
  const displayList = [...filtered]
  if (allowNew && q && !exactMatch) displayList.push({ __isNew: true, value: q })
  // Without allowNew, a value that isn't one of the options is invalid. Don't
  // nag while suggestions still match what's being typed — flag it once nothing
  // matches, or when the user leaves the field on a non-match.
  const notInList = !allowNew && !!q && !exactMatch && (filtered.length === 0 || !focused)

  const field = useFieldControl({ id, invalid: invalid || notInList || undefined })

  const listOpen = open && displayList.length > 0
  const active = Math.min(highlighted, displayList.length - 1)

  function handleSelect(opt) {
    onChange(opt.__isNew ? opt.value : opt.symbol || opt)
    setOpen(false)
  }

  function handleKeyDown(e) {
    if (!listOpen) {
      if (e.key === "ArrowDown" || (e.key === "Enter" && displayList.length > 0 && !open)) {
        e.preventDefault()
        setOpen(true)
        setHighlighted(0)
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, displayList.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (displayList[active]) handleSelect(displayList[active])
    } else if (e.key === "Tab") {
      setOpen(false)
    }
    // Escape is handled by the Popover layer (closes the list only).
  }

  return (
    <Popover.Root open={listOpen} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <Popover.Anchor asChild>
          <div ref={anchorRef}>
            <input
              id={field.id}
              type="text"
              role="combobox"
              aria-label={ariaLabel}
              aria-expanded={listOpen}
              aria-controls={listOpen ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
              {...field.ariaProps}
              value={query}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              className={cn(controlClass, "w-full px-3", field.invalid && invalidClass)}
              onFocus={() => {
                setFocused(true)
                setOpen(true)
              }}
              onBlur={() => setFocused(false)}
              onClick={() => setOpen(true)}
              onChange={(e) => {
                onChange(e.target.value)
                setOpen(true)
                setHighlighted(0)
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </Popover.Anchor>

        {notInList && (
          <p className="mt-1 text-[11px] leading-tight text-red-400">Not in universe</p>
        )}
      </div>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // Focus stays in the input the whole time.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Clicking back into the input shouldn't close-then-reopen the list.
            if (anchorRef.current?.contains(e.target)) e.preventDefault()
          }}
          className={cn(
            floatingListClass,
            "min-w-[var(--radix-popover-trigger-width)] max-w-[min(28rem,calc(100vw-1rem))]",
            "max-h-[min(15rem,var(--radix-popover-content-available-height))] overflow-y-auto py-1"
          )}
        >
          <ul id={listId} role="listbox" aria-label={ariaLabel ? `${ariaLabel} suggestions` : undefined}>
            {displayList.map((opt, i) => {
              const isActive = i === active
              return (
                <li
                  key={keyOf(opt)}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isActive}
                  className={cn(
                    "cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm",
                    isActive && "bg-accent text-accent-foreground"
                  )}
                  // mousedown (not click) so the input never loses focus first.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(opt)
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  {opt.__isNew ? (
                    <span className="text-muted-foreground">+ Create &ldquo;{opt.value}&rdquo;</span>
                  ) : (
                    <>
                      <span className="font-mono">{opt.symbol || opt}</span>
                      {opt.name && <span className="ml-2 text-muted-foreground">{opt.name}</span>}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
