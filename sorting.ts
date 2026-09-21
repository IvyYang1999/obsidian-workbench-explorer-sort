import type { SortMode } from "./rules";

export interface SortableItem {
  name: string;
  ctime: number;
  mtime: number;
  originalIndex: number;
}

export function compareItems(
  a: SortableItem,
  b: SortableItem,
  mode: SortMode
): number {
  switch (mode) {
    case "name-asc":
      return compareName(a, b);
    case "name-desc":
      return compareName(b, a);
    case "ctime-desc":
      return compareNumber(b.ctime, a.ctime) || compareName(a, b);
    case "ctime-asc":
      return compareNumber(a.ctime, b.ctime) || compareName(a, b);
    case "mtime-desc":
      return compareNumber(b.mtime, a.mtime) || compareName(a, b);
    case "mtime-asc":
      return compareNumber(a.mtime, b.mtime) || compareName(a, b);
    default:
      return a.originalIndex - b.originalIndex;
  }
}

function compareName(a: SortableItem, b: SortableItem): number {
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}
