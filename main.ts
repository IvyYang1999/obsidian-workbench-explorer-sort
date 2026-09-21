import {
  App,
  getLanguage,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  SettingDefinition,
  SettingDefinitionItem,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";
import {
  normalizePath,
  removeRulePaths,
  remapRulePaths,
  sanitizeSettings,
  type PluginSettings,
  type SortMode,
  type SortRule,
} from "./rules";
import { compareItems as compareSortableItems, type SortableItem } from "./sorting";

/* ═══════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════ */

interface FileTreeItem {
  file: TAbstractFile;
}

type GetSortedFolderItems = (
  this: FileExplorerView,
  folder: TFolder
) => FileTreeItem[];

interface FileExplorerView {
  getSortedFolderItems: GetSortedFolderItems;
  requestSort(): void;
}

interface FileExplorerPrototype {
  getSortedFolderItems: GetSortedFolderItems;
}

/* ═══════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_SETTINGS: PluginSettings = { rules: {} };

type Locale = "en" | "zh";

const MODE_LABELS: Record<Locale, Record<SortMode, string>> = {
  en: {
    "name-asc": "Name A → Z",
    "name-desc": "Name Z → A",
    "ctime-desc": "Created time New → Old",
    "ctime-asc": "Created time Old → New",
    "mtime-desc": "Modified time New → Old",
    "mtime-asc": "Modified time Old → New",
  },
  zh: {
    "name-asc": "名称 A → Z",
    "name-desc": "名称 Z → A",
    "ctime-desc": "创建时间 新 → 旧",
    "ctime-asc": "创建时间 旧 → 新",
    "mtime-desc": "修改时间 新 → 旧",
    "mtime-asc": "修改时间 旧 → 新",
  },
};

const TEXT: Record<
  Locale,
  {
    sortRules: string;
    name: string;
    createdTime: string;
    modifiedTime: string;
    ascName: string;
    descName: string;
    newestFirst: string;
    oldestFirst: string;
    clearRule: string;
    clearedRule: (folder: string) => string;
    setRule: (folder: string, label: string) => string;
    settingsDesc: string;
    settingsHelp: string;
    configuredRules: string;
    noRules: string;
    noRulesDesc: string;
    removeRule: string;
    saveFailed: string;
    vaultRoot: string;
  }
> = {
  en: {
    sortRules: "Sort rules",
    name: "Name",
    createdTime: "Created time",
    modifiedTime: "Modified time",
    ascName: "Ascending A → Z",
    descName: "Descending Z → A",
    newestFirst: "New → Old",
    oldestFirst: "Old → New",
    clearRule: "Clear sort rule",
    clearedRule: (folder) => `Cleared sort rule: ${folder}`,
    setRule: (folder, label) => `Sort rule: ${folder} → ${label}`,
    settingsDesc: "Right-click a folder → Sort rules to set how that folder is sorted.",
    settingsHelp: "Set rules from the File Explorer",
    configuredRules: "Folder rules",
    noRules: "No folder rules yet",
    noRulesDesc: "Right-click a folder in the File Explorer to add one.",
    removeRule: "Remove rule",
    saveFailed: "Could not save folder rules.",
    vaultRoot: "Vault root",
  },
  zh: {
    sortRules: "排序规则",
    name: "名称",
    createdTime: "创建时间",
    modifiedTime: "修改时间",
    ascName: "正序 A → Z",
    descName: "倒序 Z → A",
    newestFirst: "新 → 旧",
    oldestFirst: "旧 → 新",
    clearRule: "清除排序规则",
    clearedRule: (folder) => `已清除排序规则：${folder}`,
    setRule: (folder, label) => `排序规则：${folder} → ${label}`,
    settingsDesc: "右键文件夹 → 排序规则，可设置该文件夹的排序方式。",
    settingsHelp: "从文件列表设置规则",
    configuredRules: "文件夹规则",
    noRules: "尚无文件夹规则",
    noRulesDesc: "在文件列表中右键文件夹即可添加。",
    removeRule: "移除规则",
    saveFailed: "无法保存文件夹规则。",
    vaultRoot: "库根目录",
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   Plugin
   ═══════════════════════════════════════════════════════════════════════ */

export default class WorkbenchExplorerSortPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private unpatchExplorer: (() => void) | null = null;
  private settingsMutation: Promise<void> = Promise.resolve();

  /* ── Lifecycle ─────────────────────────────────────────────────────── */

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SortSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) =>
        this.addSortMenu(menu, file)
      )
    );
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        if (files.length > 0) this.addSortMenu(menu, files[0]);
      })
    );

    this.registerEvent(this.app.vault.on("create", () => this.triggerSort()));
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFolder) {
          await this.updateRules((rules) =>
            remapRulePaths(rules, oldPath, file.path)
          );
        }
        this.triggerSort();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (file instanceof TFolder) {
          await this.updateRules((rules) => removeRulePaths(rules, file.path));
        }
        this.triggerSort();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.patchFileExplorer();
      this.triggerSort();
    });
  }

  onunload(): void {
    this.unpatchExplorer?.();
    this.unpatchExplorer = null;
  }

  async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData();
    this.settings = sanitizeSettings(stored);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private updateRules(
    update: (rules: Record<string, SortRule>) => Record<string, SortRule>
  ): Promise<void> {
    const operation = this.settingsMutation.then(async () => {
      const rules = update(this.settings.rules);
      if (rules === this.settings.rules) return;
      this.settings = { rules };
      await this.saveSettings();
    });
    this.settingsMutation = operation.catch(() => {
      new Notice(text().saveFailed);
    });
    return operation;
  }

  /* ── Rule management ───────────────────────────────────────────────── */

  async setRule(folderPath: string, rule: SortRule): Promise<void> {
    await this.updateRules((rules) => ({
      ...rules,
      [normalizePath(folderPath)]: rule,
    }));
    this.triggerSort();
  }

  async clearRule(folderPath: string): Promise<void> {
    await this.updateRules((rules) => {
      const key = normalizePath(folderPath);
      if (!(key in rules)) return rules;
      const next = { ...rules };
      delete next[key];
      return next;
    });
    this.triggerSort();
  }

  /* ── Right-click menu ──────────────────────────────────────────────── */

  private addSortMenu(menu: Menu, file: TAbstractFile) {
    const folderPath =
      file instanceof TFolder
        ? normalizePath(file.path)
        : normalizePath(file.parent?.path ?? "");
    const current = this.settings.rules[folderPath];

    menu.addItem((item) => {
      item.setTitle(text().sortRules).setIcon("arrow-up-down");
      const submenu = extractSubmenu(item);
      if (!submenu) {
        item.onClick((evt) => {
          const popup = new Menu();
          this.populateSortMenu(popup, folderPath, current);
          if (evt instanceof MouseEvent) popup.showAtMouseEvent(evt);
          else popup.showAtPosition({ x: 0, y: 0 });
        });
        return;
      }
      this.populateSortMenu(submenu, folderPath, current);
    });
  }

  private populateSortMenu(
    menu: Menu,
    folderPath: string,
    current: SortRule | undefined
  ) {
    const labels = text();
    this.addModeGroup(menu, folderPath, current, labels.name, [
      ["name-asc", labels.ascName],
      ["name-desc", labels.descName],
    ]);
    this.addModeGroup(menu, folderPath, current, labels.createdTime, [
      ["ctime-desc", labels.newestFirst],
      ["ctime-asc", labels.oldestFirst],
    ]);
    this.addModeGroup(menu, folderPath, current, labels.modifiedTime, [
      ["mtime-desc", labels.newestFirst],
      ["mtime-asc", labels.oldestFirst],
    ]);
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(labels.clearRule)
        .setIcon("trash")
        .setDisabled(!current)
        .onClick(async () => {
          await this.clearRule(folderPath);
          new Notice(labels.clearedRule(displayFolder(folderPath)));
        })
    );
  }

  private addModeGroup(
    menu: Menu,
    folderPath: string,
    current: SortRule | undefined,
    title: string,
    modes: Array<[SortMode, string]>
  ) {
    menu.addItem((item) => {
      item.setTitle(title);
      const sub = extractSubmenu(item);
      if (!sub) {
        item.setDisabled(true);
        return;
      }
      for (const [mode, label] of modes) {
        this.addModeItem(sub, folderPath, current, mode, label);
      }
    });
  }

  private addModeItem(
    menu: Menu,
    folderPath: string,
    current: SortRule | undefined,
    mode: SortMode,
    label = modeLabel(mode)
  ) {
    menu.addItem((item) =>
      item
        .setTitle(label)
        .setChecked(current?.mode === mode)
        .onClick(async () => {
          await this.setRule(folderPath, { mode });
          new Notice(text().setRule(displayFolder(folderPath), modeLabel(mode)));
        })
    );
  }

  /* ── File Explorer patching ────────────────────────────────────────── */

  private patchFileExplorer(): void {
    if (this.unpatchExplorer) return;

    const view = this.getExplorerView();
    if (!view) return;

    const candidate: unknown = Object.getPrototypeOf(view);
    if (!isFileExplorerPrototype(candidate)) return;
    const proto = candidate;
    const original = proto.getSortedFolderItems;
    const getRule = (folderPath: string): SortRule | undefined =>
      this.settings.rules[normalizePath(folderPath)];
    const replacement: GetSortedFolderItems = function (
      this: FileExplorerView,
      folder: TFolder
    ): FileTreeItem[] {
      const items = original.call(this, folder);
      const rule = getRule(folder.path);
      if (!rule) return items;
      return sortFileTreeItems(items, rule);
    };
    proto.getSortedFolderItems = replacement;

    this.unpatchExplorer = () => {
      if (proto.getSortedFolderItems === replacement) {
        proto.getSortedFolderItems = original;
      }
    };
  }

  private getExplorerView(): FileExplorerView | null {
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    const view: unknown = leaf?.view;
    return isFileExplorerView(view) ? view : null;
  }

  private triggerSort(): void {
    this.patchFileExplorer();
    const view = this.getExplorerView();
    if (view) {
      view.requestSort();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Standalone helpers
   ═══════════════════════════════════════════════════════════════════════ */

function displayFolder(path: string): string {
  return path || text().vaultRoot;
}

function extractSubmenu(item: unknown): Menu | null {
  const c = item as { setSubmenu?: () => Menu };
  return typeof c.setSubmenu === "function" ? c.setSubmenu() : null;
}

function isFileExplorerView(value: unknown): value is FileExplorerView {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.getSortedFolderItems === "function" &&
    typeof candidate.requestSort === "function"
  );
}

function isFileExplorerPrototype(
  value: unknown
): value is FileExplorerPrototype {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Record<string, unknown>).getSortedFolderItems === "function";
}

function locale(): Locale {
  return getLanguage().toLowerCase().startsWith("zh") ? "zh" : "en";
}

function text() {
  return TEXT[locale()];
}

function modeLabel(mode: SortMode): string {
  return MODE_LABELS[locale()][mode];
}

/* ── Sorting ─────────────────────────────────────────────────────────── */

function sortFileTreeItems(
  items: FileTreeItem[],
  rule: SortRule
): FileTreeItem[] {
  return items
    .map((item, idx) => ({ item, s: toSortable(item.file, idx) }))
    .sort((a, b) => compareSortableItems(a.s, b.s, rule.mode))
    .map(({ item }) => item);
}

function toSortable(file: TAbstractFile, idx: number): SortableItem {
  const stats = getStats(file);
  return {
    name: file.name,
    ctime: stats.ctime,
    mtime: stats.mtime,
    originalIndex: idx,
  };
}

function getStats(file: TAbstractFile): { ctime: number; mtime: number } {
  if (file instanceof TFile)
    return { ctime: file.stat.ctime, mtime: file.stat.mtime };
  if (file instanceof TFolder) {
    const cs = file.children.map(getStats);
    if (cs.length === 0) return { ctime: 0, mtime: 0 };
    return {
      ctime: Math.min(...cs.map((s) => s.ctime || Infinity)),
      mtime: Math.max(...cs.map((s) => s.mtime || 0)),
    };
  }
  return { ctime: 0, mtime: 0 };
}

/* ═══════════════════════════════════════════════════════════════════════
   Settings tab
   ═══════════════════════════════════════════════════════════════════════ */

class SortSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: WorkbenchExplorerSortPlugin
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const labels = text();
    const rules = Object.entries(this.plugin.settings.rules).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );

    const items: SettingDefinition[] =
      rules.length === 0
        ? [{ name: labels.noRules, desc: labels.noRulesDesc }]
        : rules.map(([folder, rule]) => ({
            name: displayFolder(folder),
            desc: modeLabel(rule.mode),
            render: (setting) => {
              setting.addExtraButton((button) =>
                button
                  .setIcon("trash-2")
                  .setTooltip(labels.removeRule)
                  .onClick(async () => {
                    await this.plugin.clearRule(folder);
                    this.update();
                  })
              );
            },
          }));

    return [
      { name: labels.settingsHelp, desc: labels.settingsDesc },
      { type: "group", heading: labels.configuredRules, items },
    ];
  }
}
