# Candlestick Patterns Smoke Test (M20)

A manual pass over candlestick patterns and the bulk-read fix, on the live app. Each check lists what to do, what **✅ Pass** looks like, and what counts as **❌ Fail**. Note any ❌ with its number.

**Before you start:**
1. Migration 004 is applied (done 2026-09-27).
2. The deploy is live: hard-refresh the app.
3. **Screener → Recompute Indicators**, and wait for it to finish (a few minutes). This fills patterns in for the whole universe. Until it runs, every ticker's patterns are "not computed".

---

## Part A — Watchlist

### A1. Patterns column
**Steps:** Open the Watchlist.
**✅ Pass:** A **Patterns** column sits after **Score**. Most rows show `—`; some show one or more small chips coloured green (bullish), red (bearish) or grey (indecision). No chip ends in "(bullish)"/"(bearish)"; the colour carries direction.
**❌ Fail:** No column, an error, or every row blank *after* the recompute (some tickers should have a doji or spinning top on most days).

### A2. Chip tooltips
**Steps:** Hover a chip. If a row shows **+N**, hover that too. Hover the **Patterns** header.
**✅ Pass:** The chip explains the pattern (name, direction, one-line meaning). **+N** lists the hidden ones. The header explains the colours.
**❌ Fail:** Empty or missing tooltips.

### A3. Mobile
**Steps:** Narrow the window to phone width.
**✅ Pass:** Each card has a **Patterns** line; chips wrap without overflowing the card.
**❌ Fail:** Chips overflow or overlap.

---

## Part B — Signal builder

### B1. Two candlestick groups
**Steps:** Signals → **New signal** → **Build expression**. Open the variable picker.
**✅ Pass:** Two groups, **CANDLESTICKS · LATEST BAR** and **CANDLESTICKS · LAST 5 BARS**, each with 20 entries (e.g. *Hammer*, *Engulfing (bullish)*, *Hammer (last 5 bars)*). Picking one offers only **is true / is false**.
**❌ Fail:** Groups missing, or numeric operators offered for a pattern.

### B2. A pattern rule previews and saves
**Steps:** Build *Engulfing (bullish) (last 5 bars)* **is true**. Check **Preview on \<symbol\>** and **Preview across universe**. Save it as "Bullish engulfing this week".
**✅ Pass:** The rule is valid. The universe preview reports a plausible handful of matches (not 0 of N after a recompute, not all N). Saving works.
**❌ Fail:** Validation error, a crash, or all/none of the universe matching.

### B3. "is false" doesn't fire on missing data
**Steps:** Preview *Hammer* **is false** on a ticker that shows **—** in the Watchlist Score column (no data), if you have one. Otherwise skip.
**✅ Pass:** *Doesn't fire*.
**❌ Fail:** *Fires* on a ticker with no data.

---

## Part C — Screener (the bulk-read fix)

### C1. Volume Expansion is sane
**Steps:** **Screen Tickers**, then look at how many results show **Volume Expansion**.
**✅ Pass:** A minority of tickers, a number that plausibly changes week to week. (Before the fix, the "20-day" average was really ~3 days, so this was close to a coin flip.)
**❌ Fail:** The run errors, or results are empty when they weren't before.

### C2. Pattern signal scores
**Steps:** With the B2 signal enabled, **Screen Tickers** again.
**✅ Pass:** Tickers that matched in B2's universe preview gain that signal's weight; the Score header tooltip lists it.
**❌ Fail:** The new signal never fires in a run even though the preview matched.

---

**Clean-up:** disable or remove the B2 signal if you don't want it scoring.
