import { useMemo, useState } from "react"
import TickerDetailsSheet from "@/components/TickerDetailsSheet"
import { TickerDetailsContext } from "@/lib/tickerDetails"

/** Owns the single app-wide ticker details sheet; `SymbolLink`s open it. */
export default function TickerDetailsProvider({ children }) {
  // The symbol outlives `open` so the sheet keeps its content while closing.
  const [symbol, setSymbol] = useState(null)
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({
    open: (s) => { setSymbol(s); setOpen(true) },
  }), [])
  return (
    <TickerDetailsContext.Provider value={value}>
      {children}
      <TickerDetailsSheet symbol={symbol} open={open} onOpenChange={setOpen} />
    </TickerDetailsContext.Provider>
  )
}
