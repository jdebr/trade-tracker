/**
 * ConditionBuilder pure-logic tests — the JsonLogic <-> conditions round-trip,
 * which is the riskiest part of the visual builder.
 */

import { it, expect, describe } from "vitest"
import { buildLogic, logicToConditions } from "../components/ConditionBuilder"

describe("logicToConditions", () => {
  it("parses a bare var as is_true", () => {
    const r = logicToConditions({ var: "bb_squeeze" })
    expect(r.combinator).toBe("all")
    expect(r.conditions[0]).toMatchObject({ variable: "bb_squeeze", operator: "is_true" })
  })

  it("parses a negated var as is_false", () => {
    const r = logicToConditions({ "!": [{ var: "bb_squeeze" }] })
    expect(r.conditions[0]).toMatchObject({ variable: "bb_squeeze", operator: "is_false" })
  })

  it("parses a 3-operand <= as between", () => {
    const r = logicToConditions({ "<=": [35, { var: "rsi_14" }, 65] })
    expect(r.conditions[0]).toMatchObject({ variable: "rsi_14", operator: "between", low: 35, high: 65 })
  })

  it("parses a var-vs-var comparison", () => {
    const r = logicToConditions({ ">": [{ var: "close" }, { var: "ema_50" }] })
    expect(r.conditions[0]).toMatchObject({ variable: "close", operator: ">", rhsKind: "var", rhsVariable: "ema_50" })
  })

  it("flips a literal-on-the-left comparison so the variable leads", () => {
    const r = logicToConditions({ ">": [35, { var: "rsi_14" }] })
    expect(r.conditions[0]).toMatchObject({ variable: "rsi_14", operator: "<", value: 35 })
  })

  it("parses and/or wrappers into multiple conditions", () => {
    const r = logicToConditions({
      and: [{ "<": [{ var: "rsi_14" }, 30] }, { var: "bb_squeeze" }],
    })
    expect(r.combinator).toBe("all")
    expect(r.conditions).toHaveLength(2)
  })

  it("returns null for expressions too complex for the builder", () => {
    expect(logicToConditions({ and: [{ or: [{ var: "a" }, { var: "b" }] }] })).toBeNull()
    expect(logicToConditions({ "+": [{ var: "a" }, 1] })).toBeNull()
  })

  it("returns null for an arithmetic (or non-var/non-number) right-hand side", () => {
    // Must stay in JSON mode, not be mangled to `vol_3d > null`.
    expect(logicToConditions({ ">": [{ var: "vol_3d" }, { "*": [1.5, { var: "vol_20d" }] }] })).toBeNull()
    expect(logicToConditions({ "==": [{ var: "x" }, true] })).toBeNull()
  })
})

describe("buildLogic", () => {
  it("returns a bare node for a single condition", () => {
    const { conditions } = logicToConditions({ "<": [{ var: "rsi_14" }, 30] })
    expect(buildLogic("all", conditions)).toEqual({ "<": [{ var: "rsi_14" }, 30] })
  })

  it("wraps multiple conditions in and/or", () => {
    const { conditions } = logicToConditions({
      and: [{ "<": [{ var: "rsi_14" }, 30] }, { var: "bb_squeeze" }],
    })
    expect(buildLogic("all", conditions)).toEqual({
      and: [{ "<": [{ var: "rsi_14" }, 30] }, { var: "bb_squeeze" }],
    })
    expect(buildLogic("any", conditions)).toEqual({
      or: [{ "<": [{ var: "rsi_14" }, 30] }, { var: "bb_squeeze" }],
    })
  })

  it("ignores incomplete conditions and returns null when none are complete", () => {
    expect(buildLogic("all", [{ variable: "", operator: "" }])).toBeNull()
  })

  it("round-trips the seeded builtins", () => {
    for (const expr of [
      { var: "bb_squeeze" },
      { "<=": [35, { var: "rsi_14" }, 65] },
      { ">": [{ var: "close" }, { var: "ema_50" }] },
    ]) {
      const { combinator, conditions } = logicToConditions(expr)
      expect(buildLogic(combinator, conditions)).toEqual(expr)
    }
  })
})
