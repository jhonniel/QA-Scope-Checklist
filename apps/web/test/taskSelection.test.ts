import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextSelectAll, toggleSelectedId } from "@/modules/checklist/useTaskSelection";

describe("task selection", () => {
  it("toggles a task on and off", () => {
    const one = toggleSelectedId(new Set(), "a");
    assert.deepEqual([...one], ["a"]);
    assert.deepEqual([...toggleSelectedId(one, "a")], []);
    assert.deepEqual([...toggleSelectedId(one, "b")].sort(), ["a", "b"]);
  });

  it("selects every visible task, then clears", () => {
    const visible = ["a", "b", "c"];
    const all = nextSelectAll(new Set(["a"]), visible);
    assert.deepEqual([...all].sort(), visible);
    assert.deepEqual([...nextSelectAll(all, visible)], []);
  });
});
