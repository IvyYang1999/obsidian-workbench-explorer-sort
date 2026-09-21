import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  removeRulePaths,
  remapRulePaths,
  sanitizeRules,
  type SortRule,
} from "../rules.ts";

const byName: SortRule = { mode: "name-asc" };
const byModified: SortRule = { mode: "mtime-desc" };

void test("sanitizeRules keeps only valid path-to-mode entries", () => {
  assert.deepEqual(
    sanitizeRules({
      Projects: byName,
      Archive: { mode: "not-a-mode" },
      Broken: null,
      Number: 42,
    }),
    { Projects: byName }
  );
  assert.deepEqual(sanitizeRules(null), {});
});

void test("remapRulePaths moves a folder rule and all descendant rules", () => {
  assert.deepEqual(
    remapRulePaths(
      {
        Projects: byName,
        "Projects/Active": byModified,
        Projects2: byModified,
      },
      "Projects",
      "Work"
    ),
    {
      Work: byName,
      "Work/Active": byModified,
      Projects2: byModified,
    }
  );
});

void test("removeRulePaths removes only the folder rule and descendants", () => {
  assert.deepEqual(
    removeRulePaths(
      {
        Projects: byName,
        "Projects/Active": byModified,
        Projects2: byModified,
      },
      "Projects"
    ),
    { Projects2: byModified }
  );
});
