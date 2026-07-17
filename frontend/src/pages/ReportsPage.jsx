import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { TrendingUp, Info } from "lucide-react"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/Tooltip"
import { EXIT_REASONS } from "@/lib/exitMethods"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const money = (n) =>
  n == null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(Number(n)).toFixed(2)}`

const rVal = (n) =>
  n == null ? "—" : `${Number(n) >= 0 ? "+" : ""}${Number(n).toFixed(2)}R`

const pctVal = (n) => (n == null ? "—" : `${Number(n).toFixed(0)}%`)

function pnlColour(n) {
  if (n == null) return "text-muted-foreground"
  return Number(n) >= 0
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400"
}

const SIGNAL_LABELS = {
  bb_squeeze:       "BB Squeeze",
  rsi_in_range:     "RSI in Range",
  above_ema50:      "Above EMA 50",
  volume_expansion: "Volume Expansion",
}

// Explanations of the less-obvious metrics, shown as tooltips so the numbers
// aren't just decoration.
const METRIC_TIPS = {
  expectancy:
    "What you can expect to make per trade on average: (win rate × average win) − (loss rate × average loss). A strategy can win most of its trades and still lose money — this is the number that catches that.",
  profit_factor:
    "Gross profit ÷ gross loss. Above 1.0 means the winners outweigh the losers. Below 1.5 is generally considered fragile.",
  avg_r:
    "Average R-multiple. 1R is the amount risked on a trade, so +0.5R means each trade made half of what it risked on average.",
  max_drawdown_r:
    "The worst peak-to-trough decline of the cumulative R curve — the deepest hole the strategy dug before recovering.",
  win_rate: "Percentage of closed trades that made money.",
}

// ---------------------------------------------------------------------------
// Metric cards
// ---------------------------------------------------------------------------

function MetricCard({ label, value, sub, tip, colour }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {tip && (
          <Tooltip content={tip}>
            <Info size={11} className="text-muted-foreground/50 cursor-help shrink-0" />
          </Tooltip>
        )}
      </div>
      <div className={cn("text-xl font-semibold tabular-nums", colour)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Equity curve — cumulative R, drawn as a simple inline SVG.
// Reaching for a chart library for a single polyline would be overkill.
// ---------------------------------------------------------------------------

function EquityCurve({ curve }) {
  if (curve.length < 2) return null

  const W = 600, H = 140, PAD = 4
  const values = curve.map((p) => p.cumulative_r)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1

  const x = (i) => PAD + (i / (curve.length - 1)) * (W - PAD * 2)
  const y = (v) => H - PAD - ((v - min) / range) * (H - PAD * 2)

  const points = curve.map((p, i) => `${x(i)},${y(p.cumulative_r)}`).join(" ")
  const zeroY = y(0)
  const final = values[values.length - 1]
  const positive = final >= 0

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Cumulative R</h2>
        <span className={cn("text-sm font-semibold tabular-nums", pnlColour(final))}>
          {rVal(final)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Equity curve: ${rVal(final)} cumulative over ${curve.length} trades`}
      >
        <line
          x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY}
          className="stroke-border" strokeWidth="1" strokeDasharray="3 3"
        />
        <polyline
          points={points}
          fill="none"
          strokeWidth="2"
          className={positive ? "stroke-green-500" : "stroke-red-500"}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-[11px] text-muted-foreground mt-2">
        {curve.length} closed trades, oldest to newest.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Signal attribution — the reason this page exists
// ---------------------------------------------------------------------------

function SignalTable({ signals }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-4 pb-3">
        <h2 className="text-sm font-semibold">Which signals are working</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Average R when each signal fired at entry, against when it didn't.
          A positive edge means the signal is earning its place.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border bg-muted/50 text-muted-foreground text-xs">
              <th className="px-4 py-2 text-left font-medium">Signal</th>
              <th className="px-4 py-2 text-right font-medium">With</th>
              <th className="px-4 py-2 text-right font-medium">Without</th>
              <th className="px-4 py-2 text-right font-medium">
                <Tooltip content="Difference in average R between trades with the signal and trades without it.">
                  <span className="cursor-help">Edge</span>
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.signal} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{SIGNAL_LABELS[s.signal] ?? s.signal}</span>
                    {s.sample_is_thin && (
                      <Tooltip content="Too few trades on one side to draw a conclusion. Keep trading and check back.">
                        <Badge variant="outline" className="cursor-help text-[10px]">thin</Badge>
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className={pnlColour(s.with_signal.avg_r)}>{rVal(s.with_signal.avg_r)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {s.with_signal.trades} trades · {pctVal(s.with_signal.win_rate)} win
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className={pnlColour(s.without_signal.avg_r)}>{rVal(s.without_signal.avg_r)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {s.without_signal.trades} trades · {pctVal(s.without_signal.win_rate)} win
                  </span>
                </td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", pnlColour(s.edge_r))}>
                  {s.edge_r == null ? "—" : rVal(s.edge_r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exit reason breakdown
// ---------------------------------------------------------------------------

function ExitReasonTable({ rows }) {
  if (rows.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-4 pb-3">
        <h2 className="text-sm font-semibold">How trades ended</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          If manual exits keep underperforming the planned ones, the plan is working
          and the improvisation isn't.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border bg-muted/50 text-muted-foreground text-xs">
              <th className="px-4 py-2 text-left font-medium">Reason</th>
              <th className="px-4 py-2 text-right font-medium">Trades</th>
              <th className="px-4 py-2 text-right font-medium">Win rate</th>
              <th className="px-4 py-2 text-right font-medium">Avg R</th>
              <th className="px-4 py-2 text-right font-medium">Total P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.exit_reason} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">{EXIT_REASONS[r.exit_reason] ?? r.exit_reason}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.trades}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{pctVal(r.win_rate)}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", pnlColour(r.avg_r))}>
                  {rVal(r.avg_r)}
                </td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", pnlColour(r.total_pnl))}>
                  {money(r.total_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// Simulated and real are kept strictly separate — blending a paper trade you
// might never have taken with real fills describes no strategy anyone ran.
const MODES = [
  { key: "sim",  label: "Simulated", param: "is_simulated=true"  },
  { key: "live", label: "Real",      param: "is_simulated=false" },
]

export default function ReportsPage() {
  const [mode, setMode] = useState("sim")
  const param = MODES.find((m) => m.key === mode).param

  const { data: perfData, isLoading } = useQuery({
    queryKey: ["reports-performance", mode],
    queryFn: () => api.get(`/reports/performance?${param}`),
  })

  const { data: signalData } = useQuery({
    queryKey: ["reports-by-signal", mode],
    queryFn: () => api.get(`/reports/by-signal?${param}`),
  })

  const { data: curveData } = useQuery({
    queryKey: ["reports-equity-curve", mode],
    queryFn: () => api.get(`/reports/equity-curve?${param}`),
  })

  const perf = perfData?.performance
  const hasTrades = perf && perf.total_trades > 0

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            How your closed trades actually turned out
          </p>
        </div>

        <div role="tablist" aria-label="Result set" className="flex gap-1.5">
          {MODES.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading reports">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && !hasTrades && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/30 py-16 gap-3">
          <TrendingUp size={32} className="text-muted-foreground/50" aria-hidden="true" />
          <p className="text-muted-foreground text-sm text-center max-w-sm">
            No closed {mode === "live" ? "real" : "simulated"} trades yet.
            Close a position and its results will show up here.
          </p>
        </div>
      )}

      {!isLoading && hasTrades && (
        <div className="space-y-4">
          {perf.sample_is_thin && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              Only {perf.total_trades} closed trade{perf.total_trades !== 1 ? "s" : ""}. These
              numbers are indicative at best — a strategy's edge doesn't become
              measurable until you have a few dozen.
            </div>
          )}

          {/* Headline metrics */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total P&L"
              value={money(perf.total_pnl)}
              sub={`${perf.total_trades} closed trades`}
              colour={pnlColour(perf.total_pnl)}
            />
            <MetricCard
              label="Win rate"
              value={pctVal(perf.win_rate)}
              sub={`${perf.wins}W / ${perf.losses}L`}
              tip={METRIC_TIPS.win_rate}
            />
            <MetricCard
              label="Expectancy"
              value={money(perf.expectancy)}
              sub="per trade"
              tip={METRIC_TIPS.expectancy}
              colour={pnlColour(perf.expectancy)}
            />
            <MetricCard
              label="Average R"
              value={rVal(perf.avg_r)}
              sub={`${rVal(perf.total_r)} total`}
              tip={METRIC_TIPS.avg_r}
              colour={pnlColour(perf.avg_r)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Profit factor"
              value={perf.profit_factor == null ? "—" : perf.profit_factor.toFixed(2)}
              sub="gross profit ÷ gross loss"
              tip={METRIC_TIPS.profit_factor}
            />
            <MetricCard
              label="Avg win / loss"
              value={`${money(perf.avg_win)} / ${money(perf.avg_loss)}`}
            />
            <MetricCard
              label="Max drawdown"
              value={perf.max_drawdown_r ? `−${perf.max_drawdown_r.toFixed(2)}R` : "—"}
              tip={METRIC_TIPS.max_drawdown_r}
            />
            <MetricCard
              label="Avg hold"
              value={perf.avg_hold_days != null ? `${perf.avg_hold_days} days` : "—"}
              sub={`longest streak: ${perf.max_consecutive_wins}W / ${perf.max_consecutive_losses}L`}
            />
          </div>

          {curveData?.curve?.length > 1 && <EquityCurve curve={curveData.curve} />}

          {signalData?.signals && <SignalTable signals={signalData.signals} />}

          {perfData?.by_exit_reason && <ExitReasonTable rows={perfData.by_exit_reason} />}
        </div>
      )}
    </div>
  )
}
