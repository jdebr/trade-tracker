import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, Check, LineChart, Plus, ArrowUp, ArrowDown, Circle } from "lucide-react"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/Tooltip"
import { ScoreBadge } from "@/components/SignalScore"
import Chart from "@/components/Chart"
import { INDICATORS } from "@/lib/indicators"
import { groupPatternsByDate, patternMarkers } from "@/lib/tickerDetails"
import { cn } from "@/lib/utils"

const DIRECTION = {
  bullish: { Icon: ArrowUp,   className: "text-green-500", word: "Bullish" },
  bearish: { Icon: ArrowDown, className: "text-red-500",   word: "Bearish" },
  neutral: { Icon: Circle,    className: "text-muted-foreground", word: "Indecision" },
}

const INDICATOR_ROWS = [
  { key: "rsi_14",     label: "RSI (14)",   digits: 1 },
  { key: "macd_hist",  label: "MACD hist",  digits: 3 },
  { key: "bb_squeeze", label: "BB squeeze", bool: true },
  { key: "ema_8",      label: "EMA 8",      digits: 2 },
  { key: "ema_21",     label: "EMA 21",     digits: 2 },
  { key: "ema_50",     label: "EMA 50",     digits: 2 },
  { key: "atr_14",     label: "ATR (14)",   digits: 2 },
]

const money = (v) => (v == null ? "—" : `$${Number(v).toFixed(2)}`)
const num = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d))

function fmtDay(iso) {
  // Date-only strings parse as UTC; format in UTC so the day never shifts.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  })
}

/**
 * Slide-out details for one ticker: price, recent candlestick patterns (with a
 * marked mini chart), live signal score, indicator values, and the open
 * position if any. One request (`/tickers/{symbol}/details`), computed on
 * demand; nothing new is stored.
 */
export default function TickerDetailsSheet({ symbol, open, onOpenChange }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="sheet-overlay fixed inset-0 z-50 bg-black/40"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "sheet-content fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-xl sm:max-w-md"
          )}
        >
          {symbol && <SheetBody symbol={symbol} onNavigate={() => onOpenChange(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SheetBody({ symbol, onNavigate }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ticker-details", symbol],
    queryFn: () => api.get(`/tickers/${encodeURIComponent(symbol)}/details`),
    staleTime: 60 * 1000,
  })

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <DialogPrimitive.Title className="text-xl font-semibold tracking-wide">{symbol}</DialogPrimitive.Title>
          {data?.name && <div className="truncate text-sm text-muted-foreground">{data.name}</div>}
          {(data?.sector || data?.industry) && (
            <div className="truncate text-xs text-muted-foreground">
              {[data.sector, data.industry].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="flex items-start gap-3">
          {data?.last && <PriceBlock last={data.last} />}
          <DialogPrimitive.Close asChild>
            <button className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
              <X size={18} />
            </button>
          </DialogPrimitive.Close>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {isLoading && <LoadingBody />}
        {isError && (
          <div className="space-y-2 text-sm">
            <p className="text-destructive">Couldn't load details for {symbol}.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </div>
        )}
        {data && (
          <>
            <Actions data={data} onNavigate={onNavigate} />
            <RecentCandles data={data} />
            {data.position && <PositionSection position={data.position} onNavigate={onNavigate} />}
            <SignalsSection signals={data.signals} />
            <IndicatorsSection snapshot={data.snapshot} close={data.last?.close} />
          </>
        )}
      </div>
    </>
  )
}

function PriceBlock({ last }) {
  const up = (last.change ?? 0) >= 0
  return (
    <div className="text-right">
      <div className="text-lg font-semibold tabular-nums">{money(last.close)}</div>
      {last.change != null && (
        <div className={cn("text-xs tabular-nums", up ? "text-green-500" : "text-red-500")}>
          {up ? "+" : ""}{last.change.toFixed(2)} ({up ? "+" : ""}{last.change_pct.toFixed(2)}%)
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">close {fmtDay(last.date)}</div>
    </div>
  )
}

function Actions({ data, onNavigate }) {
  const queryClient = useQueryClient()
  const add = useMutation({
    mutationFn: () => api.post("/watchlist", { symbol: data.symbol, group_name: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] })
      queryClient.invalidateQueries({ queryKey: ["ticker-details", data.symbol] })
    },
  })
  return (
    <div className="flex flex-wrap items-center gap-2">
      {data.in_watchlist ? (
        <Badge variant="secondary">In watchlist</Badge>
      ) : (
        <Button size="sm" variant="outline" loading={add.isPending} onClick={() => add.mutate()}>
          <Plus size={14} /> Add to watchlist
        </Button>
      )}
      <Button size="sm" variant="outline" asChild>
        <Link to={`/chart?symbol=${encodeURIComponent(data.symbol)}`} onClick={onNavigate}>
          <LineChart size={14} /> Full chart
        </Link>
      </Button>
      {add.isError && <span className="text-xs text-destructive">Couldn't add: {add.error?.message}</span>}
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function RecentCandles({ data }) {
  const markers = useMemo(() => patternMarkers(data.patterns), [data.patterns])
  const groups = useMemo(() => groupPatternsByDate(data.patterns), [data.patterns])
  return (
    <Section title="Recent candles" hint={`patterns in the last ${data.pattern_days} sessions`}>
      {data.bars.length > 0 && (
        <div className="h-44 rounded-md border border-border" aria-label={`${data.symbol} candlestick chart with pattern markers`}>
          <Chart bars={data.bars} markers={markers} interactive={false} />
        </div>
      )}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No curated patterns formed in the last {data.pattern_days} sessions.</p>
      ) : (
        <ol className="space-y-3">
          {groups.map((g) => (
            <li key={g.date}>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{fmtDay(g.date)}</div>
              <ul className="space-y-1.5">
                {g.patterns.map((p) => <PatternRow key={p.name} p={p} />)}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

function PatternRow({ p }) {
  const d = DIRECTION[p.direction] ?? DIRECTION.neutral
  return (
    <li className="flex gap-2 text-sm">
      <d.Icon size={14} className={cn("mt-0.5 shrink-0", d.className)} aria-label={d.word} />
      <div>
        <span className="font-medium">{p.label}</span>
        <p className="text-xs text-muted-foreground">{p.meaning}</p>
      </div>
    </li>
  )
}

function SignalsSection({ signals }) {
  if (!signals) {
    return (
      <Section title="Signals">
        <p className="text-sm text-muted-foreground">No indicator data yet, so signals can't be scored.</p>
      </Section>
    )
  }
  return (
    <Section title="Signals" hint="current active signals, latest data">
      <div className="flex items-center gap-2">
        <ScoreBadge score={signals.score} max={signals.max} normalized={signals.normalized} />
        <span className="text-xs text-muted-foreground">{signals.score} of {signals.max} points</span>
      </div>
      {signals.rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active signals.</p>
      ) : (
        <ul className="space-y-1.5">
          {signals.rules.map((r) => (
            <li key={r.slug} className={cn("flex gap-2 text-sm", !r.fired && "text-muted-foreground")}>
              {r.fired
                ? <Check size={14} className="mt-0.5 shrink-0 text-green-500" aria-label="fired" />
                : <X size={14} className="mt-0.5 shrink-0" aria-label="didn't fire" />}
              <div className="min-w-0">
                <span className={cn(r.fired && "font-medium")}>{r.name}</span>
                <span className="ml-1 tabular-nums text-xs text-muted-foreground">×{r.weight}</span>
                {r.formatted && <div className="break-words font-mono text-[11px] text-muted-foreground">{r.formatted}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function IndicatorsSection({ snapshot, close }) {
  if (!snapshot) return null
  const vsEma = close != null && snapshot.ema_50 ? ((close - snapshot.ema_50) / snapshot.ema_50) * 100 : null
  return (
    <Section title="Indicators" hint={`as of ${fmtDay(snapshot.date)}`}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {INDICATOR_ROWS.map(({ key, label, digits, bool }) => {
          const meta = INDICATORS[key]
          const term = meta
            ? (
              <Tooltip content={<div className="max-w-64"><div className="font-medium">{meta.fullName}</div><div className="text-zinc-400">{meta.interpretation}</div></div>}>
                <dt className="cursor-help text-muted-foreground">{label}</dt>
              </Tooltip>
            )
            : <dt className="text-muted-foreground">{label}</dt>
          return (
            <div key={key} className="flex items-center justify-between gap-2">
              {term}
              <dd className="tabular-nums">{bool ? (snapshot[key] ? "Yes" : "No") : num(snapshot[key], digits)}</dd>
            </div>
          )
        })}
        {vsEma != null && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">vs EMA 50</dt>
            <dd className={cn("tabular-nums", vsEma >= 0 ? "text-green-500" : "text-red-500")}>
              {vsEma >= 0 ? "+" : ""}{vsEma.toFixed(1)}%
            </dd>
          </div>
        )}
      </dl>
    </Section>
  )
}

function PositionSection({ position: p, onNavigate }) {
  return (
    <Section title="Open position" hint={p.is_simulated ? "simulated" : "real"}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <Row label="Entered">{fmtDay(p.entry_date)}</Row>
        <Row label="Shares">{Number(p.shares)}</Row>
        <Row label="Entry">{money(p.entry_price)}</Row>
        <Row label="Stop">{money(p.stop_price)}</Row>
        <Row label="Target">{money(p.target_price)}</Row>
        <Row label="Now">
          <span className={cn(p.r_now == null ? "" : p.r_now >= 0 ? "text-green-500" : "text-red-500")}>
            {p.r_now == null ? "—" : `${p.r_now >= 0 ? "+" : ""}${p.r_now.toFixed(2)}R`}
          </span>
        </Row>
      </dl>
      <Link to="/positions" onClick={onNavigate} className="text-xs text-primary underline-offset-4 hover:underline">
        View in Positions
      </Link>
    </Section>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}

function LoadingBody() {
  return (
    <div className="space-y-4" aria-label="Loading details">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}
