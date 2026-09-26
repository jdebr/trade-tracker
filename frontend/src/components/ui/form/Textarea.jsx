import { forwardRef, useCallback, useLayoutEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { controlClass, invalidClass } from "./styles"
import { useFieldControl } from "./fieldContext"

/**
 * Multi-line text. Resizable both ways by default. `autoGrow` makes it grow
 * with its content (height follows the text; width stays user-resizable).
 */
export const Textarea = forwardRef(function Textarea(
  { className, invalid, id, autoGrow = false, rows = 3, value, ...props },
  forwardedRef
) {
  const field = useFieldControl({ id, invalid })
  const innerRef = useRef(null)
  const setRef = useCallback(
    (el) => {
      innerRef.current = el
      if (typeof forwardedRef === "function") forwardedRef(el)
      else if (forwardedRef) forwardedRef.current = el
    },
    [forwardedRef]
  )

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!autoGrow || !el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + 2}px`
  }, [autoGrow, value])

  return (
    <textarea
      ref={setRef}
      id={field.id}
      rows={rows}
      value={value}
      {...field.ariaProps}
      className={cn(
        controlClass,
        "w-full max-w-full leading-relaxed",
        autoGrow ? "resize-x overflow-hidden" : "resize",
        field.invalid && invalidClass,
        className
      )}
      {...props}
    />
  )
})
