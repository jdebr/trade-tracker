/**
 * Lightweight Charts wrapper.
 *
 * Renders a candlestick or line chart with optional BB and EMA overlays.
 * The chart fills its container and auto-resizes via ResizeObserver.
 *
 * Props:
 *   bars        – array of { date, open, high, low, close, volume }
 *   overlays    – array of { date, bb_upper, bb_middle, bb_lower, ema_8, ema_21, ema_50 }
 *   chartType   – "candlestick" | "line"
 *   showBB      – bool
 *   showEMAs    – bool
 *   markers     – optional [{ time, position, shape, color, text? }] on the main
 *                 series (e.g. candlestick patterns); sorted oldest → newest
 *   interactive – false for a static preview (no scroll/zoom), default true
 */

import { useEffect, useRef, useState } from "react"
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  createSeriesMarkers,
} from "lightweight-charts"

const COLOURS = {
  bb_upper:  "#6366f1",
  bb_middle: "#a78bfa",
  bb_lower:  "#6366f1",
  ema_8:     "#f59e0b",
  ema_21:    "#10b981",
  ema_50:    "#3b82f6",
}

function toTime(dateStr) {
  // lightweight-charts expects "YYYY-MM-DD" strings or Unix timestamps
  return dateStr
}

export default function Chart({
  bars = [], overlays = [], chartType = "candlestick", showBB = true, showEMAs = true,
  markers, interactive = true,
}) {
  const containerRef = useRef(null)
  const chartRef     = useRef(null)
  const seriesRef    = useRef(null)
  const markersRef   = useRef(null)
  const overlayRefs  = useRef([])
  const [chartKey,   setChartKey] = useState(0)

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: interactive,
      handleScale: interactive,
    })

    chartRef.current = chart
    setChartKey((k) => k + 1)

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      chart.applyOptions({ width, height })
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current  = null
      seriesRef.current = null
      markersRef.current = null
      overlayRefs.current = []
    }
    // Created once; `interactive` is fixed for a chart's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recreate main series when chartType changes
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove existing main series
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current)
    }
    markersRef.current = null   // markers belong to the series being replaced

    const series =
      chartType === "candlestick"
        ? chart.addSeries(CandlestickSeries, {
            upColor:          "#10b981",
            downColor:        "#ef4444",
            borderUpColor:    "#10b981",
            borderDownColor:  "#ef4444",
            wickUpColor:      "#10b981",
            wickDownColor:    "#ef4444",
          })
        : chart.addSeries(LineSeries, {
            color:     "#3b82f6",
            lineWidth: 2,
          })

    seriesRef.current = series
  }, [chartType])

  // Update main series data when bars change
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !bars.length) return

    const data =
      chartType === "candlestick"
        ? bars.map((b) => ({ time: toTime(b.date), open: b.open, high: b.high, low: b.low, close: b.close }))
        : bars.map((b) => ({ time: toTime(b.date), value: b.close }))

    series.setData(data)
    chartRef.current?.timeScale().fitContent()
  }, [bars, chartType])

  // Markers on the main series (only when the caller passes them)
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !markers) return
    if (!markersRef.current) markersRef.current = createSeriesMarkers(series, [])
    markersRef.current.setMarkers(markers)
  }, [markers, bars, chartType])

  // Rebuild overlay series when overlays or visibility flags change
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove all existing overlay series
    overlayRefs.current.forEach((s) => chart.removeSeries(s))
    overlayRefs.current = []

    if (!overlays.length) return

    const toLineData = (key) =>
      overlays
        .filter((o) => o[key] != null)
        .map((o) => ({ time: toTime(o.date), value: Number(o[key]) }))

    const newSeries = []

    if (showBB) {
      for (const key of ["bb_upper", "bb_middle", "bb_lower"]) {
        const s = chart.addSeries(LineSeries, {
          color:            COLOURS[key],
          lineWidth:        2,
          lineStyle:        key === "bb_middle" ? 1 : 0, // dashed middle
          priceLineVisible: false,
          lastValueVisible: false,
        })
        s.setData(toLineData(key))
        newSeries.push(s)
      }
    }

    if (showEMAs) {
      for (const key of ["ema_8", "ema_21", "ema_50"]) {
        const s = chart.addSeries(LineSeries, {
          color:            COLOURS[key],
          lineWidth:        1.5,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        s.setData(toLineData(key))
        newSeries.push(s)
      }
    }

    overlayRefs.current = newSeries
    if (newSeries.length > 0) {
      chart.timeScale().fitContent()
    }
  }, [overlays, showBB, showEMAs, chartKey])

  return <div ref={containerRef} className="w-full h-full" data-testid="chart-container" />
}
