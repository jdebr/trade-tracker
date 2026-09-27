import { cn } from "@/lib/utils"
import { decimalsOf } from "@/lib/validate"
import { Field } from "./form/Field"
import { NumberInput } from "./form/NumberInput"

/**
 * A labelled numeric control: a horizontal slider paired with a direct-entry
 * number field, both editing the same value.
 *
 * The slider gives quick coarse adjustment over `min`–`max`; the number field
 * allows an exact value, including values *outside* the slider's range (the
 * slider just clamps its thumb). Only `hardMin`/`hardMax` are real limits —
 * breaking those turns the field red. A non-negative slider defaults to
 * `hardMin = 0`, so "-" can't even be typed.
 *
 * The number field is a <NumberInput>: keystroke-filtered (whole numbers when
 * `step` is whole, otherwise up to max(2, step's decimals) places) with themed
 * steppers.
 */
export function RangeInput({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  hardMin,
  hardMax,
  required = false,
  prefix,
  suffix,
  disabled = false,
  ariaLabel,
  numberClassName,
  error,
}) {
  // The slider needs a number; fall back to min when the field is cleared.
  const sliderValue = value == null || value === "" ? min : Math.min(Math.max(Number(value), min), max)
  const integer = Number.isInteger(step) && Number.isInteger(min)
  const floor = hardMin ?? (min >= 0 ? 0 : undefined)

  return (
    <Field label={label} hint={hint} error={error}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${ariaLabel || label} slider`}
          className={cn(
            "h-1.5 flex-1 cursor-pointer accent-primary",
            disabled && "cursor-not-allowed opacity-50"
          )}
        />
        <NumberInput
          value={value === "" ? null : value}
          onChange={onChange}
          integer={integer}
          maxDecimals={integer ? 0 : Math.max(2, decimalsOf(step))}
          min={floor}
          max={hardMax}
          required={required}
          step={step}
          prefix={prefix}
          suffix={suffix}
          disabled={disabled}
          aria-label={ariaLabel || label}
          className={cn("shrink-0", numberClassName || "w-28")}
          inputClassName="text-right"
        />
      </div>
    </Field>
  )
}
