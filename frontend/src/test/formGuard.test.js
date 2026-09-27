/**
 * Guardrail (M19.5 / UX4): forms are built from the shared layer in
 * components/ui/form/, so validation, sizing and styling stay consistent.
 *
 * Fails if app code (outside that folder and the tests) uses a raw <select>,
 * <textarea>, or an <input> other than a checkbox/range slider — which have no
 * shared equivalent and are themed with `accent-primary`.
 */

import { it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC = join(__dirname, "..")
const ALLOWED_DIRS = [join(SRC, "components", "ui", "form"), join(SRC, "test")]
const ALLOWED_INPUT_TYPES = ["checkbox", "range"]

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return ALLOWED_DIRS.includes(p) ? [] : jsxFiles(p)
    return p.endsWith(".jsx") ? [p] : []
  })
}

function violations(file) {
  const src = readFileSync(file, "utf8")
  const found = []
  const lineOf = (i) => src.slice(0, i).split("\n").length
  for (const m of src.matchAll(/<(select|textarea)\b/g)) {
    found.push(`${m[1]} at line ${lineOf(m.index)}`)
  }
  for (const m of src.matchAll(/<input\b/g)) {
    // Look at the tag's attributes (up to its self-closing end).
    const end = src.indexOf("/>", m.index)
    const tag = src.slice(m.index, end === -1 ? m.index + 400 : end)
    const type = tag.match(/type=["'](\w+)["']/)?.[1]
    if (!ALLOWED_INPUT_TYPES.includes(type)) {
      found.push(`input${type ? ` type="${type}"` : ""} at line ${lineOf(m.index)}`)
    }
  }
  return found.map((v) => `${relative(SRC, file).split(sep).join("/")}: ${v}`)
}

it("uses the shared form components instead of raw form controls", () => {
  const all = jsxFiles(SRC).flatMap(violations)
  expect(all, "Use components/ui/form (Field, TextInput, NumberInput, Select, Combobox, Textarea)").toEqual([])
})
