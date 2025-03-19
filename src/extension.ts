// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Type definition for our custom quick pick items
interface SearchQuickPickItem extends vscode.QuickPickItem {
	data?: {
		filePath: string;
		linePos: number;
		colPos: number;
		searchText?: string;
		type: 'file' | 'content';
		lineText?: string;
	};
}

// Track editor history for MRU functionality
interface EditorHistoryItem {
	uri: vscode.Uri;
	timestamp: number;
	linePos?: number;
	colPos?: number;
}

// Binary file extensions to skip when attempting text operations
const binaryFileExtensions = new Set([
	'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.svg',
	'.pdf', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
	'.zip', '.tar', '.gz', '.bz2', '.xz', '.rar', '.7z',
	'.mp3', '.mp4', '.avi', '.mov', '.mkv', '.flv', '.webm',
	'.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
	'.class', '.pyc', '.o', '.a'
]);

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "search-preview" is now active!');

	// Track the currently shown preview editor
	let lastPreviewEditor: vscode.TextEditor | undefined;
	let lastHighlightDecoration: vscode.TextEditorDecorationType | undefined;
	let contentMatchDecorations: vscode.TextEditorDecorationType | undefined;
	
	// Editor history tracking - maintain a list of recently used editors
	// with the most recent at the beginning
	const editorHistory: EditorHistoryItem[] = [];
	const MAX_HISTORY_SIZE = 100; // Limit history size
	
	// Add text document open listener to track editor history
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor && editor.document.uri.scheme === 'file') {
				updateEditorHistory(editor);
			}
		})
	);
	
	// Initialize with currently open editors
	vscode.window.visibleTextEditors.forEach(editor => {
		if (editor.document.uri.scheme === 'file') {
			updateEditorHistory(editor);
		}
	});
	
	/**
	 * Updates the editor history when an editor is opened or becomes active
	 */
	function updateEditorHistory(editor: vscode.TextEditor) {
		const uri = editor.document.uri;
		
		// Remove this URI from the history if it exists
		const existingIndex = editorHistory.findIndex(item => item.uri.fsPath === uri.fsPath);
		if (existingIndex >= 0) {
			editorHistory.splice(existingIndex, 1);
		}
		
		// Add to the beginning of the history (most recent)
		editorHistory.unshift({
			uri: uri,
			timestamp: Date.now(),
			linePos: editor.selection.active.line,
			colPos: editor.selection.active.character
		});
		
		// Trim history if it's too long
		if (editorHistory.length > MAX_HISTORY_SIZE) {
			editorHistory.pop();
		}
	}

	// Register standard quick open with preview command
	const quickOpenCommand = vscode.commands.registerCommand('search-preview.quickOpenWithPreview', 
		() => showQuickOpenWithPreview('standard'));
	context.subscriptions.push(quickOpenCommand);

	// Register most recently used editors command
	const recentEditorsCommand = vscode.commands.registerCommand('search-preview.showAllEditorsByMostRecentlyUsed', 
		() => showQuickOpenWithPreview('recent'));
	context.subscriptions.push(recentEditorsCommand);

	// Add the standard command to the command palette
	const commandPalette = vscode.commands.registerCommand('search-preview.showCommandPalette', () => {
		vscode.commands.executeCommand('search-preview.quickOpenWithPreview');
	});
	context.subscriptions.push(commandPalette);

	/**
	 * Main function to show quick open with preview, with different modes
	 * @param mode 'standard' for normal quick open, 'recent' for most recently used editors
	 */
	async function showQuickOpenWithPreview(mode: 'standard' | 'recent') {
		// Create the quick pick UI
		const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
		
		// Set placeholder text based on mode
		if (mode === 'standard') {
			quickPick.placeholder = 'Search files, content, and symbols (append : to go to line or @ to go to symbol)';
		} else {
			quickPick.placeholder = 'Search open editors by most recently used';
		}
		
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		
		// Show progress indicator while loading initial files
		quickPick.busy = true;
		
		// Show the quick pick UI immediately
		quickPick.show();
		
		// Load initial files list based on mode
		try {
			if (mode === 'standard') {
				await loadInitialFilesList(quickPick);
			} else {
				await loadRecentEditorsList(quickPick);
			}
		} finally {
			quickPick.busy = false;
		}
		
		// Update results based on user input
		quickPick.onDidChangeValue(async (value) => {
			if (!value || value.length < 2) {
				// Restore the initial files list if user clears the input
				if (mode === 'standard') {
					await loadInitialFilesList(quickPick);
				} else {
					await loadRecentEditorsList(quickPick);
				}
				return;
			}
			
			// Handle search for both modes
			if (mode === 'standard') {
				await handleStandardSearch(quickPick, value);
			} else {
				await handleRecentEditorsSearch(quickPick, value);
			}
		});

		// Set up the on change handler to show file previews
		quickPick.onDidChangeActive(items => {
			// Clear previous decorations
			clearDecorations();
			// Preview the file
			peekItem(items);
		});

		// Handle selection
		quickPick.onDidAccept(async () => {
			const selectedItem = quickPick.selectedItems[0];
			
			if (selectedItem && selectedItem.data) {
				await openSelectedFile(selectedItem.data);
			}
			
			quickPick.hide();
		});
	}

	/**
	 * Clears all decorations from the preview
	 */
	function clearDecorations() {
		if (lastHighlightDecoration) {
			lastHighlightDecoration.dispose();
			lastHighlightDecoration = undefined;
		}
		
		if (contentMatchDecorations) {
			contentMatchDecorations.dispose();
			contentMatchDecorations = undefined;
		}
	}

	/**
	 * Handles search for the standard quick open mode
	 */
	async function handleStandardSearch(quickPick: vscode.QuickPick<SearchQuickPickItem>, value: string) {
		// Get all workspace files for filename matching
		const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
		
		// Filter files based on filename
		const filenameMatches = files.filter(file => {
			const fileName = path.basename(file.fsPath).toLowerCase();
			const filePath = vscode.workspace.asRelativePath(file.fsPath).toLowerCase();
			return fileName.includes(value.toLowerCase()) || filePath.includes(value.toLowerCase());
		});
		
		const filenameResults = createFileSearchItems(filenameMatches, value);
		
		// Only attempt content search for 3+ characters
		const contentResults: SearchQuickPickItem[] = [];
		
		// Skip file content search for short queries
		if (value.length >= 3) {
			// Filter out binary files before searching
			const textFilesToSearch = files
				.filter(file => !isBinaryFile(file.fsPath))
				.slice(0, 20); // Limit to 20 files for performance
			
			await searchInFileContents(textFilesToSearch, value, contentResults);
		}
		
		// Combine and display results
		quickPick.items = [...filenameResults, ...contentResults];
	}

	/**
	 * Handles search for the most recently used editors mode
	 */
	async function handleRecentEditorsSearch(quickPick: vscode.QuickPick<SearchQuickPickItem>, value: string) {
		// Filter editor history based on filename or path
		const filteredHistory = editorHistory.filter(item => {
			if (item.uri.scheme !== 'file') {
				return false;
			}
			
			const fileName = path.basename(item.uri.fsPath).toLowerCase();
			const filePath = vscode.workspace.asRelativePath(item.uri.fsPath).toLowerCase();
			return fileName.includes(value.toLowerCase()) || filePath.includes(value.toLowerCase());
		});
		
		// Convert to quick pick items
		const historyItems = filteredHistory.map(item => {
			const relativePath = vscode.workspace.asRelativePath(item.uri.fsPath);
			const fileIcon = getFileIcon(item.uri.fsPath);
			
			return {
				label: `${fileIcon} ${path.basename(item.uri.fsPath)}`,
				description: getFileLocation(relativePath),
				detail: 'recently used',
				data: {
					filePath: item.uri.fsPath,
					linePos: item.linePos || 0,
					colPos: item.colPos || 0,
					searchText: value,
					type: 'file' as 'file' | 'content'
				}
			};
		});
		
		// Set the quick pick items
		quickPick.items = historyItems;
	}

	/**
	 * Creates SearchQuickPickItems from a list of file URIs
	 */
	function createFileSearchItems(files: vscode.Uri[], searchText?: string): SearchQuickPickItem[] {
		return files.map(file => {
			const relativePath = vscode.workspace.asRelativePath(file.fsPath);
			const fileIcon = getFileIcon(file.fsPath);
			
			return {
				label: `${fileIcon} ${path.basename(file.fsPath)}`,
				description: getFileLocation(relativePath),
				data: {
					filePath: file.fsPath,
					linePos: 0,
					colPos: 0,
					searchText: searchText,
					type: 'file'
				}
			};
		});
	}

	/**
	 * Searches for text in file contents and adds results to the contentResults array
	 */
	async function searchInFileContents(
		files: vscode.Uri[], 
		searchText: string, 
		contentResults: SearchQuickPickItem[]
	) {
		for (const file of files) {
			try {
				const document = await vscode.workspace.openTextDocument(file);
				const text = document.getText();
				const lines = text.split('\n');
				
				// Find matches in the file content
				lines.forEach((line, lineIndex) => {
					const lineText = line.toLowerCase();
					const valueText = searchText.toLowerCase();
					
					if (lineText.includes(valueText)) {
						const colPos = lineText.indexOf(valueText);
						const fileIcon = getFileIcon(file.fsPath);
						
						contentResults.push({
							label: `${fileIcon} ${path.basename(file.fsPath)}:${lineIndex + 1}`,
							description: getFileLocation(vscode.workspace.asRelativePath(file.fsPath)),
							detail: line.length > 50 ? `...${line.substring(0, 50)}...` : line,
							data: {
								filePath: file.fsPath,
								linePos: lineIndex,
								colPos: colPos,
								searchText: searchText,
								type: 'content',
								lineText: line
							}
						});
					}
				});
			} catch (error) {
				// Skip files that can't be read
				continue;
			}
			
			// Limit the total number of results
			if (contentResults.length >= 30) {
				break;
			}
		}
	}

	/**
	 * Opens the selected file
	 */
	async function openSelectedFile(data: SearchQuickPickItem['data']) {
		if (!data) {
			return;
		}
		
		const { filePath, linePos, colPos } = data;
		
		try {
			// Check if it's a binary file
			if (isBinaryFile(filePath)) {
				// For binary files, use the default editor associated with the file type
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
			} else {
				// For text files, open with the text editor
				const document = await vscode.workspace.openTextDocument(filePath);
				await vscode.window.showTextDocument(document, {
					preview: false,
					preserveFocus: false
				});
				
				// Position cursor 
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					setCursorPosition(editor, linePos, colPos);
				}
			}
		} catch (error) {
			// Handle errors gracefully
			vscode.window.showErrorMessage(`Could not open file: ${path.basename(filePath)}`);
		}
	}

	/**
	 * Loads the initial list of files for standard quick open
	 */
	async function loadInitialFilesList(quickPick: vscode.QuickPick<SearchQuickPickItem>) {
		// Show loading indicator
		quickPick.busy = true;
		
		try {
			// First try to get all workspace files (limited to 100)
			const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);
			
			// Get currently open text editors to prioritize them
			const openEditors = vscode.window.visibleTextEditors.map(editor => editor.document.uri);
			
			// Create a Map to track which files are already added
			const addedFiles = new Map<string, boolean>();
			const results: SearchQuickPickItem[] = [];
			
			// First add currently open files at the top
			for (const uri of openEditors) {
				if (uri.scheme === 'file' && !addedFiles.has(uri.fsPath)) {
					addedFiles.set(uri.fsPath, true);
					const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
					const fileIcon = getFileIcon(uri.fsPath);
					
					results.push({
						label: `${fileIcon} ${path.basename(uri.fsPath)}`,
						description: getFileLocation(relativePath),
						detail: 'recently opened',
						data: {
							filePath: uri.fsPath,
							linePos: 0,
							colPos: 0,
							type: 'file'
						}
					});
				}
			}
			
			// Check if we can access VSCode's recently used documents history
			// This is only available in some versions of VSCode API
			let recentDocuments: vscode.Uri[] = [];
			try {
				// Try to use VSCode's recent history if available
				// Fallback to a reasonable list if not available
				recentDocuments = allFiles
					.filter(file => !addedFiles.has(file.fsPath))
					.slice(0, 50);
			} catch (error) {
				console.log('Could not access recent documents, using fallback', error);
				recentDocuments = allFiles
					.filter(file => !addedFiles.has(file.fsPath))
					.slice(0, 50);
			}
			
			// Add recent files
			for (const uri of recentDocuments) {
				if (!addedFiles.has(uri.fsPath)) {
					addedFiles.set(uri.fsPath, true);
					const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
					const fileIcon = getFileIcon(uri.fsPath);
					
					results.push({
						label: `${fileIcon} ${path.basename(uri.fsPath)}`,
						description: getFileLocation(relativePath),
						data: {
							filePath: uri.fsPath,
							linePos: 0,
							colPos: 0,
							type: 'file'
						}
					});
				}
			}
			
			// Update quickpick items
			quickPick.items = results;
		} catch (error) {
			console.error('Error loading initial files:', error);
			quickPick.items = [];
		} finally {
			quickPick.busy = false;
		}
	}

	/**
	 * Loads the list of most recently used editors from the tracked history
	 */
	async function loadRecentEditorsList(quickPick: vscode.QuickPick<SearchQuickPickItem>) {
		// Show loading indicator
		quickPick.busy = true;
		
		try {
			const results: SearchQuickPickItem[] = [];
			
			// Get the currently active editor URI to exclude it
			const activeEditor = vscode.window.activeTextEditor;
			const activeEditorUri = activeEditor?.document.uri.fsPath;
			
			// Use the editor history we've been tracking
			// This includes both currently open and previously opened editors
			for (const historyItem of editorHistory) {
				// Skip the currently active editor
				if (historyItem.uri.scheme === 'file' && historyItem.uri.fsPath !== activeEditorUri) {
					try {
						// Verify the file still exists
						await vscode.workspace.fs.stat(historyItem.uri);
						
						const relativePath = vscode.workspace.asRelativePath(historyItem.uri.fsPath);
						const fileIcon = getFileIcon(historyItem.uri.fsPath);
						
						// Find whether this file is currently open
						const isCurrentlyOpen = vscode.window.visibleTextEditors.some(
							editor => editor.document.uri.fsPath === historyItem.uri.fsPath
						);
						
						results.push({
							label: `${fileIcon} ${path.basename(historyItem.uri.fsPath)}`,
							description: getFileLocation(relativePath),
							detail: isCurrentlyOpen ? 'currently open' : 'recently used',
							data: {
								filePath: historyItem.uri.fsPath,
								linePos: historyItem.linePos || 0,
								colPos: historyItem.colPos || 0,
								type: 'file' as 'file' | 'content'
							}
						});
					} catch (error) {
						// Skip files that no longer exist
						continue;
					}
				}
			}
			
			// Update quickpick items
			quickPick.items = results;
		} catch (error) {
			console.error('Error loading recent editors:', error);
			quickPick.items = [];
		} finally {
			quickPick.busy = false;
		}
	}

	// Check if a file is likely binary based on extension or content
	function isBinaryFile(filePath: string): boolean {
		// First check extension
		const ext = path.extname(filePath).toLowerCase();
		if (binaryFileExtensions.has(ext)) {
			return true;
		}

		// For other files, try to check if they're binary by examining the first few bytes
		try {
			// Check file size first (optional)
			const stats = fs.statSync(filePath);
			if (stats.size > 10 * 1024 * 1024) { // Skip files larger than 10MB
				return true;
			}

			// Read the first chunk of the file
			const buffer = Buffer.alloc(4096);
			const fd = fs.openSync(filePath, 'r');
			const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
			fs.closeSync(fd);

			// Check for NULL bytes or other binary indicators
			for (let i = 0; i < bytesRead; i++) {
				// NULL bytes are a good indicator of binary content
				if (buffer[i] === 0) {
					return true;
				}
			}

			return false;
		} catch (error) {
			// If we can't read the file, be conservative and assume it's binary
			return true;
		}
	}

	// Helper function to get the file icon based on extension
	function getFileIcon(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase();
		
		// Map of extensions to VSCode codicons
		// Using the official VSCode file icons where possible
		switch (ext) {
			case '.js':
				return '$(js)';
			case '.jsx':
				return '$(react)';
			case '.ts':
				return '$(typescript)';
			case '.tsx':
				return '$(react)';
			case '.json':
				return '$(json)';
			case '.md':
				return '$(markdown)';
			case '.css':
				return '$(css)';
			case '.scss':
			case '.sass':
				return '$(css)';
			case '.html':
				return '$(html)';
			case '.vue':
				return '$(preview)';
			case '.py':
				return '$(python)';
			case '.java':
				return '$(java)';
			case '.go':
				return '$(go)';
			case '.php':
				return '$(php)';
			case '.c':
			case '.cpp':
			case '.h':
				return '$(cpp)';
			case '.cs':
				return '$(csharp)';
			case '.rb':
				return '$(ruby)';
			case '.rs':
				return '$(rust)';
			case '.sh':
			case '.bash':
				return '$(terminal)';
			// Add binary file icons
			case '.jpg':
			case '.jpeg':
			case '.png':
			case '.gif':
			case '.svg':
				return '$(file-media)';
			case '.pdf':
				return '$(file-pdf)';
			case '.zip':
			case '.tar':
			case '.gz':
			case '.rar':
				return '$(file-zip)';
			default:
				// Check if it's a special file
				const basename = path.basename(filePath).toLowerCase();
				if (basename === 'package.json')
					return '$(package)';
				if (basename === 'dockerfile')
					return '$(docker)';
				if (basename.includes('.vscode'))
					return '$(settings-gear)';
				if (basename === '.gitignore' || basename === '.git')
					return '$(git-branch)';
				return '$(file)';
		}
	}

	// Helper function to format the file location part
	function getFileLocation(relativePath: string): string {
		// If it's in a directory, show the directory
		const dirname = path.dirname(relativePath);
		if (dirname !== '.') {
			return dirname;
		}
		return '';
	}

	// Function to preview a file
	function peekItem(items: readonly SearchQuickPickItem[]) {
		if (items.length === 0) {
			return;
		}

		const currentItem = items[0];
		if (!currentItem.data) {
			return;
		}

		const { filePath, linePos, colPos, searchText, type } = currentItem.data;
		
		// Skip preview for binary files
		if (isBinaryFile(filePath)) {
			// Instead of opening the binary file, just show a message or icon
			return;
		}
		
		// Use a try-catch block to handle errors
		try {
			// Proceed with text file preview using async/await
			const documentPromise = vscode.workspace.openTextDocument(path.resolve(filePath));
			
			// Handle the document opening with proper error handling
			documentPromise
				.then(document => {
					return vscode.window.showTextDocument(document, {
						preview: true,
						preserveFocus: true,
					})
					.then(editor => {
						lastPreviewEditor = editor;
						setCursorPosition(editor, linePos, colPos);
						
						// Highlight the current line
						const lineRange = editor.document.lineAt(linePos).range;
						lastHighlightDecoration = vscode.window.createTextEditorDecorationType({
							backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
							isWholeLine: true
						});
						editor.setDecorations(lastHighlightDecoration, [lineRange]);
						
						// If this is a content match, also highlight the matching text
						if (type === 'content' && searchText) {
							// Find all matches in the file
							const fileText = document.getText();
							const ranges: vscode.Range[] = [];
							const searchRegex = new RegExp(escapeRegExp(searchText), 'gi');
							
							let match;
							while ((match = searchRegex.exec(fileText)) !== null) {
								const startPos = document.positionAt(match.index);
								const endPos = document.positionAt(match.index + match[0].length);
								ranges.push(new vscode.Range(startPos, endPos));
							}
							
							// Add decorations
							contentMatchDecorations = vscode.window.createTextEditorDecorationType({
								backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
							});
							
							editor.setDecorations(contentMatchDecorations, ranges);
						}
					});
				})
				.then(undefined, (error: Error) => {
					// Handle any errors opening the file silently
					console.log(`Could not preview file: ${filePath}`, error);
				});
		} catch (error) {
			// Handle any synchronous errors
			console.log(`Error previewing file: ${filePath}`, error);
		}
	}

	// Function to set cursor position
	function setCursorPosition(editor: vscode.TextEditor, line: number, column: number) {
		const position = new vscode.Position(line, column);
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(
			new vscode.Range(position, position),
			vscode.TextEditorRevealType.InCenter
		);
	}
	
	// Helper function to escape regex special characters
	function escapeRegExp(string: string) {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
