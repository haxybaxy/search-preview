# Search Preview

A VS Code extension that enhances the quick open functionality with file previews, similar to Telescope in Neovim.

## Features

- Quick search for files by name with real-time preview
- Search within file contents and see matches highlighted
- Shows open files and workspace files immediately when opened
- Browse most recently used editors with preview functionality
- Highlighted line and text matches
- Preserves focus on the search dialog while previewing files
- Works like the default quick open but with preview capability

## How to Use

### Quick Open with Preview (Ctrl+P / Cmd+P)

1. Press `Ctrl+P` (`Cmd+P` on Mac) to open the enhanced quick open dialog
2. You'll immediately see a list of currently open files and other workspace files
3. Type to search for specific files by name
4. Type at least 3 characters to also search within file contents
5. Use arrow keys to navigate between results
6. Each result will be previewed in the editor with highlighted matches
7. Press Enter to select and open the file permanently

### Most Recently Used Editors with Preview (Ctrl+E / Cmd+E)

1. Press `Ctrl+E` (`Cmd+E` on Mac) to open the most recently used editors dialog
2. You'll see a list of currently open editors sorted by most recently used
3. Navigate through the list to preview each file
4. Type to filter the list of open editors
5. Press Enter to select and open the editor permanently

## Requirements

- VS Code 1.98.0 or higher

## Extension Settings

- `search-preview.quickOpenWithPreview`: Activate the quick open with preview functionality 
- `search-preview.showCommandPalette`: Show the command palette with preview
- `search-preview.showAllEditorsByMostRecentlyUsed`: Show all editors by most recently used with preview

## Known Issues

- Content search is limited to 20 files and 30 results for performance reasons
- Large files may slow down the search preview
- Binary files (images, PDFs, etc.) are excluded from preview but can still be opened

## Release Notes

### 0.0.1

- Initial release with basic preview functionality
- File name search and basic content search
- Highlighting of matches
- Most recently used editors functionality
- Binary file detection and handling

---

## Development

### Building the Extension

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run watch` to start the TypeScript compiler in watch mode
4. Press F5 to launch a new VS Code window with the extension loaded

### Making Changes

1. Edit `src/extension.ts` to modify the extension
2. Reload the VS Code window to see changes (`Ctrl+R` or `Cmd+R` on Mac)

---

**Enjoy!**
