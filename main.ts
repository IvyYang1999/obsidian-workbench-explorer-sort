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

type SortMode =
  | "manual"
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
  order?: string[];
  customRule?: string;
}

interface WorkbenchExplorerSortSettings {
  rules: Record<string, SortRule>;
}

interface DragState {
  sourcePath: string;
  parentPath: string;
}

interface SortableItem {
  path: string;
  name: string;
  type: "file" | "folder";
  ctime: number;
  mtime: number;
  titleDate: number | null;
  originalIndex: number;
  el: HTMLElement;
}

const DEFAULT_SETTINGS: WorkbenchExplorerSortSettings = {
  rules: {},
};

const MODE_LABELS: Record<SortMode, string> = {
  manual: "手动排序",
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

export default class WorkbenchExplorerSortPlugin extends Plugin {
  settings: WorkbenchExplorerSortSettings = DEFAULT_SETTINGS;
  private dragState: DragState | null = null;
  private dropTargetEl: HTMLElement | null = null;
  private applyTimer: number | null = null;
  private observer: MutationObserver | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new WorkbenchExplorerSortSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        this.addSortMenu(menu, file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        if (files.length > 0) {
          this.addSortMenu(menu, files[0]);
        }
      })
    );

    this.registerDomEvent(document, "dragstart", this.onDragStart, {
      capture: true,
    });
    this.registerDomEvent(document, "dragover", this.onDragOver, {
      capture: true,
    });
    this.registerDomEvent(document, "drop", this.onDrop, { capture: true });
    this.registerDomEvent(document, "dragend", this.onDragEnd, {
      capture: true,
    });

    this.registerEvent(this.app.vault.on("create", () => this.requestApplySort()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestApplySort()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestApplySort()));

    this.app.workspace.onLayoutReady(() => {
      this.startFileExplorerObserver();
      this.requestApplySort();
    });

    console.log("Workbench Explorer Sort loaded");
  }

  onunload() {
    this.clearDropIndicator();
    this.observer?.disconnect();
    if (this.applyTimer !== null) {
      window.clearTimeout(this.applyTimer);
    }
    console.log("Workbench Explorer Sort unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.rules ??= {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async setRule(folderPath: string, rule: SortRule) {
    this.settings.rules[normalizeFolderPath(folderPath)] = rule;
    await this.saveSettings();
    this.requestApplySort();
  }

  async clearRule(folderPath: string) {
    delete this.settings.rules[normalizeFolderPath(folderPath)];
    await this.saveSettings();
    this.requestApplySort();
  }

  private addSortMenu(menu: Menu, file: TAbstractFile) {
    const folderPath = this.contextFolderPath(file);
    const current = this.settings.rules[folderPath];

    menu.addItem((item) => {
      item.setTitle("排序规则").setIcon("arrow-up-down");
      const submenu = getSubmenu(item);
      if (!submenu) {
        item.onClick((evt) => this.openSortPopup(evt, folderPath));
        return;
      }

      this.populateSortMenu(submenu, folderPath, current);
    });
  }

  private openSortPopup(evt: MouseEvent | KeyboardEvent, folderPath: string) {
    const menu = new Menu();
    this.populateSortMenu(menu, folderPath, this.settings.rules[folderPath]);
    const mouseEvent = evt instanceof MouseEvent ? evt : null;
    if (mouseEvent) {
      menu.showAtMouseEvent(mouseEvent);
    } else {
      menu.showAtPosition({ x: 0, y: 0 });
    }
  }

  private populateSortMenu(
    menu: Menu,
    folderPath: string,
    current: SortRule | undefined
  ) {
    const modes: SortMode[] = [
      "manual",
      "name-asc",
      "name-desc",
      "ctime-desc",
      "ctime-asc",
      "mtime-desc",
      "mtime-asc",
      "title-date-desc",
      "title-date-asc",
    ];

    for (const mode of modes) {
      menu.addItem((item) =>
        item
          .setTitle(MODE_LABELS[mode])
          .setChecked(current?.mode === mode)
          .onClick(async () => {
            await this.setRule(folderPath, this.buildRule(folderPath, mode));
            new Notice(`排序规则：${displayFolder(folderPath)} -> ${MODE_LABELS[mode]}`);
          })
      );
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("自定义规则...").setIcon("braces").onClick(async () => {
        const rule = window.prompt(
          [
            "输入排序规则，使用逗号分隔。",
            "示例：folders-first, title-date desc, name asc",
            "可用项：folders-first, files-first, name asc/desc, title-date asc/desc, mtime asc/desc, ctime asc/desc",
          ].join("\n"),
          current?.customRule ?? "folders-first, title-date desc, name asc"
        );
        if (!rule) {
          return;
        }
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

  private buildRule(folderPath: string, mode: SortMode): SortRule {
    if (mode !== "manual") {
      return { mode };
    }

    return {
      mode,
      order: this.getFolderChildren(folderPath).map((file) => file.name),
    };
  }

  private contextFolderPath(file: TAbstractFile): string {
    if (file instanceof TFolder) {
      return normalizeFolderPath(file.path);
    }
    return normalizeFolderPath(file.parent?.path ?? "");
  }

  private startFileExplorerObserver() {
    this.observer?.disconnect();
    const workspace = document.querySelector(".workspace");
    if (!workspace) {
      return;
    }

    this.observer = new MutationObserver(() => this.requestApplySort());
    this.observer.observe(workspace, { childList: true, subtree: true });
    this.register(() => this.observer?.disconnect());
  }

  private requestApplySort() {
    if (this.applyTimer !== null) {
      window.clearTimeout(this.applyTimer);
    }
    this.applyTimer = window.setTimeout(() => {
      this.applyTimer = null;
      this.applyAllSorts();
    }, 60);
  }

  private applyAllSorts() {
    for (const [folderPath, rule] of Object.entries(this.settings.rules)) {
      this.applySort(normalizeFolderPath(folderPath), rule);
    }
  }

  private applySort(folderPath: string, rule: SortRule) {
    const container = this.findFolderChildrenContainer(folderPath);
    if (!container) {
      return;
    }

    const items = this.collectSortableItems(container);
    if (items.length <= 1) {
      return;
    }

    const sorted = [...items].sort((a, b) => this.compareItems(a, b, rule));
    if (items.every((item, index) => item.path === sorted[index]?.path)) {
      return;
    }

    for (const item of sorted) {
      container.appendChild(item.el);
    }
  }

  private compareItems(a: SortableItem, b: SortableItem, rule: SortRule): number {
    if (rule.mode === "manual") {
      const order = rule.order ?? [];
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.originalIndex - b.originalIndex;
    }

    if (rule.mode === "custom") {
      return compareByCustomRule(a, b, rule.customRule ?? "");
    }

    return compareByMode(a, b, rule.mode);
  }

  private collectSortableItems(container: HTMLElement): SortableItem[] {
    return Array.from(container.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .map((el, originalIndex) => {
        const path = this.getPathForTreeItem(el);
        if (!path) {
          return null;
        }
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) {
          return null;
        }

        const stats = getStats(file);
        return {
          path,
          name: file.name,
          type: file instanceof TFolder ? "folder" : "file",
          ctime: stats.ctime,
          mtime: stats.mtime,
          titleDate: parseTitleDate(file.name),
          originalIndex,
          el,
        };
      })
      .filter((item): item is SortableItem => Boolean(item));
  }

  private findFolderChildrenContainer(folderPath: string): HTMLElement | null {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) {
      return document.querySelector<HTMLElement>(
        ".workspace-leaf-content[data-type='file-explorer'] .nav-files-container"
      );
    }

    const title = findTreeTitleByPath(normalized, "folder");
    const folderEl = title?.closest<HTMLElement>(".nav-folder");
    if (!folderEl) {
      return null;
    }

    return Array.from(folderEl.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains("nav-folder-children")
    ) ?? null;
  }

  private getPathForTreeItem(el: HTMLElement): string | null {
    const title = Array.from(el.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        (child.classList.contains("nav-file-title") ||
          child.classList.contains("nav-folder-title"))
    );

    return title?.dataset.path ?? null;
  }

  private getFolderChildren(folderPath: string): TAbstractFile[] {
    const normalized = normalizeFolderPath(folderPath);
    const folder = normalized
      ? this.app.vault.getAbstractFileByPath(normalized)
      : this.app.vault.getRoot();

    if (folder instanceof TFolder) {
      return [...folder.children];
    }

    return [];
  }

  private onDragStart = (event: DragEvent) => {
    const path = this.findExplorerPath(event.target);
    if (!path) {
      this.dragState = null;
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    const parentPath = normalizeFolderPath(file?.parent?.path ?? "");
    this.dragState = { sourcePath: path, parentPath };
  };

  private onDragOver = (event: DragEvent) => {
    const target = this.getManualDropTarget(event);
    if (!target) {
      this.clearDropIndicator();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDropEffect(event, "move");
    this.showDropIndicator(target.el, target.after);
  };

  private onDrop = async (event: DragEvent) => {
    const target = this.getManualDropTarget(event);
    if (!target || !this.dragState) {
      this.clearDropIndicator();
      this.dragState = null;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    await this.saveManualDropOrder(
      this.dragState.parentPath,
      this.dragState.sourcePath,
      target.path,
      target.after
    );
    this.clearDropIndicator();
    this.dragState = null;
  };

  private onDragEnd = () => {
    this.clearDropIndicator();
    this.dragState = null;
  };

  private getManualDropTarget(
    event: DragEvent
  ): { path: string; el: HTMLElement; after: boolean } | null {
    if (!this.dragState) {
      return null;
    }

    const rule = this.settings.rules[this.dragState.parentPath];
    if (rule?.mode !== "manual") {
      return null;
    }

    const title = this.findTreeTitle(event.target);
    const path = title?.dataset.path;
    if (!title || !path || path === this.dragState.sourcePath) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      return null;
    }

    const parentPath = normalizeFolderPath(file.parent?.path ?? "");
    if (parentPath !== this.dragState.parentPath) {
      return null;
    }

    const rect = title.getBoundingClientRect();
    return {
      path,
      el: title,
      after: event.clientY > rect.top + rect.height / 2,
    };
  }

  private async saveManualDropOrder(
    parentPath: string,
    sourcePath: string,
    targetPath: string,
    after: boolean
  ) {
    const container = this.findFolderChildrenContainer(parentPath);
    const childPaths = container
      ? this.collectSortableItems(container).map((item) => item.path)
      : this.getFolderChildren(parentPath).map((file) => file.path);

    const next = childPaths.filter((path) => path !== sourcePath);
    const targetIndex = next.indexOf(targetPath);
    if (targetIndex === -1) {
      return;
    }
    next.splice(after ? targetIndex + 1 : targetIndex, 0, sourcePath);

    const order = next
      .map((path) => this.app.vault.getAbstractFileByPath(path)?.name)
      .filter((name): name is string => Boolean(name));

    const existing = this.settings.rules[parentPath] ?? { mode: "manual" };
    this.settings.rules[parentPath] = { ...existing, mode: "manual", order };
    await this.saveSettings();
    this.requestApplySort();
  }

  private findExplorerPath(target: EventTarget | null): string | null {
    return this.findTreeTitle(target)?.dataset.path ?? null;
  }

  private findTreeTitle(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    return target.closest<HTMLElement>(
      ".nav-file-title[data-path], .nav-folder-title[data-path]"
    );
  }

  private showDropIndicator(el: HTMLElement, after: boolean) {
    if (this.dropTargetEl !== el) {
      this.clearDropIndicator();
      this.dropTargetEl = el;
    } else {
      el.classList.remove(
        "workbench-explorer-sort-drop-before",
        "workbench-explorer-sort-drop-after"
      );
    }

    el.classList.add(
      after
        ? "workbench-explorer-sort-drop-after"
        : "workbench-explorer-sort-drop-before"
    );
  }

  private clearDropIndicator() {
    this.dropTargetEl?.classList.remove(
      "workbench-explorer-sort-drop-before",
      "workbench-explorer-sort-drop-after"
    );
    this.dropTargetEl = null;
  }
}

function getSubmenu(item: unknown): Menu | null {
  const candidate = item as { setSubmenu?: () => Menu };
  return typeof candidate.setSubmenu === "function" ? candidate.setSubmenu() : null;
}

function normalizeFolderPath(path: string): string {
  return path === "/" ? "" : path.replace(/^\/+|\/+$/g, "");
}

function displayFolder(path: string): string {
  return path || "Vault root";
}

function findTreeTitleByPath(
  path: string,
  type: "file" | "folder"
): HTMLElement | null {
  const cls = type === "folder" ? "nav-folder-title" : "nav-file-title";
  return document.querySelector<HTMLElement>(
    `.${cls}[data-path="${cssEscape(path)}"]`
  );
}

function cssEscape(value: string): string {
  const escapeFn = (window as unknown as { CSS?: { escape?: (s: string) => string } })
    .CSS?.escape;
  if (escapeFn) {
    return escapeFn(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function getStats(file: TAbstractFile): { ctime: number; mtime: number } {
  if (file instanceof TFile) {
    return { ctime: file.stat.ctime, mtime: file.stat.mtime };
  }

  if (file instanceof TFolder) {
    const childStats = file.children.map(getStats);
    if (childStats.length === 0) {
      return { ctime: 0, mtime: 0 };
    }

    return {
      ctime: Math.min(...childStats.map((stat) => stat.ctime || Infinity)),
      mtime: Math.max(...childStats.map((stat) => stat.mtime || 0)),
    };
  }

  return { ctime: 0, mtime: 0 };
}

function parseTitleDate(name: string): number | null {
  const match = name.match(/(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = new Date(year, month - 1, day).getTime();
  return Number.isNaN(time) ? null : time;
}

function compareByMode(a: SortableItem, b: SortableItem, mode: SortMode): number {
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
    case "title-date-desc":
      return compareNullableNumber(b.titleDate, a.titleDate) || compareName(a, b);
    case "title-date-asc":
      return compareNullableNumber(a.titleDate, b.titleDate) || compareName(a, b);
    default:
      return a.originalIndex - b.originalIndex;
  }
}

function compareByCustomRule(
  a: SortableItem,
  b: SortableItem,
  customRule: string
): number {
  const clauses = customRule
    .split(",")
    .map((clause) => clause.trim().toLowerCase())
    .filter(Boolean);

  for (const clause of clauses) {
    let result = 0;
    if (clause === "folders-first") {
      result = compareNumber(typeRank(a, true), typeRank(b, true));
    } else if (clause === "files-first") {
      result = compareNumber(typeRank(a, false), typeRank(b, false));
    } else if (clause === "name asc") {
      result = compareName(a, b);
    } else if (clause === "name desc") {
      result = compareName(b, a);
    } else if (clause === "title-date desc") {
      result = compareNullableNumber(b.titleDate, a.titleDate);
    } else if (clause === "title-date asc") {
      result = compareNullableNumber(a.titleDate, b.titleDate);
    } else if (clause === "mtime desc") {
      result = compareNumber(b.mtime, a.mtime);
    } else if (clause === "mtime asc") {
      result = compareNumber(a.mtime, b.mtime);
    } else if (clause === "ctime desc") {
      result = compareNumber(b.ctime, a.ctime);
    } else if (clause === "ctime asc") {
      result = compareNumber(a.ctime, b.ctime);
    }

    if (result !== 0) {
      return result;
    }
  }

  return compareName(a, b);
}

function typeRank(item: SortableItem, foldersFirst: boolean): number {
  if (item.type === "folder") {
    return foldersFirst ? 0 : 1;
  }
  return foldersFirst ? 1 : 0;
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

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return compareNumber(a, b);
}

function setDropEffect(event: DragEvent, effect: DataTransfer["dropEffect"]) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = effect;
  }
}

class WorkbenchExplorerSortSettingTab extends PluginSettingTab {
  plugin: WorkbenchExplorerSortPlugin;

  constructor(app: App, plugin: WorkbenchExplorerSortPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Workbench Explorer Sort" });
    containerEl.createEl("p", {
      text: "Use the File Explorer right-click menu to set sorting rules for a folder.",
    });

    const rules = Object.entries(this.plugin.settings.rules);
    new Setting(containerEl)
      .setName("Active rules")
      .setDesc(`${rules.length} folder rule${rules.length === 1 ? "" : "s"} configured.`);

    for (const [folder, rule] of rules) {
      new Setting(containerEl)
        .setName(displayFolder(folder))
        .setDesc(rule.mode === "custom" ? rule.customRule ?? "Custom" : MODE_LABELS[rule.mode])
        .addButton((button) =>
          button.setButtonText("Clear").onClick(async () => {
            await this.plugin.clearRule(folder);
            this.display();
          })
        );
    }
  }
}
