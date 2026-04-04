/**
 * Central source of truth for all indicator definitions.
 * Used for tooltips, table headers, and future config UI.
 */
export const INDICATORS = {
  rsi_14: {
    label: "RSI",
    fullName: "Relative Strength Index (14)",
    description: "Momentum oscillator measuring speed of price change. 0–100 scale.",
    interpretation: "< 30: oversold (potential buy). > 70: overbought (potential sell). 35–65: neutral range.",
    params: { period: 14 },
  },
  macd_hist: {
    label: "MACD Hist",
    fullName: "MACD Histogram (12/26/9)",
    description: "Difference between MACD line and signal line.",
    interpretation: "Positive and growing: bullish momentum. Negative and falling: bearish momentum.",
    params: { fast: 12, slow: 26, signal: 9 },
  },
  bb_squeeze: {
    label: "BB Squeeze",
    fullName: "Bollinger Band Squeeze (20/2)",
    description: "Fires when band width is in the bottom 20th percentile of its trailing 252-day range.",
    interpretation: "True (filled dot): volatility contraction — often precedes a large move.",
    params: { period: 20, std: 2, squeeze_percentile: 20 },
  },
  ema_50: {
    label: "EMA 50",
    fullName: "Exponential Moving Average (50)",
    description: "50-day exponential moving average of closing price.",
    interpretation: "Price above EMA 50: bullish trend. Price below: bearish trend.",
    params: { period: 50 },
  },
  ema_21: {
    label: "EMA 21",
    fullName: "Exponential Moving Average (21)",
    description: "21-day exponential moving average of closing price.",
    interpretation: "Medium-term trend indicator. Used with EMA 8 for crossover signals.",
    params: { period: 21 },
  },
  ema_8: {
    label: "EMA 8",
    fullName: "Exponential Moving Average (8)",
    description: "8-day exponential moving average of closing price.",
    interpretation: "Short-term trend. Crossing above EMA 21: bullish. Crossing below: bearish.",
    params: { period: 8 },
  },
  atr_14: {
    label: "ATR",
    fullName: "Average True Range (14)",
    description: "14-day average of daily price range (high − low). Measures volatility.",
    interpretation: "Higher ATR: more volatile. Use for position sizing and stop placement.",
    params: { period: 14 },
  },
  bb_upper: {
    label: "BB Upper",
    fullName: "Bollinger Band Upper (20/2)",
    description: "Upper band: 20-day SMA + 2 standard deviations.",
    interpretation: "Price near or above upper band: potentially overbought or strong momentum.",
    params: { period: 20, std: 2 },
  },
  bb_middle: {
    label: "BB Middle",
    fullName: "Bollinger Band Middle (20)",
    description: "20-day simple moving average — the center of the Bollinger Bands.",
    interpretation: "Acts as dynamic support/resistance. Price tends to revert to this line.",
    params: { period: 20 },
  },
  bb_lower: {
    label: "BB Lower",
    fullName: "Bollinger Band Lower (20/2)",
    description: "Lower band: 20-day SMA − 2 standard deviations.",
    interpretation: "Price near or below lower band: potentially oversold or strong downtrend.",
    params: { period: 20, std: 2 },
  },
  obv: {
    label: "OBV",
    fullName: "On-Balance Volume",
    description: "Cumulative volume that adds volume on up days and subtracts on down days.",
    interpretation: "Rising OBV with rising price confirms uptrend. Divergence can signal reversal.",
    params: {},
  },
}
