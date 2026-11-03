import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_TASKS,
  demoProgress,
  filterDemoTasks,
  groupDemoTasksByPhase,
  toggleDemoTask,
} from "@/modules/marketing/landingDemo";

describe("landing demo", () => {
  it("computes overall and per-kind progress", () => {
    const overall = demoProgress(DEMO_TASKS);
    assert.equal(overall.done, 2);
    assert.equal(overall.total, 5);
    assert.equal(overall.percent, 40);

    const scope = demoProgress(DEMO_TASKS, "scope");
    assert.equal(scope.done, 2);
    assert.equal(scope.total, 3);
    assert.equal(scope.percent, 67);

    const revision = demoProgress(DEMO_TASKS, "revision");
    assert.equal(revision.done, 0);
    assert.equal(revision.percent, 0);
  });

  it("toggles a single task without mutating the rest", () => {
    const next = toggleDemoTask(DEMO_TASKS, "payments");
    assert.equal(
      next.find((task) => task.id === "payments")?.done,
      true,
    );
    assert.equal(
      DEMO_TASKS.find((task) => task.id === "payments")?.done,
      false,
    );
    assert.equal(demoProgress(next).percent, 60);
  });

  it("filters by kind and phase, and groups remaining work", () => {
    const buildScope = filterDemoTasks(DEMO_TASKS, "scope", "build");
    assert.deepEqual(
      buildScope.map((task) => task.id),
      ["accounts", "payments"],
    );
    const groups = groupDemoTasksByPhase(filterDemoTasks(DEMO_TASKS, "scope", "all"));
    assert.equal(groups[0]?.phase.id, "discovery");
    assert.equal(groups[0]?.tasks.length, 1);
    assert.equal(groups[1]?.phase.id, "build");
    assert.equal(groups[1]?.tasks.length, 2);
  });
});
