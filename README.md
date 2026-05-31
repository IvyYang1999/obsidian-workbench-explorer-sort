# Workbench Explorer Sort

Direct sorting controls for Obsidian's File Explorer.

## Features

- Adds a **Sort rules** submenu to File Explorer right-click menus.
- Supports manual ordering with direct drag-and-drop inside the file tree.
- Supports common Finder-style rules: name, created time, modified time, and title date.
- Stores rules locally in the plugin data file.
- Includes a CLI for agents and scripts.

## Development

```bash
npm install
npm run build
```

## CLI

From a vault root:

```bash
node .obsidian/plugins/workbench-explorer-sort/cli.js list
node .obsidian/plugins/workbench-explorer-sort/cli.js set "日记" manual
node .obsidian/plugins/workbench-explorer-sort/cli.js order "日记" "后飞书日记" "飞书打工日记" "晚记"
node .obsidian/plugins/workbench-explorer-sort/cli.js clear "日记"
```

## License

MIT
