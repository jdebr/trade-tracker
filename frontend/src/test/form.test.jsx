/**
 * Shared form layer (M19.5 / UX1).
 *
 * NumberInput: keystroke + paste filtering, partial states, range errors shown
 * red via Field, steppers + arrow keys, external value sync.
 * Field: hint vs error line, aria wiring.
 * Select: themed Radix select — options, groups, placeholder, change.
 * Combobox: portal list, filtering, pick, Escape closes only the list.
 * validate.js: short hint strings.
 */

import { describe, it, expect, vi } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Field, NumberInput, Select, Combobox, Textarea, TextInput } from "@/components/ui/form"
import { numberError, required, decimalsOf, firstError } from "@/lib/validate"

function Num({ initial = null, onValue, fieldProps = {}, ...props }) {
  const [v, setV] = useState(initial)
  return (
    <Field label="Amount" {...fieldProps}>
      <NumberInput
        value={v}
        onChange={(n) => {
          setV(n)
          onValue?.(n)
        }}
        aria-label="Amount"
        {...props}
      />
    </Field>
  )
}

const amount = () => screen.getByRole("textbox", { name: "Amount" })

describe("NumberInput", () => {
  it("never accepts a '.' in an integer field", async () => {
    const onValue = vi.fn()
    render(<Num integer min={1} onValue={onValue} />)
    await userEvent.type(amount(), "1.5")
    expect(amount()).toHaveValue("15")
    expect(onValue).toHaveBeenLastCalledWith(15)
  })

  it("rejects letters, exponents and '-' when min >= 0", async () => {
    render(<Num min={0} />)
    await userEvent.type(amount(), "-a1e2+")
    expect(amount()).toHaveValue("12")
  })

  it("allows a leading '-' when negatives are allowed", async () => {
    const onValue = vi.fn()
    render(<Num onValue={onValue} />)
    await userEvent.type(amount(), "-3.5")
    expect(onValue).toHaveBeenLastCalledWith(-3.5)
  })

  it("caps digits after the point at maxDecimals", async () => {
    render(<Num maxDecimals={2} />)
    await userEvent.type(amount(), "1.2345")
    expect(amount()).toHaveValue("1.23")
  })

  it("keeps a partial '1.' while typing and tidies it on blur", async () => {
    const onValue = vi.fn()
    render(<Num onValue={onValue} />)
    await userEvent.type(amount(), "1.")
    expect(amount()).toHaveValue("1.")
    expect(onValue).toHaveBeenLastCalledWith(1)
    fireEvent.blur(amount())
    expect(amount()).toHaveValue("1")
  })

  it("sanitizes pasted text and refuses junk", async () => {
    const onValue = vi.fn()
    render(<Num onValue={onValue} />)
    amount().focus()
    await userEvent.paste("1,234")
    expect(amount()).toHaveValue("1234")
    await userEvent.paste("abc")
    expect(amount()).toHaveValue("1234")
    expect(onValue).toHaveBeenLastCalledWith(1234)
  })

  it("shows a red 'Min' hint for an out-of-range value instead of blocking it", async () => {
    render(<Num integer min={10} fieldProps={{ hint: "Shares" }} />)
    expect(screen.getByText("Shares")).toBeInTheDocument()
    await userEvent.type(amount(), "5")
    expect(amount()).toHaveValue("5")
    expect(amount()).toHaveAttribute("aria-invalid", "true")
    const hint = screen.getByText("Min 10")
    expect(hint).toHaveClass("text-red-400")
    expect(amount().getAttribute("aria-describedby")).toContain(hint.id)
    await userEvent.type(amount(), "0")
    expect(screen.queryByText("Min 10")).not.toBeInTheDocument()
    expect(amount()).not.toHaveAttribute("aria-invalid")
  })

  it("flags a required empty field", () => {
    render(<Num required />)
    expect(screen.getByText("Required")).toBeInTheDocument()
  })

  it("steps with arrow keys, clamped to max", async () => {
    const onValue = vi.fn()
    render(<Num initial={9} max={10} integer onValue={onValue} />)
    amount().focus()
    await userEvent.keyboard("{ArrowUp}{ArrowUp}")
    expect(amount()).toHaveValue("10")
    await userEvent.keyboard("{ArrowDown}")
    expect(onValue).toHaveBeenLastCalledWith(9)
  })

  it("steps with the themed stepper buttons without float drift", () => {
    const onValue = vi.fn()
    render(<Num initial={0.1} step={0.1} onValue={onValue} />)
    const up = screen.getByRole("button", { name: "Increase Amount" })
    fireEvent.pointerDown(up)
    fireEvent.pointerUp(up)
    expect(onValue).toHaveBeenLastCalledWith(0.2)
    fireEvent.pointerDown(up)
    fireEvent.pointerUp(up)
    expect(onValue).toHaveBeenLastCalledWith(0.3) // not 0.30000000000000004
  })

  it("starts stepping from min when empty", () => {
    const onValue = vi.fn()
    render(<Num min={5} integer onValue={onValue} />)
    const up = screen.getByRole("button", { name: "Increase Amount" })
    fireEvent.pointerDown(up)
    fireEvent.pointerUp(up)
    expect(onValue).toHaveBeenLastCalledWith(5)
  })

  it("re-syncs its text when the value changes from outside", () => {
    function Outer() {
      const [v, setV] = useState(1)
      return (
        <>
          <NumberInput value={v} onChange={setV} aria-label="Amount" />
          <button onClick={() => setV(42)}>set</button>
        </>
      )
    }
    render(<Outer />)
    fireEvent.click(screen.getByText("set"))
    expect(amount()).toHaveValue("42")
  })
})

describe("Field", () => {
  it("labels its control and swaps the hint for an error", () => {
    const { rerender } = render(
      <Field label="Name" hint="Shown in lists">
        <TextInput />
      </Field>
    )
    const input = screen.getByLabelText("Name")
    expect(screen.getByText("Shown in lists")).toBeInTheDocument()
    expect(input).not.toHaveAttribute("aria-invalid")

    rerender(
      <Field label="Name" hint="Shown in lists" error="Required">
        <TextInput />
      </Field>
    )
    expect(screen.queryByText("Shown in lists")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText("Name")).toHaveClass("border-red-500")
  })
})

describe("Textarea", () => {
  it("is resizable both ways by default", () => {
    render(<Textarea aria-label="Notes" defaultValue="" />)
    expect(screen.getByLabelText("Notes")).toHaveClass("resize")
  })
})

const SORTS = [
  { value: "order", label: "Default order" },
  { value: "name", label: "Name (A–Z)" },
  { value: "rsi_14", label: "RSI (14)", group: "Momentum", description: "14-period RSI" },
  { value: "macd", label: "MACD Histogram", group: "Momentum" },
  { value: "close", label: "Close", group: "Price" },
]

describe("Select", () => {
  function Harness({ initial = "", onValue, options = SORTS }) {
    const [v, setV] = useState(initial)
    return (
      <Select
        value={v}
        onValueChange={(x) => {
          setV(x)
          onValue?.(x)
        }}
        options={options}
        placeholder="Pick one"
        aria-label="Sort"
      />
    )
  }

  it("shows the placeholder, opens a themed list, and changes value", async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const trigger = screen.getByRole("combobox", { name: "Sort" })
    expect(trigger).toHaveTextContent("Pick one")

    await userEvent.click(trigger)
    const list = await screen.findByRole("listbox")
    expect(list.closest("[data-radix-popper-content-wrapper]")).toBeInTheDocument()
    expect(screen.getByText("Momentum")).toBeInTheDocument()     // group heading
    expect(screen.getByText("14-period RSI")).toBeInTheDocument() // description

    await userEvent.click(screen.getByRole("option", { name: /MACD Histogram/ }))
    expect(onValue).toHaveBeenCalledWith("macd")
    expect(trigger).toHaveTextContent("MACD Histogram")
  })

  it("picks up invalid state from its Field", () => {
    render(
      <Field label="Variable" error="Required">
        <Select value="" onValueChange={() => {}} options={SORTS} />
      </Field>
    )
    expect(screen.getByRole("combobox", { name: "Variable" })).toHaveAttribute("aria-invalid", "true")
  })
})

const TICKERS = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "AMD", name: "Advanced Micro Devices, Inc." },
  { symbol: "NVDA", name: "NVIDIA Corporation" },
]

describe("Combobox", () => {
  function Harness({ onValue, allowNew = false }) {
    const [v, setV] = useState("")
    return (
      <div className="w-32" data-testid="wrapper">
        <Combobox
          value={v}
          onChange={(x) => {
            setV(x)
            onValue?.(x)
          }}
          options={TICKERS}
          allowNew={allowNew}
          aria-label="Ticker"
        />
      </div>
    )
  }

  it("renders its list in a portal (unclippable) and filters as you type", async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole("combobox", { name: "Ticker" }), "nv")
    const list = await screen.findByRole("listbox")
    expect(screen.getByTestId("wrapper")).not.toContainElement(list)
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByRole("option")).toHaveTextContent("NVIDIA Corporation")
  })

  it("picks an option with the mouse or Enter", async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const input = screen.getByRole("combobox", { name: "Ticker" })
    await userEvent.type(input, "am")
    fireEvent.mouseDown(await screen.findByRole("option", { name: /AMD/ }))
    expect(onValue).toHaveBeenLastCalledWith("AMD")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())

    await userEvent.clear(input)
    await userEvent.type(input, "aa{Enter}")
    expect(onValue).toHaveBeenLastCalledWith("AAPL")
  })

  it("Escape closes only the list, not an enclosing dialog", async () => {
    render(
      <DialogPrimitive.Root open>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content aria-describedby={undefined}>
            <DialogPrimitive.Title>Dialog</DialogPrimitive.Title>
            <Harness />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    )
    await userEvent.type(screen.getByRole("combobox", { name: "Ticker" }), "a")
    await screen.findByRole("listbox")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("offers to create an unmatched value when allowNew", async () => {
    render(<Harness allowNew />)
    await userEvent.type(screen.getByRole("combobox", { name: "Ticker" }), "Tech")
    expect(await screen.findByText(/Create/)).toHaveTextContent("Create “Tech”")
  })
})

describe("validate", () => {
  it("returns short hints", () => {
    expect(required("")).toBe("Required")
    expect(required("x")).toBeNull()
    expect(numberError(null, { required: true })).toBe("Required")
    expect(numberError(1.5, { integer: true })).toBe("Whole number")
    expect(numberError(0, { min: 1 })).toBe("Min 1")
    expect(numberError(31, { max: 30 })).toBe("Max 30")
    expect(numberError(1.234, { maxDecimals: 2 })).toBe("Max 2 decimals")
    expect(numberError(5, { min: 1, max: 10, integer: true })).toBeNull()
    expect(decimalsOf(0.25)).toBe(2)
    expect(decimalsOf(1e-7)).toBe(7)
    expect(firstError(null, "A", "B")).toBe("A")
  })
})
