import { useState, useMemo, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import { subMonths, subYears, parseISO, isAfter } from "date-fns"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import Chart from "@/components/Chart"

// ---------------------------------------------------------------------------
// Zoom ranges
// ---------------------------------------------------------------------------
const ZOOM_OPTIONS = [
  { label: "1M",  months: 1  },
  { label: "3M",  months: 3  },
  { label: "6M",  months: 6  },
  { label: "1Y",  months: 12 },
  { label: "All", months: null },
]

function filterByZoom(bars, months) {
  if (!months) return bars
  const cutoff = subMonths(new Date(), months)
  return bars.filter((b) => isAfter(parseISO(b.date), cutoff))
}

// ---------------------------------------------------------------------------
// Controls bar
// ---------------------------------------------------------------------------
function Controls({ chartType, onChartType, zoom, onZoom, symbol }) {
  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {/* Chart type toggle */}
      <div className="flex rounded-md border border-border overflow-hidden">
        {["candlestick", "line"].map((type) => (
          <button
            key={type}
            onClick={() => onChartType(type)}
            aria-pressed={chartType === type}
            className={cn(
              "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              chartType === type
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Zoom buttons */}
      <div className="flex rounded-md border border-border overflow-hidden">
        {ZOOM_OPTIONS.map(({ label, months }) => (
          <button
            key={label}
            onClick={() => onZoom(months)}
            aria-pressed={zoom === months}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors",
              zoom === months
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TradingView link */}
      <a
        href={tvUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${symbol} on TradingView`}
        className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
      >
        TradingView
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overlay toggles
// ---------------------------------------------------------------------------
function OverlayToggles({ showBB, onBB, showEMAs, onEMAs }) {
  return (
    <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
      <span>Overlays:</span>
      {[
        { label: "BB Bands", active: showBB,   toggle: onBB   },
        { label: "EMAs",     active: showEMAs, toggle: onEMAs },
      ].map(({ label, active, toggle }) => (
        <button
          key={label}
          onClick={toggle}
          aria-pressed={active}
          className={cn(
            "px-2 py-0.5 rounded border transition-colors",
            active
              ? "border-primary text-primary"
              : "border-border text-muted-foreground hover:border-muted-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Symbol picker
// ---------------------------------------------------------------------------
function SymbolPicker({ symbols, selected, onSelect }) {
  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {symbols.map((sym) => (
        <button
          key={sym}
          onClick={() => onSelect(sym)}
          aria-pressed={selected === sym}
          className={cn(
            "px-3 py-1 rounded-full text-sm font-medium border transition-colors",
            selected === sym
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:border-primary/50"
          )}
        >
          {sym}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ChartPage() {
  const [symbol,    setSymbol]    = useState(null)
  const [chartType, setChartType] = useState("candlestick")
  const [zoom,      setZoom]      = useState(6)     // months; null = All
  const [showBB,    setShowBB]    = useState(true)
  const [showEMAs,  setShowEMAs]  = useState(true)

  // Watchlist for symbol picker
  const { data: watchlist = [], isLoading: loadingWL } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/watchlist"),
  })

  // Auto-select first symbol once watchlist loads
  useEffect(() => {
    if (!symbol && watchlist.length > 0) setSymbol(watchlist[0].symbol)
  }, [watchlist, symbol])

  const activeSymbol = symbol ?? watchlist[0]?.symbol ?? null

  // OHLCV bars
  const { data: rawBars = [], isLoading: loadingBars, isError: barsError } = useQuery({
    queryKey: ["ohlcv-bars", activeSymbol],
    queryFn: () => api.get(`/ohlcv/bars?symbol=${activeSymbol}&limit=504`),
    enabled: !!activeSymbol,
  })

  // Indicator history for overlays
  const { data: overlays = [] } = useQuery({
    queryKey: ["indicator-history", activeSymbol],
    queryFn: () => api.get(`/indicators/history?symbol=${activeSymbol}&limit=504`),
    enabled: !!activeSymbol,
  })

  const bars = useMemo(() => filterByZoom(rawBars, zoom), [rawBars, zoom])

  const watchlistSymbols = watchlist.map((e) => e.symbol)

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Chart</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Candlestick chart with indicator overlays
        </p>
      </div>

      {/* Symbol picker */}
      {watchlistSymbols.length === 0 && !loadingWL && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
          Add tickers to your watchlist to view charts.
        </div>
      )}

      {watchlistSymbols.length > 0 && (
        <>
          <SymbolPicker
            symbols={watchlistSymbols}
            selected={activeSymbol}
            onSelect={setSymbol}
          />

          {activeSymbol && (
            <>
              <Controls
                chartType={chartType}
                onChartType={setChartType}
                zoom={zoom}
                onZoom={setZoom}
                symbol={activeSymbol}
              />
              <OverlayToggles
                showBB={showBB}   onBB={() => setShowBB((v) => !v)}
                showEMAs={showEMAs} onEMAs={() => setShowEMAs((v) => !v)}
              />
            </>
          )}

          {/* Chart area */}
          {loadingBars && (
            <Skeleton className="w-full h-[420px] rounded-lg" aria-label="Loading chart" />
          )}

          {!loadingBars && barsError && (
            <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              No chart data for <strong>{activeSymbol}</strong>.{" "}
              Use <strong>Run Scan Now</strong> on the Scanner page to populate data.
            </div>
          )}

          {!loadingBars && !barsError && bars.length === 0 && (
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
              No bars found for the selected range.
            </div>
          )}

          {!loadingBars && !barsError && bars.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden" style={{ height: "420px" }}>
              <Chart
                bars={bars}
                overlays={overlays}
                chartType={chartType}
                showBB={showBB}
                showEMAs={showEMAs}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
