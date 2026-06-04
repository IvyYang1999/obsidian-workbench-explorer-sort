import {
  App,
  getLanguage,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";

/* ═══════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════ */

type SortMode =
  | "name-asc"
  | "name-desc"
  | "ctime-desc"
  | "ctime-asc"
  | "mtime-desc"
  | "mtime-asc";

interface SortRule {
  mode: SortMode;
}

interface PluginSettings {
  rules: Record<string, SortRule>;
}

interface SortableItem {
  name: string;
  ctime: number;
  mtime: number;
  originalIndex: number;
}

interface FileTreeItem {
  file: TAbstractFile;
}

interface FileExplorerView {
  getSortedFolderItems(folder: TFolder): FileTreeItem[];
  requestSort(): void;
  sort?: () => void;
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
    configuredRules: string;
    ruleCount: (count: number) => string;
    clear: string;
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
    configuredRules: "Configured rules",
    ruleCount: (count) => `${count} folder rule${count === 1 ? "" : "s"}.`,
    clear: "Clear",
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
    configuredRules: "已配置规则",
    ruleCount: (count) => `${count} 个文件夹规则。`,
    clear: "清除",
    vaultRoot: "库根目录",
  },
};

const LOG = "[WorkbenchSort]";

/* ═══════════════════════════════════════════════════════════════════════
   Plugin
   ═══════════════════════════════════════════════════════════════════════ */

export default class WorkbenchExplorerSortPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private unpatchExplorer: (() => void) | null = null;

  /* ── Lifecycle ─────────────────────────────────────────────────────── */

  async onload() {
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
    this.registerEvent(this.app.vault.on("rename", () => this.triggerSort()));
    this.registerEvent(this.app.vault.on("delete", () => this.triggerSort()));

    this.app.workspace.onLayoutReady(() => {
      this.patchFileExplorer();
      this.triggerSort();
    });

    console.log(LOG, "loaded");
  }

  onunload() {
    this.unpatchExplorer?.();
    this.unpatchExplorer = null;
    console.log(LOG, "unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.rules ??= {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /* ── Rule management ───────────────────────────────────────────────── */

  async setRule(folderPath: string, rule: SortRule) {
    this.settings.rules[norm(folderPath)] = rule;
    await this.saveSettings();
    this.triggerSort();
  }

  async clearRule(folderPath: string) {
    delete this.settings.rules[norm(folderPath)];
    await this.saveSettings();
    this.triggerSort();
  }

  /* ── Right-click menu ──────────────────────────────────────────────── */

  private addSortMenu(menu: Menu, file: TAbstractFile) {
    const folderPath =
      file instanceof TFolder
        ? norm(file.path)
        : norm(file.parent?.path ?? "");
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

  private patchFileExplorer() {
    if (this.unpatchExplorer) return;

    const view = this.getExplorerView();
    if (!view) return;

    const proto = Object.getPrototypeOf(view) as FileExplorerView;
    const original = proto.getSortedFolderItems;
    if (typeof original !== "function") return;

    const plugin = this;
    proto.getSortedFolderItems = function (folder: TFolder): FileTreeItem[] {
      const items = original.call(this, folder);
      const rule = plugin.settings.rules[norm(folder.path)];
      if (!rule) return items;
      return sortFileTreeItems(items, rule);
    };

    this.unpatchExplorer = () => {
      proto.getSortedFolderItems = original;
    };
    console.log(LOG, "explorer patched");
  }

  private getExplorerView(): FileExplorerView | null {
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    const v = leaf?.view as unknown;
    if (
      v &&
      typeof (v as FileExplorerView).getSortedFolderItems === "function" &&
      typeof (v as FileExplorerView).requestSort === "function"
    ) {
      return v as FileExplorerView;
    }
    return null;
  }

  private triggerSort() {
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

function norm(path: string): string {
  return path === "/" ? "" : path.replace(/^\/+|\/+$/g, "");
}

function displayFolder(path: string): string {
  return path || text().vaultRoot;
}

function extractSubmenu(item: unknown): Menu | null {
  const c = item as { setSubmenu?: () => Menu };
  return typeof c.setSubmenu === "function" ? c.setSubmenu() : null;
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
    .sort((a, b) => compareItems(a.s, b.s, rule))
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

function compareItems(
  a: SortableItem,
  b: SortableItem,
  rule: SortRule
): number {
  return compareByMode(a, b, rule.mode);
}

function compareByMode(
  a: SortableItem,
  b: SortableItem,
  mode: SortMode
): number {
  switch (mode) {
    case "name-asc":
      return cmpName(a, b);
    case "name-desc":
      return cmpName(b, a);
    case "ctime-desc":
      return cmpNum(b.ctime, a.ctime) || cmpName(a, b);
    case "ctime-asc":
      return cmpNum(a.ctime, b.ctime) || cmpName(a, b);
    case "mtime-desc":
      return cmpNum(b.mtime, a.mtime) || cmpName(a, b);
    case "mtime-asc":
      return cmpNum(a.mtime, b.mtime) || cmpName(a, b);
    default:
      return a.originalIndex - b.originalIndex;
  }
}

function cmpName(a: SortableItem, b: SortableItem): number {
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function cmpNum(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Workbench Explorer Sort" });
    containerEl.createEl("p", {
      text: text().settingsDesc,
    });

    const rules = Object.entries(this.plugin.settings.rules);
    new Setting(containerEl)
      .setName(text().configuredRules)
      .setDesc(text().ruleCount(rules.length));

    for (const [folder, rule] of rules) {
      new Setting(containerEl)
        .setName(displayFolder(folder))
        .setDesc(modeLabel(rule.mode))
        .addButton((btn) =>
          btn.setButtonText(text().clear).onClick(async () => {
            await this.plugin.clearRule(folder);
            this.display();
          })
        );
    }
  }
}
