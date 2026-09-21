# Changelog

All notable changes to Workbench Explorer Sort are documented here.

## Unreleased

### Added

- Automated lint, test, and build checks.
- Unit coverage for settings validation, folder rename/delete lifecycle, and all sort modes.
- A polished English product demo and refreshed documentation.

### Changed

- Folder rules now migrate with renamed folders and are removed when folders are deleted.
- Settings writes are serialized to prevent concurrent updates from overwriting each other.
- The settings page now uses Obsidian's current settings API.
- The minimum supported Obsidian version is now 1.13.0.

### Fixed

- Invalid saved rule data is ignored safely.
- Plugin unload no longer overwrites a newer File Explorer method replacement.
