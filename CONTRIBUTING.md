# Contributing

Thanks for helping improve Workbench Explorer Sort.

## Before opening a pull request

1. Create a focused branch from `main`.
2. Keep the plugin's scope narrow: native File Explorer sorting, per folder.
3. Add or update tests for behavior changes.
4. Run the complete local gate:

```bash
npm ci
npm run check
```

For user-visible changes, include a short reproduction path and a screenshot or recording. Do not include private vault content in test fixtures or media.

## Reporting a bug

Include your Obsidian version, plugin version, operating system, the selected sort rule, and the smallest folder structure that reproduces the issue. Please remove private file and folder names before sharing logs or screenshots.
