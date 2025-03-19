// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "search-preview" is now active!');

	// Track the currently shown preview editor
	let lastPreviewEditor: vscode.TextEditor | undefined;
	let lastHighlightDecoration: vscode.TextEditorDecorationType | undefined;
	let contentMatchDecorations: vscode.TextEditorDecorationType | undefined;

	// Register our enhanced quick open command
	const disposable = vscode.commands.registerCommand('search-preview.quickOpenWithPreview', async () => {
		// Create the quick pick UI
		const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
		quickPick.placeholder = 'Type to search in files (with preview)';
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		
		// Show progress indicator while loading initial files
		quickPick.busy = true;
		
		// Show the quick pick UI immediately
		quickPick.show();
		
		// Load initial files list (preload before user types anything)
		try {
			await loadInitialFilesList(quickPick);
		} finally {
			quickPick.busy = false;
		}
		
		// Update results based on user input
		quickPick.onDidChangeValue(async (value) => {
			if (!value || value.length < 2) {
				// Restore the initial files list if user clears the input
				await loadInitialFilesList(quickPick);
				return;
			}
			
			// Get all workspace files for filename matching
			const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
			
			// Filter files based on filename
			const filenameMatches = files.filter(file => {
				const fileName = path.basename(file.fsPath).toLowerCase();
				const filePath = vscode.workspace.asRelativePath(file.fsPath).toLowerCase();
				return fileName.includes(value.toLowerCase()) || filePath.includes(value.toLowerCase());
			});
			
			const filenameResults: SearchQuickPickItem[] = filenameMatches.map(file => {
				const relativePath = vscode.workspace.asRelativePath(file.fsPath);
				return {
					label: path.basename(file.fsPath),
					description: relativePath,
					detail: `$(file) ${relativePath}`,
					data: {
						filePath: file.fsPath,
						linePos: 0,
						colPos: 0,
						searchText: value,
						type: 'file'
					}
				};
			});
			
			// Only attempt content search for 3+ characters
			const contentResults: SearchQuickPickItem[] = [];
			
			// Skip file content search for short queries
			if (value.length >= 3) {
				// For simplicity, we'll only search in the first few files
				// VSCode's search API is complex and version-dependent,
				// so we'll implement a basic search approach
				const filesToSearch = files.slice(0, 20); // Limit to 20 files for performance
				
				for (const file of filesToSearch) {
					try {
						const document = await vscode.workspace.openTextDocument(file);
						const text = document.getText();
						const lines = text.split('\n');
						
						// Find matches in the file content
						lines.forEach((line, lineIndex) => {
							const lineText = line.toLowerCase();
							const valueText = value.toLowerCase();
							
							if (lineText.includes(valueText)) {
								const colPos = lineText.indexOf(valueText);
								
								contentResults.push({
									label: `$(text-size) ${path.basename(file.fsPath)}:${lineIndex + 1}`,
									description: vscode.workspace.asRelativePath(file.fsPath),
									detail: line.length > 50 ? `...${line.substring(0, 50)}...` : line,
									data: {
										filePath: file.fsPath,
										linePos: lineIndex,
										colPos: colPos,
										searchText: value,
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
			
			// Combine and display results
			quickPick.items = [...filenameResults, ...contentResults];
		});

		// Set up the on change handler to show file previews
		quickPick.onDidChangeActive(items => {
			// Clear previous decorations
			if (lastHighlightDecoration) {
				lastHighlightDecoration.dispose();
				lastHighlightDecoration = undefined;
			}
			
			if (contentMatchDecorations) {
				contentMatchDecorations.dispose();
				contentMatchDecorations = undefined;
			}

			peekItem(items);
		});

		// Handle selection
		quickPick.onDidAccept(async () => {
			const selectedItem = quickPick.selectedItems[0];
			
			if (selectedItem && selectedItem.data) {
				const { filePath, linePos, colPos } = selectedItem.data;
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
			
			quickPick.hide();
		});
	});

	context.subscriptions.push(disposable);

	// Add our command to the command palette
	const commandPalette = vscode.commands.registerCommand('search-preview.showCommandPalette', () => {
		vscode.commands.executeCommand('search-preview.quickOpenWithPreview');
	});

	context.subscriptions.push(commandPalette);

	// Helper function to load initial files list
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
					results.push({
						label: `$(file-opened) ${path.basename(uri.fsPath)}`,
						description: relativePath,
						detail: `$(file) Open in editor`,
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
					results.push({
						label: path.basename(uri.fsPath),
						description: relativePath,
						detail: `$(file) ${relativePath}`,
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
		vscode.workspace.openTextDocument(path.resolve(filePath)).then((document) => {
			vscode.window
				.showTextDocument(document, {
					preview: true,
					preserveFocus: true,
				})
				.then((editor) => {
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
						const text = document.getText();
						const ranges: vscode.Range[] = [];
						const searchRegex = new RegExp(escapeRegExp(searchText), 'gi');
						
						let match;
						while ((match = searchRegex.exec(text)) !== null) {
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
		});
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
