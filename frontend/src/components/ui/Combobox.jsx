import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"

/**
 * Fuzzy-match combobox for symbol/group selection.
 *
 * Props:
 *   value          - controlled string value
 *   onChange(val)  - called when user selects an option or types
 *   options        - array of { symbol, name } OR array of strings (for group mode)
 *   placeholder    - input placeholder
 *   allowNew       - if true, shows "+ Create 'X'" as last option for unmatched input
 *   className      - extra classes on the wrapper
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

export function Combobox({
  value,
  onChange,
  options = [],
  placeholder = "Search…",
  allowNew = false,
  className,
  "aria-label": ariaLabel,
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  // Filtered + ranked options
  const query = value || ""
  const filtered = query.trim()
    ? options
        .map((opt) => ({ opt, score: scoreMatch(opt, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ opt }) => opt)
    : options

  // Build display list
  const displayList = [...filtered]
  const typedIsNew =
    allowNew &&
    query.trim() &&
    !options.some(
      (opt) =>
        (opt.symbol || opt).toLowerCase() === query.trim().toLowerCase()
    )
  if (typedIsNew) {
    displayList.push({ __isNew: true, value: query.trim() })
  }

  // "Not in universe" hint (allowNew=false)
  const showNotInUniverse =
    !allowNew &&
    query.trim() &&
    !options.some(
      (opt) =>
        (opt.symbol || opt).toLowerCase() === query.trim().toLowerCase()
    )

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleMouseDown)
    return () => document.removeEventListener("mousedown", handleMouseDown)
  }, [])

  function handleSelect(opt) {
    if (opt.__isNew) {
      onChange(opt.value)
    } else {
      onChange(opt.symbol || opt)
    }
    setOpen(false)
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
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
      if (displayList[highlighted]) {
        handleSelect(displayList[highlighted])
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        value={value || ""}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        className={cn(
          "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm",
          "placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
          "transition-colors"
        )}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlighted(0)
        }}
        onKeyDown={handleKeyDown}
      />

      {/* Not-in-universe hint */}
      {showNotInUniverse && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          ⚠ Not in universe
        </p>
      )}

      {/* Dropdown */}
      {open && displayList.length > 0 && (
        <ul
          className={cn(
            "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border",
            "bg-popover py-1 shadow-md text-sm"
          )}
          role="listbox"
        >
          {displayList.map((opt, i) => {
            if (opt.__isNew) {
              return (
                <li
                  key="__new"
                  role="option"
                  aria-selected={i === highlighted}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-sm text-muted-foreground",
                    i === highlighted && "bg-accent text-accent-foreground"
                  )}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(opt) }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  + Create &ldquo;{opt.value}&rdquo;
                </li>
              )
            }
            const sym = opt.symbol || opt
            const name = opt.name || null
            return (
              <li
                key={sym}
                role="option"
                aria-selected={i === highlighted}
                className={cn(
                  "cursor-pointer px-3 py-1.5",
                  i === highlighted && "bg-accent text-accent-foreground"
                )}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(opt) }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="font-mono">{sym}</span>
                {name && <span className="ml-2 text-muted-foreground">{name}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
