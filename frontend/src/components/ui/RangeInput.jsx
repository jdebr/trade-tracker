import { cn } from "@/lib/utils"

/**
 * A labelled numeric control: a horizontal slider paired with a direct-entry
 * number field, both editing the same value.
 *
 * The slider gives quick coarse adjustment; the number field allows an exact
 * value (and values outside the slider's min/max — the slider just clamps its
 * thumb, the number keeps whatever was typed).
 *
 * Native <input type="range"> — no dependency. `accent-primary` themes the track
 * and thumb in every current browser.
 */
export function RangeInput({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  prefix,
  suffix,
  disabled = false,
  ariaLabel,
  numberClassName,
}) {
  const numValue = value ?? ""
  // The slider needs a number; fall back to min when the field is cleared.
  const sliderValue = value == null || value === "" ? min : Number(value)

  const emit = (raw) => onChange(raw === "" ? null : Number(raw))

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      )}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          disabled={disabled}
          onChange={(e) => emit(e.target.value)}
          aria-label={`${ariaLabel || label} slider`}
          className={cn(
            "flex-1 h-1.5 cursor-pointer accent-primary",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />
        <div className="relative shrink-0">
          {prefix && (
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              {prefix}
            </span>
          )}
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={numValue}
            disabled={disabled}
            onChange={(e) => emit(e.target.value)}
            aria-label={ariaLabel || label}
            className={cn(
              "rounded-md border border-input bg-background py-1.5 text-sm tabular-nums text-right",
              "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
              prefix ? "pl-5 pr-2" : "px-2",
              suffix ? "pr-6" : "",
              numberClassName || "w-24"
            )}
          />
          {suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
      </div>
      {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
    </div>
  )
}
