// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EditorHistoryManager } from './lib/editorHistory';
import { QuickOpenProvider } from './lib/quickOpenProvider';
import { invalidateFileCache } from './utils/searchUtils';
import { SettingsManager } from './utils/settingsUtils';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Create and initialize the editor history manager
	const editorHistoryManager = new EditorHistoryManager(context);
	editorHistoryManager.registerListeners(context);
	
	// Create the quick open provider
	const quickOpenProvider = new QuickOpenProvider(editorHistoryManager);

	// Register standard quick open with preview command
	const quickOpenCommand = vscode.commands.registerCommand(
		'search-preview.quickOpenWithPreview', 
		() => quickOpenProvider.show('standard')
	);
	context.subscriptions.push(quickOpenCommand);

	// Register most recently used editors command
	const recentEditorsCommand = vscode.commands.registerCommand(
		'search-preview.showAllEditorsByMostRecentlyUsed', 
		() => quickOpenProvider.show('recent')
	);
	context.subscriptions.push(recentEditorsCommand);

	// Add a command to open search settings
	const openSearchSettingsCommand = vscode.commands.registerCommand(
		'search-preview.openSearchSettings',
		() => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'searchPreview.search');
		}
	);
	context.subscriptions.push(openSearchSettingsCommand);

	// Set up file watcher for cache invalidation (telescope-style)
	const config = SettingsManager.getFdConfig();
	if (config.enableFileWatcher) {
		// Watch for file creation/deletion to invalidate cache
		const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
		
		// Debounce cache invalidation to avoid too frequent updates
		let invalidateTimer: NodeJS.Timeout | undefined;
		const debouncedInvalidate = () => {
			if (invalidateTimer) {
				clearTimeout(invalidateTimer);
			}
			invalidateTimer = setTimeout(() => {
				invalidateFileCache();
			}, 1000); // 1 second debounce
		};
		
		fileWatcher.onDidCreate(debouncedInvalidate);
		fileWatcher.onDidDelete(debouncedInvalidate);
		
		context.subscriptions.push(fileWatcher);
		console.log('File watcher enabled for telescope-style cache invalidation');
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
