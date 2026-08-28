# Properties Viewer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

A visual table editor for `.properties` files in Visual Studio Code. It provides a structured table interface for viewing and editing key-value pairs, comments, and multi-line values, with automatic syntax highlighting and drag-and-drop reordering.

## Features

- **Table Editor**: View and edit `.properties` files in a structured table layout.
- **Syntax Highlighting**: Real-time code highlighting for values using [highlight.js](https://highlightjs.org/) (JSON, SQL, XML, shell, URLs, and code snippets).
- **Multi-line & Tab Support**: Edit multi-line values directly in textareas. Press `Tab` inside values to insert tab indentations.
- **Comments & Blank Lines**: Comments (`#` and `!`) span the full row width and can be edited inline.
- **Drag-and-Drop Reordering**: Drag rows using the left handle (`⠿`) to reorder entries in the document.
- **Native Undo/Redo Integration**: Document edits use an asynchronous queue (`EditQueue`) and VS Code workspace edits, preserving the native undo/redo history.
- **Escaping & Serialization**: Handles standard `.properties` escaping including `\n`, `\t`, `\r`, `\:`, `\=`, `\\`, Unicode sequences (`\uXXXX`), and multi-line continuation backslashes (`\`).
- **VS Code Theme Integration**: Adapts colors, fonts, and borders to the active VS Code theme.

## Usage

### Opening `.properties` Files

`.properties` files open by default with the **Properties Table Editor**.

To switch between views, right-click the file tab or explorer entry and choose **"Open With..."**, then select **"Properties Table Editor"** or **"Text Editor"**.

### Editing

- **Edit Keys & Values**: Click any field and edit directly. Changes are debounced and saved to the document.
- **Add Property**: Click **`+ Add Property`** at the bottom.
- **Add Comment**: Click **`+ Add Comment`** to append a comment row (`# `).
- **Delete Row**: Click the **`✕`** button on the right side of the row.
- **Reorder**: Drag the handle (`⠿`) on the left side of a row up or down.

## Keyboard Shortcuts

| Shortcut                                  | Context        | Action                    |
| :---------------------------------------- | :------------- | :------------------------ |
| `Tab`                                     | Value textarea | Insert literal tab (`\t`) |
| `Ctrl+Z` / `Cmd+Z`                        | Table inputs   | Undo                      |
| `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Table inputs   | Redo                      |

## Specifications & Behavior

- **Key-Value Separators**: Supports both `=` and `:` delimiters, preserving original spacing around keys.
- **Line Continuations**: Multi-line entries ending with trailing `\` are flattened into editable multi-line values on load and correctly serialized.
- **Duplicate Keys**: Preserves duplicate keys in their exact file order using indexed line mapping.

## License

[MIT](LICENSE)
