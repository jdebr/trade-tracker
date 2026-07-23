# M19 Smoke Test — Custom Signals

A manual, click-through checklist to verify everything built in Milestone 19 works in the real UI. Each test has **Steps** and a **✅ Pass / ❌ Fail** line. Work top to bottom — later tests assume earlier ones passed. The final section cleans up the test data so your signal set is left as you found it.

Estimated time: **15–20 minutes.**

---

## Prerequisites

Before starting, confirm:

- You're logged in and the backend is awake (the Screener shows results, not a spinner).
- Screener data exists — if the Screener page is empty, run **admin → Refresh Data**, then **Screen Tickers**, and wait for both to finish. (First-time only.)
- You know roughly what today's screener scored out of — for a stock install that's **/4**.

> These tests only create/toggle/delete **signals**; none of them touch your positions, watchlist, or real money. Anything you create here is removed in the Cleanup section.

---

## Part A — Dynamic Screener display (M19b.1)

### A1. Score shows achieved/max + normalized %
**Steps:** Open the **Screener**. Look at the **Score** column of any result row.
**✅ Pass:** Each score reads like `3/4` with a percentage beside it (e.g. `75%`). A perfect row shows `4/4 · 100%`; a zero shows `0/4`.
**❌ Fail:** Score shows a bare number with no denominator, or no percentage, or a denominator that isn't 4 on a stock install.

### A2. Signals render as labeled dots
**Steps:** Look at the **Signals** column on a desktop-width window.
**✅ Pass:** Each row shows a row of small dots with labels (BB Squeeze, RSI Range, Above EMA50, Vol Expand). Filled/green = the signal is true for that ticker; hollow/grey = false. Hovering a dot shows a tooltip explaining it.
**❌ Fail:** Fixed rigid columns with no labels, missing dots, or a crash/blank cell.

### A3. Higher scores rank first
**Steps:** Scan the Score column top to bottom.
**✅ Pass:** Rows are ordered by score descending (the strongest setups are at the top).
**❌ Fail:** Random or ascending order.

---

## Part B — Signals management page (M19b.2)

### B1. Signals page is reachable and lists the builtins
**Steps:** In the left sidebar, click **Signals**.
**✅ Pass:** A **Signals** page opens listing four rows: **BB Squeeze**, **RSI in range**, **Above EMA 50**, **Volume expansion**. Each shows a green **builtin** badge, a `×1` weight, and a plain-English expression (e.g. `35 ≤ RSI(14) ≤ 65`). A hint near the top mentions re-running the Screener.
**❌ Fail:** No Signals nav item, empty list, missing expressions, or a crash.

### B2. Light toggle disables/enables a signal
**Steps:** Click the green **light toggle** on the **Volume expansion** row (it should flip to grey/off), then click it again (back to green/on).
**✅ Pass:** The toggle flips immediately with no page reload, and stays where you left it (on) after a moment.
**❌ Fail:** The toggle doesn't move, snaps back unexpectedly, or throws an error.

### B3. Edit is name/weight only — expression is locked
**Steps:** Click the **pencil (Edit)** icon on **RSI in range**. In the dialog, change the **Weight** to `2`. Note the **Expression** area shows a lock and is greyed/read-only. Click **Save changes**.
**✅ Pass:** The dialog's expression is read-only (you can't type in it) with a "locked" note. After saving, the row shows `×2`.
**❌ Fail:** You can edit the expression text, or the weight change doesn't persist.

> Restore the weight to `×1` before moving on (Edit → Weight `1` → Save), or leave it — Cleanup doesn't touch builtins.

### B4. Clone opens a pre-filled create dialog
**Steps:** Click the **copy (Clone)** icon on **Above EMA 50**.
**✅ Pass:** A **New signal** dialog opens with the name pre-filled as **"Copy of Above EMA 50"** and the same condition already populated (in the builder you'll see `Close > EMA 50`). You can now edit the logic.
**❌ Fail:** Empty dialog, or the expression didn't carry over.
**Then:** Close the dialog (Cancel) — we'll build a real one next.

---

## Part C — Rule builder: visual mode (M19b.3)

### C1. New signal opens in the visual builder
**Steps:** Click **New signal**.
**✅ Pass:** The dialog opens with a **Builder / JSON** toggle set to **Builder**, showing "Match **all** of these conditions" and one empty condition row plus **+ Add condition**.
**❌ Fail:** Opens in raw JSON, or no builder controls appear.

### C2. Build a simple numeric condition
**Steps:** Name it **"Deep oversold"**. In the condition row: pick variable **RSI(14)**, operator **<**, and type value **30**.
**✅ Pass:** A green **Valid** panel appears reading **"Reads as: RSI(14) < 30"**. The **Create signal** button becomes enabled.
**❌ Fail:** No "Valid" panel, wrong reading, or Create stays disabled with a complete condition.

### C3. Single-symbol live preview
**Steps:** In the **Preview on** box, confirm a symbol is selected (e.g. AAPL). Type a different symbol and pick it.
**✅ Pass:** Shows **"Fires on \<SYMBOL\>"** or **"Doesn't fire on \<SYMBOL\>"** with the actual value used (e.g. `rsi_14 = 41.2`). Changing the symbol updates the result.
**❌ Fail:** No result, a crash, or values never appear.

### C4. Preview across the universe
**Steps:** Click **Preview across universe**.
**✅ Pass:** After a moment it reports **"Matches N of M tickers"** and lists the matching symbols with their RSI values, plus a note about "latest cached data." N should be plausible (RSI < 30 usually matches a handful).
**❌ Fail:** Nothing happens, an error, or it claims to match everything/nothing implausibly.

### C5. AND / OR and a second condition
**Steps:** Click **+ Add condition**. Pick **BB Squeeze** → operator **is true**. Leave "Match **all**".
**✅ Pass:** Reading updates to **"RSI(14) < 30 AND BB Squeeze"**. Switch the combinator to **any** → reading becomes **"... OR ..."**.
**❌ Fail:** Reading doesn't update, or the boolean variable still shows numeric operators.

### C6. "Between" and variable-vs-variable
**Steps:** Remove the BB Squeeze condition (the **×**). Change the first condition's operator to **between** and enter `40` and `60`. Confirm it reads **"40 ≤ RSI(14) ≤ 60"**. Then change the variable to **Close**, operator **>**, switch the right side from **a value** to **a variable**, and pick **EMA 50**.
**✅ Pass:** Both forms produce valid readings (`40 ≤ RSI(14) ≤ 60`, then `Close > EMA 50`).
**❌ Fail:** Either form is unbuildable or reads wrong.

### C7. Create the signal
**Steps:** Set it back to a simple, distinctive rule for later steps: one condition **MACD Histogram > 0**, name **"MACD positive (test)"**. Click **Create signal**.
**✅ Pass:** Dialog closes; the new **MACD positive (test)** row appears in the list with no builtin badge, a light toggle (on), and the expression `MACD Histogram > 0`.
**❌ Fail:** Save error, or the row doesn't appear.

---

## Part D — Rule builder: JSON escape hatch & validation

### D1. Toggle to JSON shows the built expression
**Steps:** Click **New signal**, build any one condition (e.g. RSI(14) < 25), then click the **JSON** toggle.
**✅ Pass:** A textarea shows the raw JsonLogic (e.g. `{"<": [{"var": "rsi_14"}, 25]}`) matching what you built.
**❌ Fail:** Empty textarea, or content that doesn't match.

### D2. Invalid JSON is caught
**Steps:** In JSON mode, break the text (delete a bracket).
**✅ Pass:** An **"Invalid JSON"** message appears and **Create** is disabled.
**❌ Fail:** Shows "Valid", or lets you save broken JSON.

### D3. Unknown variable is rejected (no false "Valid")
**Steps:** Replace the text with `{"<": [{"var": "not_a_real_var"}, 10]}`.
**✅ Pass:** After a brief "Checking…", it shows an **error** naming the unknown variable, and **Create** stays disabled. It must **never** flash a green "Valid" for this.
**❌ Fail:** Shows "Valid" at any point, or lets you create it.

### D4. Complex expression stays in JSON (regression: arithmetic RHS)
**Steps:** Paste `{">": [{"var": "vol_3d"}, {"*": [1.5, {"var": "vol_20d"}]}]}` (3-day volume greater than 1.5× the 20-day). Observe the **Builder** toggle.
**✅ Pass:** It validates as **Valid** ("Reads as: ..."), but the **Builder** tab is **disabled** (with a hover note that it's too complex for the visual builder). It stays in JSON mode. You can still create it, and it is **not** silently altered.
**❌ Fail:** The Builder tab is enabled and, when clicked, rewrites the expression (e.g. to `vol_3d > null`) — this is the exact bug the review caught; it must not recur.
**Then:** Cancel out of this dialog (don't save it).

---

## Part E — Edit fidelity regressions

### E1. Type field persists on edit
**Steps:** Edit **MACD positive (test)** (the signal from C7). Set **Type** to `momentum`. Save. Reload the page (or navigate away and back). Edit it again.
**✅ Pass:** The **Type** field still reads `momentum`.
**❌ Fail:** Type is blank again — the edit was dropped.

### E2. Clearing description actually clears it
**Steps:** Edit **MACD positive (test)**. Add a **Description** ("test desc"), save. Edit again, delete the description text entirely, save. Edit once more.
**✅ Pass:** The description field is empty.
**❌ Fail:** The old "test desc" reappears — the clear didn't take.

---

## Part F — End-to-end scoring loop

This is the payoff: a custom signal actually changes screener scoring.

### F1. New signal raises the max score after a re-run
**Steps:** Confirm **MACD positive (test)** is **enabled** (light on). Go to the **Screener** and click **Screen Tickers**. Wait for it to finish.
**✅ Pass:** Result rows now score out of **5** (e.g. `3/5`), and a new **MACD positive (test)** dot appears in the Signals cell. Tickers with a positive MACD histogram show it filled.
**❌ Fail:** Still scoring out of 4, or the new signal doesn't appear as a dot.

### F2. Disabling removes it from the next run
**Steps:** Go to **Signals**, toggle **MACD positive (test)** **off**. Return to the **Screener** and click **Screen Tickers** again.
**✅ Pass:** Scores return to **/4** and the MACD test dot is gone from new results.
**❌ Fail:** Still `/5`, or the dot persists.

### F3. Historical immutability
**Steps:** (Optional) Note a specific ticker's score before F2's re-run and after.
**✅ Pass:** Only the newest run changed; you never saw a past run's numbers rewrite themselves. (The Screener shows one run at a time, so this is mostly a "nothing looked corrupted" check.)
**❌ Fail:** Older data appeared to change on its own.

---

## Part G — Remove & restore

### G1. Soft-delete with confirmation
**Steps:** On **Signals**, click the **trash (Remove)** icon on **MACD positive (test)**. A confirm dialog appears; confirm **Remove**.
**✅ Pass:** A confirmation dialog appears first (titled `Remove "MACD positive (test)"?`), and after confirming the row leaves the active list.
**❌ Fail:** Deleted with no confirmation, or an error.

### G2. Show removed + restore
**Steps:** Click **Show removed**. Find **MACD positive (test)** and click **Restore**.
**✅ Pass:** The removed list reveals the signal; Restore returns it to the active list.
**❌ Fail:** Removed list is empty/missing, or Restore fails.

### G3. Builtin delete warning
**Steps:** Click the **trash** icon on a **builtin** (e.g. **BB Squeeze**). Read the confirm dialog. **Then click Cancel — do not confirm.**
**✅ Pass:** The confirmation warns that it's a builtin and that the Screener's legacy column for it will stop updating.
**❌ Fail:** No warning, or it reads identically to a normal delete.

---

## Cleanup

Leave the signal set as you found it:

1. **Signals → Show removed → Restore** anything you want to keep, or leave **MACD positive (test)** removed.
2. **Permanently remove the test signal:** if you restored it in G2, click **Remove** on **MACD positive (test)** again so it's gone from the active list. (Soft-deleted rows don't score and are harmless to leave, but this keeps the list tidy.)
3. If you bumped **RSI in range** to `×2` in B3 and didn't revert, Edit it back to `×1`.
4. Re-enable any builtin you toggled off (all four should be **on**).
5. Run **Screen Tickers** once more so the live Screener reflects the restored builtin-only set (`/4`).

---

## Result

| Part | Feature | Pass? |
|---|---|---|
| A | Dynamic Screener display | ☐ |
| B | Signals management (list, toggle, edit, clone) | ☐ |
| C | Visual rule builder | ☐ |
| D | JSON mode + validation | ☐ |
| E | Edit fidelity (type, clear description) | ☐ |
| F | End-to-end scoring loop | ☐ |
| G | Remove & restore | ☐ |

If every part passes, M19 is good to push. Note any ❌ with the test number and what you saw.
