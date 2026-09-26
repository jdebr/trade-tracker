// Shared look for every form control, so inputs, selects and comboboxes match.

export const controlClass =
  "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground " +
  "placeholder:text-muted-foreground transition-colors " +
  "focus:outline-none focus:ring-2 focus:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50"

// Failing validation: always red, whatever else is going on.
export const invalidClass = "border-red-500 focus:ring-red-500/50"

// Floating lists (Select content, Combobox popover): theme tokens, at least as
// wide as the trigger, free to grow to fit their content, kept on-screen.
export const floatingListClass =
  "z-[60] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0"
