# Search Preview

A VS Code extension that enhances the quick open functionality with file previews, similar to Telescope in Neovim. 
This implements the telescope features I use most myself, which are fuzzy finding files and accessing Oldfiles, if you need Live Grep functionality please check out [Periscope](https://github.com/joshmu/periscope).

## Features

- Fuzzy search for files by name with real-time preview
- Search within file contents and see matches highlighted
- Contextual search results that prioritize project files over libraries
- Shows open files and workspace files immediately when opened
- Browse most recently used editors with preview functionality
- Highlighted line and text matches
- Preserves focus on the search dialog while previewing files
- Works like the default quick open but with preview capability
- Doesn't expand the file explorer tree when previewing files
- Returns to your previous file when canceling a search
- Configurable exclusion patterns for directories and files

## How to Use

### Quick Open with Preview (Ctrl+P / Cmd+P)

1. Search `Search Preview: Quick Open with Preview` in the command pallete to open the enhanced quick open dialog (Look below to make keybinds work)
2. You'll immediately see a list of currently open files and other workspace files
3. Type to search for specific files by name using fuzzy matching
4. Type at least 3 characters to also search within file contents
5. Use arrow keys to navigate between results
6. Each result will be previewed in the editor with highlighted matches
7. Press Enter to select and open the file permanently
8. Press Escape to cancel and return to your previous file

### Most Recently Used Editors with Preview (Ctrl+E / Cmd+E)

1. Search `Search Preview Show All Editors by Most Recently Used with Preview` in the command pallete to open the most recently used editors dialog (Look below to make keybinds work)
2. You'll see a list of currently open editors sorted by most recently used
3. Navigate through the list to preview each file
4. Type to filter the list of open editors using fuzzy matching
5. Press Enter to select and open the editor permanently
6. The currently open editor will not show up in this list, so you can just run the command and press enter to go to the last file you were at.

### Configure Search Settings

1. Run the "Configure Search Settings" command from the command palette
2. Or manually edit your `settings.json` file with the options below

## Extension Settings

This extension provides several settings to customize its behavior:

### Search Configuration

- `searchPreview.search.excludeDirectories`: Directories to exclude from search results
  - Default: `["node_modules", ".git", "venv", "env", "dist", "build"]`
- `searchPreview.search.excludePatterns`: File patterns to exclude from search results (glob patterns)
  - Default: `["**/*.min.js", "**/*.log", "**/*.lock", "**/package-lock.json"]`
- `searchPreview.search.maxResults`: Maximum number of search results to display
  - Default: `100`
- `searchPreview.search.contentSearchEnabled`: Whether to search file contents in addition to file names
  - Default: `true`

### Commands

- `search-preview.quickOpenWithPreview`: Quick open files with preview functionality
- `search-preview.showAllEditorsByMostRecentlyUsed`: Show all editors by most recently used with preview
- `search-preview.toggleExplorerAutoReveal`: Toggle whether files are revealed in the explorer when opened
- `search-preview.openSearchSettings`: Open the search settings configuration

## Keybinding Examples

### Normal Keybinds

You can customize the keybindings in your `keybindings.json` file. Here are some examples:

```json
// Use Alt+P for search preview
{
  "key": "alt+p",
  "command": "search-preview.quickOpenWithPreview"
},
// Use Shift+Alt+P for search preview
{
  "key": "shift+alt+p",
  "command": "search-preview.showAllEditorsByMostRecentlyUsed"
},

```

### VIM Extension Integration

If you're using the VSCode Vim extension, you can integrate Search Preview into your Vim workflow by adding these to your `settings.json`:

```json
"vim.leader": " ",
"vim.normalModeKeyBindings": [
  {
    "before": ["<leader>", "f","f"],
    "commands": ["search-preview.quickOpenWithPreview"]
  },
  {
    "before": ["<leader>", "<leader>"],
    "commands": ["search-preview.showAllEditorsByMostRecentlyUsed"]
  }
]
```

## Requirements

- VS Code 1.98.0 or higher

## Known Issues

- Large files may slow down the search preview
- Binary files (images, PDFs, etc.) are excluded from preview but can still be opened

## Release Notes

### 0.0.2

- Added fuzzy search functionality
- Added configurable settings for excluding directories and files
- Added explorer auto-reveal toggle to prevent tree expansion during search
- Fixed issue with explorer tree expanding during previews
- Added restoration of previous file focus when canceling a search
- Content search is now configurable and can be disabled
- Added max results limit settings

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

1. Edit files in the `src` directory to modify the extension
2. Reload the VS Code window to see changes (`Ctrl+R` or `Cmd+R` on Mac)

---

**Enjoy!**
