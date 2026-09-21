export const SORT_MODES = [
  "name-asc",
  "name-desc",
  "ctime-desc",
  "ctime-asc",
  "mtime-desc",
  "mtime-asc",
] as const;

export type SortMode = (typeof SORT_MODES)[number];

export interface SortRule {
  mode: SortMode;
}

export interface PluginSettings {
  rules: Record<string, SortRule>;
}

const SORT_MODE_SET = new Set<string>(SORT_MODES);

export function normalizePath(path: string): string {
  return path === "/" ? "" : path.replace(/^\/+|\/+$/g, "");
}

export function sanitizeSettings(value: unknown): PluginSettings {
  if (!isRecord(value)) return { rules: {} };
  return { rules: sanitizeRules(value.rules) };
}

export function sanitizeRules(value: unknown): Record<string, SortRule> {
  if (!isRecord(value)) return {};

  const rules: Record<string, SortRule> = {};
  for (const [path, candidate] of Object.entries(value)) {
    if (!isRecord(candidate) || !isSortMode(candidate.mode)) continue;
    rules[normalizePath(path)] = { mode: candidate.mode };
  }
  return rules;
}

export function remapRulePaths(
  rules: Record<string, SortRule>,
  oldPath: string,
  newPath: string
): Record<string, SortRule> {
  const from = normalizePath(oldPath);
  const to = normalizePath(newPath);
  if (!from || from === to) return rules;

  let changed = false;
  const next: Record<string, SortRule> = {};
  for (const [path, rule] of Object.entries(rules)) {
    const suffix = descendantSuffix(path, from);
    if (suffix === null) {
      next[path] = rule;
      continue;
    }
    next[`${to}${suffix}`] = rule;
    changed = true;
  }
  return changed ? next : rules;
}

export function removeRulePaths(
  rules: Record<string, SortRule>,
  folderPath: string
): Record<string, SortRule> {
  const root = normalizePath(folderPath);
  if (!root) return rules;

  const next: Record<string, SortRule> = {};
  let changed = false;
  for (const [path, rule] of Object.entries(rules)) {
    if (descendantSuffix(path, root) !== null) {
      changed = true;
      continue;
    }
    next[path] = rule;
  }
  return changed ? next : rules;
}

function descendantSuffix(path: string, root: string): string | null {
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length) : null;
}

function isSortMode(value: unknown): value is SortMode {
  return typeof value === "string" && SORT_MODE_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
