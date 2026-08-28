# Changelog

All notable changes to the **Properties Viewer** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-08-28

### Added
- **Drag-and-Drop Reordering**: Added interactive drag handles (`⠿`) and drop indicators (`drag-over`, `drag-over-bottom`) to reorder keys and comments directly in the table.
- **Comment Support**: Full support for `#` and `!` comment lines spanning across the table with inline editing.
- **Add Comment Action**: Dedicated `+ Add Comment` button to easily insert comments into the file.
- **Duplicate Key & Index Tracking**: Migrated from dictionary mapping to indexed pair tracking to preserve duplicate keys, exact line ordering, and empty lines.
- **In-Cell Keyboard Shortcuts**:
  - `Tab` key support to insert literal tab characters inside multi-line values without losing focus.
  - Native `Ctrl+Z` / `Cmd+Z` (Undo) and `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z` (Redo) inside inputs and textareas.
- **Enhanced Escaping & Unescaping**: Support for Unicode escapes (`\uXXXX`), escaped colons (`\:`), equals (`\=`), and escaped whitespaces.
- **Multi-line Continuation Normalization**: Physical lines joined with trailing backslashes (`\`) are normalized into multi-line entries on parse.

### Changed
- **Asynchronous Edit Queue**: Implemented `EditQueue` and debounced input events to prevent race conditions and focus loss during fast typing.
- **UI Enhancements**: Refined hover and focus states using native VS Code CSS variables (`--vscode-focusBorder`, `--vscode-input-background`, etc.).

---

## [0.1.1] - 2026-08-28

### Added
- Included repository URL and publisher configuration in `package.json`.
- Added standard MIT `LICENSE` file.

### Fixed
- Fixed extension display name to `Properties viewer`.

---

## [0.1.0] - 2026-08-28

### Added
- Initial release of **Properties Viewer** custom editor (`propertiesCustom.editor`) for `*.properties` files.
- Spreadsheet-like visual table layout for keys and values.
- Real-time syntax highlighting for values using `highlight.js` (vs2015 theme).
- Multi-line value support with automatic serialization and deserialization.
- Add and delete row actions.

