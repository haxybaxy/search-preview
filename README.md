# Search Preview

A VS Code extension that enhances the quick open functionality with file previews, similar to Telescope in Neovim.

## Features

- Quick search for files by name with real-time preview
- Search within file contents and see matches highlighted
- Shows open files and workspace files immediately when opened
- Highlighted line and text matches
- Preserves focus on the search dialog while previewing files
- Works like the default quick open but with preview capability

## How to Use

1. Press `Ctrl+P` (`Cmd+P` on Mac) to open the enhanced quick open dialog
2. You'll immediately see a list of currently open files and other workspace files
3. Type to search for specific files by name
4. Type at least 3 characters to also search within file contents
5. Use arrow keys to navigate between results
6. Each result will be previewed in the editor with highlighted matches
7. Press Enter to select and open the file permanently

## Requirements

- VS Code 1.98.0 or higher

## Extension Settings

- `search-preview.quickOpenWithPreview`: Activate the quick open with preview functionality 
- `search-preview.showCommandPalette`: Show the command palette with preview

## Known Issues

- Content search is limited to 20 files and 30 results for performance reasons
- Large files may slow down the search preview

## Release Notes

### 0.0.1

- Initial release with basic preview functionality
- File name search and basic content search
- Highlighting of matches

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
