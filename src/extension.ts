// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EditorHistoryManager } from './lib/editorHistory';
import { QuickOpenProvider } from './lib/quickOpenProvider';

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
	// Create and initialize the editor history manager
	const editorHistoryManager = new EditorHistoryManager();
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

	// Add the standard command to the command palette
	const commandPalette = vscode.commands.registerCommand(
		'search-preview.showCommandPalette', 
		() => vscode.commands.executeCommand('search-preview.quickOpenWithPreview')
	);
	context.subscriptions.push(commandPalette);
	
	// Add a command to toggle auto-reveal in Explorer
	const toggleAutoRevealCommand = vscode.commands.registerCommand(
		'search-preview.toggleExplorerAutoReveal',
		async () => {
			const config = vscode.workspace.getConfiguration('explorer');
			const currentSetting = config.get<boolean>('autoReveal');
			
			// Toggle the setting
			await config.update('autoReveal', !currentSetting, vscode.ConfigurationTarget.Global);
			
			// Show a message with the new state
			const state = !currentSetting ? 'enabled' : 'disabled';
			vscode.window.showInformationMessage(`Explorer auto-reveal ${state}`);
		}
	);
	context.subscriptions.push(toggleAutoRevealCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
