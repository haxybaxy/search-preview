// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EditorHistoryManager } from './lib/editorHistory';
import { QuickOpenProvider } from './lib/quickOpenProvider';


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
}

// This method is called when your extension is deactivated
export function deactivate() {}
