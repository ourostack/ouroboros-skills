import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as paths from "../../src/util/paths.js"

test("validateWriteSegment exports the existing pure segment-validation contract", () => {
  assert.equal(typeof paths.validateWriteSegment, "function", "the shared segment validator must be exported")
  for (const segment of ["track", "task.md", "2026-09-09-initial-impl", "name with spaces", "任务"]) {
    assert.equal(paths.validateWriteSegment(segment), undefined)
  }
  for (const segment of [undefined, null, 42, {}, [], "", " \t ", ".", "..", "safe..name", "/absolute", "safe/child", "safe\\child"]) {
    assert.throws(() => paths.validateWriteSegment(segment), {
      message: `desk-mcp: invalid write path segment ${JSON.stringify(segment)} — segments must be non-empty single path components with no ".." or separators.`,
    })
  }
})
