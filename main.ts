import {
  App,
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
  | "mtime-asc"
  | "title-date-desc"
  | "title-date-asc"
  | "custom";

interface SortRule {
  mode: SortMode;
  customRule?: string;
}

interface PluginSettings {
  rules: Record<string, SortRule>;
}

interface SortableItem {
  name: string;
  type: "file" | "folder";
  ctime: number;
  mtime: number;
  titleDate: number | null;
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

const MODE_LABELS: Record<SortMode, string> = {
  "name-asc": "名称 A → Z",
  "name-desc": "名称 Z → A",
  "ctime-desc": "创建时间 新 → 旧",
  "ctime-asc": "创建时间 旧 → 新",
  "mtime-desc": "修改时间 新 → 旧",
  "mtime-asc": "修改时间 旧 → 新",
  "title-date-desc": "标题日期 新 → 旧",
  "title-date-asc": "标题日期 旧 → 新",
  custom: "自定义规则...",
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
      item.setTitle("排序规则").setIcon("arrow-up-down");
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
    this.addModeGroup(menu, folderPath, current, "名称", [
      ["name-asc", "正序 A → Z"],
      ["name-desc", "倒序 Z → A"],
    ]);
    this.addModeGroup(menu, folderPath, current, "创建时间", [
      ["ctime-desc", "新 → 旧"],
      ["ctime-asc", "旧 → 新"],
    ]);
    this.addModeGroup(menu, folderPath, current, "修改时间", [
      ["mtime-desc", "新 → 旧"],
      ["mtime-asc", "旧 → 新"],
    ]);
    this.addModeGroup(menu, folderPath, current, "标题日期", [
      ["title-date-desc", "新 → 旧"],
      ["title-date-asc", "旧 → 新"],
    ]);
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("自定义规则...")
        .setIcon("braces")
        .onClick(async () => {
          const rule = window.prompt(
            "输入排序规则（逗号分隔）\n示例：folders-first, title-date desc, name asc",
            current?.customRule ?? "folders-first, title-date desc, name asc"
          );
          if (!rule) return;
          await this.setRule(folderPath, { mode: "custom", customRule: rule });
          new Notice(`自定义排序规则已保存：${displayFolder(folderPath)}`);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("清除排序规则")
        .setIcon("trash")
        .setDisabled(!current)
        .onClick(async () => {
          await this.clearRule(folderPath);
          new Notice(`已清除排序规则：${displayFolder(folderPath)}`);
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
    label = MODE_LABELS[mode]
  ) {
    menu.addItem((item) =>
      item
        .setTitle(label)
        .setChecked(current?.mode === mode)
        .onClick(async () => {
          await this.setRule(folderPath, { mode });
          new Notice(
            `排序规则：${displayFolder(folderPath)} → ${MODE_LABELS[mode]}`
          );
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
  return path || "Vault root";
}

function extractSubmenu(item: unknown): Menu | null {
  const c = item as { setSubmenu?: () => Menu };
  return typeof c.setSubmenu === "function" ? c.setSubmenu() : null;
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
    type: file instanceof TFolder ? "folder" : "file",
    ctime: stats.ctime,
    mtime: stats.mtime,
    titleDate: parseTitleDate(file.name),
    originalIndex: idx,
  };
}

function compareItems(
  a: SortableItem,
  b: SortableItem,
  rule: SortRule
): number {
  if (rule.mode === "custom") {
    return compareByCustomRule(a, b, rule.customRule ?? "");
  }
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
    case "title-date-desc":
      return cmpNullNum(b.titleDate, a.titleDate) || cmpName(a, b);
    case "title-date-asc":
      return cmpNullNum(a.titleDate, b.titleDate) || cmpName(a, b);
    default:
      return a.originalIndex - b.originalIndex;
  }
}

function compareByCustomRule(
  a: SortableItem,
  b: SortableItem,
  rule: string
): number {
  for (const raw of rule.split(",")) {
    const clause = raw.trim().toLowerCase();
    if (!clause) continue;
    let r = 0;
    if (clause === "folders-first")
      r = cmpNum(typeRank(a, true), typeRank(b, true));
    else if (clause === "files-first")
      r = cmpNum(typeRank(a, false), typeRank(b, false));
    else if (clause === "name asc") r = cmpName(a, b);
    else if (clause === "name desc") r = cmpName(b, a);
    else if (clause === "title-date desc")
      r = cmpNullNum(b.titleDate, a.titleDate);
    else if (clause === "title-date asc")
      r = cmpNullNum(a.titleDate, b.titleDate);
    else if (clause === "mtime desc") r = cmpNum(b.mtime, a.mtime);
    else if (clause === "mtime asc") r = cmpNum(a.mtime, b.mtime);
    else if (clause === "ctime desc") r = cmpNum(b.ctime, a.ctime);
    else if (clause === "ctime asc") r = cmpNum(a.ctime, b.ctime);
    if (r !== 0) return r;
  }
  return cmpName(a, b);
}

function typeRank(item: SortableItem, foldersFirst: boolean): number {
  return item.type === "folder"
    ? foldersFirst
      ? 0
      : 1
    : foldersFirst
      ? 1
      : 0;
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

function cmpNullNum(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmpNum(a, b);
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

function parseTitleDate(name: string): number | null {
  const m = name.match(/(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isNaN(t) ? null : t;
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
      text: "右键文件夹 → 排序规则，可设置该文件夹的排序方式。",
    });

    const rules = Object.entries(this.plugin.settings.rules);
    new Setting(containerEl)
      .setName("已配置规则")
      .setDesc(`${rules.length} 个文件夹规则。`);

    for (const [folder, rule] of rules) {
      new Setting(containerEl)
        .setName(displayFolder(folder))
        .setDesc(
          rule.mode === "custom"
            ? rule.customRule ?? "Custom"
            : MODE_LABELS[rule.mode]
        )
        .addButton((btn) =>
          btn.setButtonText("清除").onClick(async () => {
            await this.plugin.clearRule(folder);
            this.display();
          })
        );
    }
  }
}
