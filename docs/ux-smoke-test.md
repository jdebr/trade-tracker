# UX Foundations Smoke Test (M19.5)

A manual pass over the shared form layer and the "never block" interaction rules, on the live app. Each check lists what to do, what **✅ Pass** looks like, and what counts as **❌ Fail**. Note any ❌ with its number.

**Before you start:** hard-refresh the app so you have the latest frontend. Have at least a couple of watchlist tickers and a few unacknowledged alerts, if possible.

---

## Part A — Number inputs only take valid keystrokes

### A1. Whole-number field (signal weight)
**Steps:** Signals → Edit any signal. In **Weight**, try typing `1.5`, `-2`, `abc`, `2e3`.
**✅ Pass:** Only digits land: `1.5` becomes `15`, `-2` becomes `2`, and letters and `e` never appear.
**❌ Fail:** Any `.`, `-`, letter or `e` shows up in the box.

### A2. Decimal field (Settings → Risk per trade)
**Steps:** Type `1.2345` into **Risk per trade (%)**. Then select all and paste `1,5` or ` 2.5 `.
**✅ Pass:** Typing stops at two decimals (`1.23`). Pasting strips the comma and spaces (`15` or `2.5`), and pasting junk like `abc` changes nothing.
**❌ Fail:** More decimals than allowed, or pasted junk lands in the field.

### A3. Themed steppers, arrows, and wheel
**Steps:** On any number field, click the small ▲/▼ buttons, then hold ▲ for a second. Focus the field and press ↑/↓. Then hover the field and scroll the mouse wheel.
**✅ Pass:** The ▲/▼ buttons match the app's dark styling (not the browser's grey spinner). Holding ▲ repeats smoothly with no float noise (e.g. `0.1 → 0.2 → 0.3`, never `0.30000000000000004`). The arrow keys step. The **wheel does nothing** to the value.
**❌ Fail:** Browser-native spinner arrows, no repeat, odd decimals, or the wheel changes the value.

---

## Part B — Red when invalid, with a short hint

### B1. Out of range shows red and doesn't block typing
**Steps:** Signals → Edit a signal → Weight: clear it, type `0`, then `3`.
**✅ Pass:** At `0` the box turns red with **"Min 1"** right under it and **Save changes** is disabled. At `3` the red and the hint disappear and Save is enabled again.
**❌ Fail:** No red, a long or missing message, or Save allowed at `0`.

### B2. Required appears after leaving the field
**Steps:** Signals → New signal. Click into **Name**, then click elsewhere without typing.
**✅ Pass:** The dialog opens with nothing red. After you leave the empty Name field it turns red with **"Required"**.
**❌ Fail:** Red on first open, or no hint after leaving it empty.

### B3. Not-in-list combobox
**Steps:** Watchlist → type `AA` in the symbol box (suggestions show), then `AAZZZ`. Then clear it, type `AA`, and click away.
**✅ Pass:** While suggestions still match, the box stays neutral. `AAZZZ` (no matches) turns red with **"Not in universe"**. Leaving on a partial non-match also shows red. **Add** stays disabled for a non-match.
**❌ Fail:** Red while you're mid-typing a valid ticker, or no red for a non-match.

### B4. Settings hard limits
**Steps:** Settings → **Max position size (%)** → type `150`.
**✅ Pass:** Red with **"Max 100"**, and the Saving… note does **not** appear for that change.
**❌ Fail:** No red, or it tries to save `150`.

---

## Part C — Dropdowns: themed, roomy, never clipped

### C1. Themed list that grows past the trigger
**Steps:** Signals → New signal → **Build expression**. The variable list opens automatically.
**✅ Pass:** The list uses the app's dark colours and has group headings (momentum, price, …). It's at least as wide as the pill and wider when a label needs it, so no label is cut off. A check mark shows the current choice.
**❌ Fail:** Browser-native white list, truncated labels, or a list narrower than its content.

### C2. Not clipped inside a dialog
**Steps:** In the signal dialog, open the **Preview on** symbol box and type `A`. Scroll the dialog if you like.
**✅ Pass:** The suggestion list floats over the dialog edge instead of being cut off or making the dialog scroll. Long company names are fully readable.
**❌ Fail:** The list is clipped by the dialog or squeezed to the input's width.

### C3. Esc closes only the list
**Steps:** With the symbol suggestions open (C2), press **Esc** once, then again.
**✅ Pass:** The first Esc closes only the list. The dialog stays open, and in the expression editor your work is untouched.
**❌ Fail:** The first Esc closes the dialog or discards edits.

### C4. Descriptions in method pickers
**Steps:** Watchlist → **Plan a trade** on any row → open **Stop method**.
**✅ Pass:** Each option shows its label with a one-line description under it, all fully visible.
**❌ Fail:** Descriptions cut off, or a plain native list.

### C5. Keyboard
**Steps:** Tab to any dropdown, press **Enter** or **Space**, use ↑/↓ and type a letter to jump, then press **Enter**.
**✅ Pass:** It opens, arrows and typeahead move the highlight, Enter picks, and focus returns to the dropdown.
**❌ Fail:** Can't operate it without a mouse.

---

## Part D — Text areas

### D1. Resizable both ways
**Steps:** Signals → New signal → Build expression → **JSON**. Drag the textarea's corner.
**✅ Pass:** It resizes both wider/narrower and taller/shorter (within the dialog).
**❌ Fail:** Only vertical resizing, or none.

### D2. Notes grow with content
**Steps:** Plan a trade → type several lines into **Notes**.
**✅ Pass:** The box grows taller as you type, so no inner scrollbar appears. It can still be dragged wider or narrower.
**❌ Fail:** Fixed height with a scrollbar.

---

## Part E — Nothing blocks while something saves

### E1. Settings autosave
**Steps:** Settings → change **Account size**, then immediately change **Risk per trade** while *Saving…* is showing. Reload the page.
**✅ Pass:** There's no Save button. *Saving…* then *✓ Saved* appears by the title, and neither field ever greys out. After reload **both** changes stuck.
**❌ Fail:** A field freezes while saving, or the second change is lost.

### E2. Autosave failure + retry (optional)
**Steps:** DevTools → Network → **Offline**. Change a setting and wait. Then set the network back **Online**, change another setting, and click **Retry**.
**✅ Pass:** You see **"⚠ Couldn't save · Retry"**. After Retry both changes save, and a reload shows both.
**❌ Fail:** A silent failure, or one of the changes is lost.

### E3. Signal toggles are independent
**Steps:** Signals → quickly toggle two *different* signals one after the other.
**✅ Pass:** Both flip immediately. A tiny spinner may show in a knob while its request is in flight, but the other toggle is never greyed out or blocked.
**❌ Fail:** Toggling one disables the rest.
**Then:** Put them back the way they were.

### E4. Alerts acknowledge instantly
**Steps:** Alerts → click the ✓ on two alerts in quick succession.
**✅ Pass:** Each card disappears the moment you click it, and the second click is never blocked by the first.
**❌ Fail:** Buttons grey out, or cards linger until the server answers.

### E5. Watchlist adds queue up
**Steps:** Watchlist → add one ticker, then immediately type and add a second.
**✅ Pass:** The form clears at once after each **Add**. A small **"Adding XYZ…"** chip shows per ticker while it saves, and both appear in the table.
**❌ Fail:** Add is greyed out until the first finishes, or a ticker is lost.
**Then:** Remove the test tickers if you don't want them.

### E6. Screener per-row add + job buttons
**Steps:** Screener → click **+** (add to watchlist) on two rows quickly. Then click **Screen Tickers** and click it again while it runs.
**✅ Pass:** Each row's + works independently. While screening, the button shows a spinner and a second click does nothing (no second job), but it isn't greyed out.
**❌ Fail:** One row's add blocks another, or a second click starts a second job.

### E7. Dialog commit locks only briefly
**Steps:** Create a throwaway signal (or edit one) and click **Create signal** / **Save changes**.
**✅ Pass:** The fields lock and the button shows a spinner for the moment the save takes, then the dialog closes. This is the one intentional lock.
**❌ Fail:** The dialog hangs, or you can edit and resubmit mid-save.
**Then:** Remove the throwaway signal.

---

## Part F — Visual consistency

### F1. Dark theme everywhere
**Steps:** Browse Signals, Settings, Alerts and Positions.
**✅ Pass:** Green, amber and red status text is readable on the dark background. Scrollbars in lists and dialogs are slim and dark, not bright white bars.
**❌ Fail:** Light-theme colours (pale green on dark, white scrollbars) anywhere.

---

## Result

| Part | Area | Pass? |
|---|---|---|
| A | Keystroke-filtered number inputs, steppers | ☐ |
| B | Red validation + short hints | ☐ |
| C | Themed, roomy, unclippable dropdowns | ☐ |
| D | Text areas | ☐ |
| E | Non-blocking saves (autosave, per-row pending) | ☐ |
| F | Dark-theme consistency | ☐ |
