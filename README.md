# Workbench Explorer Sort

Simple sorting controls for Obsidian's File Explorer.

Workbench Explorer Sort adds per-folder sorting rules to the native Obsidian
file tree. Set a rule from the File Explorer context menu, and the plugin keeps
that folder ordered by name, created time, or modified time.

## Features

- Adds a **Sort rules** submenu to File Explorer right-click menus.
- Supports common Finder-style rules: name, created time, and modified time.
- Stores rules locally in the plugin data file.
- Includes a CLI for agents and scripts.

## Usage

Right-click a folder in Obsidian's File Explorer and choose **Sort rules**.

Available rules:

- **Name**: A to Z or Z to A.
- **Created time**: newest first or oldest first.
- **Modified time**: newest first or oldest first.

## CLI

The CLI edits the same local plugin data file that the Obsidian UI uses.
Run commands from a vault root:

```bash
node .obsidian/plugins/workbench-explorer-sort/cli.js list
node .obsidian/plugins/workbench-explorer-sort/cli.js set "日记" name-desc
node .obsidian/plugins/workbench-explorer-sort/cli.js clear "日记"
```

Modes:

- `name-asc`
- `name-desc`
- `ctime-desc`
- `ctime-asc`
- `mtime-desc`
- `mtime-asc`

## Installation

Install from Obsidian's Community Plugins browser after the plugin is accepted.

For manual installation, download `main.js`, `manifest.json`, and `styles.css`
from the latest release, then place them in:

```text
<vault>/.obsidian/plugins/workbench-explorer-sort/
```

## Development

```bash
npm install
npm run build
```

## License

MIT
