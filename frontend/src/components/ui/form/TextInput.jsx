import { forwardRef } from "react"
import { cn } from "@/lib/utils"
import { controlClass, invalidClass } from "./styles"
import { useFieldControl } from "./fieldContext"

export const TextInput = forwardRef(function TextInput({ className, invalid, id, ...props }, ref) {
  const field = useFieldControl({ id, invalid })
  return (
    <input
      ref={ref}
      type="text"
      id={field.id}
      {...field.ariaProps}
      className={cn(controlClass, "w-full", field.invalid && invalidClass, className)}
      {...props}
    />
  )
})
