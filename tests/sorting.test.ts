import { strict as assert } from "node:assert";
import { test } from "node:test";

import { compareItems, type SortableItem } from "../sorting.ts";

const items: SortableItem[] = [
  { name: "Note 10", ctime: 100, mtime: 300, originalIndex: 0 },
  { name: "note 2", ctime: 300, mtime: 100, originalIndex: 1 },
  { name: "Archive", ctime: 200, mtime: 200, originalIndex: 2 },
];

void test("name sorting is numeric and case-insensitive", () => {
  const names = [...items]
    .sort((a, b) => compareItems(a, b, "name-asc"))
    .map(({ name }) => name);
  assert.deepEqual(names, ["Archive", "note 2", "Note 10"]);
});

void test("time sorting honors direction", () => {
  const newestCreated = [...items]
    .sort((a, b) => compareItems(a, b, "ctime-desc"))
    .map(({ name }) => name);
  const oldestModified = [...items]
    .sort((a, b) => compareItems(a, b, "mtime-asc"))
    .map(({ name }) => name);

  assert.deepEqual(newestCreated, ["note 2", "Archive", "Note 10"]);
  assert.deepEqual(oldestModified, ["note 2", "Archive", "Note 10"]);
});

void test("time ties fall back to name order", () => {
  const tied = [
    { name: "Beta", ctime: 100, mtime: 100, originalIndex: 0 },
    { name: "Alpha", ctime: 100, mtime: 100, originalIndex: 1 },
  ];
  assert.deepEqual(
    tied.sort((a, b) => compareItems(a, b, "mtime-desc")).map(({ name }) => name),
    ["Alpha", "Beta"]
  );
});
